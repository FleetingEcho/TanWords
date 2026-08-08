import React, { useState } from "react";
import { ImageMinus } from "lucide-react";
import { useT } from "@/hooks/useT";
import { ImageReducerTool } from "./ImageReducerTool";

/** The set of utility tools the Tools page offers. Each entry maps a card on
 *  the landing grid to the component rendered when it is opened. Add a new
 *  entry here and its i18n keys under `toolsPage.*` to ship another tool. */
type ToolId = "image-reducer";

interface ToolDef {
  id: ToolId;
  titleKey: string;
  descKey: string;
  Icon: React.FC<{ className?: string }>;
}

const TOOLS: ToolDef[] = [
  {
    id: "image-reducer",
    titleKey: "toolsPage.imageReducer.title",
    descKey: "toolsPage.imageReducer.description",
    Icon: ImageMinus,
  },
];

export function ToolsPage() {
  const t = useT();
  const [active, setActive] = useState<ToolId | null>(null);

  // The page is its own tiny router: a card grid, or the open tool. State is
  // local because the choice is page-scoped — leaving Tools and coming back
  // should land on the grid again, not on a half-finished tool.
  if (active === "image-reducer") {
    return <ImageReducerTool onBack={() => setActive(null)} />;
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 animate-fade-in w-full">
      <div>
        <h1 className="text-2xl font-bold">{t("toolsPage.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("toolsPage.subtitle")}</p>
      </div>

      {/* Responsive grid: one column on phones, two on tablets, three on
          desktops. The cards are buttons so the whole tile is the click
          target — bigger on touch, no "Open" button needed. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            onClick={() => setActive(tool.id)}
            // Hover marks the card, it doesn't repaint it. `--accent` is a
            // bright saturated hue in most themes (it is the colour meant to
            // sit *under* accent-foreground), so filling a whole card with it
            // washes the title and description out to nothing — the same trap
            // the sidebar's NavButton documents. The quiet `--muted` fill plus
            // an accent border says "this one" while leaving the text alone.
            className="group text-left bg-card border border-border rounded-2xl p-5 transition-colors hover:border-primary/40 hover:bg-[hsl(var(--muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <tool.Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold truncate">{t(tool.titleKey)}</p>
                <p className="text-xs text-muted-foreground mt-0.5 transition-colors group-hover:text-primary">
                  {t("toolsPage.open")} →
                </p>
              </div>
            </div>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed line-clamp-2">
              {t(tool.descKey)}
            </p>
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground pt-1">{t("toolsPage.comingSoon")}</p>
    </div>
  );
}
