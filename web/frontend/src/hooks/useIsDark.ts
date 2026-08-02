import { useEffect, useState } from "react";

/** Tracks whether the app is in dark mode (the `dark` class on <html>). */
export function useIsDark(): boolean {
  const [, setThemeRevision] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setThemeRevision((revision) => revision + 1);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    return () => observer.disconnect();
  }, []);

  return document.documentElement.classList.contains("dark");
}
