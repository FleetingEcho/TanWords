import { useEffect, useState } from "react";
import { Maximize2, Minimize2, Minus, Square, X } from "lucide-react";
import { callMain } from "@/ipc/host";
import { subscribe } from "@/ipc/events";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";

interface WindowState {
  maximized: boolean;
  fullScreen: boolean;
}

/** Uniform window controls used instead of the platform-native title bar.
 *  They always live in the app's own top bar, so minimize/maximize/fullscreen/
 *  close stay in the same place on macOS, Windows, and Linux. */
export function WindowControls() {
  const t = useT();
  const [state, setState] = useState<WindowState>({ maximized: false, fullScreen: false });

  useEffect(() => {
    if (!window.tanwords) return;
    let alive = true;
    void callMain<WindowState>("window:state")
      .then((next) => { if (alive) setState(next); })
      .catch(() => {});
    const unsubscribe = subscribe<WindowState>("window:state-changed", (next) => {
      if (alive) setState(next);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const toggleMaximize = async () => {
    if (!window.tanwords) return;
    const maximized = await callMain<boolean>("window:toggleMaximize");
    setState((s) => ({ ...s, maximized }));
  };

  const toggleFullScreen = async () => {
    if (!window.tanwords) return;
    const fullScreen = await callMain<boolean>("window:toggleFullScreen");
    setState((s) => ({ ...s, fullScreen }));
  };

  const buttonClass =
    "h-7 w-7 p-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors";

  return (
    <div className="ml-1 flex shrink-0 items-center border-l border-border/60 pl-1">
      <Button
        variant="ghost"
        onClick={() => void callMain("window:minimize").catch(() => {})}
        title={t("windowControls.minimize")}
        aria-label={t("windowControls.minimize")}
        className={buttonClass}
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        onClick={() => void toggleMaximize()}
        title={t(state.maximized ? "windowControls.restore" : "windowControls.maximize")}
        aria-label={t(state.maximized ? "windowControls.restore" : "windowControls.maximize")}
        className={buttonClass}
      >
        {state.maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Square className="h-3 w-3" />}
      </Button>
      <Button
        variant="ghost"
        onClick={() => void toggleFullScreen()}
        title={t(state.fullScreen ? "windowControls.exitFullscreen" : "windowControls.fullscreen")}
        aria-label={t(state.fullScreen ? "windowControls.exitFullscreen" : "windowControls.fullscreen")}
        className={buttonClass}
      >
        {state.fullScreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      </Button>
      <Button
        variant="ghost"
        onClick={() => void callMain("window:close").catch(() => {})}
        title={t("windowControls.close")}
        aria-label={t("windowControls.close")}
        className={`${buttonClass} hover:bg-destructive hover:text-white`}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
