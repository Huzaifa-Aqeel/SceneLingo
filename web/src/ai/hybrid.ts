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
export async function askHybrid<T>({ hybrid, cloud, prompt, parse }: { hybrid: Askable; cloud: () => Askable; prompt: string; parse: (text: string) => T }): Promise<HybridOutcome<T>> {
  let first: Awaited<ReturnType<Askable["generateContent"]>>;
  try {
    first = await hybrid.generateContent(prompt);
  } catch (e) {
    // An AIError comes from the cloud service itself (quota, permission, network): a second cloud call won't help.
    if (e instanceof AIError) throw e;
    first = await cloud().generateContent(prompt); // the local model failed while running
    return { value: parse(first.response.text()), source: "IN_CLOUD" };
  }
  const source = sourceOf(first.response.inferenceSource);
  try {
    return { value: parse(first.response.text()), source };
  } catch (bad) {
    const second = await cloud().generateContent(prompt); // unusable answer: ask the cloud once
    try {
      return { value: parse(second.response.text()), source: "IN_CLOUD" };
    } catch {
      throw bad;
    }
  }
}
