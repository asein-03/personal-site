// Packs a model's quantized parts into the .bin the site loads, with each buffer compressed by meshoptimizer's
// codecs (a header with "codec": "meshopt"). The site decodes them with three's MeshoptDecoder. Positions are
// int16 and normals int8, as before; the codec needs a stride of four bytes, so each vertex carries one spare.
import { MeshoptEncoder } from 'meshoptimizer';

await MeshoptEncoder.ready;

// part: { meta, P: Int16Array (xyz), N: Int8Array (xyz), I: Uint16Array | Uint32Array }
export function packModel(header, parts) {
  const chunks = [];
  let offset = 0;
  const push = (bytes) => { const o = offset; chunks.push(bytes); offset += bytes.byteLength; const pad = (4 - (offset % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); offset += pad; } return [o, bytes.byteLength]; };
  header.codec = 'meshopt';
  header.parts = parts.map(({ meta, P, N, I }) => {
    // vertices in the order the triangles first use them, which is what the codec compresses best
    const idx = Uint32Array.from(I);
    const [remap, n] = MeshoptEncoder.reorderMesh(idx, true, false);
    const P4 = new Int16Array(n * 4), N4 = new Int8Array(n * 4);
    for (let i = 0; i < remap.length; i++) {
      const j = remap[i];
      if (j === 0xffffffff) continue;
      for (let k = 0; k < 3; k++) { P4[j * 4 + k] = P[i * 3 + k]; N4[j * 4 + k] = N[i * 3 + k]; }
    }
    const idx32 = n > 65535, IS = idx32 ? idx : Uint16Array.from(idx);
    const bytes = (t) => new Uint8Array(t.buffer, t.byteOffset, t.byteLength);
    const [pos, posBytes] = push(MeshoptEncoder.encodeVertexBuffer(bytes(P4), n, 8));
    const [nrm, nrmBytes] = push(MeshoptEncoder.encodeVertexBuffer(bytes(N4), n, 4));
    const [ix, idxBytes] = push(MeshoptEncoder.encodeIndexBuffer(bytes(IS), IS.length, idx32 ? 4 : 2));
    return { ...meta, vertices: n, indices: IS.length, idx32, pos, posBytes, nrm, nrmBytes, idx: ix, idxBytes };
  });
  const json = Buffer.from(JSON.stringify(header));
  const hpad = (4 - ((4 + json.length) % 4)) % 4;
  const head = Buffer.alloc(4); head.writeUInt32LE(json.length + hpad);
  return Buffer.concat([head, json, Buffer.alloc(hpad, 0x20), ...chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))]);
}

// reads a .bin in either format back into quantized parts
export async function readModel(buf) {
  const hl = buf.readUInt32LE(0), header = JSON.parse(buf.subarray(4, 4 + hl).toString());
  const base = 4 + hl, ab = buf.buffer.slice(buf.byteOffset + base, buf.byteOffset + buf.byteLength);
  if (header.codec === 'meshopt') throw new Error(`${header.id} is already packed`);
  const parts = header.parts.map((p) => {
    const { pos, nrm, idx, vertices, indices, idx32, ...meta } = p;
    return {
      meta,
      P: new Int16Array(ab.slice(pos, pos + vertices * 6)), N: new Int8Array(ab.slice(nrm, nrm + vertices * 3)),
      I: idx32 ? new Uint32Array(ab.slice(idx, idx + indices * 4)) : new Uint16Array(ab.slice(idx, idx + indices * 2)),
    };
  });
  delete header.parts;
  return { header, parts };
}
