import React, { useRef, useState } from "react";
import { toast } from "sonner";
import { Eye, Move, Trash2, Upload } from "lucide-react";
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
  label, sub, value, onChange, processFile, onPicked, onAdjust, objectPosition, maxBytes,
  thumbClassName, thumbImgStyle, thumbOverlay, empty, previewClassName, previewImgClassName, children,
}: Props) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("settings.userAvatarInvalidType"));
      return;
    }
    if (file.size > maxBytes) {
      toast.error(t("settings.userAvatarTooLarge"));
      return;
    }
    try {
      const dataUrl = await processFile(file);
      if (onPicked) onPicked(dataUrl);
      else onChange(dataUrl);
    } catch {
      toast.error(t("settings.userAvatarInvalidType"));
    }
  };

  return (
    <SettingRow label={label} sub={sub}>
      <div className="flex flex-col items-end gap-2">
        <div className="flex items-start gap-1.5">
          <div className={`group relative shrink-0 overflow-hidden bg-muted/80 ring-1 ring-border/60 ${thumbClassName}`}>
            {value ? (
              <>
                <img src={value} alt="" className="h-full w-full object-cover transition-[filter,opacity] duration-200" style={{ objectPosition, ...thumbImgStyle }} />
                {thumbOverlay}
                <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    title={t("settings.imageReplace")}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
                  >
                    <Upload className="h-3.5 w-3.5" />
                  </button>
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
        </div>

        {children}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ""; }}
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
        onConfirm={() => { onChange(""); setConfirmRemove(false); setPreviewOpen(false); }}
      />
    </SettingRow>
  );
}
