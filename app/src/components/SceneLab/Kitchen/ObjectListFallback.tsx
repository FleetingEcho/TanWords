import React from "react";
import { KITCHEN_MANIFEST } from "@/features/scene-lab/kitchenManifest";

export function ObjectListFallback({ selectedKey, onSelect }: { selectedKey: string | null; onSelect: (key: string) => void }) {
  return <div className="grid h-full min-h-[420px] grid-cols-2 content-start gap-2 overflow-y-auto rounded-2xl bg-muted/40 p-4 sm:grid-cols-3">
    {KITCHEN_MANIFEST.objects.map((item) => <button key={item.key} onClick={() => onSelect(item.key)} className={`rounded-xl border p-3 text-left transition ${selectedKey === item.key ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"}`}><strong className="block text-sm">{item.labelEn}</strong><span className="text-xs text-muted-foreground">{item.labelZh}</span></button>)}
  </div>;
}
