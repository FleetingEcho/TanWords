import { invoke } from "@/ipc/backend";

export const DOCUMENT_ASSET_SCHEME = "tanwords-asset://";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ASSET_BYTES = 100 * 1024 * 1024;
const MAX_RASTER_DIMENSION = 2400;
const BLOB_URL_CACHE_CAPACITY = 100;
const blobUrlCache = new Map<string, string>();

export interface DocumentAsset {
  id: string;
  document_id: number;
  file_name: string;
  mime_type: string;
  size: number;
  data_base64: string;
}

export interface DocumentAssetSummary {
  id: string;
  document_id: number;
  document_title: string;
  file_name: string;
  mime_type: string;
  size: number;
  created_at: string;
  referenced: boolean;
  protected: boolean;
  unlocked: boolean;
}

function blobToDataBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(blob);
  });
}

async function compressRaster(file: File): Promise<{ blob: Blob; fileName: string }> {
  if (file.type === "image/gif" || file.type === "image/svg+xml") {
    return { blob: file, fileName: file.name || "image" };
  }
  // Small clipboard PNGs do not need decoding. This also keeps uploads working
  // in WebViews that do not implement createImageBitmap.
  if (file.size <= 2 * 1024 * 1024) {
    return { blob: file, fileName: file.name || "image" };
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_RASTER_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Image compression is unavailable");
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Image compression failed")), "image/webp", 0.86)
  );
  return { blob, fileName: `${(file.name || "image").replace(/\.[^.]+$/, "")}.webp` };
}

export async function prepareImageUpload(file: File): Promise<{ fileName: string; mimeType: string; dataBase64: string }> {
  if (!file.type.startsWith("image/")) throw new Error("Only image files are supported");
  const { blob, fileName } = await compressRaster(file);
  if (blob.size > MAX_IMAGE_BYTES) throw new Error("Image is larger than 10 MB");
  return {
    fileName,
    mimeType: blob.type || file.type,
    dataBase64: await blobToDataBase64(blob),
  };
}

export async function prepareAssetUpload(file: File): Promise<{ fileName: string; mimeType: string; dataBase64: string }> {
  if (file.type.startsWith("image/")) return prepareImageUpload(file);
  if (!file.size || file.size > MAX_ASSET_BYTES) throw new Error("Attachment must be between 1 byte and 100 MB");
  return {
    fileName: file.name || "attachment.bin",
    mimeType: file.type || "application/octet-stream",
    dataBase64: await blobToDataBase64(file),
  };
}

export async function uploadDocumentAsset(documentId: number, file: File): Promise<string> {
  const prepared = await prepareAssetUpload(file);
  const id = await invoke<string>("db_create_document_asset", {
    documentId,
    ...prepared,
  });
  return `${DOCUMENT_ASSET_SCHEME}${id}`;
}

export async function uploadDocumentImage(documentId: number, file: File): Promise<string> {
  return uploadDocumentAsset(documentId, file);
}

export async function resolveDocumentAssetUrl(url: string): Promise<string> {
  if (!url.startsWith(DOCUMENT_ASSET_SCHEME)) return url;
  const id = url.slice(DOCUMENT_ASSET_SCHEME.length);
  const cached = blobUrlCache.get(id);
  if (cached) {
    blobUrlCache.delete(id);
    blobUrlCache.set(id, cached);
    return cached;
  }
  const asset = await invoke<DocumentAsset>("db_get_document_asset", { id });
  const binary = atob(asset.data_base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blobUrl = URL.createObjectURL(new Blob([bytes], { type: asset.mime_type }));
  blobUrlCache.set(id, blobUrl);
  if (blobUrlCache.size > BLOB_URL_CACHE_CAPACITY) {
    const oldestId = blobUrlCache.keys().next().value as string;
    const oldestUrl = blobUrlCache.get(oldestId);
    blobUrlCache.delete(oldestId);
    if (oldestUrl) URL.revokeObjectURL(oldestUrl);
  }
  return blobUrl;
}

export function documentAssetIdsFromContent(content: string): string[] {
  const ids = new Set<string>();
  const pattern = /tanwords-asset:\/\/([0-9a-f-]{36})/gi;
  for (const match of content.matchAll(pattern)) ids.add(match[1]);
  return [...ids];
}

export function getDocumentAssets(documentId: number): Promise<DocumentAsset[]> {
  return invoke("db_get_document_assets", { documentId });
}

function extensionForMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/svg+xml") return "svg";
  return mime.split("/", 2)[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "bin";
}

export function prepareDocumentAssetsForExport(markdown: string, assets: DocumentAsset[]) {
  let content = markdown;
  const files = assets.map((asset) => {
    const safeOriginal = asset.file_name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      || `attachment.${extensionForMime(asset.mime_type)}`;
    const name = `${asset.id}-${safeOriginal}`;
    content = content.split(`${DOCUMENT_ASSET_SCHEME}${asset.id}`).join(`./assets/${name}`);
    return { name, dataBase64: asset.data_base64 };
  });
  return { content, assets: files };
}

export function rewriteDocumentLinksForExport(
  markdown: string,
  documents: Array<{ id: number; title: string }>,
): string {
  const titles = new Map(documents.map((document) => [document.id, document.title]));
  return markdown.replace(/tanwords-doc:\/\/(\d+)/g, (original, rawId: string) => {
    const title = titles.get(Number(rawId));
    if (!title) return original;
    const safeTitle = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || `Document-${rawId}`;
    return `./${safeTitle}.md`;
  });
}

export function pruneDocumentAssets(documentId: number, content: string): Promise<void> {
  return invoke("db_prune_document_assets", {
    documentId,
    referencedIds: documentAssetIdsFromContent(content),
  });
}

export function listDocumentAssets(): Promise<DocumentAssetSummary[]> {
  return invoke("db_list_document_assets");
}

export function deleteDocumentAsset(id: string): Promise<void> {
  return invoke("db_delete_document_asset", { id });
}

export function deleteOrphanDocumentAssets(): Promise<number> {
  return invoke("db_delete_orphan_document_assets");
}

export function exportDocumentAsset(id: string, destination: string): Promise<void> {
  return invoke("db_export_document_asset", { id, destination });
}

export function exportDocumentAssetsToFolder(ids: string[], destination: string): Promise<number> {
  return invoke<number>("db_export_document_assets_to_folder", { ids, destination });
}

export function exportDocumentAssetsZip(ids: string[], destination: string): Promise<number> {
  return invoke<number>("db_export_document_assets_zip", { ids, destination });
}
