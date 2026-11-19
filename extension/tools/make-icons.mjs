// Renders tools/icon.svg to the PNG sizes Chrome needs, and refreshes the web app's favicon.
//   cd extension && node tools/make-icons.mjs
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
const here = path.dirname(fileURLToPath(import.meta.url));
const svg = fs.readFileSync(path.join(here, "icon.svg"), "utf8");
const base = path.join(os.homedir(), ".cache/ms-playwright"); const dir = fs.readdirSync(base).find((x) => /^chromium-\d+/.test(x));
const exe = path.join(base, dir, fs.readdirSync(path.join(base, dir)).find((x) => x.startsWith("chrome-linux")), "chrome");
const out = path.resolve(here, "../src/icons"); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
for (const size of [16, 32, 48, 128]) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await p.screenshot({ path: path.join(out, `icon${size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await p.close();
}
await b.close();
fs.copyFileSync(path.join(here, "icon.svg"), path.resolve(here, "../../web/public/favicon.svg"));
console.log("icons:", fs.readdirSync(out).join(", "), "| web favicon replaced");
