# Plan: Custom dashboard workspaces with page widgets and drag-to-split

## Goal

Let a user create a blank, named workspace page and place existing TanWords pages inside it as widgets. A page can be dragged from navigation or another pane and dropped on the left, right, top, or bottom of a pane to create a split. Split sizes, page placement, and workspace names persist across restarts.

This is feasible, but “any page” has two implementation classes:

- Normal React pages can use one generic page host.
- Browser, DSH, and Terminal need dedicated adapters because they own native views or long-lived processes.

The existing Dashboard remains unchanged. User-created dashboards are called **workspaces** internally so the current `DashboardPage` and the new feature do not become one overloaded module. In the UI, each workspace appears under its chosen name.

## Product decisions

1. Users can create, rename, duplicate, reorder, and delete custom workspaces from the sidebar.
2. A new workspace starts with one empty pane and an “Add page” action.
3. Built-in sidebar items remain clickable for normal navigation and become draggable on desktop.
4. Dropping a page on a pane edge splits that pane. Dropping in the center fills an empty pane or swaps content after confirmation.
5. Pane headers provide drag, replace, split-right, split-below, focus, open-full-page, and close actions. Every drag operation has a non-drag equivalent.
6. Dragging an existing pane moves it. Copying is allowed only for pages proven to support multiple instances.
7. Closing the final pane returns the workspace to one empty pane rather than deleting it.
8. Desktop supports arbitrary splits. Compact/mobile layout shows one pane at a time with a pane switcher rather than squeezing a desktop layout into tiny columns.
9. Version 1 permits each singleton page only once across the visible application. Moving one relocates its live instance instead of cloning it.
10. Layout editing has explicit Edit/Done controls so normal selection, scrolling, and page-level drag behavior are not intercepted.

## Scope

### Version 1

- Named custom workspaces in navigation.
- Searchable page picker with categories, host-capability filtering, and disabled-state explanations.
- Existing pages as whole-page widgets.
- Horizontal and vertical recursive splits.
- Drag-to-split, pane moves, divider resizing, pane focus, and layout reset.
- Durable, versioned persistence.
- Generic support for normal React pages.
- Dedicated support for persistent Terminal and native Browser/DSH pages.
- Keyboard/menu alternatives and compact-layout fallback.

### Later

- Small data widgets: counts, recents, charts, actions, and saved searches.
- Multiple independently configured instances after page state becomes instance-scoped.
- Templates, import/export, sharing, role assignment, and remote/custom web pages.
- Freeform floating windows. Version 1 stays a deterministic split tree.

### Non-goals for version 1

- Rendering arbitrary third-party URLs inside the app shell.
- Replacing the existing Dashboard.
- Persisting live PTYs/processes across application restarts.
- Freeform overlapping panes.
- Deeply nested unusable layouts; depth and minimum pane sizes are bounded.

## Architecture

The feature should be a deep `workspace` module. Callers do not manipulate tree nodes directly. Its small interface owns validation, split math, moves, cleanup, persistence, migration, and singleton rules.

```text
Sidebar / picker / pane controls
              |
              v
     Workspace module interface
 create, rename, place, move, resize,
       close, focus, undo/reset
              |
       +------+-------+
       |              |
       v              v
 persisted tree     Page host
                   /    |     \
             generic retained native
              React  Terminal Browser/DSH
```

### 1. Workspace layout model

Use a recursive binary split tree rather than a fixed grid. It maps directly to edge drops, serializes cleanly, and makes divider resizing local to one branch.

```ts
interface WorkspaceDocument {
  schemaVersion: 1;
  id: string;
  title: string;
  root: LayoutNode;
  createdAt: string;
  updatedAt: string;
}

type LayoutNode =
  | { kind: "pane"; id: string; content: PageInstance | null }
  | {
      kind: "split";
      id: string;
      axis: "horizontal" | "vertical";
      ratio: number; // normalized and clamped, e.g. 0.2...0.8
      first: LayoutNode;
      second: LayoutNode;
    };

interface PageInstance {
  instanceId: string;
  pageId: NavPage;
  params?: Record<string, string | number | boolean | null>;
}
```

Workspace operations return a new normalized document. Normalization validates IDs, clamps ratios, removes redundant split branches, caps nesting, and guarantees at least one pane. Tests exercise this public interface rather than internal tree helpers.

Suggested modules:

- `app/src/workspaces/model.ts` — types, decoder, migration, normalization.
- `app/src/workspaces/operations.ts` — pure create/split/move/resize/close transformations.
- `app/src/store/workspaceStore.ts` — selection, edit/focus state, undo checkpoint, persistence orchestration.
- `app/src/workspaces/persistence.ts` — local cache plus durable settings adapter.

### 2. Central page catalog

`App.tsx` currently owns lazy imports and page selection while the sidebar separately owns labels, icons, ordering, and capability filtering. Replace those parallel definitions with one catalog.

```ts
interface PageDefinition {
  id: NavPage;
  titleKey: string;
  icon: React.ComponentType<{ className?: string }>;
  capability?: keyof typeof hostCapabilities;
  host: "react" | "retained" | "native";
  multiplicity: "multiple" | "singleton";
  minWidth: number;
  minHeight: number;
  load: () => Promise<PageModule>;
}
```

The catalog is the seam used by full-page navigation, the sidebar, page picker, and pane host. Adding a page no longer requires synchronized definitions in several places.

Suggested files:

- `app/src/pages/pageCatalog.tsx`
- `app/src/pages/PageHost.tsx`
- `app/src/pages/PageHostContext.tsx`
- `app/src/pages/adapters/ReactPageAdapter.tsx`
- `app/src/pages/adapters/TerminalPageAdapter.tsx`
- `app/src/pages/adapters/BrowserPageAdapter.tsx`
- `app/src/pages/adapters/DshPageAdapter.tsx`

### 3. Page-host contract

Pages render content; the host decides whether that content occupies the application or a pane. `PageHost` owns lazy loading, Suspense/error UI, visibility, lifecycle, sizing, and pane chrome. A small context exposes only host facts a page truly needs:

```ts
interface PageHostContextValue {
  mode: "full" | "workspace";
  instanceId: string;
  visible: boolean;
  requestFocus: () => void;
  requestOpenFullPage: () => void;
}
```

Do not add an `embedded` prop to every page. Most pages render unchanged through the generic adapter. Only real viewport/native lifecycle exceptions get a dedicated adapter.

### 4. Navigation

Keep the existing `navigate(page, ...)` interface working for its many callers. Extend `navStore` with a discriminated active destination and `openWorkspace(workspaceId)`. Full-page actions continue to open built-in pages; workspace selection activates a workspace destination.

`MainLayout` receives the unified destination so it can mark either kind active, render a separate reorderable workspace section, and expose built-in pages as drag sources in Edit mode.

### 5. Persistence

Persist a versioned workspace collection through the existing user-settings path so desktop and web behave consistently. Keep a small cache for immediate startup and reconcile with the durable value after settings load, following existing navigation-layout preferences.

Use a dedicated key such as `custom_workspaces_v1`; do not place tree mutation inside the large `settingsStore.ts`. Decode and normalize persisted JSON and fall back safely if it is corrupt. Debounce divider writes; persist structural actions immediately. Keep one in-memory structural checkpoint for Undo.

No Rust schema change is needed if layouts use existing settings storage. Add a table only if layouts later require collaboration, sharing, or per-workspace conflict resolution.

### 6. Drag, drop, and resizing

- Use a drag layer with pointer, touch, keyboard, overlays, and accessible announcements. Select the dependency/version during implementation rather than building a general drag framework inside TanWords.
- During a drag, each pane exposes center, left, right, top, and bottom zones.
- Edge zones create a 50/50 split. Center fills an empty pane or performs a confirmed swap.
- Split dividers use pointer capture, following the proven `FloatingBrowserResizeHandle.tsx` pattern.
- Clamp resizing using the two page definitions' minimum sizes and container dimensions.
- Update in-memory ratio on animation frames and persist only the final ratio on pointer-up.
- Hide or snapshot native panels while a drag overlay or picker is above them because Electron `WebContentsView` surfaces composite above HTML regardless of `z-index`.

### 7. Focus, fullscreen, and scrolling

- Workspace focus temporarily fills the workspace with one pane while retaining the tree. It is distinct from global `zenMode` and Terminal immersive mode.
- A hosted page gets its own scroll container; `MainLayout` cannot remain the sole scroll owner for workspaces.
- Page roots use container height/width rather than viewport dimensions. Refactor only pages that fail this contract.
- Fixed or portaled UI remains application-global unless a later requirement makes it pane-local.

## Page compatibility rollout

| Page class | Initial policy | Work needed |
|---|---|---|
| Dashboard, Calendar, Feeds, Reading, Vocabulary, Documents, Chat, Tools, Settings | Generic React host; conservative singleton first | Audit root height, overflow, fixed overlays, and state collisions; opt into multiples individually |
| Music | Generic/retained singleton | Keep global player and native audio session singular |
| Terminal | Retained singleton adapter | Move visited/visible/maximized lifecycle out of `App.tsx`; pane focus must not destroy PTYs |
| Browser | Native singleton on Electron; normal web adapter where supported | Measure pane bounds; hide/snapshot during overlays and drags; preserve tabs |
| DSH | Native singleton adapter | Measure pane bounds; preserve blocker behavior and process state |

For version 1, the picker disables an already-hosted singleton and offers “Move here.” Enable multiple instances page-by-page only after local and Zustand state are proven instance-scoped.

## Implementation phases

### Phase 0 — Contract tests and native-panel spike

1. Add focused tests around current retained Tools/Terminal behavior.
2. Prototype Browser and DSH bounds driven by a nested DOM rectangle; verify resizing, sidebar collapse, dialogs, drag overlays, and display scaling in Electron.
3. Confirm web-host capability behavior and unavailable messages.
4. If a native view cannot be reliably constrained, ship React workspaces first and leave that page disabled.

Exit criterion: one nested native page follows its pane without covering pane chrome or dialogs.

### Phase 1 — Extract page catalog and host

1. Move lazy page definitions from `App.tsx` into the catalog.
2. Render ordinary full-page navigation through `PageHost` without visible behavior changes.
3. Move retained Terminal/Tools lifecycle into adapters.
4. Make `Sidebar.tsx` and `MobileNavDock.tsx` consume catalog metadata and capability rules.
5. Add catalog completeness tests for every `NavPage`.

Exit criterion: all existing pages navigate, retain state, lazy-load, and pass current tests through the new seam.

### Phase 2 — Model and persistence

1. Implement split-tree operations and normalization.
2. Add workspace store, versioned decoder, cache, and durable adapter.
3. Extend navigation while retaining current `navigate` compatibility.
4. Add create, rename, reorder, duplicate, delete, reset, and Undo actions.
5. Add sidebar workspace entries and the blank workspace screen.

Exit criterion: named blank workspaces survive restart and corrupt persisted data recovers safely.

### Phase 3 — React pages, splitting, and resizing

1. Build `WorkspacePage`, recursive `SplitLayout`, `WorkspacePane`, pane header, and picker.
2. Add picker placement, then drag from sidebar.
3. Add pane moves, five drop zones, resizing, focus, open-full-page, and close/collapse behavior.
4. Add Edit mode, keyboard/menu alternatives, minimum sizes, depth cap, and compact pane switching.
5. Audit and adapt each ordinary React page against the host contract.

Exit criterion: users can build, resize, rearrange, reopen, and persist mixed React-page workspaces without losing page state during layout edits.

### Phase 4 — Retained and native pages

1. Integrate Terminal and map embedded maximize to pane focus.
2. Integrate Browser with measured bounds, overlay blocking, hide/snapshot behavior, and singleton relocation.
3. Integrate DSH while preserving its blocker store and process state.
4. Verify Music/global-player semantics and make its singleton policy explicit.

Exit criterion: Terminal, Browser, DSH, and Music move between full-page and workspace hosts without session loss or native surfaces covering workspace UI.

### Phase 5 — Polish and release hardening

1. Add English and Chinese i18n.
2. Add empty, loading, failed-page, unavailable-page, and corrupt-layout recovery states.
3. Add first-use guidance while preserving the blank default.
4. Measure chunks and memory; keep unvisited pages unloaded and cap retained instances.
5. Verify accessibility, reduced motion, keyboard flows, and desktop/web responsiveness.

## Likely files changed

Existing areas:

- `app/src/App.tsx`
- `app/src/store/navStore.ts`
- `app/src/store/layoutStore.ts`
- `app/src/components/Layout/{Sidebar,MobileNavDock,CommandBar}.tsx`
- `app/src/components/Terminal/TerminalPage.tsx`
- `app/src/components/Browser/BrowserPage.tsx` and panel hook
- `app/src/components/Dsh/DshPage.tsx` and panel hook
- `app/src/store/{browserPanelStore,dshPanelBlockStore}.ts`
- `app/src/store/settings/` persistence helpers
- `app/src/i18n/en/` and `app/src/i18n/zh/`
- `app/package.json` and lockfile if a drag dependency is added

New areas:

- `app/src/pages/`
- `app/src/pages/adapters/`
- `app/src/workspaces/`
- `app/src/store/workspaceStore.ts`
- `app/src/components/Workspaces/`

## Testing strategy

### Pure model tests

- Each edge split produces the correct tree and visual order.
- Moves across branches do not duplicate IDs.
- Removing a pane collapses redundant ancestors.
- Ratios, nesting depth, minimums, and malformed documents normalize correctly.
- Singleton placement relocates instead of cloning.
- Version migration and corrupt JSON recovery are deterministic.

### Module and UI tests

- Create/rename/reorder/delete/reset, persistence, and Undo.
- Catalog completeness, capability filtering, multiplicity, and lazy-load failures.
- Existing `navigate(page)` callers still reach full-page destinations.
- Picker add, sidebar drag, every edge, center swap, resize, focus, close, and reload persistence.
- Menu and keyboard alternatives match drag outcomes.
- Compact mode switches panes without changing the desktop tree.
- Suspended or failed pages do not break siblings.
- Dialogs and drag overlays correctly block native panels.

### Desktop/manual matrix

- Electron macOS, Windows, and Linux: Browser/DSH bounds, window resize/maximize, sidebar collapse, and display scale.
- Terminal survival while navigating, moving, focusing, and reopening.
- Web-host filtering and fallbacks.
- Backgrounds, mobile dock, podcast player, lock screen, global modals, and zen mode.

### Verification commands

```bash
cd app
bun run typecheck
bun run test:run
bun run build
```

Run focused Electron smoke tests after Phases 0 and 4; jsdom cannot validate native `WebContentsView` layering or bounds.

## Acceptance criteria

1. A user can create and name a blank workspace from navigation.
2. A user can add an available built-in page without editing configuration files.
3. Dragging to any pane edge creates the expected split; resizing respects useful minimums.
4. Page placement and ratios restore after restart.
5. Normal full-page navigation behaves as before.
6. Layout edits do not reset retained page state.
7. Singleton/native pages cannot be duplicated and relocate without losing sessions.
8. Browser/DSH surfaces never cover headers, dialogs, pickers, or drag overlays.
9. The feature is fully operable without drag-and-drop.
10. Every pane remains reachable and usable on compact screens.

## Main risks and controls

| Risk | Control |
|---|---|
| Native Browser/DSH views render above HTML | Validate first; dedicated bounds adapter; hide/snapshot while overlays or drags are active |
| Existing pages assume one viewport/scroll owner | Introduce `PageHost` first; audit roots incrementally; keep context small |
| Duplicate pages share singleton/global state | Default to singleton; opt into multiple instances only after state is scoped |
| Drag conflicts with editors and selection | Explicit Edit mode, header handles, drop overlays, menu/keyboard equivalents |
| Layout JSON becomes invalid | Version, decode, migrate, normalize, safe fallback, and test |
| `App.tsx` grows more complex | Put catalog, lifecycle, operations, and persistence behind module interfaces |
| Mounted pages increase memory/startup cost | Preserve lazy loading, retain only required pages, cap nesting and instances |

## Recommended delivery slices

Ship behind a disabled-by-default feature flag until Phase 3 is stable:

1. **Foundation:** catalog and full-page host, no visible workspace feature.
2. **React workspace beta:** named workspaces, generic React pages, split/resize/persist.
3. **Native workspace beta:** Terminal, Browser, DSH, and Music adapters.
4. **General release:** compact mode, accessibility, recovery, performance, and polish.

This order preserves the current application at each step and creates one reusable page-host seam instead of a second parallel page system.
