// The on-device model journey against a LOCAL build (nothing is deployed), with a stand-in for Chrome's
// on-device model, a throwaway account (deleted at the end), real Firestore, and mocked cloud answers.
//   (cd web && npm run build) && node e2e/device-e2e.mjs      the build in web/dist is served from disk
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createCapture } from "../src/lib/firestore.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim()]; }));
const PROJECT = env.VITE_FIREBASE_PROJECT_ID, KEY = env.VITE_FIREBASE_API_KEY;
const SITE = process.env.SITE || "http://localhost:4173";
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const SHOTS = "/tmp/shots-device"; fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + String(detail).slice(0, 300)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, step = 200) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(step); } return false; };
const rest = async (method, url, token, body) => { const r = await fetch(url, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch { /* */ } return { status: r.status, json: j }; };

const email = `scenelingo-dev-${crypto.randomBytes(5).toString("hex")}@example.com`;
const password = crypto.randomBytes(12).toString("base64url") + "aA1";
const su = await rest("POST", `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, null, { email, password, returnSecureToken: true });
if (su.status !== 200) { console.error("cannot create the throwaway account", su.json); process.exit(2); }
const uid = su.json.localId; const idToken = su.json.idToken;
const S = (v) => ({ stringValue: v });
const cap = { id: crypto.randomUUID(), uid, text: "I think we're getting ahead of ourselves.", sentences: ["I think we're getting ahead of ourselves."], platform: "youtube", videoId: "abc123XYZ_-", videoTitle: "Test video", videoUrl: "https://www.youtube.com/watch?v=abc123XYZ_-&t=12s", playbackTimeSeconds: 12.5, subtitleLanguage: null, capturedAt: Date.now(), schemaVersion: 1 };
await createCapture({ fetchFn: fetch, projectId: PROJECT, idToken, record: cap });
await rest("PATCH", `${DOCS}/users/${uid}/settings/preferences?updateMask.fieldPaths=nativeLanguage`, idToken, { fields: { nativeLanguage: S("es") } });

const base = path.join(os.homedir(), ".cache/ms-playwright");
const dir = fs.readdirSync(base).find((x) => /^chromium-\d+/.test(x));
const exe = path.join(base, dir, fs.readdirSync(path.join(base, dir)).find((x) => x.startsWith("chrome-linux")), "chrome");
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + String(e).slice(0, 160)));

// A stand-in for Chrome's on-device model. State and counters live in sessionStorage so they survive reloads.
await page.addInitScript(() => {
  const get = (k, d) => sessionStorage.getItem(k) ?? d;
  const set = (k, v) => sessionStorage.setItem(k, String(v));
  const CARD = { category: "idiom", meaningEn: "To act too early.", contextualMeaningEn: "The speaker thinks they are rushing.", partOfSpeech: null, synonyms: ["jump the gun", "rush ahead", "move too fast", "be hasty"], exampleSentences: ["Let's wait for the results.", "Don't get ahead of yourself.", "She got ahead of herself."], usageNote: null, confidenceNote: null };
  window.LanguageModel = {
    availability: async () => get("state", "downloadable"),
    create: async (o) => {
      set("creates", Number(get("creates", 0)) + 1);
      if (get("state", "downloadable") === "downloadable") {
        set("state", "downloading");
        if (get("hang", "0") === "1") await new Promise(() => {}); // a download that never reports anything
        const m = new EventTarget(); o?.monitor?.(m);
        for (const p of [0.25, 0.6, 1]) { await new Promise((r) => setTimeout(r, 500)); m.dispatchEvent(Object.assign(new Event("downloadprogress"), { loaded: p })); }
        set("state", "available");
      }
      return {
        destroy() { set("destroyed", Number(get("destroyed", 0)) + 1); },
        prompt: async (contents) => {
          if (get("failPrompt", "0") === "1") throw new DOMException("the model crashed", "OperationError");
          const isTranslation = /Write in /.test(JSON.stringify(contents));
          return JSON.stringify(isTranslation ? { nonsense: true } : CARD); // a translation request gets an unusable answer on purpose
        },
      };
    },
  };
});

// Serve the local build (web/dist) from disk, so no server has to run.
const DIST = path.join(root, "web/dist");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon", ".zip": "application/zip", ".webmanifest": "application/manifest+json" };
if (SITE.startsWith("http://localhost")) {
  await page.route(`${SITE}/**`, (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    let file = path.join(DIST, p);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html"); // single-page app: unknown paths open the app
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || "application/octet-stream", body: fs.readFileSync(file) });
  });
}

const aiCalls = { card: 0, translate: 0 };
const ENGLISH = { category: "idiom", meaningEn: "To make plans too early.", contextualMeaningEn: "The speaker thinks the group is rushing.", partOfSpeech: null, synonyms: ["jump the gun", "rush ahead", "assume too much", "move too fast"], exampleSentences: ["Let's wait for the results.", "Don't get ahead of yourself.", "She got ahead of herself."], usageNote: null, confidenceNote: null };
const TRANSLATION = { translation: "adelantarnos a los hechos", explanation: "Significa actuar antes de tiempo.", literalMeaningNote: null };
await page.route("https://firebasevertexai.googleapis.com/**", async (route) => {
  const body = route.request().postData() || "";
  const translate = /Write in /.test(body);
  aiCalls[translate ? "translate" : "card"]++;
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(translate ? TRANSLATION : ENGLISH) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 } }) });
});

const text = async (sel = "main") => (await page.locator(sel).first().innerText().catch(() => ""));
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });
const stub = (k) => page.evaluate((key) => sessionStorage.getItem(key), k);
const explainOnce = async () => {
  await page.goto(`${SITE}/explore/${cap.id}`);
  await page.waitForSelector("text=Select a word", { timeout: 15000 });
  const a = await page.getByRole("button", { name: "getting", exact: true }).boundingBox();
  const b = await page.getByRole("button", { name: "ourselves", exact: true }).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 }); await page.mouse.up();
  await page.getByRole("button", { name: "Explain" }).click();
  await page.waitForSelector("text=Examples", { timeout: 20000 });
};

try {
  await page.goto(SITE, { waitUntil: "load" });
  await page.waitForSelector("form", { timeout: 20000 });
  await page.fill("#email", email); await page.fill("#password", password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  check("signed in", await until(async () => /Inbox/.test(await text()), 25000), await text());
  check("starting the app and opening pages loads no on-device model", (await stub("creates")) === null);

  // ---- first card: cloud, because the model isn't downloaded; the prompt is offered once
  await explainOnce();
  await shot("01-first-card");
  check("the first card came from the cloud (the model isn't downloaded yet)", /Cloud/.test(await text()) && aiCalls.card === 1, `${aiCalls.card}`);
  check("a quiet prompt asks to download the on-device model, with Download and Not now", (await page.getByText("Make cards faster and private on this device?").count()) === 1 && (await page.getByRole("button", { name: "Download" }).count()) === 1 && (await page.getByRole("button", { name: "Not now" }).count()) === 1);
  check("showing the prompt and the card loaded no model", (await stub("creates")) === null);

  // ---- Not now: it goes away and does not come back
  await page.getByRole("button", { name: "Not now" }).click();
  check("Not now removes the prompt", await until(async () => (await page.getByText("Make cards faster and private").count()) === 0, 3000));
  await explainOnce();
  check("it doesn't come back on the next card", (await page.getByText("Make cards faster and private").count()) === 0 && aiCalls.card === 2);

  // ---- later, from Profile
  await page.getByRole("link", { name: "Profile" }).click();
  await page.waitForSelector("#on-device", { timeout: 10000 });
  check("Profile offers the download for someone who said Not now", /On-device model/.test(await text("#on-device")) && (await page.locator("#on-device").getByRole("button", { name: "Download" }).count()) === 1);
  await shot("02-profile-offer");
  await page.locator("#on-device").getByRole("button", { name: "Download" }).click();
  check("the download starts with a plain 'Starting…', not a fake 0%", /Starting…/.test(await text("#on-device")) && !/0%/.test(await text("#on-device")), await text("#on-device"));
  check("the download shows a real percentage once Chrome reports one", await until(async () => /Downloading… \d+%/.test(await text("#on-device")), 3000), await text("#on-device"));
  await shot("03-profile-downloading");
  check("it finishes and says it is ready", await until(async () => /Ready/.test(await text("#on-device")), 8000), await text("#on-device"));
  check("exactly one download was started, and its session was released", (await stub("creates")) === "1" && (await stub("destroyed")) === "1", `${await stub("creates")} / ${await stub("destroyed")}`);

  // ---- now the card runs on the device
  await explainOnce();
  await shot("04-on-device-card");
  check("the next card runs on the device and no cloud request is made", /On your device/.test(await text()) && aiCalls.card === 2, `${aiCalls.card}`);
  check("the model was loaded only when Explain was pressed (one more session)", (await stub("creates")) === "2", await stub("creates"));

  // ---- the local model crashes while running -> cloud
  await page.evaluate(() => sessionStorage.setItem("failPrompt", "1"));
  await explainOnce();
  check("when the local model fails while running, the card still arrives, from the cloud", /Cloud/.test(await text()) && !/On your device/.test(await text()) && aiCalls.card === 3, `${aiCalls.card}`);
  await page.evaluate(() => sessionStorage.removeItem("failPrompt"));

  // ---- the local model gives an unusable translation -> cloud
  await explainOnce();
  check("a card on the device", /On your device/.test(await text()));
  await page.getByRole("button", { name: /Translate to Spanish/ }).click();
  check("an unusable local translation is replaced by the cloud's, labelled Cloud", await until(async () => (await page.locator('[lang="es"]').filter({ hasText: "adelantarnos" }).count()) > 0 && aiCalls.translate === 1, 10000), `${aiCalls.translate}`);
  await shot("05-translation-fallback");

  // ---- a download Chrome drops: the spinner clears by itself (no reload)
  await page.evaluate(() => { sessionStorage.setItem("state", "downloadable"); sessionStorage.setItem("hang", "1"); localStorage.removeItem("sceneLingo.deviceModel.declined"); });
  await page.goto(`${SITE}/profile`);
  await page.waitForSelector("#on-device");
  await page.locator("#on-device").getByRole("button", { name: "Download" }).click();
  check("a download that reports nothing shows 'Starting…' (and is ours)", await until(async () => /Starting…/.test(await text("#on-device")), 3000), await text("#on-device"));
  await page.evaluate(() => sessionStorage.setItem("state", "downloadable")); // Chrome dropped it (for example, the learner turned the feature off)
  await sleep(8500); // past the short grace period after pressing Download
  await page.evaluate(() => window.dispatchEvent(new Event("focus"))); // coming back to the tab
  check("when Chrome drops it, the spinner clears and Download comes back, without a reload", await until(async () => (await page.locator("#on-device").getByRole("button", { name: "Download" }).count()) === 1 && !/Starting…|Downloading/.test(await text("#on-device")), 5000), await text("#on-device"));
  await shot("06-dropped-download");

  // ---- a download Chrome runs on its own: plain words, no spinner, and it finishes without a reload
  await page.evaluate(() => { sessionStorage.setItem("state", "downloading"); sessionStorage.removeItem("hang"); });
  await page.goto(`${SITE}/profile`);
  await page.waitForSelector("#on-device");
  check("a download Chrome runs by itself says so, with no spinner and no percentage", /Chrome is downloading the model in the background/.test(await text("#on-device")) && (await page.locator("#on-device .animate-spin").count()) === 0 && !/%/.test(await text("#on-device")), await text("#on-device"));
  await shot("07-chromes-own-download");
  await page.evaluate(() => sessionStorage.setItem("state", "available"));
  await page.locator("#on-device").getByRole("button", { name: "Check again" }).click();
  check("Check again notices it is finished", await until(async () => /Ready/.test(await text("#on-device")), 4000), await text("#on-device"));

  // ---- pressing Download under a card: the strip goes away, a short note shows once, and Explore carries no spinner
  await page.evaluate(() => { sessionStorage.setItem("state", "downloadable"); localStorage.removeItem("sceneLingo.deviceModel.declined"); });
  await explainOnce();
  check("the question is offered again for a learner who hasn't answered", (await page.getByText("Make cards faster and private on this device?").count()) === 1);
  await page.getByRole("button", { name: "Download" }).click();
  check("pressing Download replaces the question with one short note", await until(async () => (await page.getByText("Downloading in the background").count()) === 1 && (await page.getByText("Make cards faster and private").count()) === 0, 3000));
  check("Explore shows no spinner for the download", (await page.locator("main .animate-spin").count()) === 0);
  check("the note goes away by itself", await until(async () => (await page.getByText("Downloading in the background").count()) === 0, 9000));

  check("no page errors during the whole journey", problems.length === 0, problems.slice(0, 3).join(" | "));
} catch (e) {
  check("harness error", false, e.stack);
  await shot("zz-failure").catch(() => {});
} finally {
  await browser.close();
  try {
    const t = await fetch(`https://securetoken.googleapis.com/v1/token?key=${KEY}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=refresh_token&refresh_token=${su.json.refreshToken}` }).then((x) => x.json());
    const tok = t.id_token || idToken;
    for (const col of ["learningCards", "reviewEvents", "captures"]) for (const id of ((await rest("GET", `${DOCS}/users/${uid}/${col}?pageSize=200`, tok)).json.documents || []).map((d) => d.name)) await fetch(`https://firestore.googleapis.com/v1/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${tok}` } });
    await fetch(`${DOCS}/users/${uid}/settings/preferences`, { method: "DELETE", headers: { Authorization: `Bearer ${tok}` } });
    await fetch(`${DOCS}/users/${uid}`, { method: "DELETE", headers: { Authorization: `Bearer ${tok}` } });
    const del = await rest("POST", `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${KEY}`, null, { idToken: tok });
    console.log(`cleanup: test data and test account removed (HTTP ${del.status})`);
  } catch (e) { console.log("cleanup problem:", e.message, "| throwaway user:", email); }
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed   (screenshots: ${SHOTS})`);
process.exit(failed ? 1 : 0);
