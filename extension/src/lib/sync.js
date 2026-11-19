// Sync engine (FR-SYNC-002..007). Silent: it never produces learner-facing output.
//
// Invariants:
//  - only captures owned by the current session's uid are processed;
//  - a local key is removed only after the server confirms (created or exists);
//  - only that capture's own key is touched;
//  - one failing capture never blocks the others.

import { SyncError } from "./errors.js";
import { getSession, getAuthState, setAuthState } from "./auth.js";
import { listCaptures, getCapture, updateCapture, updateCaptureUnlocked, withLock, keyOf } from "./queue.js";

const STEPS_S = [30, 60, 120, 300, 900, 1800, 3600];

export function backoffMs(attempts, kind) {
  let s = STEPS_S[Math.min(Math.max(attempts - 1, 0), STEPS_S.length - 1)];
  if (kind === "permission" || kind === "invalid") s = Math.max(s, 900);
  if (kind === "quota") s = Math.max(s, 300);
  return s * 1000;
}

const SYSTEMIC_THRESHOLD = 3;

export async function syncPass({ storage, tokens, createCapture, projectId, fetchFn, baseUrl, now = Date.now, log = () => {} }) {
  const summary = { status: "ok", created: 0, existed: 0, failed: 0, invalid: 0, nextAttemptAt: null };

  const session = await getSession(storage);
  if (!session) return { ...summary, status: "no_session" };
  if ((await getAuthState(storage)) === "reauth") return { ...summary, status: "reauth" };

  // `update` is the locked updater outside withLock, or the unlocked one inside it.
  const mark = (id, kind, err, update = updateCapture) =>
    update(storage, id, (r) => {
      const attempts = (r.sync?.attempts ?? 0) + 1;
      r.sync = {
        ...r.sync,
        state: "pending",
        attempts,
        lastAttemptAt: now(),
        nextAttemptAt: now() + backoffMs(attempts, kind),
        errorKind: kind,
        lastError: String(err?.message || err || "").slice(0, 300),
      };
    });

  const due = (await listCaptures(storage))
    .filter((r) => r.uid === session.uid && r.sync?.state === "pending" && (r.sync?.nextAttemptAt ?? 0) <= now())
    .sort((a, b) => a.capturedAt - b.capturedAt);

  const suspects = [];
  let idToken;
  try {
    idToken = await tokens.getIdToken();
  } catch (e) {
    return handleTokenFailure(e);
  }

  async function handleTokenFailure(e) {
    if (e instanceof SyncError && e.kind === "auth") {
      await setAuthState(storage, "reauth");
      log("auth failure: sign-in required", e.message);
      return { ...summary, status: "reauth" };
    }
    log("token failure (will retry)", e?.message);
    return { ...summary, status: "retry", nextAttemptAt: now() + backoffMs(1, "network") };
  }

  for (const rec of due) {
    let stop = false;
    await withLock(rec.id, async () => {
      const cur = await getCapture(storage, rec.id);
      if (!cur || cur.uid !== session.uid || cur.sync?.state !== "pending") return;

      const attempt = () => createCapture({ fetchFn, projectId, idToken, record: cur, baseUrl });
      let result;
      try {
        try {
          result = await attempt();
        } catch (e) {
          if (e instanceof SyncError && e.kind === "auth") {
            tokens.reset();
            idToken = await tokens.getIdToken({ force: true }); // may throw
            result = await attempt();
          } else {
            throw e;
          }
        }
      } catch (e) {
        const kind = e instanceof SyncError ? e.kind : "unknown";
        summary.failed++;
        if (kind === "auth") {
          await setAuthState(storage, "reauth");
          log("auth failure: sign-in required", e.message);
          summary.status = "reauth";
          stop = true;
        } else if (kind === "network" || kind === "quota") {
          await mark(rec.id, kind, e, updateCaptureUnlocked);
          stop = true;
        } else if (kind === "permission" || kind === "invalid") {
          suspects.push({ id: rec.id, kind, err: e });
        } else {
          await mark(rec.id, "unknown", e, updateCaptureUnlocked);
        }
        return;
      }
      // Server confirmed (created, or already exists): now and only now, remove.
      await storage.remove(keyOf(rec.id)); // already holding this id's lock
      if (result === "created") summary.created++;
      else summary.existed++;
    });
    if (stop) break;
  }

  // Record-specific versus systemic rejection (FR-SYNC-006).
  if (suspects.length) {
    const someSucceeded = summary.created + summary.existed > 0;
    if (someSucceeded) {
      for (const s of suspects) {
        await updateCapture(storage, s.id, (r) => {
          r.sync = { ...r.sync, state: "invalid", lastAttemptAt: now(), errorKind: s.kind, lastError: String(s.err.message).slice(0, 300) };
        });
        summary.invalid++;
        log("quarantined invalid capture", s.id, s.err.message);
      }
    } else {
      const systemic = suspects.length >= SYSTEMIC_THRESHOLD;
      for (const s of suspects) await mark(s.id, s.kind, s.err);
      log(systemic ? "systemic rejection: nothing quarantined" : "single rejection: keeping and retrying slowly", suspects[0].err.message);
    }
  }

  // When should the next retry run?
  const left = (await listCaptures(storage)).filter((r) => r.uid === session.uid && r.sync?.state === "pending");
  if (left.length) {
    summary.nextAttemptAt = Math.min(...left.map((r) => r.sync?.nextAttemptAt || now() + 30_000));
  }
  return summary;
}

// Coalesces concurrent requests: at most one pass at a time, and a request that
// arrives during a pass triggers exactly one more pass afterwards.
export function createSyncRunner(passFn) {
  let running = null;
  let again = false;
  async function loop() {
    let last;
    do {
      again = false;
      last = await passFn();
    } while (again);
    return last;
  }
  return {
    request() {
      if (running) {
        again = true;
        return running;
      }
      running = loop().finally(() => {
        running = null;
      });
      return running;
    },
  };
}
