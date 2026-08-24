import { describe, expect, it, beforeEach, vi } from "vitest";
import { useWorkspaceStore, isPageAvailableOnHost } from "./workspaceStore";
import { useNavStore } from "./navStore";
import {
  cachedWorkspaces,
  cacheWorkspaces,
  WORKSPACES_CACHE_KEY,
  WORKSPACES_DURABLE_KEY,
} from "@/workspaces/persistence";
import { collectPaneIds, findPane, paneCount } from "@/workspaces/normalization";
import { panesHostingPage } from "@/workspaces/operations";
import type { NavPage } from "./navStore";

// The store calls into the durable adapter; stub the dynamic ipc import so
// tests don't hit the rejected-promise backend. `saveSetting` falls back to
// localStorage under `tanwords_<key>`, which is fine for these tests.
vi.mock("@/ipc/backend", () => ({
  invoke: vi.fn(async () => null as string | null),
}));

function reset() {
  useWorkspaceStore.setState({
    workspaces: [],
    loaded: false,
    activeWorkspaceId: null,
    focusedPaneId: null,
    selectedPaneId: null,
    editMode: false,
    undoCheckpoint: null,
  });
  useNavStore.setState({ activeWorkspaceId: null });
  localStorage.removeItem(WORKSPACES_CACHE_KEY);
  localStorage.removeItem(`tanwords_${WORKSPACES_DURABLE_KEY}`);
}

beforeEach(reset);

describe("workspaceStore CRUD", () => {
  it("create adds a titled single-empty-pane workspace and selects it", () => {
    const id = useWorkspaceStore.getState().create("First");
    const ws = useWorkspaceStore.getState().activeWorkspace();
    expect(ws?.id).toBe(id);
    expect(ws?.title).toBe("First");
    expect(paneCount(ws!.root)).toBe(1);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(id);
  });

  it("rename changes the title", () => {
    const id = useWorkspaceStore.getState().create("A");
    useWorkspaceStore.getState().rename(id, "B");
    expect(useWorkspaceStore.getState().activeWorkspace()?.title).toBe("B");
  });

  it("duplicate copies the tree shape and page ids but regenerates ids", () => {
    const id = useWorkspaceStore.getState().create("Orig");
    useWorkspaceStore.getState().selectWorkspace(id);
    const rootPane = [...collectPaneIds(useWorkspaceStore.getState().activeWorkspace()!.root)][0];
    useWorkspaceStore.getState().split(rootPane, "right", "vocabulary");
    const orig = useWorkspaceStore.getState().activeWorkspace()!;
    const dupId = useWorkspaceStore.getState().duplicate(id, "Copy");
    const dup = useWorkspaceStore.getState().workspaces.find((w) => w.id === dupId)!;
    expect(dup.id).not.toBe(id);
    expect(paneCount(dup.root)).toBe(paneCount(orig.root));
    expect([...collectPaneIds(dup.root)].sort()).not.toEqual([...collectPaneIds(orig.root)].sort());
  });

  it("reorder changes display order and keeps unlisted workspaces at the end", () => {
    const a = useWorkspaceStore.getState().create("A");
    const b = useWorkspaceStore.getState().create("B");
    const c = useWorkspaceStore.getState().create("C");
    useWorkspaceStore.getState().reorder([c, a]);
    const order = useWorkspaceStore.getState().workspaces.map((w) => w.id);
    expect(order).toEqual([c, a, b]);
  });

  it("remove drops a workspace and clears selection if it was active", () => {
    const id = useWorkspaceStore.getState().create("A");
    useWorkspaceStore.getState().selectWorkspace(id);
    useWorkspaceStore.getState().remove(id);
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(0);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
  });

  it("reset returns the workspace to one empty pane keeping its id and title", () => {
    const id = useWorkspaceStore.getState().create("A");
    useWorkspaceStore.getState().selectWorkspace(id);
    const rootPane = [...collectPaneIds(useWorkspaceStore.getState().activeWorkspace()!.root)][0];
    useWorkspaceStore.getState().split(rootPane, "right", "chat");
    useWorkspaceStore.getState().reset(id);
    const ws = useWorkspaceStore.getState().activeWorkspace()!;
    expect(ws.id).toBe(id);
    expect(ws.title).toBe("A");
    expect(paneCount(ws.root)).toBe(1);
    expect(panesHostingPage(ws.root, "chat")).toHaveLength(0);
  });
});

describe("workspaceStore undo", () => {
  it("undo restores the pre-action collection", () => {
    const id = useWorkspaceStore.getState().create("A");
    useWorkspaceStore.getState().selectWorkspace(id);
    const beforeCount = useWorkspaceStore.getState().workspaces.length;
    const rootPane = [...collectPaneIds(useWorkspaceStore.getState().activeWorkspace()!.root)][0];
    useWorkspaceStore.getState().split(rootPane, "right", "chat");
    expect(paneCount(useWorkspaceStore.getState().activeWorkspace()!.root)).toBe(2);
    useWorkspaceStore.getState().undo();
    expect(useWorkspaceStore.getState().workspaces.length).toBe(beforeCount);
    expect(paneCount(useWorkspaceStore.getState().activeWorkspace()!.root)).toBe(1);
  });

  it("undo is a no-op when there is no checkpoint", () => {
    // Start from a reset store: no workspaces, no checkpoint. Undo must leave
    // the state untouched. (create() *does* set a checkpoint, so we don't
    // create here.)
    expect(useWorkspaceStore.getState().undoCheckpoint).toBeNull();
    const before = useWorkspaceStore.getState().workspaces;
    useWorkspaceStore.getState().undo();
    expect(useWorkspaceStore.getState().workspaces).toBe(before);
  });
});

describe("workspaceStore pane operations", () => {
  it("caps a workspace at four panes", () => {
    const id = useWorkspaceStore.getState().create("A");
    useWorkspaceStore.getState().selectWorkspace(id);
    for (let i = 0; i < 4; i += 1) {
      const target = useWorkspaceStore.getState().selectedPaneId
        ?? [...collectPaneIds(useWorkspaceStore.getState().activeWorkspace()!.root)][0];
      useWorkspaceStore.getState().splitEmpty(target, "right");
    }
    expect(paneCount(useWorkspaceStore.getState().activeWorkspace()!.root)).toBe(4);
  });

  it("split adds a pane hosting the page", () => {
    const id = useWorkspaceStore.getState().create("A");
    useWorkspaceStore.getState().selectWorkspace(id);
    const rootPane = [...collectPaneIds(useWorkspaceStore.getState().activeWorkspace()!.root)][0];
    useWorkspaceStore.getState().split(rootPane, "right", "vocabulary");
    const ws = useWorkspaceStore.getState().activeWorkspace()!;
    expect(paneCount(ws.root)).toBe(2);
    expect(panesHostingPage(ws.root, "vocabulary")).toHaveLength(1);
  });

  it("place fills an empty pane", () => {
    const id = useWorkspaceStore.getState().create("A");
    useWorkspaceStore.getState().selectWorkspace(id);
    const rootPane = [...collectPaneIds(useWorkspaceStore.getState().activeWorkspace()!.root)][0];
    useWorkspaceStore.getState().place(rootPane, "dashboard");
    expect((findPane(useWorkspaceStore.getState().activeWorkspace()!.root, rootPane) as any).content.pageId).toBe("dashboard");
  });

  it("closePane collapses the split and never leaves a workspace paneless", () => {
    const id = useWorkspaceStore.getState().create("A");
    useWorkspaceStore.getState().selectWorkspace(id);
    const ws = useWorkspaceStore.getState().activeWorkspace()!;
    const rootPane = [...collectPaneIds(ws.root)][0];
    useWorkspaceStore.getState().split(rootPane, "right", "chat");
    const after = useWorkspaceStore.getState().activeWorkspace()!;
    const chatPane = panesHostingPage(after.root, "chat")[0];
    useWorkspaceStore.getState().closePane(chatPane);
    expect(paneCount(useWorkspaceStore.getState().activeWorkspace()!.root)).toBe(1);
    // Closing the last pane keeps one empty pane.
    const lastPane = [...collectPaneIds(useWorkspaceStore.getState().activeWorkspace()!.root)][0];
    useWorkspaceStore.getState().closePane(lastPane);
    expect(paneCount(useWorkspaceStore.getState().activeWorkspace()!.root)).toBe(1);
  });

  it("resize updates the split ratio (debounced, no checkpoint)", () => {
    const id = useWorkspaceStore.getState().create("A");
    useWorkspaceStore.getState().selectWorkspace(id);
    const rootPane = [...collectPaneIds(useWorkspaceStore.getState().activeWorkspace()!.root)][0];
    useWorkspaceStore.getState().split(rootPane, "right", "chat");
    const ws = useWorkspaceStore.getState().activeWorkspace()!;
    if (ws.root.kind !== "split") throw new Error("expected split");
    const splitId = ws.root.id;
    const cpBefore = useWorkspaceStore.getState().undoCheckpoint;
    useWorkspaceStore.getState().resize(splitId, 0.7);
    const after = useWorkspaceStore.getState().activeWorkspace()!;
    if (after.root.kind !== "split") throw new Error("expected split");
    expect(after.root.ratio).toBe(0.7);
    // Debounced resize must NOT replace the structural undo checkpoint.
    expect(useWorkspaceStore.getState().undoCheckpoint).toBe(cpBefore);
  });
});

describe("workspaceStore singleton rule across workspaces", () => {
  it("placing a singleton in a second workspace removes it from the first", () => {
    const a = useWorkspaceStore.getState().create("A");
    useWorkspaceStore.getState().selectWorkspace(a);
    const aRoot = [...collectPaneIds(useWorkspaceStore.getState().activeWorkspace()!.root)][0];
    useWorkspaceStore.getState().place(aRoot, "vocabulary");
    const b = useWorkspaceStore.getState().create("B");
    useWorkspaceStore.getState().selectWorkspace(b);
    const bRoot = [...collectPaneIds(useWorkspaceStore.getState().activeWorkspace()!.root)][0];
    useWorkspaceStore.getState().place(bRoot, "vocabulary");
    // A should no longer host vocabulary; B should.
    const aWs = useWorkspaceStore.getState().workspaces.find((w) => w.id === a)!;
    const bWs = useWorkspaceStore.getState().workspaces.find((w) => w.id === b)!;
    expect(panesHostingPage(aWs.root, "vocabulary")).toHaveLength(0);
    expect(panesHostingPage(bWs.root, "vocabulary")).toHaveLength(1);
  });

  it("splitting a singleton into a second pane relocates it", () => {
    const id = useWorkspaceStore.getState().create("A");
    useWorkspaceStore.getState().selectWorkspace(id);
    const rootPane = [...collectPaneIds(useWorkspaceStore.getState().activeWorkspace()!.root)][0];
    useWorkspaceStore.getState().place(rootPane, "vocabulary");
    useWorkspaceStore.getState().split(rootPane, "right", "vocabulary");
    // Only one pane hosts vocabulary after the split.
    expect(panesHostingPage(useWorkspaceStore.getState().activeWorkspace()!.root, "vocabulary")).toHaveLength(1);
  });

  it("singletonLocations lists every pane hosting the page across workspaces", () => {
    const a = useWorkspaceStore.getState().create("A");
    useWorkspaceStore.getState().selectWorkspace(a);
    const aRoot = [...collectPaneIds(useWorkspaceStore.getState().activeWorkspace()!.root)][0];
    useWorkspaceStore.getState().place(aRoot, "chat");
    const locs = useWorkspaceStore.getState().singletonLocations("chat");
    expect(locs).toHaveLength(1);
    expect(locs[0].workspaceId).toBe(a);
  });
});

describe("workspaceStore availability + persistence", () => {
  it("isPageAvailableOnHost reflects capability gating", () => {
    // On the test host (web-like), the four gated pages are unavailable.
    expect(isPageAvailableOnHost("dashboard" as NavPage)).toBe(true);
    expect(isPageAvailableOnHost("settings" as NavPage)).toBe(true);
    expect(isPageAvailableOnHost("browser" as NavPage)).toBe(false);
    expect(isPageAvailableOnHost("music" as NavPage)).toBe(false);
    expect(isPageAvailableOnHost("terminal" as NavPage)).toBe(false);
    expect(isPageAvailableOnHost("dsh" as NavPage)).toBe(false);
  });

  it("structural actions write the cache synchronously", () => {
    const id = useWorkspaceStore.getState().create("A");
    useWorkspaceStore.getState().selectWorkspace(id);
    const cached = cachedWorkspaces();
    expect(cached.collection.workspaces).toHaveLength(1);
    expect(cached.collection.workspaces[0].id).toBe(id);
  });

  it("creating a workspace writes the encoded collection to the database settings row", async () => {
    const backend = await import("@/ipc/backend");
    const invoke = backend.invoke as any;
    invoke.mockClear();

    const id = useWorkspaceStore.getState().create("Database workspace");

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "db_set_setting",
        expect.objectContaining({ key: WORKSPACES_DURABLE_KEY }),
      );
    });
    const write = invoke.mock.calls.find(([command]: [string]) => command === "db_set_setting");
    const encoded = JSON.parse(write[1].value);
    expect(encoded.workspaces).toEqual(
      expect.arrayContaining([expect.objectContaining({ id, title: "Database workspace" })]),
    );
  });

  it("does not let a stale startup database read erase a workspace created while loading", async () => {
    const backend = await import("@/ipc/backend");
    const invoke = backend.invoke as any;
    let resolveLoad!: (value: string) => void;
    const pendingLoad = new Promise<string>((resolve) => { resolveLoad = resolve; });
    invoke.mockImplementation((command: string) => {
      if (command === "db_get_setting") return pendingLoad;
      return Promise.resolve(null);
    });

    const init = useWorkspaceStore.getState().init();
    const id = useWorkspaceStore.getState().create("Created during startup");
    resolveLoad(JSON.stringify({ schemaVersion: 1, workspaces: [] }));
    await init;

    expect(useWorkspaceStore.getState().workspaces).toEqual(
      expect.arrayContaining([expect.objectContaining({ id })]),
    );
  });

  it("init reconciles the durable value over the cache", async () => {
    // Seed a cache, then a different durable value, and reconcile.
    cacheWorkspaces({ schemaVersion: 1, workspaces: [] });
    useWorkspaceStore.setState({ workspaces: cachedWorkspaces().collection.workspaces });
    // Stub the durable load to return one workspace.
    const backend = await import("@/ipc/backend");
    (backend.invoke as any).mockImplementation(async (cmd: string) => {
      if (cmd === "db_get_setting") {
        return JSON.stringify({
          schemaVersion: 1,
          workspaces: [{ id: "durable-1", title: "Durable", root: { kind: "pane", id: "p", content: null } }],
        });
      }
      return null;
    });
    await useWorkspaceStore.getState().init();
    expect(useWorkspaceStore.getState().loaded).toBe(true);
    expect(useWorkspaceStore.getState().workspaces.map((w) => w.id)).toEqual(["durable-1"]);
  });

  it("init flags recovery when the durable value is corrupt", async () => {
    useWorkspaceStore.setState({ loaded: false, recoveredFromCorrupt: false });
    const backend = await import("@/ipc/backend");
    (backend.invoke as any).mockImplementation(async (cmd: string) => {
      if (cmd === "db_get_setting") {
        // Unparseable JSON — the durable value is corrupt.
        return "{not valid json";
      }
      return null;
    });
    await useWorkspaceStore.getState().init();
    expect(useWorkspaceStore.getState().recoveredFromCorrupt).toBe(true);
  });

  it("init does not flag recovery for a clean durable value", async () => {
    useWorkspaceStore.setState({ loaded: false, recoveredFromCorrupt: false });
    const backend = await import("@/ipc/backend");
    (backend.invoke as any).mockImplementation(async (cmd: string) => {
      if (cmd === "db_get_setting") {
        return JSON.stringify({ schemaVersion: 1, workspaces: [] });
      }
      return null;
    });
    await useWorkspaceStore.getState().init();
    expect(useWorkspaceStore.getState().recoveredFromCorrupt).toBe(false);
  });

  it("acknowledgeRecovery clears the recovery flag", async () => {
    useWorkspaceStore.setState({ recoveredFromCorrupt: true });
    useWorkspaceStore.getState().acknowledgeRecovery();
    expect(useWorkspaceStore.getState().recoveredFromCorrupt).toBe(false);
  });
});
