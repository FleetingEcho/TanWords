import { useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Archive, Download, Eye, FolderDown, Grid2X2, Image as ImageIcon, List, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { CloseIcon } from "@/components/ui/icons";
import { useT } from "@/hooks/useT";
import {
  deleteDocumentAsset,
  deleteOrphanDocumentAssets,
  exportDocumentAsset,
  exportDocumentAssetsToFolder,
  exportDocumentAssetsZip,
  listDocumentAssets,
  resolveDocumentAssetUrl,
  type DocumentAssetSummary,
} from "@/lib/documentAssets";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function AssetThumbnail({ id, alt }: { id: string; alt: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    resolveDocumentAssetUrl(`tanwords-asset://${id}`)
      .then((resolved) => { if (active) setUrl(resolved); })
      .catch(() => {});
    return () => { active = false; };
  }, [id]);
  return url
    ? <img src={url} alt={alt} className="h-full w-full object-cover" />
    : <div className="flex h-full w-full items-center justify-center bg-muted"><ImageIcon className="h-6 w-6 text-muted-foreground/40" /></div>;
}

function AssetPreview({ asset, onClose }: { asset: DocumentAssetSummary | null; onClose: () => void }) {
  const [url, setUrl] = useState("");
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
        className="absolute right-3 top-3 z-10 h-8 w-8 rounded-full bg-background/80 backdrop-blur">
        <CloseIcon className="h-4 w-4" />
      </Button>
      <div className="flex max-h-[82vh] min-h-64 items-center justify-center bg-black/20 p-5">
        {url ? <img src={url} alt={asset?.file_name ?? ""} className="max-h-[76vh] max-w-full object-contain" /> : (
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        )}
      </div>
      {asset && (
        <div className="flex items-center gap-3 border-t border-border px-5 py-3">
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{asset.file_name}</p>
          <span className="truncate text-xs text-muted-foreground">{asset.document_title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(asset.size)}</span>
        </div>
      )}
    </Dialog>
  );
}

export function DocumentImageManager({ writable }: { writable: boolean }) {
  const t = useT();
  const [assets, setAssets] = useState<DocumentAssetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<DocumentAssetSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<DocumentAssetSummary | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<"grid" | "list">(
    () => (localStorage.getItem("tanwords_document_images_view") === "list" ? "list" : "grid")
  );
  const [pageSize, setPageSize] = useState(
    () => Number(localStorage.getItem("tanwords_document_images_page_size")) || 20
  );

  const changeView = (next: "grid" | "list") => {
    localStorage.setItem("tanwords_document_images_view", next);
    setView(next);
  };

  const load = async () => {
    setLoading(true);
    try { setAssets(await listDocumentAssets()); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const totalSize = useMemo(() => assets.reduce((sum, asset) => sum + asset.size, 0), [assets]);
  const orphanCount = assets.filter((asset) => !asset.referenced).length;
  const totalPages = Math.max(1, Math.ceil(assets.length / pageSize));
  const visibleAssets = assets.slice(page * pageSize, (page + 1) * pageSize);
  useEffect(() => {
    if (page >= totalPages) setPage(totalPages - 1);
  }, [page, totalPages]);

  const refresh = async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAssetClick = (asset: DocumentAssetSummary) => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      if (selectMode) toggleSelected(asset.id);
      else setPreviewTarget(asset);
    }, 220);
  };

  const handleAssetDoubleClick = (asset: DocumentAssetSummary) => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    if (selectMode) {
      setSelectMode(false);
      setSelectedIds(new Set());
    } else {
      setSelectMode(true);
      setSelectedIds(new Set([asset.id]));
    }
  };

  const exportOne = async (asset: DocumentAssetSummary) => {
    const extension = asset.file_name.split(".").pop()?.replace(/[^a-z0-9]/gi, "")
      || (asset.mime_type === "image/svg+xml" ? "svg" : asset.mime_type.split("/")[1]?.replace("jpeg", "jpg"))
      || "png";
    const destination = await saveDialog({
      defaultPath: asset.file_name || `image-${asset.id}`,
      filters: [{ name: t("settings.documentImages"), extensions: [extension] }],
    });
    if (!destination) return;
    try {
      await exportDocumentAsset(asset.id, destination);
      toast.success(t("settings.documentImageExported"));
    } catch (error) {
      toast.error(String(error));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDocumentAsset(deleteTarget.id);
      setAssets((current) => current.filter((asset) => asset.id !== deleteTarget.id));
      setDeleteTarget(null);
      window.dispatchEvent(new CustomEvent("docs-updated"));
      toast.success(t("settings.documentImageDeleted"));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setDeleting(false);
    }
  };

  const cleanOrphans = async () => {
    setCleaning(true);
    try {
      const removed = await deleteOrphanDocumentAssets();
      await load();
      toast.success(t("settings.documentImagesCleaned", { n: removed }));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setCleaning(false);
    }
  };

  const exportSelectedToFolder = async () => {
    const destination = await openDialog({ directory: true, multiple: false });
    if (typeof destination !== "string") return;
    setBulkBusy(true);
    try {
      const count = await exportDocumentAssetsToFolder([...selectedIds], destination);
      toast.success(t("settings.documentImagesBulkExported", { n: count }));
    } catch (error) { toast.error(String(error)); }
    finally { setBulkBusy(false); }
  };

  const exportSelectedZip = async () => {
    const destination = await saveDialog({
      defaultPath: "tanwords-images.zip",
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    if (!destination) return;
    setBulkBusy(true);
    try {
      const count = await exportDocumentAssetsZip([...selectedIds], destination);
      toast.success(t("settings.documentImagesBulkExported", { n: count }));
    } catch (error) { toast.error(String(error)); }
    finally { setBulkBusy(false); }
  };

  const deleteSelected = async () => {
    setBulkBusy(true);
    try {
      for (const id of selectedIds) await deleteDocumentAsset(id);
      const count = selectedIds.size;
      setAssets((current) => current.filter((asset) => !selectedIds.has(asset.id)));
      setSelectedIds(new Set());
      setSelectMode(false);
      setConfirmBulkDelete(false);
      window.dispatchEvent(new CustomEvent("docs-updated"));
      toast.success(t("settings.documentImagesBulkDeleted", { n: count }));
    } catch (error) { toast.error(String(error)); }
    finally { setBulkBusy(false); }
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border py-4 pl-6 pr-14">
        <div>
          <p className="text-sm font-medium">{t("settings.documentImages")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("settings.documentImagesSummary", { n: assets.length, size: formatBytes(totalSize) })}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground/75">
            {t("settings.documentImagesDatabaseOnly")}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
              className={`h-7 w-7 rounded-md ${view === "grid" ? "bg-background text-primary shadow-sm" : "text-muted-foreground"}`}
              title={t("settings.documentImagesGrid")} aria-label={t("settings.documentImagesGrid")}>
              <Grid2X2 className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => changeView("list")}
              className={`h-7 w-7 rounded-md ${view === "list" ? "bg-background text-primary shadow-sm" : "text-muted-foreground"}`}
              title={t("settings.documentImagesList")} aria-label={t("settings.documentImagesList")}>
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {selectMode && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-6 py-2">
          <Checkbox
            checked={selectedIds.size === assets.length && assets.length > 0}
            onCheckedChange={() => setSelectedIds(
              selectedIds.size === assets.length ? new Set() : new Set(assets.map((asset) => asset.id))
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
      ) : assets.length === 0 ? (
        <div className="flex h-28 flex-col items-center justify-center gap-2 text-muted-foreground">
          <ImageIcon className="h-7 w-7 opacity-35" />
          <p className="text-xs">{t("settings.documentImagesEmpty")}</p>
        </div>
      ) : (
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
                <AssetThumbnail id={asset.id} alt={asset.file_name} />
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
                  <p className="truncate text-xs font-medium" title={asset.file_name}>{asset.file_name}</p>
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground" title={asset.document_title}>{asset.document_title}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">{formatBytes(asset.size)}</span>
                  {!asset.referenced && (
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
      )}

      {assets.length > 0 && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-6 py-2">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{t("vocab.perPage")}</span>
            <select value={pageSize} onChange={(event) => {
              const size = Number(event.target.value);
              localStorage.setItem("tanwords_document_images_page_size", String(size));
              setPageSize(size);
              setPage(0);
            }} className="h-7 rounded-md border border-input bg-background px-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-primary/30">
              {[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-1">
            <Button variant="ghost" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}
              className="h-7 w-7 p-0 text-muted-foreground disabled:opacity-30">‹</Button>
            <span className="text-[11px] text-muted-foreground">
              {page * pageSize + 1}–{Math.min((page + 1) * pageSize, assets.length)} / {assets.length}
            </span>
            <Button variant="ghost" disabled={(page + 1) * pageSize >= assets.length}
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
    </div>
  );
}
