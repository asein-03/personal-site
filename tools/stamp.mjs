// Stamps the links to the site's shared files in every page with a version from their contents, so a change reaches
// visitors on their next page load instead of after their browser's cached copy expires:
//   node tools/stamp.mjs
// Run it after editing anything in assets/, models/ or media/renders/. It covers:
//   /assets/<file>               links and scripts
//   /media/renders/<file>.webp   poster stills
//   /models/<id>.bin             preload links, and data-v on each viewer, which viewer.js adds to the model's URL
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hashes = (dir) => Object.fromEntries(fs.readdirSync(path.join(ROOT, dir)).filter((f) => !f.startsWith('.')).map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, dir, f))).digest('hex').slice(0, 10)]));
const v = { assets: hashes('assets'), renders: hashes('media/renders'), models: hashes('models') };
const link = (dir, base) => (m, name) => (v[dir][name] ? `${base}${name}?v=${v[dir][name]}` : m);
for (const page of fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))) {
  const file = path.join(ROOT, page);
  const before = fs.readFileSync(file, 'utf8');
  const after = before
    .replace(/\/assets\/([\w.-]+?)(\?v=[0-9a-f]+)?(?=["'])/g, link('assets', '/assets/'))
    .replace(/\/media\/renders\/([\w.-]+?)(\?v=[0-9a-f]+)?(?=["'])/g, link('renders', '/media/renders/'))
    .replace(/\/models\/([\w.-]+?)(\?v=[0-9a-f]+)?(?=["'])/g, link('models', '/models/'))
    .replace(/data-model="([\w-]+)"( data-v="[0-9a-f]*")?/g, (m, id) => (v.models[`${id}.bin`] ? `data-model="${id}" data-v="${v.models[`${id}.bin`]}"` : m));
  if (after !== before) { fs.writeFileSync(file, after); console.log(`stamped ${page}`); }
}
console.log(v.assets);
