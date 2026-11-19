// Builds the PRODUCTION extension into extension/dist-prod, checks it, and zips it to release/.
//   cd extension && npm run package
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "extension", "dist-prod");
const release = path.join(root, "release");
const zip = path.join(release, "scenelingo-extension.zip");

execFileSync("node", [path.join(root, "scripts", "build-extension.mjs"), "--out", out], { stdio: "inherit", env: { ...process.env, SCENELINGO_MOCK_BASE: "", SCENELINGO_TEST_NO_CONTENT_SCRIPT: "" } });

// Refuse to package anything that is not a clean production build.
const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
const config = fs.readFileSync(path.join(out, "config.js"), "utf8");
const problems = [];
if (/\(dev\)/i.test(manifest.name)) problems.push("name still says (dev)");
if (JSON.stringify(manifest).includes("localhost")) problems.push("manifest trusts localhost");
if (/127\.0\.0\.1|localhost/.test(config)) problems.push("config points at a local server");
if (!manifest.key) problems.push("no fixed extension key");
if (!manifest.content_scripts?.length) problems.push("no content script");
for (const f of Object.values(manifest.icons ?? {})) if (!fs.existsSync(path.join(out, f))) problems.push(`missing icon ${f}`);
if (!manifest.icons) problems.push("no icons");
if (manifest.externally_connectable.matches.length !== 1) problems.push("more than one trusted origin");
if (problems.length) { console.error("NOT PACKAGED:", problems.join("; ")); process.exit(1); }

fs.mkdirSync(release, { recursive: true });
fs.rmSync(zip, { force: true });
execFileSync("zip", ["-r", "-X", "-q", zip, "."], { cwd: out });
const kb = Math.round(fs.statSync(zip).size / 1024);
console.log(`\nPackaged ${path.relative(root, zip)} (${kb} KB)`);
console.log(`  name           : ${manifest.name} ${manifest.version}`);
console.log(`  trusted origin : ${manifest.externally_connectable.matches.join(", ")}`);
