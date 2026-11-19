// Per-capture local queue (FR-CAP-006 / FR-CAP-007).
// One chrome.storage.local key per capture: "capture:<id>".
// Rules: add writes only its own key, update rewrites only its own key, remove
// removes only its own key. Nothing here ever clears or rewrites the whole queue.
// The service worker is the only caller.

export const CAPTURE_PREFIX = "capture:";
export const MAX_QUEUE = 1000;
export const keyOf = (id) => CAPTURE_PREFIX + id;

// Serializes operations on the same capture id so an update can never
// resurrect a key that a concurrent remove just deleted.
const locks = new Map();
export function withLock(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  locks.set(id, tail);
  tail.then(() => {
    if (locks.get(id) === tail) locks.delete(id);
  });
  return run;
}

export async function listCaptures(storage) {
  const all = await storage.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith(CAPTURE_PREFIX))
    .map(([, v]) => v);
}

export async function getCapture(storage, id) {
  const k = keyOf(id);
  const res = await storage.get(k);
  return res[k] ?? null;
}

export async function addCapture(storage, record) {
  await withLock(record.id, () => storage.set({ [keyOf(record.id)]: record }));
}

// Rewrites only this capture's own key. Returns null if it no longer exists.
// Unlocked variant: only call it while already holding withLock(id).
export async function updateCaptureUnlocked(storage, id, mutate) {
  const cur = await getCapture(storage, id);
  if (!cur) return null;
  const draft = structuredClone(cur);
  const next = mutate(draft) ?? draft; // mutators may edit in place or return a new record
  await storage.set({ [keyOf(id)]: next });
  return next;
}

export function updateCapture(storage, id, mutate) {
  return withLock(id, () => updateCaptureUnlocked(storage, id, mutate));
}

export function removeCapture(storage, id) {
  return withLock(id, () => storage.remove(keyOf(id)));
}

// Lines the learner may need to know about: this account's invalid lines, and
// lines retained for other accounts. Never includes this account's healthy lines.
export async function getNeedsAttention(storage, session) {
  const all = await listCaptures(storage);
  const view = (r) => ({ id: r.id, text: r.text, videoTitle: r.videoTitle, capturedAt: r.capturedAt });
  const own = all
    .filter((r) => session && r.uid === session.uid && r.sync?.state === "invalid")
    .sort((a, b) => b.capturedAt - a.capturedAt)
    .map(view);
  const byAccount = new Map();
  for (const r of all) {
    if (session && r.uid === session.uid) continue;
    const g = byAccount.get(r.uid) ?? { accountHint: r.accountHint || "another account", lines: [] };
    g.lines.push(view(r));
    byAccount.set(r.uid, g);
  }
  return { own, other: [...byAccount.values()] };
}

// Explicit learner action. Only invalid lines of the current account and lines
// owned by other accounts can be removed this way; healthy pending lines cannot.
export async function discardCaptures(storage, session, ids) {
  let removed = 0;
  for (const id of ids) {
    const rec = await getCapture(storage, id);
    if (!rec) continue;
    const own = session && rec.uid === session.uid;
    if (own && rec.sync?.state !== "invalid") continue;
    await removeCapture(storage, id);
    removed++;
  }
  return removed;
}
