import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BellRing, Save, Send } from "lucide-react";
import { invoke } from "@/ipc/backend";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";

/** The synced `user_settings` keys this section owns. The web server's
 * reminder scheduler reads the same keys from the shared database — saving
 * here is what arms it (a 30s scheduler pass picks changes up on its next
 * tick; there is no restart and no push to re-notify). */
const KEYS = ["ntfy_server_url", "ntfy_topic", "ntfy_all_day_time"] as const;

const DEFAULTS: Record<(typeof KEYS)[number], string> = {
  ntfy_server_url: "",
  ntfy_topic: "",
  ntfy_all_day_time: "09:00",
};

/** The settings values are stored JSON-encoded (the renderer persists with
 * `JSON.stringify`, same as every other synced setting); older rows may
 * still contain raw text, which parses back to themselves. */
function decode(raw: string | null): string {
  if (raw === null) return "";
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : raw;
  } catch {
    return raw;
  }
}

export function NtfySection() {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>({ ...DEFAULTS });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    invoke<(string | null)[]>("db_get_settings", { keys: KEYS })
      .then((stored) => {
        const next = { ...DEFAULTS };
        KEYS.forEach((key, index) => {
          next[key] = stored[index] === null || stored[index] === undefined
            ? DEFAULTS[key]
            : decode(stored[index]) || DEFAULTS[key];
        });
        setValues(next);
      })
      .catch((error) => toast.error(String(error)))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    const serverUrl = values.ntfy_server_url.trim();
    const topic = values.ntfy_topic.trim();
    // The all-day time feeds the Rust scheduler's NaiveTime parse; a bad
    // value would silently fall back to 09:00, so stop it here instead.
    if (!/^\d{2}:\d{2}$/.test(values.ntfy_all_day_time.trim())) {
      toast.error(t("settings.ntfyBadTime"));
      return;
    }
    if (!serverUrl.startsWith("http://") && !serverUrl.startsWith("https://")) {
      toast.error(t("settings.ntfyBadUrl"));
      return;
    }
    if (topic.includes("/")) {
      toast.error(t("settings.ntfyBadTopic"));
      return;
    }
    setSaving(true);
    try {
      for (const key of KEYS) {
        await invoke("db_set_setting", { key, value: JSON.stringify(values[key].trim()) });
      }
      toast.success(
        serverUrl && topic ? t("settings.ntfySaved") : t("settings.ntfySavedDisabled"),
      );
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      await invoke("ntfy_test_notification");
      toast.success(t("settings.ntfyTestSent"));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setTesting(false);
    }
  };

  const field = (key: (typeof KEYS)[number], onChange: (value: string) => void) => (
    <label className="space-y-1.5">
      <span className="text-xs font-medium">{t(`settings.${key}`)}</span>
      <input
        type="text"
        value={values[key]}
        onChange={(event) => onChange(event.target.value)}
        disabled={loading}
        className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-hidden focus:ring-2 focus:ring-ring"
      />
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{t("settings.section.ntfy")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.ntfyDescription")}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-5 border-b border-border bg-linear-to-r from-primary/[0.07] to-transparent px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/10 text-primary"><BellRing className="h-5 w-5" /></div>
            <div>
              <p className="text-sm font-semibold">{t("settings.ntfyPushTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("settings.ntfyPushSubtitle")}</p>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            {field("ntfy_server_url", (v) => setValues((c) => ({ ...c, ntfy_server_url: v })))}
            {field("ntfy_topic", (v) => setValues((c) => ({ ...c, ntfy_topic: v })))}
            {field("ntfy_all_day_time", (v) => setValues((c) => ({ ...c, ntfy_all_day_time: v })))}
          </div>

          <p className="rounded-lg border border-border bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
            {t("settings.ntfySecurityHint")}
          </p>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button
              variant="ghost"
              onClick={() => void test()}
              disabled={loading || testing || saving}
              className="h-9 gap-1.5 rounded-lg px-3 text-xs"
            >
              <Send className="h-3.5 w-3.5" />
              {testing ? t("settings.ntfyTesting") : t("settings.ntfyTest")}
            </Button>
            <Button
              onClick={() => void save()}
              disabled={loading || saving}
              className="h-9 gap-1.5 rounded-lg px-4 text-xs font-semibold"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? t("settings.ntfySaving") : t("settings.ntfySave")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
