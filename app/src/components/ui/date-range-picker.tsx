import * as React from "react";
import type { DateRange } from "react-day-picker";
import { CalendarIcon, XIcon } from "lucide-react";
import { formatCalendarDate, parseCalendarDate } from "@/lib/calendarDate";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DateRangePickerProps {
  /** ISO date strings ("yyyy-MM-dd"), or "" when unset. */
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  placeholder: string;
  className?: string;
}

/** Compact date-range picker built on shadcn's Popover + Calendar (range mode) —
 *  themed via the shared CSS variables, so it matches light/dark automatically
 *  (unlike a native `<input type="date">`, whose calendar popup ignores app theme). */
export function DateRangePicker({ from, to, onChange, placeholder, className }: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);

  const range: DateRange | undefined = from || to ? {
    from: from ? parseCalendarDate(from) : undefined,
    to: to ? parseCalendarDate(to) : undefined,
  } : undefined;

  // `from`/`to` are already "yyyy-MM-dd", which is exactly what the label
  // shows — the old code round-tripped them through parse+format for nothing.
  const label = from && to
    ? `${from} → ${to}`
    : from
    ? `${from} →`
    : to
    ? `→ ${to}`
    : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-6 flex-1 min-w-0 justify-start gap-1.5 px-2 text-[11px] font-normal",
            !from && !to && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="w-3 h-3 shrink-0" />
          <span className="truncate">{label}</span>
          {(from || to) && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onChange("", ""); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onChange("", ""); } }}
              className="ml-auto shrink-0 rounded hover:text-foreground"
            >
              <XIcon className="w-3 h-3" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={range}
          onSelect={(r) => {
            onChange(r?.from ? formatCalendarDate(r.from) : "", r?.to ? formatCalendarDate(r.to) : "");
          }}
          numberOfMonths={1}
        />
      </PopoverContent>
    </Popover>
  );
}
