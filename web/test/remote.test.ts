import { describe, expect, it } from "vitest";
import { DEFAULT_CLOUD_MODEL, getCloudModel, resolveModel, setCloudModel } from "@/ai/client";
import { buildExplainConfig } from "@/ai/englishCard";
import { buildModelConfig } from "@/ai/translate";

describe("cloud model from Remote Config", () => {
  it("accepts a real model name, trimmed", () => {
    expect(resolveModel("  gemini-3.8-flash ", "x")).toBe("gemini-3.8-flash");
    expect(resolveModel("gemini-3.5-flash-lite", "x")).toBe("gemini-3.5-flash-lite");
  });
  it("ignores anything that is not a model name and keeps the fallback", () => {
    for (const bad of ["", "   ", undefined, null, 42, "Gemini 3", "gemini/../x", "gemini-3\nx", "a", "x".repeat(80), "<script>"]) {
      expect(resolveModel(bad, "fallback-model")).toBe("fallback-model");
    }
  });
  it("starts on the built-in default and changes only for a valid value", () => {
    expect(getCloudModel()).toBe(DEFAULT_CLOUD_MODEL);
    setCloudModel("not valid!!");
    expect(getCloudModel()).toBe(DEFAULT_CLOUD_MODEL);
    setCloudModel("gemini-3.9-flash");
    expect(getCloudModel()).toBe("gemini-3.9-flash");
    setCloudModel(undefined);
    expect(getCloudModel()).toBe("gemini-3.9-flash");
    setCloudModel(DEFAULT_CLOUD_MODEL);
  });
  it("is used by both the English card and the translation requests", () => {
    setCloudModel("gemini-3.9-flash");
    expect(buildExplainConfig(getCloudModel()).inCloudParams.model).toBe("gemini-3.9-flash");
    expect(buildModelConfig({ route: "ONLY_IN_CLOUD", languageCode: "ur", cloudModel: getCloudModel() }).inCloudParams.model).toBe("gemini-3.9-flash");
    setCloudModel(DEFAULT_CLOUD_MODEL);
  });
});
