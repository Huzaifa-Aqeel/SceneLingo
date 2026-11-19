// End-to-end on REAL services: the deployed site + the built extension + real Firestore, with a throwaway user.
//   (cd extension && npm run build:dev) && node e2e/prod-e2e.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
// EXTENSION_DIR lets the same journey run against any unpacked build, e.g. one unzipped from the live download.
const dist = process.env.EXTENSION_DIR ? path.resolve(process.env.EXTENSION_DIR) : path.resolve(here, "../dist");
const EXT_ID = fs.readFileSync(path.resolve(here, "../key/extension-id.txt"), "utf8").trim();
const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim()]; }));
const PROJECT = env.VITE_FIREBASE_PROJECT_ID, KEY = env.VITE_FIREBASE_API_KEY;
const SITE = "https://herdproof.web.app";
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

if (/127\.0\.0\.1/.test(fs.readFileSync(path.join(dist, "config.js"), "utf8"))) { console.error("dist points at a mock server; rebuild with: npm run build:dev"); process.exit(2); }

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, step = 200) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch { /* retry */ } await sleep(step); } return false; };
const rest = async (method, url, token, body) => { const r = await fetch(url, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch { /* */ } return { status: r.status, json: j }; };

const email = `scenelingo-e2e-${crypto.randomBytes(5).toString("hex")}@example.com`;
const password = crypto.randomBytes(12).toString("base64url") + "aA1";
const su = await rest("POST", `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, null, { email, password, returnSecureToken: true });
if (su.status !== 200) { console.error("cannot create the throwaway account", su.json); process.exit(2); }
const uid = su.json.localId; let idToken = su.json.idToken;

const base = path.join(os.homedir(), ".cache/ms-playwright");
const dir = fs.readdirSync(base).find((x) => /^chromium-\d+/.test(x));
const exe = path.join(base, dir, fs.readdirSync(path.join(base, dir)).find((x) => x.startsWith("chrome-linux")), "chrome");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sl-prod-"));
const ctx = await chromium.launchPersistentContext(profile, { executablePath: exe, headless: false, viewport: { width: 1100, height: 760 }, args: ["--headless=new", `--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--no-sandbox"] });

const ytHtml = `<!doctype html><title>Live e2e video - YouTube</title><body style="margin:0"><video id="v" width="640" height="360" muted></video>
<div class="ytp-caption-window-container" style="position:absolute;left:100px;top:300px"><div class="caption-visual-line"><span class="ytp-caption-segment" id="cap">We're getting ahead of ourselves here.</span></div></div></body>`;
await ctx.route("https://www.youtube.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: ytHtml }));

const violations = [], pageErrors = [];
const watch = (p) => { p.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/.test(t)) violations.push(t.slice(0, 200)); else if (m.type() === "error") pageErrors.push(t.slice(0, 200)); }); p.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200))); };
// First install opens the welcome tab by design (once). Use that tab instead of racing it.
const welcome = async () => { const t = Date.now(); while (Date.now() - t < 20000) { const p = ctx.pages().find((x) => x.url().startsWith(SITE)); if (p) return p; await sleep(200); } return null; };
const web = (await welcome()) ?? (await ctx.newPage()); watch(web);
const ping = () => web.evaluate((id) => new Promise((res) => chrome.runtime.sendMessage(id, { type: "ping" }, (r) => res(r ?? { err: chrome.runtime.lastError?.message }))), EXT_ID);
const ownDocs = [];

try {
  // 1. real site loads under the CSP
  await web.waitForSelector("form", { timeout: 25000 });
  check("on first install the welcome tab opens once, in sign-up mode", /welcome=1/.test(web.url()) && (await web.getByRole("button", { name: "Create account" }).count()) === 1, web.url());
  check("deployed site loads and shows the sign-in form", true);
  await web.getByRole("button", { name: "I already have an account" }).click();
  check("site sets the security headers (CSP, no framing, nosniff)", await (async () => { const r = await fetch(SITE); const h = r.headers; return /default-src 'self'/.test(h.get("content-security-policy") || "") && h.get("x-frame-options") === "DENY" && h.get("x-content-type-options") === "nosniff"; })());

  // 2. extension reachable from the real origin, not yet signed in
  const p0 = await ping();
  check("extension is reachable from https://herdproof.web.app (externally_connectable)", p0.ok === true && p0.signedInUid === null, JSON.stringify(p0));

  // 3. sign in through the real UI -> the extension must pick up the session on its own
  await web.fill("#email", email); await web.fill("#password", password);
  await web.getByRole("button", { name: "Sign in", exact: true }).click();
  check("signed in through the real UI (Home is shown)", await until(async () => (await web.locator("h1", { hasText: "Home" }).count()) > 0, 20000));
  check("the extension received the session automatically (no second sign-in)", await until(async () => (await ping()).signedInUid === uid, 15000), JSON.stringify(await ping()));
  const profileDoc = await until(async () => (await rest("GET", `${DOCS}/users/${uid}`, idToken)).status === 200, 10000);
  check("the web app created the user's profile document", profileDoc);

  // 4. capture on a (stand-in) YouTube page, in the same browser
  const yt = await ctx.newPage(); watch(yt);
  await yt.goto("https://www.youtube.com/watch?v=liveE2Etest1");
  const b = await yt.locator("#cap").boundingBox();
  await yt.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  check("capture shows the brief confirmation", await until(async () => /Subtitle captured/.test((await yt.locator('[role="status"]').allInnerTexts()).join(" ")), 8000));

  // 5. it must appear in the real Inbox with no further action
  await web.bringToFront();
  await web.getByRole("link", { name: "Inbox" }).click();
  check("the capture appears in the real Inbox, in real time", await until(async () => (await web.getByText("We're getting ahead of ourselves here.").count()) > 0, 20000));
  const list = await rest("GET", `${DOCS}/users/${uid}/captures`, idToken);
  const docs = list.json.documents || [];
  docs.forEach((d) => ownDocs.push(d.name));
  check("exactly one capture document exists in Firestore, owned by the user", docs.length === 1 && docs[0].fields.ownerUid.stringValue === uid, `docs=${docs.length}`);
  check("the extension's local copy was removed after the server confirmed", await until(async () => { const sw = ctx.serviceWorkers()[0]; const all = await sw.evaluate(() => chrome.storage.local.get(null)); return !Object.keys(all).some((k) => k.startsWith("capture:")); }, 8000));

  // 6. dismiss from the Inbox, then confirm status changed in Firestore
  await web.getByRole("button", { name: "Dismiss" }).click();
  check("dismissing in the Inbox updates Firestore", await until(async () => ((await rest("GET", `${DOCS}/users/${uid}/captures/${docs[0].name.split("/").pop()}`, idToken)).json.fields?.status?.stringValue) === "dismissed", 8000));

  // 7. language picker: choose a language, it must persist
  await web.getByRole("link", { name: "Profile" }).click();
  await web.waitForSelector("#language-select", { timeout: 10000 });
  await web.locator("#language-select").click();
  await web.getByRole("option", { name: /^Spanish/ }).click();
  check("language choice is saved to Firestore", await until(async () => ((await rest("GET", `${DOCS}/users/${uid}/settings/preferences`, idToken)).json.fields?.nativeLanguage?.stringValue) === "es", 8000));
  ownDocs.push(`${DOCS.replace("https://firestore.googleapis.com/v1/", "")}/users/${uid}/settings/preferences`);
  check("Profile shows the extension as connected", await until(async () => (await web.getByText("Connected and signed in.").count()) > 0, 8000));

  // 8. sign out -> extension forgets the session and capturing is disabled
  await web.getByRole("button", { name: "Sign out" }).click();
  check("signing out returns to the sign-in form", await until(async () => (await web.locator("form").count()) > 0, 10000));
  check("the extension forgot the session when the learner signed out", await until(async () => (await ping()).signedInUid === null, 10000), JSON.stringify(await ping()));
  await yt.bringToFront(); await yt.evaluate(() => history.replaceState(null, "", "/watch?v=liveE2Etest2"));
  await yt.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  check("after sign-out, a capture click asks to sign in and stores nothing", await until(async () => /Sign in to SceneLingo/.test((await yt.locator('[role="status"]').allInnerTexts()).join(" ")), 8000));

  // 9. integrity of the deployed page
  check("no Content-Security-Policy violations on the deployed site", violations.length === 0, JSON.stringify(violations.slice(0, 3)));
  const appErrors = pageErrors.filter((e) => !/recaptcha|appcheck|App Check|Failed to load resource/i.test(e));
  check("no unexpected console/page errors", appErrors.length === 0, JSON.stringify(appErrors.slice(0, 3)));
  const hidden = pageErrors.filter((e) => !appErrors.includes(e));
  if (hidden.length) console.log(`      note: ${hidden.length} filtered console message(s): ${JSON.stringify(hidden.slice(0, 3))}`);
} catch (e) {
  check("harness error", false, e.stack);
} finally {
  await ctx.close();
  // cleanup: every trace of the throwaway user
  try {
    const t = await rest("POST", `https://securetoken.googleapis.com/v1/token?key=${KEY}`, null).catch(() => null);
    const ref = su.json.refreshToken;
    const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${KEY}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=refresh_token&refresh_token=${ref}` }).then((x) => x.json());
    idToken = r.id_token || idToken;
    const list = await rest("GET", `${DOCS}/users/${uid}/captures`, idToken);
    for (const d of list.json.documents || []) await fetch(`https://firestore.googleapis.com/v1/${d.name}`, { method: "DELETE", headers: { Authorization: `Bearer ${idToken}` } });
    await fetch(`${DOCS}/users/${uid}/settings/preferences`, { method: "DELETE", headers: { Authorization: `Bearer ${idToken}` } });
    await fetch(`${DOCS}/users/${uid}`, { method: "DELETE", headers: { Authorization: `Bearer ${idToken}` } });
    const del = await rest("POST", `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${KEY}`, null, { idToken });
    console.log(`cleanup: test documents and test account removed (HTTP ${del.status})`);
  } catch (e) { console.log("cleanup problem:", e.message, "| throwaway user:", email); }
  fs.rmSync(profile, { recursive: true, force: true });
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
