import React from "react";
import { useT } from "@/hooks/useT";
import { useNavStore } from "@/store/navStore";
import { ChatIcon, FeedIcon, BookIcon, DocIcon, CompassIcon, MusicIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";

/** One-tap jumps into the app's main loops.
 *
 *  This used to be a card inside the Recents grid, where it was the odd one
 *  out: no list, so nothing to size it, and it sat at ~94px next to 240px
 *  neighbours. As a full-width strip under the greeting it reads as what it
 *  actually is — navigation, not a "recent" anything — and the grid below is
 *  left as six cards of identical height. */
export function QuickActionsBar() {
  const t = useT();
  const navigate = useNavStore((s) => s.navigate);

  const actions = [
    { icon: FeedIcon, label: t("dash.quick.feeds"), go: () => navigate("feeds") },
    { icon: BookIcon, label: t("dash.quick.reading"), go: () => navigate("reading") },
    {
      icon: ChatIcon,
      label: t("dash.quick.chat"),
      go: () => {
        navigate("chat");
        window.setTimeout(() => window.dispatchEvent(new CustomEvent("tanwords:new-chat")), 0);
      },
    },
    { icon: CompassIcon, label: t("dash.quick.words"), go: () => navigate("vocabulary") },
    { icon: DocIcon, label: t("dash.quick.docs"), go: () => navigate("documents") },
    { icon: MusicIcon, label: t("dash.quick.music"), go: () => navigate("music") },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {actions.map((a) => (
        <Button
          key={a.label}
          variant="ghost"
          onClick={a.go}
          className="h-auto group flex flex-col items-center gap-1.5 py-3 rounded-xl bg-card border border-border hover:bg-muted/60 hover:border-primary/30 transition-colors"
        >
          <a.icon className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          <span className="text-[11px] font-medium text-muted-foreground">{a.label}</span>
        </Button>
      ))}
    </div>
  );
}
