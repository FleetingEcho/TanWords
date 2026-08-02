import { useEffect, useRef, useState } from "react";
import { invoke } from "@/ipc/backend";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import type { ReadingComment } from "@/hooks/useDB.reading";
import { useTtsPlayerStore } from "@/store/ttsPlayerStore";
import { usePodcastPlayerStore, type PodcastTrack } from "@/store/podcastPlayerStore";
import { usePlayerOriginStore } from "@/store/playerOriginStore";
import { useReaderNotesStore } from "@/store/readerNotesStore";
import { useLearnChatStore } from "@/store/learnChatStore";
import { useLearnArticle } from "@/hooks/useLearnArticle";
import { toast } from "sonner";
import { flattenHnComments, commentsToSpeechText, type HnComment } from "@/lib/hnComments";
import { buildArticleMarkdown } from "@/lib/articleMarkdown";
import { articleFromPastedText, FetchedArticle, LIBRARY_URL_PREFIX, SCRATCH_URL_PREFIX } from "../articleReaderHelpers";
import { hostCapabilities } from "@/platform";

/** All state, effects, and handlers behind ArticleReader — split out so the
 * component itself only has to worry about rendering (the loading/error
 * states, the article body, the side panel, and the portalled toolbar). */
export function useArticleReaderState(params: {
  url: string;
  domain: string;
  audio?: PodcastTrack;
  hnItemId?: number | null;
}) {
  const { url, domain, audio, hnItemId } = params;
  const t = useT();
  const { startLearn } = useLearnArticle();
  const learnJob = useLearnChatStore((s) => s.jobs[url]);
  const cancelLearn = useLearnChatStore((s) => s.cancel);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [article, setArticle] = useState<FetchedArticle | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [fontStep, setFontStep] = useState(1);
  const [hnComments, setHnComments] = useState<HnComment[] | null>(null);
  const [pastedText, setPastedText] = useState("");
  const db = useDB();
  // Set once the text on screen is a row in the reading library, so its
  // comments can be loaded and new ones attached.
  const [articleId, setArticleId] = useState<number | null>(null);
  const [comments, setComments] = useState<ReadingComment[]>([]);
  const [showComments, setShowComments] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [copied, setCopied] = useState(false);
  const [chatModalSessionId, setChatModalSessionId] = useState<string | null>(null);
  const [learnMenuOpen, setLearnMenuOpen] = useState(false);
  const learnMenuCloseTimer = useRef<number | null>(null);
  // The analyze trigger lives in the reader bar now (see ReaderView) — this page
  // only publishes its article there and renders whatever comes back.
  const showNotes = useReaderNotesStore((s) => s.showNotes);
  const analyzingNotes = useReaderNotesStore((s) => s.analyzing);
  const notesMarkdown = useReaderNotesStore((s) => s.notesMarkdown);
  // The right-hand panel shows one thing at a time. Defaults to notes since
  // that's the more common of the two; switches to translation the moment the
  // user asks for it, and back to notes when a fresh analysis lands.
  const [rightView, setRightView] = useState<"notes" | "translation" | "comments">("notes");
  const requestSeq = useRef(0);
  const playerSourceKey = useTtsPlayerStore((s) => s.sourceKey);
  const playerStart = useTtsPlayerStore((s) => s.start);
  const playerToggle = useTtsPlayerStore((s) => s.toggle);
  const podcastTrackUrl = usePodcastPlayerStore((s) => s.track?.audioUrl);
  const podcastStatus = usePodcastPlayerStore((s) => s.status);
  const sourceKey = `reader-${url}`;
  const commentsSourceKey = `reader-comments-${url}`;
  const podcastActive = !!audio && podcastStatus !== "idle" && podcastTrackUrl === audio.audioUrl;
  const playerActive = podcastActive || playerSourceKey === sourceKey;
  const commentsPlayerActive = playerSourceKey === commentsSourceKey;
  // Article renders full-width and centered for comfortable reading while it's the
  // only pane; once the right panel joins it, they share the row equally.
  const hasSidePanes = showNotes || showTranslation || showComments;
  const openPanes = [showNotes && "notes", showTranslation && "translation", showComments && "comments"].filter(Boolean) as ("notes" | "translation" | "comments")[];
  const activeView = openPanes.includes(rightView) ? rightView : openPanes[0];

  const setReaderOrigin = () => {
    if (!article) return;
    usePlayerOriginStore.getState().setOrigin({
      kind: "reader",
      url,
      title: article.title,
      domain,
      audioUrl: audio?.audioUrl ?? null,
      feedTitle: audio?.feedTitle ?? "",
      hnItemId: hnItemId ?? null,
    });
  };

  const handleListen = () => {
    if (audio) {
      // Podcast episode: play the original recording, never TTS.
      if (podcastActive) usePodcastPlayerStore.getState().toggle();
      else {
        usePodcastPlayerStore.getState().play(audio);
        setReaderOrigin();
      }
      return;
    }
    if (playerActive) playerToggle();
    else if (hostCapabilities.nativeTts && article) {
      playerStart(sourceKey, article.text_content);
      setReaderOrigin();
    }
  };

  /** Idle: kicks off the background Reading Tutor analysis. Running: opens
   *  controls for watching/cancelling it. Done: opens the saved conversation. */
  const handleLearnClick = () => {
    if (!article) return;
    if (learnJob?.status === "running") {
      setLearnMenuOpen(true);
      return;
    }
    if (learnJob?.status === "done" && learnJob.sessionId) {
      setChatModalSessionId(learnJob.sessionId);
      return;
    }
    startLearn(url, {
      title: article.title,
      text: article.text_content,
      commentsText: hnComments ? flattenHnComments(hnComments) : undefined,
    });
  };

  const keepLearnMenuOpen = () => {
    if (learnMenuCloseTimer.current !== null) window.clearTimeout(learnMenuCloseTimer.current);
    if (learnJob?.status === "running") setLearnMenuOpen(true);
  };

  const scheduleLearnMenuClose = () => {
    if (learnMenuCloseTimer.current !== null) window.clearTimeout(learnMenuCloseTimer.current);
    learnMenuCloseTimer.current = window.setTimeout(() => setLearnMenuOpen(false), 180);
  };

  /** Copies the article (and the HN thread when loaded) as markdown — for
   *  pasting into an external AI chat, so nothing is truncated. */
  const handleCopyMarkdown = async () => {
    if (!article) return;
    const markdown = buildArticleMarkdown({
      title: article.title,
      byline: article.byline,
      siteName: article.site_name,
      sourceUrl: url.startsWith(SCRATCH_URL_PREFIX) || url.startsWith(LIBRARY_URL_PREFIX) ? undefined : url,
      contentHtml: article.content_html,
      comments: hnComments,
    });
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("reader.copyFailed"));
    }
  };

  const handleListenComments = () => {
    if (!hostCapabilities.nativeTts) return;
    if (commentsPlayerActive) {
      playerToggle();
      return;
    }
    if (!hnComments || hnComments.length === 0) return;
    playerStart(commentsSourceKey, commentsToSpeechText(hnComments));
    setReaderOrigin();
  };

  const handlePasteSubmit = async (title?: string) => {
    const text = pastedText.trim();
    if (!text) return;
    const built = articleFromPastedText(text, title?.trim() || "");
    setArticle(built);
    setStatus("ready");
    setErrorMsg("");
    // Everything read here joins the library, so it can be found again and
    // annotated — by the user or by an agent over MCP.
    const id = await db.saveReadingArticle(built.title, built.text_content, "paste");
    if (id > 0) {
      setArticleId(id);
      window.dispatchEvent(new CustomEvent("articles-updated"));
      // Hand the page the row id so the reader switches from this throwaway
      // scratch session to the saved article. Until it does, what's on screen
      // has no identity the page can restore: navigating away and back would
      // drop you on a blank sheet even though the text was already filed.
      // Harmless mid-read — the library copy is the same text just written,
      // and the reader is still at the top of it.
      window.dispatchEvent(new CustomEvent("tanwords:open-article", { detail: { id } }));
    }
    useReaderNotesStore.getState().setArticle({
      url,
      title: built.title,
      text: built.text_content,
      hnItemId: hnItemId ?? null,
    });
  };

  const handleHnCommentsLoaded = (comments: HnComment[]) => {
    setHnComments(comments);
    useReaderNotesStore.getState().setCommentsText(flattenHnComments(comments) || undefined);
  };

  useEffect(() => {
    const seq = ++requestSeq.current;
    setArticle(null);
    setHnComments(null);
    useReaderNotesStore.getState().setArticle(null);
    setArticleId(null);
    setComments([]);
    if (url.startsWith(LIBRARY_URL_PREFIX)) {
      const id = Number(url.slice(LIBRARY_URL_PREFIX.length));
      setStatus("loading");
      db.getReadingArticle(id, true).then((detail) => {
        if (seq !== requestSeq.current) return;
        if (!detail) {
          setErrorMsg("");
          setStatus("error");
          return;
        }
        if (detail.content.trim()) {
          setArticle({ ...articleFromPastedText(detail.content, detail.title), title: detail.title });
          setArticleId(detail.id);
          setStatus("ready");
          useReaderNotesStore.getState().setArticle({
            url, title: detail.title, text: detail.content, hnItemId: null,
          });
          return;
        }
        // A library row saved earlier can be empty when the original fetch
        // failed. If we kept its source URL, refetch the live page instead of
        // showing a permanently blank reader.
        if (detail.source_url) {
          invoke<FetchedArticle>("fetch_article", { url: detail.source_url })
            .then((a) => {
              if (seq !== requestSeq.current) return;
              setArticle(a);
              setArticleId(detail.id);
              setStatus("ready");
              useReaderNotesStore.getState().setArticle({
                url, title: a.title, text: a.text_content, hnItemId: null,
              });
            })
            .catch(() => {
              if (seq !== requestSeq.current) return;
              setStatus("error");
            });
          return;
        }
        setArticle({ ...articleFromPastedText("", detail.title), title: detail.title });
        setArticleId(detail.id);
        setStatus("ready");
        useReaderNotesStore.getState().setArticle({
          url, title: detail.title, text: "", hnItemId: null,
        });
      });
      return;
    }
    if (url.startsWith(SCRATCH_URL_PREFIX)) {
      // Nothing to fetch — "error" is the state that already renders the
      // paste box, with the extraction-failed copy swapped out below.
      setStatus("error");
      setErrorMsg("");
      return;
    }
    setStatus("loading");
    invoke<FetchedArticle>("fetch_article", { url })
      .then((a) => {
        if (seq !== requestSeq.current) return;
        setArticle(a);
        setStatus("ready");
        useReaderNotesStore.getState().setArticle({
          url,
          title: a.title,
          text: a.text_content,
          hnItemId: hnItemId ?? null,
        });
      })
      .catch((e) => {
        if (seq !== requestSeq.current) return;
        setErrorMsg(typeof e === "string" ? e : String(e?.message ?? e));
        setStatus("error");
      });
  }, [url]);

  // Notes left on this article — by the user here, or by an agent through
  // MCP while the article sits open.
  useEffect(() => {
    if (articleId === null) { setComments([]); return; }
    let cancelled = false;
    const load = () => { void db.listReadingComments(articleId).then((rows) => { if (!cancelled) setComments(rows); }); };
    load();
    window.addEventListener("articles-updated", load);
    return () => { cancelled = true; window.removeEventListener("articles-updated", load); };
  }, [articleId, db]);

  // Leaving the reader entirely (not just switching articles, which the effect
  // above already handles) — the reader bar's analyze button should disappear
  // once there's nothing here to analyze.
  useEffect(() => () => useReaderNotesStore.getState().setArticle(null), []);

  // Bring notes to the front of the right panel the moment they're requested
  // (the reader bar's analyze button, not this component, sets showNotes).
  useEffect(() => {
    if (showNotes) setRightView("notes");
  }, [showNotes]);

  return {
    t, db,
    status, article, errorMsg, fontStep, setFontStep, hnComments, pastedText, setPastedText,
    articleId, comments, showComments, setShowComments, showTranslation, setShowTranslation,
    copied, chatModalSessionId, setChatModalSessionId, learnMenuOpen, setLearnMenuOpen,
    showNotes, analyzingNotes, notesMarkdown, rightView, setRightView,
    podcastActive, podcastStatus, playerActive, commentsPlayerActive,
    hasSidePanes, openPanes, activeView,
    learnJob, cancelLearn,
    handleListen, handleLearnClick, keepLearnMenuOpen, scheduleLearnMenuClose,
    handleCopyMarkdown, handleListenComments, handlePasteSubmit, handleHnCommentsLoaded,
  };
}

export type ArticleReaderState = ReturnType<typeof useArticleReaderState>;
