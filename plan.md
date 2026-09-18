# TanWords Stickies — absorbing tanNotes into TanWords

> Status: v1 — planned, not started · 2026-09-19 · Owner: zteng · Repo: `/home/zteng/work/Tools/TanWords` (branch `main`)
> App being absorbed: `/home/zteng/work/Tools/tanNotes` (Tauri 2 + React/TS, milestones M0–M5 all shipped, local-only).
> Feature IDs `F1–F65` refer to `tanNotes/plan.md` §2. Reference UX: macOS "Stickies!".
> Chinese version: [plan-cn.md](plan-cn.md) — the two files mirror each other; keep them in sync.

## 1. Goal

The user runs TanWords on Windows, macOS, Ubuntu, and web against one shared Postgres account, and does not
want to run two apps. All tanNotes capability — floating colored sticky notes, tray + global hotkey, the notes
manager, trash, templates, export/import — moves into TanWords as a first-class **Stickies** feature. tanNotes
is then retired after a verified one-time data migration.

Core principle (unchanged from TanWords' "one codebase, two products"): **no second editor and no second
storage engine**. A sticky is a TanWords document; sticky windows reuse the existing Tiptap block editor and the
sidecar command surface.

## 2. Locked decisions (user, 2026-09-19)

| Decision | Choice |
| --- | --- |
| Data model | **A sticky is a TanWords document** (shared content via Postgres) + a **per-device window-state table**. Mirrors the devices-registry split: portable content vs machine-bound state. |
| Manager UI (desktop) | **Small floating manager window** (frameless, like tanNotes' manager) — not a sidebar page. |
| Web build | Web gets an **in-app Stickies page** (read/edit content as a board; no OS windows). |
| Migration | **One-time importer** in Settings → Data; after a verified import, tanNotes is uninstalled. |
| Scope | **Full parity with what tanNotes ships today** (its M1–M5 feature set). P2 extras (click-through, per-note reminders, per-note lock) stay backlog. |

## 3. Feature parity map (tanNotes → TanWords)

| tanNotes features | Disposition in TanWords |
| --- | --- |
| F1–F7, F45 (floating note windows, chrome, always-on-top, translucent, collapse, geometry persistence, reopen, cascade/tile) | **New** — Electron `StickyWindowManager` + sticky window entry (§4.3, S1) |
| F8 (new note on cursor screen), F9 (all Spaces) | **New** — Electron `screen` API / `setVisibleOnAllWorkspaces` (S2) |
| F12–F19, F25, F26, F29–F31 (rich text, tasks, code, links, images, undo, counts, autosave) | **Mostly exists** (TanWords block editor, assets, revisions). Gaps: `underline`, `highlight`, text `color`, font family/size marks, find & replace (§4.5) |
| F18 word/char count, F42 autosave, F51 revisions | **Exists** (document word count, autosave + revisions) |
| F20 spellcheck | **New** — Chromium spellcheck on sticky windows (S2) |
| F22 find & replace | **New** — in the sticky editor only (S2) |
| F27–F28, F46 (markdown paste/import, templates) | **New** — markdown via existing worker pipeline; port `templates.ts` (S2) |
| F34–F36, F38–F39 (per-note color/opacity/corner/font) | **New** — shared sticky meta columns + window chrome (S1/S2) |
| F37 theme, F63 i18n en+zh, F64 a11y | **Exists** (TanWords theme + i18n; audit new surfaces) |
| F40 print, F41 copy as md/image | **New** — `webContents.print` / `capturePage`; md via existing `blocksToMarkdown` (S2) |
| F43 trash (soft delete) | **New at documents level** — `documents.deleted_at` + Trash tab in manager (S0/S3) |
| F44 FTS quick-find | **Exists** (FTS5) — add kind-scoped sticky search (S0) |
| F47–F48 export/import bundle, per-note md/html | **New** — sticky JSON bundle + per-note export via existing serializers (S3) |
| F49 backups | **Exists** (backup machinery); importer backs up before writing (S4) |
| F50 note lock | **Deferred** — document privacy lock already exists; sticky UI wiring is backlog |
| F52 note reminders, F53 tags, F54 sync | Tags & sync come free (documents + Postgres). Reminders → backlog, later mapped onto Calendar/ntfy |
| F55 tray menu | **Extend** existing `TrayManager` menu (S1) |
| F56 global quick-note hotkey, F58 remap | **New** — `sticky_global_shortcut` setting, same pattern as the DSH shortcut (S1) |
| F57 settings | **New** — Settings → "Stickies" section (defaults, hotkey, autostart, import) (S1) |
| F59 single instance | **Exists** (`earlyInit` lock) |
| F60 quick help | **New** — shortcut cheat-sheet inside the manager window (S2) |
| F61 autostart | **New** — `app.setLoginItemSettings`, opt-in Settings toggle (S2) |
| F62 updater | **Exists** (TanWords updater) |
| F65 local-only principle | Superseded — stickies share the user's chosen DB (SQLite file or Postgres) |

## 4. Architecture

```
TanWords (one app)
├── app/core (Rust, both builds)          ← sticky data: documents(kind='sticky') + stickies + sticky_windows
├── app/electron (desktop only)           ← StickyWindowManager, tray entries, global hotkey, autostart
├── app/src
│   ├── sticky.html  → StickyWindow       ← one frameless transparent window per open sticky
│   ├── stickyManager.html → Manager      ← frameless utility window: Open/All/Trash, search, templates, bundle
│   └── pages/ StickiesPage               ← web-only board (capability-gated), same editor
└── web/server                            ← nothing new: /invoke dispatch serves sticky commands per user
```

### 4.1 Data model (S0)

Both `sql/schema.sql` and `sql/schema_postgres.sql` change in lockstep (the existing schema-fingerprint
mechanism re-runs the idempotent pass on existing DBs). `documents.id` is `INTEGER` (SQLite) / `BIGINT
IDENTITY` (Postgres) — FKs follow each dialect.

```sql
ALTER TABLE documents ADD COLUMN kind       TEXT;   -- NULL/'document' = normal; 'sticky' = sticky
ALTER TABLE documents ADD COLUMN deleted_at TEXT;   -- NULL = live (trash support, F43)

-- Shared sticky identity — travels with the DB, so Postgres users see the same sticky everywhere.
CREATE TABLE stickies (
  document_id    <documents-id> NOT NULL PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  color          TEXT    NOT NULL DEFAULT 'yellow',
  corner         TEXT    NOT NULL DEFAULT 'rounded',   -- rounded | square
  opacity        INTEGER NOT NULL DEFAULT 80,          -- 10–100, CSS surface alpha (text stays opaque)
  always_on_top  INTEGER NOT NULL DEFAULT 1,
  font_family    TEXT,
  font_size      INTEGER
);

-- Machine-bound window state — per device, never crosses machines (a Windows layout is meaningless on macOS).
CREATE TABLE sticky_windows (
  document_id  <documents-id> NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  device_id    TEXT NOT NULL,                         -- existing devices-registry UUID (web server: its own id)
  x INTEGER, y INTEGER,
  w INTEGER NOT NULL DEFAULT 260,
  h INTEGER NOT NULL DEFAULT 480,
  collapsed   INTEGER NOT NULL DEFAULT 0,
  is_open     INTEGER NOT NULL DEFAULT 0,             -- open on THIS device
  updated_at  TEXT NOT NULL (...),
  PRIMARY KEY (document_id, device_id)
);
```

Design rules:

1. **Shared**: content (`documents.content`, BlockNote-style blocks), derived `title` (first plain-text line,
   ≤80 chars — stickies are untitled otherwise), tags, protection, and the whole `stickies` row.
2. **Per device**: `sticky_windows` only. Reopening "open" notes at launch queries the current device's rows.
3. `z` from tanNotes is **dropped** — tanNotes always wrote 0 and ordered by `updated_at` anyway; we order by
   `updated_at DESC` and let the OS manage stacking.
4. Sticky rows are excluded from every normal-Documents surface: list, FTS search, dashboard stats, import/export
   bundles, localdocs. Every `documents` query gains `kind` (and `deleted_at IS NULL`) filters — enforce the sweep
   with tests (§7).

### 4.2 Core commands (S0, auto-registered by the `build.rs` dispatch scan)

`sticky_create` (optional seed doc/template) · `sticky_list` (join documents ⋈ stickies ⋈ this device's
window state) · `sticky_get` · `sticky_save_content` (reuses the document content path + title derivation +
word count) · `sticky_update_meta` · `sticky_update_window_state` (auto-scoped to the current device) ·
`sticky_delete` / `sticky_restore` / `sticky_purge` (purge removes assets via the existing asset cleanup) ·
`sticky_trash_list` · `sticky_search` (FTS5 over `kind='sticky'`, LIKE fallback — same pattern as tanNotes) ·
`sticky_bundle_export` / `sticky_bundle_import` (tanNotes JSON bundle shape, content-only as in tanNotes).

### 4.3 Desktop windows (S1–S2, `app/electron/main/stickyWindows.ts`)

- One `BrowserWindow` per open sticky: `frame:false, transparent:true, alwaysOnTop, skipTaskbar:true,
  resizable:true, show:false → ready-to-show`, min size 200×40 (header height 40, tanNotes parity). Loads
  `app://…/sticky.html?id=…` with the standard preload handshake.
- Transparency: CSS-alpha note surface over a transparent window (tanNotes' approach — keeps text crisp).
  macOS `vibrancy: 'under-window'`; Windows `backgroundMaterial: 'acrylic' | 'mica'` (Win11); Linux plain
  translucency, no blur. A settings toggle falls back to opaque (tanNotes risk #2).
- Drag: `-webkit-app-region: drag` header; buttons/`no-drag` islands. Resize: native frameless resize on
  Windows/Linux where the WM provides it; **fallback** = tanNotes-style 8 edge handles calling
  `stickywin_resize(id, edge, dx, dy)` (main applies `setBounds`) — decide in the S1 spike.
- Geometry: debounced persist on move/resize + flush on close + persist-all in `before-quit` (tanNotes
  `persist_all` parity). Collapse resizes to the 40px header; the stored full height is preserved.
- New note spawns on the screen under the cursor (`screen.getCursorScreenPoint` + `getDisplayMatching`),
  cascade offset 28px when no geometry is stored (F8).
- macOS: `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` (F9).
- App-lock interaction: when the app locks, sticky windows hide (they are documents, after all).
- IPC naming: window ops get the `stickywin_` prefix and join `MAIN_PROCESS_COMMANDS` in
  `app/src/ipc/backend.ts`; data ops stay `sticky_*` on the Rust dispatch. Commands: `stickywin_new`, `_open`,
  `_close`, `_set_collapsed`, `_arrange('cascade'|'tile')`, `_show_all/_hide_all`, `_print`, `_capture_image`,
  `_open_manager`, `_resize`, plus autostart get/set.
- Tray: extend `TrayManager` with **New sticky note**, **Sticky notes…** (manager), **Show/Hide stickies**
  (bilingual labels via the existing tray locale pattern).
- Global hotkey: `sticky_global_shortcut` setting (default `CmdOrCtrl+Alt+N`), registered exactly like the
  existing DSH shortcut with the same already-claimed fallback (F56/F58).
- Autostart: `app.setLoginItemSettings({ openAsHidden: true })` + opt-in Settings toggle (F61).

### 4.4 Renderer

- New Vite inputs alongside `floatingBrowser`: `sticky.html` (`stickyWindowMain.tsx`) and
  `stickyManager.html` (`stickyManagerMain.tsx`) — same multi-page pattern, same `app://` protocol + preload.
- **StickyWindow**: header (manager back-button, color palette popover, opacity slider with live surface
  preview, pin, collapse, close) + the **existing `LazyTiptapDocumentEditor` + blockAdapter** + a ported
  Toolbar (format row, color/highlight palettes, font family/size, word-count footer) + debounced 400 ms
  autosave flushed on blur/close (F42 parity).
- **Manager window**: frameless with the ported `TitleBar`; tabs Open/All/Trash; multi-select + bulk
  open/close/restore/delete/purge with ConfirmDialog; debounced FTS search; templates menu; bundle
  export/import buttons; shortcut cheat-sheet (F60); settings popover delegating to main Settings.
- **Web Stickies page**: `pageCatalog` entry + `NavPage` id `stickies`, gated by a new `stickyBoard`
  capability (web only — desktop uses the floating manager). Responsive board of colored cards; click to
  edit in place with the same editor; search. Follows the mobile-UI conventions from the previous plan
  (44px targets, bottom-sheet-safe).

### 4.5 Editor parity (S2)

- `TextInline` gains optional `underline`, `highlight` (multicolor), `textColor`, `fontFamily`, `fontSize`;
  `inlineAdapter`/`blockAdapter` map them to Tiptap marks (Underline, Highlight multicolor, TextStyle+Color,
  FontFamily, FontSize) — the exact tanNotes toolbar set (F12–F15, F38–F39).
- Find & replace inside a sticky: port the tanNotes ProseMirror-search approach (F22). Documents-page
  find & replace stays out of scope.
- Spellcheck: `webPreferences.spellcheck` on sticky windows (F20).
- Code blocks (Shiki), tables, mermaid, images, markdown paste already exist in TanWords at or above parity.

### 4.6 Migration importer (S4, Settings → Data → "Import tanNotes data", desktop only)

1. Pick `tanNotes.db` (default-path hints: Linux `~/.local/share/com.tannotes.app`, macOS
   `~/Library/Application Support/com.tannotes.app`, Windows `%APPDATA%\com.tannotes.app`).
2. Preview: N live notes, M trashed, K attachments, settings found.
3. Back up the current TanWords DB (existing backup machinery), then apply in **one transaction**:
   - per note: tanNotes Tiptap PM JSON → TanWords blocks via a new `tanNotesImport.ts` (maps underline /
     highlight / color / font marks, `taskList`/`taskItem`, `codeBlock` language, images: read the file from
     `com.tannotes.app/attachments/<noteId>/…`, insert as a document asset, rewrite `src`; unmappable content
     degrades gracefully and is reported);
   - `color/corner/opacity/always_on_top/font_*` → `stickies`; `x/y/w/h/collapsed/is_open` → `sticky_windows`
     for the current device; `deleted_at` → trash; `default.*` settings → TanWords sticky defaults.
4. Report success/failures; then the retire checklist (§8).

## 5. Phases

### S0 — Data + command foundation
Schema (both dialects), `kind`/`deleted_at` sweep across every documents query, sticky commands, trash
commands, i18n keys. *Accept:* `cargo test` green incl. new tests (CRUD, per-device state isolation, trash
round-trip, kind filtering); Documents page unchanged.

### S1 — Sticky window MVP + app shell
Sticky windows (frameless, transparent, always-on-top, drag, resize spike, autosave, geometry persistence,
launch reopen), tray entries, global hotkey, floating manager v1 (Open/All tabs, create/open/close, bulk),
cascade/tile, cursor-screen spawn, Settings → Stickies section. *Accept:* the tanNotes M1 bar — 3 translucent
colored notes survive restart with position/size/content intact; hotkey creates a note from anywhere; **CJK
IME input verified inside a frameless sticky on this machine early** (tanNotes risk #5).

### S2 — Window & editor polish
Opacity slider with live preview + translucent/opaque fallback toggle, corner toggle, visible-on-all-Spaces,
spellcheck, find & replace, font pickers, per-note font default, print, copy as Markdown/image, templates +
`.md`/`.txt` import, autostart, quick help. *Accept:* tanNotes M2/M3 surface parity walkthrough.

### S3 — Trash + data tools
Trash tab (restore / permanent delete with attachment cleanup), sticky JSON bundle export/import round-trip,
per-note Markdown/HTML export. *Accept:* the tanNotes M4 bar — export → wipe stickies → import → identical.

### S4 — Migration + retire
Importer per §4.6, verified against the real `com.tannotes.app` DB on this machine; README feature note;
retire checklist executed. *Accept:* every tanNotes note present in TanWords (content, color, geometry,
images) and the manager shows them; settings carried over.

### S5 — Web Stickies page
`stickyBoard` capability, catalog entry, responsive board + in-place editing + search, cross-device check
against Postgres (same content, independent geometry), mobile pass. *Accept:* a sticky edited on the phone
appears on the desktop stickies and vice versa.

(S1–S2 order may interleave; S5 can start any time after S0.)

## 6. Verification

```bash
cd app && bun run typecheck && bun run test:run     # renderer + manager + importer tests
cd app/core && cargo test                            # schema, commands, per-device isolation, trash
cd web/server && cargo build                         # web build still compiles (feature = "web")
```

Manual matrix: restart persistence (3 notes); hotkey + tray from any app; multi-monitor cursor spawn;
collapse/expand keeping geometry; opacity preview; CJK IME in stickies; Postgres two-machine sharing
(shared content, independent geometry); web page edit → desktop sticky; axe pass on manager + web page.

## 7. Risks

1. **`kind`/`deleted_at` sweep** — a missed documents query leaks stickies into Documents or resurrects
   trashed rows. Mitigation: exhaustive grep + tests per query family (list/search/dashboard/stats/import).
2. **Frameless resize/drag cross-platform** — spike in S1; custom edge-drag fallback is already designed in.
3. **Transparent windows on Linux WMs** — translucency is a settings toggle with an opaque fallback.
4. **Per-window RAM** — Electron windows share one Chromium process (cheaper than tanNotes' per-window
   WebKitGTK); windows are destroyed on close; measure 10 open stickies in S1.
5. **Global-shortcut conflicts** — reuse the DSH shortcut's claimed-accelerator fallback.
6. **Importer fidelity** (nested tasks, highlight colors, font marks, absolute image paths) — verify by
   rebuilding tanNotes' reference notes; degrade + report rather than drop a note.
7. **SQLite/Postgres drift** — both schema files change together; the fingerprint re-run covers upgrades.
8. **App-lock UX** — locked app must hide stickies before the lock screen paints.

## 8. Retire tanNotes (after S4)

1. Importer verified on this machine (all notes, images, trash, settings).
2. Uninstall tanNotes (`.deb` / AppImage); archive the repo — no further development.
3. Keep `~/.local/share/com.tannotes.app` (and per-OS equivalents) as a cold backup for ≥ 2 weeks of daily
   TanWords stickies use, then delete.

## 9. Explicit non-goals / backlog (P2 from tanNotes)

Click-through mode (F10) · true macOS NSPanel (F11) · per-note password UI (F50 — document protection
already exists underneath) · per-note reminders (F52 — later map onto TanWords calendar + ntfy) ·
web PWA/offline · tanNotes updater internals (TanWords has its own).

---

## 10. Implementation status (post-build notes)

ALL PHASES SHIPPED (S0–S5). Deviations from the original design, for the record:

- **Settings live in the floating manager window** (gear icon), not in the main
  app's Settings section — stickies are a desktop-window feature; the manager is
  where the user already is. The tanNotes importer button also lives there.
- **Manager v1 is a single list**, not tanNotes' Open/All tabs — open notes show
  a `●` marker; trash is a collapsible section with restore/purge.
- **Sticky = a TanWords document** (`kind='sticky'`) with soft-delete trash
  (`deleted_at`) — one storage layer for documents AND stickies, so search,
  assets, protection and the web side all reuse existing machinery.
- **Window geometry is per-device** (`sticky_windows` keyed by device id);
  content/color/opacity/font are shared. Bundle export carries the exporting
  device's geometry, exactly like tanNotes' bundle.
- **Web gets a Stickies board page** (`stickyBoard` capability, web-only;
  desktop uses the floating manager + OS windows) — same data, in-place editor,
  so notes sync across devices through the server.
- **tanNotes importer (S4)**: preview → backup → convert → apply, with the
  PM-JSON→blocks conversion on the renderer side (`tanNotesImport.ts` — TanWords'
  own adapter, full mark fidelity) and one transaction on the core
  (`sticky_tannotes_apply`). Attachments: data URIs decode in the renderer;
  files are read from `<dbDir>/attachments/<noteId>/` through a guarded
  main-process channel and become document assets. Settings carry-over maps
  `default.color/corner/opacity` and `autostart`.
- **Quick help** is a popover in the manager (F60-equivalent); the Electron
  shortcut default is `CommandOrControl+Alt+N` (configurable in manager
  settings), autostart restores from the `sticky_autostart` setting.

Retire checklist (§8) is now actionable: importer verified against the real
`~/.local/share/com.tannotes.app/tanNotes.db`.
