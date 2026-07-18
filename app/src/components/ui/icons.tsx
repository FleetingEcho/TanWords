import React from "react";
import {
  Squares2X2Icon,
  MapIcon,
  BookOpenIcon,
  DocumentTextIcon,
  ChatBubbleLeftRightIcon,
  Cog6ToothIcon,
  NewspaperIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowTopRightOnSquareIcon,
  MagnifyingGlassIcon,
  MapPinIcon as MapPinIconOutline,
  LinkIcon as HeroLinkIcon,
  ClipboardDocumentListIcon,
  XMarkIcon,
  RssIcon,
  MusicalNoteIcon,
  QueueListIcon,
  FolderOpenIcon,
  ArrowLongRightIcon,
  ArrowPathRoundedSquareIcon,
  ArrowsRightLeftIcon,
} from "@heroicons/react/24/outline";
import {
  ArrowPathIcon,
  MapPinIcon as MapPinIconSolid,
  SpeakerWaveIcon,
  SparklesIcon,
  PlayIcon as HeroPlayIcon,
  PauseIcon as HeroPauseIcon,
  BackwardIcon,
  ForwardIcon,
} from "@heroicons/react/24/solid";

/**
 * Central icon library — every icon in the app is re-exported from here,
 * backed by @heroicons/react (https://github.com/tailwindlabs/heroicons).
 * Callers size icons via `className` (e.g. "w-4 h-4") same as before.
 */

export interface IconProps {
  className?: string;
}

// ── Navigation (sidebar pages) ─────────────────────────────────────────────

export function GridIcon({ className }: IconProps) {
  return <Squares2X2Icon className={className} />;
}

export function CompassIcon({ className }: IconProps) {
  return <MapIcon className={className} />;
}

export function MusicIcon({ className }: IconProps) {
  return <MusicalNoteIcon className={className} />;
}

export function ListIcon({ className }: IconProps) {
  return <QueueListIcon className={className} />;
}

export function FolderIcon({ className }: IconProps) {
  return <FolderOpenIcon className={className} />;
}

// ── Play modes (music queue) ───────────────────────────────────────────────

export function PlayOrderIcon({ className }: IconProps) {
  return <ArrowLongRightIcon className={className} />;
}

export function RepeatIcon({ className }: IconProps) {
  return <ArrowPathRoundedSquareIcon className={className} />;
}

/** Repeat-one: the repeat glyph with a tiny "1" badge. */
export function RepeatOneIcon({ className }: IconProps) {
  return (
    <span className={`relative inline-flex ${className ?? ""}`}>
      <ArrowPathRoundedSquareIcon className="w-full h-full" />
      <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold leading-none">1</span>
    </span>
  );
}

export function ShuffleIcon({ className }: IconProps) {
  return <ArrowsRightLeftIcon className={className} />;
}

export function BookIcon({ className }: IconProps) {
  return <BookOpenIcon className={className} />;
}

export function DocIcon({ className }: IconProps) {
  return <DocumentTextIcon className={className} />;
}

export function ChatIcon({ className }: IconProps) {
  return <ChatBubbleLeftRightIcon className={className} />;
}

export function SlidersIcon({ className }: IconProps) {
  return <Cog6ToothIcon className={className} />;
}

export function FeedIcon({ className }: IconProps) {
  return <RssIcon className={className} />;
}

export function ReadingIcon({ className }: IconProps) {
  return <NewspaperIcon className={className} />;
}

// ── Actions & misc ─────────────────────────────────────────────────────────

export function ChevronIcon({ className, direction }: IconProps & { direction: "left" | "right" }) {
  return direction === "left" ? <ChevronLeftIcon className={className} /> : <ChevronRightIcon className={className} />;
}

export function ExternalIcon({ className }: IconProps) {
  return <ArrowTopRightOnSquareIcon className={className} />;
}

export function SearchIcon({ className }: IconProps) {
  return <MagnifyingGlassIcon className={className} />;
}

export function RefreshIcon({ className }: IconProps) {
  return <ArrowPathIcon className={className} />;
}

export function PinIcon({ filled = false, className }: IconProps & { filled?: boolean }) {
  return filled ? <MapPinIconSolid className={className} /> : <MapPinIconOutline className={className} />;
}

export function LinkIcon({ className }: IconProps) {
  return <HeroLinkIcon className={className} />;
}

export function SpeakerIcon({ className }: IconProps) {
  return <SpeakerWaveIcon className={className} />;
}

export function ClipboardListIcon({ className }: IconProps) {
  return <ClipboardDocumentListIcon className={className} />;
}

/** Four-pointed AI spark — replaces the ✦ text glyph used throughout the app. */
export function SparkIcon({ className }: IconProps) {
  return <SparklesIcon className={className} />;
}

export function PlayIcon({ className }: IconProps) {
  return <HeroPlayIcon className={className} />;
}

export function PauseIcon({ className }: IconProps) {
  return <HeroPauseIcon className={className} />;
}

export function SkipPrevIcon({ className }: IconProps) {
  return <BackwardIcon className={className} />;
}

export function SkipNextIcon({ className }: IconProps) {
  return <ForwardIcon className={className} />;
}

export function CloseIcon({ className }: IconProps) {
  return <XMarkIcon className={className} />;
}
