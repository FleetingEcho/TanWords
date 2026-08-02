import { useMemo } from "react";
import { ListTree } from "lucide-react";
import { useT } from "@/hooks/useT";

interface OutlineItem {
  id: string;
  level: number;
  text: string;
}

function inlineText(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item?.text === "string") return item.text;
        if (item?.content) return inlineText(item.content);
        return "";
      })
      .join(" ");
  }
  if (typeof content?.text === "string") {
    return content.text;
  }
  if (content?.content) {
    return inlineText(content.content);
  }
  return "";
}

function collect(blocks: any[], out: OutlineItem[]): void {
  for (const block of blocks ?? []) {
    if (block?.type === "heading") {
      out.push({
        id: block.id,
        level: Number(block.props?.level) || 1,
        text: inlineText(block.content).trim() || "Untitled heading",
      });
    }
    if (block?.children?.length) collect(block.children, out);
  }
}

/** Heading list for a BlockNote document, recomputed when `tick` changes.
 *  Exported so a surrounding layout (the read-only article reader) can hide
 *  the whole outline column — including its balancing spacer — when the
 *  document has no headings at all. */
export function useOutlineItems(editor: any, tick: number): OutlineItem[] {
  return useMemo(() => {
    const out: OutlineItem[] = [];
    collect(editor.document, out);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, tick]);
}

export function DocumentOutline({ editor, tick }: { editor: any; tick: number }) {
  const t = useT();
  const items = useOutlineItems(editor, tick);

  return (
    <aside className="w-56 shrink-0 overflow-y-auto border-l border-border/60 bg-background/40 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        <ListTree className="h-3.5 w-3.5" />
        {t("doc.outline")}
      </div>
      {items.length === 0 ? (
        <p className="px-1 py-4 text-[11px] text-muted-foreground">{t("doc.outlineEmpty")}</p>
      ) : (
        <div className="space-y-0.5">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                editor.setTextCursorPosition(item.id, "start");
                const dom = (editor._tiptapEditor as any)?.view?.dom as HTMLElement | undefined;
                dom?.querySelector(`[data-id="${CSS.escape(item.id)}"]`)?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }}
              style={{ paddingLeft: `${8 + (item.level - 1) * 12}px` }}
              className={`block w-full truncate rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-muted hover:text-foreground ${
                item.level === 1 ? "font-semibold text-foreground" : "text-muted-foreground"
              }`}
            >
              {item.text}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
