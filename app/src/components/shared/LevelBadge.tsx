import React from "react";
import { useSettingsStore } from "@/store/settingsStore";

/** CEFR level chip — single source of truth (was duplicated in 5 files). */
export function LevelBadge({ level }: { level?: string | null }) {
  const showLevelBadges = useSettingsStore((s) => s.showLevelBadges);
  if (!level || !showLevelBadges) return null;
  const cls =
    level === "C2" ? "level-c2" :
    level === "C1" ? "level-c1" :
    level === "B2" ? "level-b2" :
    level === "B1" ? "level-b1" : "level-a2";
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${cls}`}>
      {level}
    </span>
  );
}
