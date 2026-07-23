import React, { useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import { getTotalTokens, clearUsage } from "@/store/usageStore";
import { Button } from "@/components/ui/button";

export function AiUsageCard() {
  const t = useT();
  const [totals, setTotals] = useState(getTotalTokens());
  const [_, forceUpdate] = useState(0);

  const handleClear = () => {
    clearUsage();
    setTotals(getTotalTokens());
    forceUpdate((n) => n + 1);
  };

  useEffect(() => {
    const handler = () => setTotals(getTotalTokens());
    window.addEventListener("usage-updated", handler);
    return () => window.removeEventListener("usage-updated", handler);
  }, []);

  const fmt = (n: number) => n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toString();

  return (
    <div className="bg-card border border-border rounded-xl px-5 py-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="space-x-4">
          <span className="text-xs text-muted-foreground">{t("settings.inputTokens")}: <span className="font-mono font-semibold text-foreground">{fmt(totals.input)}</span></span>
          <span className="text-xs text-muted-foreground">{t("settings.outputTokens")}: <span className="font-mono font-semibold text-foreground">{fmt(totals.output)}</span></span>
          <span className="text-xs text-muted-foreground">{t("settings.totalTokens")}: <span className="font-mono font-semibold text-foreground">{fmt(totals.total)}</span></span>
        </div>
        <Button variant="link" onClick={handleClear} className="h-auto p-0 text-xs text-muted-foreground hover:text-destructive transition-colors">{t("settings.clearUsage")}</Button>
      </div>
    </div>
  );
}
