/**
 * YouTube embed block.
 *
 * BlockNote's built-in `video` block renders `<video src>`, which cannot play a
 * YouTube watch page — that needs an iframe. Storage/markdown format stays a
 * plain link (`[title](https://youtu.be/…)`), converted around load/save by
 * liftYouTube / lowerYouTube, so a document opened anywhere else is still a
 * readable markdown link rather than a custom blob.
 */
import { useState } from "react";
import { PlaySquare } from "lucide-react";
import { createReactBlockSpec } from "@blocknote/react";
import { useT } from "@/hooks/useT";
import { isYouTubeUrl, youTubeId } from "./youtubeUrl";

function YouTubeView({ url, onChange }: { url: string; onChange: (url: string) => void }) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const id = url ? youTubeId(url) : null;

  if (!id) {
    return (
      <div className="my-2 rounded-xl border border-dashed border-border p-4">
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
    <div className="my-2 overflow-hidden rounded-xl border border-border bg-black">
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
    </div>
  );
}

export const YouTubeBlock = createReactBlockSpec(
  {
    type: "youtube" as const,
    propSchema: { url: { default: "" } },
    content: "none" as const,
  },
  {
    render: ({ block, editor }: any) => (
      <YouTubeView
        url={block.props.url}
        onChange={(url) => editor.updateBlock(block, { props: { url } })}
      />
    ),
    toExternalHTML: ({ block }: any) => (
      <p>
        <a href={block.props.url ?? ""}>{block.props.url ?? ""}</a>
      </p>
    ),
  },
);
