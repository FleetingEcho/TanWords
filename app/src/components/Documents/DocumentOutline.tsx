import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
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

/** Heading list for the document, recomputed when `tick` changes.
 *  Exported so a surrounding layout (the read-only article reader) can hide
 *  the whole outline column — including its balancing spacer — when the
 *  document has no headings at all. */
export function useOutlineItems(editor: any, tick: number): OutlineItem[] {
  return useMemo(() => {
    // Null until the editor mounts — the outline simply has nothing to show
    // yet, which is also the honest state for a document still parsing.
    if (!editor) return [];
    // Cheap path: the editor walks its own tree for headings. The fallback
    // (serialize the whole document, walk every block) exists for editor
    // implementations without it — neither is free, only one is affordable
    // per document change in a large file.
    if (typeof editor.getOutlineHeadings === "function") return editor.getOutlineHeadings();
    const out: OutlineItem[] = [];
    collect(editor.document, out);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, tick]);
}

function closestScrollViewport(root: HTMLElement | null): HTMLElement | null {
  let element = root?.parentElement ?? null;
  while (element) {
    const overflowY = getComputedStyle(element).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return element;
    element = element.parentElement;
  }
  return (root?.ownerDocument.scrollingElement as HTMLElement | null) ?? null;
}

/** Compact, Notion-like heading rail that follows the document scroll.
 *  The line lengths preserve heading hierarchy; the bright line is the
 *  heading nearest the reading position. */
export function DocumentScrollOutline({
  editor,
  viewportRef,
  className,
}: {
  editor: any;
  viewportRef?: RefObject<HTMLDivElement | null>;
  /** Documents overlay the rail; readers pass sticky positioning instead. */
  className?: string;
}) {
  const t = useT();
  const [tick, setTick] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);
  const navigationFrameRef = useRef(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const items = useOutlineItems(editor, tick);
  const getViewport = useCallback(() => {
    const root = editor?.getViewDom?.() as HTMLElement | null;
    return viewportRef?.current ?? closestScrollViewport(root);
  }, [editor, viewportRef]);

  // Always expose a useful current location immediately. The geometry pass
  // below refines it after layout/scroll, but a late-mounted reader viewport
  // must not leave every TOC item looking inactive in the meantime.
  useEffect(() => {
    setActiveId((current) => items.some((item) => item.id === current)
      ? current
      : (items[0]?.id ?? null));
  }, [items]);

  // Heading edits refresh only this small rail, rather than pushing every
  // editor transaction through the document page and all of its chrome.
  useEffect(() => {
    if (!editor?.onHistoryChange) return;
    const refresh = () => {
      if (refreshTimerRef.current) return;
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        setTick((value) => value + 1);
      }, 250);
    };
    const unsubscribe = editor.onHistoryChange(refresh);
    return () => {
      unsubscribe?.();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [editor]);

  const updateActive = useCallback(() => {
    const viewport = getViewport();
    const root = editor?.getViewDom?.() as HTMLElement | null;
    if (!root || items.length === 0) {
      setActiveId(null);
      return;
    }
    const viewportTop = viewport?.getBoundingClientRect().top ?? 0;
    const viewportHeight = viewport?.clientHeight || window.innerHeight;
    const readingLine = viewportTop + Math.min(160, viewportHeight * 0.25);
    let current = items[0]?.id ?? null;
    for (const item of items) {
      const heading = root.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
      if (!heading) continue;
      if (heading.getBoundingClientRect().top <= readingLine) current = item.id;
      else break;
    }
    setActiveId((active) => active === current ? active : current);
  }, [editor, getViewport, items]);

  useEffect(() => {
    const viewport = getViewport();
    const scrollTarget: HTMLElement | Window = viewport ?? window;
    const schedule = () => {
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        updateActive();
      });
    };
    const root = editor?.getViewDom?.() as HTMLElement | null;
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (root) resizeObserver?.observe(root);
    if (viewport) resizeObserver?.observe(viewport);
    scrollTarget.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    schedule();
    return () => {
      resizeObserver?.disconnect();
      scrollTarget.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [editor, getViewport, items, updateActive]);

  useEffect(() => {
    if (!activeId) return;
    const rail = railRef.current;
    const active = rail?.querySelector<HTMLElement>(`[data-outline-id="${CSS.escape(activeId)}"]`);
    if (!rail || !active) return;

    // Do not use `active.scrollIntoView()` here. The rail lives inside the RSS
    // article viewport, so WebKit may also scroll that outer viewport back to
    // the sticky rail and cancel the heading navigation that just started.
    const railRect = rail.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.top < railRect.top) {
      rail.scrollTop -= railRect.top - activeRect.top;
    } else if (activeRect.bottom > railRect.bottom) {
      rail.scrollTop += activeRect.bottom - railRect.bottom;
    }
  }, [activeId]);

  useEffect(() => () => {
    if (navigationFrameRef.current) cancelAnimationFrame(navigationFrameRef.current);
  }, []);

  if (items.length === 0) return null;

  const navigate = (id: string) => {
    // Update immediately on a TOC click; smooth scrolling may not dispatch its
    // first scroll frame until after the pointer has already revealed the card.
    setActiveId(id);
    const root = editor.getViewDom?.() as HTMLElement | null;
    const heading = root?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    if (!heading) return;

    // Editable documents should still move their caret. Do this before the
    // final scroll because a ProseMirror selection transaction may itself ask
    // the browser to reveal the selection.
    try {
      editor.setTextCursorPosition?.(id, "start");
    } catch {
      // Scrolling is the primary action; selection is only an editor courtesy.
    }

    // `scrollIntoView` is unreliable in the RSS reader because the article is
    // inside an explicit outer scroll pane. Run after React's active-item
    // update and smoothly move that known viewport. The rail now scrolls only
    // itself, so it cannot cancel this animation in WebKit/Electron.
    if (navigationFrameRef.current) cancelAnimationFrame(navigationFrameRef.current);
    navigationFrameRef.current = requestAnimationFrame(() => {
      navigationFrameRef.current = 0;
      const viewport = getViewport();
      if (viewport) {
        const top = viewport.scrollTop
          + heading.getBoundingClientRect().top
          - viewport.getBoundingClientRect().top
          - 24;
        viewport.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      } else {
        heading.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  };

  return (
    <div
      className={`group ${className ?? "absolute right-2 top-1/2 z-20 -translate-y-1/2"}`}
      aria-label={t("doc.outline")}
    >
      {/* The template's compact rail expands only while hovered. Keeping both
        * surfaces in one hover group avoids a dead gap while crossing to the
        * card, and guarantees it closes as soon as the pointer leaves. */}
      <div className="pointer-events-none invisible absolute right-7 top-1/2 w-80 -translate-y-1/2 pr-3 opacity-0 transition-[opacity,visibility] duration-150 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100">
        {/* Keep scrolling on an inner element. WebKit paints a scrollbar past
          * the border radius when the rounded surface itself scrolls, making
          * the thumb appear outside the card at its top and bottom corners. */}
        <div className="overflow-hidden rounded-[28px] border border-border/70 bg-popover/95 shadow-2xl backdrop-blur-xl">
          <div className="document-outline-card-scroll max-h-[min(70vh,32rem)] overflow-y-auto px-5 py-5">
            <div className="space-y-0.5">
              {items.map((item) => {
                const active = item.id === activeId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={active ? "location" : undefined}
                    onClick={() => navigate(item.id)}
                    style={{ paddingLeft: `${8 + (item.level - 1) * 16}px` }}
                    className={`block w-full truncate rounded-lg py-1.5 pr-2 text-left text-sm transition-colors hover:bg-muted ${
                      active ? "bg-primary/8 font-semibold text-primary" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {item.text}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div
        ref={railRef}
        className="document-scroll-outline flex max-h-[70vh] flex-col items-end gap-0.5 overflow-y-auto px-1 py-2"
      >
        {items.map((item) => {
          const active = item.id === activeId;
          const width = item.level <= 1 ? 24 : item.level === 2 ? 18 : 12;
          return (
            <button
              key={item.id}
              data-outline-id={item.id}
              type="button"
              title={item.text}
              aria-label={item.text}
              aria-current={active ? "location" : undefined}
              onClick={() => navigate(item.id)}
              className="flex h-3 w-7 shrink-0 items-center justify-end rounded-sm"
            >
              <span
                className={`block h-0.5 rounded-full transition-[width,background-color] ${
                  active ? "bg-primary" : "bg-muted-foreground/30 hover:bg-muted-foreground/55"
                }`}
                style={{ width }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
