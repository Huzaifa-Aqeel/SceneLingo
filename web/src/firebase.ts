import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";

const env = import.meta.env;

export const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  authDomain: `${env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
});

// App Check protects Firebase AI Logic. In dev it uses the debug token from
// .env.development.local (never bundled into a production build). In production it uses the
// reCAPTCHA Enterprise site key (VITE_RECAPTCHA_SITE_KEY).
const debugToken = env.DEV ? env.VITE_APPCHECK_DEBUG_TOKEN : undefined;
if (debugToken) {
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
}
if (env.VITE_RECAPTCHA_SITE_KEY || debugToken) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_SITE_KEY || "debug-placeholder"),
    isTokenAutoRefreshEnabled: true,
  });
}

export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
