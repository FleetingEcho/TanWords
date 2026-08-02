import { useEffect, useState } from "react";

/** SSR-safe matchMedia hook. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** True below the Tailwind `lg` breakpoint (1024px) — the app shell switches
 *  to the mobile bottom-tab chrome there, and two-pane pages collapse into a
 *  single pane with an overlay detail view. */
export function useIsNarrow(): boolean {
  return useMediaQuery("(max-width: 1023px)");
}
