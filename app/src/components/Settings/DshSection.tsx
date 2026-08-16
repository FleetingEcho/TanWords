import { useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { SettingRow, ToggleGroup } from "./SettingsShared";

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
        </div>
      </div>
    </>
  );
}
