import { Globe } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";

const QUICK_LAUNCH = [
  { label: "X", url: "https://x.com" },
  { label: "GitHub", url: "https://github.com" },
  { label: "Hacker News", url: "https://news.ycombinator.com" },
  { label: "Google", url: "https://www.google.com" },
];

/** Shown before any URL has been opened — paste-a-link prompt plus a few
 * quick-launch shortcuts, so the page isn't just a blank address bar. */
export function BrowserEmptyState({ onOpen }: { onOpen: (url: string) => void }) {
  const t = useT();
  return (
    <div className="h-full flex items-center justify-center animate-fade-in">
      <div className="text-center max-w-sm px-6">
        <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-primary/10 flex items-center justify-center">
          <Globe className="w-10 h-10 text-primary" />
        </div>
        <h2 className="text-lg font-semibold mb-2">{t("browser.emptyTitle")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">{t("browser.emptyBody")}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {QUICK_LAUNCH.map((site) => (
            <Button
              key={site.url}
              variant="outline"
              onClick={() => onOpen(site.url)}
              className="h-8 rounded-full px-4 text-xs font-medium"
            >
              {site.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
