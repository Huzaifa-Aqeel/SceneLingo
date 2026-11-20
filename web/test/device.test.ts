import { afterEach, describe, expect, it, vi } from "vitest";
import { AIError, AIErrorCode } from "firebase/ai";
import { askHybrid, type Askable } from "@/ai/hybrid";
import { _resetDeviceModel, checkModel, decline, downloadModel, phaseFrom, refresh, startDownload } from "@/ai/deviceModel";

const reply = (text: string, inferenceSource?: string): Askable => ({ generateContent: async () => ({ response: { text: () => text, inferenceSource } }) });
const failing = (error: unknown): Askable => ({ generateContent: async () => { throw error; } });
const parse = (t: string) => { if (t === "bad") throw new Error("invalid"); return t.toUpperCase(); };

describe("hybrid request with a cloud retry", () => {
  it("returns the device's answer when it works", async () => {
    const cloud = vi.fn();
    const r = await askHybrid({ hybrid: reply("ok", "on_device"), cloud, prompt: "p", parse });
    expect(r).toEqual({ value: "OK", source: "ON_DEVICE" });
    expect(cloud).not.toHaveBeenCalled();
  });
  it("returns the cloud's answer when the SDK already used the cloud", async () => {
    const r = await askHybrid({ hybrid: reply("ok", "in_cloud"), cloud: vi.fn(), prompt: "p", parse });
    expect(r.source).toBe("IN_CLOUD");
  });
  it("retries once in the cloud when the local model fails while running", async () => {
    const r = await askHybrid({ hybrid: failing(new DOMException("out of memory", "OperationError")), cloud: () => reply("fine"), prompt: "p", parse });
    expect(r).toEqual({ value: "FINE", source: "IN_CLOUD" });
  });
  it("retries once in the cloud when the availability check itself throws", async () => {
    const r = await askHybrid({ hybrid: failing(new TypeError("bad options")), cloud: () => reply("fine"), prompt: "p", parse });
    expect(r.source).toBe("IN_CLOUD");
  });
  it("does not retry when the cloud service itself returned an error", async () => {
    const cloud = vi.fn();
    await expect(askHybrid({ hybrid: failing(new AIError(AIErrorCode.FETCH_ERROR, "quota")), cloud, prompt: "p", parse })).rejects.toBeInstanceOf(AIError);
    expect(cloud).not.toHaveBeenCalled();
  });
  it("asks the cloud when the device's answer can't be used, and labels it Cloud", async () => {
    const r = await askHybrid({ hybrid: reply("bad", "on_device"), cloud: () => reply("good"), prompt: "p", parse });
    expect(r).toEqual({ value: "GOOD", source: "IN_CLOUD" });
  });
  it("gives up with the first error when the cloud's answer is unusable too", async () => {
    await expect(askHybrid({ hybrid: reply("bad", "on_device"), cloud: () => reply("bad"), prompt: "p", parse })).rejects.toThrow("invalid");
  });
});

describe("on-device model state", () => {
  afterEach(() => { vi.unstubAllGlobals(); _resetDeviceModel(); });

  it("maps Chrome's availability to what the app does", () => {
    expect(phaseFrom("available")).toBe("ready");
    expect(phaseFrom("downloadable")).toBe("can-download");
    expect(phaseFrom("downloading")).toBe("downloading");
    expect(phaseFrom("unavailable")).toBe("none");
    expect(phaseFrom(undefined)).toBe("none");
  });
  it("treats a failing check as not supported, never as an error", async () => {
    expect(await checkModel({ availability: async () => { throw new Error("x"); }, create: vi.fn() })).toBe("none");
  });
  it("checking availability never creates a session (nothing is loaded into memory)", async () => {
    const create = vi.fn();
    vi.stubGlobal("LanguageModel", { availability: async () => "available", create });
    await refresh();
    expect(create).not.toHaveBeenCalled();
  });
  it("downloads with progress and releases the session straight away", async () => {
    const destroy = vi.fn();
    const seen: number[] = [];
    const create = vi.fn(async (o: { monitor: (m: { addEventListener: (t: string, cb: (e: { loaded: number }) => void) => void }) => void }) => {
      o.monitor({ addEventListener: (_t, cb) => { cb({ loaded: 0.4 }); cb({ loaded: 1 }); } });
      return { destroy };
    });
    await downloadModel({ availability: vi.fn(), create }, (p) => seen.push(p));
    expect(seen).toEqual([0.4, 1]);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
  it("only starts a download when one is offered, and ends up ready", async () => {
    const destroy = vi.fn();
    let status = "downloadable";
    const create = vi.fn(async () => { status = "available"; return { destroy }; });
    vi.stubGlobal("LanguageModel", { availability: async () => status, create });
    _resetDeviceModel({ phase: "none" });
    startDownload();
    expect(create).not.toHaveBeenCalled(); // not offered here
    _resetDeviceModel({ phase: "can-download" });
    startDownload();
    expect(create).toHaveBeenCalledTimes(1); // called synchronously, inside the click
    await vi.waitFor(() => expect(destroy).toHaveBeenCalled()); // the session is released once the download is done
  });
  it("remembers Not now without throwing where storage is unavailable", () => {
    expect(() => decline()).not.toThrow();
  });
});
