import React from "react";
import { useT } from "@/hooks/useT";
import { useNavStore } from "@/store/navStore";
import { ChatIcon, FeedIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";

/** Dashboard card: two one-tap jumps into the app's main loops. */
export function QuickActionsWidget() {
  const t = useT();
  const navigate = useNavStore((s) => s.navigate);

  const actions = [
    { icon: FeedIcon, label: t("dash.quick.feeds"), go: () => navigate("feeds") },
    {
      icon: ChatIcon,
      label: t("dash.quick.chat"),
      go: () => {
        navigate("chat");
        window.setTimeout(() => window.dispatchEvent(new CustomEvent("tanwords:new-chat")), 0);
      },
    },
  ];

  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className="grid grid-cols-2 gap-2">
        {actions.map((a) => (
          <Button
            key={a.label}
            variant="ghost"
            onClick={a.go}
            className="h-auto group flex flex-col items-center gap-1.5 py-3 rounded-xl border border-border hover:bg-muted/60 hover:border-primary/30 transition-colors"
          >
            <a.icon className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
            <span className="text-[11px] font-medium text-muted-foreground">{a.label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
