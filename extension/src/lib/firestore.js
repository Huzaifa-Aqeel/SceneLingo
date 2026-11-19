// Firestore REST client for creating capture documents (FR-SYNC-001 / FR-SYNC-004).
//
// One commit per capture: create the document only if it does not exist, and let
// the server stamp syncedAt. A retry of an already-synchronized capture therefore
// returns "exists" and never modifies the document (it may have been processed in
// the web application since).

import { SyncError, classifyHttp } from "./errors.js";

const str = (v) => ({ stringValue: String(v) });
const nullable = (v) => (v == null ? { nullValue: null } : str(v));

export function captureFields(r) {
  return {
    ownerUid: str(r.uid),
    text: str(r.text),
    sentences: { arrayValue: { values: (r.sentences || []).map(str) } },
    editedText: { nullValue: null },
    platform: str(r.platform),
    videoId: nullable(r.videoId),
    videoTitle: str(r.videoTitle),
    videoUrl: str(r.videoUrl),
    playbackTimeSeconds: { doubleValue: Number(r.playbackTimeSeconds) },
    subtitleLanguage: nullable(r.subtitleLanguage),
    capturedAt: { timestampValue: new Date(r.capturedAt).toISOString() },
    status: str("new"),
    savedCardIds: { arrayValue: {} },
    schemaVersion: { integerValue: String(r.schemaVersion ?? 1) },
  };
}

export function buildCommitBody(projectId, r) {
  const name = `projects/${projectId}/databases/(default)/documents/users/${r.uid}/captures/${r.id}`;
  return {
    writes: [
      {
        update: { name, fields: captureFields(r) },
        currentDocument: { exists: false },
        updateTransforms: [{ fieldPath: "syncedAt", setToServerValue: "REQUEST_TIME" }],
      },
    ],
  };
}

// Resolves "created" or "exists". Throws SyncError for everything else.
export async function createCapture({ fetchFn, projectId, idToken, record, timeoutMs = 15000, baseUrl = "https://firestore.googleapis.com" }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchFn(
      `${baseUrl}/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:commit`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildCommitBody(projectId, record)),
        signal: ctrl.signal,
      }
    );
  } catch (e) {
    throw new SyncError("network", `request failed: ${e?.name === "AbortError" ? "timeout" : e?.message || e}`);
  } finally {
    clearTimeout(timer);
  }
  if (res.ok) return "created";

  let err = {};
  try {
    err = (await res.json())?.error ?? {};
  } catch {
    // non-JSON error body
  }
  const kind = classifyHttp(res.status, err.status, err.message);
  if (kind === "exists") return "exists";
  throw new SyncError(kind, `${res.status} ${err.status || ""} ${err.message || ""}`.trim(), { http: res.status });
}
