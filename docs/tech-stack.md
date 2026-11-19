. Complete technology stack
Layer	Technology	Responsibility
Extension platform	Chrome Manifest V3	Browser extension architecture
Extension language	JavaScript (ES modules)	Plain JavaScript, no build step for the code itself
Extension build	Node build script	Fills in the manifest and Firebase config, then packages a zip (no bundler needed: the extension uses no SDK)
Subtitle extraction	JavaScript, click-to-capture	Read the caption the learner clicks (no MutationObserver, nothing runs until a click)
Sentence segmentation	Intl.Segmenter	Separate subtitle sentences
Word segmentation	Intl.Segmenter	Identify selectable words in the web app (Explore). The extension only splits sentences
Extension communication	Chrome Runtime Messaging API	Content script ↔ Background Worker
Background processing	MV3 Service Worker	Capture queue, Firestore REST sync, session from the web app
Local storage	chrome.storage.local	Temporarily preserve captured subtitles
Web framework	React	Complete learning application
Web language	TypeScript	Type-safe frontend
Web build	Vite	Development and production builds
Styling	Tailwind CSS	Responsive UI
Component library	shadcn/ui	Reusable UI components
Routing	React Router	Dashboard navigation
Authentication	Firebase Authentication	Email/password accounts, signed in once in the web app
Database	Cloud Firestore	Captures, learning cards and progress
AI	Firebase AI Logic	Hybrid AI inference
On-device model	Gemini Nano through Chrome Prompt API	Local English explanations, and translation for languages the model supports on that device
Cloud model	Gemini (gemini-3.5-flash-lite) through Firebase AI Logic	Translation into languages the on-device model doesn't support (for example Urdu today), and cloud fallback
Hosting	Firebase Hosting	Deploy the web application
Security	Firestore Security Rules + Firebase App Check	Data authorization and application protection
Validation	Zod (web app), hand-written checks (extension)	Validate Firestore data, extension replies and AI responses
Configuration	Firebase Remote Config	Cloud model name, changeable without a redeploy
