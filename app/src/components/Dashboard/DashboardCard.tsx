import React from "react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";

/** Every card on the Recents grid is exactly this tall, whatever its data.
 *
 *  Before this, each card sized to its content and the five of them ranged
 *  from 94px to 241px, because the row caps (SQL `LIMIT 3` vs `LIMIT 5` vs a
 *  local PREVIEW_COUNT) and the row heights (single-line 40px vs two-line
 *  46px) were all decided independently per widget. Locking the geometry in
 *  one place is the only way that stays true as widgets come and go.
 *
 *  BODY_ROWS x ROW_H is the body; the header is a fixed 40px on top. */
export const DASHBOARD_ROW_H = 48;
export const DASHBOARD_BODY_ROWS = 5;
const BODY_H = DASHBOARD_ROW_H * DASHBOARD_BODY_ROWS;

export function DashboardCard({
  title,
  icon,
  badge,
  meta,
  onViewAll,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  /** Small pill next to the title, e.g. the RSS unread count. */
  badge?: React.ReactNode;
  /** Muted right-aligned detail in the header, e.g. "2 feeds · 2 podcasts".
   *  Lives here rather than as a body row so it costs no list space. */
  meta?: React.ReactNode;
  onViewAll?: () => void;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden flex flex-col">
      <div className="h-10 shrink-0 flex items-center gap-2 px-4 border-b border-border">
        <h2 className="text-sm font-semibold inline-flex items-center gap-1.5 shrink-0">
          {icon}
          {title}
        </h2>
        {badge}
        <span className="flex-1 min-w-0 text-right text-[10px] text-muted-foreground truncate">{meta}</span>
        {onViewAll && (
          <Button
            variant="link"
            onClick={onViewAll}
            className="h-auto p-0 shrink-0 text-[11px] font-semibold text-primary hover:underline"
          >
            {t("dash.viewAll")}
          </Button>
        )}
      </div>
      <div className="overflow-y-auto overscroll-contain" style={{ height: BODY_H }}>
        {children}
      </div>
    </div>
  );
}

/** A body row. Fixed height so a card's row count is the same whether its rows
 *  carry one line of text or two. */
export function DashboardRow({
  onClick,
  children,
}: {
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      style={{ height: DASHBOARD_ROW_H }}
      className="w-full rounded-none flex items-center justify-start gap-2.5 px-4 hover:bg-muted/40 transition-colors text-left border-b border-border last:border-b-0"
    >
      {children}
    </Button>
  );
}

/** Empty rows padding a short list out to the card's full row count.
 *
 *  Without these, a card holding two of five rows is two rows and then a large
 *  blank slab — it reads as broken rather than as a list with room left. The
 *  dividers alone keep the rhythm going, so a sparse card looks the same shape
 *  as a full one. Renders nothing when the list already fills the card. */
export function DashboardFillRows({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          style={{ height: DASHBOARD_ROW_H }}
          className="border-b border-border/40 last:border-b-0"
        />
      ))}
    </>
  );
}

/** Centred in the full body height, so an empty card is the same size as a
 *  full one instead of collapsing. */
export function DashboardEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex items-center justify-center px-6 text-center">
      <p className="text-xs text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}

/** Placeholder for a card still loading its own data — holds the geometry so
 *  the grid doesn't reflow when it arrives. */
export function DashboardSkeleton({ rows = DASHBOARD_BODY_ROWS }: { rows?: number }) {
  return (
    <div className="animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{ height: DASHBOARD_ROW_H }}
          className="flex items-center px-4 border-b border-border last:border-b-0"
        >
          <div className="h-2.5 rounded-full bg-muted" style={{ width: `${65 - i * 7}%` }} />
        </div>
      ))}
    </div>
  );
}
