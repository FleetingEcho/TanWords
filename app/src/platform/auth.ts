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

/** Creates the account and stops there. The server hands back a session token,
 *  but signing straight in on the strength of a form the user just filled in
 *  skips the one moment that proves they can actually get back in — they type
 *  the password once and are inside, so a typo in it only surfaces on the next
 *  launch. Registration returns them to the sign-in form instead. */
export async function register(email: string, password: string, inviteKey: string): Promise<void> {
  const response = await postJson("/api/auth/register", { email, password, inviteKey });
  if (!response.ok) await throwServerError(response);
}

export async function resetPassword(
  email: string,
  newPassword: string,
  inviteKey: string,
): Promise<void> {
  const response = await postJson("/api/auth/reset-password", { email, newPassword, inviteKey });
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
