// Browser end-to-end test: loads the built DEV extension into real Chromium and drives it
// against a mock Firestore + token server. No real Firebase project is touched.
//
//   cd extension && SCENELINGO_MOCK_BASE=http://127.0.0.1:8787 npm run build:dev && node e2e/e2e.mjs
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../dist");
const EXT_ID = fs.readFileSync(path.resolve(here, "../key/extension-id.txt"), "utf8").trim();
const PORT = 8787;
const WEB = "http://localhost:5173";
const YT = "https://www.youtube.com/watch?v=abc123XYZ_-";

// ------------------------------------------------------------------ mock Google endpoints
const mock = { mode: "ok", docs: new Map(), tokenCalls: 0, commitCalls: 0, lastAuth: null };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const users = { "rt-A": { uid: "userA", email: "alice@example.com" }, "rt-B": { uid: "userB", email: "bob@example.com" } };

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type", "Content-Type": "application/json" };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    const send = (code, obj) => { res.writeHead(code, cors); res.end(JSON.stringify(obj)); };

    if (req.url.startsWith("/v1/token")) {
      mock.tokenCalls++;
      const rt = new URLSearchParams(body).get("refresh_token");
      const u = users[rt];
      if (!u) return send(400, { error: { code: 400, message: "INVALID_REFRESH_TOKEN", status: "INVALID_ARGUMENT" } });
      return send(200, {
        id_token: `${b64({ alg: "none" })}.${b64({ email: u.email, user_id: u.uid })}.sig`,
        refresh_token: rt, user_id: u.uid, expires_in: "3600",
      });
    }
    if (req.url.includes(":commit")) {
      mock.commitCalls++;
      mock.lastAuth = req.headers.authorization;
      if (mock.mode === "offline") return send(503, { error: { code: 503, status: "UNAVAILABLE", message: "down" } });
      if (mock.mode === "denied") return send(403, { error: { code: 403, status: "PERMISSION_DENIED", message: "rules" } });
      const w = JSON.parse(body).writes[0];
      const uid = w.update.name.split("/users/")[1].split("/")[0];
      if (req.headers.authorization !== `Bearer ${b64({ alg: "none" })}.${b64({ email: uid === "userA" ? "alice@example.com" : "bob@example.com", user_id: uid })}.sig`) {
        return send(403, { error: { code: 403, status: "PERMISSION_DENIED", message: "token/uid mismatch" } });
      }
      if (mock.docs.has(w.update.name)) return send(409, { error: { code: 409, status: "ALREADY_EXISTS", message: "Document already exists" } });
      mock.docs.set(w.update.name, { fields: w.update.fields, precondition: w.currentDocument, transforms: w.updateTransforms });
      return send(200, { writeResults: [{}] });
    }
    send(404, { error: { code: 404, status: "NOT_FOUND" } });
  });
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

// ------------------------------------------------------------------ pages
const ytHtml = `<!doctype html><title>Test video - YouTube</title><body style="margin:0">
<video id="v" width="640" height="360" muted></video>
<div class="ytp-caption-window-container" style="position:absolute;left:100px;top:300px">
  <div class="caption-visual-line"><span class="ytp-caption-segment" id="cap">I think we're getting ahead of ourselves.</span></div>
</div>
<script>
  // Fake playback clock, and a tripwire for any attempt to pause/play/seek.
  window.__t = 10; window.__calls = [];
  const v = document.getElementById("v");
  Object.defineProperty(v, "currentTime", { get() { return window.__t; }, set() { window.__calls.push("seek"); } });
  for (const n of ["play", "pause"]) { const o = v[n].bind(v); v[n] = function () { window.__calls.push(n); return o(); }; }
</script></body>`;
const webHtml = `<!doctype html><title>SceneLingo web</title><body>web</body>`;

// ------------------------------------------------------------------ harness
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000, step = 100) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(step); } return false; }

const chromeExe = fs.readdirSync(path.join(os.homedir(), ".cache/ms-playwright")).filter((d) => /^chromium-\d+/.test(d))
  .map((d) => { const base = path.join(os.homedir(), ".cache/ms-playwright", d); const sub = fs.readdirSync(base).find((x) => x.startsWith("chrome-linux")); return path.join(base, sub, "chrome"); })[0];

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-e2e-"));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  executablePath: chromeExe,
  headless: false,
  args: ["--headless=new", `--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--no-sandbox"],
});
await ctx.route("https://www.youtube.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: ytHtml }));
await ctx.route(`${WEB}/**`, (r) => r.fulfill({ status: 200, contentType: "text/html", body: webHtml }));
await ctx.route("http://evil.test/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: webHtml }));

let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 15000 }));
const store = () => sw.evaluate(() => chrome.storage.local.get(null));
const captureKeys = async () => Object.keys(await store()).filter((k) => k.startsWith("capture:"));

const yt = await ctx.newPage();
await yt.goto(YT);
// Content scripts can't see a page-defined currentTime (isolated world), so a new moment = a new video id.
const advance = () => yt.evaluate(() => { window.__n = (window.__n || 0) + 1; history.replaceState(null, '', '/watch?v=vid_' + String(window.__n).padStart(6, '0')); });
const toastText = async () => (await yt.locator('[role="status"]').allInnerTexts()).join(" | ");
async function clickCaption() { const b = await yt.locator("#cap").boundingBox(); await yt.mouse.click(b.x + b.width / 2, b.y + b.height / 2); }
const web = await ctx.newPage();
await web.goto(`${WEB}/`);
const ext = (msg) => web.evaluate(([id, m]) => new Promise((res) => chrome.runtime.sendMessage(id, m, (r) => res(r ?? { lastError: chrome.runtime.lastError?.message }))), [EXT_ID, msg]);

try {
  // 1. signed out
  await yt.bringToFront(); await clickCaption();
  check("signed out: sign-in message shown", await until(async () => /Sign in to SceneLingo/.test(await toastText())), await toastText());
  check("signed out: nothing stored", (await captureKeys()).length === 0);

  // 2. web app hands over the session (only on the allowed origin)
  const ping = await ext({ type: "ping" });
  check("web app origin can reach the extension", ping.ok === true && ping.signedInUid === null, JSON.stringify(ping));
  const bad = await ext({ type: "setSession", uid: "userA", refreshToken: "not-a-real-token" });
  check("forged session is rejected", bad.ok === false, JSON.stringify(bad));
  const set = await ext({ type: "setSession", uid: "userA", refreshToken: "rt-A" });
  check("session handoff accepted", set.ok === true && set.uid === "userA", JSON.stringify(set));
  const mismatch = await ext({ type: "setSession", uid: "userB", refreshToken: "rt-A" });
  check("uid/token mismatch is rejected", mismatch.ok === false, JSON.stringify(mismatch));

  const evil = await ctx.newPage(); await evil.goto("http://evil.test/");
  check("other origins cannot message the extension", await evil.evaluate(() => typeof chrome === "undefined" || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function"));
  await evil.close();

  // 3. online capture
  await yt.bringToFront(); await advance();
  await clickCaption();
  check("capture: brief confirmation toast", await until(async () => /Subtitle captured/.test(await toastText())), await toastText());
  check("capture: no technical wording in toast", !/sync|queue|retry|offline|token/i.test(await toastText()), await toastText());
  check("capture: reached Firestore (create-only, server timestamp)", await until(async () => mock.docs.size === 1));
  const doc = [...mock.docs.entries()][0];
  check("capture: stored under users/userA/captures/<id>", /\/users\/userA\/captures\/[0-9a-f-]{36}$/.test(doc[0]), doc[0]);
  check("capture: create-only precondition + REQUEST_TIME", doc[1].precondition?.exists === false && doc[1].transforms?.[0]?.setToServerValue === "REQUEST_TIME");
  check("capture: ownerUid + sentences saved", doc[1].fields.ownerUid.stringValue === "userA" && doc[1].fields.sentences.arrayValue.values.length === 1);
  check("capture: local copy removed after server success", await until(async () => (await captureKeys()).length === 0));
  check("capture: extension never pauses, plays, or seeks the video", (await yt.evaluate(() => window.__calls)).length === 0, JSON.stringify(await yt.evaluate(() => window.__calls)));

  // 4. duplicate click
  await advance();
  const before = mock.docs.size;
  await clickCaption(); await yt.waitForTimeout(150); await clickCaption();
  await until(async () => mock.docs.size > before);
  await sleep(600);
  check("double-click makes exactly one capture", mock.docs.size === before + 1, `docs ${before} -> ${mock.docs.size}`);

  // 5. offline: still confirms, keeps it locally, syncs later
  mock.mode = "offline";
  await advance();
  const docsOffline = mock.docs.size;
  await clickCaption();
  check("offline: same confirmation (no sync wording)", await until(async () => /Subtitle captured ✓/.test(await toastText())) && !/offline|sync|retry/i.test(await toastText()));
  await until(async () => (await captureKeys()).length === 1);
  await sleep(400);
  const keysOffline = await captureKeys();
  check("offline: capture retained locally, one key per capture", keysOffline.length === 1 && keysOffline[0].startsWith("capture:"), JSON.stringify(keysOffline));
  check("offline: nothing reached Firestore", mock.docs.size === docsOffline);
  const rec = (await store())[keysOffline[0]];
  check("offline: retry scheduled with backoff", rec.sync.attempts === 1 && rec.sync.errorKind === "network" && rec.sync.nextAttemptAt > Date.now(), JSON.stringify(rec.sync));

  // 6. back online: next sync pass delivers it (fast-forward the backoff, then capture again)
  mock.mode = "ok";
  await sw.evaluate(async (k) => { const o = await chrome.storage.local.get(k); o[k].sync.nextAttemptAt = 0; await chrome.storage.local.set(o); }, keysOffline[0]);
  await advance(); await clickCaption();
  check("recovery: held capture and the new one both reach Firestore", await until(async () => mock.docs.size === docsOffline + 2, 10000), `docs=${mock.docs.size}`);
  check("recovery: local queue is empty again", await until(async () => (await captureKeys()).length === 0));

  // 7. account switch: A's pending captures stay with A
  mock.mode = "offline";
  await advance(); await clickCaption();
  await until(async () => (await captureKeys()).length === 1);
  const aKey = (await captureKeys())[0];
  mock.mode = "ok";
  const sw2 = await ext({ type: "setSession", uid: "userB", refreshToken: "rt-B" });
  check("switch account: web app can switch the extension's account", sw2.ok === true && sw2.uid === "userB");
  await yt.bringToFront(); await advance(); await clickCaption();
  check("switch account: B's capture goes under users/userB", await until(async () => [...mock.docs.keys()].some((k) => k.includes("/users/userB/captures/"))));
  await sleep(500);
  check("switch account: A's pending capture is retained, not synced under B", (await captureKeys()).includes(aKey) && ![...mock.docs.keys()].some((k) => k.includes("/users/userB/") && k.endsWith(aKey.slice(8))));
  const attn = await ext({ type: "getNeedsAttention" });
  check("switch account: A's line is described by a masked hint", attn.ok && attn.other.length === 1 && attn.other[0].accountHint === "a***@example.com", JSON.stringify(attn));
  const refuse = await ext({ type: "discardCaptures", ids: [aKey.slice(8)] });
  check("explicit removal of another account's line works", refuse.ok && refuse.removed === 1);

  // 8. back to A: A's captures sync under A again
  await ext({ type: "setSession", uid: "userA", refreshToken: "rt-A" });
  // 9. sign out from the web app
  const out = await ext({ type: "clearSession" });
  check("sign-out from the web app clears the extension session", out.ok === true && (await ext({ type: "ping" })).signedInUid === null);
  await yt.bringToFront(); await advance(); await clickCaption();
  check("after sign-out: capture disabled with the sign-in message", await until(async () => /Sign in to SceneLingo/.test(await toastText())));

  // 10. systemic rejection keeps everything
  await ext({ type: "setSession", uid: "userA", refreshToken: "rt-A" });
  mock.mode = "denied";
  await yt.bringToFront();
  for (let i = 0; i < 3; i++) { await advance(); await clickCaption(); await sleep(300); }
  await sleep(1200);
  const kept = await captureKeys();
  const states = Object.entries(await store()).filter(([k]) => k.startsWith("capture:")).map(([, v]) => v.sync.state);
  check("systemic rejection: nothing deleted or quarantined", kept.length >= 3 && states.every((s) => s === "pending"), JSON.stringify(states));
} catch (e) {
  check("test harness error", false, e.stack || String(e));
} finally {
  await ctx.close();
  server.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
