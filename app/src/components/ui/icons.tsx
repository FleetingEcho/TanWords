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
  ClipboardDocumentListIcon,
  XMarkIcon,
  RssIcon,
  MusicalNoteIcon,
  QueueListIcon,
  FolderOpenIcon,
  ArrowLongRightIcon,
  ArrowPathRoundedSquareIcon,
  ArrowsRightLeftIcon,
  ArrowUpCircleIcon,
  ChatBubbleLeftIcon,
  ArrowUpIcon,
  UserGroupIcon,
  ChevronDownIcon as ChevronDownIconOutline,
  PlusCircleIcon,
  LanguageIcon,
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

export function GitHubIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.23.7-3.91-1.37-3.91-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.39.97.1-.75.4-1.27.74-1.56-2.58-.29-5.29-1.29-5.29-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.96 10.96 0 0 1 5.76 0c2.19-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.72 5.39-5.3 5.68.42.36.79 1.06.79 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
    </svg>
  );
}

// ── Navigation (sidebar pages) ─────────────────────────────────────────────

export function GridIcon({ className }: IconProps) {
  return <Squares2X2Icon className={className} />;
}

export function CompassIcon({ className }: IconProps) {
  return <MapIcon className={className} />;
}

export function UpgradeIcon({ className }: IconProps) {
  return <ArrowUpCircleIcon className={className} />;
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

export function ReplyIcon({ className }: IconProps) {
  return <ChatBubbleLeftIcon className={className} />;
}

export function UpvoteIcon({ className }: IconProps) {
  return <ArrowUpIcon className={className} />;
}

export function PeopleIcon({ className }: IconProps) {
  return <UserGroupIcon className={className} />;
}

export function ChevronDownIcon({ className }: IconProps) {
  return <ChevronDownIconOutline className={className} />;
}

export function LoadMoreIcon({ className }: IconProps) {
  return <PlusCircleIcon className={className} />;
}

export function TranslateIcon({ className }: IconProps) {
  return <LanguageIcon className={className} />;
}
