import { useState, useEffect, useRef, useCallback } from "react";
import { useDB, ChatSessionItem } from "@/hooks/useDB";
import { DisplayItem, serializeItems } from "../aiChatHelpers";

/** Session list state for AiChatPage's sidebar: the active/archived lists,
 * the last-activity date filter, and search — plus `saveSession`, which
 * belongs here because every list-affecting write goes through it and then
 * reloads the lists. Active-session state (which one is open, its messages)
 * lives in useChatSession. */
export function useChatSidebar(db: ReturnType<typeof useDB>) {
  const [sessions, setSessions] = useState<ChatSessionItem[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<ChatSessionItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  // Last-activity range filter, YYYY-MM-DD. Empty = no bound.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchResults, setSearchResults] = useState<ChatSessionItem[] | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSessions = useCallback(async () => {
    const [active, archived] = await Promise.all([
      db.listChatSessions(0, 200, { archived: false, dateFrom, dateTo }),
      db.listChatSessions(0, 200, { archived: true, dateFrom, dateTo }),
    ]);
    setSessions(active);
    setArchivedSessions(archived);
    return active;
  }, [db, dateFrom, dateTo]);

  // Re-query when the range changes. The mount-time load (in useChatSession)
  // runs this too, so this only fires on an actual filter change.
  useEffect(() => { void loadSessions(); }, [dateFrom, dateTo]);

  const saveSession = useCallback(async (
    id: string, title: string, items: DisplayItem[], sysPrompt: string, presetId: string, providerId: string
  ) => {
    const msgCount = items.filter((i) => i.kind === "message").length;
    await db.upsertChatSession({
      id, title,
      messages: serializeItems(items),
      systemPrompt: sysPrompt,
      presetId,
      providerId,
      messageCount: msgCount,
    });
    await loadSessions();
  }, [db, loadSessions]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    searchTimer.current = setTimeout(async () => {
      setSearchResults(await db.searchChatSessions(searchQuery.trim()));
    }, 250);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery, db]);

  /** Moves a conversation to (or out of) the archive: it stays searchable and
   *  openable, just folded away from the working list. */
  const toggleArchived = async (id: string, archived: boolean) => {
    await db.setChatSessionArchived(id, archived);
    await loadSessions();
  };

  const togglePinned = async (id: string, pinned: boolean) => {
    await db.setChatSessionPinned(id, pinned);
    await loadSessions();
  };

  const displaySessions = searchResults ?? sessions;

  return {
    sessions, setSessions, archivedSessions, setArchivedSessions,
    searchQuery, setSearchQuery,
    dateFrom, dateTo, setDateRange: (from: string, to: string) => { setDateFrom(from); setDateTo(to); },
    searchResults, setSearchResults, displaySessions,
    loadSessions, saveSession, toggleArchived, togglePinned,
  };
}

export type ChatSidebarState = ReturnType<typeof useChatSidebar>;
