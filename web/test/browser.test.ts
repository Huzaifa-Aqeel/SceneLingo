import { describe, expect, it } from "vitest";
import { canInstallExtension } from "@/lib/browser";

const brands = (...b: string[]) => b.map((brand) => ({ brand }));
describe("who can add the extension", () => {
  it("Chrome, Edge and Brave on a computer can", () => {
    expect(canInstallExtension({ userAgentData: { mobile: false, brands: brands("Chromium", "Google Chrome") } })).toBe(true);
    expect(canInstallExtension({ userAgentData: { mobile: false, brands: brands("Chromium", "Microsoft Edge") } })).toBe(true);
  });
  it("phones cannot, even in Chrome", () => {
    expect(canInstallExtension({ userAgentData: { mobile: true, brands: brands("Chromium") } })).toBe(false);
    expect(canInstallExtension({ userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36" })).toBe(false);
  });
  it("Firefox and Safari cannot", () => {
    expect(canInstallExtension({ userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0" })).toBe(false);
    expect(canInstallExtension({ userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15" })).toBe(false);
  });
  it("a browser that does not say what it is gets the benefit of the doubt only if it looks like desktop Chrome", () => {
    expect(canInstallExtension({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 Safari/537.36" })).toBe(true);
    expect(canInstallExtension({})).toBe(false);
  });
});
