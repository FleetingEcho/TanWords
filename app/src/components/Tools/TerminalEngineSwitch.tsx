import type { TerminalEngine } from "@/store/settings/types";
import { useT } from "@/hooks/useT";

/** Per-tab engine switch, shown in both engines' inline appearance panel
 *  (mirrors the segmented control in Settings → Terminal). Picking a
 *  different engine swaps this tab's component (`TerminalTool` ↔
 *  `TerminalToolRestty`) in `TerminalWorkspace.tsx`, which tears down the
 *  running PTY session and starts a fresh one under the new engine — the
 *  same cost as the existing "Restart" action, not a live hot-swap. */
export function TerminalEngineSwitch({
  engine,
  onChange,
}: {
  engine: TerminalEngine;
  onChange: (engine: TerminalEngine) => void;
}) {
  const t = useT();
  return (
    // Not a <label>: it wraps two buttons, and a <label>'s text becomes part
    // of *every* focusable descendant's accessible name (each tab would read
    // "Engine xterm"/"Engine restty"), not just a caption next to them.
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground">
        {t("toolsPage.terminal.engineLabel")}
      </span>
      <div role="tablist" aria-label={t("toolsPage.terminal.engineLabel")} className="inline-flex rounded-md border border-border bg-transparent p-0.5">
        {(["xterm", "restty"] as TerminalEngine[]).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={engine === option}
            onClick={() => onChange(option)}
            className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
              engine === option
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option === "xterm" ? t("settings.terminalEngineXterm") : t("settings.terminalEngineRestty")}
          </button>
        ))}
      </div>
    </div>
  );
}
