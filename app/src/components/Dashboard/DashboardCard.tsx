import React from "react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";

/** A card is a 40px header over a body of 48px rows. Two rules decide height,
 *  and between them they cover the two ways this can look wrong:
 *
 *  1. The data never sets it directly. Cards used to size to their content and
 *     ranged from 94px to 241px, because the row caps (SQL `LIMIT 3` vs
 *     `LIMIT 5` vs a local PREVIEW_COUNT) and the row heights (single-line
 *     40px vs two-line 46px) were each decided per widget. One row is now one
 *     fixed unit everywhere, and `maxRows` caps how many a slot may show.
 *
 *  2. It is not fixed either. A card asks for exactly the rows it has, then
 *     stretches to whatever its grid row settles on — so an empty database
 *     gives a compact dashboard rather than six tall cards full of nothing,
 *     while a full one still lines its neighbours up. `DashboardFill` absorbs
 *     the difference when a card is shorter than the one beside it.
 *
 *  Cards must therefore be laid out in a stretch context (CSS grid's default),
 *  which is what makes neighbours agree without anyone hard-coding a number. */
export const DASHBOARD_ROW_H = 48;
/** Default cap on a slot's rows; the bento gives the hero more and others fewer. */
export const DASHBOARD_BODY_ROWS = 5;

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
    <div className="bg-card border border-border rounded-2xl overflow-hidden flex flex-col h-full">
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
      {/* overflow-hidden, never overflow-y-auto: lists are capped at `maxRows`,
        * so nothing can overflow — and an inner scroller here swallowed the
        * wheel. `overscroll-contain` blocks scroll chaining even when there is
        * nothing to scroll, so hovering a card froze the page behind it. */}
      <div className="flex-1 flex flex-col overflow-hidden">{children}</div>
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
      className="w-full shrink-0 rounded-none flex items-center justify-start gap-2.5 px-4 hover:bg-muted/40 transition-colors text-left border-b border-border last:border-b-0"
    >
      {children}
    </Button>
  );
}

/** Soaks up the gap between a short card and the taller one beside it.
 *
 *  Contributes no height of its own — it only grows into space the grid has
 *  already committed to — so a card with two rows of data is two rows tall on
 *  an otherwise empty dashboard, and two rows plus filler when a neighbour
 *  forces the row taller. The 48px divider stripes continue the list's rhythm,
 *  so that filler reads as a list with room left rather than a blank slab. */
export function DashboardFill() {
  return (
    <div
      aria-hidden
      className="flex-1 min-h-0"
      style={{
        backgroundImage:
          `repeating-linear-gradient(to bottom, transparent 0, transparent ${DASHBOARD_ROW_H - 1}px,` +
          ` hsl(var(--border) / 0.4) ${DASHBOARD_ROW_H - 1}px, hsl(var(--border) / 0.4) ${DASHBOARD_ROW_H}px)`,
      }}
    />
  );
}

/** The "nothing here yet" state. Asks for a couple of rows so the message has
 *  somewhere to sit, then stretches — on a fresh install every card is in this
 *  state at once, and the dashboard should be short rather than tall and bare. */
export function DashboardEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex-1 flex items-center justify-center px-6 text-center"
      style={{ minHeight: DASHBOARD_ROW_H * 2 }}
    >
      <p className="text-xs text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}

/** Placeholder for a card still loading its own data. Sized to what the slot
 *  is likely to show, so the grid doesn't jump when the rows arrive. */
export function DashboardSkeleton({ rows = DASHBOARD_BODY_ROWS }: { rows?: number }) {
  return (
    <div className="animate-pulse flex flex-col flex-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{ height: DASHBOARD_ROW_H }}
          className="shrink-0 flex items-center px-4 border-b border-border last:border-b-0"
        >
          <div className="h-2.5 rounded-full bg-muted" style={{ width: `${65 - i * 7}%` }} />
        </div>
      ))}
    </div>
  );
}
