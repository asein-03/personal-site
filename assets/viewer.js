/* CAD viewer: each <figure class="viewer" data-model="…"> gets a small three.js scene of that model.
   The figure holds a still render (its poster, from tools/renders) that shows at once and stays if WebGL is
   missing; the live model fades in over it once it has loaded. Drag to turn it; models with exploded part
   positions get a "Take apart" button, and models with a hinged lid get "Close the lid".

   data-model     the file in /models, packed by tools/cad/meshpack.mjs
   data-yaw/pitch the opening view, in degrees (the poster is rendered from the same view)
   data-zoom      >1 brings the model closer
   data-fit       "box" fits a long model's length across the frame instead of its bounding sphere
   data-axis      "x" turns the model about its long axis instead of upright
   data-explode   start apart (0 to 1) */
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const D2R = Math.PI / 180;
const FOV = 28;
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(pointer: coarse)');
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// finishes, tuned to read on a light page: dark bead-blasted metal, satin plastics, plated contacts
const PHYS = (o) => () => new THREE.MeshPhysicalMaterial(o);
const MATERIALS = {
  metal: PHYS({ color: 0x66676c, metalness: 1, roughness: 0.34, clearcoat: 0.3, clearcoatRoughness: 0.3, envMapIntensity: 1 }),
  plastic: PHYS({ color: 0x4a4a4d, metalness: 0, roughness: 0.62, clearcoat: 0.15, envMapIntensity: 1.1 }),
  silicone: PHYS({ color: 0xc9c7c2, metalness: 0, roughness: 0.62, sheen: 0.5, sheenRoughness: 0.8, envMapIntensity: 0.9 }),
  glass: PHYS({ color: 0x141416, metalness: 0, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.2 }),
  pcb: PHYS({ color: 0x1f3d2b, metalness: 0.1, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 1 }),
  chip: PHYS({ color: 0x141414, metalness: 0, roughness: 0.38, envMapIntensity: 1 }),
  cell: PHYS({ color: 0x9a9a98, metalness: 0.7, roughness: 0.4, envMapIntensity: 1.2 }),
  bright: PHYS({ color: 0xcfcfcd, metalness: 1, roughness: 0.25, envMapIntensity: 1.3 }),
  diffuser: PHYS({ color: 0xe4e2dd, metalness: 0, roughness: 0.55, envMapIntensity: 0.9 }),
  print: PHYS({ color: 0xb9b6ae, metalness: 0, roughness: 0.72, envMapIntensity: 1 }),
  alu: PHYS({ color: 0xb4b4b2, metalness: 1, roughness: 0.38, envMapIntensity: 1.2 }),
  frost: PHYS({ color: 0xc2c1bc, metalness: 0, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.4, envMapIntensity: 1 }),
};

/* ---------- lighting: a white studio sweep with three softboxes, blurred into reflections ----------
   Bright from above, grey toward the floor, so dark metal still shows its form on a light page. */
function studio(renderer) {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main() { vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP;
      void main() {
        float y = vP.y;
        vec3 c = mix(vec3(0.2), vec3(0.8), smoothstep(-0.5, 0.2, y));
        c = mix(c, vec3(1.05), smoothstep(0.15, 0.9, y));
        gl_FragColor = vec4(c, 1.0);
      }`,
  })));
  const box = (w, h, pos, level) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(level, level, level), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); scene.add(m);
  };
  box(7, 3.5, [-4, 5, 5], 5);   // key, above and to the left of the camera
  box(3, 7, [7, 1.5, -1], 3);   // a strip on the right for an edge highlight
  box(9, 2.5, [0, 3, -7], 2);   // behind, for rims
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(scene, 0.02).texture;
  pm.dispose();
  return tex;
}

/* ---------- models: fetched once, shared by every viewer on the page ---------- */
const models = new Map();
function unpack(buf, base, p) {
  const src = (o, n) => new Uint8Array(buf, base + o, n), n = p.vertices;
  const P4 = new Int16Array(n * 4), N4 = new Int8Array(n * 4), I = p.idx32 ? new Uint32Array(p.indices) : new Uint16Array(p.indices);
  MeshoptDecoder.decodeVertexBuffer(new Uint8Array(P4.buffer), n, 8, src(p.pos, p.posBytes));
  MeshoptDecoder.decodeVertexBuffer(new Uint8Array(N4.buffer), n, 4, src(p.nrm, p.nrmBytes));
  MeshoptDecoder.decodeIndexBuffer(new Uint8Array(I.buffer), p.indices, p.idx32 ? 4 : 2, src(p.idx, p.idxBytes));
  const P = new Int16Array(n * 3), N = new Int8Array(n * 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { P[i * 3 + k] = P4[i * 4 + k]; N[i * 3 + k] = N4[i * 4 + k]; }
  return { P, N, I };
}
function loadModel(id) {
  if (!models.has(id)) models.set(id, fetch(`/models/${id}.bin`).then((r) => { if (!r.ok) throw new Error(id); return r.arrayBuffer(); }).then(async (buf) => {
    const hl = new DataView(buf).getUint32(0, true);
    const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)));
    const base = 4 + hl;
    if (head.codec === 'meshopt') await MeshoptDecoder.ready;
    const parts = head.parts.map((p) => {
      const { P, N, I } = head.codec === 'meshopt' ? unpack(buf, base, p) : {
        P: new Int16Array(buf, base + p.pos, p.vertices * 3), N: new Int8Array(buf, base + p.nrm, p.vertices * 3),
        I: p.idx32 ? new Uint32Array(buf, base + p.idx, p.indices) : new Uint16Array(buf, base + p.idx, p.indices),
      };
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P, 3, true));
      g.setAttribute('normal', new THREE.BufferAttribute(N, 3, true));
      g.setIndex(new THREE.BufferAttribute(I, 1));
      g.computeBoundingBox();
      const hinge = p.hinge && { p: new THREE.Vector3(...p.hinge.p), a: new THREE.Vector3(...p.hinge.a).normalize(), deg: p.hinge.deg };
      return { name: p.name, mat: p.mat, g, explode: new THREE.Vector3(...(p.explode || [0, 0, 0])), hinge };
    });
    // how far the model reaches, together and taken apart, so the camera can keep it all in frame
    const together = new THREE.Box3(), apart = new THREE.Box3();
    for (const p of parts) { together.union(p.g.boundingBox); apart.union(p.g.boundingBox.clone().translate(p.explode)); }
    const sphere = (b) => b.getBoundingSphere(new THREE.Sphere()).radius;
    return { id, head, parts, box: together, r0: sphere(together), r1: sphere(apart), explodes: parts.some((p) => p.explode.lengthSq() > 1e-6), hinged: parts.some((p) => p.hinge) };
  }));
  return models.get(id);
}

/* ---------- one viewer ---------- */
class Viewer {
  constructor(el) {
    const d = el.dataset;
    this.el = el;
    this.id = d.model;
    this.yaw = +(d.yaw || 0); this.pitch = +(d.pitch || 0); this.zoom = +(d.zoom || 1);
    this.fit = d.fit || 'sphere'; this.axis = d.axis || 'y';
    this.ex = this.exTo = +(d.explode || 0);
    this.lid = this.lidTo = 0;
    this.user = { yaw: 0, pitch: 0 }; this.spin = 0; this.idleAt = 0;
    this.still = 'still' in d;
    this.visible = false;
  }
  async start() {
    const m = await loadModel(this.id);
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: this.still }); } catch { return; }
    this.m = m; this.renderer = renderer;
    renderer.setPixelRatio(this.still ? 1 : Math.min(devicePixelRatio || 1, coarse.matches ? 1.75 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.className = 'live';
    canvas.setAttribute('aria-hidden', 'true');
    this.el.querySelector('.stage').append(canvas);

    const scene = this.scene = new THREE.Scene();
    scene.environment = studio(renderer);
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(-2, 3, 4); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.8); rim.position.set(3, 1.5, -3); scene.add(rim);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 50);
    this.pivot = new THREE.Group(); this.spinner = new THREE.Group();
    this.pivot.add(this.spinner); scene.add(this.pivot);
    this.parts = m.parts.map((p) => {
      const mesh = new THREE.Mesh(p.g, (MATERIALS[p.mat] || MATERIALS.metal)());
      this.spinner.add(mesh);
      return { ...p, mesh };
    });

    this.controls();
    new ResizeObserver(() => this.resize()).observe(this.el.querySelector('.stage'));
    this.resize();
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) this.loop(); }, { rootMargin: '120px' }).observe(this.el);
    this.frame(0);
    this.el.classList.add('is-live');
    this.ready = true;
  }
  controls() {
    const { el, m } = this;
    const ex = el.querySelector('[data-act="explode"]'), lid = el.querySelector('[data-act="lid"]');
    if (ex && m.explodes) {
      ex.hidden = false;
      const label = () => { ex.textContent = this.exTo > 0.5 ? 'Put together' : 'Take apart'; ex.setAttribute('aria-pressed', String(this.exTo > 0.5)); };
      ex.addEventListener('click', () => { this.exTo = this.exTo > 0.5 ? 0 : 1; label(); this.kick(); });
      label();
    }
    if (lid && m.hinged) {
      lid.hidden = false;
      const label = () => { lid.textContent = this.lidTo > 0.5 ? 'Open the lid' : 'Close the lid'; lid.setAttribute('aria-pressed', String(this.lidTo > 0.5)); };
      lid.addEventListener('click', () => { this.lidTo = this.lidTo > 0.5 ? 0 : 1; label(); this.kick(); });
      label();
    }
    // drag to turn; vertical drags on touch screens still scroll the page
    const stage = el.querySelector('.stage');
    let drag = null;
    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      stage.setPointerCapture(e.pointerId);
      el.classList.add('is-dragging');
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      this.user.yaw += (e.clientX - drag.x) * 0.45;
      this.user.pitch = clamp(this.user.pitch + (e.clientY - drag.y) * 0.3, -40 - this.pitch, 60 - this.pitch);
      drag.x = e.clientX; drag.y = e.clientY;
      this.idleAt = performance.now();
      el.classList.add('was-turned');
      this.kick();
    });
    const end = () => { drag = null; el.classList.remove('is-dragging'); this.idleAt = performance.now(); };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
  }
  resize() {
    const stage = this.el.querySelector('.stage');
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.kick();
  }
  kick() { if (this.visible) this.loop(); else this.frame(0); }
  loop() {
    if (this.loopOn) return;
    this.loopOn = true;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const moving = this.frame(dt);
      // turn on its own unless someone just turned it, or motion is reduced; stop drawing when nothing changes
      if (this.visible && !document.hidden && (moving || !reduce.matches)) requestAnimationFrame(tick);
      else this.loopOn = false;
    };
    requestAnimationFrame(tick);
  }
  frame(dt) {
    const { m } = this;
    this.t = (this.t || 0) + dt;
    const k = 1 - Math.exp(-dt * 6);
    const before = this.ex + this.lid;
    this.ex = lerp(this.ex, this.exTo, k); if (Math.abs(this.ex - this.exTo) < 1e-3) this.ex = this.exTo;
    this.lid = lerp(this.lid, this.lidTo, k); if (Math.abs(this.lid - this.lidTo) < 1e-3) this.lid = this.lidTo;
    const resting = performance.now() - this.idleAt > 2500;
    if (!reduce.matches && !this.still && resting) this.spin += dt * 0.22;

    this.pivot.rotation.set((this.pitch + this.user.pitch) * D2R, 0, 0);
    const yaw = (this.yaw + this.user.yaw) * D2R;
    if (this.axis === 'x') this.spinner.rotation.set(this.spin, yaw, 0, 'YXZ');
    else this.spinner.rotation.set(0, yaw + this.spin, 0);
    const tmp = new THREE.Vector3();
    for (const p of this.parts) {
      p.mesh.position.copy(p.explode).multiplyScalar(this.ex);
      if (!p.hinge) continue;
      p.mesh.quaternion.setFromAxisAngle(p.hinge.a, p.hinge.deg * D2R * this.lid);
      p.mesh.position.add(p.hinge.p).sub(tmp.copy(p.hinge.p).applyQuaternion(p.mesh.quaternion));
    }

    // frame the model: its bounding sphere, or for long models its length across the width
    const cam = this.camera, vt = Math.tan((FOV / 2) * D2R), r = lerp(m.r0, m.r1, this.ex);
    let dist;
    if (this.fit === 'box') {
      const hx = Math.max(-m.box.min.x, m.box.max.x) * (1 + 0.3 * this.ex);
      const hyz = Math.max(-m.box.min.y, m.box.max.y, -m.box.min.z, m.box.max.z) + 0.22 * this.ex;
      dist = Math.max(hx / (vt * cam.aspect * 0.86), hyz / (vt * 0.6)) + hyz;
    } else dist = Math.max(r / (vt * 0.92), r / (vt * cam.aspect * 0.92));
    cam.position.set(0, 0, dist / this.zoom);
    cam.lookAt(0, 0, 0);
    this.renderer.render(this.scene, cam);
    return Math.abs(this.ex + this.lid - before) > 1e-4 || this.ex !== this.exTo || this.lid !== this.lidTo;
  }
  // a still of the opening view, for posters
  snapshot(type = 'image/webp', quality = 0.9) {
    this.spin = 0; this.user.yaw = this.user.pitch = 0;
    this.frame(0);
    return this.renderer.domElement.toDataURL(type, quality);
  }
}

/* ---------- start each viewer as it nears the screen ---------- */
const viewers = [...document.querySelectorAll('.viewer[data-model]')].map((el) => (el.viewer = new Viewer(el)));
const near = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) {
    near.unobserve(e.target);
    e.target.viewer.started = e.target.viewer.start().catch(() => {});
  }
}, { rootMargin: '400px 0px' });
viewers.forEach((v) => near.observe(v.el));
window.viewers = viewers;
