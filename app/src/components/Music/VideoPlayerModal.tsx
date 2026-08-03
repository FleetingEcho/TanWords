import { useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CloseIcon } from "@/components/ui/icons";
import { useT } from "@/hooks/useT";
import { assetUrl } from "@/ipc/backend";

/** Plays a video file from the music library.
 *
 *  Source is the sidecar's `/asset?path=` route, which serves files through
 *  tower-http's `ServeFile` — that means real Range support, so seeking works
 *  and the file streams instead of being downloaded whole before playback. */
export function VideoPlayerModal({
  track,
  onClose,
}: {
  track: { path: string; title: string } | null;
  onClose: () => void;
}) {
  const t = useT();
  // In-app fullscreen: the dialog grows to fill the window rather than calling
  // requestFullscreen(), which would hand the whole screen to the OS and hide
  // the app's own chrome.
  const [expanded, setExpanded] = useState(false);
  // A new video always starts windowed — inheriting the previous one's
  // fullscreen state is disorienting.
  useEffect(() => { if (!track) setExpanded(false); }, [track]);

  return (
    <Dialog
      open={track !== null}
      onClose={onClose}
      maxWidth={expanded ? "max-w-none" : "max-w-[min(94vw,64rem)]"}
      className={expanded ? "h-screen max-h-screen w-screen overflow-hidden rounded-none border-0" : "overflow-hidden"}
    >
      <DialogTitle className="sr-only">{track?.title ?? ""}</DialogTitle>
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        title={t("common.close")}
        aria-label={t("common.close")}
        className="absolute right-3 top-3 z-10 h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm"
      >
        <CloseIcon className="h-4 w-4" />
      </Button>

      {track && (
        <>
          <video
            key={track.path}
            src={assetUrl(track.path)}
            controls
            autoPlay
            className={`w-full bg-black ${expanded ? "h-[calc(100vh-3.25rem)]" : "max-h-[78vh]"}`}
          />
          <div className="flex items-center gap-3 border-t border-border px-5 py-3">
            <p className="min-w-0 flex-1 truncate text-sm font-medium" title={track.title}>
              {track.title}
            </p>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setExpanded((value) => !value)}
              title={expanded ? t("music.videoExit") : t("music.videoExpand")}
              aria-label={expanded ? t("music.videoExit") : t("music.videoExpand")}
              className="h-7 w-7 shrink-0 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
