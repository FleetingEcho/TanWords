import { FormEvent, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/useT";

export function LockedDocumentPanel({
  onUnlock,
  onRemoveProtection,
}: {
  onUnlock: (password: string) => Promise<void>;
  onRemoveProtection: (password: string) => Promise<void>;
}) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) return;
    setBusy(true);
    setError("");
    try {
      await onUnlock(password);
    } catch {
      setError(t("doc.invalidPassword"));
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  const removeProtection = async () => {
    if (!password) return;
    setBusy(true);
    setError("");
    try {
      await onRemoveProtection(password);
    } catch {
      setError(t("doc.invalidPassword"));
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-border bg-card p-7 shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <LockKeyhole className="h-6 w-6" />
        </div>
        <h2 className="text-center text-lg font-semibold">{t("doc.lockedTitle")}</h2>
        <p className="mt-1 text-center text-xs text-muted-foreground">{t("doc.lockedHint")}</p>
        <input
          autoFocus
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t("doc.password")}
          className="mt-5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
        />
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <Button type="submit" disabled={!password || busy} className="mt-4 w-full">
          {busy ? t("doc.unlocking") : t("doc.unlock")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={!password || busy}
          onClick={() => void removeProtection()}
          className="mt-2 w-full text-muted-foreground"
        >
          {t("doc.removeProtection")}
        </Button>
      </form>
    </div>
  );
}
