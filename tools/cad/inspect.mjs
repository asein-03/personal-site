// List the bodies in STEP files (index, triangles, colour, bounding box in mm), and with --split the
// separate pieces inside each body. Used to pick bodies for convert.mjs.
//
//   node inspect.mjs [--split] file.step ...
import fs from 'node:fs';
import path from 'node:path';
import occtFactory from 'occt-import-js';

const args = process.argv.slice(2);
const split = args[0] === '--split' ? args.shift() : null;
const occt = await occtFactory();
const fmt = (mn, mx) => mn.map((v, k) => `${v.toFixed(1)}..${mx[k].toFixed(1)}`).join('  ');
function bbox(pos, ids) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const i of ids) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i * 3 + k]); mx[k] = Math.max(mx[k], pos[i * 3 + k]); }
  return fmt(mn, mx);
}
// pieces = groups of triangles connected through shared (welded) vertex positions
function pieces(pos, idx) {
  const key = (i) => `${pos[i * 3].toFixed(3)},${pos[i * 3 + 1].toFixed(3)},${pos[i * 3 + 2].toFixed(3)}`;
  const weld = new Map(), id = new Int32Array(pos.length / 3);
  for (let i = 0; i < id.length; i++) { const k = key(i); if (!weld.has(k)) weld.set(k, weld.size); id[i] = weld.get(k); }
  const parent = [...Array(weld.size).keys()];
  const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  for (let t = 0; t < idx.length; t += 3) { const a = find(id[idx[t]]); parent[find(id[idx[t + 1]])] = a; parent[find(id[idx[t + 2]])] = a; }
  const groups = new Map();
  for (let i = 0; i < id.length; i++) { const r = find(id[i]); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
  return [...groups.values()];
}

for (const file of args) {
  const r = occt.ReadStepFile(new Uint8Array(fs.readFileSync(file)), { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.001, angularDeflection: 0.5 });
  console.log(`\n== ${path.basename(file)}${r.success ? '' : ' (failed)'}`);
  if (!r.success) continue;
  r.meshes.forEach((m, i) => {
    const p = m.attributes.position.array, idx = m.index.array;
    const all = [...Array(p.length / 3).keys()];
    console.log(`  [${i}] ${JSON.stringify(m.name)}  ${idx.length / 3} tris  color ${m.color ? m.color.map((c) => c.toFixed(2)).join(',') : '-'}  bbox ${bbox(p, all)}`);
    if (split) { const ps = pieces(p, idx); if (ps.length > 1) ps.forEach((g, k) => console.log(`      piece ${k}: ${g.length} verts  bbox ${bbox(p, g)}`)); }
  });
}
