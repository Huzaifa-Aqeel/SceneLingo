// Full learner journey on the DEPLOYED site with a throwaway account (deleted at the end).
// Real: Firestore, security rules, the deployed app. Mocked: the AI model responses (App Check blocks headless browsers).
//   node e2e/ui-e2e.mjs
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
const SITE = process.env.SITE || "https://herdproof.web.app"; // a local address runs the build in web/dist from disk (nothing is deployed)
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const SHOTS = "/tmp/shots"; fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + String(detail).slice(0, 300)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, step = 200) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(step); } return false; };
const rest = async (method, url, token, body) => { const r = await fetch(url, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch { /* */ } return { status: r.status, json: j }; };

const email = `scenelingo-ui-${crypto.randomBytes(5).toString("hex")}@example.com`;
const password = crypto.randomBytes(12).toString("base64url") + "aA1";
const su = await rest("POST", `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, null, { email, password, returnSecureToken: true });
if (su.status !== 200) { console.error("cannot create the throwaway account", su.json); process.exit(2); }
const uid = su.json.localId; const idToken = su.json.idToken;
const S = (v) => ({ stringValue: v });
const A = (a) => ({ arrayValue: a.length ? { values: a.map(S) } : {} });
const T = (d) => ({ timestampValue: d.toISOString() });

// ---- seed: one capture exactly as the extension writes it, a language preference, and four existing cards
const cap = { id: crypto.randomUUID(), uid, text: "I think we're getting ahead of ourselves.", sentences: ["I think we're getting ahead of ourselves."], platform: "youtube", videoId: "abc123XYZ_-", videoTitle: "Test video", videoUrl: "https://www.youtube.com/watch?v=abc123XYZ_-&t=12s", playbackTimeSeconds: 12.5, subtitleLanguage: null, capturedAt: Date.now(), schemaVersion: 1 };
console.log("seed capture:", await createCapture({ fetchFn: fetch, projectId: PROJECT, idToken, record: cap }));
await rest("PATCH", `${DOCS}/users/${uid}/settings/preferences?updateMask.fieldPaths=nativeLanguage`, idToken, { fields: { nativeLanguage: S("es") } });
const seeded = [
  ["break the ice", "Let's break the ice before the meeting.", "idiom", "To start a conversation in a social setting."],
  ["reluctant", "She was reluctant to say anything.", "vocabulary", "Not wanting to do something."],
  ["no cap", "That was the best pizza ever, no cap.", "slang", "Used to say you are being honest."],
  ["cold feet", "He got cold feet before the wedding.", "idiom", "Sudden nervousness about a plan."],
];
const mkCard = ([text, sentence, category, meaning], i) => ({ id: `seed${i}`, doc: { selectedText: S(text), normalizedText: S(text), normalizedSourceSentence: S(sentence.toLowerCase()), selectionKind: S("phrase"), sourceSentence: S(sentence), category: S(category), meaningEn: S(meaning), contextualMeaningEn: S(`In this scene: ${meaning.toLowerCase()}`), synonyms: A([]), exampleSentences: A([`An example with ${text}.`]), createdAt: T(new Date(Date.now() - i * 1000)), review: { mapValue: { fields: { attemptCount: { integerValue: "0" }, correctCount: { integerValue: "0" }, incorrectCount: { integerValue: "0" }, reviewStage: { integerValue: "0" } } } } } });
for (const c of seeded.map(mkCard)) {
  const r = await rest("POST", `${DOCS}/users/${uid}/learningCards?documentId=${c.id}`, idToken, { fields: c.doc });
  if (r.status !== 200) { console.error("seed card failed", r.status, JSON.stringify(r.json).slice(0, 200)); process.exit(2); }
}

// ---- browser
const base = path.join(os.homedir(), ".cache/ms-playwright");
const dir = fs.readdirSync(base).find((x) => /^chromium-\d+/.test(x));
const exe = path.join(base, dir, fs.readdirSync(path.join(base, dir)).find((x) => x.startsWith("chrome-linux")), "chrome");
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
const problems = [];
if (SITE.startsWith("http://localhost")) {
  const DIST = path.join(root, "web/dist");
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon", ".zip": "application/zip" };
  await page.route(`${SITE}/**`, (route) => {
    let file = path.join(DIST, decodeURIComponent(new URL(route.request().url()).pathname));
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || "application/octet-stream", body: fs.readFileSync(file) });
  });
}
page.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/.test(t)) problems.push("CSP: " + t.slice(0, 160)); });
page.on("pageerror", (e) => problems.push("pageerror: " + String(e).slice(0, 160)));

let aiCalls = { card: 0, translate: 0 };
const ENGLISH = { category: "idiom", meaningEn: "To make plans or decisions too early, before the facts are known.", contextualMeaningEn: "The speaker thinks the group is rushing ahead.", partOfSpeech: null, synonyms: ["jump the gun", "rush ahead", "assume too much", "move too fast"], exampleSentences: ["Let's wait for the results; we don't want to get ahead of ourselves.", "She was getting ahead of herself, planning the party before she was invited.", "Don't get ahead of yourself; we haven't won yet."], usageNote: "Common in conversation.", confidenceNote: null };
const TRANSLATION = { translation: "adelantarnos a los hechos", explanation: "Significa actuar o decidir antes de tiempo.", literalMeaningNote: null };
await page.route("https://firebasevertexai.googleapis.com/**", async (route) => {
  const body = route.request().postData() || "";
  const translate = /Write in /.test(body);
  aiCalls[translate ? "translate" : "card"]++;
  await sleep(translate ? 150 : 400);
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(translate ? TRANSLATION : ENGLISH) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 } }) });
});
// App Check and reCAPTCHA are left alone: blocking them makes Firebase Auth report "no internet".

const text = async (sel) => (await page.locator(sel).first().innerText().catch(() => ""));
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });
const getDoc = async (p) => (await rest("GET", `${DOCS}/${p}`, idToken));
const listIds = async (col) => ((await rest("GET", `${DOCS}/users/${uid}/${col}?pageSize=100`, idToken)).json.documents || []).map((d) => d.name.split("/").pop());
const events = async () => ((await rest("GET", `${DOCS}/users/${uid}/reviewEvents?pageSize=200`, idToken)).json.documents || []).map((d) => ({ mode: d.fields.mode.stringValue, result: d.fields.result.stringValue, cardId: d.fields.cardId.stringValue, rating: d.fields.rating?.stringValue ?? null }));

try {
  // ---------------------------------------------------------------- sign in
  await page.goto(SITE, { waitUntil: "load" });
  await page.waitForSelector("form", { timeout: 20000 });
  await page.fill("#email", email); await page.fill("#password", password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  check("signed in; the app opens on the Inbox with the new subtitle", await until(async () => /Inbox/.test(await text("main")) && /getting ahead of ourselves/i.test(await text("main")) && new URL(page.url()).pathname === "/inbox", 25000), await text("main") + page.url());
  await shot("01-home");

  // ---------------------------------------------------------------- inbox -> explore
  await page.getByRole("link", { name: /Inbox/ }).click();
  check("Inbox lists the subtitle with an Explore button", await until(async () => (await page.getByText("I think we're getting ahead of ourselves.").count()) > 0 && (await page.getByRole("link", { name: "Explore" }).count()) > 0));
  await page.getByRole("link", { name: "Explore" }).click();
  await page.waitForSelector("text=Select a word", { timeout: 10000 });

  // drag across a phrase with the mouse
  const a = await page.getByRole("button", { name: "getting", exact: true }).boundingBox();
  const b = await page.getByRole("button", { name: "ourselves", exact: true }).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 }); await page.mouse.up();
  check("dragging selects exactly the phrase, and the click after the drag does not undo it", await until(async () => (await page.getByText("“getting ahead of ourselves”").count()) > 0), await text("main"));
  check("the bar says it is a phrase", /phrase/i.test(await text("main")));
  await shot("02-explore-selected");

  // ---------------------------------------------------------------- explain
  await page.getByRole("button", { name: "Explain" }).click();
  check("a card appears with the meaning, similar words, an example and where it was produced", await until(async () => { const t = await text("main"); return /rush ahead/i.test(t) && /move too fast/i.test(t) && /Don't get ahead of yourself/i.test(t) && /Examples/i.test(t) && /Cloud|On your device/i.test(t); }, 15000), await text("main"));
  check("exactly one AI request was made for the card", aiCalls.card === 1, aiCalls.card);
  await shot("03-explore-card");

  check("the type is shown as a plain label, not a control", (await page.getByRole("combobox", { name: "Type" }).count()) === 0 && /Idiom/.test(await text("main")));

  // ---------------------------------------------------------------- translate (Spanish, from the profile)
  await page.getByRole("button", { name: /Translate to Spanish/ }).click();
  check("the translation appears in Spanish with a language tag", await until(async () => (await page.locator('[lang="es"]').filter({ hasText: "adelantarnos" }).count()) > 0, 10000));

  // ---------------------------------------------------------------- save
  await page.getByRole("button", { name: "Save to collection" }).click();
  check("saving confirms with a link to the card", await until(async () => (await page.getByText("Saved", { exact: true }).count()) > 0 && (await page.getByRole("button", { name: "View card" }).count()) > 0, 10000));
  const ids = await listIds("learningCards");
  const newId = ids.find((i) => !i.startsWith("seed"));
  const stored = newId && (await getDoc(`users/${uid}/learningCards/${newId}`)).json.fields;
  check("the card is stored once, with the type the AI chose and its Spanish translation", !!stored && stored.category.stringValue === "idiom" && !!stored.translations?.mapValue?.fields?.es, JSON.stringify(stored?.category));
  check("the card remembers where its English came from", stored?.ai?.mapValue?.fields?.englishInferenceSource?.stringValue === "IN_CLOUD");
  const capDoc = (await getDoc(`users/${uid}/captures/${cap.id}`)).json.fields;
  check("the subtitle is marked explored and linked to the card", capDoc.status.stringValue === "processed" && JSON.stringify(capDoc.savedCardIds).includes(newId));

  // ---------------------------------------------------------------- saving the same thing again
  await page.getByRole("button", { name: "Pick another" }).click();
  await sleep(500); // the card collapses and the page re-lays out; measure only after it settles
  await page.getByRole("button", { name: "getting", exact: true }).scrollIntoViewIfNeeded();
  const a2 = await page.getByRole("button", { name: "getting", exact: true }).boundingBox();
  const b2 = await page.getByRole("button", { name: "ourselves", exact: true }).boundingBox();
  await page.mouse.move(a2.x + a2.width / 2, a2.y + a2.height / 2); await page.mouse.down(); await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2, { steps: 12 }); await page.mouse.up();
  check("the same phrase is selected again", await until(async () => (await page.getByText("“getting ahead of ourselves”").count()) > 0, 5000));
  await page.getByRole("button", { name: "Explain" }).click();
  await page.getByRole("button", { name: "Save to collection" }).click();
  check("saving the same words from the same sentence does not create a second card", await until(async () => (await page.getByText("Already in your collection").count()) > 0, 10000));
  check("still exactly five cards in Firestore", (await listIds("learningCards")).length === 5);

  // ---------------------------------------------------------------- collection
  await page.getByRole("link", { name: /Collection/ }).click();
  check("the collection shows all five cards", await until(async () => /5 cards/.test(await text("main")), 10000));
  await page.getByRole("button", { name: /^Idioms/ }).click();
  check("filtering by type narrows the list (three idioms)", (await page.locator("main ul > li").count()) === 3, await page.locator("main ul > li").count());
  await page.getByRole("button", { name: /^All/ }).click();
  await page.getByLabel("Search your cards").fill("pizza");
  check("search finds a card by its sentence", (await page.locator("main ul > li").count()) === 1);
  await page.getByLabel("Search your cards").fill("");
  await shot("04-collection");
  await page.getByRole("link", { name: /getting ahead of ourselves/ }).click();
  await sleep(500); await shot("04b-card-page");
  check("the card page shows the meaning, the sentence, and the Spanish translation", await until(async () => { const t = await text("main"); return /From the subtitle/i.test(t) && /adelantarnos/i.test(t) && /Not practised yet/i.test(t); }, 8000));
  await page.getByRole("button", { name: "Delete" }).click();
  check("deleting asks first", await page.getByText("Delete this card?").count() > 0);
  await page.getByRole("button", { name: "Keep it" }).click();
  check("keeping it leaves the card in place", (await listIds("learningCards")).length === 5);

  // ---------------------------------------------------------------- practice: flashcards
  await page.getByRole("link", { name: /Practice/ }).click();
  check("Practice shows what is due and four ways to study", await until(async () => /5 cards/.test(await text("main")) && (await page.getByText("Flashcards", { exact: true }).count()) > 0 && (await page.getByText("Reverse flashcards").count()) > 0 && (await page.getByText("Quiz", { exact: true }).count()) > 0 && (await page.getByText("Review mistakes").count()) > 0 && (await page.getByText("Fill in the blank").count()) === 0, 8000));
  await shot("05-practice");
  const pill = (name) => page.getByRole("button", { name: new RegExp(`^${name}\\s*\\d`) });
  check("a row of type buttons shows how many cards are due in each", await until(async () => (await page.getByRole("group", { name: "Practise by type" }).count()) === 1 && /All\s*5/.test(await text("main")) && /Idioms\s*3/.test(await text("main")) && /Vocabulary\s*1/.test(await text("main")) && /Slang\s*1/.test(await text("main")) && (await page.getByRole("button", { name: /^Expressions/ }).count()) === 0, 5000), await text("main"));
  await pill("Idioms").click();
  check("choosing Idioms narrows the due banner and says so", await until(async () => /Due now · Idioms/.test(await text("main")) && /3 cards/.test(await text("main")) && /cat=idiom/.test(page.url()), 3000), await text("main") + page.url());
  await pill("All").click();
  check("All brings everything back", await until(async () => /Due now/.test(await text("main")) && /5 cards/.test(await text("main")) && !/cat=/.test(page.url()), 3000));
  await page.getByRole("link", { name: "Start" }).click();
  await page.waitForSelector('[role="button"][aria-label="Show the answer"]', { timeout: 10000 });
  check("the flashcard asks a question, shows the term, and offers a Reveal button", /1 \/ 5/.test(await text("main")) && /What does this mean\?/.test(await text("main")) && (await page.getByRole("button", { name: "Reveal answer" }).count()) === 1 && (await page.getByRole("button", { name: "Got it" }).count()) === 0);
  await page.getByRole("button", { name: "Reveal answer" }).click();
  check("revealing flips it to the answer and shows two buttons with their next gaps", await until(async () => (await page.locator('[role="button"][aria-label="Show the term"]').count()) > 0 && (await page.getByRole("button", { name: /^Still learning\s*Tomorrow/ }).count()) === 1 && (await page.getByRole("button", { name: /^Got it\s*3 days/ }).count()) === 1 && (await page.getByRole("button", { name: /^(Again|Difficult|Easy)/ }).count()) === 0, 3000), await text("main"));
  check("the back shows the type, examples and the scene it came from", await until(async () => { const t = await text("main"); return /Examples/i.test(t) && /From the scene/i.test(t) && /(Idiom|Vocabulary|Slang|Expression)/i.test(t); }, 3000));
  await sleep(900); // let the flip animation finish before the screenshot
  await shot("06-flashcard-back");
  await page.getByRole("button", { name: /^Got it/ }).click();                 // card 1: Got it
  await page.keyboard.press("Space");                                          // reveal with the keyboard
  await page.keyboard.press("1");                                              // card 2: Still learning
  await page.getByRole("button", { name: "Reveal answer" }).click(); await page.keyboard.press("2");   // card 3: Got it
  await page.getByRole("button", { name: "Reveal answer" }).click(); await page.keyboard.press("ArrowRight"); // card 4: Got it
  await page.getByRole("button", { name: "Reveal answer" }).click(); await page.keyboard.press("2");   // card 5: Got it
  check("the session ends after five cards: a missed card is not shown again today", await until(async () => (await page.getByText("Nice work").count()) > 0 && (await page.getByRole("button", { name: /Practise/ }).count()) === 0, 8000));
  await shot("07-flashcard-done");

  const ev1 = await until(async () => { const e = await events(); return e.length === 5 ? e : false; }, 10000);
  check("every answer wrote a review event (5 answers)", !!ev1, JSON.stringify((await events()).length));
  check("events carry the mode, the result and the rating", !!ev1 && ev1.every((e) => e.mode === "flashcard") && ev1.filter((e) => e.result === "incorrect").length === 1 && ev1.every((e) => e.rating === "again" || e.rating === "good") && ev1.some((e) => e.rating === "again"), JSON.stringify(ev1?.map((e) => e.rating)));
  const missedId = ev1 && ev1.find((e) => e.result === "incorrect").cardId;
  const fieldsOf = async (id) => (await getDoc(`users/${uid}/learningCards/${id}`)).json.fields.review.mapValue.fields;
  const hrs = (f) => (new Date(f.nextReviewAt.timestampValue).getTime() - Date.now()) / 3_600_000;
  const rv = await fieldsOf(missedId);
  check("a missed card is due tomorrow, not today, and is marked as a mistake", rv.attemptCount.integerValue === "1" && rv.incorrectCount.integerValue === "1" && rv.lastResult.stringValue === "incorrect" && Number(rv.reviewStage.integerValue) === 0 && hrs(rv) > 20 && hrs(rv) < 28, JSON.stringify(rv));
  const gotId = ev1.find((e) => e.rating === "good").cardId;
  const got = await fieldsOf(gotId);
  check("a card marked Got it moves up a step and is due in about 3 days", Number(got.reviewStage.integerValue) === 1 && hrs(got) > 66 && hrs(got) < 78, JSON.stringify(got));

  // ---------------------------------------------------------------- nothing is due now: every mode hides the cards
  await page.getByRole("link", { name: "Back to Practice" }).click();
  check("Practice says nothing is due", await until(async () => /Nothing due/.test(await text("main")) && (await page.getByRole("link", { name: "Study anyway" }).count()) > 0, 8000), await text("main"));
  await page.getByRole("link", { name: /^Flashcards/ }).click();
  check("Flashcards hides cards that are not due, and offers Study anyway", await until(async () => /Nothing due/.test(await text("main")) && (await page.getByRole("link", { name: "Study anyway" }).count()) > 0, 5000), await text("main"));
  await page.goto(`${SITE}/practice/quiz`);
  check("the Quiz hides cards that are not due too", await until(async () => /Nothing due/.test(await text("main")) && (await page.getByRole("link", { name: "Study anyway" }).count()) > 0, 8000), await text("main"));

  // ---------------------------------------------------------------- quiz (Study anyway)
  await page.getByRole("link", { name: "Study anyway" }).click();
  await page.waitForSelector('[role="group"][aria-label="Choices"]', { timeout: 10000 });
  check("the quiz offers several choices", (await page.locator('[role="group"][aria-label="Choices"] button').count()) >= 3);
  const seenPrompts = new Set();
  for (let n = 0; n < 5; n++) {
    await page.waitForSelector('[role="group"][aria-label="Choices"]', { timeout: 5000 });
    const t = await text("main");
    for (const p of ["What does this mean?", "Which expression completes the sentence?", "What does the highlighted part mean here?"]) if (t.includes(p)) seenPrompts.add(p);
    if (n === 0) await shot("08-quiz-question");
    await page.keyboard.press("1");
    check(`quiz answer ${n + 1} shows right or wrong in words, with an explanation`, await until(async () => /Correct|Not quite/.test(await text("main")) && /means|:/.test(await text("main")) && (await page.getByRole("button", { name: /Continue|See results/ }).count()) > 0, 5000));
    if (n === 0) await shot("08-quiz-answered");
    await page.getByRole("button", { name: /Continue|See results/ }).click();
  }
  check("the quiz mixed all three question formats", seenPrompts.size === 3, [...seenPrompts].join(" | "));
  check("the quiz ends with a score", await until(async () => /\/ 5/.test(await text("main")) && (await page.getByRole("button", { name: "Try again" }).count()) > 0, 5000));
  check("five quiz answers were recorded", !!(await until(async () => (await events()).filter((e) => e.mode === "quiz").length === 5, 8000)));
  const gotAfter = await fieldsOf(gotId);
  check("Study anyway is practice only: it did not move the card on the ladder", gotAfter.reviewStage.integerValue === got.reviewStage.integerValue && gotAfter.nextReviewAt.timestampValue === got.nextReviewAt.timestampValue, JSON.stringify(gotAfter));

  // ---------------------------------------------------------------- reverse flashcards (Study anyway)
  await page.goto(`${SITE}/practice/flashcards?dir=reverse`);
  await page.getByRole("link", { name: "Study anyway" }).click();
  await page.waitForSelector("text=Which word or expression means this?", { timeout: 15000 });
  check("reverse flashcards show the meaning first, with no term on the front", /1 \/ 5/.test(await text("main")) && (await page.getByRole("button", { name: "Reveal answer" }).count()) === 1);
  await page.getByRole("button", { name: "Reveal answer" }).click();
  check("reverse flashcards offer the same two buttons", await until(async () => (await page.getByRole("button", { name: "Still learning" }).count()) === 1 && (await page.getByRole("button", { name: "Got it" }).count()) === 1, 3000));
  await shot("09-reverse-back");
  await page.keyboard.press("2");
  await page.getByRole("button", { name: "Reveal answer" }).click();
  await page.getByRole("button", { name: "Still learning" }).click();
  check("reverse answers are recorded as review events", !!(await until(async () => (await events()).filter((e) => e.mode === "reverse").length === 2, 8000)));

  // ---------------------------------------------------------------- practising one type
  await page.goto(`${SITE}/practice?cat=slang`);
  check("a type with nothing due says so, and the choice survives in the address", await until(async () => /All caught up · Slang/.test(await text("main")) && /Nothing due/.test(await text("main")) && (await page.getByRole("button", { name: /^Slang/ }).getAttribute("aria-pressed")) === "true", 8000), await text("main"));
  await page.getByRole("link", { name: "Study anyway" }).click();
  await page.waitForSelector('[role="button"][aria-label="Show the answer"]', { timeout: 10000 });
  check("Study anyway inside a type shows only that type", /Study anyway · Slang · 1 \/ 1/.test(await text("main")), await text("main"));
  await page.getByRole("link", { name: "Close" }).click();
  check("closing returns to the same type", /cat=slang/.test(page.url()));
  await page.goto(`${SITE}/practice/flashcards?cat=slang`);
  check("flashcards for a type with nothing due say which type", await until(async () => /Nothing due in Slang/.test(await text("main")), 8000), await text("main"));
  await page.goto(`${SITE}/practice/quiz?set=all&cat=idiom`);
  await page.waitForSelector('[role="group"][aria-label="Choices"]', { timeout: 10000 });
  check("a quiz for one type asks only about that type's cards (three idioms)", /Study anyway · Idioms · 1 \/ 3/.test(await text("main")), await text("main"));

  // ---------------------------------------------------------------- progress
  await page.goto(`${SITE}/progress`);
  check("Progress shows the totals computed from the review events", await until(async () => { const t = await text("main"); const total = (await events()).length; return new RegExp(`${total}\\s*Reviews`).test(t) && /Accuracy/.test(t) && /Day streak/.test(t) && /Last 14 days/.test(t) && !/Recent activity|Needs work/.test(t); }, 12000), await text("main"));
  await shot("10-progress");

  // ---------------------------------------------------------------- mistakes
  await page.goto(`${SITE}/practice`);
  check("Review mistakes lists what was answered wrong most recently", await until(async () => /to revisit, most missed first/.test(await text("main")), 8000), await text("main"));

  // ---------------------------------------------------------------- phone layout
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(`${SITE}/collection`);
  await page.waitForSelector("main ul > li", { timeout: 10000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("on a phone the page does not scroll sideways and the bottom navigation is shown", !overflow && (await page.locator("nav[aria-label='Main']").boundingBox()).y > 600);
  await shot("11-phone-collection");

  check("no security-policy violations or page errors during the whole journey", problems.length === 0, problems.slice(0, 3).join(" | "));
} catch (e) {
  check("harness error", false, e.stack);
  await shot("zz-failure").catch(() => {});
} finally {
  await browser.close();
  try {
    const t = await fetch(`https://securetoken.googleapis.com/v1/token?key=${KEY}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=refresh_token&refresh_token=${su.json.refreshToken}` }).then((x) => x.json());
    const tok = t.id_token || idToken;
    for (const col of ["learningCards", "reviewEvents", "captures"]) for (const id of await (async () => ((await rest("GET", `${DOCS}/users/${uid}/${col}?pageSize=200`, tok)).json.documents || []).map((d) => d.name))()) await fetch(`https://firestore.googleapis.com/v1/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${tok}` } });
    await fetch(`${DOCS}/users/${uid}/settings/preferences`, { method: "DELETE", headers: { Authorization: `Bearer ${tok}` } });
    await fetch(`${DOCS}/users/${uid}`, { method: "DELETE", headers: { Authorization: `Bearer ${tok}` } });
    const del = await rest("POST", `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${KEY}`, null, { idToken: tok });
    console.log(`cleanup: test data and test account removed (HTTP ${del.status})`);
  } catch (e) { console.log("cleanup problem:", e.message, "| throwaway user:", email); }
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed   (screenshots: ${SHOTS})`);
process.exit(failed ? 1 : 0);
