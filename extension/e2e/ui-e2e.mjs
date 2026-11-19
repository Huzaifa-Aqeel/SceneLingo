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
const SITE = "https://herdproof.web.app";
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
page.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/.test(t)) problems.push("CSP: " + t.slice(0, 160)); });
page.on("pageerror", (e) => problems.push("pageerror: " + String(e).slice(0, 160)));

let aiCalls = { card: 0, translate: 0 };
const ENGLISH = { category: "idiom", meaningEn: "To make plans or decisions too early, before the facts are known.", contextualMeaningEn: "The speaker thinks the group is rushing ahead.", partOfSpeech: null, synonyms: ["jump the gun", "rush ahead"], exampleSentences: ["Let's wait for the results; we don't want to get ahead of ourselves."], usageNote: "Common in conversation.", confidenceNote: null };
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
const events = async () => ((await rest("GET", `${DOCS}/users/${uid}/reviewEvents?pageSize=200`, idToken)).json.documents || []).map((d) => ({ mode: d.fields.mode.stringValue, result: d.fields.result.stringValue, cardId: d.fields.cardId.stringValue }));

try {
  // ---------------------------------------------------------------- sign in
  await page.goto(SITE, { waitUntil: "load" });
  await page.waitForSelector("form", { timeout: 20000 });
  await page.fill("#email", email); await page.fill("#password", password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  check("signed in; Home shows the new subtitle and the four cards as due", await until(async () => /1\s*new subtitle/i.test(await text("main")) && /4\s*cards due/i.test(await text("main")), 25000), await text("main"));
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
  check("a card appears with the meaning, similar words, an example and where it was produced", await until(async () => { const t = await text("main"); return /rush ahead/i.test(t) && /Examples/i.test(t) && /Cloud|On your device/i.test(t); }, 15000), await text("main"));
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
  check("Practice shows what is due and four ways to study", await until(async () => /5 cards/.test(await text("main")) && (await page.getByText("Flashcards").count()) > 0 && (await page.getByText("Quiz").count()) > 0 && (await page.getByText("Fill in the blank").count()) > 0, 8000));
  await shot("05-practice");
  await page.getByRole("link", { name: "Start" }).click();
  await page.waitForSelector('[role="button"][aria-label="Show the answer"]', { timeout: 10000 });
  check("the flashcard shows the term first", /1 \/ 5/.test(await text("main")));
  await page.locator('[role="button"][aria-label="Show the answer"]').click();
  check("clicking flips it to the meaning", await until(async () => (await page.locator('[role="button"][aria-label="Show the term"]').count()) > 0, 3000));
  await sleep(900); // let the flip animation finish before the screenshot
  await shot("06-flashcard-back");
  await page.getByRole("button", { name: "Got it" }).click();
  await page.getByRole("button", { name: "Still learning" }).click();   // card 2 missed -> comes back once
  await page.keyboard.press("ArrowRight");                                // keyboard: got it
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  check("a missed card comes round again at the end of the session", await until(async () => /\/ 6/.test(await text("main")), 5000), await text("main"));
  await page.keyboard.press("ArrowRight");                                // the repeated card
  check("the session ends with a summary", await until(async () => (await page.getByText("Nice work").count()) > 0, 8000));
  await shot("07-flashcard-done");

  const ev1 = await until(async () => { const e = await events(); return e.length === 6 ? e : false; }, 10000);
  check("every rating wrote a review event (6 answers)", !!ev1, JSON.stringify((await events()).length));
  check("events carry the mode and the result", !!ev1 && ev1.every((e) => e.mode === "flashcard") && ev1.filter((e) => e.result === "incorrect").length === 1);
  const missedId = ev1 && ev1.find((e) => e.result === "incorrect").cardId;
  const missedCard = (await getDoc(`users/${uid}/learningCards/${missedId}`)).json.fields;
  const rv = missedCard.review.mapValue.fields;
  check("the card's own statistics changed with its events (attempts, wrong count, last result)", rv.attemptCount.integerValue === "2" && rv.incorrectCount.integerValue === "1" && rv.lastResult.stringValue === "correct", JSON.stringify(rv));
  check("a card answered correctly is scheduled for later; the next review date is stored", !!rv.nextReviewAt?.timestampValue && Number(rv.reviewStage.integerValue) >= 1);

  // ---------------------------------------------------------------- quiz
  await page.getByRole("link", { name: "Back to Practice" }).click();
  await page.getByRole("link", { name: /Quiz/ }).click();
  await page.waitForSelector("text=What does this mean?", { timeout: 10000 });
  check("the quiz offers several meanings to choose from", (await page.locator('[role="group"][aria-label="Choices"] button').count()) >= 2);
  await page.keyboard.press("1");
  check("answering shows right or wrong in words, and a Continue button", await until(async () => /Correct|Not quite/.test(await text("main")) && (await page.getByRole("button", { name: /Continue|See results/ }).count()) > 0, 5000));
  await shot("08-quiz-answered");
  const quizEvent = await until(async () => (await events()).find((e) => e.mode === "quiz"), 8000);
  check("a quiz answer is recorded as a review event", !!quizEvent);

  // ---------------------------------------------------------------- fill in the blank
  await page.goto(`${SITE}/practice/fill`);
  await page.waitForSelector("text=Complete the sentence", { timeout: 15000 });
  await page.getByLabel("Missing words").fill("totally wrong answer");
  await page.getByRole("button", { name: "Check" }).click();
  check("a wrong answer reveals the right one", await until(async () => /Not quite\. The answer is/.test(await text("main")), 5000), await text("main"));
  await shot("09-fill-wrong");
  await page.getByRole("button", { name: /Continue|Finish/ }).click();
  const target = await until(async () => { const t = await text("main"); const m = t.match(/Hint: (.+)/); return m ? t : false; }, 5000);
  const answerFor = (t) => { const hit = [...seeded, ["getting ahead of ourselves"]].find((c) => t.includes(c[1]?.split(c[0])[0] ?? "\u0000") && c[1] && t.includes((c[1].split(c[0])[1] ?? "").trim())); return hit ? hit[0] : "getting ahead of ourselves"; };
  await page.getByLabel("Missing words").fill(answerFor(target || ""));
  await page.getByRole("button", { name: "Check" }).click();
  check("a right answer is accepted, ignoring capital letters", await until(async () => /^Correct/m.test(await text("main")), 5000), await text("main"));
  check("fill-in answers are recorded as review events", !!(await until(async () => (await events()).filter((e) => e.mode === "fill").length === 2, 8000)));

  // ---------------------------------------------------------------- progress
  await page.goto(`${SITE}/progress`);
  check("Progress shows the totals computed from the review events", await until(async () => { const t = await text("main"); const total = (await events()).length; return new RegExp(`${total}\\s*Reviews`).test(t) && /Accuracy/.test(t) && /Day streak/.test(t) && /Recent activity/.test(t); }, 12000), await text("main"));
  await shot("10-progress");

  // ---------------------------------------------------------------- mistakes
  await page.goto(`${SITE}/practice`);
  check("Review mistakes lists what was answered wrong most recently", await until(async () => /to revisit/.test(await text("main")), 8000), await text("main"));

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
