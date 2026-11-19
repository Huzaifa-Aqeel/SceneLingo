// Test doubles: a chrome.storage.local look-alike and a scriptable fetch.

export class FakeStorage {
  constructor() {
    this.data = new Map();
    this.ops = []; // log of operations, to assert nothing clears or rewrites everything
  }
  async get(keys) {
    this.ops.push(["get", keys]);
    if (keys === null || keys === undefined) return Object.fromEntries(this.data);
    const list = Array.isArray(keys) ? keys : [keys];
    const out = {};
    for (const k of list) if (this.data.has(k)) out[k] = structuredClone(this.data.get(k));
    return out;
  }
  async set(obj) {
    this.ops.push(["set", Object.keys(obj)]);
    for (const [k, v] of Object.entries(obj)) this.data.set(k, structuredClone(v));
  }
  async remove(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    this.ops.push(["remove", list]);
    for (const k of list) this.data.delete(k);
  }
  async clear() {
    this.ops.push(["clear"]);
    this.data.clear();
  }
}

export function makeRecord(over = {}) {
  const id = over.id ?? Math.random().toString(36).slice(2);
  return {
    id,
    uid: "userA",
    accountHint: "a***@example.com",
    text: "I think we're getting ahead of ourselves.",
    sentences: ["I think we're getting ahead of ourselves."],
    platform: "youtube",
    videoId: "abc123XYZ_-",
    videoTitle: "Test video",
    videoUrl: "https://www.youtube.com/watch?v=abc123XYZ_-&t=12s",
    playbackTimeSeconds: 12.5,
    subtitleLanguage: null,
    capturedAt: 1_763_554_812_000,
    schemaVersion: 1,
    sync: { state: "pending", attempts: 0, lastAttemptAt: null, nextAttemptAt: null, errorKind: null, lastError: null },
    ...over,
  };
}

export const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

export const fireError = (status, apiStatus, message = "") =>
  jsonResponse(status, { error: { code: status, status: apiStatus, message } });
