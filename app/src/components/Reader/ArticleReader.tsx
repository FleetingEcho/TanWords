import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "@/hooks/useT";
import { useTtsPlayerStore } from "@/store/ttsPlayerStore";
import { SpeakerIcon } from "@/components/ui/icons";

export interface FetchedArticle {
  title: string;
  byline: string | null;
  site_name: string | null;
  content_html: string;
  text_content: string;
  excerpt: string | null;
}

interface Props {
  url: string;
  /** Learn should hand off the extracted plain text — no manual copy/paste needed. */
  onLearn: (article: { title: string; text: string }) => void;
  onOpenExternal: () => void;
}

const FONT_STEPS = [15, 16, 17.5, 19, 21] as const;

export function ArticleReader({ url, onLearn, onOpenExternal }: Props) {
  const t = useT();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [article, setArticle] = useState<FetchedArticle | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [fontStep, setFontStep] = useState(1);
  const requestSeq = useRef(0);
  const playerSourceKey = useTtsPlayerStore((s) => s.sourceKey);
  const playerStart = useTtsPlayerStore((s) => s.start);
  const playerToggle = useTtsPlayerStore((s) => s.toggle);
  const sourceKey = `reader-${url}`;
  const playerActive = playerSourceKey === sourceKey;

  useEffect(() => {
    const seq = ++requestSeq.current;
    setStatus("loading");
    setArticle(null);
    invoke<FetchedArticle>("fetch_article", { url })
      .then((a) => {
        if (seq !== requestSeq.current) return;
        setArticle(a);
        setStatus("ready");
      })
      .catch((e) => {
        if (seq !== requestSeq.current) return;
        setErrorMsg(typeof e === "string" ? e : String(e?.message ?? e));
        setStatus("error");
      });
  }, [url]);

  if (status === "loading") {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
        <span className="text-xs text-muted-foreground">{t("reader.loading")}</span>
      </div>
    );
  }

  if (status === "error" || !article) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-muted-foreground max-w-md">{t("reader.extractFailed")}</p>
        {errorMsg && <p className="text-[11px] font-mono text-muted-foreground/50 max-w-md truncate">{errorMsg}</p>}
        <button
          onClick={onOpenExternal}
          className="h-9 px-4 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {t("hn.reader.external")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-[68ch] mx-auto px-6 py-10">
        {/* Font size control */}
        <div className="flex items-center justify-end gap-1 mb-6 -mt-2">
          <button
            onClick={() => setFontStep((s) => Math.max(0, s - 1))}
            disabled={fontStep === 0}
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors text-xs font-bold"
            title={t("reader.fontSmaller")}
          >
            A-
          </button>
          <button
            onClick={() => setFontStep((s) => Math.min(FONT_STEPS.length - 1, s + 1))}
            disabled={fontStep === FONT_STEPS.length - 1}
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors text-sm font-bold"
            title={t("reader.fontLarger")}
          >
            A+
          </button>
        </div>

        <h1 className="font-serif text-[1.9em] font-bold leading-tight text-foreground">{article.title}</h1>
        {(article.byline || article.site_name) && (
          <p className="text-xs text-muted-foreground mt-3">
            {[article.byline, article.site_name].filter(Boolean).join(" · ")}
          </p>
        )}

        <div className="mt-6 flex items-center gap-2">
          <button
            onClick={() => onLearn({ title: article.title, text: article.text_content })}
            className="h-9 px-4 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            ✦ {t("hn.learn")}
          </button>
          <button
            onClick={() => {
              if (playerActive) playerToggle();
              else playerStart(sourceKey, article.text_content);
            }}
            className={`h-9 px-4 rounded-lg text-sm font-semibold flex items-center gap-1.5 transition-colors ${
              playerActive
                ? "bg-primary/10 text-primary"
                : "border border-input text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <SpeakerIcon className="w-4 h-4" />
            {t("tts.listenToArticle")}
          </button>
        </div>

        <div
          className="reader-article-content font-serif text-foreground mt-8"
          style={{ fontSize: `${FONT_STEPS[fontStep]}px`, lineHeight: 1.85 }}
          dangerouslySetInnerHTML={{ __html: article.content_html }}
        />
      </div>
    </div>
  );
}
