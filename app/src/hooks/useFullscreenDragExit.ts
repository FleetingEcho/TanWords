import { useCallback, useEffect, useRef } from "react";
import type React from "react";
import { callMain } from "@/ipc/host";
import { useWindowState } from "@/hooks/useWindowState";

const INTERACTIVE_SELECTOR =
  "button, input, textarea, select, a, [role='button'], [role='combobox']";

/**
 * Turns a top bar into a pull-down-to-exit gesture while the OS window is
 * fullscreen. Native app drag regions cannot receive pointer events in that
 * state, so every top bar that can replace the main command bar must use this
 * behavior as well.
 */
export function useFullscreenDragExit() {
  const { fullScreen } = useWindowState();
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

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
      void callMain("window:toggleFullScreen").catch(() => {});
    };

    cleanupRef.current?.();
    cleanupRef.current = cleanup;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", cleanup);
  }, [fullScreen]);

  return { fullScreen, onMouseDown: fullScreen ? onMouseDown : undefined };
}
