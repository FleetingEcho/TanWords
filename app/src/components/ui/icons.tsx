import React from "react";

/**
 * Central icon library — every hand-drawn SVG icon lives here.
 * Conventions: 20×20 viewBox, stroke="currentColor" strokeWidth 1.6 (outline)
 * or fill="currentColor" (solid), sized by the caller via className.
 */

export interface IconProps {
  className?: string;
}

// ── Navigation (sidebar pages) ─────────────────────────────────────────────

export function GridIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM14 11a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z" />
    </svg>
  );
}

export function CompassIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="10" cy="10" r="7" />
      <path d="M13 7l-2 4-4 2 2-4 4-2z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function BookIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" />
      <path d="M8 6h4M8 9h4M8 12h2" strokeLinecap="round" />
    </svg>
  );
}

export function DocIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 3h7l3 3v11a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" />
      <path d="M12 3v3h3" strokeLinejoin="round" />
      <path d="M7 9h6M7 12h6M7 15h4" strokeLinecap="round" />
    </svg>
  );
}

export function ChatIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v7a2 2 0 01-2 2H7l-4 3V5z" strokeLinejoin="round" />
      <path d="M6 8h8M6 11h5" strokeLinecap="round" />
    </svg>
  );
}

export function SlidersIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 6h12M4 10h12M4 14h12" strokeLinecap="round" />
      <circle cx="7" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="13" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="7" cy="14" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function HNIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="3" width="14" height="14" rx="3" />
      <path d="M7 6.5l3 4 3-4M10 10.5V14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Sentence frame with slots — the pattern library's identity */
export function PatternIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M6.5 3.5H5a2 2 0 00-2 2v9a2 2 0 002 2h1.5M13.5 3.5H15a2 2 0 012 2v9a2 2 0 01-2 2h-1.5" strokeLinecap="round" />
      <path d="M6.5 8h3M6.5 12h7" strokeLinecap="round" />
      <circle cx="12.5" cy="8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ReadingIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M10 5c-1.5-1.2-3.5-1.5-6-1.5v11c2.5 0 4.5.3 6 1.5 1.5-1.2 3.5-1.5 6-1.5v-11c-2.5 0-4.5.3-6 1.5z" strokeLinejoin="round" />
      <path d="M10 5v11" />
    </svg>
  );
}

// ── Actions & misc ─────────────────────────────────────────────────────────

export function ChevronIcon({ className, direction }: IconProps & { direction: "left" | "right" }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d={direction === "left" ? "M12.5 5l-5 5 5 5" : "M7.5 5l5 5-5 5"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ExternalIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M8 5H5a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1v-3" strokeLinecap="round" />
      <path d="M11 4h5v5M15.5 4.5L9 11" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13.5 13.5L17 17" strokeLinecap="round" />
    </svg>
  );
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function PinIcon({ filled = false, className }: IconProps & { filled?: boolean }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M12.5 3l4.5 4.5-1.6 1.6a2 2 0 01-1.9.5l-.6-.15-2.9 2.9.35 2.1a1.5 1.5 0 01-.42 1.32l-.53.53L4.7 11.6l.53-.53a1.5 1.5 0 011.32-.42l2.1.35 2.9-2.9-.15-.6a2 2 0 01.5-1.9L13.5 4z" strokeLinejoin="round" />
      <path d="M7 13l-3.5 3.5" strokeLinecap="round" />
    </svg>
  );
}

export function LinkIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M8.5 11.5a3.5 3.5 0 005 0l2.5-2.5a3.536 3.536 0 00-5-5L9.75 5.25" strokeLinecap="round" />
      <path d="M11.5 8.5a3.5 3.5 0 00-5 0L4 11a3.536 3.536 0 005 5l1.25-1.25" strokeLinecap="round" />
    </svg>
  );
}

export function SpeakerIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 8v4h2.5L10 15V5L6.5 8H4z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />
      <path d="M12.5 7.5a3.5 3.5 0 010 5M14.5 5.5a6 6 0 010 9" strokeLinecap="round" />
    </svg>
  );
}

export function ClipboardListIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="4.5" y="4" width="11" height="13" rx="1.5" />
      <path d="M7.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1" strokeLinejoin="round" />
      <path d="M7.5 8.5h5M7.5 11.5h5M7.5 14.5h3" strokeLinecap="round" />
    </svg>
  );
}

/** Four-pointed AI spark — SVG counterpart of the ✦ text glyph used in copy */
export function SparkIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 2l1.8 6.2L18 10l-6.2 1.8L10 18l-1.8-6.2L2 10l6.2-1.8L10 2z" />
    </svg>
  );
}

export function PlayIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M6 4.5a1 1 0 011.5-.87l9 5.5a1 1 0 010 1.74l-9 5.5A1 1 0 016 15.5v-11z" />
    </svg>
  );
}

export function PauseIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <rect x="5" y="4" width="3.5" height="12" rx="1" />
      <rect x="11.5" y="4" width="3.5" height="12" rx="1" />
    </svg>
  );
}

export function SkipPrevIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <rect x="4" y="4" width="2" height="12" rx="1" />
      <path d="M15.5 4.6a1 1 0 011.5.87v9.06a1 1 0 01-1.5.87l-7-4.53a1 1 0 010-1.74l7-4.53z" />
    </svg>
  );
}

export function SkipNextIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <rect x="14" y="4" width="2" height="12" rx="1" />
      <path d="M4.5 4.6a1 1 0 00-1.5.87v9.06a1 1 0 001.5.87l7-4.53a1 1 0 000-1.74l-7-4.53z" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
    </svg>
  );
}
