import { useT } from "@/hooks/useT";
import { ImageSetting } from "./ImageSetting";

/** Picture + show/hide + blur + opacity, as one settings row.
 *
 *  Two places use it — the app canvas and the lock screen — with their own
 *  images and their own sliders. Shared as a component rather than a shared
 *  *setting*: they are different wallpapers that happen to be configured the
 *  same way. */
export function WallpaperSetting({
  label, sub, emptyLabel, maxDimension, maxBytes, processFile,
  image, setImage, blur, setBlur, visible, setVisible,
  gallery, objectPosition, imageScale, onAdjust, onPicked, dimming, setDimming,
}: {
  label: string;
  sub: string;
  emptyLabel: string;
  maxDimension: number;
  maxBytes: number;
  processFile: (file: File, maxDimension: number, quality: number) => Promise<string>;
  image: string;
  setImage: (value: string) => void;
  blur: number;
  setBlur: (value: number) => void;
  visible: boolean;
  setVisible: (value: boolean) => void;
  gallery?: {
    items: string[];
    activeIndex: number;
    maxItems: number;
    onAdd: (dataUrls: string[]) => void;
    onSelect: (index: number) => void;
    onRemove: (index: number) => void;
  };
  objectPosition?: string;
  imageScale?: number;
  onAdjust?: () => void;
  /** Routes a freshly picked file here instead of straight to `setImage` —
   *  for callers that want the user to confirm framing (crop position, and
   *  with `onAdjust`'s modal set up for zoom, scale too) before it's stored.
   *  Omit to store on pick with the default centred, unzoomed framing. */
  onPicked?: (dataUrl: string) => void;
  dimming?: number;
  setDimming?: (value: number) => void;
}) {
  const t = useT();
  // The real thing renders full-window; the thumb is roughly an eighth of
  // that, so scale the blur down for an honest miniature of the final look.
  const thumbBlur = blur / 6;
  const active = visible && Boolean(image);

  return (
    <ImageSetting
      label={label}
      sub={sub}
      value={image}
      onChange={setImage}
      objectPosition={objectPosition}
      imageScale={imageScale}
      onAdjust={onAdjust}
      onPicked={onPicked}
      processFile={(file) => processFile(file, maxDimension, 0.85)}
      maxBytes={maxBytes}
      thumbClassName="w-48 h-16 rounded-lg"
      thumbImgStyle={{
        filter: `blur(${thumbBlur}px)`,
        // Mirrors the real overscan so blurred edges don't reveal gaps.
        transform: thumbBlur > 0 ? "scale(1.08)" : undefined,
      }}
      // Preview the app wallpaper's optional dimming. The lock screen keeps its
      // existing theme-aware scrim because it has no separate dimming control.
      thumbOverlay={visible ? (
        dimming !== undefined
          ? dimming > 0
            ? <div className="pointer-events-none absolute inset-0" style={{ backgroundColor: `rgb(0 0 0 / ${dimming}%)` }} />
            : undefined
          : <div className="pointer-events-none absolute inset-0 bg-black/20 dark:bg-black/45" />
      ) : undefined}
      empty={emptyLabel}
      previewClassName="w-[70vw] h-fit"
      previewImgClassName="w-full h-auto rounded-2xl object-cover shadow-lg"
      gallery={gallery ? {
        items: gallery.items,
        activeIndex: gallery.activeIndex,
        maxItems: gallery.maxItems,
        onAdd: gallery.onAdd,
        onSelect: gallery.onSelect,
        onRemove: gallery.onRemove,
      } : undefined}
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
        <Slider
          label={t("settings.appBackgroundBlur")}
          value={blur}
          display={`${blur}px`}
          min={0}
          max={40}
          step={1}
          disabled={!active}
          onChange={setBlur}
        />
        {dimming !== undefined && setDimming && (
          <Slider
            label={t("settings.appBackgroundDimming")}
            value={dimming}
            display={`${dimming}%`}
            min={0}
            max={80}
            step={1}
            disabled={!active}
            onChange={setDimming}
          />
        )}
      </div>
    </ImageSetting>
  );
}

function Slider({
  label, value, display, min, max, step, disabled, onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className={`space-y-1.5 ${disabled ? "pointer-events-none" : ""}`}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="rounded-md bg-primary/10 px-1.5 py-px text-[10px] font-semibold tabular-nums text-primary">
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-primary disabled:opacity-40"
      />
    </div>
  );
}
