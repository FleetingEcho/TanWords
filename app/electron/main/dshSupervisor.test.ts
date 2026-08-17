import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";

const spawn = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ default: { spawn }, spawn }));
vi.mock("node:fs", () => ({
  default: {
    existsSync: () => true,
    statSync: () => ({ isFile: () => true }),
  },
}));

import { DshSupervisor } from "./dshSupervisor";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("DshSupervisor", () => {
  it("reuses the standard DSH Web host instead of starting a concurrent session writer", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      type: "server-response",
      rpcId: "tanwords-dsh-probe",
      result: {
        ok: true,
        value: {
          version: "0.0.1",
          cwd: "/workspace",
          attachedSessions: 1,
          canOpenPath: true,
        },
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);

    const events: unknown[] = [];
    const supervisor = new DshSupervisor();
    supervisor.setEventSink((_name, payload) => events.push(payload));

    await expect(supervisor.start(0)).resolves.toBe("http://127.0.0.1:3080");
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3080/api/host.describe",
      expect.objectContaining({ method: "POST" }),
    );
    expect(spawn).not.toHaveBeenCalled();
    expect(events).toContainEqual({ status: "ready", url: "http://127.0.0.1:3080" });
  });

  it("binds its own host to the standard port when no reusable host exists", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connection refused"); }));
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => true),
    });
    spawn.mockReturnValueOnce(child);

    const supervisor = new DshSupervisor();
    const ready = supervisor.start(0);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    expect(spawn.mock.calls[0]?.[1]).toEqual([
      "--profile", "web", "--host", "127.0.0.1", "--port", "3080",
    ]);

    child.stdout.write("dsh web: http://127.0.0.1:3080\n");
    await expect(ready).resolves.toBe("http://127.0.0.1:3080");
    child.stdout.destroy();
    child.stderr.destroy();
    child.stdin.destroy();
  });

  it("adds the dsh launcher's directory to PATH so env can find its Node runtime", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connection refused"); }));
    vi.stubEnv("DSH_BIN", path.join(path.sep, "opt", "dsh-node", "bin", "dsh"));
    vi.stubEnv("PATH", [path.join(path.sep, "usr", "bin"), path.join(path.sep, "bin")].join(path.delimiter));
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => true),
    });
    spawn.mockReturnValueOnce(child);

    const supervisor = new DshSupervisor();
    const ready = supervisor.start(0);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());

    const spawnOptions = spawn.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv };
    expect(spawnOptions.env?.PATH?.split(path.delimiter)[0]).toBe(
      path.join(path.sep, "opt", "dsh-node", "bin"),
    );
    expect(spawnOptions.env?.PATH).toContain(path.join(path.sep, "usr", "bin"));

    child.stdout.write("dsh web: http://127.0.0.1:3080\n");
    await expect(ready).resolves.toBe("http://127.0.0.1:3080");
    child.stdout.destroy();
    child.stderr.destroy();
    child.stdin.destroy();
  });

  it("does not bypass a standard DSH writer when a custom port is configured", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input).startsWith("http://127.0.0.1:4123/")) {
        throw new Error("nothing on the custom port");
      }
      return new Response(JSON.stringify({
        type: "server-response",
        rpcId: "tanwords-dsh-probe",
        result: {
          ok: true,
          value: {
            version: "0.0.1",
            cwd: "/workspace",
            attachedSessions: 1,
            canOpenPath: true,
          },
        },
      }));
    });
    vi.stubGlobal("fetch", fetch);

    const supervisor = new DshSupervisor();
    await expect(supervisor.start(4123)).resolves.toBe("http://127.0.0.1:3080");

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("DshSupervisor session polling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits dsh:task-finished when a session goes running → idle between polls", async () => {
    let sessions: Array<{ sessionId: string; running: boolean }> = [{ sessionId: "s1", running: true }];
    vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
      const bodyStr = String(init?.body ?? "");
      if (bodyStr.includes("\"host.describe\"")) {
        return new Response(JSON.stringify({
          type: "server-response",
          rpcId: "tanwords-dsh-probe",
          result: {
            ok: true,
            value: { version: "0.0.1", cwd: "/workspace", attachedSessions: 1, canOpenPath: true },
          },
        }));
      }
      return new Response(JSON.stringify({ result: { ok: true, value: { items: sessions } } }));
    }));

    const events: Array<[string, unknown]> = [];
    const supervisor = new DshSupervisor();
    supervisor.setEventSink((name, payload) => events.push([name, payload]));
    // Fake timers must be active *before* the poll's setInterval is created
    // (inside start(), on reaching "ready") — installed after the fact,
    // vitest's fake clock never sees a timer that's already running for real.
    vi.useFakeTimers();
    await expect(supervisor.start(0)).resolves.toBe("http://127.0.0.1:3080");

    // First poll only seeds the map — the session was already running, not a
    // transition, so nothing fires yet.
    await vi.advanceTimersByTimeAsync(4000);
    expect(events.some(([name]) => name === "dsh:task-finished")).toBe(false);

    sessions = [{ sessionId: "s1", running: false }];
    await vi.advanceTimersByTimeAsync(4000);
    expect(events).toContainEqual(["dsh:task-finished", { sessionId: "s1" }]);
  });

  it("idle-stops the host past the configured threshold once hidden with nothing running, never while something is running", async () => {
    let sessions: Array<{ sessionId: string; running: boolean }> = [{ sessionId: "s1", running: true }];
    vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
      const bodyStr = String(init?.body ?? "");
      if (bodyStr.includes("\"host.describe\"")) throw new Error("no reusable host");
      return new Response(JSON.stringify({ result: { ok: true, value: { items: sessions } } }));
    }));

    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => true),
    });
    spawn.mockReturnValueOnce(child);

    const supervisor = new DshSupervisor();
    // Fake timers must be active before the poll's setInterval is created
    // (on reaching "ready") — see the previous test's note. `vi.waitFor`
    // polls with real timers, so spawn detection here uses a microtask
    // flush instead.
    vi.useFakeTimers();
    const readyPromise = supervisor.start(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(spawn).toHaveBeenCalledOnce();
    child.stdout.write("dsh web: http://127.0.0.1:3080\n");
    await expect(readyPromise).resolves.toBe("http://127.0.0.1:3080");

    supervisor.setIdleStopMinutes(10);
    supervisor.noteVisibility(false);

    // Hidden well past the threshold, but a session is still running — must
    // never idle-stop out from under a live task, no matter how long.
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(child.kill).not.toHaveBeenCalled();

    // Reset the idle clock to "just went idle now" and let the session finish.
    supervisor.noteVisibility(true);
    supervisor.noteVisibility(false);
    sessions = [{ sessionId: "s1", running: false }];

    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.stdout.destroy();
    child.stderr.destroy();
    child.stdin.destroy();
  });
});
