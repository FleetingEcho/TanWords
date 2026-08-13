import { useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function BackupPasswordDialog({
  open,
  mode,
  onCancel,
  onPlain,
  onConfirm,
}: {
  open: boolean;
  mode: "export" | "import";
  onCancel: () => void;
  onPlain?: () => void;
  onConfirm: (password: string) => void;
}) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [encrypt, setEncrypt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPassword("");
      setConfirm("");
      setEncrypt(false);
      setError(null);
    }
  }, [open]);

  const submit = () => {
    if (mode === "export" && !encrypt) {
      onPlain?.();
      return;
    }
    if (!password) {
      setError(t("settings.backupPasswordRequired"));
      return;
    }
    if (mode === "export" && password !== confirm) {
      setError(t("settings.backupPasswordMismatch"));
      return;
    }
    onConfirm(password);
  };

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="max-w-sm">
      <div className="p-5 space-y-3">
        <DialogTitle className="text-sm font-semibold">
          {t(mode === "export" ? "settings.backupPasswordTitle" : "settings.importPasswordTitle")}
        </DialogTitle>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t(mode === "export" ? "settings.backupPasswordMessage" : "settings.importPasswordMessage")}
        </p>
        {mode === "export" && (
          <div className="flex items-center gap-5">
            <label className="flex items-center gap-2 text-xs font-medium">
              <input
                type="radio"
                name="backup-encrypt"
                checked={!encrypt}
                onChange={() => setEncrypt(false)}
              />
              {t("settings.backupNoPasswordChoice")}
            </label>
            <label className="flex items-center gap-2 text-xs font-medium">
              <input
                type="radio"
                name="backup-encrypt"
                checked={encrypt}
                onChange={() => setEncrypt(true)}
              />
              {t("settings.backupEncryptChoice")}
            </label>
          </div>
        )}
        {(mode === "import" || encrypt) && (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-foreground">{t("settings.backupPassword")}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs outline-hidden focus:border-primary"
            />
          </label>
        )}
        {encrypt && mode === "export" && (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-foreground">{t("settings.backupPasswordConfirm")}</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs outline-hidden focus:border-primary"
            />
          </label>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
        <Button variant="ghost" onClick={onCancel} className="h-8 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted">
          {t("common.cancel")}
        </Button>
        <Button onClick={submit} className="h-8 px-3 rounded-lg text-xs font-semibold">
          {t(mode === "export" ? "settings.backupContinue" : "settings.importPasswordConfirm")}
        </Button>
      </div>
    </Dialog>
  );
}
