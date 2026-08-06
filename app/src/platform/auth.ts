import { webAuthFetch, getWebToken, setWebToken, clearWebToken } from "./webClient";

async function throwServerError(response: Response): Promise<never> {
  const body = await response.text();
  try {
    throw (JSON.parse(body).error ?? body);
  } catch (e) {
    throw typeof e === "string" ? e : body;
  }
}

async function postJson(path: string, payload: Record<string, unknown>): Promise<Response> {
  return webAuthFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function login(email: string, password: string): Promise<void> {
  const response = await postJson("/api/auth/login", { email, password });
  if (!response.ok) await throwServerError(response);
  const { token } = (await response.json()) as { token: string };
  setWebToken(token);
}

/** Creates the account and uses the JWT returned by the server immediately.
 *  This keeps registration as one continuous browser sign-in flow, allowing
 *  the password manager to offer to save the submitted credentials instead of
 *  discarding the successful form and asking the user to sign in again. */
export async function register(email: string, password: string, inviteKey: string): Promise<void> {
  const response = await postJson("/api/auth/register", { email, password, inviteKey });
  if (!response.ok) await throwServerError(response);
  const { token } = (await response.json()) as { token: string };
  setWebToken(token);
}

/** Takes the ADMIN key, not the invite key. They are different secrets on
 *  purpose: the invite key is in the hands of everyone who was invited, and
 *  this route sets an arbitrary account's password given only its email — so
 *  sharing one secret between the two doors meant every invited user could
 *  take over every other account. */
export async function resetPassword(
  email: string,
  newPassword: string,
  adminKey: string,
): Promise<void> {
  const response = await postJson("/api/auth/reset-password", { email, newPassword, adminKey });
  if (!response.ok) await throwServerError(response);
}

export async function me(): Promise<{ email: string } | null> {
  if (!getWebToken()) return null;
  try {
    const response = await webAuthFetch("/api/auth/me");
    if (!response.ok) return null;
    return (await response.json()) as { email: string };
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await webAuthFetch("/api/auth/logout", { method: "POST" });
  } catch {
    // Server unreachable — the local token is dropped either way.
  }
  clearWebToken();
}
