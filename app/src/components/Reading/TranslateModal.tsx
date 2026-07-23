import React, { useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import { findBestProvider } from "@/providers/select";
import { CloseIcon, TranslateIcon } from "@/components/ui/icons";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Plain article text to translate. */
  articleText: string;
  /** Flattened HN comment text, when present — translated as a separate section. */
  commentsText?: string;
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return String(e);
}

/** One-click "translate to Chinese" for an article (and its HN comments, if loaded) —
 *  streams straight from the AI provider, nothing persisted. Article and comments
 *  translate concurrently and track separate error states, so one failing (e.g. the
 *  comments pass hitting a rate limit) doesn't hide or block the other's result. */
export function TranslateModal({ open, onClose, title, articleText, commentsText }: Props) {
  const t = useT();
  const [articleTranslation, setArticleTranslation] = useState("");
  const [articleStatus, setArticleStatus] = useState<"loading" | "ready" | "error">("loading");
  const [articleError, setArticleError] = useState("");
  const [commentsTranslation, setCommentsTranslation] = useState("");
  const [commentsStatus, setCommentsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [commentsError, setCommentsError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const hasComments = Boolean(commentsText?.trim());

    setArticleTranslation("");
    setArticleStatus("loading");
    setArticleError("");
    setCommentsTranslation("");
    setCommentsStatus("loading");
    setCommentsError("");

    const provider = findBestProvider();
    if (!provider) {
      setArticleStatus("error");
      setArticleError(t("reading.translate.noProvider"));
      if (hasComments) {
        setCommentsStatus("error");
        setCommentsError(t("reading.translate.noProvider"));
      }
      return;
    }

    (async () => {
      try {
        let acc = "";
        for await (const chunk of provider.translate({ text: articleText, targetLang: "Chinese", mode: "translate" })) {
          if (cancelled) return;
          acc += chunk;
          setArticleTranslation(acc);
        }
        if (!cancelled) setArticleStatus("ready");
      } catch (e) {
        if (!cancelled) {
          setArticleStatus("error");
          setArticleError(errorMessage(e));
        }
      }
    })();

    if (hasComments) {
      (async () => {
        try {
          let acc = "";
          for await (const chunk of provider.translate({ text: commentsText!, targetLang: "Chinese", mode: "translate" })) {
            if (cancelled) return;
            acc += chunk;
            setCommentsTranslation(acc);
          }
          if (!cancelled) setCommentsStatus("ready");
        } catch (e) {
          if (!cancelled) {
            setCommentsStatus("error");
            setCommentsError(errorMessage(e));
          }
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [open, articleText, commentsText, t]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-black/45 px-4 pt-[8vh] backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3.5">
          <TranslateIcon className="h-4 w-4 text-primary" />
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h3>
          <button onClick={onClose} aria-label={t("reading.translate.close")} className="text-muted-foreground hover:text-foreground">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-5">
          {articleStatus === "loading" && !articleTranslation && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="h-4 w-4 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
              {t("reading.translate.loading")}
            </div>
          )}

          {articleStatus === "error" && (
            <div className="space-y-1">
              <p className="text-xs text-destructive">{t("reading.translate.error")}</p>
              {articleError && <p className="text-[11px] font-mono text-muted-foreground/70 break-all">{articleError}</p>}
            </div>
          )}

          {articleTranslation && (
            <div className="space-y-1.5">
              {commentsText && (
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("reading.translate.article")}
                </p>
              )}
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{articleTranslation}</p>
            </div>
          )}

          {commentsText?.trim() && (
            <div className="space-y-1.5 border-t border-border pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-orange-600 dark:text-orange-400">
                {t("reading.translate.comments")}
              </p>
              {commentsStatus === "loading" && !commentsTranslation && (
                <div className="h-4 w-4 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
              )}
              {commentsStatus === "error" && (
                <div className="space-y-1">
                  <p className="text-xs text-destructive">{t("reading.translate.error")}</p>
                  {commentsError && <p className="text-[11px] font-mono text-muted-foreground/70 break-all">{commentsError}</p>}
                </div>
              )}
              {commentsTranslation && (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{commentsTranslation}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
