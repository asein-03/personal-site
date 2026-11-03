// Convert CAD exports (STEP, STL, OBJ) into one compact binary per project for the portfolio page.
//
//   cd tools/cad && npm install && npm run models      (writes ../../models)
//
// The source paths below point at the CAD folders on Albert's Mac. To add a project, add an entry
// to PROJECTS and a chapter (or a .thumb) with the same id in index.html.
//
// Each .bin is: uint32 header length, a JSON header, padding to 4 bytes, then per part
// int16 positions (normalized to the project's bounding cube), int8 normals and uint16/uint32 indices.
// Only the bodies listed below are written, so internal parts stay out of the public page.
import fs from 'node:fs';
import path from 'node:path';
import occtFactory from 'occt-import-js';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer';

const HOME = '/Users/asein';
const DL = `${HOME}/Downloads`;
const AP = `${HOME}/Documents/ChatGPT/BrainWave Technology/prototype/cad-v4/exports`;
// Snack's hardware is the Otto R07 build. The rights-clean export is the one cleared for outside review.
const R07 = `${HOME}/Documents/Stealth/hardware/supplier-cad/exports/r07/OTTO_R07_THIN_PHYSICAL_DFM_RIGHTS_CLEAN_R00.step`;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// Project Skyfall, a TVC model rocket from high school. These STLs were exported from the Fusion document
// "Project Skyfall Prototype 2 Assembly" into sources/skyfall (kept out of git). Each top-level part comes out in its
// own coordinates, so it carries its placement in the assembly: Fusion's transform2, row-major, translation in mm.
const SKY = new URL('./sources/skyfall/', import.meta.url).pathname;
const SKY_AT = {
  occ00: [0, 1, 0, 12.35, 0, 0, 1, 31.1, 1, 0, 0, 29.2, 0, 0, 0, 1],
  occ01: [1, 0, 0, 34.375, 0, 0, 1, 10.17493, 0, -1, 0, -19.59841, 0, 0, 0, 1],
  occ02: [0, 0, 1, -1.7441, 0, 1, 0, 365.5, -1, 0, 0, -0.25551, 0, 0, 0, 1],
  occ03: [0, 0, 1, -1.7441, 0, 1, 0, 65.5, -1, 0, 0, -0.20551, 0, 0, 0, 1],
  occ04: [1, 0, 0, -1.3, 0, -1, 0, 60.73041, 0, 0, -1, -1.20002, 0, 0, 0, 1],
  occ05: [1, 0, 0, -1.225, 0, 1, 0, 5.23041, 0, 0, 1, -1.32502, 0, 0, 0, 1],
  occ06: [0, 1, 0, -19.48581, 0, 0, -1, -1.32474, -1, 0, 0, -1.29769, 0, 0, 0, 1],
  occ07: [0, 0, -1, 1.275, 0, 1, 0, 3.6835, 1, 0, 0, -1.15002, 0, 0, 0, 1],
  occ08: [1, 0, 0, -1.95797, 0, 1, 0, -2.18771, 0, 0, 1, -0.15146, 0, 0, 0, 1],
  occ09: [1, 0, 0, -1.39562, 0, 1, 0, -1.16959, 0, 0, 1, 40.07888, 0, 0, 0, 1],
};
const sky = (file) => ({ file: `${SKY}${file}.stl`, m: SKY_AT[file.slice(0, 5)] });

// up: which CAD axis points up. explode: offset per part, in display units (the model spans about 2).
// Electronics are plain blocks at their KiCad positions, as in Fusion; no copper or part markings.
const PROJECTS = [
  // the shell's face toward the camera, its length upright (CAD x across, y along, z out of the face)
  { id: 'aperture', up: 'y', parts: [
    { name: 'base', step: `${AP}/BrainWave v4 - Base.step`, bodies: [0, 6, 7, 8, 9], mat: 'silicone', explode: [0, 0, -0.42] },
    { name: 'tub', step: `${AP}/BrainWave v4 - Shell.step`, bodies: [1], mat: 'plastic', explode: [0, 0, 0.04] },
    { name: 'boards', step: `${AP}/BrainWave v4 - Electronics.step`, bodies: [0, 1, 2], mat: 'pcb', explode: [0, 0, 0.36] },
    { name: 'cell', step: `${AP}/BrainWave v4 - Electronics.step`, bodies: [3], mat: 'cell', explode: [0, 0, 0.36] },
    { name: 'rings', step: `${AP}/BrainWave v4 - Electronics.step`, bodies: [4, 5, 6, 7], mat: 'bright', explode: [0, 0, 0.36] },
    { name: 'parts', step: `${AP}/BrainWave v4 - Electronics.step`, bodies: range(8, 54), mat: 'chip', explode: [0, 0, 0.36] },
    { name: 'cover', step: `${AP}/BrainWave v4 - Shell.step`, bodies: [0], mat: 'metal', explode: [0, 0, 0.72] },
  ] },
  // the charging case lying flat with its lid open, as built in Fusion; the shell seats in its cups
  { id: 'aperture-case', up: 'z', parts: [
    { name: 'case', step: `${AP}/BrainWave v4 - Case.step`, bodies: [0, 62, 65], mat: 'metal', explode: [0, 0, 0] },
    { name: 'lid', step: `${AP}/BrainWave v4 - Case.step`, bodies: [63, 64], mat: 'metal', explode: [0, 0.12, 0] },
    { name: 'cups', step: `${AP}/BrainWave v4 - Case.step`, bodies: range(1, 7), mat: 'bright', explode: [0, 0, 0] },
    { name: 'board', step: `${AP}/BrainWave v4 - Case.step`, bodies: [9], mat: 'pcb', explode: [0, -0.42, 0] },
    { name: 'cell', step: `${AP}/BrainWave v4 - Case.step`, bodies: [8], mat: 'cell', explode: [0, -0.62, 0] },
    { name: 'usb', step: `${AP}/BrainWave v4 - Case.step`, bodies: [10], mat: 'bright', explode: [0, -0.42, 0] },
    { name: 'parts', step: `${AP}/BrainWave v4 - Case.step`, bodies: range(11, 61), mat: 'chip', explode: [0, -0.42, 0] },
    { name: 'shell-tub', step: `${AP}/BrainWave v4 - Shell.step`, bodies: [1], mat: 'plastic', explode: [0, 0.5, 0] },
    { name: 'shell-rings', step: `${AP}/BrainWave v4 - Shell.step`, bodies: [2, 3, 4, 5], mat: 'bright', explode: [0, 0.5, 0] },
    { name: 'shell-cover', step: `${AP}/BrainWave v4 - Shell.step`, bodies: [0], mat: 'metal', explode: [0, 0.5, 0] },
  ] },
  // front face toward the camera (CAD z runs from the phone-contact plane to the front glass)
  { id: 'snack', up: 'y', parts: [
    { name: 'skin', step: R07, bodies: [0, 1, 2, 23], mat: 'plastic', explode: [0, 0, -1] },
    { name: 'ring', step: R07, bodies: range(17, 22), mat: 'bright', explode: [0, 0, -0.7] },
    { name: 'cell', step: R07, bodies: [...range(12, 16), 30, 31], mat: 'cell', explode: [0, 0, -0.46] },
    { name: 'board', step: R07, bodies: [40], mat: 'pcb', explode: [0, 0, -0.2] },
    { name: 'usb', step: R07, bodies: range(41, 58), mat: 'bright', explode: [0, 0, -0.2] },
    { name: 'parts', step: R07, bodies: [38, 39, ...range(59, 73), ...range(87, 90), ...range(92, 98)], mat: 'chip', explode: [0, 0, -0.2] },
    { name: 'frame', step: R07, bodies: [3, 4, 5, 6, 7, 10, 11, 91], mat: 'metal', explode: [0, 0, 0] },
    { name: 'hardware', step: R07, bodies: [...range(24, 29), ...range(32, 37), ...range(99, 110)], mat: 'bright', explode: [0, 0, 0] },
    { name: 'pixel-board', step: R07, bodies: [74], mat: 'pcb', explode: [0, 0, 0.26] },
    { name: 'pixel-parts', step: R07, bodies: range(75, 81), mat: 'chip', explode: [0, 0, 0.26] },
    { name: 'display', step: R07, bodies: range(82, 86), mat: 'diffuser', explode: [0, 0, 0.48] },
    { name: 'glass', step: R07, bodies: [8, 9], mat: 'glass', explode: [0, 0, 0.76] },
  ] },
  // the OBJ is in centimetres
  { id: 'ordo', up: 'y', unit: 10, parts: [
    { name: 'base', obj: `${DL}/Ordo Desktop FULL.obj`, group: 'Base Plate', mat: 'plastic', explode: [0, -0.32, 0] },
    { name: 'hull', obj: `${DL}/Ordo Desktop FULL.obj`, group: 'Body Hull', mat: 'metal', explode: [0, 0.08, 0] },
    { name: 'display', obj: `${DL}/Ordo Desktop FULL.obj`, group: 'Display', mat: 'glass', explode: [0, 0.08, 0.4] },
  ] },
  // laid on its side (rotZ) so it fits a wide brief; the nose points right
  { id: 'skyfall', up: 'y', rotZ: -90, parts: [
    { name: 'nose', stls: [sky('occ02_Project_Skyfall_Nose_Cone_Part_1_Proto_2_1')], mat: 'print', explode: [0.3, 0, 0], simplify: 4000 },
    { name: 'airframe', stls: [sky('occ03_Project_Skyfall_2_PE_Pipe_Body_1')], mat: 'diffuser', explode: [0.12, 0, 0], simplify: 2500 },
    { name: 'thruster', stls: [sky('occ08_Project_Skyfall_Rocket_Thruster_Body_Part_1_PROTOTYPE_2_1')], mat: 'print', explode: [0, 0, 0], simplify: 5000 },
    { name: 'gimbal', stls: [
      sky('occ04_Project_Skyfall_TVC_Piece_1_1'), sky('occ05_Project_Skyfall_Piece_4_1'), sky('occ06_Project_Skyfall_TVC_Piece_2_1'),
      sky('occ07_Project_Skyfall_TVC_Inner_Mount_Prototype_2_1'), sky('occ09_Project_Skyfall_Outer_Gimbal_ATTACHMENT_ONLY_1'),
      ...['root_Body1', 'root_Body4', 'root_Body13', 'root_Body14', 'root_Body15', 'root_Body16'].map((f) => ({ file: `${SKY}${f}.stl` })),
    ], mat: 'metal', explode: [-0.14, 0, 0], simplify: 14000 },
    { name: 'servo-a', stls: [sky('occ00_SG90_Tower_Pro_Servo_Motor_1')], mat: 'plastic', explode: [-0.1, 0, 0.2], simplify: 2500 },
    { name: 'servo-b', stls: [sky('occ01_SG90_Tower_Pro_Servo_Motor_2')], mat: 'plastic', explode: [-0.1, -0.2, -0.04], simplify: 2500 },
  ] },
  { id: 'portafilter', up: 'y', parts: [{ name: 'body', stl: `${DL}/Bottomless_Portafilterv2.stl`, mat: 'metal', simplify: 12000 }] },
  { id: 'topology', up: 'y', parts: [{ name: 'body', stl: `${DL}/Assignment 3.stl`, mat: 'metal' }] },
];

const occt = await occtFactory();
const stepCache = new Map();
const objCache = new Map();

function readStep(file) {
  if (!stepCache.has(file)) {
    const r = occt.ReadStepFile(new Uint8Array(fs.readFileSync(file)), {
      linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.0009, angularDeflection: 0.3,
    });
    if (!r.success) throw new Error(`could not read ${file}`);
    stepCache.set(file, r.meshes);
  }
  return stepCache.get(file);
}

// A geometry with position + normal, indexed, in CAD coordinates (mm).
function loadPart(p) {
  if (p.step) {
    const meshes = readStep(p.step);
    const geos = p.bodies.map((i) => {
      const m = meshes[i], g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
      if (m.attributes.normal) g.setAttribute('normal', new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
      g.setIndex(Array.from(m.index.array));
      if (!m.attributes.normal) g.computeVertexNormals();
      return g;
    });
    return merge(geos);
  }
  let g;
  const readSTL = (file) => { const buf = fs.readFileSync(file); return new STLLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)); };
  if (p.stls) {
    // several STLs as one part, each moved to its place in the assembly first
    g = merge(p.stls.map(({ file, m }) => { const s = readSTL(file); if (m) s.applyMatrix4(new THREE.Matrix4().set(...m)); return s; }));
  } else if (p.stl) {
    const buf = fs.readFileSync(p.stl);
    g = new STLLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  } else if (p.obj) {
    if (!objCache.has(p.obj)) objCache.set(p.obj, new OBJLoader().parse(fs.readFileSync(p.obj, 'utf8')));
    const meshes = objCache.get(p.obj).children.filter((c) => c.name === p.group);
    if (!meshes.length) throw new Error(`no group ${p.group} in ${p.obj}`);
    g = merge(meshes.map((m) => m.geometry.index ? m.geometry.toNonIndexed() : m.geometry));
  }
  // weld by position, simplify while the mesh is still welded, then split it again along hard edges
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = simplify(mergeVertices(g, 1e-4), p.simplify);
  g = toCreasedNormals(g.toNonIndexed(), THREE.MathUtils.degToRad(32));
  return mergeVertices(g, 1e-4);
}

function merge(geos) {
  const nv = geos.reduce((n, g) => n + g.attributes.position.count, 0);
  const ni = geos.reduce((n, g) => n + (g.index ? g.index.count : g.attributes.position.count), 0);
  const withNormals = geos.every((g) => g.attributes.normal);
  const pos = new Float32Array(nv * 3), nrm = withNormals ? new Float32Array(nv * 3) : null, idx = new Uint32Array(ni);
  let v = 0, k = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, v * 3);
    if (nrm) nrm.set(g.attributes.normal.array, v * 3);
    if (g.index) for (const i of g.index.array) idx[k++] = i + v;
    else for (let i = 0; i < n; i++) idx[k++] = i + v;
    v += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (nrm) out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function simplify(g, target) {
  const tris = g.index.count / 3;
  if (!target || tris <= target) return g;
  const idx = new Uint32Array(g.index.array);
  const pos = new Float32Array(g.attributes.position.array);
  const [out] = MeshoptSimplifier.simplify(idx, pos, 3, target * 3, 0.002, ['LockBorder']);
  g.setIndex(Array.from(out));
  return g;
}

await MeshoptSimplifier.ready;
const outDir = process.argv[2];
fs.mkdirSync(outDir, { recursive: true });

for (const proj of PROJECTS) {
  const parts = proj.parts.map((p) => {
    const g = loadPart(p);
    if (proj.up === 'z') g.rotateX(-Math.PI / 2); // CAD z-up to three's y-up
    if (proj.rotZ) g.rotateZ(THREE.MathUtils.degToRad(proj.rotZ));
    return { p, g };
  });
  const box = new THREE.Box3();
  for (const { g } of parts) { g.computeBoundingBox(); box.union(g.boundingBox); }
  const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const half = Math.max(size.x, size.y, size.z) / 2;

  const chunks = [], header = { id: proj.id, sizeMM: size.toArray().map((v) => +(v * (proj.unit || 1)).toFixed(1)), parts: [] };
  let offset = 0;
  const push = (typed) => { const o = offset; chunks.push(typed); offset += typed.byteLength; const pad = (4 - (offset % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); offset += pad; } return o; };
  for (const { p, g } of parts) {
    g.translate(-center.x, -center.y, -center.z);
    const P = g.attributes.position.array, N = g.attributes.normal.array, n = P.length / 3;
    const q = new Int16Array(P.length), qn = new Int8Array(N.length);
    for (let i = 0; i < P.length; i++) q[i] = Math.round(THREE.MathUtils.clamp(P[i] / half, -1, 1) * 32767);
    for (let i = 0; i < n; i++) {
      const x = N[i * 3], y = N[i * 3 + 1], z = N[i * 3 + 2], l = Math.hypot(x, y, z) || 1;
      qn[i * 3] = Math.round((x / l) * 127); qn[i * 3 + 1] = Math.round((y / l) * 127); qn[i * 3 + 2] = Math.round((z / l) * 127);
    }
    const idx32 = n > 65535, I = idx32 ? new Uint32Array(g.index.array) : new Uint16Array(g.index.array);
    header.parts.push({
      name: p.name, mat: p.mat, explode: p.explode || [0, 0, 0], vertices: n, indices: I.length, idx32,
      pos: push(q), nrm: push(qn), idx: push(I),
    });
  }
  const json = Buffer.from(JSON.stringify(header));
  const hpad = (4 - ((4 + json.length) % 4)) % 4;
  const head = Buffer.alloc(4); head.writeUInt32LE(json.length + hpad);
  const file = path.join(outDir, `${proj.id}.bin`);
  fs.writeFileSync(file, Buffer.concat([head, json, Buffer.alloc(hpad, 0x20), ...chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))]));
  const tris = header.parts.reduce((s, x) => s + x.indices / 3, 0);
  console.log(`${proj.id.padEnd(12)} ${(fs.statSync(file).size / 1024).toFixed(0).padStart(5)} KB  ${tris} tris  ${header.sizeMM.join(' x ')} mm`);
}
