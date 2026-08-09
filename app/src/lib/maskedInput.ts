import type React from "react";

/**
 * Input props for a secret the browser's password manager must not touch.
 *
 * The app lock is not an account credential — it's a local screen lock, and on
 * the web build it lives on the very same origin the user signs in on. As a
 * `type="password"` field it is indistinguishable from the sign-in box, so
 * every unlock raises "update your saved password?", and accepting it would
 * overwrite the account password in the user's manager with the lock PIN.
 *
 * Managers (and Chrome's and Safari's built-in ones) key off the input *type*,
 * not off `autocomplete` — `autocomplete="off"` is a documented no-op for
 * password saving. So the field is a plain text box masked by CSS instead,
 * which no manager recognises as a credential. The `data-*` attributes are the
 * opt-out hints 1Password, LastPass and Bitwarden respect.
 */
const CSS_MASKING =
  typeof CSS !== "undefined"
  && typeof CSS.supports === "function"
  && CSS.supports("-webkit-text-security", "disc");

export function maskedPasswordProps(name: string): React.InputHTMLAttributes<HTMLInputElement> {
  return {
    // Falls back to a real password field where the masking property is
    // missing (Firefox before 118): a prompt is annoying, a shoulder-surfable
    // password on screen is worse.
    type: CSS_MASKING ? "text" : "password",
    name,
    autoComplete: "off",
    autoCorrect: "off",
    autoCapitalize: "off",
    spellCheck: false,
    style: CSS_MASKING
      ? ({ WebkitTextSecurity: "disc" } as unknown as React.CSSProperties)
      : undefined,
    "data-1p-ignore": "",
    "data-lpignore": "true",
    "data-bwignore": "",
    "data-form-type": "other",
  } as React.InputHTMLAttributes<HTMLInputElement>;
}
