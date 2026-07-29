import React, { useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import { useTranslateStore } from "@/store/translateStore";
import { useHnCommentsStore } from "@/store/hnCommentsStore";
import {
  countHnComments,
  countHnCommentAuthors,
  flattenHnCommentsStructured,
  serializeCommentsForTranslation,
  parseTranslatedComments,
  type FlatHnComment,
} from "@/lib/hnComments";
import { Avatar } from "@/components/Reader/HnComments";
import { Markdown } from "@/components/AiChat/Markdown";
import { truncateMarkedBatch } from "@/lib/markerBatch";

/** Char budget for the comment batch sent to the model. Generous — capable
 *  models take this easily, and small local models get shrunk further by
 *  translateStore's context-overflow retry ladder — so that in practice the
 *  whole thread translates and every row on the left has its counterpart. */
const TRANSLATE_COMMENTS_MAX_CHARS = 30000;
import { RefreshIcon, ReplyIcon, PeopleIcon, ChevronDownIcon } from "@/components/ui/icons";
import { StatBadge } from "@/components/ui/StatBadge";

interface Props {
  /** Plain article text to translate. */
  articleText: string;
  /** Set for Hacker News (or hnrss-style) entries — the comment thread is fetched
   *  (or reused from cache, via hnCommentsStore) internally and translated as a
   *  separate section, same as the article. */
  hnItemId?: number | null;
  /** Adds a collapse/expand toggle to each section's header — for TranslateModal's
   *  popup, where the article and comments can both be long and the user may want
   *  to shrink one to focus on the other. Off for ArticleReader's inline split view,
   *  which is already a dedicated half of the screen with no need to collapse further. */
  collapsible?: boolean;
}

/** One section (Article or Comments), sized to its own content — both stack
 *  into a single shared scroll area (see the container in TranslationPane)
 *  rather than each claiming a fixed, independently-scrolling half. A small
 *  retry icon lets either section be re-translated on its own; an optional
 *  collapse toggle (TranslateModal only) lets it be shrunk to just its header. */
function Section({
  title,
  badges,
  onRetry,
  retrying,
  collapsible,
  collapsed,
  onToggleCollapse,
  children,
}: {
  title: string;
  badges?: React.ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <div>
      <div className="flex items-center gap-2 px-5 py-2.5">
        {collapsible ? (
          <button
            onClick={onToggleCollapse}
            aria-expanded={!collapsed}
            className="flex flex-1 items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDownIcon className={`h-3 w-3 shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
            {title}
          </button>
        ) : (
          <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        )}
        {badges}
        {onRetry && (
          <button
            onClick={onRetry}
            disabled={retrying}
            title={t("reading.translate.retry")}
            aria-label={t("reading.translate.retry")}
            className="text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <RefreshIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {!collapsed && <div className="space-y-3 px-5 pb-4">{children}</div>}
    </div>
  );
}

/** A translated comment, rendered the same way the live thread is (avatar, author,
 *  "replying to X", reply count) — just with the translated body swapped in. Falls
 *  back to the original text for any comment whose @@id@@ marker didn't survive
 *  translation, so nothing silently disappears. */
function TranslatedCommentRow({ item, translated }: { item: FlatHnComment; translated?: string }) {
  const t = useT();
  const author = item.by || t("hn.comments.anonymous");
  return (
    <div
      className={item.depth > 0 ? "border-l border-border/50 pl-4" : ""}
      style={{ marginLeft: item.depth > 0 ? Math.min(item.depth, 4) * 16 : 0 }}
    >
      <div className="flex gap-2.5">
        <Avatar name={author} small={item.depth > 0} />
        <div className="min-w-0 flex-1">
          {item.depth > 0 && item.parentAuthor && (
            <p className="text-[11px] text-muted-foreground/70">{t("hn.comments.replyingTo", { name: item.parentAuthor })}</p>
          )}
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="truncate text-[13px] font-bold text-foreground">{author}</span>
          </div>
          <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{translated ?? item.text}</p>
          {item.replyCount > 0 && (
            <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] font-medium text-muted-foreground">
              <ReplyIcon className="w-3.5 h-3.5" />
              {t("hn.comments.replyCount", { n: item.replyCount })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** The actual translation UI — reused by TranslateModal (as a popup) and ArticleReader's
 *  inline split view. Article and comments translate concurrently and independently
 *  (own retry, own collapse); comments are translated per-comment (not flattened into
 *  one blob) so the translated view keeps the same structure as the live thread —
 *  author, depth, "replying to X", reply counts — via @@id@@ markers the model is asked
 *  to preserve (see providers/base.ts). The actual translation lives in translateStore,
 *  keyed by the text being translated, so it keeps running (and stays cached) independent
 *  of whether this component is even mounted. */
export function TranslationPane({ articleText, hnItemId, collapsible = false }: Props) {
  const t = useT();
  const hasHn = hnItemId != null;
  const cachedComments = useHnCommentsStore((s) => (hasHn ? s.byStoryId[hnItemId!] : undefined));
  const [commentsFetchError, setCommentsFetchError] = useState(false);
  const [articleCollapsed, setArticleCollapsed] = useState(false);
  const [commentsCollapsed, setCommentsCollapsed] = useState(false);

  useEffect(() => {
    if (!hasHn) return;
    setCommentsFetchError(false);
    useHnCommentsStore
      .getState()
      .fetch(hnItemId!)
      .catch(() => setCommentsFetchError(true));
  }, [hasHn, hnItemId]);

  // The full thread, uncapped — the pane must mirror the live comment list
  // exactly (same comments, same order), with untranslated tails falling back
  // to their original text, rather than silently showing only a prefix that
  // stops corresponding to what's on the left.
  const flatComments = cachedComments ? flattenHnCommentsStructured(cachedComments, Infinity) : [];
  // Once the thread is fetched (or confirmed empty/failed), commentsText is stable —
  // undefined until then, so the translate job doesn't start prematurely without it.
  const commentsReady = !hasHn || cachedComments !== undefined || commentsFetchError;
  // Only what's sent to the model is capped (dropping whole trailing comments,
  // never splitting one) — translateStore's retry ladder still shrinks further
  // for small-context local models.
  const fullBatch = flatComments.length ? serializeCommentsForTranslation(flatComments) : undefined;
  const commentsText = fullBatch ? truncateMarkedBatch(fullBatch, TRANSLATE_COMMENTS_MAX_CHARS) : undefined;
  const commentsPreTruncated = Boolean(fullBatch && commentsText && commentsText.length < fullBatch.length);

  const key = `${articleText} ${commentsText ?? ""}`;
  const start = useTranslateStore((s) => s.start);
  const retry = useTranslateStore((s) => s.retry);
  const job = useTranslateStore((s) => s.jobs[key]);

  useEffect(() => {
    if (!articleText || !commentsReady) return;
    start(key, { articleText, commentsText });
  }, [key, articleText, commentsText, commentsReady, start]);

  const articleTranslation = job?.articleTranslation ?? "";
  const articleStatus = job?.articleStatus ?? "loading";
  const articleError = job?.articleError ?? "";
  const articleTruncated = job?.articleTruncated ?? false;
  const commentsStatus = job?.commentsStatus ?? "loading";
  const commentsError = job?.commentsError ?? "";
  const commentsTruncated = job?.commentsTruncated ?? false;
  const translatedById = job?.commentsTranslation ? parseTranslatedComments(job.commentsTranslation) : undefined;

  return (
    <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
      <Section
        title={t("reading.translate.article")}
        onRetry={() => retry(key, { articleText, commentsText })}
        retrying={articleStatus === "loading"}
        collapsible={collapsible}
        collapsed={collapsible && articleCollapsed}
        onToggleCollapse={() => setArticleCollapsed((v) => !v)}
      >
        {articleStatus === "loading" && !articleTranslation && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="h-4 w-4 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
            {t("reading.translate.loading")}
          </div>
        )}
        {articleStatus === "no-provider" && <p className="text-xs text-destructive">{t("reading.translate.noProvider")}</p>}
        {articleStatus === "error" && (
          <div className="space-y-1">
            <p className="text-xs text-destructive">{t("reading.translate.error")}</p>
            {articleError && <p className="text-[11px] font-mono text-muted-foreground/70 break-all">{articleError}</p>}
          </div>
        )}
        {articleTranslation && (
          <div className="text-sm leading-relaxed text-foreground">
            <Markdown text={articleTranslation} />
          </div>
        )}
        {articleStatus === "ready" && articleTruncated && (
          <p className="text-[11px] text-muted-foreground/70">{t("reading.translate.truncated")}</p>
        )}
      </Section>

      {hasHn && (
        <Section
          title={t("reading.translate.comments")}
          onRetry={commentsReady ? () => retry(key, { articleText, commentsText }) : undefined}
          retrying={commentsStatus === "loading"}
          collapsible={collapsible}
          collapsed={collapsible && commentsCollapsed}
          onToggleCollapse={() => setCommentsCollapsed((v) => !v)}
          badges={
            cachedComments && cachedComments.length > 0 ? (
              <div className="flex items-center gap-1.5">
                <StatBadge icon={<ReplyIcon className="w-3 h-3" />} className="text-muted-foreground">
                  {countHnComments(cachedComments)}
                </StatBadge>
                <StatBadge icon={<PeopleIcon className="w-3 h-3" />} className="text-muted-foreground">
                  {countHnCommentAuthors(cachedComments)}
                </StatBadge>
              </div>
            ) : undefined
          }
        >
          {!commentsReady && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="h-4 w-4 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
              {t("hn.comments.loading")}
            </div>
          )}
          {commentsReady && commentsFetchError && (
            <p className="text-xs text-muted-foreground">{t("hn.comments.error")}</p>
          )}
          {commentsReady && !commentsFetchError && flatComments.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("hn.comments.empty")}</p>
          )}

          {flatComments.length > 0 && commentsStatus === "loading" && !translatedById && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="h-4 w-4 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
              {t("reading.translate.loading")}
            </div>
          )}
          {commentsStatus === "no-provider" && <p className="text-xs text-destructive">{t("reading.translate.noProvider")}</p>}
          {commentsStatus === "error" && !translatedById && (
            <div className="space-y-1">
              <p className="text-xs text-destructive">{t("reading.translate.error")}</p>
              {commentsError && <p className="text-[11px] font-mono text-muted-foreground/70 break-all">{commentsError}</p>}
            </div>
          )}

          {flatComments.map((item) => (
            <TranslatedCommentRow key={item.id} item={item} translated={translatedById?.get(item.id)} />
          ))}
          {commentsStatus === "ready" && (commentsTruncated || commentsPreTruncated) && (
            <p className="text-[11px] text-muted-foreground/70">{t("reading.translate.truncated")}</p>
          )}
        </Section>
      )}
    </div>
  );
}
