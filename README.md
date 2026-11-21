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
5. Choose your language in **Profile** to translate cards. Save a card, then use **Practice** (flashcards, reverse flashcards, a three-format quiz, mistakes) and **Progress**.

### On-device AI

On-device results need Chrome 139 or newer on a computer that can run Chrome's built-in Gemini Nano: roughly 22 GB of free disk and either a GPU with more than 4 GB of video memory or 16 GB of RAM with 4 or more cores. Enable `chrome://flags/#prompt-api-for-gemini-nano`, then check `chrome://on-device-internals`. Without it, everything still works through the cloud and the badge says **Cloud**. The badge always reports the source the SDK actually used.

You download the model yourself from **Profile → On-device model** (a few GB; Explore only shows a one-time pointer to it). Until it is installed, everything runs in the cloud. If the on-device model fails while running, or gives an answer the app can't use, the request is repeated once in the cloud and the badge says **Cloud**.

#### Testing status of the on-device path (please read)

**The real on-device model has not run end to end on the author's computer.** Chrome's model download never started delivering data there, so no card in this project has been produced by the real Gemini Nano. Everything else about the hybrid path is built and tested with a stand-in for Chrome's model, and the cloud path is tested against the real cloud model. This is what was tried and what was seen, on 21 Nov 2026 (Linux, Chrome 149.0.7827.53, then updated to 158.0.8127.36):

| What was checked | Result |
|---|---|
| Hardware | Qualifies. Chrome's own page reports "device capable: true", 5207 MiB of video memory (3000 MiB required), about 298 GB free disk (20 GB required), on external power, feature flag, enterprise policy and user setting all enabled. |
| Network | Not the cause. Google's Chrome installer downloaded from the same machine at about 9 MB/s over HTTP and HTTPS, the component download servers answered, the Wi-Fi is not metered (NetworkManager), and Chrome fetched its other optimization-guide models (a few hundred MB) into a clean profile without trouble. |
| `LanguageModel.availability()` | Returned `"downloading"` for 30+ minutes, on both Chrome versions, including after resetting Chrome's on-device state and in a clean profile. |
| `LanguageModel.create({ monitor })` from the console | Never resolved or rejected, and no `downloadprogress` event (not even `loaded: 0`) was ever emitted. |
| Chrome 149, `chrome://on-device-internals` | Model state "Model Installer Not Registered For Unknown Reason", later "Install Not Complete", with "is already installing: false". Broker State listed the Base Model as "Foreground Installing", version N/A, **Error: None**. The Uninstall button did nothing and Event Logs stayed empty. |
| Chrome 158, `chrome://on-device-internals` | Every criterion true. All assets "Not Installed, 0%, Error: None" and `prompt_api` "Pending Assets". After a console `create()` call, `nano_v3_gpu_component` moved to "Foreground Installing" and stayed at 0%. |
| On disk and on the wire | The model folders stayed at 0 bytes for 30+ minutes, and the machine received only 1 to 10 KiB/s while Chrome held one idle connection open to Google's download servers. |
| App behaviour meanwhile | Correct: the Profile card said "Chrome is downloading the model in the background" because that is what Chrome reported, and every card and translation was served by the cloud and labelled **Cloud**. |

**What this may mean (not confirmed).** Chrome accepts the device and registers the install, but never receives the model from Google's delivery service for this client. That points at Chrome or Google's side (staged rollout or targeting of the model component, an installer bug, or the university network treating the download differently), not at the app and not at the hardware. None of this could be proven from the outside: Chrome gives a web page only four status words and no reason, and its internals page reported "Error: None" throughout. For comparison, Chrome does report some failures: in one test it rejected `create()` with "NotSupportedError: The device does not have enough space for downloading the on-device model" (that test used a RAM-backed temporary profile folder, which was the author's mistake), and the app shows such messages in the Profile card.

**What was tested instead.** Unit tests and a browser journey run against a stand-in for Chrome's on-device model, covering: the Download flow and its states (Starting, a real percentage, Chrome's own background download, Ready, failure with Chrome's message), the model loading only when Explain or Translate is pressed, per-language routing, the cloud retry when the local model crashes or returns an unusable answer, and the source badge. See `web/test/device.test.ts` and `extension/e2e/device-e2e.mjs`.

**To see it for real,** use a desktop Chrome where the model installs (check with `await LanguageModel.availability({expectedInputs:[{type:"text",languages:["en"]}],expectedOutputs:[{type:"text",languages:["en"]}]})` in the console: you want `"available"`), press **Download** in Profile if it is `"downloadable"`, then press **Explain** on a saved subtitle. The card's badge should read **On your device**. On any other browser or device, the same steps give **Cloud**.

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
- **Web app** (`web/`): React, TypeScript, Tailwind, shadcn/ui, React Router, Zod. Inbox, Explore, Collection, Practice, Progress, Profile.
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
