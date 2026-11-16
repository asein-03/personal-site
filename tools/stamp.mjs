// Stamps the shared files' links in every page with a version from their contents, so a change reaches
// visitors on their next page load instead of after their browser's cached copy expires:
//   node tools/stamp.mjs
// Run it after editing anything in assets/.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = fs.readdirSync(path.join(ROOT, 'assets'));
const version = Object.fromEntries(assets.map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'assets', f))).digest('hex').slice(0, 10)]));
for (const page of fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))) {
  const file = path.join(ROOT, page);
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(/\/assets\/([\w.-]+?)(\?v=[0-9a-f]+)?(?=["'])/g, (m, name) => (version[name] ? `/assets/${name}?v=${version[name]}` : m));
  if (after !== before) { fs.writeFileSync(file, after); console.log(`stamped ${page}`); }
}
console.log(version);
