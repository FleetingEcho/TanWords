/** One card on the web stickies wall — the note colour IS the card (no
 *  chrome, no color dot). Purely presentational: the page owns data + IPC.
 *
 *  Masonry comes from CSS columns + natural heights: the preview is capped
 *  (max-h-56) but NEVER line-clamped, so cards keep organic, varied lengths
 *  like physical notes on a desk. The surface is theme-aware — full pastel
 *  with dark ink in light themes, a hue tint over the themed canvas with
 *  light ink in dark ones (see stickyShared.ts) — matching the desktop note
 *  windows. */
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { stickyDerivedTitle, stickySurfaceStyle, type StickyListItem } from "./stickyShared";

export function StickyWallCard({
  item,
  onOpen,
}: {
  item: StickyListItem;
  onOpen: (item: StickyListItem) => void;
}) {
  const t = useT();
  const lang = useSettingsStore((s) => s.uiLanguage);
  // SQLite's space-separated form parses as local time in the browser — that
  // is what the wall wants (same rule the desktop window headers apply).
  const updated = new Date(item.updated_at.replace(" ", "T")).toLocaleDateString(
    lang === "zh" ? "zh-CN" : "en-US",
  );
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="mb-3 block w-full cursor-pointer break-inside-avoid rounded-2xl p-3.5 text-left transition hover:-translate-y-0.5 hover:shadow-lg"
      style={{ ...stickySurfaceStyle(item.color, 100), color: "var(--sticky-ink, #1f2937)" }}
    >
      <span className="block truncate text-sm font-semibold">
        {item.title || stickyDerivedTitle(item.preview) || t("sticky.untitled")}
      </span>
      {item.preview ? (
        <span className="mt-1 block max-h-56 overflow-hidden text-[13px] leading-relaxed whitespace-pre-wrap opacity-75">
          {item.preview}
        </span>
      ) : null}
      <span className="mt-2 flex items-center justify-between text-[10px] opacity-60">
        <span>{updated}</span>
        <span>{t("sticky.words", { n: item.word_count })}</span>
      </span>
    </button>
  );
}
