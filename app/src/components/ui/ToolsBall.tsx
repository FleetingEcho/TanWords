import React, { useEffect, useRef } from "react";
import { SquaresPlusIcon } from "@heroicons/react/24/outline";
import { useT } from "@/hooks/useT";
import { useToolsBallStore } from "@/store/toolsBallStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useTtsPlayerStore } from "@/store/ttsPlayerStore";
import { usePodcastPlayerStore } from "@/store/podcastPlayerStore";

const SIZE = 44;
const DRAG_THRESHOLD = 5;

/** Floating tools ball — draggable anywhere on screen. Click opens the
 *  unified Documents + AI Chat modal. Position persists across sessions
 *  and the ball stays where the user drags it (no snap-to-edge). */
export function ToolsBall() {
  const t = useT();
  const show = useSettingsStore((s) => s.showQuickDoc);
  const isOpen = useToolsBallStore((s) => s.isOpen);
  const openModal = useToolsBallStore((s) => s.openModal);
  const ballPos = useToolsBallStore((s) => s.ballPos);
  const setBallPos = useToolsBallStore((s) => s.setBallPos);
  const ttsPlayerActive = useTtsPlayerStore((s) => s.status !== "idle");
  const podcastPlayerActive = usePodcastPlayerStore((s) => s.status !== "idle");
  const playerBarVisible = ttsPlayerActive || podcastPlayerActive;

  const [dragging, setDragging] = React.useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);

  // Keep the ball on-screen when the window is resized.
  useEffect(() => {
    const onResize = () => {
      setBallPos(ballPos); // clampBallPos is inside setBallPos
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [ballPos, setBallPos]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: ballPos.x, origY: ballPos.y, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    setDragging(true);
    setBallPos({ x: d.origX + dx, y: d.origY + dy });
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (!d.moved) {
      openModal();
      return;
    }
    setDragging(false);
    // No snap-to-edge — ball stays where dragged.
  };

  if (!show || isOpen) return null;

  // Nudge up if the ball would sit on top of a bottom player bar.
  const y = playerBarVisible ? Math.min(ballPos.y, window.innerHeight - SIZE - 72) : ballPos.y;

  return (
    <button
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title={t("tools.ballLabel")}
      aria-label={t("tools.ballLabel")}
      style={{
        left: ballPos.x,
        top: y,
        width: SIZE,
        height: SIZE,
        transition: dragging ? "none" : "left 0.3s cubic-bezier(0.22, 1, 0.36, 1), top 0.3s cubic-bezier(0.22, 1, 0.36, 1), transform 0.15s",
        touchAction: "none",
      }}
      className={`fixed z-30 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25
        flex items-center justify-center select-none
        ${dragging ? "scale-110 cursor-grabbing shadow-xl" : "hover:bg-primary/90 hover:scale-105 active:scale-95 cursor-grab"}`}
    >
      <SquaresPlusIcon className="w-[19px] h-[19px] pointer-events-none" />
    </button>
  );
}
