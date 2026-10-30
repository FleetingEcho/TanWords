import type { ReactElement } from "react";
import { Check, Monitor, Moon, Palette, Sun, type LucideIcon } from "lucide-react";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import type { Theme } from "@/store/settings/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The canonical app-theme list. Every surface uses this one menu so newly
 * added themes cannot appear in the main window but disappear from popouts. */
export const THEME_CHOICES: ReadonlyArray<{ id: Theme; labelKey: string }> = [
  { id: "light", labelKey: "settings.light" },
  { id: "dark", labelKey: "settings.dark" },
  { id: "catppuccin-latte", labelKey: "settings.catppuccinLatte" },
  { id: "catppuccin-mocha", labelKey: "settings.catppuccinMocha" },
  { id: "dracula", labelKey: "settings.dracula" },
  { id: "tokyo-night", labelKey: "settings.tokyoNight" },
  { id: "tokyo-night-day", labelKey: "settings.tokyoNightDay" },
  { id: "tokyo-night-storm", labelKey: "settings.tokyoNightStorm" },
  { id: "dim", labelKey: "settings.dim" },
  { id: "system", labelKey: "settings.system" },
];

function themeChoiceIcon(theme: Theme): LucideIcon {
  if (theme === "dark") return Moon;
  if (theme === "system") return Monitor;
  if (theme === "tokyo-night-day") return Sun;
  return Palette;
}

export function ThemeIcon({ theme, className = "h-4 w-4" }: { theme: Theme; className?: string }) {
  if (theme === "light" || theme === "catppuccin-latte" || theme === "tokyo-night-day") {
    return <Sun className={className} />;
  }
  if (theme === "dark") return <Moon className={className} />;
  if (theme === "system") return <Monitor className={className} />;
  return <Palette className={className} />;
}

/** The same app-wide theme picker used by the main command bar and every
 * standalone sticky surface. The caller owns only the trigger's visual shape. */
export function AppThemeMenu({ trigger }: { trigger: ReactElement }) {
  const t = useT();
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {THEME_CHOICES.map((choice) => {
          const Icon = themeChoiceIcon(choice.id);
          return (
            <DropdownMenuItem key={choice.id} onClick={() => setTheme(choice.id)}>
              <Icon className="h-4 w-4" />
              <span className="flex-1 whitespace-nowrap">{t(choice.labelKey)}</span>
              {theme === choice.id && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
