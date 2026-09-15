import React, { useEffect, useState } from "react";
import { Check, Pencil, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { invoke } from "@/ipc/backend";
import { useT } from "@/hooks/useT";
import { platformDisplayName } from "./providerConstants";

/** One machine that opened this database, as `device_list` returns it. */
interface DeviceInfo {
  deviceId: string;
  label: string;
  platform: string;
  isCurrent: boolean;
  createdAt: string;
  lastSeenAt: string;
}

/** The devices registry, rendered: every machine this database is shared
 *  with, each with a name you can fix from here. This is the human side of
 *  the per-device machinery — the origin badges on providers and the
 *  per-machine path settings all resolve through these rows. */
export function DevicesSection() {
  const t = useT();
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const load = React.useCallback(async () => {
    try {
      setDevices(await invoke<DeviceInfo[]>("device_list"));
      setLoadFailed(false);
    } catch (error) {
      console.warn("device_list failed:", error);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startRename = (device: DeviceInfo) => {
    setEditingId(device.deviceId);
    setDraft(device.label);
  };

  const saveRename = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await invoke("device_rename", { deviceId: editingId, label: draft });
      setEditingId(null);
      await load();
    } catch (error) {
      console.warn("device_rename failed:", error);
    } finally {
      setSaving(false);
    }
  };

  if (loadFailed) {
    return (
      <p className="text-xs text-muted-foreground">{t("settings.devicesLoadFailed")}</p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t("settings.devicesSub")}</p>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {(devices ?? []).map((device) => {
          const platform = platformDisplayName(device.platform);
          const name = device.label || platform || t("settings.unnamedDevice");
          const editing = editingId === device.deviceId;
          return (
            <div
              key={device.deviceId}
              className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 last:border-b-0"
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary/70" />
              {editing ? (
                <>
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !saving) void saveRename();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    maxLength={80}
                    aria-label={t("settings.renameDevice")}
                    className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-primary/30"
                  />
                  <Button
                    variant="ghost"
                    disabled={saving}
                    onClick={() => void saveRename()}
                    className="h-7 shrink-0 rounded-full px-2.5 text-[10px] font-semibold text-primary"
                  >
                    <Check className="h-3 w-3" />
                    {t("settings.save")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setEditingId(null)}
                    className="h-7 shrink-0 rounded-full px-2.5 text-[10px] font-semibold text-muted-foreground"
                  >
                    {t("settings.cancel")}
                  </Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {name}
                    {/* When the label is empty the name IS the platform —
                      * saying it twice says nothing. */}
                    {platform && name !== platform && (
                      <span className="ml-2 font-normal text-xs text-muted-foreground">{platform}</span>
                    )}
                  </span>
                  {device.isCurrent && (
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      {t("settings.thisDevice")}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => startRename(device)}
                    title={t("settings.renameDevice")}
                    className="h-7 shrink-0 rounded-full px-2 text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                </>
              )}
            </div>
          );
        })}
        {devices !== null && devices.length === 0 && (
          <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
            {t("settings.devicesEmpty")}
          </div>
        )}
      </div>
      {/* Older sidecars predate the registry; say so instead of a bare blank. */}
      {devices === null && !loadFailed && (
        <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
          <RefreshCw className="h-3 w-3 animate-spin" />
        </div>
      )}
    </div>
  );
}
