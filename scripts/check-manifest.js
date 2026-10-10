// Checks extension/manifest.json (or the path given) against what the Chrome Web Store accepts.
const fs = require("fs");
const path = require("path");

const file = process.argv[2] || path.join(__dirname, "../extension/manifest.json");
const dir = path.dirname(file);
let m;
try {
  m = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (e) {
  console.error(`${file}: ${e.message}`);
  process.exit(1);
}

const icon = m.action?.default_icon;
const refs = [
  m.background?.service_worker,
  m.side_panel?.default_path,
  ...(m.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])]),
  ...Object.values(m.icons || {}),
  ...(typeof icon === "string" ? [icon] : Object.values(icon || {})),
].filter(Boolean);

const errors = [];
for (const r of refs) if (!fs.existsSync(path.join(dir, r))) errors.push(`missing file: ${r}`);
if (!/^\d+(\.\d+){0,3}$/.test(m.version || "")) errors.push(`bad version: ${m.version}`);
if ((m.description || "").length > 132) errors.push(`description is ${m.description.length} characters, max 132`);

for (const e of errors) console.error(e);
if (errors.length) process.exit(1);
console.log(`${file}: ok`);
