import React, { useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Eye, Move, Trash2, Upload } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { CloseIcon } from "@/components/ui/icons";
import { SettingRow } from "./SettingsShared";

interface Props {
  label: string;
  sub: string;
  /** Current image as a data URL, or "" when unset. */
  value: string;
  onChange: (dataUrl: string) => void;
  /** Turns the picked file into the stored data URL (crop or downscale). */
  processFile: (file: File) => Promise<string>;
  /** Receives the processed image *instead of* `onChange`, for callers that need a
   *  step between picking a file and storing it (the banner's framing dialog). */
  onPicked?: (dataUrl: string) => void;
  /** Adds a "adjust framing" action to the thumbnail. */
  onAdjust?: () => void;
  /** CSS `object-position` for the stored image, when the caller lets the user
   *  choose which part of it shows. */
  objectPosition?: string;
  /** Zoom past `object-fit: cover`'s minimum, from the same `BannerPosition` the
   *  caller's `onAdjust` modal produces — applied as an outer `transform: scale()`
   *  anchored at `objectPosition`, same as the modal's own preview (see
   *  BannerPositionModal's doc). `1` or absent is a no-op. */
  imageScale?: number;
  maxBytes: number;
  /** Size and radius of the thumbnail, e.g. "w-16 h-16 rounded-xl". */
  thumbClassName: string;
  /** Extra style on the thumbnail image — lets the app background preview its
   *  blur/visibility live in the thumb. */
  thumbImgStyle?: React.CSSProperties;
  /** Rendered on top of the thumbnail image, under the hover actions —
   *  e.g. the app background's legibility scrim, so the thumb previews the
   *  real rendered look rather than the raw file. */
  thumbOverlay?: React.ReactNode;
  /** Shown in the empty tile: a short label, or an icon for the avatar. */
  empty: React.ReactNode;
  /** Sizing for the preview dialog and the image inside it. */
  previewClassName: string;
  previewImgClassName: string;
  /** Extra controls under the thumbnail (the app background's blur slider). */
  children?: React.ReactNode;
  /** Optional multi-image mode used by the app wallpaper picker. */
  gallery?: {
    items: string[];
    activeIndex: number;
    maxItems: number;
    onAdd: (dataUrls: string[]) => void;
    onSelect: (index: number) => void;
    onRemove: (index: number) => void;
  };
}

/**
 * One image setting: pick, replace, preview, remove.
 *
 * Avatar, dashboard banner and app background were three copies of this with
 * three different interaction models — one of them uploaded on click with no
 * preview and a delete icon overlapping the picture, another hid delete
 * inside the preview dialog. They now behave identically, and removing an
 * image asks first: it's one click away from wiping a picture the user
 * cropped and positioned, with no undo.
 */
export function ImageSetting({
  label, sub, value, onChange, processFile, onPicked, onAdjust, objectPosition, imageScale, maxBytes,
  thumbClassName, thumbImgStyle, thumbOverlay, empty, previewClassName, previewImgClassName, children, gallery,
}: Props) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    const remaining = gallery ? gallery.maxItems - gallery.items.length : 1;
    const selected = Array.from(files || []).slice(0, remaining);
    const processed: string[] = [];
    for (const file of selected) {
      if (!file.type.startsWith("image/")) {
        toast.error(t("settings.userAvatarInvalidType"));
        continue;
      }
      if (file.size > maxBytes) {
        toast.error(t("settings.userAvatarTooLarge"));
        continue;
      }
      try {
        processed.push(await processFile(file));
      } catch {
        toast.error(t("settings.userAvatarInvalidType"));
      }
    }
    if (processed.length === 0) return;
    if (gallery) gallery.onAdd(processed);
    else if (onPicked) onPicked(processed[0]);
    else onChange(processed[0]);
  };

  return (
    <SettingRow label={label} sub={sub}>
      <div className="flex min-w-0 max-w-full flex-col items-end gap-2">
        <div className="flex min-w-0 max-w-full items-center gap-1.5">
          {gallery && (
            <Button
              variant="ghost"
              onClick={() => gallery.onSelect((gallery.activeIndex - 1 + gallery.items.length) % gallery.items.length)}
              disabled={gallery.items.length < 2}
              title={t("settings.imagePrevious")}
              className="h-7 w-7 shrink-0 p-0 text-muted-foreground disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          <div className={`group relative shrink-0 max-w-full overflow-hidden bg-muted/80 ring-1 ring-border/60 ${thumbClassName}`}>
            {value ? (
              <>
                {/* Zoom lives on this wrapper, pan (object-position) on the img itself —
                  * kept separate so an unrelated transform a caller passes via
                  * thumbImgStyle (the wallpaper's blur-overscan) never has to compose
                  * with this one. */}
                <div
                  className="h-full w-full"
                  style={imageScale && imageScale !== 1 ? { transform: `scale(${imageScale})`, transformOrigin: objectPosition } : undefined}
                >
                  <img src={value} alt="" className="h-full w-full object-cover transition-[filter,opacity] duration-200" style={{ objectPosition, ...thumbImgStyle }} />
                </div>
                {thumbOverlay}
                <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                  {(!gallery || gallery.items.length < gallery.maxItems) && (
                    <button
                      type="button"
                      onClick={() => inputRef.current?.click()}
                      title={t(gallery ? "settings.imageAdd" : "settings.imageReplace")}
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
                    >
                      <Upload className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {onAdjust && (
                    <button
                      type="button"
                      onClick={onAdjust}
                      title={t("settings.imageAdjust")}
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
                    >
                      <Move className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(true)}
                    title={t("settings.imagePreview")}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="flex h-full w-full items-center justify-center text-[11px] text-muted-foreground transition-colors hover:bg-muted"
              >
                {empty}
              </button>
            )}
          </div>

          {gallery && (
            <Button
              variant="ghost"
              onClick={() => gallery.onSelect((gallery.activeIndex + 1) % gallery.items.length)}
              disabled={gallery.items.length < 2}
              title={t("settings.imageNext")}
              className="h-7 w-7 shrink-0 p-0 text-muted-foreground disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}

          {/* Outside the thumbnail, so it never covers the picture and reads
            * as an action on it rather than part of it. */}
          <Button
            variant="ghost"
            onClick={() => setConfirmRemove(true)}
            disabled={!value}
            title={t("settings.imageRemove")}
            className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-destructive disabled:opacity-30"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          {gallery && (
            <Button
              variant="ghost"
              onClick={() => inputRef.current?.click()}
              disabled={gallery.items.length >= gallery.maxItems}
              title={t("settings.imageAdd")}
              className="h-7 w-7 shrink-0 p-0 text-muted-foreground disabled:opacity-30"
            >
              <Upload className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {gallery && (
          <span className="pr-16 text-[10px] tabular-nums text-muted-foreground">
            {gallery.items.length === 0 ? 0 : gallery.activeIndex + 1} / {gallery.maxItems}
          </span>
        )}

        {children}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={Boolean(gallery)}
        className="hidden"
        onChange={(e) => { void handleFiles(e.target.files); e.target.value = ""; }}
      />

      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} maxWidth="max-w-none" className={previewClassName}>
        <Button
          variant="ghost"
          onClick={() => setPreviewOpen(false)}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full p-0 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </Button>
        <div className="flex w-full items-center justify-center p-6">
          {value && <img src={value} alt="" className={previewImgClassName} style={{ objectPosition }} />}
        </div>
      </Dialog>

      <ConfirmModal
        open={confirmRemove}
        title={t("settings.imageRemoveConfirmTitle")}
        message={t("settings.imageRemoveConfirmMessage")}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          if (gallery) gallery.onRemove(gallery.activeIndex);
          else onChange("");
          setConfirmRemove(false);
          setPreviewOpen(false);
        }}
      />
    </SettingRow>
  );
}
