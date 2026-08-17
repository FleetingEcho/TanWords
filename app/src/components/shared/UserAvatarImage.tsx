import { useSettingsStore } from "@/store/settingsStore";

/** The user's avatar, framed with the crop/zoom chosen in Settings (see
 *  BannerPositionModal — the avatar is stored whole, never baked to a
 *  pre-cropped square, so every render site needs to apply the same
 *  position + scale to stay WYSIWYG with the framing modal's preview).
 *  Renders nothing when there's no avatar set — callers own the empty-state
 *  fallback (an icon, initials, …), since that varies by call site.
 *
 *  Zoom lives on the wrapper div, pan (object-position) on the img itself —
 *  kept separate so a caller's own `className`/filters on the img never have
 *  to compose with this transform (same split used by AppBackground,
 *  DashboardPage's banner, and LockScreen). */
export function UserAvatarImage({ className = "h-full w-full object-cover" }: { className?: string }) {
  const avatar = useSettingsStore((s) => s.userAvatar);
  const position = useSettingsStore((s) => s.userAvatarPosition);
  if (!avatar) return null;
  return (
    <div
      className="h-full w-full"
      style={position.scale && position.scale !== 1
        ? { transform: `scale(${position.scale})`, transformOrigin: `${position.x}% ${position.y}%` }
        : undefined}
    >
      <img src={avatar} alt="" className={className} style={{ objectPosition: `${position.x}% ${position.y}%` }} />
    </div>
  );
}
