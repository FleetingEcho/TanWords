import { useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { Button } from "@/components/ui/button";
import { SettingRow } from "./SettingsShared";
import { PrivateDocumentsSection } from "./PrivateDocumentsSection";

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function pickerColor(value: string) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return `#${value.slice(1).split("").map((character) => character.repeat(2)).join("")}`;
  }
  return "#808080";
}

export function DocumentsSection() {
  const t = useT();
  const settings = useSettingsStore();
  const [colorDraft, setColorDraft] = useState(settings.documentTextColor);

  useEffect(() => setColorDraft(settings.documentTextColor), [settings.documentTextColor]);

  const changeColorDraft = (value: string) => {
    setColorDraft(value);
    if (!value || HEX_COLOR_RE.test(value)) settings.setDocumentTextColor(value);
  };

  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-card px-5">
      <SettingRow label={t("settings.documentLineHeight")} sub={t("settings.documentLineHeightSub")}>
        <div className="w-52 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>1.4</span>
            <span className="rounded-md bg-muted px-2 py-0.5 font-semibold tabular-nums text-foreground">
              {settings.documentLineHeight.toFixed(1)}
            </span>
            <span>2.2</span>
          </div>
          <input
            type="range"
            min={1.4}
            max={2.2}
            step={0.1}
            value={settings.documentLineHeight}
            onChange={(event) => settings.setDocumentLineHeight(Number(event.target.value))}
            className="w-full accent-primary"
            aria-label={t("settings.documentLineHeight")}
          />
        </div>
      </SettingRow>

      <SettingRow label={t("settings.documentFontSize")} sub={t("settings.documentFontSizeSub")}>
        <div className="w-52 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>12px</span>
            <span className="rounded-md bg-muted px-2 py-0.5 font-semibold tabular-nums text-foreground">
              {settings.documentFontSize}px
            </span>
            <span>24px</span>
          </div>
          <input
            type="range"
            min={12}
            max={24}
            step={1}
            value={settings.documentFontSize}
            onChange={(event) => settings.setDocumentFontSize(Number(event.target.value))}
            className="w-full accent-primary"
            aria-label={t("settings.documentFontSize")}
          />
        </div>
      </SettingRow>

      <SettingRow label={t("settings.documentTextColor")} sub={t("settings.documentTextColorSub")}>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={pickerColor(settings.documentTextColor)}
            onChange={(event) => changeColorDraft(event.target.value)}
            title={t("settings.documentTextColor")}
            aria-label={t("settings.documentTextColor")}
            className="h-7 w-10 cursor-pointer rounded-md border border-input bg-background p-0.5"
          />
          <input
            type="text"
            value={colorDraft}
            onChange={(event) => changeColorDraft(event.target.value.trim())}
            onBlur={() => {
              if (colorDraft && !HEX_COLOR_RE.test(colorDraft)) {
                setColorDraft(settings.documentTextColor);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            placeholder="#ddd"
            spellCheck={false}
            aria-label={t("settings.documentTextColorHex")}
            className="h-8 w-24 rounded-lg border border-input bg-background px-2 font-mono text-xs outline-hidden focus:ring-2 focus:ring-primary/30"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => changeColorDraft("")}
            disabled={!settings.documentTextColor}
            className="h-7 px-2.5 text-xs"
          >
            {t("settings.useThemeColor")}
          </Button>
        </div>
      </SettingRow>

      <PrivateDocumentsSection />
    </div>
  );
}
