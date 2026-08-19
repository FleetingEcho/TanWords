import React from "react";
import { Button } from "@/components/ui/button";

export function SettingRow({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3.5 border-b border-border last:border-0 gap-2 sm:gap-4">
      <div className="min-w-0 w-full sm:w-auto">
        <p className="text-sm font-medium">{label}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      {/* `min-w-0`, not `shrink-0`: a fixed-width control (a 192px image
        thumbnail) otherwise runs straight out of the card on a narrow window. */}
      <div className="min-w-0 w-full sm:w-auto sm:shrink-0">{children}</div>
    </div>
  );
}

/** `className` extends the outer track — e.g. `"max-w-64 mx-auto justify-center"`
 *  to center a capped-width pill on the page. `optionClassName` overrides
 *  each button's color styling (selected vs. not) for callers that want
 *  stronger contrast than the default `muted-foreground`/`bg-card` pair —
 *  e.g. a prominent page-level switch rather than a small inline toggle.
 *  Both are purely additive/optional: a caller that passes neither keeps
 *  today's content-hugging pill and default colors exactly as before. */
export function ToggleGroup({
  options,
  value,
  onChange,
  className = "",
  optionClassName,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
  optionClassName?: (active: boolean) => string;
}) {
  return (
    <div className={`flex items-center gap-1 bg-muted p-0.5 rounded-lg ${className}`}>
      {options.map((o) => {
        const active = value === o.id;
        return (
          <Button
            key={o.id}
            variant="ghost"
            onClick={() => onChange(o.id)}
            className={`h-auto px-3 py-1 rounded-md text-xs font-medium transition-colors hover:bg-transparent ${
              optionClassName
                ? optionClassName(active)
                : active
                  ? "bg-card shadow-xs text-foreground"
                  : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </Button>
        );
      })}
    </div>
  );
}
