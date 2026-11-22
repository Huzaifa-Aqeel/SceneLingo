// The spoken conversation ("Talk it out") against a LOCAL build (nothing is deployed): real Firestore and a throwaway
// account (deleted at the end), stand-ins for the browser's speech features, and mocked cloud answers.
//   (cd web && npm run build) && node e2e/talk-e2e.mjs      the build in web/dist is served from disk
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim()]; }));
const PROJECT = env.VITE_FIREBASE_PROJECT_ID, KEY = env.VITE_FIREBASE_API_KEY;
const SITE = process.env.SITE || "http://localhost:4173";
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const SHOTS = "/tmp/shots-talk"; fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + String(detail).slice(0, 300)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, step = 200) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(step); } return false; };
const rest = async (method, url, token, body) => { const r = await fetch(url, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch { /* */ } return { status: r.status, json: j }; };

const email = `scenelingo-talk-${crypto.randomBytes(5).toString("hex")}@example.com`;
const password = crypto.randomBytes(12).toString("base64url") + "aA1";
const su = await rest("POST", `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, null, { email, password, returnSecureToken: true });
if (su.status !== 200) { console.error("cannot create the throwaway account", su.json); process.exit(2); }
const uid = su.json.localId; const idToken = su.json.idToken;
const S = (v) => ({ stringValue: v });
const A = (a) => ({ arrayValue: a.length ? { values: a.map(S) } : {} });
const T = (d) => ({ timestampValue: d.toISOString() });
const seeded = [
  ["break the ice", "Let's break the ice before the meeting.", "idiom", "To start a conversation in a social setting."],
  ["reluctant", "She was reluctant to say anything.", "vocabulary", "Not wanting to do something."],
];
for (const [i, [text, sentence, category, meaning]] of seeded.entries()) {
  const fields = { selectedText: S(text), normalizedText: S(text), normalizedSourceSentence: S(sentence.toLowerCase()), selectionKind: S("phrase"), sourceSentence: S(sentence), category: S(category), meaningEn: S(meaning), contextualMeaningEn: S(meaning), synonyms: A([]), exampleSentences: A([`An example with ${text}.`]), createdAt: T(new Date(Date.now() - i * 1000)), review: { mapValue: { fields: { attemptCount: { integerValue: "0" }, correctCount: { integerValue: "0" }, incorrectCount: { integerValue: "0" }, reviewStage: { integerValue: "0" } } } } };
  const r = await rest("POST", `${DOCS}/users/${uid}/learningCards?documentId=seed${i}`, idToken, { fields });
  if (r.status !== 200) { console.error("seed card failed", r.status, JSON.stringify(r.json).slice(0, 200)); process.exit(2); }
}

const base = path.join(os.homedir(), ".cache/ms-playwright");
const dir = fs.readdirSync(base).find((x) => /^chromium-\d+/.test(x));
const exe = path.join(base, dir, fs.readdirSync(path.join(base, dir)).find((x) => x.startsWith("chrome-linux")), "chrome");
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1180, height: 860 } });
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + String(e).slice(0, 160)));

// ---- the local build, served from disk
const DIST = path.join(root, "web/dist");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon", ".zip": "application/zip" };
await page.route(`${SITE}/**`, (route) => {
  let file = path.join(DIST, decodeURIComponent(new URL(route.request().url()).pathname));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
  route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || "application/octet-stream", body: fs.readFileSync(file) });
});

// ---- stand-ins for the browser's speech features. What the learner "says" is a script kept in sessionStorage.
await page.addInitScript(() => {
  const get = (k, d) => sessionStorage.getItem(k) ?? d;
  const set = (k, v) => sessionStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
  const put = (name, value) => Object.defineProperty(window, name, { value, configurable: true, writable: true });
  if (get("nospeech", "0") === "1") { put("SpeechRecognition", undefined); put("webkitSpeechRecognition", undefined); put("speechSynthesis", undefined); return; }
  class Rec {
    lang = ""; continuous = true; interimResults = false; maxAlternatives = 0; processLocally = false;
    onresult = null; onerror = null; onend = null;
    static available = async () => "unavailable";
    start() {
      setTimeout(() => {
        const script = JSON.parse(get("script", "[]")); const at = Number(get("scriptAt", "0"));
        set("scriptAt", String(at + 1));
        const next = script[at] ?? "silence";
        if (next === "silence") { this.onerror?.({ error: "no-speech" }); this.onend?.(); return; }
        if (next === "denied") { this.onerror?.({ error: "not-allowed" }); this.onend?.(); return; }
        const part = Object.assign([{ transcript: next }], { isFinal: false });
        this.onresult?.({ resultIndex: 0, results: [part] });
        const fin = Object.assign([{ transcript: next }], { isFinal: true });
        this.onresult?.({ resultIndex: 0, results: [fin] });
        this.onend?.();
      }, 60);
    }
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
  }
  // The real ones are read-only properties of window, so they are replaced explicitly.
  put("SpeechRecognition", Rec);
  put("webkitSpeechRecognition", Rec);
  put("SpeechSynthesisUtterance", class { constructor(t) { this.text = t; this.onend = null; this.onerror = null; this.voice = null; this.rate = 1; this.lang = ""; } });
  put("speechSynthesis", {
    getVoices: () => [{ name: "Stand-in", lang: "en-US", localService: true }],
    cancel() {},
    speak(u) { const spoken = JSON.parse(get("spoken", "[]")); spoken.push(u.text); set("spoken", spoken); setTimeout(() => u.onend?.(), 20); },
  });
});

// ---- the cloud, mocked
const SCENE = { settingNumber: 1, situation: "You are at a house party where you only know the host. A stranger is standing next to you.", partnerName: "Dana", partnerRole: "another guest", openingLine: "Hi! I don't think we've met. How do you know the host?" };
const VERDICT = { understoodSituation: "yes", fit: "natural", feedback: "You answered naturally and used the expression well.", betterVersion: "I'll try to break the ice with a joke.", similarExpression: null };
const calls = { scene: 0, reply: 0, judge: 0 };
await page.route("https://firebasevertexai.googleapis.com/**", async (route) => {
  const url = route.request().url();
  const body = route.request().postData() || "";
  const json = (o) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(o) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 } }) });
  if (/speaking coach/.test(body)) { calls.judge++; return json(VERDICT); }
  if (/realistic scenes/.test(body)) { calls.scene++; return json(SCENE); }
  if (url.includes("streamGenerateContent")) {
    calls.reply++;
    const last = /last thing you say/.test(body);
    const parts = last ? ["It was great talking to you. ", "See you around!"] : ["Oh, nice. ", "What do you do for work?"];
    const sse = parts.map((p) => `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: p }] }, finishReason: "STOP" }] })}\n\n`).join("");
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: sse });
  }
  return route.fulfill({ status: 500, body: "unexpected" });
});

const text = async (sel = "main") => (await page.locator(sel).first().innerText().catch(() => ""));
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });
const ss = (k) => page.evaluate((key) => sessionStorage.getItem(key), k);
const setScript = (arr) => page.evaluate((a) => { sessionStorage.setItem("script", JSON.stringify(a)); sessionStorage.setItem("scriptAt", "0"); sessionStorage.setItem("spoken", "[]"); }, arr);
const events = async () => ((await rest("GET", `${DOCS}/users/${uid}/reviewEvents?pageSize=50`, idToken)).json.documents || []).map((d) => ({ mode: d.fields.mode.stringValue, result: d.fields.result.stringValue, rating: d.fields.rating?.stringValue ?? null, cardId: d.fields.cardId.stringValue }));

try {
  await page.goto(SITE, { waitUntil: "load" });
  await page.waitForSelector("form", { timeout: 20000 });
  await page.fill("#email", email); await page.fill("#password", password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  check("signed in", await until(async () => /Inbox/.test(await text()), 25000), await text());

  // ---- the Practice page offers it
  await page.goto(`${SITE}/practice`);
  check("Practice offers Talk it out", await until(async () => (await page.getByRole("link", { name: /Talk it out/ }).count()) === 1, 8000), await text());
  await shot("01-practice");

  // ---- a full conversation: three turns, the second uses the expression
  await page.goto(`${SITE}/practice/talk?card=seed0`);
  await setScript(["Hi, I'm a friend of the host.", "I wanted to break the ice, so I came over to say hello.", "Software. And you?"]);
  check("the scene is set up and shown, with a Start button", await until(async () => /house party/.test(await text()) && (await page.getByRole("button", { name: /Start talking/ }).count()) === 1, 15000), await text());
  check("the scene was asked for once, and its situation is not the card's own sentence", calls.scene === 1 && !/Let's break the ice before the meeting/.test(await text()));
  await shot("02-scene");
  await page.getByRole("button", { name: /Start talking/ }).click();
  check("the partner speaks first", await until(async () => JSON.parse((await ss("spoken")) || "[]").includes(SCENE.openingLine), 5000), await ss("spoken"));
  check("the screen shows a clear state while it runs", await until(async () => /Listening|Thinking|is speaking/.test(await text()), 5000), await text());
  await shot("03-live");
  check("the conversation ends by itself after three turns and shows the result", await until(async () => /You used it/.test(await text()), 20000), await text());
  const spoken = JSON.parse((await ss("spoken")) || "[]");
  check("the partner answered each time, in sentences, and closed the conversation", calls.reply === 3 && spoken.includes("Oh, nice.") && spoken.includes("What do you do for work?") && spoken.includes("See you around!"), JSON.stringify(spoken));
  check("the learner's own words are shown, with the expression marked", (await page.locator("mark").filter({ hasText: /break the ice/i }).count()) === 1);
  check("the coach's note and a better version are shown", /used the expression well/.test(await text()) && /You could say/.test(await text()));
  await shot("04-result");

  const ev = await until(async () => { const e = (await events()).filter((x) => x.mode === "conversation"); return e.length === 1 ? e : false; }, 8000);
  check("one review event was recorded, as good", !!ev && ev[0].result === "correct" && ev[0].rating === "good", JSON.stringify(ev));
  const f = (await rest("GET", `${DOCS}/users/${uid}/learningCards/seed0`, idToken)).json.fields.review.mapValue.fields;
  check("it counts as practice but does not move the card's review date", f.attemptCount.integerValue === "1" && !f.nextReviewAt && f.reviewStage.integerValue === "0", JSON.stringify(f));

  // ---- a conversation where the expression is not used
  await page.getByRole("button", { name: "Another scene" }).click();
  await setScript(["Hello.", "I work in an office.", "Thanks, bye."]);
  await page.getByRole("button", { name: /Start talking/ }).click();
  check("when the expression is never used, the result says so, and it is a miss", await until(async () => /Not this time/.test(await text()), 20000), await text());
  check("a missed conversation is recorded as again", await until(async () => (await events()).filter((x) => x.mode === "conversation" && x.rating === "again").length === 1, 8000));

  // ---- nobody speaks
  await page.goto(`${SITE}/practice/talk?card=seed1`);
  await setScript(["silence", "silence"]);
  await page.getByRole("button", { name: /Start talking/ }).click({ timeout: 15000 });
  check("if the learner stays quiet, the partner nudges once, and nothing is recorded", await until(async () => /We didn't hear anything/.test(await text()) && JSON.parse((await ss("spoken")) || "[]").includes("Sorry, I didn't catch that."), 15000), await text());
  check("a conversation with no speech writes nothing", (await events()).filter((x) => x.mode === "conversation").length === 2);

  // ---- the microphone is blocked
  await setScript(["denied"]);
  await page.getByRole("button", { name: /Start talking/ }).click();
  check("a blocked microphone is explained", await until(async () => /needs your microphone/.test(await text()), 8000), await text());

  // ---- a browser without speech
  await page.evaluate(() => sessionStorage.setItem("nospeech", "1"));
  await page.goto(`${SITE}/practice`);
  check("without speech support the tile says so and is not a link", await until(async () => /Needs Chrome or Edge with a microphone/.test(await text()) && (await page.getByRole("link", { name: /Talk it out/ }).count()) === 0, 8000), await text());
  await page.goto(`${SITE}/practice/talk`);
  check("opening the page directly says to use another browser", await until(async () => /Talking needs a different browser/.test(await text()), 8000), await text());

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
    await fetch(`${DOCS}/users/${uid}`, { method: "DELETE", headers: { Authorization: `Bearer ${tok}` } });
    const del = await rest("POST", `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${KEY}`, null, { idToken: tok });
    console.log(`cleanup: test data and test account removed (HTTP ${del.status})`);
  } catch (e) { console.log("cleanup problem:", e.message, "| throwaway user:", email); }
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed   (screenshots: ${SHOTS})`);
process.exit(failed ? 1 : 0);
