import React from "react";
import {
  ArrowUp,
  Bookmark,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleArrowUp,
  CirclePlus,
  ClipboardList,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  GripVertical,
  Languages,
  LayoutGrid,
  Lightbulb,
  List,
  Map,
  MapPin,
  MessageSquare,
  MessagesSquare,
  MoveRight,
  Music,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  Repeat1,
  Rss,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Users,
  Volume2,
  X,
} from "lucide-react";

/**
 * Central icon library — every icon in the app is re-exported from here,
 * backed by lucide-react (https://lucide.dev).
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
  return <LayoutGrid className={className} />;
}

export function CompassIcon({ className }: IconProps) {
  return <Map className={className} />;
}

export function UpgradeIcon({ className }: IconProps) {
  return <CircleArrowUp className={className} />;
}

export function MusicIcon({ className }: IconProps) {
  return <Music className={className} />;
}

export function ListIcon({ className }: IconProps) {
  return <List className={className} />;
}

export function FolderIcon({ className }: IconProps) {
  return <FolderOpen className={className} />;
}

// ── Play modes (music queue) ───────────────────────────────────────────────

export function PlayOrderIcon({ className }: IconProps) {
  return <MoveRight className={className} />;
}

export function RepeatIcon({ className }: IconProps) {
  return <Repeat className={className} />;
}

export function RepeatOneIcon({ className }: IconProps) {
  return <Repeat1 className={className} />;
}

export function ShuffleIcon({ className }: IconProps) {
  return <Shuffle className={className} />;
}

export function BookIcon({ className }: IconProps) {
  return <BookOpen className={className} />;
}

export function DocIcon({ className }: IconProps) {
  return <FileText className={className} />;
}

export function ChatIcon({ className }: IconProps) {
  return <MessagesSquare className={className} />;
}

export function SlidersIcon({ className }: IconProps) {
  return <Settings className={className} />;
}

export function FeedIcon({ className }: IconProps) {
  return <Rss className={className} />;
}

// ── Actions & misc ─────────────────────────────────────────────────────────

export function ChevronIcon({ className, direction }: IconProps & { direction: "left" | "right" }) {
  return direction === "left" ? <ChevronLeft className={className} /> : <ChevronRight className={className} />;
}

export function ExternalIcon({ className }: IconProps) {
  return <ExternalLink className={className} />;
}

export function SearchIcon({ className }: IconProps) {
  return <Search className={className} />;
}

export function RefreshIcon({ className }: IconProps) {
  return <RefreshCw className={className} />;
}

export function PinIcon({ filled = false, className }: IconProps & { filled?: boolean }) {
  // lucide ships outline-only glyphs, so "filled" is the same pin painted in.
  return <MapPin className={className} fill={filled ? "currentColor" : "none"} />;
}

export function BookmarkIcon({ className }: IconProps) {
  return <Bookmark className={className} />;
}

export function AnalyzeBackgroundIcon({ className }: IconProps) {
  // Same icon as SparkIcon (ArticleReader's "Learn" button) — both trigger the exact
  // same headless learnChatStore job, just from different entry points (in-reader vs
  // the RSS/HN card), so they should read as the same feature at a glance.
  return <Sparkles className={className} />;
}

export function NotesIcon({ className }: IconProps) {
  return <Lightbulb className={className} />;
}

export function CheckIcon({ className }: IconProps) {
  return <Check className={className} />;
}

export function SpeakerIcon({ className }: IconProps) {
  return <Volume2 className={className} />;
}

export function ClipboardListIcon({ className }: IconProps) {
  return <ClipboardList className={className} />;
}

/** Four-pointed AI spark — replaces the ✦ text glyph used throughout the app. */
export function SparkIcon({ className }: IconProps) {
  return <Sparkles className={className} />;
}

// Transport controls read as solid shapes rather than outlines.
export function PlayIcon({ className }: IconProps) {
  return <Play className={className} fill="currentColor" />;
}

export function PauseIcon({ className }: IconProps) {
  return <Pause className={className} fill="currentColor" />;
}

export function SkipPrevIcon({ className }: IconProps) {
  return <SkipBack className={className} fill="currentColor" />;
}

export function SkipNextIcon({ className }: IconProps) {
  return <SkipForward className={className} fill="currentColor" />;
}

export function CloseIcon({ className }: IconProps) {
  return <X className={className} />;
}

export function ReplyIcon({ className }: IconProps) {
  return <MessageSquare className={className} />;
}

export function UpvoteIcon({ className }: IconProps) {
  return <ArrowUp className={className} />;
}

export function PeopleIcon({ className }: IconProps) {
  return <Users className={className} />;
}

export function ChevronDownIcon({ className }: IconProps) {
  return <ChevronDown className={className} />;
}

export function LoadMoreIcon({ className }: IconProps) {
  return <CirclePlus className={className} />;
}

export function TranslateIcon({ className }: IconProps) {
  return <Languages className={className} />;
}

export function DownloadIcon({ className }: IconProps) {
  return <Download className={className} />;
}

export function GripIcon({ className }: IconProps) {
  return <GripVertical className={className} />;
}
