import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

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
