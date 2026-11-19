// Puts the packaged extension next to the web app so the site can serve it at /scenelingo-extension.zip.
// Fails loudly if the zip is missing, so a build never ships a broken download link.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "release", "scenelingo-extension.zip");
const dst = path.join(root, "web", "public", "scenelingo-extension.zip");
if (!fs.existsSync(src)) {
  console.error("release/scenelingo-extension.zip is missing. Build it first:  cd extension && npm run package");
  process.exit(1);
}
fs.copyFileSync(src, dst);
console.log(`Extension download ready: web/public/scenelingo-extension.zip (${Math.round(fs.statSync(dst).size / 1024)} KB)`);
