// A YouTube tab that has NO content script (like one opened before the extension was installed).
// Before the fix a click did nothing and said nothing. This runs the extension's attach call and checks the click works.
//   (cd extension && SCENELINGO_MOCK_BASE=http://127.0.0.1:8787 SCENELINGO_TEST_NO_CONTENT_SCRIPT=1 npm run build:dev) && node e2e/attach-e2e.mjs
import http from "node:http"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
const here = path.dirname(fileURLToPath(import.meta.url)); const dist = path.resolve(here, "../dist");
const EXT_ID = fs.readFileSync(path.resolve(here, "../key/extension-id.txt"), "utf8").trim();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const docs = new Map();
const server = http.createServer((req, res) => { let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
  const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,content-type", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") { res.writeHead(204, h); return res.end(); }
  const send = (c, o) => { res.writeHead(c, h); res.end(JSON.stringify(o)); };
  if (req.url.startsWith("/v1/token")) return send(200, { id_token: `${b64({ alg: "none" })}.${b64({ email: "a@example.com", user_id: "userA" })}.sig`, refresh_token: "rt-A", user_id: "userA", expires_in: "3600" });
  if (req.url.includes(":commit")) { const w = JSON.parse(body).writes[0]; docs.set(w.update.name, 1); return send(200, {}); }
  send(404, {});
}); });
await new Promise((r) => server.listen(8787, "127.0.0.1", r));
const results = []; const check = (n, ok, d = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "  -> " + d}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await sleep(150); } return false; };
const base = path.join(os.homedir(), ".cache/ms-playwright"); const dir = fs.readdirSync(base).find((x) => /^chromium-\d+/.test(x));
const exe = path.join(base, dir, fs.readdirSync(path.join(base, dir)).find((x) => x.startsWith("chrome-linux")), "chrome");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sl-attach-"));
const ctx = await chromium.launchPersistentContext(profile, { executablePath: exe, headless: false, args: ["--headless=new", `--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--no-sandbox"] });
await ctx.route("https://www.youtube.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><title>Attach test - YouTube</title><video id="v" width="400" height="200" muted></video><div class="ytp-caption-window-container" style="position:absolute;left:60px;top:260px"><div class="caption-visual-line"><span class="ytp-caption-segment" id="cap">We're getting ahead of ourselves.</span></div></div>` }));
await ctx.route("http://localhost:5173/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>web</title>" }));
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 15000 }));
try {
  const web = await ctx.newPage(); await web.goto("http://localhost:5173/");
  await web.evaluate(([id]) => new Promise((res) => chrome.runtime.sendMessage(id, { type: "setSession", uid: "userA", refreshToken: "rt-A" }, res)), [EXT_ID]);
  const yt = await ctx.newPage(); await yt.goto("https://www.youtube.com/watch?v=attachTest01");
  const click = async () => { const b = await yt.locator("#cap").boundingBox(); await yt.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
  const toasts = async () => (await yt.locator('[role="status"]').allInnerTexts()).join(" | ");
  const nextVideo = (n) => yt.evaluate((x) => history.replaceState(null, "", "/watch?v=attachTest" + x), String(n).padStart(2, "0"));

  await click(); await sleep(1500);
  check("BEFORE: a tab with no script ignores the click, silently (this is the bug you hit)", (await toasts()) === "" && docs.size === 0, await toasts());

  // exactly what the extension runs when it is installed or reloaded
  const attached = await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: ["https://www.youtube.com/*", "https://www.netflix.com/*"] });
    const r = await Promise.allSettled(tabs.map((t) => chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["content.js"] })));
    return { tabs: tabs.length, ok: r.filter((x) => x.status === "fulfilled").length };
  });
  check("the extension may attach to the open YouTube tab (permissions are enough)", attached.tabs === 1 && attached.ok === 1, JSON.stringify(attached));

  await nextVideo(2); await click();
  check("AFTER: the same open tab now captures, with no refresh", await until(async () => /Subtitle captured/.test(await toasts())) && (await until(async () => docs.size === 1)), `toast=${await toasts()} docs=${docs.size}`);

  // attaching again (e.g. a second reload) must not create a second copy
  await sw.evaluate(async () => { const tabs = await chrome.tabs.query({ url: ["https://www.youtube.com/*"] }); await Promise.all(tabs.map((t) => chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["content.js"] }))); });
  await sleep(500); const before = docs.size; await nextVideo(3); await click(); await sleep(2500);
  check("attaching a second time still gives exactly one capture per click", docs.size === before + 1, `docs ${before} -> ${docs.size}`);
  check("the learner never sees a stale 'refresh this page' message", !/Refresh this page|updated/i.test(await toasts()), await toasts());
} catch (e) { check("harness error", false, e.stack); }
finally { await ctx.close(); server.close(); fs.rmSync(profile, { recursive: true, force: true }); }
const failed = results.filter((x) => !x).length; console.log(`\n${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
