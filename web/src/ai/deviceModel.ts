// The on-device model (Chrome's Gemini Nano): is it here, can it be downloaded, and downloading it with the
// learner's consent. Nothing in this file loads the model into memory except the one download the learner
// asks for, and that session is released as soon as the download finishes. Checking availability is cheap
// and loads nothing. The model is only loaded into memory by the SDK when the learner presses Explain or Translate.
import { useEffect, useSyncExternalStore } from "react";
import { hasPromptApi } from "./support";

export type Phase = "checking" | "none" | "can-download" | "downloading" | "ready";

interface Session { destroy?: () => void }
export interface ModelApi {
  availability(options: object): Promise<string>;
  create(options: object): Promise<Session>;
}

// The same English-in, English-out options the SDK uses for English cards, so "ready" means the same thing.
const OPTIONS = { expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] };

// "none" = not on this browser or this device, so nothing is offered.
export function phaseFrom(availability: string | undefined): Phase {
  if (availability === "available") return "ready";
  if (availability === "downloadable") return "can-download";
  if (availability === "downloading") return "downloading";
  return "none";
}

export async function checkModel(api: ModelApi): Promise<Phase> {
  try {
    return phaseFrom(await api.availability(OPTIONS));
  } catch {
    return "none";
  }
}

// Starts the download and lets go of the session Chrome opens for it (the files stay on disk).
// Must be called straight from a click: Chrome only starts a download for a user action.
export async function downloadModel(api: ModelApi, onProgress: (fraction: number) => void): Promise<void> {
  const session = await api.create({
    ...OPTIONS,
    monitor(m: { addEventListener(type: string, cb: (e: { loaded: number }) => void): void }) {
      m.addEventListener("downloadprogress", (e) => onProgress(Math.min(1, Math.max(0, e.loaded))));
    },
  });
  session.destroy?.();
}

// ---------------------------------------------------------------- "Not now", remembered on this device only
const KEY = "sceneLingo.deviceModel.declined";
const readDeclined = (): boolean => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
const writeDeclined = (v: boolean) => { try { v ? localStorage.setItem(KEY, "1") : localStorage.removeItem(KEY); } catch { /* private mode: ask again next time */ } };

// ---------------------------------------------------------------- shared state, so a download keeps going when the learner changes page
interface State { phase: Phase; progress: number | null; failed: boolean; justReady: boolean; declined: boolean }
let state: State = { phase: "checking", progress: null, failed: false, justReady: false, declined: readDeclined() };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
const api = (): ModelApi | null => (hasPromptApi() ? ((globalThis as unknown as { LanguageModel: ModelApi }).LanguageModel) : null);

export async function refresh(): Promise<void> {
  if (state.phase === "downloading" && state.progress !== null) return; // our own download is running
  const lm = api();
  set({ phase: lm ? await checkModel(lm) : "none" });
}

export function startDownload(): void {
  const lm = api();
  if (!lm || state.phase !== "can-download") return;
  writeDeclined(false);
  set({ phase: "downloading", progress: 0, failed: false, justReady: false, declined: false });
  // The first await inside downloadModel is the create() call, so it runs inside the click.
  downloadModel(lm, (p) => set({ progress: p }))
    .then(async () => {
      const phase = await checkModel(lm);
      set({ phase, progress: null, justReady: phase === "ready", failed: phase !== "ready" });
    })
    .catch(async () => set({ phase: await checkModel(lm), progress: null, failed: true }));
}

export function decline(): void {
  writeDeclined(true);
  set({ declined: true });
}

export function useDeviceModel() {
  const s = useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state);
  useEffect(() => { void refresh(); }, []); // a quick availability check, nothing is loaded
  return { ...s, start: startDownload, decline };
}

// Test hook: resets the shared state between tests.
export function _resetDeviceModel(patch: Partial<State> = {}) {
  state = { phase: "checking", progress: null, failed: false, justReady: false, declined: false, ...patch };
}
