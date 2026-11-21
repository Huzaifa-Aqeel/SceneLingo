// The on-device model (Chrome's Gemini Nano): is it here, can it be downloaded, and downloading it when the
// learner presses Download in Profile (the only place it is offered). Nothing in this file loads the model into memory except the one download the learner
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

// ---------------------------------------------------------------- shared state, so a download keeps going when the learner changes page
// `ours` = this page started the download (so it can report a percentage). A download that Chrome runs on its
// own, or one left over from before a reload, has no percentage.
interface State { phase: Phase; progress: number | null; failed: boolean; error: string | null; ours: boolean; stalled: boolean }
const fresh = (): State => ({ phase: "checking", progress: null, failed: false, error: null, ours: false, stalled: false });
let state: State = fresh();
let startedAt = 0;      // when our download was requested
let lastProgressAt = 0; // when it last moved
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
const api = (): ModelApi | null => (hasPromptApi() ? ((globalThis as unknown as { LanguageModel: ModelApi }).LanguageModel) : null);

export const STALL_MS = 30_000; // no movement for this long: stop the spinner and say what may be wrong
const GRACE_MS = 8_000;         // Chrome needs a moment to report "downloading" after we ask

export const isStalled = (now: number, lastMove: number, ours: boolean, phase: Phase): boolean =>
  phase === "downloading" && ours && now - lastMove > STALL_MS;

// Chrome's answer is the truth. Whatever this page believes about a download is dropped as soon as Chrome
// says something different (it cancelled, the learner turned the feature off, or it finished).
export async function refresh(): Promise<void> {
  const lm = api();
  const phase = lm ? await checkModel(lm) : "none";
  if (phase === "downloading") return set({ phase });
  if (state.ours && Date.now() - startedAt < GRACE_MS) return; // too early to say our request was dropped
  set({ phase, progress: null, ours: false, stalled: false });
}

export function checkStall(now = Date.now()): void {
  const stalled = isStalled(now, lastProgressAt, state.ours, state.phase);
  if (stalled !== state.stalled) set({ stalled });
}

export function startDownload(): void {
  const lm = api();
  if (!lm || state.phase !== "can-download") return;
  startedAt = lastProgressAt = Date.now();
  set({ phase: "downloading", progress: null, ours: true, stalled: false, failed: false, error: null });
  const mine = startedAt;
  // The first await inside downloadModel is the create() call, so it runs inside the click.
  downloadModel(lm, (p) => { if (mine === startedAt) { lastProgressAt = Date.now(); set({ progress: p, stalled: false }); } })
    .then(async () => {
      if (mine !== startedAt) return; // an older request that was already given up on
      const phase = await checkModel(lm);
      set({ phase, progress: null, ours: false, stalled: false, failed: phase !== "ready" });
    })
    .catch(async (e: unknown) => {
      if (mine !== startedAt) return;
      // Chrome's own words, shortened, so the learner can see what went wrong.
      const said = e instanceof Error ? e.message.trim().slice(0, 160) : "";
      set({ phase: await checkModel(lm), progress: null, ours: false, stalled: false, failed: true, error: said || null });
    });
}

export function useDeviceModel() {
  const s = useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state);
  // A quick availability check (loads nothing), repeated whenever the learner comes back to the tab.
  useEffect(() => {
    void refresh();
    const again = () => { if (document.visibilityState === "visible") { checkStall(); void refresh(); } };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    return () => { document.removeEventListener("visibilitychange", again); window.removeEventListener("focus", again); };
  }, []);
  // While a download is running and the tab is in view: look for a stall every 5 s, and ask Chrome again every 15 s.
  // A hidden tab does nothing; coming back runs both checks at once.
  useEffect(() => {
    if (s.phase !== "downloading") return;
    let n = 0;
    const t = setInterval(() => { if (document.visibilityState !== "visible") return; checkStall(); if (++n % 3 === 0) void refresh(); }, 5000);
    return () => clearInterval(t);
  }, [s.phase]);
  return { ...s, start: startDownload };
}

// Test hooks: read the shared state, and reset it between tests.
export const _state = (): Readonly<State> => state;
export function _resetDeviceModel(patch: Partial<State> = {}, times: { startedAt?: number; lastProgressAt?: number } = {}) {
  state = { ...fresh(), ...patch };
  startedAt = times.startedAt ?? 0;
  lastProgressAt = times.lastProgressAt ?? 0;
}
