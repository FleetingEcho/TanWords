import { Download, Eye, LockKeyhole, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { DocumentAssetSummary } from "@/lib/documentAssets";
import { AssetThumbnail, formatBytes } from "./documentImageManagerHelpers";
import type { DocumentAssetManagerState } from "./hooks/useDocumentAssetManager";

/** The grid/list of asset cards — split out of DocumentImageManager purely
 * for size; it's a single, mostly self-contained JSX block. */
export function DocumentAssetGrid({
  state, writable,
}: {
  state: DocumentAssetManagerState;
  writable: boolean;
}) {
  const {
    t, view, visibleAssets, selectMode, selectedIds, toggleSelected,
    handleAssetClick, handleAssetDoubleClick, exportOne, setDeleteTarget,
  } = state;

  return (
    <div className={view === "grid"
      ? "grid flex-1 grid-cols-2 content-start gap-4 overflow-y-auto p-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
      : "flex flex-1 flex-col gap-1 overflow-y-auto p-4"
    }>
      {visibleAssets.map((asset) => (
        <div
          key={asset.id}
          onClick={() => handleAssetClick(asset)}
          onDoubleClick={() => handleAssetDoubleClick(asset)}
          title={selectMode ? t("settings.documentImagesDoubleClickExit") : t("settings.documentImageReview")}
          className={`${view === "grid"
            ? "group overflow-hidden rounded-xl border bg-card"
            : "group flex min-h-16 items-center gap-3 rounded-lg border px-3 py-2 hover:bg-card"
          } cursor-pointer transition-colors ${selectedIds.has(asset.id) ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border"}`}
        >
          <div className={view === "grid"
            ? "relative aspect-[4/3] overflow-hidden bg-muted"
            : "relative h-12 w-16 shrink-0 overflow-hidden rounded-md bg-muted"
          }>
            <AssetThumbnail asset={asset} />
            {!selectMode && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
                <span className="flex items-center gap-1.5 text-xs font-medium"><Eye className="h-4 w-4" />{t("settings.documentImageReview")}</span>
              </div>
            )}
            {selectMode && (
              <Checkbox checked={selectedIds.has(asset.id)} onCheckedChange={() => toggleSelected(asset.id)}
                onClick={(event) => event.stopPropagation()} className="absolute left-2 top-2 border-white bg-background/90" />
            )}
          </div>
          <div className={view === "grid" ? "space-y-1.5 p-2.5" : "flex min-w-0 flex-1 items-center gap-4"}>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 truncate text-xs font-medium" title={asset.file_name}>
                {asset.protected && <LockKeyhole className="h-3 w-3 shrink-0 text-muted-foreground" />}
                <span className="truncate">{asset.file_name}</span>
              </p>
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground" title={asset.document_title}>{asset.document_title}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="text-[10px] text-muted-foreground">{formatBytes(asset.size)}</span>
              {!asset.protected && !asset.referenced && (
                <span className="rounded bg-amber-500/10 px-1 py-px text-[9px] font-semibold text-amber-600">
                  {t("settings.documentImageOrphan")}
                </span>
              )}
              <div className="ml-1 flex items-center gap-0.5">
                <Button variant="ghost" size="icon" onClick={(event) => { event.stopPropagation(); void exportOne(asset); }} className="h-6 w-6" title={t("settings.documentImageExport")}>
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" disabled={!writable} onClick={(event) => { event.stopPropagation(); setDeleteTarget(asset); }} className="h-6 w-6 text-destructive" title={t("common.delete")}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
