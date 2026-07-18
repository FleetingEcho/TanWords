import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));

import { useUpdaterStore } from "./updaterStore";

function makeUpdate(overrides: Partial<{ version: string; body: string }> = {}) {
  return {
    version: overrides.version ?? "0.2.0",
    body: overrides.body ?? "notes",
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useUpdaterStore.setState({
    status: "idle",
    version: null,
    notes: null,
    progress: 0,
    error: null,
  });
});

describe("checkForUpdate", () => {
  it("goes available with version and notes when an update exists", async () => {
    mocks.check.mockResolvedValue(makeUpdate({ version: "0.2.0", body: "hello" }));
    await useUpdaterStore.getState().checkForUpdate();
    const s = useUpdaterStore.getState();
    expect(s.status).toBe("available");
    expect(s.version).toBe("0.2.0");
    expect(s.notes).toBe("hello");
  });

  it("goes upToDate when check returns null", async () => {
    mocks.check.mockResolvedValue(null);
    await useUpdaterStore.getState().checkForUpdate();
    expect(useUpdaterStore.getState().status).toBe("upToDate");
  });

  it("surfaces errors on manual check", async () => {
    mocks.check.mockRejectedValue(new Error("offline"));
    await useUpdaterStore.getState().checkForUpdate();
    const s = useUpdaterStore.getState();
    expect(s.status).toBe("error");
    expect(s.error).toContain("offline");
  });

  it("stays invisible on silent check failure", async () => {
    mocks.check.mockRejectedValue(new Error("offline"));
    await useUpdaterStore.getState().checkForUpdate({ silent: true });
    const s = useUpdaterStore.getState();
    expect(s.status).toBe("idle");
    expect(s.error).toBeNull();
  });

  it("does not re-enter while downloading", async () => {
    mocks.check.mockResolvedValue(makeUpdate());
    await useUpdaterStore.getState().checkForUpdate();
    useUpdaterStore.setState({ status: "downloading" });
    await useUpdaterStore.getState().checkForUpdate();
    expect(mocks.check).toHaveBeenCalledTimes(1);
  });
});

describe("downloadAndInstall", () => {
  it("tracks progress events and lands on ready", async () => {
    const update = makeUpdate();
    update.downloadAndInstall.mockImplementation(async (onEvent: (e: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 200 } });
      onEvent({ event: "Progress", data: { chunkLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 100 } });
      onEvent({ event: "Finished" });
    });
    mocks.check.mockResolvedValue(update);

    await useUpdaterStore.getState().checkForUpdate();
    await useUpdaterStore.getState().downloadAndInstall();

    const s = useUpdaterStore.getState();
    expect(s.status).toBe("ready");
    expect(s.progress).toBe(100);
  });

  it("returns to available with the error on download failure", async () => {
    const update = makeUpdate();
    update.downloadAndInstall.mockRejectedValue(new Error("bad signature"));
    mocks.check.mockResolvedValue(update);

    await useUpdaterStore.getState().checkForUpdate();
    await useUpdaterStore.getState().downloadAndInstall();

    const s = useUpdaterStore.getState();
    expect(s.status).toBe("available");
    expect(s.error).toContain("bad signature");
    expect(s.progress).toBe(0);
  });

  it("is a no-op without a pending update", async () => {
    await useUpdaterStore.getState().downloadAndInstall();
    expect(useUpdaterStore.getState().status).toBe("idle");
  });
});

describe("restart", () => {
  it("relaunches the app", async () => {
    await useUpdaterStore.getState().restart();
    expect(mocks.relaunch).toHaveBeenCalled();
  });
});
