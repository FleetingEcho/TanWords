import React from "react";
import { Button } from "@/components/ui/button";

export function SettingRow({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3.5 border-b border-border last:border-0 gap-2 sm:gap-4">
      <div className="min-w-0 w-full sm:w-auto">
        <p className="text-sm font-medium">{label}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      <div className="shrink-0 w-full sm:w-auto">{children}</div>
    </div>
  );
}

export function ToggleGroup({ options, value, onChange }: { options: { id: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 bg-muted p-0.5 rounded-lg">
      {options.map((o) => (
        <Button
          key={o.id}
          variant="ghost"
          onClick={() => onChange(o.id)}
          className={`h-auto px-3 py-1 rounded-md text-xs font-medium transition-colors hover:bg-transparent ${
            value === o.id ? "bg-card shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}
