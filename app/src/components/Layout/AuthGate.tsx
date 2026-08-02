import React, { useState } from "react";
import { login, register as registerAccount, resetPassword } from "@/platform/auth";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";

type Mode = "login" | "register" | "forgot";

const INPUT_CLASS =
  "h-10 rounded-md border border-input bg-background px-3 text-[16px] outline-none focus:ring-2 focus:ring-primary/40";

function Field(props: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{props.label}</span>
      <input
        type={props.type}
        autoFocus={props.autoFocus}
        autoComplete={props.autoComplete}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className={INPUT_CLASS}
      />
    </label>
  );
}

/** Full-screen gate shown until the device holds a valid web session token.
 * The desktop app never mounts this component. */
export function AuthGate() {
  const t = useT();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [inviteKey, setInviteKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
    setPassword("");
    setConfirm("");
    setInviteKey("");
  };

  const validate = (): string | null => {
    if (!email.trim().includes("@")) return t("auth.emailInvalid");
    if (password.length < 8) return t("auth.passwordTooShort");
    if (mode !== "login" && password !== confirm) return t("auth.passwordMismatch");
    return null;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      setNotice(null);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else if (mode === "register") {
        await registerAccount(email.trim(), password, inviteKey.trim());
      } else {
        await resetPassword(email.trim(), password, inviteKey.trim());
        switchMode("login");
        setNotice(t("auth.resetDone"));
      }
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    !busy &&
    email.trim().length > 0 &&
    password.length > 0 &&
    (mode === "login" || (confirm.length > 0 && inviteKey.trim().length > 0));

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <form
        onSubmit={submit}
        className="w-full max-w-[340px] flex flex-col gap-4 rounded-2xl border border-border bg-card p-8 shadow-sm"
      >
        <div className="text-center space-y-1">
          <h1 className="text-xl font-semibold">
            {mode === "login" ? "TanWords" : mode === "register" ? t("auth.register") : t("auth.switchToForgot")}
          </h1>
          <p className="text-xs text-muted-foreground">{t("auth.subtitle")}</p>
        </div>

        <Field
          label={t("auth.email")}
          type="email"
          autoComplete="email"
          autoFocus
          value={email}
          onChange={setEmail}
        />
        <Field
          label={t("auth.passwordLabel")}
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={setPassword}
        />
        {mode !== "login" && (
          <>
            <Field
              label={t("auth.confirmPassword")}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={setConfirm}
            />
            <Field
              label={t("auth.inviteKey")}
              type="text"
              autoComplete="off"
              value={inviteKey}
              onChange={setInviteKey}
            />
          </>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
        {notice && <p className="text-xs text-emerald-600">{notice}</p>}

        <Button type="submit" disabled={!canSubmit} className="h-10">
          {busy
            ? t("auth.signingIn")
            : mode === "login"
              ? t("auth.signIn")
              : mode === "register"
                ? t("auth.register")
                : t("auth.switchToForgot")}
        </Button>

        <div className="flex items-center justify-center gap-4 text-xs">
          {mode === "login" ? (
            <>
              <button type="button" onClick={() => switchMode("register")} className="text-primary hover:underline">
                {t("auth.switchToRegister")}
              </button>
              <button type="button" onClick={() => switchMode("forgot")} className="text-muted-foreground hover:underline">
                {t("auth.switchToForgot")}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => switchMode("login")} className="text-muted-foreground hover:underline">
              {t("auth.backToLogin")}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
