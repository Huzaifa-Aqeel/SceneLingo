import test from "node:test";
import assert from "node:assert/strict";
import { validateCue, parseVideoId, maskEmail, MAX_TEXT } from "../src/lib/validate.js";
import { splitSentences } from "../src/lib/segment.js";
import { classifyHttp } from "../src/lib/errors.js";

const good = { text: "  Hello   there. ", time: 10.12345, site: "youtube", title: "T", url: "https://www.youtube.com/watch?v=abc123XYZ_-&t=10s" };

test("valid cue is normalized", () => {
  const r = validateCue(good);
  assert.equal(r.ok, true);
  assert.equal(r.value.text, "Hello there.");
  assert.equal(r.value.videoId, "abc123XYZ_-");
  assert.equal(r.value.playbackTimeSeconds, 10.123);
});

test("empty text is silent, not an error message", () => {
  assert.deepEqual(validateCue({ ...good, text: "   " }), { ok: false, reason: "empty" });
});

test("rejects oversized text, bad platform, bad url, bad time", () => {
  assert.equal(validateCue({ ...good, text: "x".repeat(MAX_TEXT + 1) }).reason, "too_long");
  assert.equal(validateCue({ ...good, site: "vimeo" }).reason, "bad_platform");
  assert.equal(validateCue({ ...good, url: "http://www.youtube.com/watch?v=abc123XYZ_-" }).reason, "bad_url");
  assert.equal(validateCue({ ...good, url: "https://evil.example.com/watch?v=abc123XYZ_-" }).reason, "bad_url");
  assert.equal(validateCue({ ...good, time: -1 }).reason, "bad_time");
  assert.equal(validateCue({ ...good, time: NaN }).reason, "bad_time");
});

test("netflix video id comes from /watch/<id>; unknown ids are null", () => {
  assert.equal(parseVideoId("netflix", "https://www.netflix.com/watch/81234567?trackId=1"), "81234567");
  assert.equal(parseVideoId("youtube", "https://www.youtube.com/"), null);
});

test("maskEmail", () => {
  assert.equal(maskEmail("alice@example.com"), "a***@example.com");
  assert.equal(maskEmail(""), "your account");
});

test("sentences are split on real sentence boundaries", () => {
  assert.deepEqual(splitSentences("I think so. Do you? Yes!"), ["I think so.", "Do you?", "Yes!"]);
  assert.deepEqual(splitSentences("Dr. Smith is here."), ["Dr. Smith is here."]);
  assert.deepEqual(splitSentences("   "), []);
});

test("http errors are classified", () => {
  assert.equal(classifyHttp(409, "ALREADY_EXISTS"), "exists");
  assert.equal(classifyHttp(400, "FAILED_PRECONDITION", "Document already exists: x"), "exists");
  assert.equal(classifyHttp(401, "UNAUTHENTICATED"), "auth");
  assert.equal(classifyHttp(403, "PERMISSION_DENIED"), "permission");
  assert.equal(classifyHttp(429, "RESOURCE_EXHAUSTED"), "quota");
  assert.equal(classifyHttp(400, "INVALID_ARGUMENT"), "invalid");
  assert.equal(classifyHttp(503, "UNAVAILABLE"), "network");
  assert.equal(classifyHttp(418, ""), "unknown");
});
