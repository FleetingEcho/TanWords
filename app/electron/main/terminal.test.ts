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
    spawn: vi.fn((..._args: any[]) => {
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
    getVersion: () => "1.18.8",
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
  terminalSetOutputBackpressure,
  terminalSetOutputPaused,
  terminalShutdownAll,
  terminalSpawn,
  terminalResize,
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
  vi.unstubAllEnvs();
});

describe("terminal main-process failure isolation", () => {
  it("advertises TanWords capabilities instead of inheriting its launcher terminal", async () => {
    vi.stubEnv("TERM", "screen-256color");
    vi.stubEnv("TERM_PROGRAM", "Apple_Terminal");
    vi.stubEnv("TMUX", "/tmp/tmux/default,1,0");
    vi.stubEnv("KITTY_WINDOW_ID", "42");

    await spawnReady();

    const options = mocks.spawn.mock.calls.at(-1)?.[2] as { env: NodeJS.ProcessEnv };
    expect(options.env).toMatchObject({
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      TERM_PROGRAM: "TanWords",
      TERM_PROGRAM_VERSION: "1.18.8",
      PTY_COLS: "80",
      PTY_ROWS: "24",
      PTY_PIXEL_WIDTH: "0",
      PTY_PIXEL_HEIGHT: "0",
    });
    expect(options.env).not.toHaveProperty("TMUX");
    expect(options.env).not.toHaveProperty("KITTY_WINDOW_ID");
  });

  it("forwards logical viewport dimensions to the PTY", async () => {
    const pending = terminalSpawn({
      cols: 100,
      rows: 30,
      pixelWidth: 2000,
      pixelHeight: 1200,
    });
    const child = mocks.children.at(-1)!;
    child.stdout.emit("data", frame(0x48, Buffer.from(JSON.stringify({
      shell: "/bin/zsh",
      cwd: "/tmp",
      pid: 42,
    }))));
    const info = await pending;

    const options = mocks.spawn.mock.calls.at(-1)?.[2] as { env: NodeJS.ProcessEnv };
    expect(options.env).toMatchObject({
      PTY_COLS: "100",
      PTY_ROWS: "30",
      PTY_PIXEL_WIDTH: "2000",
      PTY_PIXEL_HEIGHT: "1200",
    });

    terminalResize(info.id, 120, 40, 2400, 1600);
    const encoded = (child.stdin.write.mock.calls as unknown[][]).at(-1)?.[0] as Buffer;
    expect(encoded[0]).toBe(0x52);
    expect(encoded.readUInt32LE(1)).toBe(16);
    expect([
      encoded.readUInt32LE(5),
      encoded.readUInt32LE(9),
      encoded.readUInt32LE(13),
      encoded.readUInt32LE(17),
    ]).toEqual([120, 40, 2400, 1600]);
  });

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

  it("pauses one flooded session without discarding its output", async () => {
    const events: Array<{ name: string; payload: any }> = [];
    setTerminalEventSink((name, payload) => events.push({ name, payload }));
    const { child, info } = await spawnReady();

    terminalSetOutputBackpressure(info.id, true);
    expect(child.stdout.pause).toHaveBeenCalledOnce();

    terminalSetOutputBackpressure(info.id, false);
    expect(child.stdout.resume).toHaveBeenCalledOnce();

    child.stdout.emit("data", frame(0x44, Buffer.from("preserved output")));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: "pty:data", payload: { id: info.id } });
    expect(events[0].payload.data).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(events[0].payload.data).toString()).toBe("preserved output");
  });

  it("does not resume a backpressured session while the whole window is paused", async () => {
    const { child, info } = await spawnReady();

    terminalSetOutputBackpressure(info.id, true);
    terminalSetOutputPaused(true);
    terminalSetOutputBackpressure(info.id, false);

    expect(child.stdout.resume).not.toHaveBeenCalled();

    terminalSetOutputPaused(false);
    expect(child.stdout.resume).toHaveBeenCalledOnce();
  });
});
