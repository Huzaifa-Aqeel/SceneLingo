// LIVE verification against the real Firebase project, using a throwaway account that is deleted at the end.
// Exercises the actual extension modules (token exchange + REST create) against the deployed security rules.
//   node e2e/live-verify.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { exchangeRefreshToken } from "../src/lib/auth.js";
import { createCapture, buildCommitBody } from "../src/lib/firestore.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim()]; })
);
const PROJECT = env.VITE_FIREBASE_PROJECT_ID, KEY = env.VITE_FIREBASE_API_KEY;
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); };
const note = (s) => console.log("      " + s);

const email = `scenelingo-e2e-${crypto.randomBytes(5).toString("hex")}@example.com`;
const password = crypto.randomBytes(12).toString("base64url") + "aA1";
let idToken, refreshToken, uid;

async function api(method, url, token, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = {};
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json, apiStatus: json?.error?.status, message: json?.error?.message };
}

const fields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k,
  v === null ? { nullValue: null } : typeof v === "string" ? { stringValue: v } : typeof v === "number" ? { doubleValue: v }
  : v instanceof Date ? { timestampValue: v.toISOString() } : Array.isArray(v) ? { arrayValue: { values: v.map((x) => ({ stringValue: x })) } } : v]));

const record = (over = {}) => ({
  id: crypto.randomUUID(), uid, text: "I think we're getting ahead of ourselves.", sentences: ["I think we're getting ahead of ourselves."],
  platform: "youtube", videoId: "abc123XYZ_-", videoTitle: "Live test", videoUrl: "https://www.youtube.com/watch?v=abc123XYZ_-&t=12s",
  playbackTimeSeconds: 12.5, subtitleLanguage: null, capturedAt: Date.now(), schemaVersion: 1, ...over,
});
const create = (rec, tok = idToken) => createCapture({ fetchFn: fetch, projectId: PROJECT, idToken: tok, record: rec }).then((r) => ({ r }), (e) => ({ e }));
const created = [];

try {
  // ---------------------------------------------------------------- account
  const su = await api("POST", `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, null, { email, password, returnSecureToken: true });
  if (su.status !== 200) { check("create throwaway account (Email/Password provider enabled?)", false, `${su.status} ${su.message}`); throw new Error("cannot continue"); }
  ({ idToken, refreshToken, localId: uid } = su.json);
  check("throwaway account created", !!uid);

  // ---------------------------------------------------------------- V-2: session handoff material
  const t = await exchangeRefreshToken({ fetchFn: fetch, apiKey: KEY, refreshToken });
  check("V-2  refresh token exchanges for an ID token that belongs to the same uid", t.uid === uid && !!t.idToken);
  idToken = t.idToken;
  const bad = await exchangeRefreshToken({ fetchFn: fetch, apiKey: KEY, refreshToken: "forged" }).then(() => null, (e) => e);
  check("V-2  a forged refresh token is rejected as an auth failure", bad?.kind === "auth", String(bad?.message));

  // ---------------------------------------------------------------- V-1: create-if-absent
  const rec = record();
  const first = await create(rec);
  check("V-1  first create succeeds against the real rules", first.r === "created", JSON.stringify(first.e?.message));
  created.push(rec);
  const second = await create(rec);
  check("V-1  the same capture again is treated as 'exists' (not an error)", second.r === "exists", JSON.stringify({ kind: second.e?.kind, msg: second.e?.message }));
  // What does the server really say? (documents the exact response for the FRD)
  const raw = await api("POST", `${DOCS}:commit`, idToken, buildCommitBody(PROJECT, rec)); // identical, valid body
  note(`raw duplicate-create response: HTTP ${raw.status} ${raw.apiStatus} (${raw.message})`);

  const got = await api("GET", `${DOCS}/users/${uid}/captures/${rec.id}`, idToken);
  const f = got.json.fields || {};
  check("V-1  stored document has server-set syncedAt, status 'new', ownerUid", !!f.syncedAt?.timestampValue && f.status?.stringValue === "new" && f.ownerUid?.stringValue === uid);

  // ---------------------------------------------------------------- rules: what must be rejected
  const other = await create(record({ uid: "someone-else" }));
  check("rules: cannot create a capture under another user's path", other.e?.kind === "permission", JSON.stringify(other));
  const bpf = await create(record({ platform: "vimeo" }));
  check("rules: rejects an unsupported platform", bpf.e?.kind === "permission", JSON.stringify(bpf));
  const big = await create(record({ text: "x".repeat(1001) }));
  check("rules: rejects text over 1000 chars", big.e?.kind === "permission", JSON.stringify(big));
  const nourl = await create(record({ videoUrl: "http://www.youtube.com/watch?v=abc123XYZ_-" }));
  check("rules: rejects a non-HTTPS video URL", nourl.e?.kind === "permission", JSON.stringify(nourl));
  const noauth = await create(record(), null);
  check("rules: rejects an unauthenticated write", noauth.e?.kind === "permission" || noauth.e?.kind === "auth", JSON.stringify(noauth));
  const readOther = await api("GET", `${DOCS}/users/someone-else/captures/x`, idToken);
  check("rules: cannot read another user's data", readOther.status === 403, readOther.status);
  const readOwnMissing = await api("GET", `${DOCS}/users/${uid}/captures/does-not-exist`, idToken);
  check("rules: reading own (missing) doc is allowed (404, not 403)", readOwnMissing.status === 404, readOwnMissing.status);

  // ---------------------------------------------------------------- updates by the web app
  const patch = (fieldPaths, body) => api("PATCH", `${DOCS}/users/${uid}/captures/${rec.id}?${fieldPaths.map((p) => `updateMask.fieldPaths=${p}`).join("&")}`, idToken, { fields: fields(body) });
  check("rules: web app may change a capture's status", (await patch(["status"], { status: "dismissed" })).status === 200);
  const edit = await patch(["text"], { text: "tampered" });
  check("rules: the captured text cannot be edited afterwards", edit.status === 403, edit.status);
  const own = await patch(["ownerUid"], { ownerUid: "someone-else" });
  check("rules: ownerUid cannot be changed", own.status === 403, own.status);
  const badStatus = await patch(["status"], { status: "bogus" });
  check("rules: rejects an invalid status", badStatus.status === 403, badStatus.status);

  // ---------------------------------------------------------------- preferences
  const prefUrl = `${DOCS}/users/${uid}/settings/preferences?updateMask.fieldPaths=nativeLanguage`;
  check("rules: a valid language code is accepted", (await api("PATCH", prefUrl, idToken, { fields: fields({ nativeLanguage: "pt-BR" }) })).status === 200);
  check("rules: a malformed language code is rejected", (await api("PATCH", prefUrl, idToken, { fields: fields({ nativeLanguage: "not a language!" }) })).status === 403);

  // ---------------------------------------------------------------- V-3: is App Check enforced on Firestore?
  check("V-3  Firestore accepts requests with no App Check token (enforcement is OFF for Firestore)", first.r === "created");
} catch (e) {
  if (e.message !== "cannot continue") check("harness error", false, e.stack);
} finally {
  // ---------------------------------------------------------------- cleanup: remove every trace
  if (uid && idToken) {
    for (const r of created) await api("DELETE", `${DOCS}/users/${uid}/captures/${r.id}`, idToken);
    await api("DELETE", `${DOCS}/users/${uid}/settings/preferences`, idToken);
    const del = await api("POST", `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${KEY}`, null, { idToken });
    console.log(`cleanup: test documents deleted, test account deleted (HTTP ${del.status})`);
  }
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
