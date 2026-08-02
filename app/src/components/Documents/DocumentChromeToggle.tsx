import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/useT";

/** Shows/hides the document editor's metadata chrome (tags, path, content
 *  search, the whole formatting toolbar). Phone-only — on `lg` the chrome is
 *  always visible and this button is gone, because there the chrome costs a
 *  strip of a tall window rather than half the readable area. */
export function DocumentChromeToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const t = useT();
  const label = open ? t("doc.chromeHide") : t("doc.chromeShow");
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-expanded={open}
      className="h-8 w-8 shrink-0 text-muted-foreground lg:hidden"
    >
      {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
    </Button>
  );
}
