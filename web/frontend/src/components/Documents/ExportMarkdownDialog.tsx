import { useEffect, useMemo, useState } from "react";
import { FileText, Search } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export interface MarkdownExportChoice {
  id: string;
  label: string;
  detail?: string;
  searchText?: string;
}

function fuzzyIncludes(text: string, query: string): boolean {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  if (haystack.includes(needle)) return true;
  let cursor = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found < 0) return false;
    cursor = found + 1;
  }
  return true;
}

export function ExportMarkdownDialog({ open, items, onClose, onExport }: {
  open: boolean;
  items: MarkdownExportChoice[];
  onClose: () => void;
  onExport: (ids: string[]) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(new Set(items.map((item) => item.id)));
  }, [open, items]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => fuzzyIncludes(`${item.label} ${item.detail ?? ""} ${item.searchText ?? ""}`, needle));
  }, [items, query]);

  const toggle = (id: string, checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    if (checked) next.add(id); else next.delete(id);
    return next;
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="max-w-lg" className="overflow-hidden">
      <div className="border-b border-border px-5 py-4">
        <DialogTitle className="text-base font-semibold">{t("doc.selectExportTitle")}</DialogTitle>
        <p className="mt-1 text-xs text-muted-foreground">{t("doc.selectExportSub")}</p>
      </div>
      <div className="p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("doc.searchExportDocuments")} className="pl-9" />
        </div>
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{t("doc.selectedCount", { n: selected.size })}</span>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(items.map((item) => item.id)))}>{t("doc.selectAll")}</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>{t("doc.clearSelection")}</Button>
          </div>
        </div>
        <div className="mt-2 max-h-[360px] space-y-1 overflow-y-auto rounded-lg border border-border p-1.5">
          {filtered.map((item) => (
            <label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 hover:bg-muted/60">
              <Checkbox checked={selected.has(item.id)} onCheckedChange={(checked) => toggle(item.id, checked === true)} />
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{item.label}</span>
                {item.detail && <span className="block truncate text-[11px] text-muted-foreground">{item.detail}</span>}
              </span>
            </label>
          ))}
          {filtered.length === 0 && (
            <div className="flex min-h-24 items-center justify-center px-4 text-center text-sm text-muted-foreground">
              {t("doc.noSearchResults")}
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border bg-muted/20 px-5 py-3">
        <Button variant="ghost" onClick={onClose}>{t("settings.cancel")}</Button>
        <Button disabled={selected.size === 0} onClick={() => onExport([...selected])}>{t("doc.exportSelected")}</Button>
      </div>
    </Dialog>
  );
}
