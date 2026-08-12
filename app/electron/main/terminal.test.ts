import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class FakeEmitter {
    private handlers = new Map<string, Array<(...args: any[]) => void>>();

    on(name: string, handler: (...args: any[]) => void) {
      const list = this.handlers.get(name) ?? [];
      list.push(handler);
      this.handlers.set(name, list);
      return this;
    }

    emit(name: string, ...args: any[]) {
      for (const handler of this.handlers.get(name) ?? []) handler(...args);
      return true;
    }
  }

  class FakeStream extends FakeEmitter {
    destroyed = false;
    writableLength = 0;
    write = vi.fn(() => true);
    pause = vi.fn();
    resume = vi.fn();
  }

  class FakeChild extends FakeEmitter {
    stdin = new FakeStream();
    stdout = new FakeStream();
    stderr = new FakeStream();
    killed = false;
    kill = vi.fn(() => {
      this.killed = true;
      return true;
    });
  }

  const children: FakeChild[] = [];
  return {
    children,
    spawn: vi.fn(() => {
      const child = new FakeChild();
      children.push(child);
      return child;
    }),
  };
});

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => "/app",
  },
}));

vi.mock("node:child_process", () => ({
  default: {
    spawn: mocks.spawn,
    spawnSync: vi.fn(),
  },
  spawn: mocks.spawn,
  spawnSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: () => true,
    statSync: (file: string) => ({ mtimeMs: file.includes("debug") ? 2 : 1 }),
  },
}));

import {
  setTerminalEventSink,
  terminalSetOutputPaused,
  terminalSetOutputSuppressed,
  terminalShutdownAll,
  terminalSpawn,
} from "./terminal";

function frame(op: number, payload: Buffer) {
  const header = Buffer.alloc(5);
  header[0] = op;
  header.writeUInt32LE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

async function spawnReady() {
  const pending = terminalSpawn({ cols: 80, rows: 24 });
  const child = mocks.children.at(-1)!;
  child.stdout.emit("data", frame(0x48, Buffer.from(JSON.stringify({
    shell: "/bin/zsh",
    cwd: "/tmp",
    pid: 42,
  }))));
  const info = await pending;
  return { child, info };
}

beforeEach(() => {
  mocks.children.length = 0;
  vi.clearAllMocks();
  setTerminalEventSink(() => {});
  terminalSetOutputPaused(false);
});

afterEach(() => {
  terminalShutdownAll();
  vi.useRealTimers();
});

describe("terminal main-process failure isolation", () => {
  it("turns a broken stdin pipe into one recoverable exit event", async () => {
    const events: Array<{ name: string; payload: any }> = [];
    setTerminalEventSink((name, payload) => events.push({ name, payload }));
    const { child, info } = await spawnReady();

    child.stdin.emit("error", new Error("write EPIPE"));
    child.emit("close", 1, null);

    expect(child.kill).toHaveBeenCalledOnce();
    expect(events).toEqual([{
      name: "pty:exit",
      payload: { id: info.id, code: 1, error: "write EPIPE" },
    }]);
  });

  it("rejects and kills a helper that sends an oversized frame", async () => {
    const pending = terminalSpawn({});
    const child = mocks.children.at(-1)!;
    const header = Buffer.alloc(5);
    header[0] = 0x44;
    header.writeUInt32LE(1024 * 1024 + 1, 1);

    child.stdout.emit("data", header);

    await expect(pending).rejects.toThrow("daemon frame exceeds");
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("rejects an exit frame that arrives before the handshake", async () => {
    const pending = terminalSpawn({});
    const child = mocks.children.at(-1)!;

    child.stdout.emit("data", frame(0x58, Buffer.from('{"code":0}')));

    await expect(pending).rejects.toThrow("shell exited before the PTY was ready");
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("fails a helper that never handshakes instead of starting forever", async () => {
    vi.useFakeTimers();
    const pending = terminalSpawn({});
    const child = mocks.children.at(-1)!;
    const rejected = expect(pending).rejects.toThrow("did not become ready within 5000ms");

    await vi.advanceTimersByTimeAsync(5_000);

    await rejected;
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("pauses and resumes helper output when the renderer is unresponsive", async () => {
    const { child } = await spawnReady();

    terminalSetOutputPaused(true);
    terminalSetOutputPaused(false);

    expect(child.stdout.pause).toHaveBeenCalledOnce();
    expect(child.stdout.resume).toHaveBeenCalledOnce();
  });

  it("drains but does not forward output while one flooded session catches up", async () => {
    const events: Array<{ name: string; payload: any }> = [];
    setTerminalEventSink((name, payload) => events.push({ name, payload }));
    const { child, info } = await spawnReady();

    terminalSetOutputSuppressed(info.id, true);
    child.stdout.emit("data", frame(0x44, Buffer.from("discarded flood")));
    terminalSetOutputSuppressed(info.id, false);
    child.stdout.emit("data", frame(0x44, Buffer.from("visible output")));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: "pty:data", payload: { id: info.id } });
    expect(Buffer.from(events[0].payload.data, "base64").toString()).toBe("visible output");
  });
});
