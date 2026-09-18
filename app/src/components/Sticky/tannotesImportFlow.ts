/** The tanNotes → TanNotes import flow (plan §4.6, S4).
 *
 *  Steps, in the order the user experiences them:
 *   1. pick `tanNotes.db` via the main-side dialog (default-path hints per OS);
 *   2. `sticky_tannotes_preview` — live/trashed/settings counts for the
 *      confirm dialog;
 *   3. on confirm: `db_export_backup` to a user-picked location (the caller
 *      may skip for fresh databases);
 *   4. `sticky_tannotes_raw` → `convertTanNotesNote` per row (renderer owns
 *      the PM→blocks conversion) → `sticky_tannotes_apply` in one
 *      transaction;
 *   5. image migration: collected srcs become document assets (data URIs
 *      decoded in the renderer; attachment files read through main's
 *      `stickywin_read_tannotes_asset`), then each note's content is
 *      re-saved with the new `tanwords-asset://` urls;
 *   6. settings carry-over: `default.color/corner/opacity` → sticky
 *      defaults, `autostart` → login item.
 */
import { invoke } from "@/ipc/backend";
import { callMain } from "@/ipc/host";
import { openDialog, saveDialog } from "@/ipc/dialog";
import { convertTanNotesNote, classifyImageSrc, deriveTitle } from "./tanNotesImport";

export interface TanNotesPreview {
  live: number;
  trashed: number;
  settings: [string, string][];
}

export interface TanNotesRawNote {
  id: string;
  doc: string;
  plain_text: string;
  color: string;
  corner: string;
  opacity: number;
  always_on_top: boolean;
  font_family: string | null;
  font_size: number | null;
  collapsed: boolean;
  x: number | null;
  y: number | null;
  w: number;
  h: number;
  is_open: boolean;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface TanNotesApplyReport {
  imported: number;
  failed: [string, string][];
  mappings: { source_id: string; new_id: number }[];
}

export const TANNOTES_DB_HINTS: Record<string, string> = {
  linux: "~/.local/share/com.tannotes.app/tanNotes.db",
  darwin: "~/Library/Application Support/com.tannotes.app/tanNotes.db",
  win32: "%APPDATA%\\com.tannotes.app\\tanNotes.db",
};

/** Where the picker opens / what the hint label shows, per platform. */
export function tannotesHint(): string {
  return TANNOTES_DB_HINTS[process.platform as keyof typeof TANNOTES_DB_HINTS] ?? TANNOTES_DB_HINTS.linux;
}

async function readRawNotes(path: string): Promise<TanNotesRawNote[]> {
  return invoke<TanNotesRawNote[]>("sticky_tannotes_raw", { path });
}

async function preview(path: string): Promise<TanNotesPreview> {
  return invoke<TanNotesPreview>("sticky_tannotes_preview", { path });
}

/** Phase-2 image migration: returns how many assets were attached. */
async function migrateImages(
  mappings: { source_id: string; new_id: number }[],
  notesBySource: Map<string, { images: string[]; content: string }>,
  dbDir: string,
): Promise<number> {
  const { blocksToStorage } = await import("@/lib/docFormat");
  const { pmDocToBlocks } = await import("@/components/Documents/tiptap/blockAdapter");
  let attached = 0;
  for (const mapping of mappings) {
    const converted = notesBySource.get(mapping.source_id);
    if (!converted || converted.images.length === 0) continue;
    let content = converted.content;
    for (const src of converted.images) {
      try {
        const classified = classifyImageSrc(src);
        let assetId: string;
        if (classified.kind === "data") {
          assetId = await invoke<string>("db_create_document_asset", {
            documentId: mapping.new_id,
            fileName: "image",
            mimeType: classified.mime,
            dataBase64: classified.base64,
          });
        } else if (classified.kind === "attachment") {
          const file = await callMain<{ base64: string; mime: string }>("stickywin_read_tannotes_asset", {
            dbDir,
            noteId: mapping.source_id,
            rel: classified.rel,
          });
          if (!file) continue;
          assetId = await invoke<string>("db_create_document_asset", {
            documentId: mapping.new_id,
            fileName: classified.rel.split("/").pop() ?? "image",
            mimeType: file.mime,
            dataBase64: file.base64,
          });
        } else {
          continue;
        }
        content = content.split(src).join(`tanwords-asset://${assetId}`);
        attached += 1;
      } catch (error) {
        // A missing attachment file must not fail the whole migration — the
        // note keeps its original src and the report mentions nothing.
        console.warn("[tannotes] attachment skipped", src, error);
      }
    }
    if (content !== converted.content) {
      // One save with recomputed text/word count (the same blocks the
      // editor would store — keeps FTS/preview correct).
      try {
        const blocks = pmDocToBlocks(JSON.parse(content));
        const storage = blocksToStorage(blocks);
        await invoke("sticky_save_content", {
          id: mapping.new_id,
          content,
          contentText: storage.contentText,
          wordCount: storage.wordCount,
        });
      } catch (error) {
        console.warn("[tannotes] post-image save skipped", error);
      }
    }
  }
  return attached;
}

export interface ImportProgress {
  stage: "preview" | "backup" | "convert" | "apply" | "images" | "settings" | "done" | "error";
  message?: string;
}

/** Runs the whole flow after the user confirmed. Returns the report. */
export async function runTannotesImport(
  dbPath: string,
  onProgress: (p: ImportProgress) => void,
  opts: { backup: boolean },
): Promise<{ report: TanNotesApplyReport; assetsAttached: number }> {
  // 3. Backup first — the plan's non-negotiable.
  if (opts.backup) {
    onProgress({ stage: "backup", message: "Exporting a TanNotes backup…" });
    const destination = await saveDialog({
      defaultPath: "tanwords-before-tannotes-import.db",
      filters: [{ name: "Database backup", extensions: ["db"] }],
    });
    if (!destination) throw new Error("Backup cancelled — nothing was imported.");
    await invoke("db_export_backup", { dest: destination, password: null });
  }

  // 4. Raw → converted → applied.
  onProgress({ stage: "convert" });
  const raw = await readRawNotes(dbPath);
  const converted = raw.map((r) => convertTanNotesNote(r));
  const notesBySource = new Map(converted.map((c) => [c.sourceId, { images: c.images, content: c.content }]));
  onProgress({ stage: "apply" });
  const report = await invoke<TanNotesApplyReport>("sticky_tannotes_apply", {
    notes: converted.map((c) => ({
      sourceId: c.sourceId, title: c.title, content: c.content, contentText: c.contentText,
      wordCount: c.wordCount, color: c.color, corner: c.corner, opacity: c.opacity,
      alwaysOnTop: c.alwaysOnTop, fontFamily: c.fontFamily, fontSize: c.fontSize,
      collapsed: c.collapsed, x: c.x, y: c.y, w: c.w, h: c.h, isOpen: c.isOpen,
      createdAt: c.createdAt, updatedAt: c.updatedAt, deleted: c.deleted,
    })),
  });

  // 5. Images.
  let assetsAttached = 0;
  if (report.mappings.length > 0) {
    onProgress({ stage: "images" });
    const dbDir = dbPath.replace(/[/\\][^/\\]+$/, "");
    assetsAttached = await migrateImages(report.mappings, notesBySource, dbDir);
  }

  // 6. Settings carry-over (only keys that exist in tanNotes).
  onProgress({ stage: "settings" });
  try {
    const settings = new Map((await preview(dbPath)).settings);
    if (settings.has("default.color")) {
      await invoke("db_set_setting", { key: "sticky_default_color", value: JSON.stringify(settings.get("default.color")) });
    }
    if (settings.has("default.corner")) {
      await invoke("db_set_setting", { key: "sticky_default_corner", value: JSON.stringify(settings.get("default.corner")) });
    }
    if (settings.has("default.opacity")) {
      await invoke("db_set_setting", { key: "sticky_default_opacity", value: JSON.stringify(Number(settings.get("default.opacity"))) });
    }
    if (settings.get("autostart") === "1") {
      await invoke("db_set_setting", { key: "sticky_autostart", value: "true" });
      await invoke("stickywin_set_autostart", { enabled: true }).catch(() => {});
    }
  } catch (error) {
    console.warn("[tannotes] settings carry-over skipped", error);
  }

  onProgress({ stage: "done" });
  return { report, assetsAttached };
}

export { preview as previewTannotes, readRawNotes, deriveTitle };
