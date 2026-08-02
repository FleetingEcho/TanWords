import React from "react";
import { useT } from "@/hooks/useT";
import { useNavStore } from "@/store/navStore";
import { ChatIcon, MusicIcon, BookIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { hostCapabilities } from "@/platform";

/** Two one-tap jumps, under the greeting rather than inside the Recents grid —
 *  this is navigation, not a "recent" anything.
 *
 *  Only the AI tutor and Music: everything else it used to offer (Feeds,
 *  Reading, Words, Docs) is one click away in the sidebar anyway, and the
 *  sentence-pattern and feed cards below already lead into those loops.
 *
 *  Icon beside the label rather than above it. At two-across each button is
 *  half the page wide, and a small glyph centred over a caption in that much
 *  space just looks stranded. */
export function QuickActionsBar() {
  const t = useT();
  const navigate = useNavStore((s) => s.navigate);

  const actions = [
    {
      icon: ChatIcon,
      label: t("dash.quick.chat"),
      go: () => {
        navigate("chat");
        window.setTimeout(() => window.dispatchEvent(new CustomEvent("tanwords:new-chat")), 0);
      },
    },
    hostCapabilities.music
      ? { icon: MusicIcon, label: t("dash.quick.music"), go: () => navigate("music") }
      : { icon: BookIcon, label: t("dash.quick.reading"), go: () => navigate("reading") },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {actions.map((a) => (
        <Button
          key={a.label}
          variant="ghost"
          onClick={a.go}
          className="h-auto group flex flex-row items-center justify-center gap-2.5 py-3.5 rounded-xl bg-card border border-border hover:bg-muted/60 hover:border-primary/30 transition-colors"
        >
          <a.icon className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
          <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">
            {a.label}
          </span>
        </Button>
      ))}
    </div>
  );
}
