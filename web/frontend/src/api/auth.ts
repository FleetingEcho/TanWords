/** Multi-user auth against the web server's `/api/auth/*` routes.
 *
 *  Email + password login; registration and password reset are gated by the
 *  server's TANWORDS_INVITE_KEY so only invited users can get in. The server
 *  hands out an opaque session token held by api/client.ts (sessionStorage);
 *  a server restart means logging in again. */

import { authFetch, getToken, setToken, clearToken } from "./client";

/** Rejects with the server's bare error string, mirroring invoke()'s contract
 *  — callers render it verbatim, so it must not be wrapped in an Error with a
 *  prefix. */
async function throwServerError(response: Response): Promise<never> {
  const body = await response.text();
  try {
    throw (JSON.parse(body).error ?? body);
  } catch (e) {
    throw typeof e === "string" ? e : body;
  }
}

async function postJson(path: string, payload: Record<string, unknown>): Promise<Response> {
  return authFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function login(email: string, password: string): Promise<void> {
  const response = await postJson("/api/auth/login", { email, password });
  if (!response.ok) await throwServerError(response);
  const { token } = (await response.json()) as { token: string };
  setToken(token);
}

/** Register succeeds straight into a session — the response carries the token,
 *  so no separate login round-trip is needed. */
export async function register(email: string, password: string, inviteKey: string): Promise<void> {
  const response = await postJson("/api/auth/register", { email, password, inviteKey });
  if (!response.ok) await throwServerError(response);
  const { token } = (await response.json()) as { token: string };
  setToken(token);
}

/** 204 on success — nothing to store; the caller sends the user to login. */
export async function resetPassword(email: string, newPassword: string, inviteKey: string): Promise<void> {
  const response = await postJson("/api/auth/reset-password", { email, newPassword, inviteKey });
  if (!response.ok) await throwServerError(response);
}

/** The signed-in account, or null. Cheap intended use: once at app boot to
 *  decide auth gate vs shell. A 401 already cleared the token (authFetch), so
 *  the 'tanwords:unauthorized' bounce fires from here too. */
export async function me(): Promise<{ email: string } | null> {
  if (!getToken()) return null;
  try {
    const response = await authFetch("/api/auth/me");
    if (!response.ok) return null;
    return (await response.json()) as { email: string };
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await authFetch("/api/auth/logout", { method: "POST" });
  } catch {
    // Server unreachable — the token is dropped locally either way.
  }
  clearToken();
}
