import React from "react";
import { useT } from "@/hooks/useT";
import type { DocStatus } from "@/hooks/useDB";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STATUS_LIST, StatusIcon, statusColor, statusLabelKey } from "./documentStatus";

/** The document's lifecycle status, in the editor's metadata strip (left of
 *  the tags). A closed set — "No status" clears it back to ""; everything
 *  else is one of the four values the list filters on.
 *
 *  Status writes go through the editor's hook state (useDocumentEditor), not a
 *  side-channel DB write: handleSave rewrites the whole record, so a status
 *  stored anywhere but in that state would be reverted by the next autosave. */
export function DocumentStatusBar({ status, onChange, disabled = false }: {
  status: DocStatus;
  onChange: (status: DocStatus) => void;
  disabled?: boolean;
}) {
  const t = useT();

  return (
    <Select value={status || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? "" : v as DocStatus)}>
      <SelectTrigger
        disabled={disabled}
        // w-auto/justify-start override SelectTrigger's `w-full
        // justify-between` base: this is a compact inline chip, not a form
        // field, and left unfixed it stretched across the whole strip.
        className={`flex h-6 w-auto shrink-0 items-center justify-start gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-normal leading-4 transition-colors focus:outline-hidden focus:ring-1 focus:ring-ring ${
          status
            ? "border border-border/60 bg-muted/40 text-foreground hover:bg-muted"
            : "border border-transparent text-muted-foreground/70 hover:bg-muted hover:text-foreground"
        } [&_svg]:h-3 [&_svg]:w-3`}
      >
        <StatusIcon status={status} className="h-3 w-3" />
        <SelectValue>
          <span className="font-normal" style={{ color: statusColor(status) }}>
            {status ? t(statusLabelKey(status)) : t("doc.noStatus")}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {/* Explicit "clear it back to none" row at the top — the addition of
          * the status is what the strip is for, but so is fixing a mis-set one. */}
        <SelectItem value="__none__" className="font-normal">
          <span className="flex items-center gap-1.5 pr-1 font-normal">
            <StatusIcon status="" className="h-3 w-3" />
            <span>{t("doc.noStatus")}</span>
          </span>
        </SelectItem>
        {STATUS_LIST.map((value) => (
          <SelectItem key={value} value={value} className="font-normal">
            <span className="flex items-center gap-1.5 pr-1 font-normal" style={{ color: statusColor(value) }}>
              <StatusIcon status={value} className="h-3 w-3" />
              <span>{t(statusLabelKey(value))}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
