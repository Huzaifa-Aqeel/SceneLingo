// One request that is answered on the device when it can be, and in the cloud when it can't.
// The SDK already falls back to the cloud when the on-device model is missing, still downloading, or
// unsupported. It does not when the model says it is ready and then fails while running, or when the answer
// it produces can't be used. This wrapper covers those two cases with one retry in the cloud.
import { AIError } from "firebase/ai";
import { sourceOf, type Source } from "./client";

export interface Askable {
  generateContent(prompt: string): Promise<{ response: { text(): string; inferenceSource?: string } }>;
}

export interface HybridOutcome<T> { value: T; source: Source }

// `hybrid` prefers the device; `cloud()` builds a model that only ever uses the cloud (built lazily, so
// nothing extra is created unless it is needed). `parse` turns the raw text into a valid result or throws.
// `retryPrompt` replaces the prompt on the second (cloud) attempt, for example to say what was wrong.
// `lenient`, if given, is tried on the second answer before giving up, so a merely imperfect answer is kept.
export async function askHybrid<T>({ hybrid, cloud, prompt, retryPrompt, parse, lenient }: { hybrid: Askable; cloud: () => Askable; prompt: string; retryPrompt?: string; parse: (text: string) => T; lenient?: (text: string) => T }): Promise<HybridOutcome<T>> {
  const again = retryPrompt ?? prompt;
  const secondTry = async (bad: unknown): Promise<HybridOutcome<T>> => {
    const second = await cloud().generateContent(again); // unusable answer: ask the cloud once
    const text = second.response.text();
    try {
      return { value: parse(text), source: "IN_CLOUD" };
    } catch {
      if (lenient) {
        try { return { value: lenient(text), source: "IN_CLOUD" }; } catch { /* fall through */ }
      }
      throw bad;
    }
  };

  let first: Awaited<ReturnType<Askable["generateContent"]>>;
  try {
    first = await hybrid.generateContent(prompt);
  } catch (e) {
    // An AIError comes from the cloud service itself (quota, permission, network): a second cloud call won't help.
    if (e instanceof AIError) throw e;
    first = await cloud().generateContent(prompt); // the local model failed while running
    const text = first.response.text();
    try {
      return { value: parse(text), source: "IN_CLOUD" };
    } catch (bad) {
      if (lenient) { try { return { value: lenient(text), source: "IN_CLOUD" }; } catch { /* keep the first error */ } }
      throw bad; // this already was the cloud's answer: no third request
    }
  }
  const source = sourceOf(first.response.inferenceSource);
  try {
    return { value: parse(first.response.text()), source };
  } catch (bad) {
    return secondTry(bad);
  }
}

// ---------------------------------------------------------------- streaming (spoken replies start before the answer is complete)
export interface StreamAskable {
  generateContentStream(prompt: string): Promise<{ stream: AsyncIterable<{ text(): string; inferenceSource?: string }> }>;
}

// Streams text to `onText` as it arrives. The device is asked first. If it fails before saying anything, the
// cloud is asked once. If it fails halfway, what already arrived is kept. A cloud-service error is not retried.
export async function streamHybrid({ hybrid, cloud, prompt, onText, isCancelled }: { hybrid: StreamAskable; cloud: () => StreamAskable; prompt: string; onText: (chunk: string) => void; isCancelled?: () => boolean }): Promise<{ text: string; source: Source }> {
  let source: Source = "IN_CLOUD";
  const run = async (m: StreamAskable): Promise<string> => {
    let all = "";
    const r = await m.generateContentStream(prompt);
    for await (const chunk of r.stream) {
      if (isCancelled?.()) break;
      source = sourceOf(chunk.inferenceSource) ?? source;
      const t = chunk.text();
      if (t) { all += t; onText(t); }
    }
    return all;
  };
  let heard = "";
  try {
    const text = await run({
      generateContentStream: async (p) => {
        const r = await hybrid.generateContentStream(p);
        return { stream: (async function* () { for await (const c of r.stream) { heard += c.text(); yield c; } })() };
      },
    });
    if (text.trim()) return { text, source };
  } catch (e) {
    if (e instanceof AIError) throw e;
    if (heard.trim()) return { text: heard, source }; // it failed halfway: keep what was said
  }
  if (isCancelled?.()) return { text: heard, source };
  source = "IN_CLOUD";
  return { text: await run(cloud()), source };
}
