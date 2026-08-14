/** Web-build PTY transport for `TerminalToolRestty.tsx`: the web host has no
 *  local process to spawn a real shell against (see `WEB_CAPABILITIES.terminal`
 *  in `platform/types.ts`), so it runs `just-bash` — an in-browser, sandboxed
 *  bash implementation over a virtual in-memory filesystem — instead of
 *  `createElectronPtyTransport`'s IPC channel. Nothing here ever touches the
 *  server or the visitor's OS; nothing typed can escape the virtual filesystem.
 *
 *  Adapted from restty's own playground example
 *  (`examples/*, playground/app/lib/pty/just-bash-transport.ts`), trimmed of
 *  the playground's demo scripts/tab-completion/animation extras — this is a
 *  plain interactive shell, not a guided tour. */

import type { PtyCallbacks, PtyConnectOptions, PtyResizeMeta, PtyTransport } from "restty";
import type { PtySessionHooks } from "./TerminalToolRestty";

const SANDBOX_SHELL_NAME = "just-bash (sandbox)";

const WELCOME_BANNER = [
  "\x1b[1;36mTanWords Web Terminal\x1b[0m — sandboxed shell (just-bash)",
  "This runs entirely in your browser: an in-memory filesystem, no network,",
  "no access to this device or the server. Try `ls`, `cd`, `cat`, `echo`.",
  "",
].join("\r\n");

const DEFAULT_FILES = {
  "/home/user/README.md": [
    "# TanWords web terminal",
    "",
    "This shell runs in your browser via just-bash — a sandboxed bash",
    "implementation with its own virtual filesystem. It cannot reach your",
    "real device or the TanWords server. The desktop app offers a real",
    "local shell instead; this is the web build's substitute.",
    "",
  ].join("\n"),
};

function normalizeTerminalNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r\n");
}

function formatPrompt(cwd: string): string {
  return `\x1b[38;5;75m${cwd || "/home/user"}\x1b[0m $ `;
}

async function loadJustBash() {
  return await import("just-bash/browser");
}

type JustBashModule = Awaited<ReturnType<typeof loadJustBash>>;
type JustBashInstance = InstanceType<JustBashModule["Bash"]>;

/** A `PtyTransport` backed by `just-bash` instead of a real PTY. Mirrors
 *  `createElectronPtyTransport`'s shape (same `PtySessionHooks`) so
 *  `TerminalToolRestty.tsx` can pick between the two with no other change. */
export function createSandboxPtyTransport(hooks: PtySessionHooks): PtyTransport {
  let bash: JustBashInstance | null = null;
  let callbacks: PtyCallbacks | null = null;
  let connected = false;
  let cwd = "/home/user";
  let env: Record<string, string> = {};
  let inputBuffer = "";
  let history: string[] = [];
  let historyIndex = -1;
  let commandQueue: Promise<void> = Promise.resolve();
  let activeAbortController: AbortController | null = null;
  let connectionToken = 0;

  const write = (text: string) => callbacks?.onData?.(text);
  const writePrompt = () => write(formatPrompt(cwd));

  const clearLine = () => {
    if (inputBuffer.length > 0) write("\b \b".repeat(inputBuffer.length));
  };

  const runCommand = async (commandLine: string, token: number) => {
    const instance = bash;
    if (!instance || !connected || token !== connectionToken) return;
    const trimmed = commandLine.trim();
    if (!trimmed) {
      writePrompt();
      return;
    }
    if (trimmed === "exit" || trimmed === "logout") {
      write("exit\r\n");
      callbacks?.onExit?.(0);
      callbacks?.onDisconnect?.();
      connected = false;
      hooks.onExit(0);
      return;
    }

    activeAbortController = new AbortController();
    try {
      const result = await instance.exec(trimmed, { cwd, env, signal: activeAbortController.signal });
      if (!connected || token !== connectionToken) return;
      if (result.env) {
        env = { ...result.env };
        cwd = result.env.PWD || cwd;
      }
      if (result.stdout) write(normalizeTerminalNewlines(result.stdout));
      if (result.stderr) write(`\x1b[31m${normalizeTerminalNewlines(result.stderr)}\x1b[0m`);
    } catch (error) {
      if (!connected || token !== connectionToken) return;
      const message = error instanceof Error ? error.message : String(error);
      if (message !== "AbortError") write(`\x1b[31m${normalizeTerminalNewlines(message)}\x1b[0m\r\n`);
    } finally {
      if (activeAbortController?.signal.aborted) write("^C\r\n");
      activeAbortController = null;
      if (connected && token === connectionToken) writePrompt();
    }
  };

  const submitInputBuffer = () => {
    const commandLine = inputBuffer;
    inputBuffer = "";
    write("\r\n");
    if (commandLine.trim()) {
      history.push(commandLine);
      if (history.length > 200) history.shift();
    }
    historyIndex = history.length;
    const token = connectionToken;
    commandQueue = commandQueue.then(() => runCommand(commandLine, token));
  };

  const recallHistory = (direction: -1 | 1) => {
    if (history.length === 0) return;
    const next = historyIndex + direction;
    if (next < 0 || next > history.length) return;
    clearLine();
    historyIndex = next;
    inputBuffer = historyIndex === history.length ? "" : history[historyIndex];
    write(inputBuffer);
  };

  const handleControlInput = (data: string): boolean => {
    if (data === "\x03") {
      activeAbortController?.abort();
      if (!activeAbortController) {
        inputBuffer = "";
        write("^C\r\n");
        writePrompt();
      }
      return true;
    }
    if (data === "\x0c") {
      write("\x1b[2J\x1b[H");
      writePrompt();
      return true;
    }
    return false;
  };

  return {
    connect: async ({ callbacks: cb }: PtyConnectOptions) => {
      connectionToken += 1;
      const token = connectionToken;
      callbacks = cb;
      connected = false;
      activeAbortController?.abort();
      activeAbortController = null;

      try {
        const { Bash } = await loadJustBash();
        if (token !== connectionToken) return;
        bash = new Bash({ cwd: "/home/user", files: DEFAULT_FILES });
        cwd = bash.getCwd();
        env = { ...bash.getEnv() };
        inputBuffer = "";
        history = [];
        historyIndex = -1;
        connected = true;
        cb.onStatus?.(SANDBOX_SHELL_NAME);
        cb.onConnect?.();
        hooks.onReady(SANDBOX_SHELL_NAME);
        write(WELCOME_BANNER);
        writePrompt();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        cb.onError?.(message);
        cb.onDisconnect?.();
        hooks.onExit(1, message);
      }
    },
    disconnect: () => {
      connectionToken += 1;
      activeAbortController?.abort();
      activeAbortController = null;
      inputBuffer = "";
      connected = false;
      const cb = callbacks;
      callbacks = null;
      cb?.onDisconnect?.();
    },
    sendInput: (data: string) => {
      if (!connected) return false;
      if (!data) return true;
      if (handleControlInput(data)) return true;

      for (let i = 0; i < data.length; i += 1) {
        const ch = data[i];
        if (ch === "\r" || ch === "\n") {
          submitInputBuffer();
          continue;
        }
        if (ch === "\x7f" || ch === "\b") {
          if (!inputBuffer) continue;
          inputBuffer = inputBuffer.slice(0, -1);
          write("\b \b");
          continue;
        }
        if (ch.charCodeAt(0) === 0x1b) {
          const next = data[i + 1];
          const direction = data[i + 2];
          if (next === "[" && direction === "A") { recallHistory(-1); i += 2; continue; }
          if (next === "[" && direction === "B") { recallHistory(1); i += 2; continue; }
          if (next === "[" && !!direction && "CD".includes(direction)) { i += 2; continue; }
          continue;
        }
        if (ch < " " && ch !== "\t") continue;
        inputBuffer += ch;
        write(ch);
      }
      return true;
    },
    resize: (_cols: number, _rows: number, _meta?: PtyResizeMeta) => connected,
    isConnected: () => connected,
    destroy: () => {
      connectionToken += 1;
      activeAbortController?.abort();
      activeAbortController = null;
      callbacks = null;
      connected = false;
      bash = null;
      inputBuffer = "";
    },
  };
}
