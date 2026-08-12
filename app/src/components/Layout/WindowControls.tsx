import { Maximize2, Minimize2, Minus, Square, X } from "lucide-react";
import { callMain } from "@/ipc/host";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { useWindowState } from "@/hooks/useWindowState";

/** Uniform window controls used instead of the platform-native title bar.
 *  They always live in the app's own top bar, so minimize/maximize/fullscreen/
 *  close stay in the same place on macOS, Windows, and Linux.
 *
 *  State comes from `useWindowState`, whose `window:state-changed` subscription
 *  is the single source of truth — each button just fires its IPC action and
 *  the resulting BrowserWindow event updates the icon. */
export function WindowControls() {
  const t = useT();
  const { maximized, fullScreen } = useWindowState();

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
        onClick={() => void callMain("window:toggleMaximize").catch(() => {})}
        title={t(maximized ? "windowControls.restore" : "windowControls.maximize")}
        aria-label={t(maximized ? "windowControls.restore" : "windowControls.maximize")}
        className={buttonClass}
      >
        {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Square className="h-3 w-3" />}
      </Button>
      <Button
        variant="ghost"
        onClick={() => void callMain("window:toggleFullScreen").catch(() => {})}
        title={t(fullScreen ? "windowControls.exitFullscreen" : "windowControls.fullscreen")}
        aria-label={t(fullScreen ? "windowControls.exitFullscreen" : "windowControls.fullscreen")}
        className={buttonClass}
      >
        {fullScreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
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
