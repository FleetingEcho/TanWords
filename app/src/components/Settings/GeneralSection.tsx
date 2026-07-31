import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Eye, Trash2, Upload } from "lucide-react";
import { DEFAULT_BANNER_POSITION, DEFAULT_SIDEBAR_TABS, DEFAULT_TOPBAR_ITEMS, useSettingsStore, Theme } from "@/store/settingsStore";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { CloseIcon } from "@/components/ui/icons";
import type { RssFeed } from "@/hooks/useDB.types";
import { SettingRow, ToggleGroup } from "./SettingsShared";
import { ImageSetting } from "./ImageSetting";
import { BannerPositionModal } from "./BannerPositionModal";

const MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_BANNER_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_APP_BG_UPLOAD_BYTES = 12 * 1024 * 1024;
/** Stored well above the largest on-screen size (the 256px preview modal) so it's always downscaled, never upscaled. */
const AVATAR_OUTPUT_SIZE = 512;
/** The banner is stored whole and cropped at render time via object-position, so this
 *  only has to be wide enough to cover a full-width banner without upscaling — the user
 *  picks which band of it shows (see BannerPositionModal). */
const BANNER_MAX_DIMENSION = 1920;
/** Full-app background: covers arbitrarily-sized/shaped displays via object-fit: cover at
 *  render time, so unlike the avatar/banner this is downscaled only — never center-cropped —
 *  preserving the source aspect ratio. Capped comfortably above typical desktop resolutions. */
const APP_BG_MAX_DIMENSION = 2400;

/** Center-crops (object-fit: cover semantics) an arbitrary image file down to a target size and re-encodes it as a compact JPEG data URL. */
function fileToCroppedDataUrl(file: File, targetW: number, targetH: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("invalid image"));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no canvas context"));
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        const targetRatio = targetW / targetH;
        const srcRatio = img.width / img.height;
        let sw = img.width, sh = img.height, sx = 0, sy = 0;
        if (srcRatio > targetRatio) {
          sw = img.height * targetRatio;
          sx = (img.width - sw) / 2;
        } else {
          sh = img.width / targetRatio;
          sy = (img.height - sh) / 2;
        }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/** Downscales (never crops) an arbitrary image file so its longer edge is at most
 *  `maxDimension`, re-encoded as a compact JPEG data URL. Images already smaller are
 *  left at their original size. */
function fileToDownscaledDataUrl(file: File, maxDimension: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("invalid image"));
      img.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no canvas context"));
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function AppBackgroundSetting() {
  const t = useT();
  const image = useSettingsStore((s) => s.appBackgroundImage);
  const setImage = useSettingsStore((s) => s.setAppBackgroundImage);
  const blur = useSettingsStore((s) => s.appBackgroundBlur);
  const setBlur = useSettingsStore((s) => s.setAppBackgroundBlur);
  const visible = useSettingsStore((s) => s.appBackgroundVisible);
  const setVisible = useSettingsStore((s) => s.setAppBackgroundVisible);

  // The real background renders full-window; the thumb is roughly an eighth of
  // that, so scale the blur down for an honest miniature of the final look.
  const thumbBlur = blur / 6;

  return (
    <ImageSetting
      label={t("settings.appBackground")}
      sub={t("settings.appBackgroundSub")}
      value={image}
      onChange={setImage}
      processFile={(file) => fileToDownscaledDataUrl(file, APP_BG_MAX_DIMENSION, 0.85)}
      maxBytes={MAX_APP_BG_UPLOAD_BYTES}
      thumbClassName="w-48 h-16 rounded-lg"
      thumbImgStyle={{
        filter: `blur(${thumbBlur}px)`,
        // Mirrors AppBackground's overscan so blurred edges don't reveal gaps.
        transform: thumbBlur > 0 ? "scale(1.08)" : undefined,
      }}
      // Same legibility scrim the real background draws over the image.
      thumbOverlay={visible ? <div className="pointer-events-none absolute inset-0 bg-black/20 dark:bg-black/45" /> : undefined}
      empty={t("settings.appBackgroundNone")}
      previewClassName="w-[70vw] h-fit top-1/2 -translate-y-1/2"
      previewImgClassName="w-full h-auto rounded-2xl object-cover shadow-lg"
    >
      <div className="w-full space-y-2.5 rounded-xl border border-border/60 bg-muted/30 p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-foreground/80">{t("settings.appBackgroundVisible")}</span>
          <button
            type="button"
            role="switch"
            aria-checked={visible}
            disabled={!image}
            onClick={() => setVisible(!visible)}
            className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
              visible ? "bg-primary" : "bg-muted-foreground/30"
            }`}
          >
            <span
              className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-all ${
                visible ? "left-[calc(100%-1rem)]" : "left-0.5"
              }`}
            />
          </button>
        </div>
        <div className={`space-y-1.5 ${visible && image ? "" : "pointer-events-none"}`}>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{t("settings.appBackgroundBlur")}</span>
            <span className="rounded-md bg-primary/10 px-1.5 py-px text-[10px] font-semibold tabular-nums text-primary">
              {blur}px
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={40}
            step={1}
            value={blur}
            disabled={!image || !visible}
            onChange={(e) => setBlur(Number(e.target.value))}
            className="w-full accent-primary disabled:opacity-100"
          />
        </div>
      </div>
    </ImageSetting>
  );
}

function NicknameSetting() {
  const t = useT();
  const nickname = useSettingsStore((s) => s.nickname);
  const setNickname = useSettingsStore((s) => s.setNickname);
  const [draft, setDraft] = useState(nickname);

  useEffect(() => setDraft(nickname), [nickname]);

  const commit = () => {
    const trimmed = draft.trim();
    setDraft(trimmed);
    if (trimmed !== nickname) setNickname(trimmed);
  };

  return (
    <SettingRow label={t("settings.nickname")} sub={t("settings.nicknameSub")}>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        placeholder={t("settings.nicknamePlaceholder")}
        maxLength={30}
        className="h-9 w-48 px-3 rounded-lg border border-input bg-background text-sm text-right focus:outline-hidden focus:ring-2 focus:ring-primary/30"
      />
    </SettingRow>
  );
}

function UserAvatarSetting() {
  const t = useT();
  const userAvatar = useSettingsStore((s) => s.userAvatar);
  const setUserAvatar = useSettingsStore((s) => s.setUserAvatar);

  return (
    <ImageSetting
      label={t("settings.userAvatar")}
      sub={t("settings.userAvatarSub")}
      value={userAvatar}
      onChange={setUserAvatar}
      processFile={(file) => fileToCroppedDataUrl(file, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE, 0.94)}
      maxBytes={MAX_AVATAR_UPLOAD_BYTES}
      thumbClassName="w-16 h-16 rounded-xl"
      empty={
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-6 w-6 text-muted-foreground">
          <path fillRule="evenodd" d="M8 8a3 3 0 100-6 3 3 0 000 6zm-4.5 8a4.5 4.5 0 019 0H3.5z" />
        </svg>
      }
      previewClassName="w-[50vw] h-[50vh] top-1/2 -translate-y-1/2"
      previewImgClassName="max-h-[40vh] aspect-square rounded-2xl object-cover shadow-lg"
    />
  );
}

function DashboardBannerSetting() {
  const t = useT();
  const dashboardBanner = useSettingsStore((s) => s.dashboardBanner);
  const position = useSettingsStore((s) => s.dashboardBannerPosition);
  const setDashboardBanner = useSettingsStore((s) => s.setDashboardBanner);
  /** A freshly picked image, held here until the user confirms its framing — replacing
   *  the banner shouldn't take effect halfway, with the old framing still applied. */
  const [pending, setPending] = useState<string | null>(null);
  const [framing, setFraming] = useState(false);

  const editing = pending ?? dashboardBanner;

  return (
    <>
      <ImageSetting
        label={t("settings.dashboardBanner")}
        sub={t("settings.dashboardBannerSub")}
        value={dashboardBanner}
        objectPosition={`${position.x}% ${position.y}%`}
        onChange={setDashboardBanner}
        onPicked={(dataUrl) => { setPending(dataUrl); setFraming(true); }}
        onAdjust={() => { setPending(null); setFraming(true); }}
        processFile={(file) => fileToDownscaledDataUrl(file, BANNER_MAX_DIMENSION, 0.86)}
        maxBytes={MAX_BANNER_UPLOAD_BYTES}
        thumbClassName="w-64 h-16 rounded-lg"
        empty={t("settings.dashboardBannerNone")}
        previewClassName="w-[70vw] h-fit top-1/2 -translate-y-1/2"
        previewImgClassName="w-full h-auto rounded-2xl object-cover shadow-lg"
      />
      <BannerPositionModal
        open={framing}
        src={editing}
        initial={pending ? DEFAULT_BANNER_POSITION : position}
        onCancel={() => setFraming(false)}
        onConfirm={(pos) => { setDashboardBanner(editing, pos); setFraming(false); }}
      />
    </>
  );
}

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
        <SelectTrigger className="h-8 w-52 rounded-lg border-border bg-background text-xs focus:outline-hidden">
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
      <NicknameSetting />
      <UserAvatarSetting />
      <DashboardBannerSetting />
      <AppBackgroundSetting />
      <SettingRow label={t("settings.uiLanguage")} sub={t("settings.uiLanguageSub")}>
        <ToggleGroup
          options={[{ id: "en", label: "English" }, { id: "zh", label: "中文" }]}
          value={settings.uiLanguage}
          onChange={(v) => settings.setUiLanguage(v)}
        />
      </SettingRow>
      <SettingRow label={t("settings.theme")} sub={t("settings.themeSub")}>
        <Select value={settings.theme} onValueChange={(value) => settings.setTheme(value as Theme)}>
          <SelectTrigger className="h-9 w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="light">{t("settings.light")}</SelectItem>
            <SelectItem value="dark">{t("settings.dark")}</SelectItem>
            <SelectItem value="catppuccin-latte">{t("settings.catppuccinLatte")}</SelectItem>
            <SelectItem value="catppuccin-mocha">{t("settings.catppuccinMocha")}</SelectItem>
            <SelectItem value="dracula">{t("settings.dracula")}</SelectItem>
            <SelectItem value="tokyo-night">{t("settings.tokyoNight")}</SelectItem>
            <SelectItem value="tokyo-night-day">{t("settings.tokyoNightDay")}</SelectItem>
            <SelectItem value="tokyo-night-storm">{t("settings.tokyoNightStorm")}</SelectItem>
            <SelectItem value="dim">{t("settings.dim")}</SelectItem>
            <SelectItem value="system">{t("settings.system")}</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      <DefaultRssTabSetting />
      <SettingRow label={t("settings.selectionActions")} sub={t("settings.selectionActionsSub")}>
        <ToggleGroup
          options={[
            { id: "on", label: t("settings.on") },
            { id: "off", label: t("settings.off") },
          ]}
          value={settings.selectionActions ? "on" : "off"}
          onChange={(v) => settings.setSelectionActions(v === "on")}
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
