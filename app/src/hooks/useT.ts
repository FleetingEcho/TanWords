import { useCallback } from "react";
import { useSettingsStore } from "@/store/settingsStore";
import { translations, Lang } from "@/i18n/translations";

export function useT() {
  const lang = useSettingsStore((s) => s.uiLanguage) as Lang;

  // Stable across renders while `lang` is unchanged — callers that put `t`
  // in a useCallback/useEffect dependency array (e.g. WordDetailModal's
  // runAiEnrich) would otherwise get a new function identity every render,
  // triggering an infinite effect → setState → render loop.
  return useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      const dict = translations[lang] ?? translations.zh;
      let str = dict[key] ?? translations.zh[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(`{${k}}`, String(v));
        }
      }
      return str;
    },
    [lang]
  );
}
