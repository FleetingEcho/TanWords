import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { useT } from "@/hooks/useT";
import {
  deleteDocumentAsset,
  deleteOrphanDocumentAssets,
  exportDocumentAsset,
  exportDocumentAssetsToFolder,
  exportDocumentAssetsZip,
  listDocumentAssets,
  type DocumentAssetSummary,
} from "@/lib/documentAssets";
import type { DocumentPasswordRequest } from "../DocumentPasswordDialog";
import { requiresAttachmentPassword, type PrivateAttachmentAction } from "../privateDocumentPolicy";
import { assetKind, type AssetKind } from "../documentImageManagerHelpers";

/** All state, filtering, pagination, and CRUD/export handlers behind
 * DocumentImageManager — split out so the component itself only has to
 * worry about rendering. */
export function useDocumentAssetManager() {
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
  const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
  const [query, setQuery] = useState("");
  const [passwordRequest, setPasswordRequest] = useState<DocumentPasswordRequest | null>(null);
  const passwordResolver = useRef<((password: string | null) => void) | null>(null);

  const requestPassword = (request: DocumentPasswordRequest) => new Promise<string | null>((resolve) => {
    passwordResolver.current = resolve;
    setPasswordRequest(request);
  });

  const finishPasswordRequest = (password: string | null) => {
    const resolve = passwordResolver.current;
    passwordResolver.current = null;
    setPasswordRequest(null);
    resolve?.(password);
  };

  const authorizeAssets = async (
    action: PrivateAttachmentAction,
    candidates: DocumentAssetSummary[],
  ): Promise<boolean> => {
    const privateDocuments = new Map<number, DocumentAssetSummary>();
    for (const asset of candidates) {
      if (requiresAttachmentPassword(asset.protected, action)) {
        privateDocuments.set(asset.document_id, asset);
      }
    }
    for (const [documentId, asset] of privateDocuments) {
      const password = await requestPassword({
        title: action === "download" ? t("doc.downloadPrivateFile") : t("doc.deletePrivateFile"),
        description: `${asset.document_title}: ${t("doc.sensitiveActionPasswordHint")}`,
      });
      if (!password) return false;
      try {
        await invoke("db_unlock_document", { id: documentId, password });
      } catch {
        toast.error(t("doc.invalidPassword"));
        return false;
      }
    }
    return true;
  };

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
  const filteredAssets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return assets.filter((asset) =>
      (kindFilter === "all" || assetKind(asset) === kindFilter)
      && (!needle || `${asset.file_name} ${asset.document_title} ${asset.mime_type}`.toLowerCase().includes(needle))
    );
  }, [assets, kindFilter, query]);
  const orphanCount = assets.filter((asset) => !asset.protected && !asset.referenced).length;
  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / pageSize));
  const visibleAssets = filteredAssets.slice(page * pageSize, (page + 1) * pageSize);
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
    if (asset.protected && !asset.unlocked) return;
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      if (selectMode) toggleSelected(asset.id);
      else setPreviewTarget(asset);
    }, 220);
  };

  const handleAssetDoubleClick = (asset: DocumentAssetSummary) => {
    if (asset.protected && !asset.unlocked) return;
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
    if (!await authorizeAssets("download", [asset])) return;
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
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!await authorizeAssets("delete", [target])) return;
    setDeleting(true);
    try {
      await deleteDocumentAsset(target.id);
      setAssets((current) => current.filter((asset) => asset.id !== target.id));
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
    const selected = assets.filter((asset) => selectedIds.has(asset.id));
    if (!await authorizeAssets("download", selected)) return;
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
    const selected = assets.filter((asset) => selectedIds.has(asset.id));
    if (!await authorizeAssets("download", selected)) return;
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
    setConfirmBulkDelete(false);
    const selected = assets.filter((asset) => selectedIds.has(asset.id));
    if (!await authorizeAssets("delete", selected)) return;
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

  return {
    t, assets, loading, deleteTarget, setDeleteTarget, deleting, cleaning, refreshing,
    previewTarget, setPreviewTarget, selectMode, setSelectMode, selectedIds, setSelectedIds,
    confirmBulkDelete, setConfirmBulkDelete, bulkBusy, page, setPage, view, changeView,
    pageSize, setPageSize, kindFilter, setKindFilter, query, setQuery,
    passwordRequest, finishPasswordRequest,
    totalSize, filteredAssets, orphanCount, totalPages, visibleAssets,
    refresh, toggleSelected, handleAssetClick, handleAssetDoubleClick,
    exportOne, confirmDelete, cleanOrphans, exportSelectedToFolder, exportSelectedZip, deleteSelected,
  };
}

export type DocumentAssetManagerState = ReturnType<typeof useDocumentAssetManager>;
