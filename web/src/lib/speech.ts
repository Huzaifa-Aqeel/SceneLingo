// The browser's own speech features: listening (Web Speech recognition, on the device when the language pack
// is installed) and speaking (speech synthesis). Both are free. Nothing here is specific to SceneLingo.

// ---------------------------------------------------------------- types (the DOM lib has no Web Speech types)
interface Alt { transcript: string }
interface ResultLike { isFinal: boolean; 0: Alt }
interface RecEvent { resultIndex: number; results: ArrayLike<ResultLike> }
export interface RecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  processLocally?: boolean; phrases?: unknown[];
  onresult: ((e: RecEvent) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecCtor = { new (): RecognitionLike; available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string> };
interface Env {
  SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor;
  SpeechRecognitionPhrase?: new (phrase: string, boost: number) => unknown;
  speechSynthesis?: SynthLike; SpeechSynthesisUtterance?: new (text: string) => UtteranceLike;
}
export interface VoiceLike { name: string; lang: string; localService: boolean }
interface UtteranceLike { text: string; lang: string; rate: number; voice: VoiceLike | null; onend: (() => void) | null; onerror: (() => void) | null }
interface SynthLike { speak(u: UtteranceLike): void; cancel(): void; getVoices(): VoiceLike[]; onvoiceschanged?: (() => void) | null }

const env = (): Env => globalThis as unknown as Env;
const recCtor = (): RecCtor | undefined => env().SpeechRecognition ?? env().webkitSpeechRecognition;

// Talking needs both directions. Without them the feature is simply not offered.
export const speechSupported = (): boolean => !!recCtor() && !!env().speechSynthesis && !!env().SpeechSynthesisUtterance;

// ---------------------------------------------------------------- listening
export type Heard =
  | { kind: "speech"; text: string }
  | { kind: "silence" }
  | { kind: "denied" }
  | { kind: "error"; message: string };

export interface ListenOptions {
  phrases?: string[];            // words to favour, for example the phrase being practised
  maxMs?: number;                // give up if nothing final arrives
  onInterim?: (text: string) => void;
}

// One utterance: listens until the learner pauses (the browser decides when), then resolves with what was said.
export function listenOnce(opts: ListenOptions = {}): { done: Promise<Heard>; cancel: () => void } {
  const Ctor = recCtor();
  let rec: RecognitionLike | null = null;
  let finished = false;
  let settle: (h: Heard) => void = () => {};
  const done = new Promise<Heard>((resolve) => { settle = resolve; });
  const finish = (h: Heard) => { if (finished) return; finished = true; clearTimeout(timer); settle(h); };
  const timer = setTimeout(() => { try { rec?.stop(); } catch { /* already stopped */ } }, opts.maxMs ?? 15_000);

  (async () => {
    if (!Ctor) return finish({ kind: "error", message: "unsupported" });
    rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    try {
      // Use the installed on-device pack when there is one (private and offline); otherwise the browser's default.
      if (Ctor.available && (await Ctor.available({ langs: ["en-US"], processLocally: true })) === "available") rec.processLocally = true;
    } catch { /* default recogniser */ }
    const Phrase = env().SpeechRecognitionPhrase;
    if (Phrase && opts.phrases?.length) {
      try { rec.phrases = opts.phrases.map((p) => new Phrase(p, 5)); } catch { /* biasing is optional */ }
    }
    let text = "";
    rec.onresult = (e) => {
      let finalText = "", interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      text = (finalText || interim).trim();
      if (text) opts.onInterim?.(text);
      if (finalText.trim()) finish({ kind: "speech", text: finalText.trim() });
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech") finish({ kind: "silence" });
      else if (e.error === "not-allowed" || e.error === "service-not-allowed") finish({ kind: "denied" });
      else if (e.error !== "aborted") finish({ kind: "error", message: e.error });
    };
    rec.onend = () => finish(text ? { kind: "speech", text } : { kind: "silence" });
    try { rec.start(); } catch (err) { finish({ kind: "error", message: String((err as Error)?.message ?? err) }); }
  })();

  return { done, cancel: () => { finished = true; clearTimeout(timer); try { rec?.abort(); } catch { /* nothing to stop */ } settle({ kind: "silence" }); } };
}

// ---------------------------------------------------------------- speaking
// Prefer a voice that runs on this device; otherwise any English voice (some are online voices).
export function pickVoice(voices: readonly VoiceLike[]): VoiceLike | null {
  const en = voices.filter((v) => /^en[-_]/i.test(v.lang) || v.lang.toLowerCase() === "en");
  return en.find((v) => v.localService && /^en[-_]US/i.test(v.lang)) ?? en.find((v) => v.localService) ?? en.find((v) => /^en[-_]US/i.test(v.lang)) ?? en[0] ?? null;
}

// Splits streamed text into whole sentences as they complete, so speech can start before the reply is finished.
export function takeSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let start = 0;
  const re = /[.!?…]+["')\]]?\s+/g; // a sentence is complete once whitespace follows its end
  for (let m = re.exec(buffer); m; m = re.exec(buffer)) {
    const end = m.index + m[0].length;
    const piece = buffer.slice(start, end).trim();
    if (/\b(?:Mr|Mrs|Ms|Dr|Prof|St|vs|etc)\.$/i.test(piece)) continue; // "Dr." is not the end of a sentence
    sentences.push(piece);
    start = end;
  }
  return { sentences, rest: buffer.slice(start) };
}

let keepAlive: UtteranceLike[] = []; // Chrome can drop a speaking utterance that nothing references

export function speak(text: string, opts: { rate?: number } = {}): Promise<void> {
  const synth = env().speechSynthesis, Utter = env().SpeechSynthesisUtterance;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!synth || !Utter || !clean) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const u = new Utter(clean);
    u.lang = "en-US";
    u.rate = opts.rate ?? 0.95;
    u.voice = pickVoice(synth.getVoices());
    keepAlive.push(u);
    // Some online voices never report the end of long text: do not wait forever.
    const guard = setTimeout(end, 4000 + clean.length * 90);
    function end() { clearTimeout(guard); keepAlive = keepAlive.filter((x) => x !== u); resolve(); }
    u.onend = end;
    u.onerror = end;
    synth.speak(u);
  });
}

export const stopSpeaking = (): void => { try { env().speechSynthesis?.cancel(); } catch { /* nothing playing */ } };

// Speaks sentences one after another as they arrive, without gaps or overlap.
export function createSpeaker(opts: { rate?: number } = {}) {
  let chain: Promise<void> = Promise.resolve();
  let buffer = "";
  let stopped = false;
  const enqueue = (s: string) => { chain = chain.then(() => (stopped ? undefined : speak(s, opts))); };
  return {
    push(chunk: string) {
      buffer += chunk;
      const { sentences, rest } = takeSentences(buffer);
      buffer = rest;
      sentences.forEach(enqueue);
    },
    // Speak whatever is left, and resolve when everything has been said.
    async finish() { if (buffer.trim()) enqueue(buffer.trim()); buffer = ""; await chain; },
    stop() { stopped = true; buffer = ""; stopSpeaking(); },
  };
}
