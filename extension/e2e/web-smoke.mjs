// Smoke test for the built web app: serves web/dist through request interception (no server),
// checks that it renders with the Tailwind/shadcn theme and without console errors, and saves a screenshot.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
const base = path.join(os.homedir(), ".cache/ms-playwright");
const dir = fs.readdirSync(base).find((x) => /^chromium-\d+/.test(x));
const exe = path.join(base, dir, fs.readdirSync(path.join(base, dir)).find((x) => x.startsWith("chrome-linux")), "chrome");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.route("http://localhost:5173/**", (route) => {
  const url = new URL(route.request().url());
  let file = path.join(dist, url.pathname === "/" ? "index.html" : url.pathname);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, "index.html");
  route.fulfill({ status: 200, contentType: types[path.extname(file)] || "application/octet-stream", body: fs.readFileSync(file) });
});
// The app talks to Firebase; block those calls so the smoke test never touches the real project.
await page.route(/googleapis\.com|firebaseio\.com|firebaseapp\.com|gstatic\.com|google\.com\/recaptcha/, (r) => r.abort());

await page.goto("http://localhost:5173/");
await page.waitForSelector("form", { timeout: 15000 });
const btn = page.getByRole("button", { name: "Sign in", exact: true });
console.log("sign-in form rendered:", (await page.locator("form").count()) === 1);
console.log("primary button background:", await btn.evaluate((e) => getComputedStyle(e).backgroundColor));
console.log("card border radius:", await page.locator("[data-slot=card]").first().evaluate((e) => getComputedStyle(e).borderRadius));
await page.screenshot({ path: "/tmp/signin.png" });
const real = errors.filter((e) => !/net::ERR_FAILED|Failed to load resource|ERR_BLOCKED/.test(e));
console.log("unexpected console/page errors:", JSON.stringify(real.slice(0, 3)));
await browser.close();
process.exit(real.length ? 1 : 0);
