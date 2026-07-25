import React from "react";
import { useSettingsStore } from "@/store/settingsStore";

/** Sits behind the entire app (mounted once in App.tsx, z-index below everything
 *  else) when the user's set a custom background image in Settings. The page
 *  canvas (MainLayout's root bg-background) turns transparent to reveal it —
 *  cards/sidebar stay opaque, see Sidebar.tsx. A fixed dark scrim keeps text
 *  legible regardless of how busy the source image or how little blur is applied. */
export function AppBackground() {
  const image = useSettingsStore((s) => s.appBackgroundImage);
  const blur = useSettingsStore((s) => s.appBackgroundBlur);

  if (!image) return null;

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-background">
      <img
        src={image}
        alt=""
        aria-hidden="true"
        className="w-full h-full object-cover"
        // Scaled up so a blurred edge never reveals empty space at the image boundary.
        style={{ filter: `blur(${blur}px)`, transform: blur > 0 ? "scale(1.08)" : undefined }}
      />
      <div className="absolute inset-0 bg-black/20 dark:bg-black/45" />
    </div>
  );
}
