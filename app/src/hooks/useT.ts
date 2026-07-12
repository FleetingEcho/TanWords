import { useSettingsStore } from "@/store/settingsStore";
import { translations, Lang } from "@/i18n/translations";

export function useT() {
  const lang = useSettingsStore((s) => s.uiLanguage) as Lang;
  const dict = translations[lang] ?? translations.zh;

  return function t(key: string, vars?: Record<string, string | number>): string {
    let str = dict[key] ?? translations.zh[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(`{${k}}`, String(v));
      }
    }
    return str;
  };
}
