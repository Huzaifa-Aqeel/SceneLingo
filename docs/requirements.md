# SceneLingo — Functional Requirements Document

**Working product name:** SceneLingo  
**Product description:** A contextual English-learning companion that turns subtitles you capture while watching videos into a personal vocabulary collection.  
**Document type:** Functional Requirements Document (FRD)  
**Version:** 3.0 (current architecture: capture-only extension, sign-in in the web application, session handoff, direct REST sync, per-language translation routing)  
**Date:** 19 November 2026  
**Target event:** Firebase #BuildHybridAI 2026 (submission window closes Monday 30 November 2026, 2:00 PM PT per the Devpost listing; re-verify)  
**Components:** (1) Chrome extension for capture and synchronization, (2) responsive React web application (the "dashboard") hosted on Firebase Hosting for sign-in and learning  
**Backend:** Firebase Authentication, Cloud Firestore, Firebase AI Logic, Firebase App Check, Firebase Hosting  

> The product name is provisional. The requirements below describe the agreed product, not a commitment to a final brand name.

### Architecture at a glance

| Topic | Decision |
|---|---|
| Surfaces | A **capture-only Chrome extension** and a **hosted React web application**. There is no separate mobile app, extension side panel, popup, or options page. |
| Invariant | **The extension is invisible during normal viewing** (Section 1.2). It takes priority over every other UX or architecture decision. |
| Sign-in | The learner signs in **once, in the web application** (Firebase Email/Password). The extension has no sign-in UI and no Firebase SDK. |
| Session handoff | The web application hands the signed-in session to the extension over `externally_connectable` (exact origin, fixed extension ID). The extension verifies it with Google before trusting it. The same channel carries the rare review of unsaved lines. Captures never travel through it. |
| Capture | Click a subtitle: a brief toast, then nothing. The video is never paused, seeked, or muted. |
| Queue | One `chrome.storage.local` key per capture. The service worker is the sole owner. A key is removed only after Firestore confirms that capture. The queue is never cleared or rewritten as a whole. |
| Sync | Automatic and silent, from the service worker, through the **Firestore REST API** with the user's Firebase ID token (create-only writes). The dashboard does not need to be open. |
| Ownership | Every capture is stamped with the signed-in UID at capture time and only ever syncs under that UID. |
| Invalid captures | Prevented by capture-time validation. A rejected record is quarantined, never deleted silently, and reviewed in the web application's Profile. |
| Toolbar icon | Opens or focuses the web application. No popup. |
| Learning | Inbox, Explore, My Collection, Learning Cards, Practice, Progress, Profile. Firestore is the source of truth. |
| AI | Firebase AI Logic in the web application only. English cards use `PREFER_ON_DEVICE`. Translation into the learner's chosen language is routed per language: on-device where the model supports it on that device, cloud otherwise. |
| Data | `learningCards` with per-language `translations`; `reviewEvents` written atomically with card statistics; duplicate cards identified by normalized selected text + normalized source sentence. |
| Netflix | The existing Netflix capture code and manifest entry stay unchanged. Not part of the MVP acceptance criteria. |

---

## 1. Product vision

SceneLingo helps non-native English speakers learn vocabulary from the movies, shows, and videos they already watch. While watching, a learner clicks a subtitle that contains something interesting. The extension captures that line and the learner keeps watching without interruption. Later, in the SceneLingo dashboard, the learner works through a Capture Inbox at their own pace: they pick a word, a multi-word expression, or a whole sentence from each capture, and SceneLingo explains it in its original context. It identifies whether it is vocabulary, an idiom, slang, or an expression, provides English synonyms and examples, and lets the learner save it to a personal collection.

In the learner's own language, chosen in their profile, SceneLingo also provides a translation and explanation. It runs on the learner's device when the on-device model supports that language, and in the cloud otherwise. The saved collection supports practice with flashcards, reverse flashcards, a quiz with three question formats, and review of previously incorrect answers, with simple spaced review built in.

**Core promise:** Capture while you watch. Learn when you are ready.

### 1.1 Product principles

1. **Never interrupt the video.** Capturing is one click and a brief confirmation. Learning happens afterwards in the web application. See the invariant in Section 1.2.
2. **Context before dictionary definitions.** The meaning must explain what the selected word or phrase means in the actual subtitle, not merely return a generic dictionary definition.
3. **User chooses what to learn.** SceneLingo never captures subtitles automatically. A capture happens only on a learner click, and an item enters the Collection only after the learner explicitly saves it.
4. **Small, useful learning cards.** Prefer one clear meaning, a few relevant synonyms, and practical examples over long AI essays.
5. **Local where it makes sense.** Supported English explanation runs on the user's device where Chrome allows it. Deterministic work (segmentation, practice, scheduling) never needs AI.
6. **Cloud where capability requires it.** Translation into a language the on-device model does not support uses cloud inference. The app decides per language, never assumes, and always shows which one ran.
7. **One personal library across devices.** Everything the learner does in the dashboard is stored under one Firebase account in Firestore.
8. **Transparent AI.** The UI identifies whether a generated English explanation came from on-device or cloud inference.

### 1.2 Product invariant: the extension is invisible during normal viewing

SceneLingo is for non-native English speakers who want to enjoy movies and entertainment without being interrupted. The extension must feel like a seamless learning companion, not a tool the learner has to operate. This invariant has priority over any other UX or architecture decision in this document.

1. During normal viewing the extension shows nothing: no popup, side panel, overlay, persistent badge, counter, or status indicator.
2. The only thing visible during viewing is one small, temporary confirmation after the learner deliberately clicks a subtitle.
3. Capturing never pauses, seeks, mutes, or otherwise changes playback.
4. Synchronization is automatic and invisible. The learner never starts, monitors, or manages it.
5. The extension never shows technical concepts (queue, sync, retry, acknowledgement, storage keys, tokens, error codes). It uses plain language about the learner's captured lines and their account.
6. Extra feedback appears only when the learner must act (FR-CAP-005), is brief, and never blocks the video.
7. Learning, browsing, and every management task happen in the hosted web application.
8. The extension has no pages of its own: no popup, side panel, options page, or account page. Sign-in and the rare review of unsaved lines happen in the web application.
9. Technical diagnostics go to the service-worker console for developers, not to learners.

---

## 2. Goals and success criteria

### 2.1 Product goals

- Let a learner capture an interesting subtitle line while watching, without leaving or pausing the video.
- Deliver captures reliably to a Capture Inbox in the learner's account, without losing or duplicating any.
- Let the learner select an individual word, phrase, idiom, slang term, expression, or complete sentence from a capture.
- Explain the selection in clear, learner-friendly English using its subtitle context.
- Distinguish the learning category: `vocabulary`, `idiom`, `slang`, or `expression`.
- Provide English synonyms or alternative expressions, practical example sentences, and source context.
- Provide a translation and explanation in the learner's chosen language when requested, on-device where the model supports that language and in the cloud otherwise.
- Save items to a personal collection available on desktop and mobile browsers.
- Make saved items useful through repeatable practice activities with mistake tracking and spaced review.
- Demonstrate real Firebase AI Logic hybrid inference in the running application.

### 2.2 Hackathon success criteria

The submitted build should demonstrate all of the following in a single coherent journey:

1. The learner, signed in to SceneLingo, clicks a YouTube subtitle, sees a confirmation toast, and the video keeps playing.
2. The extension synchronizes the capture directly to Firestore, and it appears in the dashboard's Capture Inbox without the dashboard having been open at capture time.
3. The learner opens a capture, and the cue is shown as selectable sentences and words.
4. The user selects a word or phrase and receives a contextual English learning card.
5. The English card is generated through Firebase AI Logic using `PREFER_ON_DEVICE`, with a genuine on-device result when the judge's environment supports it and cloud fallback otherwise.
6. The UI displays the actual inference source (`ON_DEVICE` or `IN_CLOUD`) for hybrid requests.
7. The user requests a translation into their chosen language. The app routes it to on-device or cloud inference according to that language's support, and shows the actual source. Demonstrate one on-device-supported language and one cloud-only language (for example Spanish and Urdu).
8. The user saves the item and sees it in My Collection.
9. The same collection is visible when the learner signs in on another device (for example a phone browser).
10. The learner completes at least one practice activity and the result is saved.

The #BuildHybridAI requirements known at the time of writing are a functioning project, Firebase AI Logic actually called at runtime, a public source repository with an open-source license, and a public YouTube demonstration video of no more than three minutes. App Check is required; debug tokens are accepted for submissions. See Section 17. The official rules page could not be retrieved while writing this version, so these points must be re-confirmed against the published rules before submission (see Section 17, FR-FB-011).

---

## 3. Users and primary use cases

### 3.1 Primary user

A non-native English speaker who watches English-language movies, shows, or online videos and wants to understand and remember unfamiliar vocabulary and expressions. The first target audience is Urdu-speaking learners in Pakistan, but each learner chooses their own language.

### 3.2 User stories

- **US-01:** As a learner, I want to click a subtitle while watching and keep watching, so capturing never interrupts the video.
- **US-02:** As a learner, I want my captures collected in an inbox, so I can process them later at my own pace.
- **US-03:** As a learner, I want captures to reach my account automatically, even if I am offline when I capture them and without keeping the dashboard open, so I do not lose them.
- **US-04:** As a learner, I want a capture divided into individual sentences and words, so I can choose exactly what to learn.
- **US-05:** As a learner, I want to click one word or select multiple words, so I can save either vocabulary or a complete expression.
- **US-06:** As a learner, I want the selected text explained using the complete sentence, so I understand its intended meaning.
- **US-07:** As a learner, I want to know whether something is vocabulary, an idiom, slang, or an expression.
- **US-08:** As a learner, I want English synonyms and natural examples, so I can use the expression myself.
- **US-09:** As a learner, I want a translation and explanation in my own language, so the meaning is accessible to me.
- **US-20:** As a learner, I want to see whether my language runs on my device or in the cloud, so I know where my text is processed.
- **US-10:** As a learner, I want to save an item and find it later without searching for the original video.
- **US-11:** As a learner, I want my collection on my phone and my computer.
- **US-12:** As a learner, I want to test whether I remember a meaning before revealing the answer.
- **US-13:** As a learner, I want to complete a sentence using a saved expression in its original context.
- **US-14:** As a learner, I want to review items I previously answered incorrectly.
- **US-15:** As a learner, I want to see my progress and revision history.
- **US-16:** As a learner, I want previously synchronized cards and practice to remain available when I temporarily lose internet access.
- **US-17:** As a learner on a shared computer, I want my captures to sync only to my own account, even if someone else signs in to the extension afterwards.
- **US-18:** As a learner, I never want to think about synchronization. If something goes wrong that I must fix, I want a short plain-language message and a simple way to fix it.
- **US-19:** As a learner, I want to sign in once, in SceneLingo, and have the browser extension just work without signing in again.

---

## 4. Scope

### 4.1 In scope for the hackathon MVP

- Chrome desktop extension that captures the clicked subtitle (existing click-to-capture extraction logic, unchanged), shows a toast, stores each capture in a local per-capture queue, and synchronizes it directly to Firestore through the REST API with automatic retry, acting with the session the web application hands over.
- A toolbar icon that opens the hosted web application (no popup), and a messaging channel from the web application to the extension for the session handoff and the review of unsaved lines.
- Responsive React web application on Firebase Hosting with Inbox, Explore, My Collection, Learning Cards, Practice, Progress, and Profile screens.
- Reliable, idempotent, silently retrying synchronization from the extension service worker to the Firestore Inbox through the Firestore REST API, with strict per-user capture ownership.
- Subtitle normalization and sentence segmentation at capture time in the extension, and word segmentation for selection in the dashboard, using one shared `Intl.Segmenter` module.
- User selection of a word, phrase, or complete sentence from a capture.
- Contextual English learning cards generated using Firebase AI Logic hybrid inference.
- Category classification into vocabulary, idiom, slang, or expression.
- English meaning, contextual meaning, English synonyms, and example sentences.
- On-demand translation and contextual explanation in the learner's chosen language, routed per language to on-device or cloud inference, with a visible source label.
- Firebase Authentication and Cloud Firestore-backed personal library.
- Flashcards, reverse flashcards, a three-format quiz, mistake review, and simple spaced review.
- Firebase App Check and a visible on-device/cloud inference indicator.

### 4.2 Explicitly out of scope for the hackathon MVP

- Full Netflix, Disney+, Prime Video, or other streaming-platform support as a product commitment. The existing Netflix capture code and manifest entry are kept unchanged and may continue to work, but Netflix is not part of the MVP acceptance criteria, demo, or support promise. The capture architecture stays adapter-based so more platforms can be added later; YouTube is the only platform the MVP is verified against.
- Any popup, side panel, overlay, or learning UI in the extension, and any technical status, counter, queue, or synchronization control shown to the learner.
- AI calls (Firebase AI Logic or the Prompt API) and any Firebase SDK inside the extension. The extension uses the Secure Token and Firestore REST APIs only.
- Pausing the video on capture.
- A continuous live subtitle feed, automatic capture of every subtitle, or storing full subtitle tracks and movie transcripts.
- Capturing from a phone. Capture requires the desktop extension.
- Signed-out or anonymous capture, and any capture synchronization that depends on the web application. The messaging channel carries only the session and the review of unsaved lines, never captures.
- Any sign-in, account, or settings UI in the extension. These live in the web application.
- DRM circumvention, decryption, or access to protected media streams.
- Audio recording, speech-to-text, or OCR subtitle extraction.
- Native Android or iOS applications.
- On-device Gemini Nano inference on mobile phones.
- Multi-turn AI tutor chat.
- Social profiles, public vocabulary collections, leaderboards, or classroom administration.
- Romanization and script variants (for example Roman Urdu, or Serbian Latin versus Cyrillic). Translation output uses the language's standard script.
- Automatic language-learning level assessment or a full CEFR curriculum.
- Browsers other than Chrome desktop for the extension. The dashboard itself should work in current mobile and desktop browsers, with on-device inference only on supported Chrome desktop.

---

## 5. Platform architecture and responsibilities

```
 YouTube (or Netflix) page — the learner watches normally; the extension shows nothing
        │  learner deliberately clicks a subtitle
        ▼
 Content script  (extraction only: no storage, no Firebase)
        │  validates the cue → chrome.runtime.sendMessage({ type: "capture", cue })
        ▼
 Extension service worker ── sole owner of the session, the queue, and sync ──
        │ 1. require a session; stamp the capture with its UID
        │ 2. write chrome.storage.local["capture:<id>"] ──► reply ok ──► brief toast, then nothing
        │ 3. in the background: Firestore REST create-if-absent  users/{uid}/captures/{id}
        │ 4. server confirms ─► remove only that "capture:<id>" key
        │ 5. failure ─► keep the key, classify, retry later (alarms + backoff), silently
        │            ▲
        │            │ session (uid + refresh token), sign-out, review of unsaved lines
        │            │ chrome.runtime messaging, externally_connectable, exact origin only
        ▼            │
 Cloud Firestore ◄── source of truth ◄── React web application (Firebase Hosting)
                                           the learner signs in here, once
                                           Inbox · Explore · My Collection ·
                                           Learning Cards · Practice · Progress · Profile
                                           └─ Firebase AI Logic (hybrid English; translation
                                              routed per language) + App Check

 Toolbar icon (no popup): opens or focuses the web application.
```

### 5.1 Chrome extension (capture and synchronization)

The extension has these responsibilities:

- YouTube (and existing Netflix) subtitle extraction from the rendered DOM.
- Sentence segmentation at capture time (word-level segmentation happens where words are selectable, in the web application; see FR-SEG-002).
- User-selected subtitle capture (a deliberate learner click) and capture-time validation.
- Local per-capture queue.
- Direct Firestore synchronization through the REST API.
- Automatic retry, error classification, and account-ownership management.
- Holding the session handed over by the web application (Section 5.4).

It is not responsible for sign-in, AI explanation, learning-card generation, practice, library browsing, or any operational UI.

**Components**

- **Content script (`content.js`):** The existing tested extraction logic: the click hit-test, caption text reading, metadata collection, and toast. It validates the cue, suppresses duplicate clicks, sends the capture to the service worker, and shows the brief confirmation only after the service worker confirms that the capture is stored. It never touches the queue and never loads Firebase. It does not pause, seek, or otherwise alter playback.
- **Service worker (`background.js`):** The sole owner of the session, the capture queue, the sync engine, retry alarms, the toolbar-icon click handler, and the messaging channel to the web application.
- **Shared segmentation module:** One `Intl.Segmenter` module (sentence segmentation, with title-abbreviation handling) used by the extension. The web application uses the same logic for word selection.

There are no other extension pages.

**Access to Google services:** The service worker calls two REST APIs with `fetch`, and uses no Firebase SDK. It exchanges the session's refresh token for short-lived ID tokens through the Secure Token API, and calls the Firestore REST API with `Authorization: Bearer <ID token>`. Firestore security rules evaluate those requests with the signed-in user's identity. The web application uses the Firestore Web SDK.

**Manifest requirements**

- Manifest V3 with an ES-module service worker. The extension is plain JavaScript and needs no bundler.
- Permissions: `storage`, `alarms`, and `scripting` (to attach the capture script to video tabs that were already open when the extension was installed or reloaded). No `contextMenus`, `tabs`, `sidePanel`, or `identity`.
- Host permissions: `https://www.youtube.com/*` and `https://www.netflix.com/*` (the sites the capture script already runs on), `https://firestore.googleapis.com/*`, `https://securetoken.googleapis.com/*`, and the web application's origin (used to focus an already-open tab).
- `externally_connectable.matches` lists exactly the web application's origin. A `localhost` origin appears only in development builds.
- A fixed extension ID, set with a manifest `key` (public key committed; the private `.pem` is never committed), so the web application and every unpacked install share one ID.
- **No** `action.default_popup`, no options page, no side panel. The service worker handles `chrome.action.onClicked`.
- Content-script `matches` are unchanged (YouTube and Netflix).
- Firebase web configuration (project ID and web API key) is baked into the build. These are public identifiers, not secrets.

### 5.2 Hosted React web application (sign-in and learning)

A responsive React application hosted on Firebase Hosting and opened in a normal browser tab on desktop or mobile. It is where the learner signs up and signs in with Firebase Email/Password, and where all learning happens. Screens are listed in Section 16.2.

- It hands the signed-in session to the extension whenever the learner signs in, when the page loads signed in, and when the session token changes. It tells the extension to forget the session when the learner signs out.
- The Inbox is a real-time Firestore view of captures. The web application never reads the extension's queue and never relays captures.
- Profile shows whether the extension is connected and lets the learner review lines that could not be saved (FR-CAP-011).
- It is a top-level browser window, which is what the Chrome Prompt API and Firebase hybrid inference require. A phone browser can use the Inbox, Collection, and Practice with the same account, but cannot capture and cannot run on-device inference; new AI requests from mobile browsers use cloud inference.

### 5.3 Shared backend

- **Firebase Authentication:** Email/Password provider enabled. Used by the web application only. Other providers could be added later: the extension only ever receives the resulting session.
- **Cloud Firestore:** Stores captures (Inbox), learning cards, user settings, practice progress, and review events. The extension creates captures through the REST API. The web application reads captures and writes everything else, including capture status.
- **Firebase AI Logic:** Hybrid English explanation and translation routed per language (FR-AI-007), from the web application only.
- **Firebase App Check:** Required for Firebase AI Logic. Its use for Firestore requests from the extension is a validation item (Section 5.8).
- **Firebase Hosting:** Hosts the web application.
- **Firebase Remote Config:** The cloud model name (`cloud_model`), with a built-in default if Remote Config cannot be reached.

### 5.4 Messaging between the extension and the web application

**Internal messages** (content script → service worker). The service worker rejects any sender whose `sender.id` is not its own extension ID, and accepts these only from content scripts (a message with `sender.tab`).

| Message | Purpose and result |
|---|---|
| `capture { cue }` | Validate, stamp the UID, store, trigger a background sync. Result `{ ok: true, attention }` or `{ ok: false, reason }` where `reason` is `not_signed_in`, `reauth_required`, `queue_full`, `invalid`, or `storage_error`. `attention` says whether a review reminder is due (FR-CAP-005). |
| `openSignIn` | Open (or focus) the web application's sign-in. |
| `openAttention` | Open (or focus) Profile in the web application, at the unsaved-lines section. |

**External messages** (web application → service worker), through `chrome.runtime.sendMessage(EXTENSION_ID, …)`. They are answered only for the web application's exact origin; any other sender is ignored.

| Message | Purpose and result |
|---|---|
| `ping` | `{ ok, protocol, signedInUid, authState }`. Lets Profile show whether the extension is connected. |
| `setSession { uid, refreshToken }` | Hand over the signed-in session (below). Result `{ ok: true, uid }` or `{ ok: false, error }`. |
| `clearSession` | The learner signed out. The extension first tries to save what it can (bounded to about 8 seconds), then forgets the session. Result `{ ok: true, unsaved }`, where `unsaved` says whether any of this account's captures could not be saved yet. |
| `getNeedsAttention` | Returns this account's invalid lines and any retained lines that belong to other accounts (text, video title, capture time, masked account hint). Never returns healthy pending lines. |
| `discardCaptures { ids }` | Explicit, user-confirmed removal. Only invalid lines of the current account and lines owned by other accounts can be removed; healthy pending lines cannot. |

There is no message for manual sync, queue listing, counts, or status, because no UI shows them.

**Session handoff.**
- The web application sends the user's UID and Firebase refresh token. The extension does **not** trust them as given: it exchanges the refresh token with the Secure Token API and accepts the session only if the token is valid and belongs to the claimed UID.
- It stores the UID, the email-derived masked hint, and the refresh token in `chrome.storage.local`, never logs them, and obtains ID tokens from the refresh token as needed (cached until shortly before expiry, and forced to refresh once on a 401).
- Handing the same session over repeatedly is harmless. Handing over a different user's session switches the extension to that user; the previous user's captures stay on the device under their own UID (Section 5.7).
- A refresh token stays valid after the web application signs out, so sign-out sends `clearSession`. If the extension was unreachable at that moment, its session may linger until it is replaced or becomes invalid; the extension only ever writes under the UID in its session.
- If the session later stops working (account disabled, password changed, token revoked), capturing is disabled with the sign-in message (FR-CAP-008) until the web application hands over a valid session, which it does as soon as the learner is signed in there.

**Security.**
- The web application's origin is the only origin that can reach the extension (manifest `externally_connectable` plus a sender-origin check in the service worker). Unknown message types and malformed parameters are rejected without side effects.
- Any script running on the web application's origin can call this channel, so the web application must serve a strict Content Security Policy and render captured text only as text.
- The channel carries the session and the unsaved-lines review only. It never carries captures.

### 5.5 Per-capture local queue

- Each capture is stored under its own key `capture:<id>` in `chrome.storage.local`. Auxiliary state uses keys outside the `capture:` prefix (`meta:session`, `meta:authState`, `meta:lastReminderAt`, `meta:firstRunDone`).
- The service worker generates a unique capture `id` (for example `crypto.randomUUID()`) before storing. The same `id` is the Firestore document ID.
- The only queue operations are: add (write one new key), update (rewrite only that capture's own key, for example sync state), and remove (remove only that capture's key). Operations on the same capture are serialized so an update can never resurrect a key that a concurrent removal just deleted.
- Nothing may call `chrome.storage.local.clear()`, rewrite the full list, or read-modify-write a shared array.
- Listing the queue is a read of keys with the `capture:` prefix.
- Each record has this shape:

```json
{
  "id": "6f1c1c1e-6d9e-4d1e-9a52-5f3b8e1d0c11",
  "uid": "FIREBASE_UID",
  "accountHint": "a***@example.com",
  "text": "I think we're getting ahead of ourselves.",
  "sentences": ["I think we're getting ahead of ourselves."],
  "platform": "youtube",
  "videoId": "VIDEO_ID",
  "videoTitle": "Video title",
  "videoUrl": "https://www.youtube.com/watch?v=VIDEO_ID&t=125s",
  "playbackTimeSeconds": 125.4,
  "subtitleLanguage": null,
  "capturedAt": 1763554812345,
  "schemaVersion": 1,
  "sync": {
    "state": "pending",
    "attempts": 0,
    "lastAttemptAt": null,
    "nextAttemptAt": null,
    "errorKind": null,
    "lastError": null
  }
}
```

- `sync.state` is `pending` or `invalid`. `errorKind` is `network`, `auth`, `permission`, `invalid`, `quota`, or `unknown`. These values are for the service worker and developer diagnostics only. They are never shown to the learner.
- `uid` is the account that owns the capture (Section 5.7). `accountHint` is a masked email kept only so Profile can name which account a retained line belongs to.
- Mapping from the legacy entry: `site` → `platform`, `title` → `videoTitle`, `url` → `videoUrl`, `time` → `playbackTimeSeconds`, `savedAt` → `capturedAt`. `videoId` is parsed from the YouTube `v` parameter or the Netflix `/watch/<id>` path and is `null` if unknown.

### 5.6 Capture synchronization lifecycle

1. **Sign in:** The learner signs in (or signs up) in the web application. The web application hands the session to the extension (Section 5.4).
2. **Capture:** The learner clicks a subtitle. The content script validates the cue and sends `capture` to the service worker.
3. **Stamp and store:** The service worker requires a session, builds the record with `uid` from that session, validates it again, and writes `capture:<id>`.
4. **Confirm locally:** The service worker replies `{ ok: true }`. The content script shows the brief confirmation. A failure shows a short plain-language message (FR-CAP-005).
5. **Background sync:** The service worker immediately and silently tries to create the document in Firestore, without blocking the reply in step 4.
6. **Confirm remotely:** Only after Firestore reports success (or reports that the document already exists), the service worker removes that one `capture:<id>` key.
7. **Failure:** The capture stays in the queue. The error is classified (FR-SYNC-006), recorded on that capture's own key, and a retry is scheduled. Nothing is shown to the learner.
8. **Retry triggers:** A new capture, service-worker startup, browser startup, a new session, and a retry alarm. There is no manual trigger.
9. **Web application:** The Inbox's Firestore listener shows the capture as soon as it exists in Firestore. The web application takes no part in synchronization.

**The REST request.** Each capture is created with a single commit that has a "create only if absent" precondition and a server-set timestamp:

```
POST https://firestore.googleapis.com/v1/projects/{projectId}/databases/(default)/documents:commit
Authorization: Bearer <Firebase ID token>

{
  "writes": [{
    "update": {
      "name": "projects/{projectId}/databases/(default)/documents/users/{uid}/captures/{id}",
      "fields": { "...typed Firestore values (stringValue, doubleValue, timestampValue, arrayValue, nullValue)..." }
    },
    "currentDocument": { "exists": false },
    "updateTransforms": [{ "fieldPath": "syncedAt", "setToServerValue": "REQUEST_TIME" }]
  }]
}
```

- HTTP 200 means the server has committed the write. That is the only signal that allows removal of the local key.
- If the document already exists, the precondition fails (expected HTTP 409, status `ALREADY_EXISTS`; the exact response is confirmed in V-1). The capture is treated as already synchronized, and the existing document is never modified.
- This gives idempotency without a read or a transaction, and a retry can never reset a status or edit the learner made in the web application.
- `capturedAt` (epoch milliseconds) is converted to an RFC 3339 `timestampValue`. All fields are serialized into typed Firestore values by one tested serializer.
- Every request has a bounded timeout (for example 15 seconds, using `AbortController`). A timeout counts as a network failure.

### 5.7 Account ownership model

- Every capture is stamped with the session's UID when it is captured. A capture's `uid` is never changed.
- The sync engine only processes captures whose `uid` equals the current session's UID. The Firestore path uses the record's own `uid`, and the security rules independently require `request.auth.uid` to equal that path UID, so a bug cannot write User A's capture under User B.
- When the learner signs out, new captures are disabled. Existing queued captures keep their owner and remain on the device.
- If User B signs in, User A's captures are not synced, not deleted, and not reassigned. They sync when User A signs in again, or the learner explicitly removes them in Profile (FR-CAP-011).
- Unowned captures never exist, because capturing requires a session. Captures from earlier builds (the legacy `captures` array) are not adopted automatically (FR-CAP-014).

### 5.8 Technical validation items

Each must be proven against the real services and the real browser, and its outcome recorded in the repository (for example `docs/validation.md`). None is assumed to work.

| ID | Validation | Why it is uncertain | Fallback if it fails |
|---|---|---|---|
| V-1 | Firestore REST create-if-absent from the service worker with a real Firebase ID token: HTTP 200 on create; the exact response when the document exists; security rules applied to the request; error codes for each failure class; the declared host permissions are sufficient | The design depends on exact REST behaviour for preconditions and error mapping. | Use `createDocument` with `?documentId=` (it fails with a conflict if the document exists). It cannot set a server timestamp, so drop `syncedAt` and use the document's server-assigned create time instead. |
| V-2 | Session handoff with a real account: the refresh token from the Firebase Web SDK (`user.refreshToken`) is accepted by the Secure Token API; the extension keeps working after browser and service-worker restarts and after ID-token expiry; a password change or revoked token disables capturing with the sign-in message and a fresh handoff restores it | The design depends on the SDK's refresh token being usable outside the SDK. | Mint a Firebase custom token for the extension from a small backend after verifying the web session. |
| V-3 | App Check for extension-origin Firestore requests (below) | See below. | See below. |
| V-4 | A full set of pending captures completes despite service-worker shutdown, using alarm-based retries | The worker can be stopped while a request is in flight. | Work in small batches; rely on idempotent retries; remove nothing before confirmation. |
| V-5 | The capture click does not change playback. Verify on YouTube (normal, theatre, full screen): a playing video stays playing and a paused video stays paused. | The extension does not stop the click, so YouTube's own click handling may toggle playback. | Stop propagation of the capture click, or restore the previous play state, in the content script. |
| V-6 | Toolbar icon and messaging in a real browser: `chrome.action.onClicked` opens or focuses the web application tab; `externally_connectable` reaches the extension from the production origin and from the development origin (match-pattern behaviour for `localhost` ports); other origins cannot reach it; behaviour when the learner was in full screen | These flows depend on tab, window, and match-pattern behaviour. | Adjust the development origin pattern; open the web application in a new window. |
| V-7 | Language support probe on desktop Chrome: `LanguageModel.availability` for English input and each candidate output language returns the expected states (for example available for Spanish and Japanese, unavailable for languages the model does not support), and routing follows it | Language support depends on the Chrome version and device. | Route every language to the cloud and show "In the cloud". |

**V-3 detail: App Check and extension-origin Firestore requests.** Do not assume the web application's reCAPTCHA Enterprise App Check configuration works for the extension. The built-in web providers need a web page and a registered site/domain, and a service worker has no page or DOM. An extension origin (`chrome-extension://<id>`) is not a registered reCAPTCHA domain. A REST request could carry an App Check token in an `X-Firebase-AppCheck` header, but the extension would still need a way to obtain one. The options to evaluate:

1. **Do not enforce App Check on Cloud Firestore.** Keep enforcement on Firebase AI Logic only (required by the hackathon), and protect Firestore with Authentication and security rules. This is the default decision until another option is proven.
2. **Custom App Check provider** with a small backend that mints tokens using the Admin SDK after verifying the user's Firebase ID token. This gives the extension a token but is a weaker attestation, because any client holding valid credentials can obtain one.
3. **Debug token** for development only. Debug tokens are never committed or shipped.

If Firestore enforcement is switched on before the extension can send valid tokens, every extension request will fail with `PERMISSION_DENIED`. Captures stay safely queued, but nothing syncs, and because the learner sees no sync UI the failure would be silent. So the Firestore enforcement setting must be changed only after the extension path is verified in a test project.

### 5.9 Environment configuration

| Item | Where | Notes |
|---|---|---|
| Firebase web config (project ID, web API key, app ID) | Extension build and web application build | Public identifiers, not secrets |
| Web application origin | Extension build (`externally_connectable`, host permission, toolbar icon target) | Production Firebase Hosting origin; plus `http://localhost:5173` in development builds only |
| Extension ID | Web application build | Fixed by the manifest `key`; the private `.pem` is never committed |
| Authorized domains | Firebase Auth | Hosting domain for the web application |
| reCAPTCHA Enterprise site key | Web application build (`VITE_RECAPTCHA_SITE_KEY`) | For App Check on Firebase AI Logic. The extension follows the V-3 decision. |
| App Check debug token | Local development only (`.env.development.local`) | Never committed, never in a production build |

---

## 6. Functional requirements — capture (extension)

### FR-CAP-001 — Click-to-capture on supported pages

**Priority:** Must have  
The content script shall run on YouTube video pages (and on Netflix where the existing code already runs) and capture a subtitle when the learner left-clicks on a rendered caption, provided the learner is signed in to the extension (FR-CAP-008).

**Acceptance criteria:**
- Clicking a displayed subtitle captures it. Clicking anywhere else does nothing and does not alter playback.
- Works in normal, theatre, and full-screen mode.
- On other sites, no content script runs.
- Capture works in a tab that was already open when the extension was installed, updated, or reloaded, without refreshing the tab. The extension attaches its script to such tabs itself, and never leaves two live copies in one tab. A copy orphaned by a reload stays silent.

### FR-CAP-002 — Read the rendered subtitle

**Priority:** Must have  
The extension shall read subtitle text from the rendered DOM using the existing tested extraction implementation. The extraction logic is not changed by this document.

**Acceptance criteria:**
- Multiple caption lines forming one displayed cue are captured as one cue with whitespace normalized.
- Nothing is captured, stored, or transmitted until the learner clicks.

### FR-CAP-003 — Duplicate-click protection

**Priority:** Must have  
The extension shall ignore a repeated click on the same cue (existing rule: same text, same video, playback time within 3 seconds of the previous capture).

**Acceptance criteria:**
- Double-clicking a subtitle creates one capture.
- Capturing the same text later at a different time creates a new capture.
- The content script applies the rule against its own most recent capture (kept in memory), because it no longer reads the queue. The service worker may repeat the check defensively. The check must not depend on the capture still being in the queue, since synchronized captures are removed from it.

### FR-CAP-004 — Capture record

**Priority:** Must have  
Each capture shall contain the fields of the queue record in Section 5.5: unique `id`, owning `uid`, `text`, `sentences`, `platform`, `videoId` (nullable), `videoTitle`, `videoUrl`, `playbackTimeSeconds`, `subtitleLanguage` (nullable), `capturedAt`, and `schemaVersion`.

**Acceptance criteria:**
- `sentences` is the result of sentence segmentation of `text` using the shared `Intl.Segmenter` module (with a documented fallback when unavailable). `text` is always kept unchanged alongside it.
- `playbackTimeSeconds` is `video.currentTime` at the moment of the click, an approximate timestamp unless exact cue start/end times become available. The UI must not imply millisecond-accurate cue timing.
- For YouTube, `videoUrl` includes a `t=` parameter so the dashboard can link back to the moment.

### FR-CAP-005 — Brief confirmation, and feedback only when the learner must act

**Priority:** Must have  
After a capture has been stored locally, the extension shall show one small, temporary toast (existing "Subtitle captured ✓" behaviour) and let the video continue playing. This is the only thing the extension shows during normal viewing (Section 1.2).

**Acceptance criteria:**
- The toast is visible in full-screen mode, disappears by itself within a couple of seconds, takes no focus, and ignores keyboard input.
- The confirmation is identical whether the learner is online or offline. It never mentions saving, syncing, or queues.
- The success toast appears only after the service worker confirms the local write. It does not wait for Firestore.
- Background synchronization success or failure never produces a toast.
- No other element is shown during normal viewing: no icon overlay, badge, counter, or status text.

**Feedback only when the learner must act.** These are the only other messages. They are brief, plain-language, and never block the video:

| Situation | Message (wording may change; the intent may not) | Behaviour |
|---|---|---|
| Not signed in, or session needs renewing | "Sign in to SceneLingo to save this line." with a **Sign in** link | The link opens the web application's sign-in. If the learner is already signed in there, the web application hands the session to the extension and nothing more is needed. Shown on the first such click, then not again for a few minutes (for example 5), so ordinary clicks on captions are not nagged. |
| Cannot save right now (queue full) | "Couldn't save that line. Please try again later." | Nothing is stored. |
| Cannot save the line (validation or storage failure) | "Couldn't capture that line." | Nothing is stored. A line that is empty after normalization produces no message at all. |
| Extension was updated or reloaded | "SceneLingo was updated. Refresh this page to keep capturing." | Shown when the content script can no longer reach the extension. |
| A previously captured line needs attention (FR-CAP-011) | "Some lines couldn't be saved." with a **Review** link | At most once per day, and only after a deliberate capture click. The link opens Profile in the web application. |

### FR-CAP-006 — Per-capture queue (data integrity)

**Priority:** Must have (P0 data-integrity requirement)  
Captures shall be stored in `chrome.storage.local` with one key per capture, `capture:<id>`, as defined in Section 5.5. The array-based queue of earlier builds is replaced.

**Acceptance criteria:**
- Adding a capture writes only its own key.
- Removing a synchronized capture removes only its own key.
- Updating a capture's sync state rewrites only its own key.
- No operation clears the storage area or rewrites the whole queue during capture, synchronization, retry, acknowledgement, or discard.
- A capture arriving while another capture is syncing, being removed, or being discarded is never lost. Verified with a concurrency test that captures during an active sync.
- Captures persist across browser and service-worker restarts until synchronized or explicitly discarded.
- The queue has a documented maximum size (default 1000 captures across all owners). When full, new captures are refused with a brief plain-language toast (FR-CAP-005). Existing captures are never silently dropped.

### FR-CAP-007 — Service worker is the sole queue owner

**Priority:** Must have  
Only the service worker shall create, modify, or delete queue keys. The content script and the web application (through the messages in Section 5.4) can only request changes; they never write queue keys directly.

**Acceptance criteria:**
- The content script contains no direct writes to `capture:` keys, and the web application can only request removal of invalid or other-account lines through `discardCaptures`.
- The capture ID is generated by the service worker before the record is stored.

### FR-CAP-008 — Authentication gate

**Priority:** Must have  
Capturing requires a session in the extension, handed over by the web application (FR-CAP-010).

**Acceptance criteria:**
- With no session, a click on a subtitle captures nothing and shows the sign-in message from FR-CAP-005. The click has no other effect.
- After the learner signs out, capturing stays disabled until a session is handed over again.
- If the session is found to be invalid (the account was disabled, the password changed, or the token was revoked), capturing is disabled with the same sign-in message, and queued captures are retained (FR-SYNC-006).
- A signed-in learner who is offline can still capture. The session is not re-validated against the server for each capture.
- After the learner signs in to SceneLingo, capturing works on already-open video pages without a page refresh.
- While a session exists, nothing about authentication is ever shown during viewing.
- Every stored capture carries the UID of the session at the moment of the click.

### FR-CAP-009 — Toolbar icon opens the web application (no popup)

**Priority:** Must have  
The extension shall not define a popup, options page, side panel, or any page of its own. Clicking the toolbar icon opens the hosted SceneLingo web application in a new tab, or focuses an already-open SceneLingo tab instead of opening a duplicate. The web application decides what to show (sign-in if the learner is signed out, otherwise the Inbox).

**Acceptance criteria:**
- No popup, side panel, badge, or context-menu items appear at any time.
- On first install, the web application opens once (with a welcome view). It never opens automatically again.
- Clicking the icon works the same whether or not the learner is signed in.

### FR-CAP-010 — Sign-in in the web application and session handoff

**Priority:** Must have  
The learner signs in once, in the web application. The extension has no sign-in UI and receives its session from the web application over the messaging channel in Section 5.4.

**Acceptance criteria:**
- Signing in or signing up in the web application results in the extension having a session, with no second sign-in, no extra screen, and no action in the extension.
- The web application hands the session over when the learner signs in, when a page loads while signed in, and when the session token changes, so installing the extension after the web application, or restarting the browser, needs no extra step.
- The extension verifies every handed-over session with Google and rejects one whose token is invalid or does not belong to the claimed UID.
- When the learner signs out in the web application, the web application tells the extension, which tries to save what it can and then forgets the session (FR-SYNC-009).
- If the extension is not installed or not reachable, the web application works normally and shows the extension as not connected in Profile.
- The learner's password never reaches the extension.

### FR-CAP-011 — Unsaved lines are reviewed in the web application

**Priority:** Must have (minimal)  
Invalid captures are prevented by capture-time validation (FR-CAP-012). In the exceptional case that a line cannot be saved, or lines belonging to another account are retained, Profile in the web application shall show a section, "Lines that couldn't be saved". The extension has no surface for this.

**Why a surface is necessary:** Without a way to review them, a malformed line could never be removed, and the rule that nothing is deleted silently could not be met. Only the extension can read its local storage, so the web application reads it through `getNeedsAttention` and removes lines through `discardCaptures`.

**Acceptance criteria:**
- The section appears only when a line has been quarantined as invalid, or when another account's lines are retained. It never appears in ordinary use.
- Entry points are Profile, and the "Review" link from the reminder in FR-CAP-005.
- It uses plain language ("These lines couldn't be saved to your account.") and lists each line with its text, video title, and when it was captured. It shows no counts of pending items, queue terms, or error codes.
- Own invalid lines can be removed, with a confirmation, or left alone.
- Lines owned by another account are described as waiting for that account ("These lines belong to a***@example.com and will be saved when that account signs in again."), with an explicit, confirmed **Remove these lines** action.
- Healthy pending lines are never listed and cannot be removed here.
- Nothing is removed without the learner's explicit action.

### FR-CAP-012 — Validate at capture time

**Priority:** Must have  
The content script and the service worker shall validate every capture before it is stored, so that invalid records are prevented wherever possible.

**Acceptance criteria:**
- `text` is non-empty after normalization and not longer than a documented maximum (for example 1000 characters, the same limit the Firestore rules enforce).
- `platform` is an allowed value; `videoUrl` is HTTPS on an expected host; `playbackTimeSeconds` is a finite number of at least 0; `videoId` has the expected shape when present; `sentences` is a non-empty array of strings; `uid` is present.
- A record that fails validation is not stored. The learner sees the brief message from FR-CAP-005, and developers get a console diagnostic.
- The validation constants and rules are shared with, or mirrored in, the Firestore security rules, so records valid in the extension are accepted by the server.

### FR-CAP-013 — Playback is never altered

**Priority:** Must have  
The playback state after a capture shall be the same as before the click: a playing video keeps playing and a paused video stays paused. The extension does not pause, seek, or mute.

**Acceptance criteria:**
- Verified on YouTube in normal, theatre, and full-screen modes (validation item V-5).
- If YouTube's own handling toggles playback when a caption is clicked, the extension prevents that toggle for a capture click, or restores the previous state.

### FR-CAP-014 — Legacy queue

**Priority:** Could have  
The legacy `chrome.storage.local.captures` array from earlier builds shall be ignored by the new queue and shall never be assigned to an account automatically. No learner-facing UI is required for it. A one-time developer cleanup is acceptable.

### FR-CAP-015 — Getting the extension

**Priority:** Must have  
The web application shall tell a learner who does not have the extension how to get it, in Profile under the Extension section, and nowhere else.

**Acceptance criteria:**
- The extension package is served by the site at `/scenelingo-extension.zip` as a real download, identical to the release package.
- When the extension is not connected, and the browser is Chrome-family on a computer, the section shows a **Download extension** button and four short steps (unzip, open `chrome://extensions` and turn on Developer mode, Load unpacked and choose the folder, return to the page). Other browsers and phones see a one-line note that the extension works in Chrome, Edge and Brave on a computer.
- When the extension is connected, no download or steps are shown.
- Returning to the page after installing updates the status without a button press.
- The extension has icons at the sizes Chrome needs, and the site's favicon matches.
- A Chrome Web Store listing is the long-term way to install with one click and Chrome's own consent dialog (Chrome does not allow a website to install an extension itself). It is not required for the MVP.

---

## 7. Functional requirements — capture synchronization

### FR-SYNC-001 — Direct extension-to-Firestore synchronization

**Priority:** Must have  
The extension service worker shall synchronize each capture directly to `users/{uid}/captures/{captureId}` through the Firestore REST API, authenticated with the session's Firebase ID token. Synchronization shall not depend on the web application being open, installed, or signed in at that moment.

**Acceptance criteria:**
- A capture made while the web application is closed appears in the Inbox when the web application is later opened (or immediately, if it is already open).
- Captures never travel through the web application or the messaging channel. That channel carries only the session and the review of unsaved lines (Section 5.4).
- The extension has no sign-in UI and no Firebase SDK. It acts with the session the web application handed over (FR-CAP-010).
- The Firestore Web SDK is not used in the extension.

### FR-SYNC-002 — Automatic, local-first, and invisible

**Priority:** Must have  
Every capture shall be saved in `chrome.storage.local` first and then synchronized automatically. The learner never starts, monitors, or manages synchronization.

| Situation | Behaviour |
|---|---|
| Online and authenticated | Capture locally, then synchronize automatically in the background. |
| Offline and authenticated | Keep the capture locally and retry when connectivity returns. |
| Synchronization succeeds | Remove the corresponding local copy. |
| Synchronization fails | Keep the capture and retry later. |

**Acceptance criteria:**
- Turning off the network, stopping the service worker, or closing the browser immediately after a capture does not lose the capture.
- The confirmation toast (FR-CAP-005) does not depend on the Firestore result.
- No synchronization status, progress, or result is displayed anywhere in the extension.

### FR-SYNC-003 — Delete only after confirmed synchronization

**Priority:** Must have  
The local copy of a capture shall be removed only after Firestore confirms that capture on the server (HTTP success, or confirmation that the document already exists).

**Acceptance criteria:**
- Only that capture's own `capture:<id>` key is removed (FR-CAP-006).
- A timeout, an interrupted request, or any other non-success response never causes removal.
- A new capture that arrives during a synchronization is unaffected by it.

### FR-SYNC-004 — Idempotent writes

**Priority:** Must have  
The capture `id` shall be the Firestore document ID, and each write shall be a create-only commit (precondition that the document does not exist). A retry of an already-synchronized capture must not create a duplicate and must not change any field the learner changed in the web application.

**Acceptance criteria:**
- Stopping the worker between the server's success and the local removal, then retrying, leaves exactly one Firestore document, and a capture the learner marked `processed` or `dismissed` keeps that status.
- The "already exists" response is treated as a successful synchronization, not as an error.

### FR-SYNC-005 — Automatic retry

**Priority:** Must have  
Failed synchronizations shall be retried automatically, using `chrome.alarms` with exponential backoff (for example starting near the platform alarm minimum, typically around 30 seconds, and capped at about an hour). Retries also run on a new capture, service-worker startup, browser startup, sign-in, and the browser's `online` event where available.

**Acceptance criteria:**
- Captures are never dropped after a number of failed attempts.
- Each capture has its own attempt count and next-attempt time. One failing capture does not block others.
- Retries stop for a capture only when it is synchronized or explicitly removed by the learner. Retries for authentication failures wait for sign-in.

### FR-SYNC-006 — Failure classification

**Priority:** Must have  
The sync engine shall distinguish permanent from temporary failures. None of the following is shown to the learner as a sync message; the only learner-facing effects are the sign-in prompt and the unsaved-lines section in Profile.

| Failure | Examples | Handling |
|---|---|---|
| **Network** | `fetch` rejection (offline, DNS), timeout, HTTP 503 `UNAVAILABLE`, 504 `DEADLINE_EXCEEDED`, other 5xx | Keep `pending`; retry with backoff; nothing shown. |
| **Authentication** | No session, token exchange rejected (revoked, disabled, deleted, or expired), HTTP 401 `UNAUTHENTICATED` | Keep the capture; mark the session as needing sign-in; disable new captures; the next capture click shows the sign-in message (FR-CAP-005). Resume when the web application hands over a valid session. |
| **Permission** | HTTP 403 `PERMISSION_DENIED` (rules, a disabled API, or App Check enforcement) | See "Systemic versus record-specific" below. |
| **Quota / throttling** | HTTP 429 `RESOURCE_EXHAUSTED` | Keep `pending`; back off for longer; nothing shown. |
| **Invalid data** | Local validation failure, or HTTP 400 `INVALID_ARGUMENT` | See "Systemic versus record-specific" below. |
| **Already exists** | Create precondition fails (HTTP 409 `ALREADY_EXISTS`) | Treat as synchronized; remove the local key. |
| **Unknown** | Any other error | Keep `pending`; back off; log to the console. |

**Systemic versus record-specific.** Firestore security rules report a rejected write as `PERMISSION_DENIED`, even when the cause is the content of the record, so a bad record and a configuration problem can look the same. The engine distinguishes them:
- If at least one other capture from the same account was confirmed by the server in the same run, a record rejected with `PERMISSION_DENIED` or `INVALID_ARGUMENT` is treated as **invalid** (quarantined, FR-SYNC-007).
- If no capture succeeded (or several different captures fail the same way in a row, for example three), the cause is treated as **systemic** (a rules, configuration, App Check, or extension-version mismatch). Every capture stays `pending`, retries continue slowly, and a developer diagnostic is logged. No capture is quarantined or discarded because of a systemic failure.

### FR-SYNC-007 — Invalid records

**Priority:** Must have  
A record that is found invalid (a local validation failure that slipped through, or a record-specific server rejection) shall never be silently acknowledged, deleted, or skipped, and shall never block other captures.

**Acceptance criteria:**
- It is retained under its own key with `sync.state = "invalid"` and a developer-readable reason, and is excluded from retries.
- Valid captures synchronize independently, even while invalid records exist.
- The learner is told only through the occasional reminder (FR-CAP-005) and the unsaved-lines section in Profile (FR-CAP-011), in plain language.
- Nothing removes an invalid record except an explicit, confirmed learner action.

### FR-SYNC-008 — Account ownership and account switching

**Priority:** Must have  
Captures belong to the account that captured them (Section 5.7).

**Acceptance criteria:**
- A capture made by User A never syncs under User B, including after a switch of account. The Firestore rules independently enforce the path UID.
- User A's pending captures survive the switch and wait for User A.
- User B does not get User A's captures, and the extension never assigns unowned or foreign captures to the current user.
- Lines owned by another account are shown only in Profile's "Lines that couldn't be saved" section (FR-CAP-011), in plain language, with an explicit, confirmed removal action.

### FR-SYNC-009 — Switching account and signing out

**Priority:** Must have  
Signing out and switching account happen in the web application. When the learner signs out, the web application sends `clearSession`. Before forgetting the session, the extension shall silently try to synchronize that account's pending captures within a short bounded time.

**Acceptance criteria:**
- If some captures still could not be saved, the web application tells the learner in plain language after sign-out ("Some captured lines haven't been saved yet. They'll stay safe on this computer and be saved the next time you sign in with this account.").
- After sign-out, capturing is disabled (FR-CAP-008). The remaining captures keep their owner UID and are not deleted by sign-out.
- Signing in as a different user hands that user's session to the extension. The previous user's captures are neither synced under the new user nor deleted (FR-SYNC-008).
- No sign-out or account-switching UI exists in the extension.

### FR-SYNC-010 — Dashboard reads Firestore directly

**Priority:** Must have  
The dashboard shall read captures from Firestore using a real-time listener, with no dependency on the extension.

**Acceptance criteria:**
- The Inbox works on a phone or on a computer without the extension.
- The Inbox shows new captures without a manual reload.
- The Inbox explains that captures made while the extension was offline appear after the extension has synchronized them.

---

## 8. Functional requirements — Capture Inbox, segmentation, and selection

### FR-INB-001 — Capture Inbox list

**Priority:** Must have  
The dashboard shall list captures from Firestore, newest first, with the cue text, video title, platform, capture time, and status. Filters: **New**, **Processed**, **Dismissed**, and optionally by video.

**Acceptance criteria:**
- A header summarizes captures (for example "Today's captures — 8").
- Each row has an **Explore** action and a **Dismiss** action; the video title links to the source at the captured time where a URL is available.
- New captures synchronized by the extension appear in the list in real time, without a manual reload and without the dashboard having been open when they were captured.

### FR-INB-002 — Capture status lifecycle

**Priority:** Must have  
Each capture has a status: `new`, `processed`, or `dismissed`.
- A capture becomes `processed` when the learner saves at least one learning item from it. It stays openable so more items can be saved from the same cue.
- **Dismiss** sets `dismissed`; **Restore** returns it to `new`.
- **Delete** removes the capture permanently, after confirmation.
- Processing or dismissing a capture never deletes saved learning cards.

### FR-INB-003 — Editable cue text

**Priority:** Must have  
Before exploring, the learner may edit the capture text. YouTube cues often split a sentence across several cues, so the learner must be able to correct or complete the text. The edited text becomes the `sourceSentence` of any item saved from it. The original captured text is retained on the capture document.

### FR-SEG-001 — Sentence segmentation

**Priority:** Must have  
The dashboard shall segment each capture's text into sentence units using `Intl.Segmenter` with `granularity: "sentence"` for English when available.

**Acceptance criteria:**
- A capture containing multiple sentences is shown as separate selectable sentences.
- Punctuation stays with its sentence.
- Abbreviations and common punctuation cases are not split using a naive `text.split('.')` implementation.
- If `Intl.Segmenter` is unavailable, the app uses a documented fallback and the learner can edit the selected text before saving.
- The extension also segments sentences at capture time (FR-CAP-004). The dashboard uses the stored `sentences` when the text is unedited and re-segments when the learner edits the text.

### FR-SEG-002 — Word segmentation

**Priority:** Must have  
The dashboard shall segment each sentence using `Intl.Segmenter` with `granularity: "word"` and `isWordLike` to identify selectable word tokens.

**Acceptance criteria:**
- Punctuation and whitespace are not presented as vocabulary tokens.
- Contractions such as `we're` are a single selectable unit where the browser segmenter returns them that way.
- The original sentence remains available for contextual analysis.
- Word-level segmentation is performed where selectable word tokens are shown (the dashboard Explore view). The extension has no selection interface and does not store word tokens.

### FR-SEL-001 — Select a single word

**Priority:** Must have  
The learner can click (or tap) an individual word in a displayed sentence.

### FR-SEL-002 — Select a phrase or multi-word expression

**Priority:** Must have  
The learner can select consecutive words by drag selection on desktop, and by an equivalent touch interaction on mobile (for example tap the first word, then tap the last word).

**Acceptance criteria:**
- The selected phrase is captured exactly, excluding unrelated neighbouring words.
- Punctuation is cleaned only at the edges where appropriate; internal punctuation is preserved.
- The complete sentence is retained as the source context.

### FR-SEL-003 — Select a complete sentence

**Priority:** Must have  
The learner can select the whole sentence as a learning item.

### FR-SEL-004 — Explicit save

**Priority:** Must have  
Capturing a subtitle puts it in the Capture Inbox, which is a staging area. An item is added to **My Collection** only after the learner presses **Save**. Opening or exploring a capture never creates a collection item by itself.

### FR-SEL-005 — Preserve context separately from the selected text

**Priority:** Must have  
The application shall distinguish:
- `selectedText`: the exact word, phrase, or sentence the learner wants to learn.
- `sourceSentence`: the complete sentence containing the selection.
- `contextBefore` and `contextAfter`: optional adjacent sentences supplied to the AI for interpretation when available. For the MVP these come only from the other sentences of the same capture. Optionally, the learner's own other captures from the same video within a short time window may be offered as context.

Adjacent context is transient by default and is not saved to the learning card. The saved item stores the selected text and source sentence, not subtitle history.

---

## 9. Functional requirements — AI learning card

AI runs only in the dashboard, only after a learner action on a specific capture. There is no background or batch AI generation.

### FR-AI-001 — Generate a contextual English learning card

**Priority:** Must have  
When a learner selects a word, phrase, or sentence in Explore and presses **Explain**, SceneLingo shall send the selected text and relevant context to Firebase AI Logic.

**Required prompt inputs:**
- Selected text.
- Selection kind (`word`, `phrase`, or `sentence`).
- Complete source sentence.
- Previous and next sentence, if available.
- Instruction to interpret the selected text in the supplied context and not invent plot details.

**Required output fields:**
- `category`: one of `vocabulary`, `idiom`, `slang`, `expression`.
- `meaningEn`: concise plain-English definition.
- `contextualMeaningEn`: what the selected text means in this subtitle context.
- `partOfSpeech`: nullable; primarily useful for single-word vocabulary.
- `synonyms`: four to six relevant English synonyms or alternatives (fewer only when there are no more that fit).
- `exampleSentences`: three or four natural English examples in different situations, not copied from the source subtitle.
- `usageNote`: optional short note explaining register, formality, or typical use.
- `confidenceNote`: optional caution when the context is insufficient or the phrase is ambiguous.

**Acceptance criteria:**
- The model is not asked to provide unrelated dictionary entries.
- Synonyms are contextually appropriate; if no good synonym exists, an empty list is acceptable.
- For idioms, the explanation describes the idiomatic meaning rather than translating each word literally.
- For a complete sentence, the system explains the sentence's useful expression or overall meaning and does not force an arbitrary single-word part of speech.
- The UI validates and safely renders the response before displaying it.

### FR-AI-002 — Classify learning type

**Priority:** Must have  
The AI shall classify the selected item into exactly one primary category: `vocabulary`, `idiom`, `slang`, or `expression`. The category is shown as a label and is not edited by the learner. This category is independent from `selectionKind` (`word`, `phrase`, or `sentence`).

### FR-AI-003 — Use structured output

**Priority:** Must have  
The English learning-card request shall use Firebase AI Logic structured output / JSON schema.

**Acceptance criteria:**
- The schema is configured for both on-device and cloud inference paths.
- The response is parsed and validated against the application schema.
- Invalid or incomplete output is handled with a retry/error state and is never silently saved as a valid card.

### FR-AI-004 — On-device-first English explanation

**Priority:** Must have  
The English learning-card request shall use Firebase AI Logic `PREFER_ON_DEVICE` mode, targeting the Gemini Nano on-device experience specified by the hackathon through the Chrome Prompt API integration. The implementation shall use the model made available by the supported Chrome Prompt API rather than assuming a model file or device model name can be hard-coded. (The model generation named in the hackathon material should be re-verified against the current documentation.)

**Expected behaviour:**
- If the supported Chrome desktop on-device model is ready and supports the request, generate the card locally.
- If the model is unavailable, not downloaded, or the request cannot be handled locally, allow Firebase AI Logic to fall back to the configured cloud model.
- Read the actual response `inferenceSource` and show `On-device` or `Cloud` in the UI.

**Acceptance criteria:**
- The application does not fake or infer the inference source from device capability; it reads the SDK response metadata.
- The UI remains usable when local inference is unavailable.
- The local model download starts only after a user interaction (pressing **Explain**) and never blocks the learner: while the model is not ready, the request is answered by the cloud.
- On browsers where the SDK cannot use the Prompt API (for example mobile browsers), the app either relies on the SDK's cloud fallback or explicitly selects `ONLY_IN_CLOUD`, whichever the SDK requires; this must be verified on a phone browser.

### FR-AI-005 — On-device model readiness, consent, and fallback

**Priority:** Must have  
The web application shall use Firebase JavaScript SDK v12.5.0 or later for Web hybrid inference. The SDK uses the Chrome Prompt API when the on-device model is ready, and answers from the cloud whenever it is not (not downloaded, still downloading, unsupported language or device, or no Prompt API in the browser). The learner is never blocked waiting for a download, and the card always shows where it was produced.

**Consent and download:**
- The model is several GB, so it is downloaded only after the learner says yes. The app never starts the download by itself.
- After a card is generated, and only if this device could run the model but does not have it, a one-line prompt inside the card asks "Make cards faster and private on this device?" with **Download** and **Not now**. It never appears on phones, on unsupported devices, or where the model is already installed.
- **Download** starts the download from that click. While it runs the prompt shows progress, cards keep working in the cloud, and when it finishes the prompt says later cards run on this device. The session Chrome opens for the download is released straight away.
- **Not now** hides the prompt for good on this device (the choice is stored on the device, not in the account).
- Profile has an **On-device model** section, shown only where the model could run, so a learner who chose Not now (or who skipped the prompt) can download later. It shows the state: download, downloading, or ready.
- Where the translation language is supported on-device but the model is not downloaded yet, the language picker says "On this device once downloaded" and the cloud answers meanwhile.

**Memory:** The model is loaded into memory only when the learner presses Explain or Translate (the SDK opens a session then). Starting the app, opening pages, and checking availability load nothing.

**Failure fallback:** If the on-device model reports ready and then fails while running, or its answer is not usable (invalid card or translation), the request is repeated once in the cloud and the card is labelled Cloud. Errors returned by the cloud service itself are not repeated.

**Acceptance criteria:**
- Explain works whether or not the browser supports the Prompt API (phones, other browsers, unsupported hardware): it falls back to the cloud.
- The UI does not imply that on-device inference is available to every user.
- A request that takes longer than usual shows a plain notice with a Cancel action. A failed request shows a message with a Try again action.

### FR-AI-006 — Translation and explanation in the learner's language

**Priority:** Must have  
The learner shall be able to request a translation and explanation, in their chosen language, for a newly generated or a saved learning card. The learner chooses their language in Profile (FR-LIB-010) and may pick a different language for a single request.

**Translation inputs:**
- Selected text.
- Selection kind and category.
- Source sentence.
- English contextual meaning.
- Target language (BCP-47 code).
- Instruction to translate the intended contextual meaning, not merely perform literal word-for-word translation.

**Required output:**
- `translation`: natural translation of the selected text in the target language.
- `explanation`: short explanation in the target language where a direct translation is insufficient, especially for idioms and slang.
- `literalMeaningNote`: optional, only when a literal reading helps explain the expression.

**Acceptance criteria:**
- Translation is generated only when the learner requests it. There is no automatic translation.
- Idioms and slang receive a natural equivalent or explanation in the target language; the model must not present a misleading literal translation as the idiomatic meaning.
- Text is displayed with the correct direction and font for the language (FR-AI-012).
- Each translation is stored on the card under its language, with the inference source that produced it (Section 14.3), so changing language later does not discard earlier translations.
- If the learner's language is English, no translation action is shown.

### FR-AI-007 — Per-language routing: on-device when supported, cloud otherwise

**Priority:** Must have  
The translation request shall use Firebase AI Logic with a mode chosen from the target language:

| Target language | Mode | Behaviour |
|---|---|---|
| Supported by the on-device model on this device (FR-AI-011) | `PREFER_ON_DEVICE`, with `onDeviceParams.createOptions.expectedOutputs` set to that language | Runs locally. If the local model is unavailable, still downloading, or the local request fails, the SDK falls back to the cloud model. |
| Not supported on-device, not yet probed, or the browser has no Prompt API (for example phones) | `ONLY_IN_CLOUD` | The on-device model is never asked for an output language it does not support. |

**Reason:** The Chrome Prompt API accepts only a short list of languages today (`en`, `ja`, `es`, `de`, `fr`, with more in development), and asking it for any other output language raises an error or gives poor output. The set can change with Chrome and device, so it is probed at runtime and never hard-coded as the source of truth.

**Acceptance criteria:**
- The routing decision is made in one place, from the probe result (FR-AI-011), and covered by tests.
- The UI shows the source reported by the SDK for each translation (**On-device** or **Cloud**), not the source that was expected.
- The request uses Firebase AI Logic, not an unrelated direct Gemini API key or custom model endpoint.
- If the cloud is needed and there is no internet connection, or the request fails, the UI shows a retry/connectivity message. If the language runs on-device and the model is ready, translation works offline.
- A previously saved translation remains viewable offline.
- A language that was supported on-device on one device but reports `unavailable` on another is routed to the cloud on the second device without any learner action.

### FR-AI-009 — Context sufficiency and uncertainty

**Priority:** Must have  
If the supplied subtitle context is insufficient to disambiguate a word or phrase, the AI shall state that the meaning may depend on additional context rather than confidently inventing a scene interpretation.

### FR-AI-011 — Language catalog and on-device support detection

**Priority:** Must have  
The application shall offer a catalog of languages for the learner to choose from, and shall detect at runtime which of them the on-device model supports on the current device.

**Acceptance criteria:**
- The catalog contains the languages the cloud model supports well, with each language's English name, its own name, a BCP-47 code, and its text direction. It is a data file, so languages can be added without code changes.
- On desktop Chrome, the app probes the Prompt API once per session (after sign-in, no user gesture needed for the availability check) by asking `LanguageModel.availability` with English input and the candidate output language. `available`, `downloadable`, and `downloading` mean the language is on-device capable; `unavailable` or an error means cloud.
- Probe results are cached for the session and exposed to the language picker and to the routing function.
- The language picker shows, for each language, whether it runs **On this device** or **In the cloud** on the learner's current browser. The wording is plain and does not rely on colour alone.
- Where the Prompt API does not exist (other browsers, phones), every language shows **In the cloud**, and no probe is attempted.
- The documented list (`en`, `ja`, `es`, `de`, `fr`) may seed the display before the probe finishes but never decides routing by itself.
- Starting a model download happens only after a learner action (FR-AI-004).

### FR-AI-012 — Language direction and script rendering

**Priority:** Must have  
Every translation block shall be rendered with the direction of its language (`dir="rtl"` for Arabic, Urdu, Persian, Hebrew, and any other right-to-left language in the catalog) and the language's `lang` attribute, so browsers pick suitable fonts. English and translated sections must be visually distinguishable without relying on colour alone.

---

## 10. Functional requirements — My Collection

### FR-LIB-001 — Save a learning item

**Priority:** Must have  
The learner shall be able to save a generated learning card to their authenticated personal collection from Explore. Saving records the originating capture, links it to the card, and marks the capture `processed` (FR-INB-002).

### FR-LIB-002 — Avoid accidental duplicates

**Priority:** Must have  
A learning card is identified by its **normalized selected text + normalized source sentence**, within the current user's collection. The AI-assigned category is **not** part of the identity.

**Normalization** (applied identically to the extension, dashboard, and tests): Unicode NFKC, lower-casing, collapsing runs of whitespace, trimming edge punctuation and whitespace. The normalized forms are stored as `normalizedText` and `normalizedSourceSentence`.

**Acceptance criteria:**
- Saving "Getting ahead of ourselves" classified first as an `idiom` and later as an `expression`, with the same source sentence, does not create a second card. The learner is offered the existing card, which keeps its original category.
- The same selected text with a different source sentence creates a separate contextual card.
- The same selected text and source sentence captured from a different video is treated as the same card (the identity above), and the existing card opens. The first source is kept.
- The check is enforced at the data level, not only in the UI. The recommended mechanism is a deterministic card ID derived from the identity (for example a hash), written with a create-if-absent operation, so two devices racing to save the same card cannot create duplicates.

### FR-LIB-003 — Browse and search

**Priority:** Must have  
The learner shall be able to view saved items in a searchable collection.

### FR-LIB-004 — Filter by category

**Priority:** Must have  
The collection shall support filters for vocabulary, idioms, slang, and expressions.

### FR-LIB-005 — View learning-card details

**Priority:** Must have  
The detail view shall show selected text, category, English meaning, contextual meaning, synonyms, examples, translations when available, source sentence, media title with a link to the source moment, and saved date.

### FR-LIB-006 — Delete

**Priority:** Must have  
The learner shall be able to delete their own saved cards. Deletion requires a confirmation step or provides an undo opportunity. Deleting a card returns nothing to the Inbox and does not delete the originating capture. Saved cards are not edited: the type is the one assigned when the card was created, and the learner deletes a card to replace it.

### FR-LIB-007 — Firebase Authentication

**Priority:** Must have  
The web application shall authenticate users with Firebase Email/Password. A signed-in user sees the same captures and cards on every device.

**Acceptance criteria:**
- Sign-up, sign-in, sign-out, and password reset work in the web application, with plain-language errors.
- Signing in, signing out, and a changed session token are passed to the extension (FR-CAP-010).
- The web application works fully without the extension installed.

### FR-LIB-008 — Firestore synchronization

**Priority:** Must have  
Captures, saved items, and practice progress are stored in Cloud Firestore.

**Acceptance criteria:**
- An item saved on one device appears on another when online.
- An edit or deletion on one device is reflected on the other.
- The UI shows a pending/synced state where useful.
- Firestore security rules restrict reads and writes to the authenticated owner.

### FR-LIB-009 — Offline access

**Priority:** Should have  
The dashboard should use Firestore web offline persistence (multi-tab) so previously loaded captures and cards remain readable offline, and practice results are queued and synchronized when connectivity returns.

**Acceptance criteria:**
- Previously loaded cards remain readable offline.
- New AI generation, and translation into a language that runs in the cloud, clearly indicate that internet access is required when not cached.
- Synchronizing captures from the extension requires connectivity; offline, they simply remain in the extension queue.

### FR-LIB-010 — User settings

**Priority:** Should have  
The learner sets one preference:
- Native/support language (`nativeLanguage`): chosen by the learner from the catalog (FR-AI-011). There is no default: the learner picks their language from the list, and can change it at any time, and earlier translations are kept.

---

## 11. Functional requirements — Practice and Progress

### FR-HOME-001 — Home screen

**Priority:** Removed  
There is no Home screen. The application opens on the Inbox, which already shows what is new, and "Due now" lives on the Practice page. Unknown addresses (including `/`) lead to the Inbox.

### FR-PRA-001 — Flashcards

**Priority:** Must have  
The learner shall be able to practise saved items using flashcards.

**Card flow:**
- Front: the question "What does this mean?" and the selected word, phrase, or sentence.
- The learner thinks of the meaning and presses **Reveal answer** (or Space, or clicks the card).
- Back: the type, English meaning, contextual meaning, the translation in the learner's language if saved, all synonyms, all examples, and the original subtitle with the saved text emphasised, the video title, and a link to the moment in the video.
- The learner marks the card **Still learning** or **Got it** (keys 1 and 2, or the arrow keys). Each button shows when the card will come back (FR-PRA-007). The buttons appear only after the reveal. Two buttons are used on purpose: a finer scale only changes the next date and would slow the learner down on every card.
- A card is shown once per session. A card marked **Got it** or **Still learning** is not shown again until its next date arrives (FR-PRA-007), neither later in the same session nor in another practice mode.
- A session holds up to 20 cards. Of the 20 slots, 13 (65%) go to **overdue** cards, the most overdue first, and 7 (35%) go to **new** cards that have never been answered. A side with fewer cards than its share hands the spare slots to the other side, and a session is not padded with cards that are not due. The cards are shuffled so old and new come in mixed order. The Practice page shows the true number due and offers "Start next 20" when more than 20 are due.
- Flashcards, Reverse flashcards, and Quiz only use cards that are **due**. When nothing is due the screen says "Nothing due" and offers **Study anyway**.
- **Study anyway** and **Review mistakes** are practice only: the answers are recorded in the review history and the card's statistics, but the card keeps its date.

### FR-PRA-002 — Reverse flashcards

**Priority:** Could have  
A **Reverse flashcards** mode shows the meaning first ("Which word or expression means this?") and the learner recalls the term. The back shows the term and the same details as FR-PRA-001. It uses the same two buttons and the same rules as FR-PRA-001. Cards that are whole sentences are left out. 

### FR-PRA-003 — Quiz

**Priority:** Must have  
One **Quiz** mode builds up to ten multiple-choice questions about the learner's due cards (all cards under Study anyway), with the wrong options taken from all saved cards. A right answer counts as Got it and a wrong answer as Still learning, so the card moves on the ladder as in FR-PRA-007. It needs at least four saved cards, and says how many more are needed when there are fewer. Each question uses one of three formats, in turn:
- **Guess the meaning:** the term (with its subtitle) is shown and the learner picks its meaning.
- **Complete the sentence:** the saved subtitle is shown with the term blanked out and the learner picks the expression that fits.
- **Contextual:** the subtitle is shown with the term highlighted and the learner picks what it means in that scene.

**Acceptance criteria:**
- A card whose subtitle does not contain the saved text, or that is a whole sentence, gets the "guess the meaning" format instead of a misleading blank.
- Wrong options are taken from the learner's other cards; they are never presented as definitions. No AI call is made during a quiz.
- After each answer the learner sees whether it was right, the term's meaning, and its meaning in the scene.

### FR-PRA-004 — Practice hub

**Priority:** Must have  
Practice offers Flashcards, Reverse flashcards, Quiz, and Review mistakes, plus a single "Due now" action.

**Practising one type:** When the learner has cards in at least two categories (vocabulary, idiom, slang, expression), a row of buttons appears above the Due now banner: **All** (the default) and one button for each category the learner has cards in, each showing how many cards of that category are due. A category with nothing due stays visible but dimmed, with a count of 0. Choosing a category limits the Due now banner, Flashcards, Reverse flashcards, Quiz, and Review mistakes to cards of that category; the 65/35 mix and the 20-card cap apply inside it. The choice is kept in the address (`?cat=`) so Back and Close return to it, and it is not remembered between visits. When nothing is due in the chosen category the screen says "Nothing due in Slang" and offers Study anyway within that category. The schedule stays one per card, never per category. Quiz questions are about the chosen category's cards, and their wrong options come from the same category first and from the other categories only to fill up. With a single category the row is not shown. Options that cannot run yet say why (for example "Save 2 more to unlock").

### FR-PRA-005 — Track outcomes and review events

**Priority:** Must have  
Every practice attempt shall create a review event in `users/{uid}/reviewEvents/{eventId}` and update the card's current learning statistics in `learningCards/{cardId}.review`, consistently.

**Each review event contains:**
- `cardId`
- practice `mode` (`flashcard`, `reverse`, `quiz`, `mistakes`)
- `result` (`correct` or `incorrect`)
- `rating` (`again` for Still learning or a wrong quiz answer, `good` for Got it or a right one)
- `reviewedAt` (the time of the answer, recorded on the client so offline practice keeps its real time)

**Acceptance criteria:**
- The event write and the card-statistics update succeed or fail together, using a single Firestore batch (works offline and queues) or a transaction (online only). A partial update, such as an event with no counter change or the reverse, must not occur.
- Card statistics (`attemptCount`, `correctCount`, `incorrectCount`, `lastResult`, `lastReviewedAt`, `nextReviewAt`, `reviewStage`) describe the current state. Events describe history. Both are kept; neither replaces the other.
- Progress and revision history are computed from `reviewEvents`, not inferred from the current card state.
- Review events are create-only for the learner (not editable).
- Deleting a card does not require deleting its events. The Progress views handle events whose card no longer exists.

### FR-PRA-006 — Review mistakes

**Priority:** Must have  
A **Review mistakes** mode, inside Practice, lists the cards whose last answer was wrong or **Still learning**, the ones missed most often first, as flashcards. It records new outcomes the same way as other practice.

### FR-PRA-007 — Simple spaced review

**Priority:** Must have  
Each card sits on a ladder of steps, and each step has a wait: step 0 is 1 day, then 3, 7, 14, 30, and 60 days. A new card starts on step 0.
- **Got it:** one step up (never past the top). A new card comes back in 3 days.
- **Still learning:** one step down (never below step 0). The card comes back after the wait of the step it lands on, so a card that had climbed far returns later than one that was new: a card on step 3 (14 days) returns in 7 days, a card on step 1 or 0 returns tomorrow. A missed card is never due on the same day.

Each button shows its result ("Tomorrow", "3 days", "1 month"). Every answer to a due card, in any mode, moves the card by the same rule; practice-only sessions do not. The rule is deterministic and does not reproduce full SM-2.

### FR-PRA-008 — Practice on small screens

**Priority:** Must have  
All practice modes must be fully usable on a phone-sized screen with touch input.

### FR-PRA-009 — Session summary

**Priority:** Should have  
After a practice session, show the number attempted, remembered, incorrect, and due for review, derived from saved cards and review events (never generated by AI).

### FR-PRO-001 — Progress statistics

**Priority:** Should have  
The Progress section shall show learning statistics derived from Firestore data (review statistics come from `reviewEvents`, not only from the current state of each card): items saved over time, items by category, review accuracy, current streak, and a 14-day chart. It shows nothing else: no activity feed and no lists of cards.

### FR-PRO-002 — Revision history

**Priority:** Removed  
A list of recent review events was dropped to keep Progress uncluttered. The events are still stored, and the totals and chart are computed from them.

---

## 12. On-device AI vs cloud AI decision matrix

This section is an implementation decision, not merely a conceptual distinction.

| Task | Execution | Firebase AI Logic mode | Notes |
|---|---|---|---|
| DOM subtitle capture | Extension content script | No AI | Existing tested implementation |
| Capture queue and delivery | Extension service worker: one `chrome.storage.local` key per capture, then direct Firestore REST sync | No AI | Local-first, retried, idempotent, invisible |
| Sentence segmentation (at capture) and word segmentation (at Explore) | Shared `Intl.Segmenter` module in extension and dashboard | No AI | Deterministic |
| Select word/phrase/sentence | Dashboard UI | No AI | Click, drag, or touch selection |
| Core English learning card | Gemini Nano on desktop Chrome where available; cloud fallback | `PREFER_ON_DEVICE` | One request, single-turn, structured JSON |
| Category classification | Same core card request | `PREFER_ON_DEVICE` | Enum category in schema |
| English definition / contextual meaning | Same core card request | `PREFER_ON_DEVICE` | Simple English, concise |
| English synonyms and examples | Same core card request | `PREFER_ON_DEVICE` | 4–6 synonyms; 3–4 examples |
| Translation into the learner's language | Gemini Nano on desktop Chrome when the language is supported on-device; cloud otherwise | `PREFER_ON_DEVICE` for supported languages, `ONLY_IN_CLOUD` for the rest | Support is probed at runtime (FR-AI-011); the SDK-reported source is displayed |
| Idiom/slang explanation in the learner's language | Same routing as translation | Same | Natural contextual wording, not literal-only |
| Flashcards, reveal, quiz assembly | Dashboard logic | No AI | Uses stored card fields |
| Review scheduling and progress | Dashboard logic | No AI | Deterministic intervals |
| Inbox, collection, practice storage | Cloud Firestore | No AI | Authenticated user data |
| AI requests from a phone browser | Firebase cloud model | Cloud inference | Mobile Chrome does not support the desktop Prompt API local model |

### 12.1 Why the core English card is hybrid

The learner's most frequent action is understanding an English word or expression. The request is short, text-only, and naturally fits a one-shot structured response. Firebase AI Logic web hybrid inference supports single-turn text generation and structured output on both supported on-device and cloud paths. `PREFER_ON_DEVICE` lets the dashboard use Gemini Nano when available and fall back to a cloud-hosted model otherwise. Because the dashboard is a top-level browser window, it meets the Prompt API requirement that a document, not an embedded cross-origin frame or a worker, makes the call.

### 12.2 Why translation is routed per language

The Chrome Prompt API documentation currently lists `en`, `ja`, `es`, `de`, and `fr` as the supported input/output languages and says more are in development. A learner may choose any language, so the application does not pick one mode for all of them:

- If the on-device model supports the learner's language on this device, the request uses `PREFER_ON_DEVICE` and keeps working offline once the model is ready, with the cloud as a fallback.
- Otherwise the request uses `ONLY_IN_CLOUD`, so an unsupported language is never sent to the local model.

The supported set depends on the Chrome version and device, so it is detected at runtime (FR-AI-011) and re-detected each session. This is a deliberate product-quality and compatibility decision. For example, Urdu is not listed today, so it runs in the cloud; if Chrome adds it later, it switches to on-device automatically with no change to the application.

### 12.3 Why practice does not need an AI request

Flashcards, reveal flows, cloze questions, quiz scoring, review history, and scheduling can all be derived from saved learning cards. Running an LLM for every review would add latency, cost, and failure points without improving the core interaction. AI creates and enriches learning content; deterministic application logic practises and measures recall.

### 12.4 Mobile inference boundary

The dashboard works on phones for browsing, practice, and cloud-based explanation. It does not claim Gemini Nano on mobile. New generation requests from a mobile browser use cloud inference; the inference badge shows the source reported by the SDK.

---

## 13. AI response contracts

### 13.1 English learning-card JSON contract

The exact Firebase response schema should be defined in code and aligned across on-device and cloud generation parameters.

```json
{
  "category": "idiom",
  "meaningEn": "To move too quickly or assume something will happen before it is certain.",
  "contextualMeaningEn": "The speaker thinks the other person is making plans or conclusions too early.",
  "partOfSpeech": null,
  "synonyms": [
    "assume too much too soon",
    "move too quickly"
  ],
  "exampleSentences": [
    "Let's not get ahead of ourselves before we receive the results."
  ],
  "usageNote": "Common conversational expression; often used to suggest patience.",
  "confidenceNote": null
}
```

Required implementation validations:
- `category` must match the four allowed category values.
- `meaningEn` and `contextualMeaningEn` must be non-empty strings.
- `synonyms` must be an array with no more than three items.
- `exampleSentences` must contain one or two examples for a successful card.
- Nullable fields must be handled without crashing the UI.
- The source sentence and selected text are stored separately from the generated explanation.

### 13.2 Translation JSON contract

The same contract is used for every language. The request carries the target language; the response carries only the translated content.

```json
{
  "translation": "Estamos sacando conclusiones demasiado pronto.",
  "explanation": "Significa que alguien está planeando o decidiendo algo antes de tiempo.",
  "literalMeaningNote": null
}
```

For a right-to-left language the same fields hold text in that language. For example, with Urdu the `translation` would be natural Urdu in Urdu script. The example illustrates the schema only; wording varies with context. The application stores the target language code, the inference source, and the prompt version next to this content (Section 14.3), and renders each block with the direction and `lang` of its language.

Required validations: `translation` is a non-empty string; `explanation` is a string or null; `literalMeaningNote` is a string or null; all are length-limited before display or storage.

### 13.3 Prompt quality requirements

Prompts shall instruct the model to:
- Use only the selected expression and supplied subtitle context as evidence for contextual interpretation.
- Avoid inventing plot information, character intentions, or facts not present in the supplied text.
- Use simple, plain English.
- Distinguish literal and idiomatic meaning where relevant.
- Provide synonyms only when they are genuinely close in the supplied context.
- Create original example sentences rather than copying the source subtitle.
- Write in the requested target language and its standard script; prefer natural equivalents for idioms and slang, and explain when no exact equivalent exists.
- Return only the required structured fields.

---

## 14. Data model

The following is the recommended Firestore structure. Field names may be adapted during implementation, but the meaning and ownership boundaries must remain stable.

### 14.1 `users/{uid}`

```json
{
  "displayName": "Learner",
  "email": "user@example.com",
  "createdAt": "server timestamp",
  "updatedAt": "server timestamp"
}
```

The profile is created once, by the web application on first sign-in. Creation must be safe to repeat.

### 14.2 `users/{uid}/captures/{captureId}` (Capture Inbox)

`captureId` is the ID generated by the extension service worker.

```json
{
  "ownerUid": "FIREBASE_UID",
  "text": "I think we're getting ahead of ourselves.",
  "sentences": ["I think we're getting ahead of ourselves."],
  "editedText": null,
  "platform": "youtube",
  "videoId": "VIDEO_ID",
  "videoTitle": "Video title",
  "videoUrl": "https://www.youtube.com/watch?v=VIDEO_ID&t=125s",
  "playbackTimeSeconds": 125.4,
  "subtitleLanguage": null,
  "capturedAt": "timestamp from the extension capture time",
  "syncedAt": "server timestamp",
  "status": "new",
  "savedCardIds": [],
  "schemaVersion": 1
}
```

Notes:
- `ownerUid` must equal the UID in the path; the security rules enforce this.
- `status` is `new`, `processed`, or `dismissed`. The extension creates documents with `new`; only the dashboard changes it afterwards.
- `text` is the original capture and is not modified. Learner corrections go in `editedText`.
- `capturedAt` is the extension's clock and may be inaccurate; `syncedAt` is the server's.
- Only learner-clicked cues are stored. No transcript and no adjacent subtitle history.

### 14.3 `users/{uid}/learningCards/{cardId}`

`cardId` is a deterministic ID derived from `normalizedText` + `normalizedSourceSentence` (FR-LIB-002), or an equivalent create-if-absent duplicate guard.

```json
{
  "selectedText": "getting ahead of ourselves",
  "normalizedText": "getting ahead of ourselves",
  "normalizedSourceSentence": "i think we're getting ahead of ourselves.",
  "selectionKind": "phrase",
  "selectionStart": 13,
  "selectionEnd": 39,
  "category": "idiom",
  "partOfSpeech": null,
  "meaningEn": "To move too quickly or assume something will happen before it is certain.",
  "contextualMeaningEn": "The speaker thinks the other person is making plans too early.",
  "synonyms": ["assume too much too soon", "move too quickly"],
  "exampleSentences": ["Let's not get ahead of ourselves before the results arrive."],
  "usageNote": "Common conversational expression.",
  "translations": {
    "ur": {
      "translation": "ہم ابھی بہت جلدی نتیجہ اخذ کر رہے ہیں۔",
      "explanation": "اس کا مطلب ہے کہ کوئی شخص وقت سے پہلے منصوبہ بندی یا فیصلہ کر رہا ہے۔",
      "literalMeaningNote": null,
      "inferenceSource": "IN_CLOUD",
      "promptVersion": "1.0",
      "createdAt": "server timestamp"
    }
  },
  "source": {
    "platform": "youtube",
    "videoId": "VIDEO_ID",
    "videoTitle": "Video title",
    "videoUrl": "https://www.youtube.com/watch?v=VIDEO_ID&t=125s",
    "playbackTimeSeconds": 125.4,
    "subtitleLanguage": null,
    "captureId": "6f1c1c1e-6d9e-4d1e-9a52-5f3b8e1d0c11"
  },
  "sourceSentence": "I think we're getting ahead of ourselves.",
  "createdAt": "server timestamp",
  "updatedAt": "server timestamp",
  "ai": {
    "englishInferenceSource": "ON_DEVICE",
    "englishPromptVersion": "1.0",
    "translationPromptVersion": "1.0"
  },
  "review": {
    "attemptCount": 0,
    "correctCount": 0,
    "incorrectCount": 0,
    "lastResult": null,
    "lastReviewedAt": null,
    "nextReviewAt": null,
    "reviewStage": 0
  }
}
```

Notes:
- `category` is the type the AI assigned. It is not part of the card identity, and it is not edited afterwards.
- `review` holds the **current** learning statistics for scheduling and the Practice view. History lives in `reviewEvents`.
- `englishInferenceSource` is `ON_DEVICE` or `IN_CLOUD`, taken from the actual Firebase AI Logic response.
- `selectionStart` / `selectionEnd` are character offsets within `sourceSentence`, used to build reliable cloze questions. They are nullable.
- `source.platform` is `youtube` or `netflix`; `videoId` and `captureId` are nullable.
- `translations` is a map keyed by language code, one entry per language the learner has translated into. Keys use the BCP-47 code with `-` replaced by `_` (for example `pt_BR`) so they are valid field paths. Each entry records the SDK-reported `inferenceSource` for that translation. A card with no translation yet has no `translations` entry.
- Do not store full transcript history or a full subtitle track.

### 14.4 `users/{uid}/settings/preferences`

`nativeLanguage` (BCP-47 code chosen by the learner, for example `ur`, `es`, `pt-BR`). This document is the single source for this preference.

### 14.5 `users/{uid}/reviewEvents/{eventId}` (required)

```json
{
  "cardId": "CARD_ID",
  "mode": "flashcard",
  "result": "incorrect",
  "rating": "again",
  "reviewedAt": "client timestamp of the answer",
  "responseTimeMs": 4200,
  "createdAt": "server timestamp"
}
```

- `mode` is `flashcard`, `reverse`, `quiz`, or `mistakes`. `result` is `correct` or `incorrect`. `rating` is `again` or `good`.
- `rating`, `responseTimeMs`, and `createdAt` are optional.
- Written in the same atomic operation as the card's `review` update (FR-PRA-005). Events are create-only.

### 14.6 Extension local queue (not Firestore)

`chrome.storage.local` holds one key per pending capture (`capture:<id>`, Section 5.5), plus a few small `meta:` keys: the session handed over by the web application, an authentication-state flag, and reminder and first-run markers. Nothing else from the learning data is stored in the extension.

---

## 15. Key user flows

### 15.1 First-time setup

1. Learner installs the extension. The web application opens once in a new tab.
2. The learner creates an account (or signs in) in the web application.
3. The web application hands the session to the extension automatically. There is no second sign-in. Capturing is now enabled.
4. If the learner already had an account and installed the extension later, the next time the web application is open (or the toolbar icon opens it) the session is handed over without any step. Until then, clicking a subtitle shows the brief sign-in message with a link to the web application.

### 15.2 Capture while watching

The extension shows nothing during normal viewing.

1. Learner opens a YouTube video and enables English subtitles.
2. Learner clicks a subtitle line that contains something interesting.
3. The content script reads the rendered subtitle, records `currentTime` and video metadata, and sends the capture to the service worker.
4. The service worker stamps the capture with the learner's UID, stores it under `capture:<id>`, and replies. The toast "Subtitle captured ✓" appears and the video keeps playing.
5. In the background and without any visible sign, the service worker creates the capture in Firestore through the REST API. On server success it removes that one local key. On failure, the capture stays queued and is retried later.

### 15.3 Review the Inbox

1. Learner opens the dashboard, now or later, on any device, and signs in.
2. The Capture Inbox shows the learner's captures in real time, with no step that needs the extension.
3. If the learner was offline when capturing, those captures appear after the extension synchronizes them.

### 15.4 Explore and save an English expression

1. In the Inbox the learner presses **Explore** on a capture.
2. The dashboard shows the cue as separate sentences with selectable words. The learner may edit the text first.
3. The learner clicks a word, selects a phrase, or chooses the complete sentence.
4. The learner presses **Explain**. Firebase AI Logic generates a structured English card using `PREFER_ON_DEVICE`.
5. The dashboard displays the actual `inferenceSource` badge.
6. The learner reviews the meaning, category, synonyms, and examples.
7. The learner optionally presses **Translate** (the button names their language, for example "Translate to Spanish"). The app routes the request to on-device or cloud inference according to that language's support (FR-AI-007), generates the translation, and shows the actual source.
8. The learner presses **Save to my collection**. If a card with the same normalized text and source sentence exists, the learner is offered that card. Otherwise the card is created and the capture becomes `processed`.
9. The card is immediately available in My Collection on every device.

### 15.5 Practise

1. Learner opens Practice on desktop or phone.
2. The dashboard shows collection size and items due for review.
3. Learner starts flashcards, reverse flashcards, or a quiz.
4. The card front shows the saved expression or source sentence. The learner attempts to recall the meaning and taps **Reveal answer**.
5. The answer side shows English meaning, synonyms, example, and the saved explanation in the learner's language.
6. Learner marks Still learning or Got it. In one atomic write, the application records a review event and updates the card's statistics and next review time.

### 15.6 Review a previously incorrect item

1. Learner opens **Review mistakes** in Practice.
2. The app lists items with a recent incorrect result or marked Still learning, or items overdue for review.
3. Learner sees the selected term without its definition, guesses, and reveals the answer.
4. The result is recorded as in 15.5 and the next review time is recalculated.

### 15.7 Sign out or switch account

1. Learner signs out in the web application (Profile).
2. The extension silently tries to save the account's remaining lines, then forgets the session. If some lines could not be saved, the web application says in plain language that they will stay safe on this computer and be saved when that account signs in again.
3. Capturing is disabled until someone signs in. Signing in as another user hands that user's session to the extension.

### 15.8 An exceptional unsaved line

1. A captured line is quarantined because the server rejected that specific record (rare, since capture-time validation prevents most cases).
2. After the learner's next deliberate capture, a brief toast says "Some lines couldn't be saved." with a **Review** link (at most once a day).
3. The link opens Profile in the web application, where the learner removes the lines or leaves them.
4. Valid captures have kept saving in the background the whole time.

---

## 16. User interface requirements

### 16.1 Chrome extension

The extension is invisible during normal viewing (Section 1.2). It has exactly these visible elements:

- **Brief toast** over the video, after a deliberate capture click (FR-CAP-005). A few other short, plain-language messages exist only for cases where the learner must act.
- **Toolbar icon:** opens or focuses the web application (FR-CAP-009). No popup, no badge, no menu.

There is no popup, side panel, options page, account page, queue view, sync control, or technical status in the extension.

### 16.2 Web application screens and navigation

| Screen | Responsibility | Reached from |
|---|---|---|
| **Inbox** | Subtitles captured on YouTube; process them at your own pace | Primary navigation |
| **Explore** | Work on one capture: segment, select a word/phrase/sentence, explain, translate to your language, save | **Explore** action on an Inbox row |
| **My Collection** | Saved vocabulary, idioms, slang, and expressions, grouped and filtered by type | Primary navigation |
| **Learning Cards** | Searchable card list and card detail, including English, saved translations, source context | From My Collection (and after saving in Explore) |
| **Practice** | Flashcards, reverse flashcards, quiz, mistake review, spaced review | Primary navigation |
| **Progress** | Learning statistics and revision history | Primary navigation |
| **Profile** | Account and sign-out, translation language, extension connection status, and "Lines that couldn't be saved" (only when needed); when the extension is not connected, how to download and add it | Primary navigation |

On phones the primary navigation is a bottom bar. Explore and Learning Cards are screens reached from the Inbox and My Collection; they are deep-linkable but are not separate top-level destinations. The Inbox and Explore never show or depend on the extension's local state.

### 16.3 Capture Inbox and Explore

**Inbox list**
- Header showing how many subtitles are new.
- Rows: captured line, source (platform + video title), time, status, and **Explore** / **Dismiss** actions.
- Empty state: a short "all caught up" message.

**Explore view**
- Capture text (editable), shown as separate selectable sentences with clickable words.
- Clear selected-text state; **Explain** disabled when the selection is blank or punctuation only.
- Learning card: selected text, category label, simple English meaning, contextual meaning, synonyms, examples, optional usage note, translation action and translated content (with direction and source label), source video link with timestamp, inference-source badge, and **Save**.
- AI states: working, taking longer than usual (with a Cancel action), and failed (with a Try again action). The source badge shows **On your device** or **Cloud** once a result arrives.

### 16.4 My Collection, Learning Cards, Practice, Progress, Profile

1. **My Collection:** category groups with counts, search and filters, and a card list.
2. **Learning Cards:** card detail with all saved English and translated fields plus source context, with delete.
3. **Practice:** mode picker (Flashcards, Reverse flashcards, Quiz, Review mistakes), the review screens, and the session summary.
4. **Progress:** statistics (FR-PRO-001).
5. **Profile:** account details and sign-out, preferences (FR-LIB-010), the extension's connection status and the unsaved-lines section (FR-CAP-011).

### 16.5 Accessibility and language rendering

- Every translation renders in its language's script with the correct direction (right-to-left where needed) and `lang` attribute (FR-AI-012).
- The user must be able to distinguish English and translated sections visually.
- Controls must have readable labels and be keyboard accessible on desktop; touch targets must be adequate on mobile.
- Do not communicate the AI source or answer correctness only by colour; include text such as **On-device** or **Cloud**.
- Keep explanations concise and use plain language suitable for non-native speakers.

---

## 17. Firebase and hackathon compliance requirements

### FR-FB-001 — Firebase AI Logic runtime usage

**Priority:** Must have  
The deployed dashboard must import and call Firebase AI Logic at runtime for the English learning card and the translation. Mentioning Firebase AI Logic only in documentation is insufficient. The extension does not call Firebase AI Logic.

### FR-FB-002 — Hybrid inference

**Priority:** Must have  
The English explanation flow must use Firebase AI Logic Web hybrid inference with `PREFER_ON_DEVICE` and an actual on-device model configuration. The app must preserve the SDK-reported source for display and for the saved card.

### FR-FB-003 — Structured output configuration

**Priority:** Must have  
Configure the matching JSON schema for both `onDeviceParams` and `inCloudParams` so the learning-card response has a consistent structure regardless of the inference path.

### FR-FB-004 — Firebase Authentication

**Priority:** Must have  
Use Firebase Authentication with the Email/Password provider in the web application, associating the personal collection with one user account. The extension receives the signed-in session from the web application and exchanges its refresh token through the Secure Token REST API; it contains no Firebase Auth SDK.

### FR-FB-005 — Cloud Firestore

**Priority:** Must have  
Use Cloud Firestore as the source of truth for captures, the collection, and practice data. The extension creates captures directly through the Firestore REST API with the session's Firebase ID token. The web application uses the Firestore Web SDK, reads captures, and writes everything else.

### FR-FB-006 — Firebase App Check

**Priority:** Must have  
App Check must be configured and enforced for Firebase AI Logic from the dashboard (Firebase documentation states enforcement is required from 2 November 2026). Use a production-capable web provider for the hosted dashboard and the debug provider/token workflow for local development and hackathon judging where required. Register debug tokens in the Firebase console; never commit a debug token or ship it in a production build.

**Extension and Firestore:** Whether App Check can be satisfied by extension-origin Firestore requests is not assumed and is tracked as validation item V-3 (Section 5.8). Until it is proven, App Check enforcement for Cloud Firestore stays off, and Firestore is protected by Authentication and security rules. Enabling Firestore enforcement before the extension sends valid tokens will make every extension sync fail with `permission-denied`.

### FR-FB-007 — Remote Config

**Priority:** Should have  
Use Remote Config for the cloud model name (`cloud_model`), so a retired model can be replaced from the Firebase console without redeploying. The value is validated before use, and the built-in default applies if Remote Config is unavailable.

### FR-FB-008 — Firestore security rules

**Priority:** Must have  
Firestore rules must enforce user ownership. A user may read, create, update, or delete documents only within their own `users/{uid}` namespace where `request.auth.uid == uid`. Requests from the extension's REST calls are evaluated by the same rules as SDK requests.

**Capture documents (`users/{uid}/captures/{captureId}`):**
- Create requires `ownerUid == uid`, a string `text` of 1 to a maximum length, `platform` in the allowed set, `status == "new"`, and only the allowed fields.
- Update by the learner is limited to `status`, `editedText`, and `savedCardIds` (and `updatedAt` if used). The immutable capture fields cannot be changed.
- A retry that attempts to re-create an existing capture must not corrupt it (FR-SYNC-004).

**Other collections:**
- `reviewEvents` documents are create-only (no update).
- `learningCards` fields have type and size limits.

### FR-FB-009 — Public source repository

**Priority:** Must have  
The repository must be public, contain the extension, the dashboard, the Firestore rules, and setup instructions (including how the Firebase configuration and dashboard URL are set in both builds), and include a recognized open-source license file. Do not include production secrets, private credentials, or App Check debug tokens.

### FR-FB-010 — Demonstration video

**Priority:** Must have  
Publish a public YouTube demonstration video of no more than three minutes. The video must show the project running and must be in English or include English subtitles.

### FR-FB-011 — Confirm hackathon rules for this architecture

**Priority:** Must have  
Before submission, confirm against the published #BuildHybridAI rules that a hosted web app with a companion Chrome extension satisfies the project-type, platform, and repository requirements. The rules page could not be retrieved when this document was revised. The Firebase hybrid-inference documentation targets web apps in Chrome desktop, so a hosted dashboard calling AI Logic is a documented path, but the rules must be checked.

### FR-FB-012 — Hosting

**Priority:** Must have  
The web application is deployed to Firebase Hosting over HTTPS. Its domain is in the Firebase Auth authorized domains, and its origin is the only origin the extension accepts messages from.

### FR-FB-013 — Extension technical validation

**Priority:** Must have  
Validation items V-1 to V-7 (Section 5.8) must be run and their outcomes recorded in the repository (for example in a short `docs/validation.md`) before the extension's synchronization is considered complete.

---

## 18. Non-functional requirements

### NFR-001 — Capture responsiveness and non-interference

- Capturing a subtitle must feel instant and must not block, pause, seek, or visibly disturb video playback.
- The extension follows the invisibility invariant (Section 1.2): nothing is shown during viewing except the brief confirmation after a deliberate click.
- AI generation may take longer; display a clear loading state and support retry/cancel where practical.

### NFR-002 — Reliability and data safety

- A capture that was confirmed to the learner by a toast must not be lost by a crash, reload, network failure, or concurrent sync (FR-CAP-006, FR-SYNC-003).
- Synchronization must be idempotent and safe to retry (FR-SYNC-004).
- An unavailable local model must not prevent English explanation when cloud connectivity is available.
- An unavailable cloud model must not prevent users from reading saved cards or practising offline.

### NFR-003 — Privacy and data minimization

- Only cues the learner explicitly clicks are captured. No continuous subtitle collection, no full tracks or transcripts.
- Send only the selected text and the minimum surrounding sentence context needed for an explanation.
- Do not save adjacent subtitle context to learning cards by default.
- Provide delete actions for captures and learning cards, and discard actions for local pending captures, so the learner can remove their data.
- Explain that English requests may be processed locally or, when local inference is unavailable, by the cloud fallback, and that translation is processed on the learner's device only when their language and device support it, and otherwise in the cloud. The UI shows which, for each translation.

### NFR-004 — Security

- No Gemini API key or privileged server credential may be embedded in the extension or the dashboard.
- Protect Firebase resources with Authentication, App Check, and Firestore Security Rules.
- The extension declares `externally_connectable` for exactly one origin (the web application; a `localhost` origin only in development builds), checks the sender's origin on every external message, and answers only the five message types in Section 5.4. Internal messages are accepted only from its own content scripts.
- The learner's password never reaches the extension. The extension stores only the session handed over by the web application (UID and refresh token) in `chrome.storage.local`, never logs it, and verifies every handed-over session with Google before trusting it. Any script running on the web application's origin can call the bridge, so the web application must serve a strict Content Security Policy and render captured text as text only.
- Firestore security rules enforce that a capture can only be written under the signed-in user's own UID.
- The dashboard renders captured text as text only and enforces a strict Content Security Policy.
- Never commit debug tokens, private keys, `.env` files containing secrets, or personal test data.

### NFR-005 — Browser support

- Extension: Chrome desktop, Manifest V3.
- Dashboard: current Chrome, Edge, Safari, and Firefox on desktop and mobile for browsing, Inbox processing, and practice.
- Hybrid on-device inference requires Firebase JS SDK v12.5.0+, Chrome desktop 139 or later, a supported operating system, sufficient free storage for the model, and compatible hardware. Current Chrome Prompt API documentation lists 22 GB free disk space and either a GPU with more than 4 GB VRAM or a CPU with at least 16 GB RAM and 4 cores; re-check the current official documentation before release.
- If Prompt API or local model support is unavailable, use the Firebase cloud fallback and accurately label the source.

### NFR-006 — Accessibility

- All core actions must be keyboard accessible where practical.
- Right-to-left languages must use correct right-to-left layout.
- Do not rely on colour alone to signal inference source or practice correctness.

### NFR-007 — Data consistency

- Firestore is the source of truth for authenticated accounts; the extension queue is transient.
- Offline edits must synchronize when connectivity returns.

### NFR-008 — Invisible, plain-language extension

- The extension UI follows Section 1.2 at all times.
- Every learner-facing string in the extension is plain language about captured lines and the account. It never contains queue, sync, retry, acknowledgement, token, storage, or HTTP/Firestore error vocabulary.
- Developer diagnostics are written to the service-worker console only.

---

## 19. Error and edge-case handling

| Situation | Expected behaviour |
|---|---|
| Captions are off or the click is not on a subtitle | Nothing is captured; no toast; playback unaffected |
| Subtitle DOM has multiple lines | Normalize into one cue before storing |
| Learner double-clicks the same cue | One capture (FR-CAP-003) |
| Same phrase captured later at a different time | A new capture is created |
| Capture click while the video is playing or paused | Playback state is unchanged (FR-CAP-013) |
| Learner clicks a subtitle while not signed in | Nothing captured; one brief sign-in message with a link to the web application, then quiet for a few minutes |
| Session expired, revoked, or the account was disabled or deleted | Capturing disabled; the next capture click shows the sign-in message; queued captures retained under their owner; a fresh handoff from the web application restores capturing |
| Offline while signed in | Capture works with the usual brief confirmation; synchronization happens silently when the connection returns |
| Extension reloaded while a YouTube tab is open | Brief message asking the learner to refresh the tab; no silent loss |
| Service worker stopped mid-sync | On restart, retries run from the queue; create-only writes prevent duplicates |
| Crash after Firestore confirmed but before local removal | Next retry gets "already exists", treats it as synchronized, and removes the local key; learner-changed fields are untouched |
| New capture arrives during a sync | Both captures survive; the sync removes only the key it confirmed |
| Two YouTube tabs capture at nearly the same time | Both captures are kept |
| Pending queue is full | New capture refused with a brief message; existing captures kept |
| Learner signs out with unsaved lines | The extension silently tries to save them first; the web application then says in plain language that any remaining lines stay safe and sync when that account signs in again |
| Another website tries to message the extension | Ignored (origin not allowed) |
| Web application hands over a token that does not match the claimed UID, or is invalid | Rejected; the extension's session is unchanged |
| Learner signs in on the web application but the extension is not installed or reachable | The web application works normally; Profile shows the extension as not connected |
| Learner installs the extension after already using the web application | The next time the web application is open, the session is handed over automatically |
| User B signs in on the same browser | User A's lines are not synced or reassigned; they appear only in Profile's unsaved-lines section, with explicit removal |
| User A signs in again | User A's pending captures sync under User A |
| Capture fails validation at capture time | Not stored; brief "Couldn't capture that line."; console diagnostic |
| One record is rejected by the server while others succeed | That record is quarantined as invalid, others keep syncing; a brief reminder with a Review link appears after the next deliberate capture (at most daily) |
| Every record is rejected (rules, configuration, App Check, or version mismatch) | Treated as systemic: nothing is quarantined or deleted; slow retries; developer diagnostic; no learner-facing technical message |
| Firestore App Check enforcement turned on before the extension supports it | Same as systemic failure; captures stay safe in the local queue (see V-3) |
| Web application opened with the extension closed or not installed | Inbox shows what is already in Firestore; no dependency on the extension |
| Toolbar icon clicked while the web application is already open | That tab is focused instead of opening a duplicate |
| Toolbar icon clicked while signed out | The web application opens (or is focused) and shows sign-in |
| Learner clicks the sign-in link while watching in full screen | The web application opens in a tab, which may leave full screen; the learner returns to the video afterwards (V-6) |
| Capture text is a partial sentence | Learner edits the text before exploring |
| User selects only a word | `selectionKind: word`; full sentence sent as context |
| User selects multiple words | `selectionKind: phrase` |
| User selects the whole sentence | `selectionKind: sentence` |
| Selected text is blank or punctuation only | Disable Explain and Save |
| Same expression classified as `idiom` then `expression` | One card; it keeps its first category (FR-LIB-002) |
| Same expression, different source sentence | A separate contextual card |
| Local model unavailable | Use Firebase AI Logic cloud fallback for the English card |
| Local model is downloading | Show progress/status; do not block with a long wait |
| Local model returns malformed output | Validate, retry once if appropriate, otherwise show an error; do not save malformed content |
| Translation requested offline for a language that runs in the cloud | Explain that a new translation needs internet; retain any saved translation |
| Translation requested offline for a language that runs on-device and the model is ready | Works offline; badge shows On-device |
| Learner picks a language the on-device model does not support | Routed to the cloud; the picker already showed "In the cloud" |
| On-device language is chosen but the local model is downloading, unavailable, or the local request fails | Falls back to the cloud; the badge shows Cloud |
| Learner changes their language | Existing translations are kept; the card shows the new language's translation only after it is generated |
| Browser has no Prompt API (phone, other browser) | No probe; every language is routed to the cloud |
| Phone browser without Prompt API | Cloud inference or documented fallback; badge shows the actual source |
| Practice answered offline | The review event and card update are queued together by Firestore and sync atomically |
| Source sentence does not contain the saved phrase | Exclude it from cloze practice |
| User deletes a card | Confirm or offer undo; delete only within the user's namespace; review events are kept |

---

## 20. Recommended build priorities

Submission closes on 30 November 2026 (per the Devpost listing), so prove the risky parts first and build the end-to-end path before polishing.

### P0 — Validation spikes (go / no-go)

1. V-1: Firestore REST create-if-absent with a real ID token (success, already-exists, rules, error mapping, host permissions).
2. V-2: Session handoff with a real account (refresh token accepted, survives restarts, revocation handled).
3. V-3: Decide App Check for extension-origin Firestore (default: not enforced for Firestore).
4. V-4: Retries survive service-worker shutdown.
5. V-5: Capture click leaves playback unchanged on YouTube.
6. V-6: Toolbar icon and messaging in a real browser, including the development origin.
7. V-7: On-device language probe on desktop Chrome and the routing that follows it.

### P0 — Must be demonstrated

1. Extension: capture authentication gate, capture-time validation, and the toast; session handoff from the web application (no sign-in UI in the extension).
2. Toolbar icon opens or focuses the web application; one-time welcome on first install.
3. Capture-time validation, per-capture queue with the service worker as sole owner, UID stamping, and the brief confirmation after the local write.
4. Silent direct Firestore sync over REST with create-only writes, confirmed-only removal, retry/backoff, and failure classification.
5. Unsaved-lines review in Profile, and account-bound captures across sign-out and sign-in.
6. Hosted React web application with Email/Password sign-in, session handoff to the extension, and the real-time Inbox.
7. Segmentation and word/phrase/sentence selection in Explore.
8. Firebase AI Logic `PREFER_ON_DEVICE` English learning card with structured output, cloud fallback, and the actual inference-source badge.
9. Translation in the learner's chosen language through Firebase AI Logic, routed per language (on-device where supported, cloud otherwise), with a language picker and a source badge.
10. Save with duplicate prevention (normalized text + source sentence), and My Collection / Learning Cards browse, search, filter, and detail.
11. Flashcards with reveal and two ratings, atomic review events plus card statistics, and next-review scheduling.
12. Contextual sentence completion and Review mistakes.
13. Profile; a layout that works on a phone.
14. App Check for AI Logic, Firestore rules, public repository, license, and README.

### P1 — Add if the P0 flow is stable

1. Contextual quizzes (built).
2. Progress statistics and revision history (built).
3. Remote Config for the cloud model name (built).

### P2 — Post-hackathon roadmap

1. Formal Netflix support (the capture code already exists) and additional streaming adapters, subject to platform behaviour and terms.
2. A stronger App Check attestation story for the extension.
3. Romanization and script variants (for example Roman Urdu), and richer per-language options.
4. Native Android/iOS applications with platform-specific local inference where supported.
5. Multi-turn AI tutor and personalized learning plans.
6. More advanced spaced repetition and review analytics.

---

## 21. Definition of done for the hackathon MVP

The MVP is considered complete when all of these checks pass:

**Extension: invisibility and capture**
- [ ] During normal viewing the extension shows nothing: no popup, side panel, overlay, badge, counter, or status indicator.
- [ ] Clicking the toolbar icon never opens a popup; it opens (or focuses) the web application whether or not the learner is signed in.
- [ ] The extension has no pages of its own, no badge, and no menus.
- [ ] On first install the web application opens once. After signing in there, the extension is connected automatically with no second sign-in, including when the extension is installed after the account was created.
- [ ] Signing out in the web application makes the extension save what it can and then forget the session; capturing is then disabled.
- [ ] A session that does not match its claimed UID, or comes from another origin, is rejected.
- [ ] While signed out, clicking a subtitle captures nothing and shows one brief sign-in message, not repeated on every click.
- [ ] While signed in, clicking a YouTube subtitle (including in full screen) captures it and shows only a brief toast.
- [ ] A capture click leaves playback exactly as it was (playing stays playing, paused stays paused).
- [ ] The capture includes text, sentences, video title, URL, playback time, and the learner's UID; repeated clicks do not create duplicates.
- [ ] Captures that fail validation are rejected at capture time with a brief message and are never stored.
- [ ] No extension message uses technical vocabulary (queue, sync, retry, acknowledgement, storage, token, error codes).

**Extension: synchronization**
- [ ] Each capture is stored under its own `chrome.storage.local` key, and only the service worker writes queue keys.
- [ ] A capture made while the web application is closed reaches Firestore through the REST API and appears in the Inbox, with no message between the web application and the extension.
- [ ] A capture made offline stays stored and syncs automatically, with no learner action, once the connection returns.
- [ ] The local copy is removed only after Firestore confirms it, and only that capture's key is removed.
- [ ] Capturing during an active sync loses nothing (concurrency test).
- [ ] Interrupting a sync (offline, or stopping the worker) loses no capture and creates no duplicate.
- [ ] A capture synced twice does not reset a status the learner changed in the web application.
- [ ] A capture made by User A never syncs under User B; after switching account, A's pending captures are retained and sync only when A signs in again.
- [ ] A record that is invalid or server-rejected is retained until the learner explicitly removes it, other captures keep syncing, and the learner is told only through the occasional reminder and Profile's unsaved-lines section.
- [ ] Systemic failures (rejection of every record) never quarantine or delete captures.
- [ ] Network, authentication, permission, quota, and invalid-data failures each behave as specified (FR-SYNC-006).
- [ ] Validation items V-1 to V-7 were run and their results recorded.

**Web application and learning**
- [ ] The web application Inbox lists captures in real time with Explore and Dismiss, with no extension needed.
- [ ] One capture containing multiple sentences is split into individual sentences.
- [ ] A learner can click one word, select a phrase, or select a full sentence.
- [ ] The app keeps selected text separate from the complete source sentence.
- [ ] Explain returns a valid structured English card using Firebase AI Logic `PREFER_ON_DEVICE`.
- [ ] A genuinely on-device result can be demonstrated on a supported Chrome desktop, with cloud fallback demonstrated when local inference is unavailable.
- [ ] The UI displays the actual `ON_DEVICE` or `IN_CLOUD` result source.
- [ ] The learner can choose their language; the picker shows On this device / In the cloud per language, based on a runtime probe.
- [ ] A language the on-device model supports is translated with `PREFER_ON_DEVICE`, and a genuinely on-device result can be demonstrated.
- [ ] A language the on-device model does not support (for example Urdu today) is translated with `ONLY_IN_CLOUD`, and the on-device model is never asked for it.
- [ ] Each translation shows the SDK-reported source, and right-to-left languages render right-to-left.
- [ ] Several languages can be saved on one card, and changing language keeps earlier translations.
- [ ] User can explicitly save a card, and the capture is marked processed.
- [ ] Saving the same expression with the same source sentence under a different category does not create a second card; a different source sentence creates a separate card.
- [ ] Inbox, Explore, My Collection, Learning Cards, Practice, Progress, and Profile are available, and the learner can use them on a phone browser with the same account.
- [ ] Practice offers flashcard reveal and two ratings, and works on a phone-sized screen.
- [ ] Practice offers contextual sentence completion for eligible cards.
- [ ] Every practice attempt writes a `reviewEvents` document and updates the card statistics in one atomic operation.
- [ ] Incorrect answers are tracked and can be practised again; Progress is based on review events.

**Security and submission**
- [ ] App Check is configured and enforced for Firebase AI Logic; the Firestore App Check decision (V-3) is documented; no debug token or secret is in the public repository.
- [ ] Firestore rules prevent one user's access to another user's data, and reject captures whose `ownerUid` is not the signed-in user.
- [ ] Hackathon rules were re-checked against this architecture (FR-FB-011).
- [ ] Public repository has an open-source license and setup instructions.
- [ ] Public YouTube demo is no longer than three minutes.

---

## 22. Suggested demonstration sequence (under 3 minutes)

1. **Problem (0:00–0:15):** Learners meet useful idioms and slang while watching videos and lose them after the scene ends.
2. **Capture (0:15–0:40):** Play a YouTube video, click a subtitle, and show the brief toast while the video keeps playing. Capture one more line. Nothing else appears on screen.
3. **Inbox (0:40–0:55):** Click the toolbar icon. SceneLingo opens in a new tab and the captures are already in the Inbox, saved automatically in the background.
4. **Hybrid English learning (0:55–1:30):** Explore a capture, select an expression such as "get ahead of ourselves", and generate the card. Show category, contextual meaning, synonyms, example, and the actual On-device/Cloud badge. Show a real on-device response where the environment supports it.
5. **Your language (1:30–1:50):** Tap Translate. Show a language the device supports (for example Spanish) answered on-device, then switch to Urdu and show the cloud result. The badge shows which ran.
6. **Save and sync (1:50–2:10):** Save the item, open My Collection, and show the same account on a phone browser.
7. **Practice (2:10–2:40):** Demonstrate flashcard reveal, a quiz question, and review of an incorrect answer.
8. **Hybrid value (2:40–2:55):** Summarize that short English explanations use on-device inference when supported, cloud fallback keeps the feature available, and translation uses on-device inference for languages the local model supports and cloud inference for the rest, chosen automatically per language.

---

## 23. Official technical references

The following official sources informed the implementation constraints in this document. Re-check them before final release because platform support and model availability can change.

1. **#BuildHybridAI 2026 Devpost page and rules** — platform eligibility, Firebase AI Logic requirement, App Check, repository, license, demo video, judging criteria, and deadline. (Not retrievable when this version was written; confirm manually.)  
   https://firebasehybridaihackathon.devpost.com/  
   https://firebasehybridaihackathon.devpost.com/rules

2. **Firebase AI Logic — Web hybrid inference getting started** — Web SDK requirements, Chrome desktop support, local model initialization, inference modes, structured output support, and unsupported features.  
   https://firebase.google.com/docs/ai-logic/hybrid/web/get-started

3. **Firebase AI Logic — Web hybrid configuration options** — `PREFER_ON_DEVICE`, `ONLY_IN_CLOUD`, `response.inferenceSource`, cloud model configuration, and the App Check enforcement notice.  
   https://firebase.google.com/docs/ai-logic/hybrid/web/configuration-options

4. **Firebase AI Logic — structured output for Web hybrid experiences** — response schema configuration for on-device and cloud paths.  
   https://firebase.google.com/docs/ai-logic/hybrid/web/generate-structured-output

5. **Chrome Prompt API** — Chrome desktop support, hardware/platform limits, supported expected languages, user activation, top-level window and same-origin iframe availability, and model availability.  
   https://developer.chrome.com/docs/ai/prompt-api

6. **Chrome extensions — messaging from web pages** — `externally_connectable`, `runtime.sendMessage` from a web page, and `runtime.onMessageExternal`.  
   https://developer.chrome.com/docs/extensions/develop/concepts/messaging

   **Firebase Auth REST API — exchange a refresh token for an ID token** (Secure Token API).  
   https://firebase.google.com/docs/reference/rest/auth#section-refresh-token

7. **Firebase App Check for Firebase AI Logic** — current App Check enforcement and configuration guidance.  
   https://firebase.google.com/docs/ai-logic/app-check

8. **Cloud Firestore offline persistence** — web cache and synchronization behaviour.  
   https://firebase.google.com/docs/firestore/manage-data/enable-offline

9. **Firebase Hosting** — hosting the dashboard over HTTPS.  
    https://firebase.google.com/docs/hosting

10. **Firebase App Check — custom provider (web)** — token exchange with a backend, and enforcement per product.  
    https://firebase.google.com/docs/app-check/web/custom-provider

11. **Chrome extensions — service worker lifecycle and the `chrome.alarms` API** — worker shutdown behaviour and retry scheduling (verify current alarm limits).  
    https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle  
    https://developer.chrome.com/docs/extensions/reference/api/alarms

12. **Cloud Firestore REST API** — authenticating requests with a Firebase ID token (security rules apply), base URL, and error codes.  
    https://firebase.google.com/docs/firestore/use-rest-api

13. **Firestore REST `Write`** — `currentDocument` preconditions (for example `exists: false`) and `updateTransforms` (server timestamp).  
    https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Write

14. **Chrome extensions — `chrome.action`** — handling toolbar clicks without a popup.  
    https://developer.chrome.com/docs/extensions/reference/api/action

---

## 24. Final product decision summary

SceneLingo is a Chrome extension and a hosted React web application around one personal learning account. The guiding principle is that the learner experiences it as a seamless learning companion, not as an extension they need to operate.

- **Chrome extension (capture, invisible):** Nothing is visible during normal viewing except a brief toast after a deliberate click. The toolbar icon has no popup and simply opens the web application. The extension does YouTube subtitle extraction, sentence segmentation, capture-time validation, a per-capture local queue owned by the service worker, and automatic, silent, idempotent synchronization to Firestore through the REST API, with strict per-account ownership. It has no sign-in UI, no Firebase SDK, and no pages of its own.
- **Hosted React web application (sign-in and learning):** The learner signs in here once, and the web application hands the session to the extension. It provides Inbox (a real-time Firestore view), Explore, My Collection, Learning Cards, Practice, Progress, and Profile. It works with the extension closed, uninstalled, or on a phone.
- **Firebase AI Logic hybrid English explanation:** `PREFER_ON_DEVICE` for compact English learning cards from the web application, with cloud fallback and an honest inference-source badge.
- **Translation in the learner's language:** the learner picks their language. Languages the on-device model supports on that device run with `PREFER_ON_DEVICE` (with cloud fallback); every other language runs with `ONLY_IN_CLOUD`. Support is detected at runtime, and the SDK-reported source is shown for each translation.
- **Firebase backend:** Authentication (Email/Password, in the web application), Cloud Firestore as the single source of truth, and App Check for AI Logic. App Check for extension-origin Firestore requests is a validation item and is not assumed.
- **Data integrity:** Captures are never lost, duplicated, or reassigned to another account, and are never deleted without a confirmed save or an explicit learner action. Practice history is stored as review events written atomically with each card's current statistics.

The product optimizes for one complete learning loop: **Capture → Inbox → Understand → Translate → Save → Practise → Remember.**
