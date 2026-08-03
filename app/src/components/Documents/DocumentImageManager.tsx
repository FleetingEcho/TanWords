import React, { useState } from "react";
import { Archive, FolderDown, Grid2X2, Image as ImageIcon, List, RefreshCw, Trash2, X } from "lucide-react";
import { AssetDropzone } from "@/components/shared/AssetDropzone";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DocumentPasswordDialog } from "./DocumentPasswordDialog";
import { AssetPreview, formatBytes, type AssetKind } from "./documentImageManagerHelpers";
import { DocumentAssetGrid } from "./DocumentAssetGrid";
import { useDocumentAssetManager } from "./hooks/useDocumentAssetManager";

export function DocumentImageManager({ writable }: { writable: boolean }) {
  const state = useDocumentAssetManager();
  const {
    t, assets, loading, deleteTarget, setDeleteTarget, deleting, cleaning, refreshing,
    previewTarget, setPreviewTarget, selectMode, setSelectMode, selectedIds, setSelectedIds,
    confirmBulkDelete, setConfirmBulkDelete, bulkBusy, page, setPage, view, changeView,
    pageSize, setPageSize, kindFilter, setKindFilter, query, setQuery,
    passwordRequest, finishPasswordRequest,
    totalSize, filteredAssets, orphanCount, totalPages,
    refresh, exportSelectedToFolder, exportSelectedZip, confirmDelete, cleanOrphans, deleteSelected,
    uploading, uploadProgress, uploadFiles,
  } = state;
  // Counter, not a boolean: dragging over a child fires dragleave on the
  // parent, so a boolean flickers the overlay off mid-drag.
  const [dragDepth, setDragDepth] = useState(0);
  const dragging = dragDepth > 0;

  const acceptDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragDepth(0);
    if (!writable) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) void uploadFiles(files);
  };

  return (
    <div
      className="relative flex h-full flex-col bg-background"
      onDragEnter={(event) => { event.preventDefault(); setDragDepth((depth) => depth + 1); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragDepth((depth) => Math.max(0, depth - 1))}
      onDrop={acceptDrop}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border py-4 pl-4 pr-12 lg:pl-6 lg:pr-14">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t("settings.documentImages")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("settings.documentImagesSummary", { n: assets.length, size: formatBytes(totalSize) })}
          </p>
          <p className="mt-1 hidden text-[11px] text-muted-foreground/75 lg:block">
            {t("settings.documentImagesDatabaseOnly")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {orphanCount > 0 && (
            <Button
              variant="outline"
              disabled={!writable || cleaning}
              onClick={() => void cleanOrphans()}
              className="h-8 rounded-lg px-3 text-xs"
            >
              {cleaning ? t("settings.documentImagesCleaning") : t("settings.documentImagesClean", { n: orphanCount })}
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => void refresh()} disabled={refreshing}
            className="h-8 w-8 text-muted-foreground" title={t("settings.documentImagesRefresh")}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
          <div className="flex rounded-lg border border-border bg-muted/40 p-0.5">
            <Button variant="ghost" size="icon" onClick={() => changeView("grid")}
              className={`h-7 w-7 rounded-md ${view === "grid" ? "bg-background text-primary shadow-xs" : "text-muted-foreground"}`}
              title={t("settings.documentImagesGrid")} aria-label={t("settings.documentImagesGrid")}>
              <Grid2X2 className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => changeView("list")}
              className={`h-7 w-7 rounded-md ${view === "list" ? "bg-background text-primary shadow-xs" : "text-muted-foreground"}`}
              title={t("settings.documentImagesList")} aria-label={t("settings.documentImagesList")}>
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {writable && (
        <div className="shrink-0 px-4 pb-3 pt-3 lg:px-6">
          <AssetDropzone onFiles={uploadFiles} busy={uploading} progress={uploadProgress} dragActive={dragging} />
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2 border-b border-border px-6 py-2.5">
        <input
          value={query}
          onChange={(event) => { setQuery(event.target.value); setPage(0); }}
          placeholder={t("settings.documentAssetsSearch")}
          className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-xs outline-hidden focus:ring-2 focus:ring-primary/30"
        />
        <Select
          value={kindFilter}
          onValueChange={(value) => { setKindFilter(value as AssetKind | "all"); setPage(0); }}
        >
          <SelectTrigger className="h-8 w-auto min-w-28 rounded-lg px-2 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["all", "image", "pdf", "audio", "video", "archive", "other"] as const).map((kind) => (
              <SelectItem key={kind} value={kind}>{t(`settings.documentAssetsKind_${kind}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectMode && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-6 py-2">
          <Checkbox
            checked={selectedIds.size === assets.filter((asset) => !asset.protected || asset.unlocked).length && assets.length > 0}
            onCheckedChange={() => setSelectedIds(
              selectedIds.size ? new Set() : new Set(assets.filter((asset) => !asset.protected || asset.unlocked).map((asset) => asset.id))
            )}
          />
          <span className="text-xs font-medium text-muted-foreground">
            {t("settings.documentImagesSelected", { n: selectedIds.size })}
          </span>
          <span className="text-[10px] text-muted-foreground/70">{t("settings.documentImagesDoubleClickExit")}</span>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" onClick={() => void exportSelectedToFolder()} disabled={!selectedIds.size || bulkBusy}
              className="h-8 gap-1.5 px-2.5 text-xs" title={t("settings.documentImagesExportFolder")}>
              <FolderDown className="h-4 w-4" /> {t("settings.documentImagesExportFolder")}
            </Button>
            <Button variant="ghost" onClick={() => void exportSelectedZip()} disabled={!selectedIds.size || bulkBusy}
              className="h-8 gap-1.5 px-2.5 text-xs" title={t("settings.documentImagesExportZip")}>
              <Archive className="h-4 w-4" /> ZIP
            </Button>
            <Button variant="ghost" onClick={() => setConfirmBulkDelete(true)} disabled={!selectedIds.size || !writable || bulkBusy}
              className="h-8 gap-1.5 px-2.5 text-xs text-destructive">
              <Trash2 className="h-4 w-4" /> {t("common.delete")}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }}
              className="h-8 w-8 text-muted-foreground">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex h-28 items-center justify-center">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        </div>
      ) : filteredAssets.length === 0 ? (
        <div className="flex h-28 flex-col items-center justify-center gap-2 text-muted-foreground">
          <ImageIcon className="h-7 w-7 opacity-35" />
          <p className="text-xs">{t("settings.documentImagesEmpty")}</p>
        </div>
      ) : (
        <DocumentAssetGrid state={state} writable={writable} />
      )}

      {filteredAssets.length > 0 && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-6 py-2">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{t("vocab.perPage")}</span>
            <Select value={String(pageSize)} onValueChange={(value) => {
              const size = Number(value);
              localStorage.setItem("tanwords_document_images_page_size", String(size));
              setPageSize(size);
              setPage(0);
            }}>
              <SelectTrigger className="h-7 w-16 rounded-md px-1.5 text-xs" aria-label={t("vocab.perPage")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 20, 50, 100].map((size) => (
                  <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="flex items-center gap-1">
            <Button variant="ghost" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}
              className="h-7 w-7 p-0 text-muted-foreground disabled:opacity-30">‹</Button>
            <span className="text-[11px] text-muted-foreground">
              {page * pageSize + 1}–{Math.min((page + 1) * pageSize, filteredAssets.length)} / {filteredAssets.length}
            </span>
            <Button variant="ghost" disabled={(page + 1) * pageSize >= filteredAssets.length}
              onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
              className="h-7 w-7 p-0 text-muted-foreground disabled:opacity-30">›</Button>
          </div>
        </div>
      )}

      <AssetPreview asset={previewTarget} onClose={() => setPreviewTarget(null)} />
      <ConfirmModal
        open={deleteTarget !== null}
        title={t("settings.documentImageDeleteTitle")}
        message={deleteTarget?.referenced
          ? t("settings.documentImageDeleteReferenced")
          : t("settings.documentImageDeleteOrphan")}
        confirmLabel={deleting ? t("settings.documentImageDeleting") : t("common.delete")}
        confirmDisabled={deleting}
        onCancel={() => !deleting && setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
      <ConfirmModal
        open={confirmBulkDelete}
        title={t("settings.documentImagesBulkDeleteTitle")}
        message={t("settings.documentImagesBulkDeleteMessage", { n: selectedIds.size })}
        confirmLabel={bulkBusy ? t("settings.documentImageDeleting") : t("common.delete")}
        confirmDisabled={bulkBusy}
        onCancel={() => !bulkBusy && setConfirmBulkDelete(false)}
        onConfirm={() => void deleteSelected()}
      />
      <DocumentPasswordDialog
        request={passwordRequest}
        onCancel={() => finishPasswordRequest(null)}
        onSubmit={(password) => finishPasswordRequest(password)}
      />
    </div>
  );
}
