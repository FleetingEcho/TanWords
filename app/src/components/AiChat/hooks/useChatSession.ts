import { useState, useEffect, useRef, useCallback } from "react";
import { AIProvider } from "@/providers/base";
import { useDB } from "@/hooks/useDB";
import { useLearnChatStore } from "@/store/learnChatStore";
import { ToolGroupKey } from "../tools";
import {
  DisplayItem, buildPresetPrompt, genId, serializeItems, deserializeItems,
} from "../aiChatHelpers";
import type { ChatSidebarState } from "./useChatSidebar";

/** The currently-open session: which one, its messages, its settings
 * (preset/prompt/provider/tools), and the session-list operations
 * (switch/new/rename/delete) that revolve around it. Sending a message and
 * the composer UI are separate hooks — see useSendMessage / useChatComposer. */
export function useChatSession(params: {
  db: ReturnType<typeof useDB>;
  targetLevel: string;
  providers: AIProvider[];
  initialSessionId?: string;
  sidebar: ChatSidebarState;
}) {
  const { db, targetLevel, providers, initialSessionId, sidebar } = params;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [displayItems, setDisplayItems] = useState<DisplayItem[]>([]);
  const [activeTitle, setActiveTitle] = useState("");
  const [isNewSession, setIsNewSession] = useState(true);
  const [streaming, setStreaming] = useState(false);

  const [selectedPreset, setSelectedPreset] = useState("english-tutor");
  const [customPrompt, setCustomPrompt] = useState(() => buildPresetPrompt("english-tutor", targetLevel));
  const [selectedProviderId, setSelectedProviderId] = useState(() => providers[0]?.id ?? "");
  const [enabledGroups, setEnabledGroups] = useState<Set<ToolGroupKey>>(
    () => new Set<ToolGroupKey>(["vocabulary", "documents", "calendar"])
  );
  const [showTools, setShowTools] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);
  // Mirrors displayItems so an aborted stream can still save what arrived
  const itemsRef = useRef<DisplayItem[]>([]);
  const sessionMetaRef = useRef({ id: "", title: "" });
  // Mirrors activeId so the fire-and-forget title generation can tell if the
  // user has since switched away from the session it's naming.
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  // Set by startNew()/switchSession() so the mount-time auto-restore below —
  // whose loadSessions() call is async and can resolve after either of those
  // — knows to bail instead of clobbering whatever the user/caller already
  // did with an older, no-longer-relevant session's messages.
  const skipAutoRestoreRef = useRef(false);
  // Bumped by every switchSession()/startNew() call. switchSession's DB fetch
  // is async — if startNew() (or a newer switchSession) runs while one is still
  // in flight, its continuation must not apply the stale session it fetched.
  const sessionEpochRef = useRef(0);

  // Keep the effective prompt explicit and editable for every role. Presets are
  // starting points, not opaque behavior that users cannot inspect or change.
  const systemPrompt = customPrompt || buildPresetPrompt(selectedPreset, targetLevel);

  const setItems = useCallback((items: DisplayItem[]) => {
    itemsRef.current = items;
    setDisplayItems(items);
  }, []);

  // Opening the page lands on an empty new conversation. Only an explicit
  // request opens history: a caller naming a session (the reader's "Open in
  // AI Chat"), or the user clicking one in the sidebar. Auto-restoring the
  // last-active chat means every visit starts mid-conversation in something
  // the user didn't ask for.
  useEffect(() => {
    sidebar.loadSessions().then((items) => {
      if (skipAutoRestoreRef.current) return; // startNew/switchSession already won this mount
      const target = initialSessionId && items.find((item) => item.id === initialSessionId);
      if (target) switchSession(target.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionId]);

  // Background Reading Tutor jobs persist their partial transcript while they
  // stream. If one is open in this page/modal, reflect those writes live
  // without taking ownership of (or interrupting) the background request.
  useEffect(() => {
    const onExternalSessionUpdate = (event: Event) => {
      const sessionId = (event as CustomEvent<{ sessionId?: string }>).detail?.sessionId;
      if (!sessionId) return;
      const openingInitialSession = !activeIdRef.current && initialSessionId === sessionId;
      if (!openingInitialSession && sessionId !== activeIdRef.current) return;
      void db.getChatSession(sessionId).then((detail) => {
        if (!detail) return;
        if (openingInitialSession) {
          skipAutoRestoreRef.current = true;
          setActiveId(sessionId);
          setIsNewSession(false);
          setSelectedPreset(detail.preset_id);
          setCustomPrompt(detail.system_prompt || buildPresetPrompt(detail.preset_id, targetLevel));
          setSelectedProviderId(detail.provider_id || providers[0]?.id || "");
        } else if (activeIdRef.current !== sessionId) {
          return;
        }
        setItems(deserializeItems(detail.messages));
        setActiveTitle(detail.title);
      });
    };
    window.addEventListener("tanwords:chat-session-updated", onExternalSessionUpdate);
    return () => window.removeEventListener("tanwords:chat-session-updated", onExternalSessionUpdate);
  }, [db, initialSessionId, providers, setItems, targetLevel]);

  useEffect(() => {
    if (!selectedProviderId && providers.length > 0) setSelectedProviderId(providers[0].id);
  }, [providers.length]);

  const switchSession = useCallback(async (id: string) => {
    const epoch = ++sessionEpochRef.current;
    skipAutoRestoreRef.current = true;
    controllerRef.current?.abort();
    setStreaming(false);
    setActiveId(id);
    setIsNewSession(false);
    const detail = await db.getChatSession(id);
    if (!detail) return;
    // A newer switchSession/startNew ran while this fetch was in flight —
    // applying this stale result now would clobber whatever it set up.
    if (sessionEpochRef.current !== epoch) return;
    setItems(deserializeItems(detail.messages));
    setActiveTitle(detail.title);
    setSelectedPreset(detail.preset_id);
    setCustomPrompt(detail.system_prompt || buildPresetPrompt(detail.preset_id, targetLevel));
    setSelectedProviderId(detail.provider_id || providers[0]?.id || "");
  }, [db, providers, setItems, targetLevel]);

  const startNew = () => {
    sessionEpochRef.current++;
    skipAutoRestoreRef.current = true;
    controllerRef.current?.abort();
    setStreaming(false);
    setActiveId(genId());
    setItems([]);
    setActiveTitle("");
    setIsNewSession(true);
    sidebar.setSearchQuery("");
    sidebar.setSearchResults(null);
  };

  /** Index of the last user message, or -1. */
  const lastUserIndex = () => {
    for (let i = displayItems.length - 1; i >= 0; i--) {
      const item = displayItems[i];
      if (item.kind === "message" && item.msg.role === "user") return i;
    }
    return -1;
  };

  /** Cuts the conversation back to `index` (exclusive) and persists it, so a
   *  regenerate/edit doesn't leave the discarded turns to reappear the next
   *  time the session is opened. Reads from itemsRef rather than the render's
   *  displayItems so callers don't have to list it as a dependency — that
   *  would change their identity on every streaming commit and re-render
   *  every bubble in the conversation (see MessageBubble's memo). */
  const truncateTo = useCallback((index: number) => {
    const kept = itemsRef.current.slice(0, index);
    setItems(kept);
    if (activeId && !isNewSession) {
      void sidebar.saveSession(activeId, activeTitle, kept, systemPrompt, selectedPreset, selectedProviderId);
    }
    return kept;
  }, [activeId, isNewSession, activeTitle, systemPrompt, selectedPreset, selectedProviderId, sidebar, setItems]);

  const selectPreset = (presetId: string) => {
    setSelectedPreset(presetId);
    setCustomPrompt(presetId === "custom" ? "" : buildPresetPrompt(presetId, targetLevel));
  };

  const renameSession = async (id: string, title: string) => {
    const ok = await db.renameChatSession(id, title);
    if (!ok) return;
    if (activeId === id) setActiveTitle(title.trim());
    await sidebar.loadSessions();
  };

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await db.deleteChatSession(id);
    // A "Learn"/"Analyze in background" job may still be pointing at this session
    // (its checkmark on the reader/RSS card) — clear it so that button reverts to
    // idle instead of opening a chat that no longer exists.
    useLearnChatStore.getState().dismissBySessionId(id);
    sidebar.setSessions((p) => p.filter((s) => s.id !== id));
    sidebar.setArchivedSessions((p) => p.filter((s) => s.id !== id));
    sidebar.setSearchResults((p) => p?.filter((s) => s.id !== id) ?? null);
    // Deleting the open chat drops back to an empty new one rather than
    // pulling up the next history entry, which the user didn't pick either.
    if (activeId === id) startNew();
  };

  const clearMessages = async () => {
    controllerRef.current?.abort();
    setStreaming(false);
    setItems([]);
    if (activeId && !isNewSession) {
      await db.upsertChatSession({ id: activeId, title: activeTitle, messages: "[]", systemPrompt, presetId: selectedPreset, providerId: selectedProviderId, messageCount: 0 });
      await sidebar.loadSessions();
    }
  };

  // Persist partial streaming output as well as completed turns. A long AI
  // response can take minutes; closing the window must not discard it.
  useEffect(() => {
    if (!streaming) return;
    const timer = window.setInterval(() => {
      const { id, title } = sessionMetaRef.current;
      if (!id) return;
      const items = itemsRef.current;
      db.upsertChatSession({
        id, title, messages: serializeItems(items), systemPrompt,
        presetId: selectedPreset, providerId: selectedProviderId,
        messageCount: items.filter((item) => item.kind === "message").length,
      });
    }, 6000);
    return () => window.clearInterval(timer);
  }, [streaming, db, systemPrompt, selectedPreset, selectedProviderId]);

  const toggleGroup = (g: ToolGroupKey) => {
    setEnabledGroups((prev) => {
      const next = new Set(prev);
      next.has(g) ? next.delete(g) : next.add(g);
      return next;
    });
  };

  const handleStop = () => {
    controllerRef.current?.abort();
    setStreaming(false);
    const { id, title } = sessionMetaRef.current;
    if (id) {
      sidebar.saveSession(id, title, itemsRef.current, systemPrompt, selectedPreset, selectedProviderId);
    }
  };

  return {
    activeId, setActiveId,
    displayItems, setDisplayItems, itemsRef, setItems,
    activeTitle, setActiveTitle,
    isNewSession, setIsNewSession,
    streaming, setStreaming,
    selectedPreset, setSelectedPreset: selectPreset, customPrompt, setCustomPrompt,
    selectedProviderId, setSelectedProviderId,
    enabledGroups, toggleGroup, showTools, setShowTools,
    systemPrompt,
    controllerRef, sessionMetaRef, activeIdRef,
    switchSession, startNew, renameSession, deleteSession, clearMessages,
    truncateTo, lastUserIndex, handleStop,
  };
}

export type ChatSessionState = ReturnType<typeof useChatSession>;
