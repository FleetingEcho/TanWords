import React from "react";
import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/solid";
import { Button } from "@/components/ui/button";

export function TestStatusBadge({ status }: { status: { ok: boolean | null; text: string } }) {
  return (
    <span className="text-xs text-muted-foreground ml-2 inline-flex items-center gap-1">
      {status.ok === true && <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-500" />}
      {status.ok === false && <XCircleIcon className="w-3.5 h-3.5 text-destructive" />}
      {status.text}
    </span>
  );
}

export function ProviderIconButton({ label, onClick, danger = false, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return <Button type="button" variant="ghost" size="icon" onClick={onClick} title={label} aria-label={label} className={`h-8 w-8 rounded-lg ${danger ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive" : "text-muted-foreground hover:bg-primary/10 hover:text-primary"}`}>{children}</Button>;
}
