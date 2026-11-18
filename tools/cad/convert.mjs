// Convert CAD exports (STEP, STL, OBJ) into one compact binary per project for the portfolio page.
//
//   cd tools/cad && npm install && npm run models      (writes ../../models)
//   npm run models -- snack snack-phone                 (just those)
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
import { packModel } from './meshpack.mjs';

const HOME = '/Users/asein';
const DL = `${HOME}/Downloads`;
const AP = `${HOME}/Documents/ChatGPT/BrainWave Technology/prototype/cad-v4/exports`;
// Snack's hardware is the Otto R07 build. The rights-clean export is the one cleared for outside review.
const R07 = `${HOME}/Documents/Stealth/hardware/supplier-cad/exports/r07/OTTO_R07_THIN_PHYSICAL_DFM_RIGHTS_CLEAN_R00.step`;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
// Aperture's current design, Experiment 3: the sensor pod on its weekly skin frame, and its charging case, exported
// from Fusion one group per material (see the README beside them). Millimetres, one frame for both: x from the ear
// edge to the back edge, y along the crescent, z up away from the skin. The case is drawn with its lid shut.
const X3 = `${HOME}/Documents/ChatGPT/BrainWave Technology/prototype/cad-x3-pod/exports/portfolio`;
const POD = `${X3}/fullmock`, CASE = `${X3}/case`;
// Those STEP files don't name their bodies, so a few groups are split by shape: copper pads are the paper-thin
// bodies, and bodies(fn) picks the meshes whose bounding box (and index, and count) pass fn.
const bodies = (fn) => (boxes) => boxes.flatMap((b, i) => (fn(b, i, boxes.length) ? [i] : []));
const thin = (b) => b.max.z - b.min.z < 0.07;
// the case lid's hinge: along +y through x -1.15, z 1.00. Fusion has it shut; the page shows it open (turned -105
// degrees, so its front rises and swings back over the hinge) and closes it by turning it back.
const LID = { pivot: [-1.15, 0, 1.0], axis: [0, 1, 0] };
const lidOpen = { ...LID, deg: -105 }, lidShut = { ...LID, deg: 105 };

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

// Snack's hardware is the Otto R07 build (in the file's own coordinates: x across, y up, z from the phone-contact
// plane at 0 to the front glass at 7.6 mm). The LED board is drawn by the page, not the CAD.
const SNACK_PARTS = [
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
];

// The pixel field: 32 by 16 warm-white LEDs under the dead-front glass, lit by the page. src sits on the LED board and
// moves with it; glow is the same light seen on the glass, which only shows while the glass is in place.
const SNACK_LEDS = { cols: 32, rows: 16, x: [-15.82, 15.82], y: [1.32, 16.68], src: { z: 6.17, part: 'pixel-parts' }, glow: { z: 7.66, part: 'glass' } };

// An iPhone 17 Pro to show Snack on. It's built here from the measurements in Apple's accessory drawing rather than
// taken from Apple's own 3D model, which stays reference-only in the Fusion file. Same frame as Otto R07: the phone's
// back glass is z 0, its screen faces -z, and the MagSafe axis (x 0, y 9.70) runs through Snack's ring.
const IPHONE = { w: 71.85, h: 150.01, r: 13.6, cy: 12.435 };
function roundRect(w, h, rb, rt = rb) {
  const s = new THREE.Shape(), x = w / 2, y = h / 2;
  s.moveTo(-x + rb, -y);
  s.lineTo(x - rb, -y); s.absarc(x - rb, -y + rb, rb, -Math.PI / 2, 0);
  s.lineTo(x, y - rt); s.absarc(x - rt, y - rt, rt, 0, Math.PI / 2);
  s.lineTo(-x + rt, y); s.absarc(-x + rt, y - rt, rt, Math.PI / 2, Math.PI);
  s.lineTo(-x, -y + rb); s.absarc(-x + rb, -y + rb, rb, Math.PI, Math.PI * 1.5);
  return s;
}
// a slab w by h from z0 to z1, corner radius r (rt at the top), its edges rounded over by `round`
function slab(w, h, z0, z1, { r, rt = r, round = 0, cx = 0, cy = 0 }) {
  const shape = roundRect(w - 2 * round, h - 2 * round, Math.max(0.05, r - round), Math.max(0.05, rt - round));
  const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0 - 2 * round, bevelEnabled: round > 0, bevelThickness: round, bevelSize: round, bevelSegments: 4, curveSegments: 10 });
  return g.translate(cx, cy, z0 + round);
}
const disc = (d, z0, z1, cx, cy) => new THREE.CylinderGeometry(d / 2, d / 2, z1 - z0, 48).rotateX(Math.PI / 2).translate(cx, cy, (z0 + z1) / 2);
const LENSES = [[-21.56, 73.07], [-21.56, 53.83], [-3.57, 63.45]];
const PHONE_PARTS = [
  { name: 'phone', mat: 'alu', simplify: 6000, gen: () => merge([
    slab(IPHONE.w, IPHONE.h, -8.6, -0.05, { r: IPHONE.r, round: 1.8, cy: IPHONE.cy }),
    // the camera plateau runs the full width from y 43.13 to the top
    slab(IPHONE.w - 1, 43.81, -1, 2.5, { r: 7, rt: IPHONE.r - 0.5, round: 0.7, cy: 65.035 }),
    // action and volume buttons on the left as you hold it, the side button on the right
    ...[[53.16, 6.92], [39.01, 11.22], [24.81, 11.22]].map(([y, l]) => slab(1.2, l, -5.7, -3.04, { r: 0.55, round: 0.3, cx: 35.78, cy: y })),
    slab(1.2, 17.71, -5.7, -3.04, { r: 0.55, round: 0.3, cx: -35.78, cy: 31.91 }),
  ]) },
  { name: 'phone-back', mat: 'frost', gen: () => slab(64.25, 97.44, -0.4, 0, { r: 10.5, cy: -10.05 }) },
  { name: 'phone-screen', mat: 'glass', simplify: 800, gen: () => slab(69.45, 147.61, -8.75, -8.3, { r: 12.6, round: 0.15, cy: IPHONE.cy }) },
  { name: 'phone-lenses', mat: 'chip', gen: () => merge(LENSES.map(([x, y]) => disc(16.21, 2, 4, x, y))) },
  { name: 'phone-glass', mat: 'glass', gen: () => merge([
    ...LENSES.map(([x, y]) => disc(13.86, 3.9, 4.43, x, y)),
    disc(6.69, 2.2, 2.56, 22.11, 53.28), disc(6.74, 2.2, 2.56, 22.11, 73.62),
  ]) },
];

// up: which CAD axis points up. explode: offset per part, in display units (the model spans about 2).
// Electronics are plain blocks at their KiCad positions, as in Fusion; no copper or part markings.
const PROJECTS = [
  // The sensor pod on its skin frame, standing as it's worn behind the ear: the cover toward the camera, the crescent
  // upright (CAD x across, y up, z toward the camera). Only the outside is written, and with no explode offsets: the
  // cell, the flex board, its copper and its parts stay out of the public file so the pod's insides aren't published,
  // and it can't be taken apart on the site. Glue lines are left out.
  { id: 'aperture', up: 'y', parts: [
    { name: 'cover', stl: `${POD}/pod-cover.stl`, mat: 'gloss' },
    { name: 'face', stl: `${POD}/pod-face.stl`, mat: 'matte', simplify: 7000 },
    { name: 'studs', stl: `${POD}/pod-studs.stl`, mat: 'gold', simplify: 2500 },
    { name: 'caps', stl: `${POD}/pod-caps.stl`, mat: 'silver', simplify: 4000 },
    { name: 'window', stl: `${POD}/pod-window.stl`, mat: 'glass' },
    { name: 'pod-magnets', stl: `${POD}/pod-magnets.stl`, mat: 'bright' },
    { name: 'frame-magnets', stl: `${POD}/frame-magnets.stl`, mat: 'bright' },
    { name: 'frame', stl: `${POD}/frame.stl`, mat: 'film' },
  ] },
  // The charging case lying flat with its lid open and the pod docked, in the same frame (so the pod sits in the
  // pocket exactly as it sits on the frame). Matte black outside, grey inside: the shell's faces that look into the
  // case are split off by facing. Take apart lifts the lid and the pod out of the top and drops the board, the cell
  // and the bottom plate out of the bottom, each clear of the last by 3 mm; display y is CAD z.
  { id: 'aperture-case', up: 'z', parts: [
    { name: 'base', stl: `${CASE}/case-base.stl`, mat: 'matte', faces: { away: [13.75, 0, 8] }, simplify: 5000 },
    { name: 'base-inside', stl: `${CASE}/case-base.stl`, mat: 'grey', faces: { toward: [13.75, 0, 8] }, simplify: 5000 },
    { name: 'lid', stl: `${CASE}/case-lid.stl`, mat: 'matte', faces: { away: [13.75, 0, -4] }, pose: lidOpen, hinge: lidShut, explodeMM: [0, 8, 0] },
    { name: 'lid-inside', stl: `${CASE}/case-lid.stl`, mat: 'grey', faces: { toward: [13.75, 0, -4] }, pose: lidOpen, hinge: lidShut, explodeMM: [0, 8, 0] },
    { name: 'lid-magnets', stl: `${CASE}/case-lid-parts.stl`, mat: 'bright', pose: lidOpen, hinge: lidShut, explodeMM: [0, 8, 0] },
    { name: 'hinge-pin', stl: `${CASE}/case-hinge-pin.stl`, mat: 'bright' },
    { name: 'magnets', stl: `${CASE}/case-magnets.stl`, mat: 'bright' },
    { name: 'pins', stl: `${CASE}/case-pins.stl`, mat: 'gold' },
    { name: 'light-pipe', stl: `${CASE}/case-light-pipe.stl`, mat: 'frost' },
    { name: 'pod-cover', stl: `${POD}/pod-cover.stl`, mat: 'gloss', explodeMM: [0, 9, 0] },
    { name: 'pod-face', stl: `${POD}/pod-face.stl`, mat: 'matte', explodeMM: [0, 9, 0], simplify: 7000 },
    { name: 'pod-studs', stl: `${POD}/pod-studs.stl`, mat: 'gold', explodeMM: [0, 9, 0], simplify: 2500 },
    { name: 'pod-caps', stl: `${POD}/pod-caps.stl`, mat: 'silver', explodeMM: [0, 9, 0], simplify: 4000 },
    { name: 'pod-window', stl: `${POD}/pod-window.stl`, mat: 'glass', explodeMM: [0, 9, 0] },
    { name: 'board', stl: `${CASE}/case-board.stl`, mat: 'pcb', explodeMM: [0, -9.7, 0] },
    // the USB-C receptacle's shell is four bodies hanging under the front of the board
    { name: 'usb', step: `${CASE}/case-board-parts.step`, bodies: [67, 76, 85, 94], mat: 'bright', explodeMM: [0, -9.7, 0], simplify: 3000 },
    { name: 'parts', step: `${CASE}/case-board-parts.step`, bodies: bodies((b, i) => !thin(b) && ![67, 76, 85, 94].includes(i)), mat: 'chip', explodeMM: [0, -9.7, 0], simplify: 9000 },
    { name: 'pads', step: `${CASE}/case-board-parts.step`, bodies: bodies(thin), mat: 'gold', explodeMM: [0, -9.7, 0], simplify: 1500 },
    { name: 'cell', stl: `${CASE}/case-cell.stl`, mat: 'cell', explodeMM: [0, -16, 0] },
    { name: 'plate', stl: `${CASE}/case-plate.stl`, mat: 'anodised', explodeMM: [0, -18.7, 0] },
  ] },
  // Version 4 (before Experiment 3), no longer on the site; kept so its model can still be rebuilt.
  // The shell going from its silicone base into the charging case, in one file so the page can fly it between them.
  // The base (leave) fades once the shell has left it.
  // The case sits where it was modelled (the shell's own frame, so the shell seats in its cups untouched), and the base
  // is set 40 mm along x beside it, lowered 4.7 mm so both stand on the same table. The page moves the shell from the
  // base (dock.from) up, over and down into the cups. Centred on the case body so the case holds still while the shell
  // travels; frame is the case's box, for the camera and the platform. Offsets in mm on the display axes (y up).
  { id: 'aperture-dock', up: 'z', center: [-10.8, 0, -4.46], frame: [[-32.29, -27.01, -11.3], [1.66, 27.01, 24.53]],
    dock: { from: [40, 0, -4.72], lift: 14, arc: 9, pivot: [-11.7, 0, 0.875] }, parts: [
    { name: 'case', step: `${AP}/BrainWave v4 - Case.step`, bodies: [0, 62, 65], mat: 'metal' },
    { name: 'lid', step: `${AP}/BrainWave v4 - Case.step`, bodies: [63, 64], mat: 'metal', explodeMM: [0, 3.2, 0],
      hinge: { pivot: [-22.3, 0, 1.3804647], axis: [0, 1, 0], deg: 105 } },
    { name: 'cups', step: `${AP}/BrainWave v4 - Case.step`, bodies: range(1, 7), mat: 'bright' },
    { name: 'board', step: `${AP}/BrainWave v4 - Case.step`, bodies: [9], mat: 'pcb', explodeMM: [0, -11.3, 0] },
    { name: 'cell', step: `${AP}/BrainWave v4 - Case.step`, bodies: [8], mat: 'cell', explodeMM: [0, -16.7, 0] },
    { name: 'usb', step: `${AP}/BrainWave v4 - Case.step`, bodies: [10], mat: 'bright', explodeMM: [0, -11.3, 0] },
    { name: 'parts', step: `${AP}/BrainWave v4 - Case.step`, bodies: range(11, 61), mat: 'chip', explodeMM: [0, -11.3, 0] },
    { name: 'base', step: `${AP}/BrainWave v4 - Base.step`, bodies: [0, 6, 7, 8, 9], mat: 'silicone', move: [40, 0, -4.72], leave: true },
    { name: 'shell-tub', step: `${AP}/BrainWave v4 - Shell.step`, bodies: [1], mat: 'plastic', explodeMM: [0, 13.5, 0], ride: true },
    { name: 'shell-rings', step: `${AP}/BrainWave v4 - Shell.step`, bodies: [2, 3, 4, 5], mat: 'bright', explodeMM: [0, 13.5, 0], ride: true },
    { name: 'shell-cover', step: `${AP}/BrainWave v4 - Shell.step`, bodies: [0], mat: 'metal', explodeMM: [0, 13.5, 0], ride: true },
  ] },
  // front face toward the camera (CAD z runs from the phone-contact plane to the front glass)
  { id: 'snack', up: 'y', leds: SNACK_LEDS, parts: SNACK_PARTS },
  // Snack on the back of the phone. Detach lifts the whole unit straight off the phone for the MagSafe snap; explode
  // fans its layers out away from the phone. This file spans the phone's 150 mm instead of Snack's 78, so the same
  // offsets are about half as many display units, and they're shifted so the rear skin stays on the phone.
  { id: 'snack-phone', up: 'y', leds: SNACK_LEDS, parts: [
    ...PHONE_PARTS,
    ...SNACK_PARTS.map((p) => ({ ...p, explode: [0, 0, +((p.explode[2] + 1) * 0.52).toFixed(3)], detach: [0, 0, 0.32] })),
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
    const ids = typeof p.bodies === 'function' ? p.bodies(meshes.map((m) => new THREE.Box3().setFromArray(m.attributes.position.array))) : p.bodies;
    const geos = ids.map((i) => {
      const m = meshes[i], g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
      if (m.attributes.normal) g.setAttribute('normal', new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
      g.setIndex(Array.from(m.index.array));
      if (!m.attributes.normal) g.computeVertexNormals();
      return g;
    });
    // STEP meshes keep their own smooth normals unless the part needs reshaping
    return p.simplify || p.faces || p.pose ? finish(merge(geos), p) : merge(geos);
  }
  let g = p.gen ? p.gen() : null;
  const readSTL = (file) => { const buf = fs.readFileSync(file); return new STLLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)); };
  if (g) {
    // generated above
  } else if (p.stls) {
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
  return finish(g, p);
}

// keep only the faces that look toward (or away from) a point, then turn the part to its pose; then weld by position,
// simplify while the mesh is still welded, and split it again along hard edges
function finish(g, p) {
  if (p.faces) {
    g = g.index ? g.toNonIndexed() : g;
    const P = g.attributes.position.array, c = new THREE.Vector3(...(p.faces.toward || p.faces.away)), sign = p.faces.toward ? 1 : -1;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3(), keep = [];
    for (let t = 0; t < P.length; t += 9) {
      a.fromArray(P, t); b.fromArray(P, t + 3); d.fromArray(P, t + 6);
      n.subVectors(b, a).cross(d.clone().sub(a));
      const mid = a.clone().add(b).add(d).divideScalar(3);
      if (sign * n.dot(c.clone().sub(mid)) > 0) for (let k = 0; k < 9; k++) keep.push(P[t + k]);
    }
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
  }
  if (p.pose) {
    const piv = new THREE.Vector3(...p.pose.pivot);
    g.translate(-piv.x, -piv.y, -piv.z);
    g.applyMatrix4(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(...p.pose.axis).normalize(), THREE.MathUtils.degToRad(p.pose.deg)));
    g.translate(piv.x, piv.y, piv.z);
  }
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (g.attributes.normal) g.deleteAttribute('normal');
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

const only = process.argv.slice(3);
for (const proj of PROJECTS.filter((p) => !only.length || only.includes(p.id))) {
  const parts = proj.parts.map((p) => {
    const g = loadPart(p);
    if (p.move) g.translate(...p.move); // mm, CAD frame
    if (proj.up === 'z') g.rotateX(-Math.PI / 2); // CAD z-up to three's y-up
    if (proj.rotZ) g.rotateZ(THREE.MathUtils.degToRad(proj.rotZ));
    return { p, g };
  });
  const box = new THREE.Box3();
  for (const { g } of parts) { g.computeBoundingBox(); box.union(g.boundingBox); }
  // points and directions given in CAD coordinates, turned the same way as the geometry
  const turn = (v) => { if (proj.up === 'z') v.applyAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2); if (proj.rotZ) v.applyAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(proj.rotZ)); return v; };
  const size = box.getSize(new THREE.Vector3());
  const center = proj.center ? turn(new THREE.Vector3(...proj.center)) : box.getCenter(new THREE.Vector3());
  const half = proj.center
    ? Math.max(...[box.min, box.max].flatMap((c) => [Math.abs(c.x - center.x), Math.abs(c.y - center.y), Math.abs(c.z - center.z)])) * 1.01
    : Math.max(size.x, size.y, size.z) / 2;
  const toDisplay = (pt) => turn(new THREE.Vector3(...pt)).sub(center).divideScalar(half).toArray().map((v) => +v.toFixed(5));

  const header = { id: proj.id, sizeMM: size.toArray().map((v) => +(v * (proj.unit || 1)).toFixed(1)) }, packed = [];
  for (const { p, g } of parts) {
    g.translate(-center.x, -center.y, -center.z);
    const P = g.attributes.position.array, N = g.attributes.normal.array, n = P.length / 3;
    const q = new Int16Array(P.length), qn = new Int8Array(N.length);
    for (let i = 0; i < P.length; i++) q[i] = Math.round(THREE.MathUtils.clamp(P[i] / half, -1, 1) * 32767);
    for (let i = 0; i < n; i++) {
      const x = N[i * 3], y = N[i * 3 + 1], z = N[i * 3 + 2], l = Math.hypot(x, y, z) || 1;
      qn[i * 3] = Math.round((x / l) * 127); qn[i * 3 + 1] = Math.round((y / l) * 127); qn[i * 3 + 2] = Math.round((z / l) * 127);
    }
    packed.push({ P: q, N: qn, I: g.index.array, meta: {
      name: p.name, mat: p.mat, explode: p.explodeMM ? p.explodeMM.map((v) => +(v / half).toFixed(5)) : p.explode || [0, 0, 0],
      ...(p.detach && { detach: p.detach }), ...(p.ride && { ride: true }), ...(p.leave && { leave: true }),
      ...(p.hinge && { hinge: { p: toDisplay(p.hinge.pivot), a: turn(new THREE.Vector3(...p.hinge.axis)).normalize().toArray().map((v) => +v.toFixed(5)), deg: p.hinge.deg } }),
    } });
  }
  // the LED field as a rectangle in display units (up 'y' projects only: x and y are not turned)
  if (proj.leds) {
    const L = proj.leds, cx = (L.x[0] + L.x[1]) / 2, cy = (L.y[0] + L.y[1]) / 2;
    header.leds = {
      cols: L.cols, rows: L.rows, w: +((L.x[1] - L.x[0]) / half).toFixed(5), h: +((L.y[1] - L.y[0]) / half).toFixed(5),
      src: { at: toDisplay([cx, cy, L.src.z]), part: L.src.part }, glow: { at: toDisplay([cx, cy, L.glow.z]), part: L.glow.part },
    };
  }
  // the box the camera and the platform frame, when it isn't the whole model
  if (proj.frame) {
    const fb = new THREE.Box3();
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) fb.expandByPoint(new THREE.Vector3(...toDisplay([proj.frame[x][0], proj.frame[y][1], proj.frame[z][2]])));
    header.frame = { min: fb.min.toArray().map((v) => +v.toFixed(5)), max: fb.max.toArray().map((v) => +v.toFixed(5)) };
  }
  // where the riding parts start (an offset from where they sit), how high they lift and arc, and what they turn about
  if (proj.dock) {
    const D = proj.dock, unit = (v) => turn(new THREE.Vector3(...v)).divideScalar(half).toArray().map((x) => +x.toFixed(5));
    header.dock = { from: unit(D.from), lift: +(D.lift / half).toFixed(5), arc: +(D.arc / half).toFixed(5), pivot: toDisplay(D.pivot) };
  }
  const file = path.join(outDir, `${proj.id}.bin`);
  fs.writeFileSync(file, packModel(header, packed));
  const tris = header.parts.reduce((s, x) => s + x.indices / 3, 0);
  console.log(`${proj.id.padEnd(12)} ${(fs.statSync(file).size / 1024).toFixed(0).padStart(5)} KB  ${tris} tris  ${header.sizeMM.join(' x ')} mm`);
}
