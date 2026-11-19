// SceneLingo service worker.
// Sole owner of: the session, the capture queue, and synchronization.
// Nothing here is ever shown to the learner except through the content script's
// brief toast. Diagnostics go to this worker's console only.

import { CONFIG } from "./config.js";
import { validateCue, SCHEMA_VERSION } from "./lib/validate.js";
import { splitSentences } from "./lib/segment.js";
import {
  addCapture, listCaptures, getNeedsAttention, discardCaptures, MAX_QUEUE,
} from "./lib/queue.js";
import {
  getSession, clearSession, getAuthState, establishSession, createTokenProvider,
} from "./lib/auth.js";
import { createCapture } from "./lib/firestore.js";
import { syncPass, createSyncRunner } from "./lib/sync.js";

const storage = chrome.storage.local;
const log = (...a) => console.debug("[SceneLingo]", ...a);
const ALARM = "scenelingo-sync";
const DAY = 24 * 60 * 60 * 1000;
const REMINDER_KEY = "meta:lastReminderAt";
const FIRST_RUN_KEY = "meta:firstRunDone";

const tokens = createTokenProvider({
  storage,
  fetchFn: (...a) => fetch(...a),
  apiKey: CONFIG.firebase.apiKey,
  baseUrl: CONFIG.endpoints?.secureToken,
});

async function scheduleFrom(summary) {
  if (summary?.nextAttemptAt) {
    const when = Math.max(summary.nextAttemptAt, Date.now() + 30_000);
    await chrome.alarms.create(ALARM, { when });
  } else {
    await chrome.alarms.clear(ALARM);
  }
}

const runner = createSyncRunner(async () => {
  try {
    const summary = await syncPass({
      storage,
      tokens,
      createCapture,
      projectId: CONFIG.firebase.projectId,
      fetchFn: (...a) => fetch(...a),
      baseUrl: CONFIG.endpoints?.firestore,
      log,
    });
    await scheduleFrom(summary);
    return summary;
  } catch (e) {
    log("sync pass crashed (will retry)", e);
    await chrome.alarms.create(ALARM, { when: Date.now() + 60_000 });
    return { status: "retry" };
  }
});
const requestSync = () => runner.request();

// ------------------------------------------------------------------ web app tab
// Opens SceneLingo, or focuses an already-open tab. An existing tab is only navigated when the
// caller asks for it (the learner clicked "Review"); otherwise it is left exactly as it was, so
// the learner never loses their place in the web app.
async function openWebApp(path = "/", { navigate = false } = {}) {
  const base = CONFIG.webOrigin;
  try {
    const tabs = await chrome.tabs.query({ url: `${base}/*` });
    if (tabs.length) {
      const t = tabs[0];
      if (navigate && path !== "/") await chrome.tabs.update(t.id, { url: base + path, active: true });
      else await chrome.tabs.update(t.id, { active: true });
      await chrome.windows.update(t.windowId, { focused: true });
      return;
    }
  } catch (e) {
    log("tab lookup failed, opening a new tab", e);
  }
  await chrome.tabs.create({ url: base + path });
}

chrome.action.onClicked.addListener(() => openWebApp("/"));

// Chrome only attaches a content script when a tab loads, so a YouTube tab that was open before the
// extension was installed (or reloaded) would ignore clicks until refreshed. Attach to those tabs now.
// The script checks for a live copy first, so a tab never ends up with two.
async function attachToOpenTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ["https://www.youtube.com/*", "https://www.netflix.com/*"] });
    await Promise.allSettled(tabs.map((t) => chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["content.js"] })));
  } catch (e) {
    log("could not attach to open tabs", e);
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await attachToOpenTabs();
  if (details.reason === "install") {
    const r = await storage.get(FIRST_RUN_KEY);
    if (!r[FIRST_RUN_KEY]) {
      await storage.set({ [FIRST_RUN_KEY]: true });
      await openWebApp("/?welcome=1"); // once, on first install only
    }
  }
  requestSync();
});
chrome.runtime.onStartup.addListener(() => requestSync());
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) requestSync();
});

// ------------------------------------------------------------------ capture
async function shouldRemind(session) {
  const na = await getNeedsAttention(storage, session);
  if (!na.own.length) return false;
  const r = await storage.get(REMINDER_KEY);
  if (Date.now() - (r[REMINDER_KEY] || 0) < DAY) return false;
  await storage.set({ [REMINDER_KEY]: Date.now() });
  return true;
}

async function handleCapture(cue) {
  const v = validateCue(cue);
  if (!v.ok) return { ok: false, reason: v.reason === "empty" ? "empty" : "invalid" };

  const session = await getSession(storage);
  if (!session) return { ok: false, reason: "not_signed_in" };
  if ((await getAuthState(storage)) === "reauth") return { ok: false, reason: "reauth_required" };

  if ((await listCaptures(storage)).length >= MAX_QUEUE) return { ok: false, reason: "queue_full" };

  const record = {
    id: crypto.randomUUID(),
    uid: session.uid,
    accountHint: session.accountHint,
    ...v.value,
    sentences: splitSentences(v.value.text),
    capturedAt: Date.now(),
    schemaVersion: SCHEMA_VERSION,
    sync: { state: "pending", attempts: 0, lastAttemptAt: null, nextAttemptAt: null, errorKind: null, lastError: null },
  };
  try {
    await addCapture(storage, record);
  } catch (e) {
    log("storage write failed", e);
    return { ok: false, reason: "storage_error" };
  }
  // Safety net in case this worker is stopped mid-request, then sync in the background.
  chrome.alarms.create(ALARM, { when: Date.now() + 30_000 });
  requestSync();
  return { ok: true, attention: await shouldRemind(session) };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Internal messages only: from this extension's own content scripts.
  if (sender.id !== chrome.runtime.id || !sender.tab) return false;
  if (msg?.type === "capture") {
    handleCapture(msg.cue).then(sendResponse, (e) => {
      log("capture failed", e);
      sendResponse({ ok: false, reason: "storage_error" });
    });
    return true;
  }
  if (msg?.type === "openSignIn") {
    openWebApp("/?signin=1");
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "openAttention") {
    openWebApp("/profile?attention=1", { navigate: true });
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

// ------------------------------------------------------------------ web app <-> extension (auth handoff only)
const PROTOCOL = 1;
const isString = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;

function originAllowed(sender) {
  const origin = sender.origin || (sender.url ? new URL(sender.url).origin : "");
  return CONFIG.allowedOrigins.includes(origin);
}

async function handleExternal(msg) {
  switch (msg?.type) {
    case "ping": {
      const s = await getSession(storage);
      return { ok: true, protocol: PROTOCOL, signedInUid: s?.uid ?? null, authState: await getAuthState(storage) };
    }
    case "setSession": {
      if (!isString(msg.uid, 128) || !isString(msg.refreshToken, 4096)) return { ok: false, error: "bad_request" };
      try {
        const prev = await getSession(storage);
        const s = await establishSession({
          storage,
          fetchFn: (...a) => fetch(...a),
          apiKey: CONFIG.firebase.apiKey,
          baseUrl: CONFIG.endpoints?.secureToken,
          uid: msg.uid,
          refreshToken: msg.refreshToken,
        });
        if (!prev || prev.uid !== s.uid) tokens.reset();
        requestSync();
        return { ok: true, uid: s.uid };
      } catch (e) {
        log("setSession rejected", e?.message);
        return { ok: false, error: e?.kind === "network" ? "network" : "invalid_session" };
      }
    }
    case "clearSession": {
      // Learner signed out in the web app: try to save what is left first, then drop the session.
      await Promise.race([requestSync(), new Promise((r) => setTimeout(r, 8000))]);
      const s = await getSession(storage);
      const unsaved = s ? (await listCaptures(storage)).some((r) => r.uid === s.uid) : false;
      await clearSession(storage);
      tokens.reset();
      return { ok: true, unsaved }; // lines stay on this device, owned by that account
    }
    case "getNeedsAttention": {
      return { ok: true, ...(await getNeedsAttention(storage, await getSession(storage))) };
    }
    case "discardCaptures": {
      if (!Array.isArray(msg.ids) || msg.ids.length === 0 || msg.ids.length > 200 || !msg.ids.every((i) => isString(i, 64))) {
        return { ok: false, error: "bad_request" };
      }
      return { ok: true, removed: await discardCaptures(storage, await getSession(storage), msg.ids) };
    }
    default:
      return { ok: false, error: "unknown_message" };
  }
}

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!originAllowed(sender)) {
    log("rejected external message from", sender.origin || sender.url);
    return false;
  }
  handleExternal(msg).then(sendResponse, (e) => {
    log("external handler failed", e);
    sendResponse({ ok: false, error: "internal" });
  });
  return true;
});
