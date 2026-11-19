// Failure kinds used by the sync engine. These are for the service worker and
// developer diagnostics only; they are never shown to the learner.

export class SyncError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = "SyncError";
    this.kind = kind; // network | auth | permission | quota | invalid | unknown
    Object.assign(this, extra);
  }
}

// Maps a Firestore REST response to a failure kind, or "exists" when the
// create-only precondition failed because the document is already there.
export function classifyHttp(status, apiStatus = "", message = "") {
  if (apiStatus === "ABORTED") return "network"; // contention: safe to retry
  if (
    apiStatus === "ALREADY_EXISTS" ||
    status === 409 ||
    (apiStatus === "FAILED_PRECONDITION" && /already exists/i.test(message))
  ) {
    return "exists";
  }
  if (status === 401 || apiStatus === "UNAUTHENTICATED") return "auth";
  if (status === 403 || apiStatus === "PERMISSION_DENIED") return "permission";
  if (status === 429 || apiStatus === "RESOURCE_EXHAUSTED") return "quota";
  if (status === 400 || apiStatus === "INVALID_ARGUMENT") return "invalid";
  if (status >= 500 || ["UNAVAILABLE", "DEADLINE_EXCEEDED", "INTERNAL"].includes(apiStatus)) return "network";
  return "unknown";
}
