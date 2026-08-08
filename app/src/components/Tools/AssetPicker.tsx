import React, { useEffect, useMemo, useState } from "react";
import { Check, CheckCheck, ImageOff, Loader2, X } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import {
  listDocumentAssets,
  resolveDocumentAssetUrl,
  type DocumentAssetSummary,
} from "@/lib/documentAssets";
import { formatBytes } from "@/lib/formatBytes";

// Mirrors the Image Reducer's accepted set — keep in sync. A library image is
// pickable here only if its MIME (or, for Finder drops with an empty type, its
// extension) matches one the reducer can re-encode.
const REDUCIBLE_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/bmp"]);
const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  bmp: "image/bmp",
};

/** The MIME to use when building a File for this asset. Prefers the stored
 *  MIME (normalized jpg -> jpeg); falls back to the extension for assets that
 *  arrived with an empty / octet-stream type. Returns null if the asset
 *  isn't reducible. */
function reducibleMimeFor(asset: Pick<DocumentAssetSummary, "mime_type" | "file_name">): string | null {
  if (REDUCIBLE_MIMES.has(asset.mime_type)) {
    return asset.mime_type === "image/jpg" ? "image/jpeg" : asset.mime_type;
  }
  const ext = (asset.file_name.split(".").pop() || "").toLowerCase();
  return EXT_TO_MIME[ext] ?? null;
}

/** Fetches an asset's bytes and wraps them as a File ready for the reducer
 *  pipeline. Works on both hosts: `resolveDocumentAssetUrl` returns a fetchable
 *  URL — a blob: URL for local DB assets on desktop, a presigned R2 URL for
 *  bucket-backed assets, or `/api/assets/{id}?token=` on web. */
async function assetToFile(asset: DocumentAssetSummary): Promise<File> {
  const url = await resolveDocumentAssetUrl(`tanwords-asset://${asset.id}`);
  const blob = await (await fetch(url)).blob();
  const mime = reducibleMimeFor(asset) ?? "image/png";
  const ext = (asset.file_name.split(".").pop() || "png").toLowerCase();
  const name = asset.file_name || `image-${asset.id}.${ext}`;
  return new File([blob], name, { type: mime });
}

/** A single thumbnail. Resolves the asset URL on mount the same way the
 *  Documents asset grid does — `resolveDocumentAssetUrl` handles desktop
 *  blob/R2 and web asset routes. */
function Thumb({ asset }: { asset: DocumentAssetSummary }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    resolveDocumentAssetUrl(`tanwords-asset://${asset.id}`)
      .then((resolved) => { if (active) setUrl(resolved); })
      .catch(() => {});
    return () => { active = false; };
  }, [asset.id]);
  if (!url) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    );
  }
  return <img src={url} alt={asset.file_name} className="h-full w-full object-cover" loading="lazy" />;
}

export function AssetPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (files: File[]) => void;
}) {
  const t = useT();
  const [assets, setAssets] = useState<DocumentAssetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fetching, setFetching] = useState(false);

  // Load the library once when the picker opens, and reset the selection so a
  // reopen doesn't carry over the previous pick.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setLoading(true);
    listDocumentAssets()
      .then((all) => setAssets(all))
      .catch(() => setAssets([]))
      .finally(() => setLoading(false));
  }, [open]);

  // Only reducible images, and only ones we can actually read — a protected
  // document's attachment bytes aren't fetchable without its password, so we
  // hide locked assets rather than offer an image that fails on confirm.
  const pickable = useMemo(
    () =>
      assets.filter(
        (a) => reducibleMimeFor(a) !== null && (!a.protected || a.unlocked),
      ),
    [assets],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedAssets = pickable.filter((a) => selected.has(a.id));

  async function confirm() {
    if (!selectedAssets.length || fetching) return;
    setFetching(true);
    const files: File[] = [];
    for (const asset of selectedAssets) {
      try {
        files.push(await assetToFile(asset));
      } catch {
        // A single unreadable asset shouldn't abort the whole pick — skip it.
      }
    }
    setFetching(false);
    onPick(files);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="max-w-[min(94vw,1100px)]"
      className="top-[4vh] h-[86vh] overflow-hidden"
    >
      <DialogTitle className="sr-only">{t("toolsPage.imageReducer.pickFromLibrary")}</DialogTitle>

      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">
          {t("toolsPage.imageReducer.pickFromLibrary")}
        </p>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {selected.size > 0
            ? t("toolsPage.imageReducer.selectedCount", { n: selected.size })
            : t("toolsPage.imageReducer.pickableCount", { n: pickable.length })}
        </span>
        <Button
          size="sm"
          className="h-8"
          onClick={() => void confirm()}
          disabled={!selected.size || fetching}
        >
          {fetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCheck className="h-3.5 w-3.5" />
          )}
          <span className="ml-1.5">
            {selected.size > 0
              ? t("toolsPage.imageReducer.addSelected", { n: selected.size })
              : t("toolsPage.imageReducer.selectHint")}
          </span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8 rounded-lg text-muted-foreground"
          title={t("common.close")}
          aria-label={t("common.close")}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Body */}
      <div className="h-[calc(86vh-3.25rem)] overflow-y-auto p-4">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
          </div>
        ) : pickable.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <ImageOff className="h-8 w-8" />
            <p className="text-sm">{t("toolsPage.imageReducer.libraryEmpty")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {pickable.map((asset) => {
              const isSel = selected.has(asset.id);
              return (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => toggle(asset.id)}
                  aria-pressed={isSel}
                  title={asset.file_name}
                  className={`group relative overflow-hidden rounded-xl border bg-muted text-left transition-colors ${
                    isSel
                      ? "border-primary ring-2 ring-primary"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="aspect-square w-full">
                    <Thumb asset={asset} />
                  </div>
                  {/* Selection badge */}
                  <span
                    className={`absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border transition-colors ${
                      isSel
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-white/70 bg-black/40 text-transparent backdrop-blur-sm group-hover:bg-black/55"
                    }`}
                  >
                    <Check className="h-3 w-3" />
                  </span>
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-4">
                    <p className="truncate text-[11px] font-medium text-white">
                      {asset.file_name}
                    </p>
                    <p className="text-[10px] text-white/70">{formatBytes(asset.size)}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Dialog>
  );
}
