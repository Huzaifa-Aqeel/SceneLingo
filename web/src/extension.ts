// The only link between the web app and the SceneLingo extension: hand over the signed-in
// session, and manage the rare lines the extension could not save. Captures never travel
// through here; the extension writes them to Firestore itself.
import type { User } from "firebase/auth";
import { clearSchema, needsAttentionSchema, pingSchema, type NeedsAttention } from "@/lib/schemas";
import type { ZodType } from "zod";

const EXTENSION_ID: string = import.meta.env.VITE_EXTENSION_ID || "mcknllombpfnfedkbdjpigjieaiiimdn";

type Runtime = {
  sendMessage(id: string, msg: unknown, cb: (reply: unknown) => void): void;
  lastError?: unknown;
};
const runtime = (): Runtime | undefined =>
  (globalThis as unknown as { chrome?: { runtime?: Runtime } }).chrome?.runtime;

export type Failure = { ok: false; error: string };

export function sendToExtension(message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const rt = runtime();
    if (!rt?.sendMessage) return resolve({ ok: false, error: "no_extension" });
    try {
      rt.sendMessage(EXTENSION_ID, message, (reply) => {
        resolve(runtime()?.lastError ? { ok: false, error: "unreachable" } : (reply ?? { ok: false, error: "no_reply" }));
      });
    } catch {
      resolve({ ok: false, error: "unreachable" });
    }
  });
}

async function ask<T>(message: unknown, schema: ZodType<T>): Promise<T | Failure> {
  const raw = await sendToExtension(message);
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : { ok: false, error: "bad_reply" };
}

// Safe to call on every sign-in / token change; the extension verifies it with Google.
export const pushSession = (user: User) =>
  sendToExtension({ type: "setSession", uid: user.uid, refreshToken: user.refreshToken });

export const clearExtensionSession = () => ask({ type: "clearSession" }, clearSchema);
export const pingExtension = () => ask({ type: "ping" }, pingSchema);
export const getNeedsAttention = (): Promise<NeedsAttention | Failure> => ask({ type: "getNeedsAttention" }, needsAttentionSchema);
export const discardLines = (ids: string[]) => sendToExtension({ type: "discardCaptures", ids });
