import { invoke, assetUrlById } from "@/ipc/backend";
import { isDesktopHost } from "@/platform";

export const DOCUMENT_ASSET_SCHEME = "tanwords-asset://";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ASSET_BYTES = 100 * 1024 * 1024;
const MAX_RASTER_DIMENSION = 2400;
const BLOB_URL_CACHE_CAPACITY = 100;
const blobUrlCache = new Map<string, string>();

export interface R2Status {
  configured: boolean;
  account_id: string;
  bucket: string;
  access_key_id: string;
  public_base_url: string | null;
  threshold_bytes: number;
  always_upload: boolean;
}

export function getR2Status(): Promise<R2Status> {
  return invoke("r2_get_status");
}

export interface R2Usage {
  used_bytes: number;
  object_count: number;
  limit_bytes: number;
  block_at_bytes: number;
}

/** Lists the bucket, so call it when a page opens — not per upload. */
export function getR2Usage(): Promise<R2Usage> {
  return invoke("r2_get_usage");
}

export function connectR2(input: {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
}): Promise<void> {
  return invoke("r2_connect", {
    accountId: input.accountId,
    bucket: input.bucket,
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    publicBaseUrl: input.publicBaseUrl || null,
  });
}

export function disconnectR2(): Promise<void> {
  return invoke("r2_disconnect");
}

export function setR2AlwaysUpload(enabled: boolean): Promise<void> {
  return invoke("r2_set_always_upload", { enabled });
}

export interface DocumentAsset {
  id: string;
  document_id: number;
  file_name: string;
  mime_type: string;
  size: number;
  data_base64: string;
  /** Present when the bytes live in R2 — stream from here instead of decoding
   *  `data_base64`, which is empty in that case. */
  remote_url?: string;
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
  /** Uploaded from the asset manager rather than from inside a document.
   *  Never auto-pruned — the user manages these. */
  standalone: boolean;
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
  // A video dropped into a document takes the same route as one uploaded from
  // the asset manager. The block still references `tanwords-asset://<id>`, and
  // the editor's `resolveFileUrl` turns that into the bucket URL at render
  // time, so <video> streams from R2 instead of decoding a base64 blob.
  //
  // These rows are standalone, so deleting the document does not take the
  // object with it — consistent with the rule that uploaded files are the
  // user's to manage, and it also means `db_prune_document_assets` can never
  // quietly delete a 100 MB video the moment it stops being referenced.
  const routed = await uploadViaR2(file);
  if (routed) return `${DOCUMENT_ASSET_SCHEME}${routed}`;

  const prepared = await prepareAssetUpload(file);
  const id = await invoke<string>("db_create_document_asset", {
    documentId,
    ...prepared,
  });
  return `${DOCUMENT_ASSET_SCHEME}${id}`;
}

/** A file uploaded from the asset manager. Unlike document attachments it is
 *  stored verbatim — no image compression, no 10 MB image ceiling — because
 *  the point is to keep the file the user picked, not to inline it in a note. */
/** Sends the file to R2 when a bucket is connected and the file is big enough
 *  to be worth it, and returns the new asset id. `null` means "not routed —
 *  use the database path", which is the case for small files and for an
 *  unconfigured bucket.
 *
 *  Small files stay in the database deliberately: no network round trip, and
 *  they keep working offline. Big ones cannot stay — a large blob write can be rejected
 *  blob that size outright (SQLITE_NOMEM). The size rule is skipped entirely
 *  when the bucket is set to take everything. */
async function uploadViaR2(file: File): Promise<string | null> {
  const r2 = await getR2Status().catch(() => null);
  if (!r2?.configured) return null;
  if (!r2.always_upload && file.size < r2.threshold_bytes) return null;
  const fileName = file.name || "file.bin";
  const mimeType = file.type || "application/octet-stream";
  const remoteKey = await invoke<string>("r2_put_asset", {
    fileName,
    mimeType,
    dataBase64: await blobToDataBase64(file),
  });
  return invoke<string>("db_create_remote_asset", {
    fileName,
    mimeType,
    size: file.size,
    remoteKey,
  });
}

export async function uploadStandaloneAsset(file: File): Promise<string> {
  if (!file.size) throw new Error("File is empty");
  const routed = await uploadViaR2(file);
  if (routed) return routed;

  if (file.size > MAX_ASSET_BYTES) throw new Error("File is larger than 100 MB");
  return invoke<string>("db_create_standalone_asset", {
    fileName: file.name || "file.bin",
    mimeType: file.type || "application/octet-stream",
    dataBase64: await blobToDataBase64(file),
  });
}

export async function uploadDocumentImage(documentId: number, file: File): Promise<string> {
  return uploadDocumentAsset(documentId, file);
}

export async function resolveDocumentAssetUrl(url: string): Promise<string> {
  if (!url.startsWith(DOCUMENT_ASSET_SCHEME)) return url;
  // Tolerates the `?tanwords-type=` marker that survives a markdown round trip
  // (see mediaTransforms) — the id is everything before the query.
  const id = url.slice(DOCUMENT_ASSET_SCHEME.length).split("?", 1)[0];
  if (!isDesktopHost) return assetUrlById(id);
  const cached = blobUrlCache.get(id);
  if (cached) {
    blobUrlCache.delete(id);
    blobUrlCache.set(id, cached);
    return cached;
  }
  const asset = await invoke<DocumentAsset>("db_get_document_asset", { id });
  // Bucket-backed: hand back the presigned URL untouched. Wrapping it in a
  // blob would defeat the point — it would download the whole video before
  // playback and lose Range-based seeking.
  if (asset.remote_url) return asset.remote_url;
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

/** Markdown for pasting an asset into a document.
 *
 *  Images use image syntax; everything else uses a link carrying the
 *  `tanwords-type` marker, which is what turns it back into a real video /
 *  audio / file block when the editor leaves source mode (see
 *  mediaTransforms). Pasting a bare `tanwords-asset://` link would come back
 *  as a plain link instead of a player. */
export function assetMarkdown(asset: {
  id: string;
  file_name: string;
  mime_type: string;
}): string {
  const url = `${DOCUMENT_ASSET_SCHEME}${asset.id}`;
  const name = asset.file_name || "attachment";
  if (asset.mime_type.startsWith("image/")) return `![${name}](${url})`;
  const type = asset.mime_type.startsWith("video/") ? "video"
    : asset.mime_type.startsWith("audio/") ? "audio"
    : "file";
  return `[${name}](${url}?tanwords-type=${type})`;
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
