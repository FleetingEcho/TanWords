/**
 * YouTube embed block.
 *
 * A built-in `video` block renders `<video src>`, which cannot play a
 * YouTube watch page — that needs an iframe. Storage/markdown format stays a
 * plain link (`[title](https://youtu.be/…)`), converted around load/save by
 * liftYouTube / lowerYouTube, so a document opened anywhere else is still a
 * readable markdown link rather than a custom blob.
 */
import { useState } from "react";
import { PlaySquare } from "lucide-react";
import { useT } from "@/hooks/useT";
import { isYouTubeUrl, youTubeId } from "./youtubeUrl";

export function YouTubeView({ url, caption, onChange }: { url: string; caption: string; onChange: (url: string) => void }) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const id = url ? youTubeId(url) : null;

  if (!id) {
    return (
      <div contentEditable={false} draggable={false} className="my-2 w-full min-w-0 rounded-xl border border-dashed border-border p-4">
        <label className="flex items-center gap-2">
          <PlaySquare className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (isYouTubeUrl(draft.trim())) onChange(draft.trim());
            }}
            onBlur={() => { if (isYouTubeUrl(draft.trim())) onChange(draft.trim()); }}
            placeholder={t("doc.youtubePlaceholder")}
            className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-xs outline-hidden focus:ring-2 focus:ring-primary/30"
          />
        </label>
        {draft.trim() !== "" && !isYouTubeUrl(draft.trim()) && (
          <p className="mt-1.5 pl-6 text-[11px] text-destructive">{t("doc.youtubeInvalid")}</p>
        )}
      </div>
    );
  }

  return (
    // contentEditable={false} is load-bearing, not a nicety: a `content: "none"`
    // block still renders inside ProseMirror's contenteditable, and ProseMirror
    // reconciles that DOM against its own document — an iframe it does not know
    // about gets swept away, leaving an empty block with only the player
    // controls floating in it. Every built-in media block
    // sets contentEditable/draggable false for the same reason, as does the
    // mermaid block next door.
    // `w-full` on this element, not just inside it: the block content wrapper
    // is a flex container, so this div is a flex item and defaults to
    // shrink-to-fit. An iframe contributes no intrinsic width, which left the
    // player as wide as its caption text and no wider — a long title made a
    // big video and an empty one made it vanish. Every built-in media block in
    // carries the same explicit width for the same reason.
    <div
      contentEditable={false}
      draggable={false}
      className="my-2 w-full min-w-0 overflow-hidden rounded-xl border border-border bg-black"
    >
      <div className="relative aspect-video w-full">
        <iframe
          // nocookie host: no tracking cookie unless the video is actually
          // played, which matters for a notes app that is otherwise local.
          src={`https://www.youtube-nocookie.com/embed/${id}`}
          title="YouTube"
          className="absolute inset-0 h-full w-full"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      {/* Whatever the author titled the link. Shown because a title that is
        * stored but never displayed reads as lost — and it is the caption the
        * markdown round-trip writes back out. */}
      {caption && (
        <p className="border-t border-border bg-background px-3 py-2 text-xs break-words text-muted-foreground">
          {caption}
        </p>
      )}
    </div>
  );
}
