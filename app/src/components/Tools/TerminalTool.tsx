/** Desktop Terminal tool: a local shell over xterm.js.
 *
 *  The renderer is sandboxed (contextIsolation + sandbox), so there is no
 *  Node in here — the shell lives behind `tanwords-pty`, a Rust daemon Electron
 *  main spawns (see electron/main/terminal.ts). This component is only the
 *  front half of the terminal: it renders xterm.js, sends keystrokes/resizes,
 *  and paints the daemon's output. It is hidden on the web build, where no
 *  local process exists to back a shell.
 *
 *  Byte handling is explicit. xterm hands us a UTF-8 *string* on data; the
 *  bridge moves it as base64 so a JSON/structured-clone hop can't mangle a
 *  multi-byte character; and daemon output comes back the same way, decoded
 *  back to bytes and written straight to the buffer (xterm joins split UTF-8
 *  sequences across write calls itself).
 *
 *  Layout: the root fills the page (which sits in a `min-h-0 flex-1
 *  overflow-y-auto` shell from MainLayout), the terminal is `flex-1 min-h-0`
 *  so it takes all the leftover height, and the top-right Maximize toggle runs
 *  the wrapper into browser/electron fullscreen — a ResizeObserver re-fits
 *  xterm whenever that (or any other) layout change moves the viewport. */
import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { ArrowLeft, Maximize2, Minimize2 } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import "@/styles/terminal-tool.css";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { subscribe } from "@/ipc/events";
import { callMain } from "@/ipc/host";

// ── base64 helpers ─────────────────────────────────────────────────────────
const encoder = new TextEncoder();

/** UTF-8 bytes → base64 (for the input direction). */
function b64FromBytes(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** base64 → raw UTF-8 bytes (for the output direction; xterm joins partials). */
function bytesFromB64(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64EncodeUtf8(s: string): string {
  return b64FromBytes(encoder.encode(s));
}

export function TerminalTool({ onBack }: { onBack: () => void }) {
  const t = useT();
  const outerRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  const [status, setStatus] = useState<"starting" | "connected" | "closed" | "error">("starting");
  const [message, setMessage] = useState("");
  // Tracks browser fullscreen separately so the Maximize icon can swap to a
  // Minimize ("exit fullscreen") glyph while the mode is active.
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;

    const term = new Terminal({
      fontSize: 13,
      lineHeight: 1.15,
      cursorBlink: true,
      fontFamily:
        'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      theme: { background: "transparent" },
      scrollback: 4000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    const state = { sessionId: null as string | null };

    // Keep the session in step with this component's lifetime.
    let alive = true;

    // Fullscreen-aware fit: entering/exiting fullscreen changes the viewport
    // size, so refit and re-sync the pty dimensions when it happens.
    const refit = () => {
      fit.fit();
      if (state.sessionId) {
        callMain("pty_resize", { id: state.sessionId, cols: term.cols, rows: term.rows }).catch(() => {});
      }
    };

    const onFsChange = () => {
      if (!alive) return;
      setIsFullscreen(document.fullscreenElement === outerRef.current);
      refit();
    };
    document.addEventListener("fullscreenchange", onFsChange);

    // ── events ────────────────────────────────────────────────────────
    const offs = [
      subscribe<{ id: string; data?: string }>("pty:data", ({ id, data }) => {
        if (state.sessionId !== id || !alive) return;
        if (data) term.write(bytesFromB64(data));
      }),
      subscribe<{ id: string; code?: number }>("pty:exit", ({ id }) => {
        if (state.sessionId !== id || !alive) return;
        setStatus("closed");
        state.sessionId = null;
      }),
    ];

    // ── spawn ─────────────────────────────────────────────────────────
    const spawn = async () => {
      try {
        const info = await callMain<{ id: string; shell: string; cwd: string; pid: number }>(
          "pty_spawn",
          { cols: term.cols, rows: term.rows },
        );
        if (!alive) return;
        state.sessionId = info.id;
        setStatus("connected");
      } catch (err) {
        if (!alive) return;
        setStatus("error");
        setMessage(err instanceof Error ? err.message : String(err));
      }
    };
    void spawn();

    // ── input & resize ────────────────────────────────────────────────
    const onData = term.onData((data) => {
      if (!state.sessionId) return;
      void callMain("pty_write", { id: state.sessionId, data: b64EncodeUtf8(data) }).catch(() => {});
    });
    const onResize = term.onResize(() => {
      if (!state.sessionId) return;
      callMain("pty_resize", { id: state.sessionId, cols: term.cols, rows: term.rows }).catch(() => {});
    });

    // Resize the pty whenever the page layout changes (sidebar toggle, window
    // drag, fullscreen, ...). Observing the shell catches all of those because
    // its box is what xterm sizes to.
    const ro = new ResizeObserver(refit);
    ro.observe(el);

    const onFocus = () => term.focus();
    el.addEventListener("focus", onFocus);

    // ── teardown ──────────────────────────────────────────────────────
    return () => {
      alive = false;
      if (state.sessionId) callMain("pty_close", { id: state.sessionId }).catch(() => {});
      document.removeEventListener("fullscreenchange", onFsChange);
      onData.dispose();
      onResize.dispose();
      ro.disconnect();
      el.removeEventListener("focus", onFocus);
      offs.forEach((off) => off());
      term.dispose();
      if (document.fullscreenElement) void document.exitFullscreen();
    };
  }, []);

  // ── maximize toggle ─────────────────────────────────────────────────
  const toggleFullscreen = () => {
    const host = outerRef.current;
    if (!host) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void host.requestFullscreen?.();
    }
  };

  return (
    <div ref={outerRef} className="terminal-tool-outer h-full w-full">
      <div className="flex h-full animate-fade-in flex-col">
        {/* toolbar */}
        <div className="flex shrink-0 flex-wrap items-center gap-3 px-4 pt-4 pb-3 sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            title={t("toolsPage.back")}
            aria-label={t("toolsPage.back")}
            className="h-9 w-9 shrink-0 rounded-lg text-muted-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-2xl font-bold tracking-tight">
              {t("toolsPage.terminal.title")}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("toolsPage.terminal.description")}
            </p>
          </div>
          <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                status === "connected"
                  ? "bg-emerald-500"
                  : status === "error"
                    ? "bg-red-500"
                    : "bg-amber-500"
              }`}
            />
            {status === "connected"
              ? t("toolsPage.terminal.connected")
              : status === "error"
                ? t("toolsPage.terminal.error")
                : status === "closed"
                  ? t("toolsPage.terminal.closed")
                  : t("toolsPage.terminal.starting")}
          </span>

          {/* fullscreen toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleFullscreen}
            title={isFullscreen ? t("toolsPage.terminal.restore") : t("toolsPage.terminal.maximize")}
            aria-label={isFullscreen ? t("toolsPage.terminal.restore") : t("toolsPage.terminal.maximize")}
            className="h-9 w-9 shrink-0 rounded-lg text-muted-foreground"
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* xterm shell — fills the remaining height */}
        <div
          ref={shellRef}
          tabIndex={0}
          className="terminal-tool-shell min-h-0 flex-1 mx-4 mb-4 overflow-hidden rounded-2xl border border-border bg-[color:rgb(13,17,23)] p-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:mx-6 sm:mb-6"
        >
          {status === "error" && (
            <p className="p-4 text-sm text-destructive">✗ {message}</p>
          )}
          {status === "closed" && (
            <p className="p-4 text-sm text-muted-foreground">{t("toolsPage.terminal.closed")}</p>
          )}
        </div>
      </div>
    </div>
  );
}