import test from "node:test";
import assert from "node:assert/strict";
import { FakeStorage, makeRecord, jsonResponse, fireError } from "./helpers.js";
import { addCapture, listCaptures, getCapture, getNeedsAttention, discardCaptures, keyOf } from "../src/lib/queue.js";
import { saveSession, getAuthState, createTokenProvider, establishSession, getSession } from "../src/lib/auth.js";
import { createCapture, buildCommitBody } from "../src/lib/firestore.js";
import { syncPass, createSyncRunner, backoffMs } from "../src/lib/sync.js";
import { SyncError } from "../src/lib/errors.js";

const A = { uid: "userA", email: "a@example.com", accountHint: "a***@example.com", refreshToken: "rt-A" };
const B = { uid: "userB", email: "b@example.com", accountHint: "b***@example.com", refreshToken: "rt-B" };

function jwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(payload)}.sig`;
}

// Builds an engine whose Firestore create is scripted per capture id.
function engine({ session = A, behaviour = () => "created", clock = { t: 1_000_000 } } = {}) {
  const storage = new FakeStorage();
  const calls = [];
  const tokens = { getIdToken: async () => "id-token", reset() {} };
  const create = async ({ record }) => {
    calls.push(record.id);
    const r = await behaviour(record, calls.length);
    if (r instanceof Error) throw r;
    return r;
  };
  const run = async () => {
    if (session) await saveSession(storage, session);
    return syncPass({ storage, tokens, createCapture: create, projectId: "p", fetchFn: null, now: () => clock.t });
  };
  return { storage, calls, run, clock };
}

test("confirmed capture is removed; only its own key is touched", async () => {
  const e = engine();
  await addCapture(e.storage, makeRecord({ id: "c1" }));
  await addCapture(e.storage, makeRecord({ id: "c2" }));
  const s = await e.run();
  assert.equal(s.created, 2);
  assert.equal((await listCaptures(e.storage)).length, 0);
  assert.ok(!e.storage.ops.some((o) => o[0] === "clear"), "queue must never be cleared");
});

test("a capture that arrives DURING a sync is not lost", async () => {
  const e = engine({
    behaviour: async (rec) => {
      if (rec.id === "c1") await addCapture(e.storage, makeRecord({ id: "late" })); // arrives mid-sync
      return "created";
    },
  });
  await addCapture(e.storage, makeRecord({ id: "c1" }));
  await e.run();
  const left = (await listCaptures(e.storage)).map((r) => r.id);
  assert.deepEqual(left, ["late"], "the late capture survives and c1 is gone");
});

test("network failure keeps the capture, schedules a retry, and stops the pass", async () => {
  const e = engine({ behaviour: () => new SyncError("network", "offline") });
  await addCapture(e.storage, makeRecord({ id: "c1", capturedAt: 1 }));
  await addCapture(e.storage, makeRecord({ id: "c2", capturedAt: 2 }));
  const s = await e.run();
  assert.equal(e.calls.length, 1, "does not hammer a dead connection");
  const c1 = await getCapture(e.storage, "c1");
  assert.equal(c1.sync.attempts, 1);
  assert.equal(c1.sync.errorKind, "network");
  assert.equal(c1.sync.nextAttemptAt, e.clock.t + backoffMs(1, "network"));
  assert.ok(s.nextAttemptAt >= e.clock.t + 30_000);
  assert.equal((await listCaptures(e.storage)).length, 2);
});

test("retry only happens once the backoff has elapsed, then succeeds", async () => {
  let offline = true;
  const e = engine({ behaviour: () => (offline ? new SyncError("network", "offline") : "created") });
  await addCapture(e.storage, makeRecord({ id: "c1" }));
  await e.run();
  offline = false;
  await e.run(); // too early
  assert.equal(e.calls.length, 1);
  e.clock.t += 31_000;
  const s = await e.run();
  assert.equal(s.created, 1);
  assert.equal((await listCaptures(e.storage)).length, 0);
});

test("'already exists' counts as synchronized and removes the local copy", async () => {
  const e = engine({ behaviour: () => "exists" });
  await addCapture(e.storage, makeRecord({ id: "c1" }));
  const s = await e.run();
  assert.equal(s.existed, 1);
  assert.equal((await listCaptures(e.storage)).length, 0);
});

test("captures of another account are never synced or removed", async () => {
  const e = engine({ session: B });
  await addCapture(e.storage, makeRecord({ id: "a1", uid: "userA" }));
  await addCapture(e.storage, makeRecord({ id: "b1", uid: "userB", accountHint: "b***@example.com" }));
  const s = await e.run();
  assert.equal(s.created, 1);
  assert.deepEqual(e.calls, ["b1"]);
  assert.ok(await getCapture(e.storage, "a1"), "user A's capture is retained");
});

test("signed out: nothing is synced, nothing is deleted", async () => {
  const e = engine({ session: null });
  await addCapture(e.storage, makeRecord({ id: "a1" }));
  const s = await e.run();
  assert.equal(s.status, "no_session");
  assert.equal(e.calls.length, 0);
  assert.equal((await listCaptures(e.storage)).length, 1);
});

test("auth failure keeps captures, flags re-sign-in, and stops", async () => {
  const e = engine({ behaviour: () => new SyncError("auth", "expired") });
  await addCapture(e.storage, makeRecord({ id: "c1" }));
  const s = await e.run();
  assert.equal(s.status, "reauth");
  assert.equal(await getAuthState(e.storage), "reauth");
  assert.equal((await listCaptures(e.storage)).length, 1);
  const again = await e.run();
  assert.equal(again.status, "reauth", "does not keep trying until a new session arrives");
});

test("record-specific rejection: quarantined when other captures succeed; others keep syncing", async () => {
  const e = engine({
    behaviour: (rec) => (rec.id === "bad" ? new SyncError("permission", "rules rejected") : "created"),
  });
  await addCapture(e.storage, makeRecord({ id: "good1", capturedAt: 1 }));
  await addCapture(e.storage, makeRecord({ id: "bad", capturedAt: 2 }));
  await addCapture(e.storage, makeRecord({ id: "good2", capturedAt: 3 }));
  const s = await e.run();
  assert.equal(s.created, 2);
  assert.equal(s.invalid, 1);
  const bad = await getCapture(e.storage, "bad");
  assert.equal(bad.sync.state, "invalid", "retained, not deleted");
  assert.equal(await getCapture(e.storage, "good1"), null);
});

test("systemic rejection (everything fails): nothing is quarantined or deleted", async () => {
  const e = engine({ behaviour: () => new SyncError("permission", "App Check enforcement") });
  for (const id of ["c1", "c2", "c3", "c4"]) await addCapture(e.storage, makeRecord({ id, capturedAt: Number(id[1]) }));
  const s = await e.run();
  assert.equal(s.invalid, 0);
  const recs = await listCaptures(e.storage);
  assert.equal(recs.length, 4);
  assert.ok(recs.every((r) => r.sync.state === "pending" && r.sync.nextAttemptAt >= e.clock.t + 900_000));
});

test("a single rejected capture with no other success stays pending and retries slowly", async () => {
  const e = engine({ behaviour: () => new SyncError("invalid", "bad") });
  await addCapture(e.storage, makeRecord({ id: "c1" }));
  await e.run();
  const r = await getCapture(e.storage, "c1");
  assert.equal(r.sync.state, "pending");
});

test("invalid captures are excluded from retries until discarded explicitly", async () => {
  const e = engine();
  await addCapture(e.storage, makeRecord({ id: "inv", sync: { state: "invalid", attempts: 1 } }));
  await e.run();
  assert.equal(e.calls.length, 0);
  assert.ok(await getCapture(e.storage, "inv"));
  const na = await getNeedsAttention(e.storage, A);
  assert.equal(na.own.length, 1);
  assert.equal(await discardCaptures(e.storage, A, ["inv"]), 1);
  assert.equal(await getCapture(e.storage, "inv"), null);
});

test("discard cannot remove healthy pending captures of the current account", async () => {
  const e = engine();
  await addCapture(e.storage, makeRecord({ id: "ok1" }));
  await addCapture(e.storage, makeRecord({ id: "other", uid: "userB" }));
  assert.equal(await discardCaptures(e.storage, A, ["ok1", "other"]), 1);
  assert.ok(await getCapture(e.storage, "ok1"));
  assert.equal(await getCapture(e.storage, "other"), null);
});

test("needs-attention groups other accounts' lines by masked hint", async () => {
  const e = engine();
  await addCapture(e.storage, makeRecord({ id: "o1", uid: "userB", accountHint: "b***@example.com" }));
  await addCapture(e.storage, makeRecord({ id: "o2", uid: "userB", accountHint: "b***@example.com" }));
  const na = await getNeedsAttention(e.storage, A);
  assert.equal(na.other.length, 1);
  assert.equal(na.other[0].lines.length, 2);
  assert.equal(na.other[0].accountHint, "b***@example.com");
});

test("runner coalesces concurrent requests and runs one follow-up pass", async () => {
  let passes = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  const runner = createSyncRunner(async () => {
    passes++;
    if (passes === 1) await gate;
  });
  const p1 = runner.request();
  runner.request();
  runner.request();
  release();
  await p1;
  assert.equal(passes, 2);
});

test("backoff grows and is capped", () => {
  assert.equal(backoffMs(1, "network"), 30_000);
  assert.equal(backoffMs(3, "network"), 120_000);
  assert.equal(backoffMs(99, "network"), 3_600_000);
  assert.ok(backoffMs(1, "permission") >= 900_000);
});

// ---------------------------------------------------------------- Firestore REST client
test("commit body is create-only with a server timestamp and typed fields", () => {
  const body = buildCommitBody("proj", makeRecord({ id: "c1", videoId: null }));
  const w = body.writes[0];
  assert.equal(w.currentDocument.exists, false);
  assert.deepEqual(w.updateTransforms, [{ fieldPath: "syncedAt", setToServerValue: "REQUEST_TIME" }]);
  assert.equal(w.update.name, "projects/proj/databases/(default)/documents/users/userA/captures/c1");
  assert.equal(w.update.fields.ownerUid.stringValue, "userA");
  assert.deepEqual(w.update.fields.videoId, { nullValue: null });
  assert.equal(w.update.fields.status.stringValue, "new");
  assert.match(w.update.fields.capturedAt.timestampValue, /^2025-|^2026-/);
  assert.equal(w.update.fields.schemaVersion.integerValue, "1");
});

test("REST create: 200 = created, 409 = exists, others throw typed errors", async () => {
  const rec = makeRecord({ id: "c1" });
  const mk = (resp) => createCapture({ fetchFn: async () => resp, projectId: "p", idToken: "t", record: rec });
  assert.equal(await mk(jsonResponse(200, {})), "created");
  assert.equal(await mk(fireError(409, "ALREADY_EXISTS", "Document already exists")), "exists");
  await assert.rejects(mk(fireError(403, "PERMISSION_DENIED")), (e) => e.kind === "permission");
  await assert.rejects(mk(fireError(401, "UNAUTHENTICATED")), (e) => e.kind === "auth");
  await assert.rejects(mk(fireError(503, "UNAVAILABLE")), (e) => e.kind === "network");
  await assert.rejects(
    createCapture({ fetchFn: async () => { throw new TypeError("Failed to fetch"); }, projectId: "p", idToken: "t", record: rec }),
    (e) => e.kind === "network"
  );
});

test("REST create sends the bearer token to the commit endpoint", async () => {
  let seen;
  await createCapture({
    fetchFn: async (url, init) => ((seen = { url, init }), jsonResponse(200, {})),
    projectId: "my-proj",
    idToken: "TOKEN",
    record: makeRecord(),
  });
  assert.equal(seen.url, "https://firestore.googleapis.com/v1/projects/my-proj/databases/(default)/documents:commit");
  assert.equal(seen.init.headers.Authorization, "Bearer TOKEN");
  assert.equal(seen.init.method, "POST");
});

// ---------------------------------------------------------------- session handoff
test("session handoff is verified with Google before it is trusted", async () => {
  const storage = new FakeStorage();
  const idToken = jwt({ email: "alice@example.com", user_id: "userA" });
  const ok = async () => jsonResponse(200, { id_token: idToken, refresh_token: "rt-new", user_id: "userA", expires_in: "3600" });
  const s = await establishSession({ storage, fetchFn: ok, apiKey: "k", uid: "userA", refreshToken: "rt" });
  assert.equal(s.accountHint, "a***@example.com");
  assert.equal((await getSession(storage)).refreshToken, "rt-new");

  const other = new FakeStorage();
  await assert.rejects(
    establishSession({ storage: other, fetchFn: ok, apiKey: "k", uid: "SOMEONE_ELSE", refreshToken: "rt" }),
    (e) => e.kind === "auth"
  );
  assert.equal(await getSession(other), null, "a mismatched uid never becomes a session");

  const bad = async () => fireError(400, "INVALID_ARGUMENT", "INVALID_REFRESH_TOKEN");
  await assert.rejects(establishSession({ storage: other, fetchFn: bad, apiKey: "k", uid: "userA", refreshToken: "x" }), (e) => e.kind === "auth");
});

test("token provider caches the ID token and refreshes near expiry", async () => {
  const storage = new FakeStorage();
  await saveSession(storage, A);
  let n = 0;
  let t = 0;
  const fetchFn = async () => jsonResponse(200, { id_token: `tok${++n}`, refresh_token: "rt-A", user_id: "userA", expires_in: "3600" });
  const tp = createTokenProvider({ storage, fetchFn, apiKey: "k", now: () => t });
  assert.equal(await tp.getIdToken(), "tok1");
  assert.equal(await tp.getIdToken(), "tok1");
  t += 3_600_000 - 30_000;
  assert.equal(await tp.getIdToken(), "tok2");
});
