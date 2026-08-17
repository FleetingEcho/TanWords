import { useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import { useSettingsStore, DSH_IDLE_STOP_CHOICES } from "@/store/settingsStore";
import { SettingRow, ToggleGroup } from "./SettingsShared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Loopback port for the supervised DSH Web host. A local draft is committed
 * on blur/Enter so typing a multi-digit port is never clamped mid-keystroke. */
function DshPortSetting() {
  const t = useT();
  const dshPort = useSettingsStore((state) => state.dshPort);
  const setDshPort = useSettingsStore((state) => state.setDshPort);
  const [draft, setDraft] = useState(dshPort === 0 ? "" : String(dshPort));

  useEffect(() => {
    setDraft(dshPort === 0 ? "" : String(dshPort));
  }, [dshPort]);

  const commit = (value: string) => {
    const port = Number(value);
    setDshPort(Number.isFinite(port) && port > 0 ? port : 0);
  };

  return (
    <SettingRow label={t("settings.dshPort")} sub={t("settings.dshPortSub")}>
      <input
        type="number"
        min={0}
        max={65535}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        placeholder={t("settings.dshPortAuto")}
        className="h-8 w-52 rounded-lg border border-input bg-background px-3 text-center text-sm focus:outline-hidden focus:ring-2 focus:ring-primary/30"
      />
    </SettingRow>
  );
}

function DshAppearanceSlider({
  value, onChange, ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  ariaLabel: string;
}) {
  return (
    <div className="w-52 space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>0%</span>
        <span className="rounded-md bg-primary/10 px-1.5 py-px text-[10px] font-semibold tabular-nums text-primary">
          {value}%
        </span>
        <span>100%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-primary"
        aria-label={ariaLabel}
      />
    </div>
  );
}

function DshBackgroundOpacitySetting() {
  const t = useT();
  const opacity = useSettingsStore((state) => state.dshBackgroundOpacity);
  const setOpacity = useSettingsStore((state) => state.setDshBackgroundOpacity);
  return (
    <SettingRow label={t("settings.dshBackgroundOpacity")} sub={t("settings.dshBackgroundOpacitySub")}>
      <DshAppearanceSlider value={opacity} onChange={setOpacity} ariaLabel={t("settings.dshBackgroundOpacity")} />
    </SettingRow>
  );
}

function DshBackgroundBlurSetting() {
  const t = useT();
  const blur = useSettingsStore((state) => state.dshBackgroundBlur);
  const setBlur = useSettingsStore((state) => state.setDshBackgroundBlur);
  return (
    <SettingRow label={t("settings.dshBackgroundBlur")} sub={t("settings.dshBackgroundBlurSub")}>
      <DshAppearanceSlider value={blur} onChange={setBlur} ariaLabel={t("settings.dshBackgroundBlur")} />
    </SettingRow>
  );
}

function DshToolbarSetting() {
  const t = useT();
  const visible = useSettingsStore((state) => state.dshToolbarVisible);
  const setVisible = useSettingsStore((state) => state.setDshToolbarVisible);
  return (
    <SettingRow label={t("settings.dshToolbar")} sub={t("settings.dshToolbarSub")}>
      <ToggleGroup
        options={[
          { id: "off", label: t("settings.off") },
          { id: "on", label: t("settings.on") },
        ]}
        value={visible ? "on" : "off"}
        onChange={(value) => setVisible(value === "on")}
      />
    </SettingRow>
  );
}

/** Minutes the host may sit hidden-and-idle before auto-stopping. A curated
 *  list rather than a free number — same reasoning as AppLockSection's
 *  auto-lock picker: the useful answers are coarse, and the list keeps every
 *  offered value at or above the 10-minute floor by construction. */
function DshIdleStopSetting() {
  const t = useT();
  const minutes = useSettingsStore((state) => state.dshIdleStopMinutes);
  const setMinutes = useSettingsStore((state) => state.setDshIdleStopMinutes);
  return (
    <SettingRow label={t("settings.dshIdleStop")} sub={t("settings.dshIdleStopSub")}>
      <Select value={String(minutes)} onValueChange={(v) => setMinutes(Number(v))}>
        <SelectTrigger className="h-8 w-40 rounded-lg border-border bg-background text-xs focus:outline-hidden">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DSH_IDLE_STOP_CHOICES.map((value) => (
            <SelectItem key={value} value={String(value)}>
              {value === 0 ? t("settings.dshIdleStopNever") : t("settings.dshIdleStopAfter", { minutes: value })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}

/** Maps a keydown to Electron accelerator syntax, capturing whichever
 *  physical modifier the user actually pressed (Command on a Mac keyboard,
 *  Control elsewhere) rather than the platform-generic `CommandOrControl` —
 *  so recording on Windows/Linux never produces a combo that silently only
 *  works on a Mac. Returns null while only a modifier has been pressed so
 *  far (still waiting for the actual key), or for a bare key with no
 *  modifier at all (reserved for the OS/other shortcuts, not offered here). */
const SPECIAL_KEY_NAMES: Record<string, string> = {
  " ": "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Escape: "Esc", Enter: "Return", Tab: "Tab", Backspace: "Backspace", Delete: "Delete",
};
function acceleratorFromKeyEvent(e: KeyboardEvent): string | null {
  if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.metaKey) parts.push("Command");
  if (e.ctrlKey) parts.push("Control");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (parts.length === 0) return null;
  const key = e.key;
  const name = SPECIAL_KEY_NAMES[key]
    ?? (/^[a-zA-Z0-9]$/.test(key) ? key.toUpperCase() : /^F[1-9][0-9]?$/.test(key) ? key : null);
  if (!name) return null;
  parts.push(name);
  return parts.join("+");
}

/** Records a global (OS-wide) shortcut: click to arm, press the combo, done —
 *  same interaction as most apps' shortcut pickers. Escape while armed cancels
 *  without changing the stored value. Actual `globalShortcut` registration
 *  happens in main (see useTraySync, which reacts to this same setting) —
 *  this component only captures and stores the accelerator string. */
function DshGlobalShortcutSetting() {
  const t = useT();
  const accelerator = useSettingsStore((state) => state.dshGlobalShortcut);
  const setAccelerator = useSettingsStore((state) => state.setDshGlobalShortcut);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === "Escape") { setRecording(false); return; }
      const next = acceleratorFromKeyEvent(e);
      if (!next) return;
      setAccelerator(next);
      setRecording(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, setAccelerator]);

  return (
    <SettingRow label={t("settings.dshGlobalShortcut")} sub={t("settings.dshGlobalShortcutSub")}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setRecording(true)}
          className="h-8 min-w-32 rounded-lg border border-input bg-background px-3 text-xs font-mono focus:outline-hidden focus:ring-2 focus:ring-primary/30"
        >
          {recording
            ? t("settings.dshGlobalShortcutRecording")
            : accelerator || t("settings.dshGlobalShortcutNotSet")}
        </button>
        {accelerator && !recording && (
          <button
            type="button"
            onClick={() => setAccelerator("")}
            className="h-8 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {t("settings.dshGlobalShortcutClear")}
          </button>
        )}
      </div>
    </SettingRow>
  );
}

export function DshSection() {
  const t = useT();

  return (
    <>
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {t("settings.section.dsh")}
      </p>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="divide-y divide-border px-5">
          <DshPortSetting />
          <DshBackgroundOpacitySetting />
          <DshBackgroundBlurSetting />
          <DshToolbarSetting />
          <DshIdleStopSetting />
          <DshGlobalShortcutSetting />
        </div>
      </div>
    </>
  );
}
