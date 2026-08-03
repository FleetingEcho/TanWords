import React, { useState } from "react";
import { login, register as registerAccount, resetPassword } from "@/platform/auth";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { SpecimenBackdrop, UnderlineField, WordmarkEntry } from "./authVisuals";

type Mode = "login" | "register" | "forgot";

/** Full-screen gate shown until the device holds a valid web session token.
 *  The desktop app never mounts this component.
 *
 *  Designed as a dictionary entry rather than a centred card: everything this
 *  product saves — a word, its IPA, its part of speech, a gloss — takes that
 *  shape, so the sign-in screen is the first instance of the form the rest of
 *  the app is made of. Two columns from `lg` (the entry reads beside the form,
 *  which suits a landscape iPad), stacked and compressed below it. */
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
        switchMode("login");
        setNotice(t("auth.registerDone"));
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

  const action = mode === "login" ? t("auth.signIn") : mode === "register" ? t("auth.register") : t("auth.resetAction");

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <SpecimenBackdrop />

      <div className="relative mx-auto grid min-h-screen w-full max-w-6xl items-center gap-10 px-6 py-12 sm:px-10 lg:grid-cols-[1.05fr_minmax(0,26rem)] lg:gap-20">
        {/* ── The entry ─────────────────────────────────────────────── */}
        <header className="animate-in fade-in slide-in-from-bottom-3 duration-700 motion-reduce:animate-none">
          <WordmarkEntry gloss={t("auth.gloss")} />

          {/* Three facts, not three features: each is something the product
            * does to your reading, phrased the way a usage note would be. */}
          <ul className="mt-8 hidden max-w-md space-y-2.5 lg:block">
            {["auth.note1", "auth.note2", "auth.note3"].map((key) => (
              <li key={key} className="flex gap-3 text-sm text-muted-foreground">
                <span aria-hidden="true" className="mt-[0.55em] h-px w-5 shrink-0 bg-primary/50" />
                {t(key)}
              </li>
            ))}
          </ul>
        </header>

        {/* ── The form ──────────────────────────────────────────────── */}
        <form
          onSubmit={submit}
          className="w-full animate-in fade-in slide-in-from-bottom-4 duration-700 [animation-delay:120ms] [animation-fill-mode:backwards] motion-reduce:animate-none"
        >
          <div className="rounded-2xl border border-border/70 bg-card/70 p-6 shadow-[0_24px_60px_-40px_rgba(0,0,0,.9)] backdrop-blur-xl sm:p-8">
            <p className="font-serif text-lg font-semibold text-foreground">
              {mode === "login" ? t("auth.signIn") : mode === "register" ? t("auth.register") : t("auth.resetTitle")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {mode === "login" ? t("auth.signInSub") : mode === "register" ? t("auth.registerSub") : t("auth.resetSub")}
            </p>

            <div className="mt-6 space-y-5">
              <UnderlineField
                label={t("auth.email")}
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={setEmail}
              />
              <UnderlineField
                label={mode === "login" ? t("auth.passwordLabel") : t("auth.newPassword")}
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={setPassword}
                hint={mode === "login" ? undefined : t("auth.passwordRule")}
              />
              {mode !== "login" && (
                <>
                  <UnderlineField
                    label={t("auth.confirmPassword")}
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={setConfirm}
                  />
                  <UnderlineField
                    label={t("auth.inviteKey")}
                    type="text"
                    autoComplete="off"
                    value={inviteKey}
                    onChange={setInviteKey}
                    hint={t("auth.inviteKeyHint")}
                  />
                </>
              )}
            </div>

            {error && (
              <p role="alert" className="mt-4 border-l-2 border-destructive pl-3 text-xs leading-relaxed text-destructive">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="mt-4 border-l-2 border-primary pl-3 text-xs leading-relaxed text-primary">
                {notice}
              </p>
            )}

            <Button
              type="submit"
              disabled={!canSubmit}
              className="mt-6 h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              {busy ? t("auth.signingIn") : action}
            </Button>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/60 pt-4 text-xs">
              {mode === "login" ? (
                <>
                  <button
                    type="button"
                    onClick={() => switchMode("register")}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {t("auth.switchToRegister")}
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode("forgot")}
                    className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {t("auth.switchToForgot")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {t("auth.backToLogin")}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
