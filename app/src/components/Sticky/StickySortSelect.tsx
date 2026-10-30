import { useCallback, useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  STICKY_SORT_STORAGE_KEY,
  isStickySortMode,
  loadStickySortMode,
  saveStickySortMode,
  type StickySortMode,
} from "./stickyShared";

export function useStickySort(): [StickySortMode, (mode: StickySortMode) => void] {
  const [mode, setMode] = useState<StickySortMode>(loadStickySortMode);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === STICKY_SORT_STORAGE_KEY && isStickySortMode(event.newValue)) {
        setMode(event.newValue);
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const change = useCallback((next: StickySortMode) => {
    setMode(next);
    saveStickySortMode(next);
  }, []);

  return [mode, change];
}

export function StickySortSelect({
  value,
  onChange,
  compact = false,
  disabled = false,
}: {
  value: StickySortMode;
  onChange: (mode: StickySortMode) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <Select value={value} onValueChange={(next) => onChange(next as StickySortMode)} disabled={disabled}>
      <SelectTrigger
        aria-label={t("sticky.sort")}
        title={t("sticky.sort")}
        className={compact
          ? "h-8 w-28 shrink-0 rounded-full border-input bg-background/70 px-2 text-[11px]"
          : "h-8 w-36 rounded-full border-input bg-background px-2.5 text-xs"}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="created">{t("sticky.sort.created")}</SelectItem>
        <SelectItem value="updated">{t("sticky.sort.updated")}</SelectItem>
        <SelectItem value="title-asc">{t("sticky.sort.titleAsc")}</SelectItem>
        <SelectItem value="title-desc">{t("sticky.sort.titleDesc")}</SelectItem>
      </SelectContent>
    </Select>
  );
}
