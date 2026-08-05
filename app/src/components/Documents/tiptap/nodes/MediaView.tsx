/**
 * Renderers for the four media blocks — image, video, audio, file.
 *
 * BlockNote supplied all four; Tiptap ships only `image`, so these are ours
 * (plan.md §4b). Each resolves its own URL through `useResolvedAssetUrl`
 * because Tiptap has no central `resolveFileUrl` hook.
 *
 * The node's `url` attr always stays `tanwords-asset://<id>` — see the warning
 * in `useResolvedAssetUrl`, which the autosave prune step depends on.
 */
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Download, FileIcon, ImageOff } from "lucide-react";
import { useT } from "@/hooks/useT";
import { useResolvedAssetUrl, type ResolvedAsset } from "../useResolvedAssetUrl";
import { pendingPreviewUrl } from "../pendingUploads";

/**
 * The asset to render, preferring the local preview while an upload is still
 * in flight. A pasted image is on screen before it exists server-side, which
 * is what makes a multi-second R2 upload feel instant instead of frozen.
 */
function useMediaSource(node: { attrs: Record<string, unknown> }): ResolvedAsset {
  const url = node.attrs.url as string | undefined;
  const preview = pendingPreviewUrl(node.attrs.uploadId as string | null);
  const resolved = useResolvedAssetUrl(url);
  if (preview) return { url: preview, loading: false, error: false };
  return resolved;
}

function Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
  );
}

function Shell({ selected, children }: { selected: boolean; children: React.ReactNode }) {
  return (
    <NodeViewWrapper
      className={`my-1 ${selected ? "rounded-lg ring-2 ring-primary/40" : ""}`}
      data-media-block=""
    >
      {children}
    </NodeViewWrapper>
  );
}

function Broken({ name }: { name?: string }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <ImageOff className="h-3.5 w-3.5" />
      {name || t("doc.attachmentUnavailable")}
    </span>
  );
}

export function ImageView({ node, selected }: NodeViewProps) {
  const { name, caption, previewWidth } = node.attrs as Record<string, string>;
  const asset = useMediaSource(node);
  return (
    <Shell selected={selected}>
      {asset.loading && <Spinner />}
      {asset.error && <Broken name={name} />}
      {!asset.loading && !asset.error && (
        <figure className="m-0">
          <img
            src={asset.url}
            alt={name || caption || ""}
            style={previewWidth ? { width: `${previewWidth}px` } : undefined}
            className="max-w-full rounded-lg"
          />
          {caption && (
            <figcaption className="mt-1 text-xs text-muted-foreground">{caption}</figcaption>
          )}
        </figure>
      )}
    </Shell>
  );
}

export function VideoView({ node, selected }: NodeViewProps) {
  const { name, caption } = node.attrs as Record<string, string>;
  const asset = useMediaSource(node);
  return (
    <Shell selected={selected}>
      {asset.loading && <Spinner />}
      {asset.error && <Broken name={name} />}
      {!asset.loading && !asset.error && (
        <figure className="m-0">
          {/* src, never a blob: resolveDocumentAssetUrl hands back the R2
              presigned URL directly so seeking works without downloading the
              whole file first. */}
          <video src={asset.url} controls preload="metadata" className="max-w-full rounded-lg" />
          {caption && (
            <figcaption className="mt-1 text-xs text-muted-foreground">{caption}</figcaption>
          )}
        </figure>
      )}
    </Shell>
  );
}

export function AudioView({ node, selected }: NodeViewProps) {
  const { name } = node.attrs as Record<string, string>;
  const asset = useMediaSource(node);
  return (
    <Shell selected={selected}>
      {asset.loading && <Spinner />}
      {asset.error && <Broken name={name} />}
      {!asset.loading && !asset.error && (
        <audio src={asset.url} controls preload="metadata" className="w-full" />
      )}
    </Shell>
  );
}

export function FileView({ node, selected }: NodeViewProps) {
  const { name } = node.attrs as Record<string, string>;
  const asset = useMediaSource(node);
  return (
    <Shell selected={selected}>
      <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2 text-sm">
        <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{name || "attachment"}</span>
        {asset.loading ? <Spinner /> : asset.error ? null : (
          <a
            href={asset.url}
            download={name || undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
          </a>
        )}
      </span>
    </Shell>
  );
}
