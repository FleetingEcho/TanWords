import { useEffect, useState } from "react";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/useT";
import { CALENDAR_COLOR_TOKENS, colorTokenToSwatch } from "./calendarColors";
import { addDaysWire, inputValueToWire, todayWire, wireToInputValue } from "./calendarWire";
import type { CalendarCategoryRow, CalendarEventRow } from "@/hooks/useDB.calendar";

export interface EventDraft {
  id?: string;
  title: string;
  start: string; // DB wire: YYYY-MM-DD or YYYY-MM-DD HH:mm
  end: string; // DB wire
  allDay: boolean;
  calendarId: string;
  description: string;
  location: string;
  /** A per-event colour override token, or '' to inherit the calendar's
   *  colour (the only behaviour before this field existed). */
  colorName: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** The event being edited, or null when creating. */
  event: CalendarEventRow | null;
  calendars: CalendarCategoryRow[];
  /** Pre-fill defaults (e.g. clicked date/time). */
  prefill?: Partial<EventDraft> | null;
  onSave: (draft: EventDraft) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

/** Create / edit event dialog. Owns its draft state so the calendar stays
 *  responsive while the modal is open; commits on save. The all-day toggle
 *  swaps the start/end inputs between `date` and `datetime-local` and rewrites
 *  the stored values to the matching wire format. */
export function CalendarEventDialog({
  open, onClose, event, calendars, prefill, onSave, onDelete,
}: Props) {
  const t = useT();
  const [draft, setDraft] = useState<EventDraft>(() => emptyDraft(calendars, prefill));
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Reset the draft (and the delete-confirm step) whenever the dialog opens
  // or the target event changes — the same component instance is reused for
  // create and edit.
  useEffect(() => {
    if (!open) return;
    setDraft(event ? rowToDraft(event) : emptyDraft(calendars, prefill));
    setConfirmingDelete(false);
  }, [open, event, calendars, prefill]);

  const canSave = draft.title.trim().length > 0 && draft.start && draft.end;

  const toggleAllDay = (allDay: boolean) => {
    setDraft((d) => {
      // Re-derive start/end in the new format so the inputs don't show a
      // datetime-local value to an all-day event or vice-versa.
      const startWire = d.start ? (allDay ? d.start.slice(0, 10) : timedFromAllDay(d.start)) : "";
      const endWire = d.end ? (allDay ? d.end.slice(0, 10) : timedFromAllDay(d.end)) : "";
      return { ...d, allDay, start: startWire, end: endWire };
    });
  };

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  /** Delete does not fire on the first click — it swaps the form for an
   *  inline confirm step (below), and only calls through once the user
   *  confirms. Replaces a prior `window.confirm()`, which was jarring next
   *  to every other confirmation in the app already being a themed dialog. */
  const handleDelete = async () => {
    if (!event?.id || !onDelete || saving) return;
    setSaving(true);
    try {
      await onDelete(event.id);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const startInputType = draft.allDay ? "date" : "datetime-local";
  const endInputType = draft.allDay ? "date" : "datetime-local";

  if (confirmingDelete) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="max-w-sm">
        <div className="flex flex-col gap-4 p-5">
          <DialogTitle className="text-base font-semibold">{t("calendar.deleteEvent")}</DialogTitle>
          <p className="text-sm text-muted-foreground">{t("calendar.deleteEventConfirm")}</p>
          <p className="text-xs text-muted-foreground">{t("calendar.deleteEventHint")}</p>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setConfirmingDelete(false)} disabled={saving}>
              {t("calendar.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              {t("calendar.delete")}
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="max-w-lg">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <DialogTitle className="text-base font-semibold">
            {event ? t("calendar.editEvent") : t("calendar.newEvent")}
          </DialogTitle>
          <label className="flex items-center gap-2 text-sm text-muted-foreground select-none cursor-pointer">
            <Checkbox checked={draft.allDay} onCheckedChange={(v) => toggleAllDay(v === true)} />
            {t("calendar.allDay")}
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("calendar.titleField")}</label>
          <Input
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder={t("calendar.titlePlaceholder")}
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("calendar.start")}</label>
            <Input
              type={startInputType}
              value={wireToInputValue(draft.start, draft.allDay)}
              onChange={(e) => setDraft((d) => ({ ...d, start: inputValueToWire(e.target.value, d.allDay) }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("calendar.end")}</label>
            <Input
              type={endInputType}
              value={wireToInputValue(draft.end, draft.allDay)}
              onChange={(e) => setDraft((d) => ({ ...d, end: inputValueToWire(e.target.value, d.allDay) }))}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("calendar.calendar")}</label>
          <Select
            value={draft.calendarId}
            onValueChange={(v) => setDraft((d) => ({ ...d, calendarId: v }))}
          >
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {calendars.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("calendar.eventColor")}</label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setDraft((d) => ({ ...d, colorName: "" }))}
              title={t("calendar.eventColorInherit")}
              aria-label={t("calendar.eventColorInherit")}
              className={`h-6 w-6 rounded-full border-2 bg-[repeating-linear-gradient(45deg,var(--muted-foreground)_0,var(--muted-foreground)_1px,transparent_1px,transparent_4px)] bg-background ${draft.colorName === "" ? "border-foreground" : "border-transparent ring-1 ring-border"}`}
            />
            {CALENDAR_COLOR_TOKENS.map((token) => (
              <button
                key={token}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, colorName: token }))}
                title={t(`color.${token}`)}
                aria-label={t(`color.${token}`)}
                className={`h-6 w-6 rounded-full border-2 ${draft.colorName === token ? "border-foreground" : "border-transparent ring-1 ring-border"}`}
                style={{ backgroundColor: colorTokenToSwatch(token) }}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("calendar.location")}</label>
          <Input
            value={draft.location}
            onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))}
            placeholder={t("calendar.locationPlaceholder")}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("calendar.description")}</label>
          <textarea
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            placeholder={t("calendar.descriptionPlaceholder")}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
          />
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <div>
            {event && onDelete && (
              <Button variant="ghost" onClick={() => setConfirmingDelete(true)} disabled={saving} className="text-destructive hover:text-destructive">
                {t("calendar.delete")}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>{t("calendar.cancel")}</Button>
            <Button onClick={handleSave} disabled={!canSave || saving}>
              {event ? t("calendar.save") : t("calendar.create")}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

// ── draft helpers ────────────────────────────────────────────────────────────

function emptyDraft(calendars: CalendarCategoryRow[], prefill?: Partial<EventDraft> | null): EventDraft {
  const defaultCalId = calendars[0]?.id ?? "default";
  const allDay = prefill?.allDay ?? false;
  const start = prefill?.start ?? (allDay ? todayWire() : `${todayWire()} 09:00`);
  // All-day events span to the next day by default; timed events default to +1h.
  const end = prefill?.end ?? (allDay ? addDaysWire(start, 1) : `${todayWire()} 10:00`);
  return {
    title: prefill?.title ?? "",
    start,
    end,
    allDay,
    calendarId: prefill?.calendarId ?? defaultCalId,
    description: prefill?.description ?? "",
    location: prefill?.location ?? "",
    colorName: prefill?.colorName ?? "",
  };
}

function rowToDraft(row: CalendarEventRow): EventDraft {
  return {
    id: row.id,
    title: row.title,
    start: row.start,
    end: row.end,
    allDay: row.all_day,
    calendarId: row.calendar_id || "default",
    description: row.description,
    location: row.location,
    colorName: row.color_name ?? "",
  };
}

/** Turn an all-day wire (`YYYY-MM-DD`) into a timed wire at 09:00 so flipping
 *  all-day off lands the event on a sensible default rather than 00:00. */
function timedFromAllDay(wire: string): string {
  const date = wire.slice(0, 10);
  return `${date} 09:00`;
}

// Re-export so the picker stays in sync if the palette grows.
export { CALENDAR_COLOR_TOKENS };
