// Session handling for the extension.
//
// The extension has no sign-in UI and no Firebase SDK. The web application signs
// the learner in and hands the extension its Firebase refresh token over
// chrome.runtime messaging (externally_connectable, exact origin). The extension
// exchanges that refresh token for short-lived ID tokens through the Secure Token
// REST API, and uses the ID token to call the Firestore REST API.

import { SyncError } from "./errors.js";
import { maskEmail } from "./validate.js";

export const SESSION_KEY = "meta:session";
export const AUTH_STATE_KEY = "meta:authState"; // "ok" | "reauth"

export async function getSession(storage) {
  const r = await storage.get(SESSION_KEY);
  return r[SESSION_KEY] ?? null;
}
export const saveSession = (storage, s) => storage.set({ [SESSION_KEY]: s });
export const clearSession = (storage) => storage.remove([SESSION_KEY, AUTH_STATE_KEY]);

export async function getAuthState(storage) {
  const r = await storage.get(AUTH_STATE_KEY);
  return r[AUTH_STATE_KEY] ?? "ok";
}
export const setAuthState = (storage, state) => storage.set({ [AUTH_STATE_KEY]: state });

export function decodeJwtPayload(token) {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")));
  } catch {
    return {};
  }
}

const AUTH_ERRORS = [
  "TOKEN_EXPIRED",
  "USER_DISABLED",
  "USER_NOT_FOUND",
  "INVALID_REFRESH_TOKEN",
  "MISSING_REFRESH_TOKEN",
  "CREDENTIAL_TOO_OLD_LOGIN_AGAIN",
];

// Exchanges a refresh token for an ID token via the Secure Token REST API.
export async function exchangeRefreshToken({ fetchFn, apiKey, refreshToken, timeoutMs = 15000, baseUrl = "https://securetoken.googleapis.com" }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchFn(`${baseUrl}/v1/token?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new SyncError("network", `token request failed: ${e?.message || e}`);
  } finally {
    clearTimeout(timer);
  }
  let body = {};
  try {
    body = await res.json();
  } catch {
    // non-JSON body
  }
  if (res.ok && body.id_token) {
    const expiresIn = Number(body.expires_in) || 3600;
    return {
      idToken: body.id_token,
      refreshToken: body.refresh_token || refreshToken,
      uid: body.user_id,
      expiresIn,
    };
  }
  const msg = String(body?.error?.message || "");
  if (AUTH_ERRORS.some((m) => msg.includes(m))) throw new SyncError("auth", msg);
  if (res.status >= 500) throw new SyncError("network", `token endpoint ${res.status}`);
  throw new SyncError("unknown", `token endpoint ${res.status} ${msg}`);
}

// Provides ID tokens for the current session, cached until shortly before expiry.
export function createTokenProvider({ storage, fetchFn, apiKey, now = Date.now, baseUrl }) {
  let cache = null; // { uid, idToken, expiresAt }

  async function getIdToken({ force = false } = {}) {
    const session = await getSession(storage);
    if (!session) throw new SyncError("auth", "no session");
    if (!force && cache && cache.uid === session.uid && cache.expiresAt - now() > 60_000) {
      return cache.idToken;
    }
    const t = await exchangeRefreshToken({ fetchFn, apiKey, refreshToken: session.refreshToken, baseUrl });
    if (t.uid !== session.uid) throw new SyncError("auth", "session user mismatch");
    cache = { uid: session.uid, idToken: t.idToken, expiresAt: now() + t.expiresIn * 1000 };
    if (t.refreshToken !== session.refreshToken) {
      await saveSession(storage, { ...session, refreshToken: t.refreshToken });
    }
    return t.idToken;
  }

  return { getIdToken, reset: () => (cache = null) };
}

// Called when the web application hands over a session. Verifies it with Google
// before trusting it: the token must be valid and belong to the claimed uid.
export async function establishSession({ storage, fetchFn, apiKey, uid, refreshToken, baseUrl }) {
  const t = await exchangeRefreshToken({ fetchFn, apiKey, refreshToken, baseUrl });
  if (!uid || t.uid !== uid) throw new SyncError("auth", "uid does not match token");
  const email = decodeJwtPayload(t.idToken).email || "";
  const session = { uid, email, accountHint: maskEmail(email), refreshToken: t.refreshToken };
  await saveSession(storage, session);
  await setAuthState(storage, "ok");
  return session;
}
