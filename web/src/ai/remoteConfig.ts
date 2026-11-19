import { fetchAndActivate, getRemoteConfig, getString } from "firebase/remote-config";
import { app } from "@/firebase";
import { CLOUD_MODEL, setCloudModel } from "./client";

// Reads the cloud model name from Remote Config. Any problem (offline, not published, blocked) is
// ignored and the built-in default stays in effect, so this can never stop the app from working.
export async function loadRemoteConfig(): Promise<void> {
  try {
    const rc = getRemoteConfig(app);
    rc.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 0 : 60 * 60 * 1000;
    rc.defaultConfig = { cloud_model: CLOUD_MODEL };
    await fetchAndActivate(rc);
    setCloudModel(getString(rc, "cloud_model"));
  } catch {
    /* keep the default */
  }
}
