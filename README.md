# SceneLingo

Learn English from the shows you watch. Click a subtitle on YouTube, and SceneLingo saves it. Later, select a word or phrase, get a plain-English explanation written for that exact scene, translate it into your own language, and practise it.

Built for the Firebase #BuildHybridAI 2026 hackathon. English explanations use **Firebase AI Logic hybrid inference** (on-device first, cloud as fallback), and translation is routed per language: on-device when Chrome's built-in model supports the language on that device, cloud otherwise. Every result shows where it was produced.

**Live app:** https://herdproof.web.app

## Try it

You need desktop Chrome.

1. **Create an account** at https://herdproof.web.app.
2. **Install the extension.** In **Profile**, under **Extension**, choose **Download extension** and follow the four steps shown there (unzip, open `chrome://extensions`, turn on Developer mode, Load unpacked). The same zip is in this repository at [`release/scenelingo-extension.zip`](release/scenelingo-extension.zip). The extension picks up your sign-in by itself.
3. **Open any YouTube video with captions** (press `c` to turn them on) and click a subtitle line. A short confirmation appears and the video keeps playing. If the tab was already open before you installed the extension, that's fine: no refresh is needed.
4. **Open the app** (click the extension icon). The subtitle is in your **Inbox**. Choose **Explore**, select a word, a phrase, or the whole sentence, and press **Explain**.
5. Choose your language in **Profile** to translate cards. Save a card, then use **Practice** (flashcards, quiz, fill in the blank, mistakes) and **Progress**.

### On-device AI

On-device results need Chrome 139 or newer on a computer that can run Chrome's built-in Gemini Nano: roughly 22 GB of free disk and either a GPU with more than 4 GB of video memory or 16 GB of RAM with 4 or more cores. Enable `chrome://flags/#prompt-api-for-gemini-nano`, then check `chrome://on-device-internals`. Without it, everything still works through the cloud and the badge says **Cloud**. The badge always reports the source the SDK actually used.

## How it fits together

```
YouTube tab ──click──▶ extension (content script ▶ service worker)
                          │  stores each capture locally, then creates it in Firestore (REST)
                          ▼
                     Cloud Firestore ◀── web app (React) ── Firebase AI Logic
                                              │                (hybrid English, per-language translation)
                          session hand-off ◀──┘  Firebase Auth · App Check · Remote Config · Hosting
```

- **Extension** (`extension/`): plain JavaScript, Manifest V3. It shows nothing while you watch except a brief toast. It has no sign-in screen and no Firebase SDK: the web app hands it the signed-in session, and it syncs captures to Firestore itself in the background. A capture is deleted locally only after Firestore confirms it, and it can never be saved under another account.
- **Web app** (`web/`): React, TypeScript, Tailwind, shadcn/ui, React Router, Zod. Home, Inbox, Explore, Collection, Practice, Progress, Profile.
- **Firebase:** Authentication (email/password), Cloud Firestore with security rules, Firebase AI Logic, App Check (reCAPTCHA Enterprise), Remote Config (the cloud model name), Hosting.

Documentation: [`docs/requirements.md`](docs/requirements.md) (full requirements) and [`docs/tech-stack.md`](docs/tech-stack.md).

## Run it yourself

You need Node 22+, the Firebase CLI, and a Firebase project with: Email/Password sign-in, Cloud Firestore, Firebase AI Logic (Gemini Developer API), App Check with a reCAPTCHA Enterprise key, Remote Config, and Hosting.

1. Create `.env.local` in the repo root (these are public identifiers, not secrets):
   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_APP_ID=...
   VITE_RECAPTCHA_SITE_KEY=...
   ```
   For local development only, put `VITE_APPCHECK_DEBUG_TOKEN=...` in `.env.development.local` and register that token in the Firebase console. Never commit it.
2. Set `.firebaserc` to your project, then deploy the rules and configuration:
   ```
   firebase deploy --only firestore:rules,remoteconfig
   ```
3. Web app:
   ```
   cd web && npm install
   npm run dev          # http://localhost:5173
   npm run build        # type-checks, then builds
   firebase deploy --only hosting
   ```
4. Extension:
   ```
   cd extension && npm install
   npm run build:dev    # development build in extension/dist (also trusts http://localhost:5173)
   npm run package      # production build in extension/dist-prod, zipped to release/
   ```
   The web app build copies `release/scenelingo-extension.zip` into the site, so run `npm run package` before `npm run build` in `web/`. The icons come from `extension/tools/icon.svg` (`node tools/make-icons.mjs` re-renders them).
   ```
   ```
   The extension trusts exactly one website origin, `https://<project>.web.app` by default. To use another domain, set `SCENELINGO_WEB_ORIGIN` in `.env.local` before building. Its ID is fixed by the public key in `extension/key/`, so the web app can always find it. The matching private key is not in this repository.

## Tests

```
cd extension && npm test        # unit tests: queue, sync, validation, session
cd web && npm test              # unit tests: selection, scheduling, quiz, AI validation, routing
cd web && LIVE=1 npm test       # also calls the real cloud model (needs .env files)
```

The browser tests in `extension/e2e/` drive real Chromium and need `npm i` plus a Playwright Chromium install.

## Privacy and security

- Only subtitles you click are captured. Nothing is collected in the background and no transcript is stored.
- Data lives under your own account. Firestore rules allow a signed-in user to read and write only their own documents, and validate every capture the extension writes.
- AI requests go through Firebase AI Logic with App Check enforced. There are no API keys or secrets in the extension or the web bundle.
- The site is served with a strict Content Security Policy, and only its own origin can talk to the extension.

## License

[MIT](LICENSE)
