// Re-packs model files written in the old uncompressed format with meshoptimizer's codecs, in place or into
// another folder: node repack.mjs ../../models [outDir]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { packModel, readModel } from './meshpack.mjs';

const [inDir = '../../models', outDir = inDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const br = (b) => zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }).length;
for (const f of fs.readdirSync(inDir).filter((f) => f.endsWith('.bin')).sort()) {
  const before = fs.readFileSync(path.join(inDir, f));
  let after;
  try { const { header, parts } = await readModel(before); after = packModel(header, parts); } catch (e) { console.log(`${f.padEnd(20)} skipped: ${e.message}`); continue; }
  fs.writeFileSync(path.join(outDir, f), after);
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`.padStart(7);
  console.log(`${f.padEnd(20)} ${kb(before.length)} -> ${kb(after.length)}   brotli ${kb(br(before))} -> ${kb(br(after))}`);
}
