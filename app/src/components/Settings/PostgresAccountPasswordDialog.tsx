import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/hooks/useT";
import { maskedPasswordProps } from "@/lib/maskedInput";

export function PostgresAccountPasswordDialog({
  action,
  busy,
  onCancel,
  onConfirm,
}: {
  action: "reveal" | "rotate" | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (password: string) => void;
}) {
  const t = useT();
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (action) setPassword("");
  }, [action]);

  const submit = () => {
    if (password && !busy) onConfirm(password);
  };

  return (
    <Dialog open={action !== null} onClose={onCancel} maxWidth="max-w-sm">
      <div className="space-y-3 p-5">
        <DialogTitle className="text-sm font-semibold">
          {t(action === "rotate"
            ? "settings.remoteAccessRotateConfirmTitle"
            : "settings.remoteAccessRevealTitle")}
        </DialogTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(action === "rotate"
            ? "settings.remoteAccessRotateConfirmMessage"
            : "settings.remoteAccessRevealMessage")}
        </p>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-foreground">
            {t("settings.remoteAccessAccountPassword")}
          </span>
          <input
            {...maskedPasswordProps("postgres-account-password")}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") submit(); }}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs outline-hidden focus:border-primary"
            autoFocus
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={onCancel}
          className="h-8 rounded-lg px-3 text-xs"
        >
          {t("common.cancel")}
        </Button>
        <Button
          disabled={busy || !password}
          onClick={submit}
          className={`h-8 rounded-lg px-4 text-xs font-semibold disabled:opacity-50 ${
            action === "rotate"
              ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          }`}
        >
          {busy
            ? t("settings.remoteAccessWorking")
            : t(action === "rotate" ? "settings.remoteAccessRotate" : "settings.remoteDBShowUrl")}
        </Button>
      </div>
    </Dialog>
  );
}
