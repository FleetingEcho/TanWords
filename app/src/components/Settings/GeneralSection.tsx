import React, { useEffect, useState } from "react";
import { DEFAULT_SIDEBAR_TABS, DEFAULT_TOPBAR_ITEMS, useSettingsStore, Theme } from "@/store/settingsStore";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RssFeed } from "@/hooks/useDB.types";
import { SettingRow, ToggleGroup } from "./SettingsShared";

function DefaultRssTabSetting() {
  const t = useT();
  const db = useDB();
  const defaultRssTab = useSettingsStore((s) => s.defaultRssTab);
  const setDefaultRssTab = useSettingsStore((s) => s.setDefaultRssTab);
  const [feeds, setFeeds] = useState<RssFeed[]>([]);

  useEffect(() => {
    db.getRssFeeds().then(setFeeds);
  }, []);

  return (
    <SettingRow label={t("settings.defaultRssTab")} sub={t("settings.defaultRssTabSub")}>
      <Select
        value={String(defaultRssTab)}
        onValueChange={(v) => setDefaultRssTab(v === "all" || v === "hackernews" ? v : Number(v))}
      >
        <SelectTrigger className="h-8 w-52 rounded-lg border-border bg-background text-xs focus:outline-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("settings.defaultRssTabAll")}</SelectItem>
          <SelectItem value="hackernews">{t("settings.defaultRssTabHn")}</SelectItem>
          {feeds.map((f) => (
            <SelectItem key={f.id} value={String(f.id)}>{f.title}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}

export function GeneralSection() {
  const settings = useSettingsStore();
  const t = useT();

  return (
    <div className="bg-card border border-border rounded-xl px-5 divide-y divide-border">
      <SettingRow label={t("settings.uiLanguage")} sub={t("settings.uiLanguageSub")}>
        <ToggleGroup
          options={[{ id: "zh", label: "中文" }, { id: "en", label: "English" }]}
          value={settings.uiLanguage}
          onChange={(v) => settings.setUiLanguage(v)}
        />
      </SettingRow>
      <SettingRow label={t("settings.theme")} sub={t("settings.themeSub")}>
        <ToggleGroup
          options={[
            { id: "light", label: t("settings.light") },
            { id: "dark", label: t("settings.dark") },
            { id: "system", label: t("settings.system") },
          ]}
          value={settings.theme}
          onChange={(v) => settings.setTheme(v as Theme)}
        />
      </SettingRow>
      <DefaultRssTabSetting />
      <SettingRow label={t("settings.quickDoc")} sub={t("settings.quickDocSub")}>
        <ToggleGroup
          options={[
            { id: "on", label: t("settings.on") },
            { id: "off", label: t("settings.off") },
          ]}
          value={settings.showQuickDoc ? "on" : "off"}
          onChange={(v) => settings.setShowQuickDoc(v === "on")}
        />
      </SettingRow>
      <div className="py-4">
        <div className="mb-3">
          <div className="flex items-center gap-2.5">
            <p className="text-sm font-medium">{t("settings.topBarItems")}</p>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{t("settings.topBarItemsSelected", { n: settings.visibleTopBarItems.length })}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("settings.topBarItemsSub")}</p>
        </div>
        <div className="flex max-w-4xl flex-wrap gap-2">
          {DEFAULT_TOPBAR_ITEMS.map((item) => {
            const visible = settings.visibleTopBarItems.includes(item);
            return (
              <label key={item} className={`flex h-8 w-32 cursor-pointer items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors ${visible ? "border-primary/30 bg-primary/[0.07] text-foreground" : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted"}`}>
                <Checkbox className="h-3.5 w-3.5 rounded-full shadow-none" checked={visible} onCheckedChange={(checked) => settings.setTopBarItemVisible(item, checked === true)} />
                <span className="truncate">{t(`settings.topBar.${item}`)}</span>
              </label>
            );
          })}
        </div>
      </div>
      <div className="py-4">
        <div className="mb-3">
          <div className="flex items-center gap-2.5">
            <p className="text-sm font-medium">{t("settings.sidebarTabs")}</p>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {t("settings.sidebarTabsSelected", { n: settings.visibleSidebarTabs.length })}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("settings.sidebarTabsSub")}</p>
        </div>
        <div className="flex max-w-3xl flex-wrap gap-2">
          {DEFAULT_SIDEBAR_TABS.map((tab) => {
            const visible = settings.visibleSidebarTabs.includes(tab);
            return (
              <label
                key={tab}
                className={`flex h-8 w-32 cursor-pointer items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors ${
                  visible
                    ? "border-primary/30 bg-primary/[0.07] text-foreground"
                    : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted"
                }`}
              >
                <Checkbox className="h-3.5 w-3.5 rounded-full shadow-none" checked={visible} onCheckedChange={(checked) => settings.setSidebarTabVisible(tab, checked === true)} />
                <span className="truncate">{t(`nav.${tab}`)}</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
