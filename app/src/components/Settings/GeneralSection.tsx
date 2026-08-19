import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Eye, Trash2, Upload } from "lucide-react";
import { DEFAULT_BANNER_POSITION, useSettingsStore, Theme, type SidebarTabId, type TopBarItemId } from "@/store/settingsStore";
import { mergeReorderedSubset } from "@/store/settings/reorder";
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
import { WallpaperSetting } from "./WallpaperSetting";
import { BannerPositionModal } from "./BannerPositionModal";
import { hostCapabilities } from "@/platform";
import { me as fetchMe, logout } from "@/platform/auth";

const MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_BANNER_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_APP_BG_UPLOAD_BYTES = 12 * 1024 * 1024;
/** The avatar is stored whole (like the banner/background) and framed at render time via
 *  object-position + scale, chosen in AvatarPositionModal — no longer baked to a fixed
 *  square at upload. Capped well above the largest on-screen avatar size so zooming in
 *  the framing modal never upscales past the source's own resolution. */
const AVATAR_MAX_DIMENSION = 1024;
/** The banner is stored whole and cropped at render time via object-position, so this
 *  only has to be wide enough to cover a full-width banner without upscaling — the user
 *  picks which band of it shows (see BannerPositionModal). */
const BANNER_MAX_DIMENSION = 1920;
/** Full-app background: covers arbitrarily-sized/shaped displays via object-fit: cover at
 *  render time, so unlike the avatar/banner this is downscaled only — never center-cropped —
 *  preserving the source aspect ratio. Capped comfortably above typical desktop resolutions. */
const APP_BG_MAX_DIMENSION = 2400;

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
  const images = useSettingsStore((s) => s.appBackgroundImages);
  const activeIndex = useSettingsStore((s) => s.appBackgroundImageIndex);
  const positions = useSettingsStore((s) => s.appBackgroundImagePositions);
  const position = useSettingsStore((s) => s.appBackgroundImagePosition);
  const setImages = useSettingsStore((s) => s.setAppBackgroundImages);
  const [pending, setPending] = useState<string[]>([]);
  const [adjusting, setAdjusting] = useState(false);
  const editing = pending[0] ?? images[activeIndex] ?? "";

  const closeFraming = () => {
    setPending([]);
    setAdjusting(false);
  };

  const saveFraming = (nextPosition: typeof position) => {
    if (pending.length > 0) {
      setImages([...images, editing], images.length, [...positions, nextPosition]);
      setPending((queue) => queue.slice(1));
      return;
    }
    const nextPositions = positions.map((saved, index) => index === activeIndex ? nextPosition : saved);
    setImages(images, activeIndex, nextPositions);
    setAdjusting(false);
  };
  return (
    <>
      <WallpaperSetting
        label={t("settings.appBackground")}
        sub={t("settings.appBackgroundSub")}
        emptyLabel={t("settings.appBackgroundNone")}
        maxDimension={APP_BG_MAX_DIMENSION}
        maxBytes={MAX_APP_BG_UPLOAD_BYTES}
        processFile={fileToDownscaledDataUrl}
        image={useSettingsStore((s) => s.appBackgroundImage)}
        setImage={useSettingsStore((s) => s.setAppBackgroundImage)}
        blur={useSettingsStore((s) => s.appBackgroundBlur)}
        setBlur={useSettingsStore((s) => s.setAppBackgroundBlur)}
        dimming={useSettingsStore((s) => s.appBackgroundDimming)}
        setDimming={useSettingsStore((s) => s.setAppBackgroundDimming)}
        visible={useSettingsStore((s) => s.appBackgroundVisible)}
        setVisible={useSettingsStore((s) => s.setAppBackgroundVisible)}
        objectPosition={`${position.x}% ${position.y}%`}
        imageScale={position.scale}
        onAdjust={() => setAdjusting(true)}
        gallery={{
          items: images,
          activeIndex,
          maxItems: 5,
          onAdd: setPending,
          onSelect: (index) => setImages(images, index, positions),
          onRemove: (index) => {
            const nextImages = images.filter((_, itemIndex) => itemIndex !== index);
            const nextPositions = positions.filter((_, itemIndex) => itemIndex !== index);
            setImages(nextImages, Math.min(index, nextImages.length - 1), nextPositions);
          },
        }}
      />
      <BannerPositionModal
        open={pending.length > 0 || adjusting}
        src={editing}
        initial={pending.length > 0 ? DEFAULT_BANNER_POSITION : position}
        frameAspect={16 / 9}
        title={t("settings.backgroundPositionTitle")}
        hint={t("settings.backgroundPositionHint")}
        fitsHint={t("settings.backgroundPositionFits")}
        allowZoom
        onCancel={closeFraming}
        onConfirm={saveFraming}
      />
    </>
  );
}

export { fileToDownscaledDataUrl, APP_BG_MAX_DIMENSION, MAX_APP_BG_UPLOAD_BYTES };

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
  const position = useSettingsStore((s) => s.userAvatarPosition);
  const setUserAvatar = useSettingsStore((s) => s.setUserAvatar);
  // Same pending/framing shape as the banner/background/lock-screen pickers —
  // see DashboardBannerSetting's doc.
  const [pending, setPending] = useState<string | null>(null);
  const [framing, setFraming] = useState(false);

  const editing = pending ?? userAvatar;

  return (
    <>
      <ImageSetting
        label={t("settings.userAvatar")}
        sub={t("settings.userAvatarSub")}
        value={userAvatar}
        onChange={setUserAvatar}
        objectPosition={`${position.x}% ${position.y}%`}
        imageScale={position.scale}
        onPicked={(dataUrl) => { setPending(dataUrl); setFraming(true); }}
        onAdjust={() => { setPending(null); setFraming(true); }}
        // Stored whole (like the banner/background/lock screen) — downscale
        // only, no baked crop. Which part shows, and how zoomed, is the
        // framing modal below, not a blind upload-time center-crop.
        processFile={(file) => fileToDownscaledDataUrl(file, AVATAR_MAX_DIMENSION, 0.9)}
        maxBytes={MAX_AVATAR_UPLOAD_BYTES}
        thumbClassName="w-16 h-16 rounded-xl"
        empty={
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-6 w-6 text-muted-foreground">
            <path fillRule="evenodd" d="M8 8a3 3 0 100-6 3 3 0 000 6zm-4.5 8a4.5 4.5 0 019 0H3.5z" />
          </svg>
        }
        previewClassName="w-[50vw] h-[50vh]"
        previewImgClassName="max-h-[40vh] aspect-square rounded-2xl object-cover shadow-lg"
      />
      <BannerPositionModal
        open={framing}
        src={editing}
        initial={pending ? DEFAULT_BANNER_POSITION : position}
        frameAspect={1}
        allowZoom
        title={t("settings.avatarPositionTitle")}
        hint={t("settings.avatarPositionHint")}
        fitsHint={t("settings.avatarPositionFits")}
        onCancel={() => { setPending(null); setFraming(false); }}
        onConfirm={(pos) => { setUserAvatar(editing, pos); setPending(null); setFraming(false); }}
      />
    </>
  );
}

function DashboardBannerSetting() {
  const t = useT();
  const dashboardBanner = useSettingsStore((s) => s.dashboardBanner);
  const position = useSettingsStore((s) => s.dashboardBannerPosition);
  const setDashboardBanner = useSettingsStore((s) => s.setDashboardBanner);
  const visible = useSettingsStore((s) => s.dashboardBannerVisible);
  const setVisible = useSettingsStore((s) => s.setDashboardBannerVisible);
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
        imageScale={position.scale}
        onChange={setDashboardBanner}
        onPicked={(dataUrl) => { setPending(dataUrl); setFraming(true); }}
        onAdjust={() => { setPending(null); setFraming(true); }}
        processFile={(file) => fileToDownscaledDataUrl(file, BANNER_MAX_DIMENSION, 0.86)}
        maxBytes={MAX_BANNER_UPLOAD_BYTES}
        thumbClassName="w-64 h-16 rounded-lg"
        thumbImgStyle={visible ? undefined : { opacity: 0.4 }}
        empty={t("settings.dashboardBannerNone")}
        previewClassName="w-[70vw] h-fit"
        previewImgClassName="w-full h-auto rounded-2xl object-cover shadow-lg"
      >
        <div className="flex w-full items-center justify-between rounded-xl border border-border/60 bg-muted/30 px-2.5 py-2">
          <span className="text-xs font-medium text-foreground/80">{t("settings.dashboardBannerVisible")}</span>
          <button
            type="button"
            role="switch"
            aria-checked={visible}
            disabled={!dashboardBanner}
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
      </ImageSetting>
      <BannerPositionModal
        open={framing}
        src={editing}
        initial={pending ? DEFAULT_BANNER_POSITION : position}
        allowZoom
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

/** A checkbox pill grid that's also a drag-sortable list — native HTML5 drag
 *  and drop, no library. Dropping one pill onto another swaps its position
 *  in `items`; `onReorder` gets the full new sequence and is responsible for
 *  persisting it (merging back into whatever full order it's a filtered view
 *  of, if any). Order and visibility are independent here on purpose: a
 *  hidden pill can still be dragged to where you want it before you ever
 *  turn it on. */
function SortablePillGrid<T extends string>({
  items, isVisible, labelFor, onToggle, onReorder, widthClass = "w-32",
}: {
  items: T[];
  isVisible: (id: T) => boolean;
  labelFor: (id: T) => string;
  onToggle: (id: T, visible: boolean) => void;
  onReorder: (order: T[]) => void;
  widthClass?: string;
}) {
  const [dragId, setDragId] = useState<T | null>(null);
  const [overId, setOverId] = useState<T | null>(null);

  const handleDrop = (targetId: T) => {
    setOverId(null);
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const from = items.indexOf(dragId);
    const to = items.indexOf(targetId);
    setDragId(null);
    if (from < 0 || to < 0) return;
    const next = [...items];
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    onReorder(next);
  };

  return (
    <div className="flex max-w-4xl flex-wrap gap-2">
      {items.map((id) => {
        const visible = isVisible(id);
        return (
          <label
            key={id}
            draggable
            onDragStart={(e) => { setDragId(id); e.dataTransfer.effectAllowed = "move"; }}
            onDragOver={(e) => { e.preventDefault(); if (dragId && dragId !== id) setOverId(id); }}
            onDragLeave={() => setOverId((cur) => (cur === id ? null : cur))}
            onDrop={(e) => { e.preventDefault(); handleDrop(id); }}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            title={labelFor(id)}
            className={`flex h-8 ${widthClass} cursor-grab items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors active:cursor-grabbing ${
              visible
                ? "border-primary/30 bg-primary/[0.07] text-foreground"
                : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted"
            } ${dragId === id ? "opacity-40" : ""} ${overId === id ? "ring-2 ring-primary/60" : ""}`}
          >
            <Checkbox className="h-3.5 w-3.5 rounded-full shadow-none" checked={visible} onCheckedChange={(checked) => onToggle(id, checked === true)} />
            <span className="truncate">{labelFor(id)}</span>
          </label>
        );
      })}
    </div>
  );
}

export function GeneralSection() {
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  useEffect(() => {
    if (!hostCapabilities.auth) return;
    let mounted = true;
    void fetchMe().then((record) => { if (mounted) setAccountEmail(record?.email ?? null); });
    return () => { mounted = false; };
  }, []);
  const settings = useSettingsStore();
  const t = useT();

  return (
    <div className="space-y-4">
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
        <SettingRow label={t("settings.layoutMode")} sub={t("settings.layoutModeSub")}>
          <ToggleGroup
            options={[
              { id: "on", label: t("settings.on") },
              { id: "off", label: t("settings.off") },
            ]}
            value={settings.layoutMode === "flexible" ? "on" : "off"}
            onChange={(v) => settings.setLayoutMode(v === "on" ? "flexible" : "fixed")}
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
          <SortablePillGrid
            items={settings.topBarItemOrder.filter((item) => {
              if (item === "mcp") return hostCapabilities.mcp;
              if (item === "dsh") return hostCapabilities.dsh;
              if (item === "terminal") return hostCapabilities.terminal;
              if (item === "updates") return hostCapabilities.updater;
              if (item === "browser") return hostCapabilities.browser;
              return true;
            })}
            isVisible={(item) => settings.visibleTopBarItems.includes(item)}
            labelFor={(item) => t(`settings.topBar.${item}`)}
            onToggle={(item, visible) => settings.setTopBarItemVisible(item, visible)}
            onReorder={(order: TopBarItemId[]) => settings.setTopBarItemOrder(mergeReorderedSubset(settings.topBarItemOrder, order))}
          />
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
          <SortablePillGrid
            items={settings.sidebarTabOrder.filter((tab) => {
              if (tab === "music") return hostCapabilities.music;
              if (tab === "browser") return hostCapabilities.browser;
              if (tab === "terminal") return hostCapabilities.terminal;
              return true;
            })}
            isVisible={(tab) => settings.visibleSidebarTabs.includes(tab)}
            labelFor={(tab) => t(`nav.${tab}`)}
            onToggle={(tab, visible) => settings.setSidebarTabVisible(tab, visible)}
            onReorder={(order: SidebarTabId[]) => settings.setSidebarTabOrder(mergeReorderedSubset(settings.sidebarTabOrder, order))}
          />
        </div>

        {hostCapabilities.auth && (
          <div className="mt-4 border-t border-border/60 py-4">
            <div className="mb-3">
              <p className="text-sm font-medium">{t("auth.account")}</p>
              {accountEmail && <p className="mt-0.5 text-xs text-muted-foreground">{accountEmail}</p>}
            </div>
            <Button variant="outline" className="h-8 text-xs" onClick={() => void logout()}>
              {t("auth.logout")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
