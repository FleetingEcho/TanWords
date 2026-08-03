import { useEffect, useState } from "react";
import { File, FileArchive, FileAudio, FileText, FileVideo, Image as ImageIcon, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlayIcon } from "@/components/ui/icons";
import { usePodcastPlayerStore } from "@/store/podcastPlayerStore";
import { useT } from "@/hooks/useT";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { CloseIcon } from "@/components/ui/icons";
import { resolveDocumentAssetUrl, type DocumentAssetSummary } from "@/lib/documentAssets";
import { formatBytes } from "@/lib/formatBytes";

export { formatBytes } from "@/lib/formatBytes";

export type AssetKind = "image" | "pdf" | "audio" | "video" | "archive" | "other";

export function assetKind(asset: Pick<DocumentAssetSummary, "mime_type" | "file_name">): AssetKind {
  if (asset.mime_type.startsWith("image/")) return "image";
  if (asset.mime_type === "application/pdf") return "pdf";
  if (asset.mime_type.startsWith("audio/")) return "audio";
  if (asset.mime_type.startsWith("video/")) return "video";
  // Extension fallback: a drag-and-drop from Finder often arrives with an
  // empty or application/octet-stream type, and without this an .mkv or a
  // .flac would render as a generic file icon instead of a player.
  if (/\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|wma)$/i.test(asset.file_name)) return "audio";
  if (/\.(mp4|m4v|mov|mkv|webm|avi|wmv|flv|mpg|mpeg)$/i.test(asset.file_name)) return "video";
  if (/\.pdf$/i.test(asset.file_name)) return "pdf";
  if (/\.(png|jpe?g|gif|webp|bmp|svg|avif|heic)$/i.test(asset.file_name)) return "image";
  if (/(\.zip|\.gz|\.gzip|\.tar|\.tgz|\.bz2|\.7z)$/i.test(asset.file_name)
    || /(zip|gzip|compressed|archive)/i.test(asset.mime_type)) return "archive";
  return "other";
}

export function KindIcon({ kind, className = "h-7 w-7" }: { kind: AssetKind; className?: string }) {
  if (kind === "image") return <ImageIcon className={className} />;
  if (kind === "pdf") return <FileText className={className} />;
  if (kind === "audio") return <FileAudio className={className} />;
  if (kind === "video") return <FileVideo className={className} />;
  if (kind === "archive") return <FileArchive className={className} />;
  return <File className={className} />;
}

export function AssetThumbnail({ asset }: { asset: DocumentAssetSummary }) {
  const [url, setUrl] = useState("");
  const kind = assetKind(asset);
  useEffect(() => {
    if (asset.protected && !asset.unlocked) return;
    if (kind !== "image") return;
    let active = true;
    resolveDocumentAssetUrl(`tanwords-asset://${asset.id}`)
      .then((resolved) => { if (active) setUrl(resolved); })
      .catch(() => {});
    return () => { active = false; };
  }, [asset.id, asset.protected, asset.unlocked, kind]);
  if (asset.protected && !asset.unlocked) {
    return <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground"><LockKeyhole className="h-7 w-7" /></div>;
  }
  if (kind === "image" && url) return <img src={url} alt={asset.file_name} className="h-full w-full object-cover" />;
  return <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground/45"><KindIcon kind={kind} /></div>;
}

export function AssetPreview({ asset, onClose }: { asset: DocumentAssetSummary | null; onClose: () => void }) {
  const t = useT();
  const [url, setUrl] = useState("");
  const kind = asset ? assetKind(asset) : "other";
  useEffect(() => {
    let active = true;
    setUrl("");
    if (asset) {
      resolveDocumentAssetUrl(`tanwords-asset://${asset.id}`)
        .then((resolved) => { if (active) setUrl(resolved); })
        .catch(() => {});
    }
    return () => { active = false; };
  }, [asset]);
  return (
    <Dialog open={asset !== null} onClose={onClose} maxWidth="max-w-[min(92vw,1200px)]" className="top-[4vh] overflow-hidden">
      <DialogTitle className="sr-only">{asset?.file_name ?? ""}</DialogTitle>
      <Button variant="ghost" size="icon" onClick={onClose}
        className="absolute right-3 top-3 z-10 h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm">
        <CloseIcon className="h-4 w-4" />
      </Button>
      <div className="flex max-h-[82vh] min-h-64 items-center justify-center bg-black/20 p-5">
        {url && kind === "image" ? <img src={url} alt={asset?.file_name ?? ""} className="max-h-[76vh] max-w-full object-contain" />
          : url && kind === "video" ? <video src={url} controls className="max-h-[76vh] max-w-full" />
          : url && kind === "audio" ? <audio src={url} controls className="w-full max-w-xl" />
          : url && kind === "pdf" ? <iframe src={url} title={asset?.file_name} className="h-[72vh] w-full rounded-lg bg-white" />
          : url ? <div className="flex flex-col items-center gap-3 text-muted-foreground"><KindIcon kind={kind} className="h-14 w-14" /><span>{asset?.mime_type}</span></div>
          : (
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        )}
      </div>
      {asset && (
        <div className="flex items-center gap-3 border-t border-border px-5 py-3">
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{asset.file_name}</p>
          {kind === "audio" && url && (
            // Hands the file to the persistent bar so it keeps playing after
            // this dialog closes — the inline <audio> dies with the modal.
            <Button
              variant="ghost"
              onClick={() => {
                usePodcastPlayerStore.getState().play({
                  audioUrl: url,
                  title: asset.file_name,
                  feedTitle: t("settings.documentAssetsStandalone"),
                });
                onClose();
              }}
              className="h-8 shrink-0 gap-1.5 rounded-lg px-3 text-xs font-medium text-primary hover:bg-primary/10"
            >
              <PlayIcon className="h-3.5 w-3.5" />
              {t("settings.documentAssetsPlayInPlayer")}
            </Button>
          )}
          <span className="truncate text-xs text-muted-foreground">{asset.standalone ? "\u2014" : asset.document_title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(asset.size)}</span>
        </div>
      )}
    </Dialog>
  );
}
