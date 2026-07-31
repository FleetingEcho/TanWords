import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  download: vi.fn().mockResolvedValue(undefined),
  relaunch: vi.fn(),
}));

vi.mock("@/ipc/updater", () => ({
  checkForUpdate: mocks.check,
  downloadAndInstall: mocks.download,
}));
vi.mock("@/ipc/app", () => ({ relaunch: mocks.relaunch }));

import { useUpdaterStore } from "./updaterStore";

function makeUpdate(overrides: Partial<{ version: string; notes: string }> = {}) {
  return {
    version: overrides.version ?? "0.2.0",
    notes: overrides.notes ?? "notes",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.download.mockResolvedValue(undefined);
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
    mocks.check.mockResolvedValue(makeUpdate({ version: "0.2.0", notes: "hello" }));
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
    mocks.download.mockImplementation(async (onProgress: (p: unknown) => void) => {
      onProgress({ percent: 50, transferred: 100, total: 200 });
      onProgress({ percent: 100, transferred: 200, total: 200 });
    });
    mocks.check.mockResolvedValue(makeUpdate());

    await useUpdaterStore.getState().checkForUpdate();
    await useUpdaterStore.getState().downloadAndInstall();

    const s = useUpdaterStore.getState();
    expect(s.status).toBe("ready");
    expect(s.progress).toBe(100);
  });

  it("returns to available with the error on download failure", async () => {
    mocks.download.mockRejectedValue(new Error("bad signature"));
    mocks.check.mockResolvedValue(makeUpdate());

    await useUpdaterStore.getState().checkForUpdate();
    await useUpdaterStore.getState().downloadAndInstall();

    const s = useUpdaterStore.getState();
    expect(s.status).toBe("available");
    expect(s.error).toContain("bad signature");
    expect(s.progress).toBe(0);
  });

  it("is a no-op unless an update is available", async () => {
    await useUpdaterStore.getState().downloadAndInstall();
    expect(useUpdaterStore.getState().status).toBe("idle");
    expect(mocks.download).not.toHaveBeenCalled();
  });
});

describe("restart", () => {
  it("relaunches the app", async () => {
    await useUpdaterStore.getState().restart();
    expect(mocks.relaunch).toHaveBeenCalled();
  });
});
