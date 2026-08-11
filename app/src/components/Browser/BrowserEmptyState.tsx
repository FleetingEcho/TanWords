import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { EmptyCanvas } from "@/components/shared/EmptyCanvas";

const QUICK_LAUNCH = [
  { label: "YouTube", url: "https://www.youtube.com" },
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
    <EmptyCanvas title={t("browser.emptyTitle")} body={t("browser.emptyBody")}>
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
    </EmptyCanvas>
  );
}
