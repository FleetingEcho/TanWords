import { useEffect, type RefObject } from "react";

/** Calls `onDismiss` when the user clicks outside every one of `refs`, or
 *  presses Escape. Inert while `active` is false, so callers can leave it
 *  mounted and just flip the flag.
 *
 *  It takes a list of refs rather than one because a dropdown rendered
 *  through `createPortal` is not a DOM descendant of the box that owns it —
 *  the anchor and the floating panel are two separate subtrees, and a click
 *  in either is still a click "inside". */
export function useDismissOnOutside(
  active: boolean,
  onDismiss: () => void,
  refs: RefObject<HTMLElement | null>[],
) {
  // Depend on the elements rather than the array literal, which is a new
  // identity on every render and would re-subscribe each time.
  const elements = refs.map((r) => r.current);

  useEffect(() => {
    if (!active) return;
    const isInside = (target: Node) => refs.some((r) => r.current?.contains(target));
    const onPointerDown = (e: MouseEvent) => {
      if (!isInside(e.target as Node)) onDismiss();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, onDismiss, ...elements]);
}
