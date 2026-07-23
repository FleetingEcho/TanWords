import React, { useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import { relativeTime, placeholderGradient } from "@/components/Feeds/feedUtils";
import { ReplyIcon, PeopleIcon } from "@/components/ui/icons";
import { StatBadge } from "@/components/ui/StatBadge";
import { fetchHnComments, type HnComment } from "@/lib/hnComments";

function countComments(comments: HnComment[]): number {
  return comments.reduce((n, c) => n + 1 + countComments(c.children), 0);
}

/** Unique commenters — HN's APIs don't expose this directly, but we already
 *  fetch every node in the tree to render it, so it's free to derive. */
function countUniqueAuthors(comments: HnComment[], seen: Set<string> = new Set()): number {
  for (const c of comments) {
    if (c.by) seen.add(c.by);
    countUniqueAuthors(c.children, seen);
  }
  return seen.size;
}

/** Replies use a slightly smaller avatar — frees up room in the indented gutter and reinforces the hierarchy. */
function Avatar({ name, small }: { name: string; small?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`flex ${small ? "h-7 w-7 text-[11px]" : "h-8 w-8 text-xs"} shrink-0 items-center justify-center rounded-full font-bold text-white/90 select-none`}
      style={{ background: placeholderGradient(name) }}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function CommentNode({ comment, depth, parentAuthor }: { comment: HnComment; depth: number; parentAuthor?: string }) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  const replyCount = countComments(comment.children);
  const author = comment.by || t("hn.comments.anonymous");

  return (
    <div className={depth > 0 ? "mt-3 border-l border-border/50 pl-4" : "mt-5"}>
      <div className="flex gap-2.5">
        <Avatar name={author} small={depth > 0} />
        <div className="min-w-0 flex-1">
          {depth > 0 && parentAuthor && (
            <p className="text-[11px] text-muted-foreground/70">
              {t("hn.comments.replyingTo", { name: parentAuthor })}
            </p>
          )}
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-[13px] font-bold text-foreground truncate">{author}</span>
            {comment.time !== null && (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                · {relativeTime(new Date(comment.time * 1000).toISOString())}
              </span>
            )}
          </div>

          <div
            className="reader-article-content mt-0.5 text-[14px] leading-normal text-foreground"
            dangerouslySetInnerHTML={{ __html: comment.text }}
          />

          {replyCount > 0 && (
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="mt-1.5 -ml-2 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
            >
              <ReplyIcon className="w-3.5 h-3.5" />
              {t("hn.comments.replyCount", { n: replyCount })}
            </button>
          )}
        </div>
      </div>

      {!collapsed &&
        comment.children.map((child) => (
          <CommentNode key={child.id} comment={child} depth={depth + 1} parentAuthor={author} />
        ))}
    </div>
  );
}

/** Threaded HN discussion, fetched on demand from the Firebase item API and rendered below the article.
 *  `onLoaded` reports the fetched tree up to the parent (e.g. so "Learn" can analyze it too) without
 *  the parent needing to fetch it a second time. */
export function HnComments({ storyId, onLoaded }: { storyId: number; onLoaded?: (comments: HnComment[]) => void }) {
  const t = useT();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [comments, setComments] = useState<HnComment[]>([]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setComments([]);
    fetchHnComments(storyId)
      .then((c) => {
        if (cancelled) return;
        setComments(c);
        setStatus("ready");
        onLoaded?.(c);
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onLoaded is a fresh closure every render; keying only on storyId avoids refetching when the parent re-renders.
  }, [storyId]);

  return (
    <div className="mt-10 border-t border-border pt-6">
      <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[.18em] text-muted-foreground">
        <ReplyIcon className="w-3.5 h-3.5" />
        {t("hn.comments.title")}
      </h2>
      {status === "ready" && comments.length > 0 && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <StatBadge icon={<ReplyIcon className="w-3 h-3" />} className="text-muted-foreground">
            {countComments(comments)}
          </StatBadge>
          <StatBadge icon={<PeopleIcon className="w-3 h-3" />} className="text-muted-foreground">
            {countUniqueAuthors(comments)}
          </StatBadge>
        </div>
      )}

      {status === "loading" && (
        <div className="mt-4 flex items-center gap-2">
          <div className="w-4 h-4 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
          <span className="text-xs text-muted-foreground">{t("hn.comments.loading")}</span>
        </div>
      )}

      {status === "error" && (
        <p className="mt-3 text-xs text-muted-foreground">{t("hn.comments.error")}</p>
      )}

      {status === "ready" && comments.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">{t("hn.comments.empty")}</p>
      )}

      {status === "ready" && comments.length > 0 && (
        <div>
          {comments.map((c) => (
            <CommentNode key={c.id} comment={c} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}
