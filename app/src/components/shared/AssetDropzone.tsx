import React, { useRef, useState } from "react";
import { FileIcon, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { formatBytes } from "@/lib/formatBytes";
import { useT } from "@/hooks/useT";

/** Mirrors MAX_ASSET_BYTES in lib/documentAssets — used here only to flag
 *  doomed files in the confirm list before the upload rejects them. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

interface Props {
  /** Receives the picked/dropped files. The caller owns the upload so it can
   *  refresh whatever list it is showing afterwards. */
  onFiles: (files: File[]) => void;
  busy?: boolean;
  /** Rendered instead of the idle prompt while `busy`. */
  progress?: { index: number; total: number; fileName: string; sent: number; bytes: number } | null;
  disabled?: boolean;
  /** `panel` — a plain dashed box that fills its container (asset manager).
   *  `card` — a single elevated row that sits among dashboard cards. */
  variant?: "panel" | "card";
  /** Lets a surrounding drop target (e.g. a whole modal) light this up while
   *  a drag is anywhere over it, not just over the box itself. */
  dragActive?: boolean;
  className?: string;
}

export function AssetDropzone({
  onFiles, busy = false, progress = null, disabled = false, variant = "panel", dragActive = false, className = "",
}: Props) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  // Counter, not a boolean: dragging over a child fires dragleave on the
  // parent, so a boolean flickers the highlight off mid-drag.
  const [depth, setDepth] = useState(0);
  const hot = dragActive || depth > 0;
  // Picked but not yet sent: a stray drop shouldn't silently write files into
  // the library, so everything goes through a confirm step first.
  const [pending, setPending] = useState<File[]>([]);

  const pick = (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (list.length) setPending(list);
  };

  const confirmUpload = () => {
    const files = pending;
    setPending([]);
    onFiles(files);
  };

  const oversize = pending.filter((file) => file.size > MAX_UPLOAD_BYTES);
  const totalBytes = pending.reduce((sum, file) => sum + file.size, 0);

  const card = variant === "card";

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => { pick(event.target.files); event.target.value = ""; }}
      />
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => { event.preventDefault(); setDepth((d) => d + 1); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDepth((d) => Math.max(0, d - 1))}
        onDrop={(event) => {
          event.preventDefault();
          setDepth(0);
          if (!disabled && !busy) pick(event.dataTransfer?.files ?? null);
        }}
        className={`group w-full rounded-2xl border-2 border-dashed text-left transition-colors disabled:opacity-60 ${
          card ? "flex items-center gap-4 px-5 py-4" : "flex flex-col items-center justify-center gap-1.5 px-4 py-6"
        } ${
          hot
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/30"
        } ${className}`}
      >
        <span
          className={`grid shrink-0 place-items-center rounded-xl transition-colors ${
            card ? "h-11 w-11" : "h-9 w-9"
          } ${hot ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground group-hover:text-primary"}`}
        >
          {busy ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
          ) : (
            <UploadCloud className={card ? "h-5 w-5" : "h-4 w-4"} />
          )}
        </span>

        <span className={card ? "min-w-0 flex-1" : "contents"}>
          <span className={`block text-xs ${card ? "text-sm font-medium text-foreground" : "text-muted-foreground"}`}>
            {busy ? (
              progress
                ? `${progress.total > 1 ? `${progress.index}/${progress.total} · ` : ""}${progress.fileName}`
                : t("settings.documentAssetsUploading")
            ) : (
              <>
                {t("settings.documentAssetsDropzone")}{" "}
                <span className="text-primary underline underline-offset-2">
                  {t("settings.documentAssetsBrowse")}
                </span>
              </>
            )}
          </span>
          {busy && progress ? (
            <>
              <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progress.bytes ? Math.min(100, (progress.sent / progress.bytes) * 100) : 0}%` }}
                />
              </span>
              <span className="mt-0.5 block text-[10px] tabular-nums text-muted-foreground/70">
                {formatBytes(progress.sent)} / {formatBytes(progress.bytes)}
              </span>
            </>
          ) : (
            <span className="mt-0.5 block text-[10px] text-muted-foreground/70">
              {t("settings.documentAssetsDropHint")}
            </span>
          )}
        </span>
      </button>

      <Dialog open={pending.length > 0} onClose={() => setPending([])} maxWidth="max-w-md">
        <div className="border-b border-border px-5 py-4">
          <DialogTitle className="text-sm font-semibold">
            {t("settings.documentAssetsConfirmTitle", { n: pending.length })}
          </DialogTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("settings.documentAssetsConfirmTotal", { size: formatBytes(totalBytes) })}
          </p>
        </div>

        <div className="max-h-64 overflow-y-auto p-2">
          {pending.map((file, index) => {
            const tooBig = file.size > MAX_UPLOAD_BYTES;
            return (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2"
              >
                <FileIcon className={`h-4 w-4 shrink-0 ${tooBig ? "text-destructive" : "text-muted-foreground"}`} />
                <span className="min-w-0 flex-1 truncate text-xs" title={file.name}>{file.name}</span>
                <span className={`shrink-0 text-[11px] tabular-nums ${tooBig ? "text-destructive" : "text-muted-foreground"}`}>
                  {formatBytes(file.size)}
                </span>
              </div>
            );
          })}
        </div>

        {oversize.length > 0 && (
          <p className="px-5 pb-2 text-[11px] text-destructive">
            {t("settings.documentAssetsConfirmOversize", { n: oversize.length })}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button
            variant="ghost"
            onClick={() => setPending([])}
            className="h-8 rounded-lg px-4 text-xs font-medium text-muted-foreground"
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="ghost"
            onClick={confirmUpload}
            disabled={oversize.length === pending.length}
            className="h-8 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {t("settings.documentAssetsConfirmUpload")}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
