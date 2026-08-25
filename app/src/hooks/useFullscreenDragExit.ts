import { useCallback, useEffect, useRef } from "react";
import type React from "react";
import { callMain } from "@/ipc/host";
import { useWindowState } from "@/hooks/useWindowState";

const INTERACTIVE_SELECTOR =
  "button, input, textarea, select, a, [role='button'], [role='combobox']";

interface FullscreenDragExitOptions {
  /** An app-owned immersive surface, such as Terminal's chrome-free mode. */
  immersive?: boolean;
  onExitImmersive?: () => void;
}

/**
 * Keeps the OS-fullscreen pull-down gesture and lets an app-owned immersive
 * surface restore on double-click. App-level immersive bars remain native drag
 * regions: dragging moves the window and must not restore the shell.
 */
export function useFullscreenDragExit({
  immersive = false,
  onExitImmersive,
}: FullscreenDragExitOptions = {}) {
  const { fullScreen } = useWindowState();
  const cleanupRef = useRef<(() => void) | null>(null);
  const active = fullScreen || immersive;

  useEffect(() => () => cleanupRef.current?.(), []);

  const exit = useCallback(() => {
    if (immersive) onExitImmersive?.();
    if (fullScreen) void callMain("window:toggleFullScreen").catch(() => {});
  }, [fullScreen, immersive, onExitImmersive]);

  const onMouseDown = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!fullScreen) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(INTERACTIVE_SELECTOR)) return;

    const startY = event.clientY;
    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", cleanup);
      if (cleanupRef.current === cleanup) cleanupRef.current = null;
    };
    const onMove = (moveEvent: MouseEvent) => {
      if (moveEvent.clientY - startY < 4) return;
      cleanup();
      exit();
    };

    cleanupRef.current?.();
    cleanupRef.current = cleanup;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", cleanup);
  }, [exit, fullScreen]);

  const onDoubleClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!active) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(INTERACTIVE_SELECTOR)) return;
    event.preventDefault();
    exit();
  }, [active, exit]);

  return {
    fullScreen,
    onMouseDown: fullScreen ? onMouseDown : undefined,
    onDoubleClick: active ? onDoubleClick : undefined,
  };
}
