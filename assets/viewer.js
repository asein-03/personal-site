/* CAD viewer: each <figure class="viewer" data-model="…"> gets a small three.js scene of that model.
   The figure holds a still render (its poster, from tools/renders) that shows at once and stays if WebGL is
   missing; the live model fades in over it once it has loaded. Drag to turn it; models with exploded part
   positions get a "Take apart" button, and models with a hinged lid get "Close the lid".

   data-model     the file in /models, packed by tools/cad/meshpack.mjs
   data-v         its version, written by tools/stamp.mjs so a new model isn't hidden by a cached old one
   data-yaw/pitch the opening view, in degrees (the poster is rendered from the same view)
   data-zoom      >1 brings the model closer
   data-fit       "box" fits a long model's length across the frame instead of its bounding sphere
   data-axis      "x" turns the model about its long axis instead of upright
   data-explode   start apart (0 to 1)
   data-ground    stand the model on a floor that catches its shadow */
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const D2R = Math.PI / 180;
const FOV = 28;
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(pointer: coarse)');
const lerp = (a, b, t) => a + (b - a) * t;
const KEY = new THREE.Vector3(-2, 3, 4).setLength(8);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// finishes, tuned to read on a light page: dark bead-blasted metal, satin plastics, plated contacts
const PHYS = (o) => () => new THREE.MeshPhysicalMaterial(o);
const MATERIALS = {
  gloss: PHYS({ color: 0x0c0c0e, metalness: 0, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.25 }),
  matte: PHYS({ color: 0x222224, metalness: 0, roughness: 0.6, envMapIntensity: 1 }),
  grey: PHYS({ color: 0x737371, metalness: 0, roughness: 0.68, envMapIntensity: 0.9 }),
  gold: PHYS({ color: 0xe3b65c, metalness: 1, roughness: 0.22, envMapIntensity: 1.25 }),
  copper: PHYS({ color: 0xd08c5e, metalness: 1, roughness: 0.3, envMapIntensity: 1.15 }),
  polyimide: PHYS({ color: 0xb06c16, metalness: 0, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.18, envMapIntensity: 1 }),
  silver: PHYS({ color: 0xa8a8a5, metalness: 0.55, roughness: 0.48, envMapIntensity: 1.1 }),
  film: PHYS({ color: 0xe8e3d8, metalness: 0, roughness: 0.45, transparent: true, opacity: 0.82, envMapIntensity: 0.9 }),
  anodised: PHYS({ color: 0x2b2b2e, metalness: 0.8, roughness: 0.42, envMapIntensity: 1 }),
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

/* ---------- lighting: a product studio, blurred into reflections ----------
   Grey walls that fall to near black below, and big bright softboxes: one above and to the left of the camera, a
   tall strip on the right, one overhead and one behind. Glossy black then stays black and carries crisp highlights,
   and metals have something to reflect. */
function studio(renderer) {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main() { vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP;
      void main() {
        float y = vP.y;
        vec3 c = mix(vec3(0.04), vec3(0.3), smoothstep(-0.6, 0.05, y));
        c = mix(c, vec3(0.5), smoothstep(0.1, 0.95, y));
        gl_FragColor = vec4(c, 1.0);
      }`,
  })));
  const box = (w, h, pos, level) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(level, level, level), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); scene.add(m);
  };
  box(8, 5, [-5, 5, 5], 6);      // key, above and to the left of the camera
  box(2.4, 9, [7, 1, 2], 5);     // a tall strip on the right, for a clean edge highlight
  box(8, 8, [0, 9, 0], 2.2);     // overhead
  box(10, 3, [0, 3, -7], 3);     // behind, for rims
  box(12, 3, [0, -1.5, 8], 1.1); // a low card in front, so faces toward the camera aren't black
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
function loadModel(id, v) {
  if (!models.has(id)) models.set(id, fetch(`/models/${id}.bin${v ? `?v=${v}` : ''}`).then((r) => { if (!r.ok) throw new Error(id); return r.arrayBuffer(); }).then(async (buf) => {
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
    // the camera aims at the origin, so measure from there (parts taken apart needn't spread evenly about it)
    const sphere = (b) => Math.max(...[b.min, b.max].flatMap((x) => [b.min, b.max].flatMap((y) => [b.min, b.max].map((z) => Math.hypot(x.x, y.y, z.z)))));
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
    this.ex = this.exTo = this.ex0 = +(d.explode || 0);
    this.lid = this.lidTo = 0;
    this.user = { yaw: 0, pitch: 0 }; this.spin = 0; this.idleAt = 0;
    this.still = 'still' in d;
    this.ground = 'ground' in d;
    this.visible = false; this.live = false;
  }
  async start() {
    const m = await loadModel(this.id, this.el.dataset.v);
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
    const stage = this.el.querySelector('.stage');
    stage.insertBefore(canvas, stage.querySelector('.ui')); // under the buttons, over the poster

    const scene = this.scene = new THREE.Scene();
    scene.environment = studio(renderer);
    // a key light that casts soft shadows, a rim from behind, and light from overhead; the poster renderer moves the
    // key about and swings the overhead light round the sky, so their shadows blur into soft shade
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const R = m.r1 * 1.05;
    const shadowed = (light, size) => {
      light.castShadow = true;
      light.shadow.mapSize.set(size, size);
      Object.assign(light.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 0.1, far: 20 });
      light.shadow.camera.updateProjectionMatrix();
      light.shadow.bias = -0.0004; light.shadow.normalBias = 0.012; light.shadow.radius = 3;
      return light;
    };
    this.key = shadowed(new THREE.DirectionalLight(0xffffff, 1.4), this.still ? 2048 : coarse.matches ? 1024 : 2048);
    this.key.position.copy(KEY); scene.add(this.key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.8); rim.position.set(3, 1.5, -3); scene.add(rim);
    this.sky = new THREE.DirectionalLight(0xffffff, 0.55); this.sky.position.set(0, 8, 0); scene.add(this.sky);
    if (this.still) shadowed(this.sky, 2048);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 50);
    this.pivot = new THREE.Group(); this.spinner = new THREE.Group();
    this.pivot.add(this.spinner); scene.add(this.pivot);
    this.parts = m.parts.map((p) => {
      const mesh = new THREE.Mesh(p.g, (MATERIALS[p.mat] || MATERIALS.metal)());
      mesh.castShadow = mesh.receiveShadow = true;
      this.spinner.add(mesh);
      return { ...p, mesh };
    });
    // the floor: invisible except for the shadow on it
    if (this.ground) {
      const floor = new THREE.Mesh(new THREE.CircleGeometry(m.r1 * 3, 64).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.22 }));
      floor.position.y = m.box.min.y - 0.002;
      floor.receiveShadow = true;
      this.spinner.add(floor);
      this.floor = floor;
    }

    this.controls();
    new ResizeObserver(() => this.resize()).observe(this.el.querySelector('.stage'));
    this.resize();
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible && this.live) this.loop(); }, { rootMargin: '120px' }).observe(this.el);
    this.frame(0);
    this.el.classList.add('is-ready');
    this.ready = true;
  }
  // swap the poster for the live model, which is already drawn underneath in the same pose
  goLive() {
    if (this.live || this.still) return;
    this.live = true;
    this.idleAt = performance.now();
    this.el.classList.add('is-live');
    this.kick();
  }
  controls() {
    const { el, m } = this;
    const ex = el.querySelector('[data-act="explode"]'), lid = el.querySelector('[data-act="lid"]');
    const labels = () => {
      if (ex) { ex.textContent = this.exTo > 0.5 ? 'Put together' : 'Take apart'; ex.setAttribute('aria-pressed', String(this.exTo > 0.5)); }
      if (lid) { lid.textContent = this.lidTo > 0.5 ? 'Open the lid' : 'Close the lid'; lid.setAttribute('aria-pressed', String(this.lidTo > 0.5)); }
    };
    // a closed case can't be taken apart, so each button undoes the other first
    if (ex && m.explodes) {
      ex.hidden = false;
      ex.addEventListener('click', () => { this.goLive(); this.exTo = this.exTo > 0.5 ? 0 : 1; if (this.exTo) this.lidTo = 0; labels(); this.kick(); });
    }
    if (lid && m.hinged) {
      lid.hidden = false;
      lid.addEventListener('click', () => { this.goLive(); this.lidTo = this.lidTo > 0.5 ? 0 : 1; if (this.lidTo) this.exTo = 0; labels(); this.kick(); });
    }
    labels();
    // drag to turn; vertical drags on touch screens still scroll the page
    const stage = el.querySelector('.stage');
    let drag = null;
    stage.addEventListener('pointerdown', (e) => {
      // a press on a button is a click, not a drag: capturing the pointer would send the click to the stage
      if (e.button !== 0 || e.target.closest('button')) return;
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      this.goLive();
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
  kick() { if (this.visible && this.live) this.loop(); else this.frame(0); }
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
  frame(dt, draw = true) {
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
    // the floor goes as the parts drop out of the bottom
    if (this.floor) { this.floor.material.opacity = 0.22 * (1 - this.ex); this.floor.visible = this.ex < 0.98; }
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
    // the zoom is for the view it opens in; moving to the other state eases back so nothing leaves the frame
    cam.position.set(0, 0, dist / lerp(this.zoom, Math.min(this.zoom, 1), Math.abs(this.ex - this.ex0)));
    cam.lookAt(0, 0, 0);
    if (draw) this.renderer.render(this.scene, cam);
    return Math.abs(this.ex + this.lid - before) > 1e-4 || this.ex !== this.exTo || this.lid !== this.lidTo;
  }
  // A still of the opening view, for posters. With samples > 1 it averages that many frames: each nudges the camera
  // by part of a pixel and moves the key light about a small disc and the overhead light round the sky, so the edges
  // come out smooth and the shadows soft, with shade in the gaps between parts.
  snapshot(type = 'image/webp', quality = 0.9, samples = 1) {
    this.spin = 0; this.user.yaw = this.user.pitch = 0;
    const { renderer, scene, camera } = this;
    if (samples <= 1) { this.frame(0); return renderer.domElement.toDataURL(type, quality); }
    const size = renderer.getDrawingBufferSize(new THREE.Vector2()), W = size.x, H = size.y;
    const one = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
    const sum = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType });
    const quad = (fragmentShader, extra) => {
      const mat = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, k: { value: 1 } }, depthTest: false, depthWrite: false,
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader, ...extra });
      const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); q.frustumCulled = false;
      const s = new THREE.Scene(); s.add(q); return { s, mat };
    };
    // adds each frame, scaled, into the sum
    const add = quad('uniform sampler2D t; uniform float k; varying vec2 vUv; void main() { gl_FragColor = texture2D(t, vUv) * k; }',
      { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor });
    // the sum is linear light with premultiplied alpha: tone-map the colour, then premultiply again for the canvas
    const out = quad(`uniform sampler2D t; varying vec2 vUv;
      void main() {
        vec4 c = texture2D(t, vUv);
        gl_FragColor = vec4(c.a > 0.0 ? c.rgb / c.a : vec3(0.0), c.a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor.rgb *= gl_FragColor.a;
      }`, { blending: THREE.NoBlending });
    const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
    const keyAt = KEY.clone(), u = new THREE.Vector3(), v = new THREE.Vector3();
    u.crossVectors(keyAt, new THREE.Vector3(0, 1, 0)).normalize(); v.crossVectors(u, keyAt).normalize();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false; // the sum must keep what's in it
    renderer.setRenderTarget(sum); renderer.setClearColor(0x000000, 0); renderer.clear();
    add.mat.uniforms.t.value = one.texture; add.mat.uniforms.k.value = 1 / samples;
    for (let i = 1; i <= samples; i++) {
      camera.setViewOffset(W, H, halton(i, 2) - 0.5, halton(i, 3) - 0.5, W, H);
      // key: a point on a disc 1.6 across, seen from the model
      const a = 2 * Math.PI * halton(i, 5), r = 0.8 * Math.sqrt(halton(i, 7));
      this.key.position.copy(keyAt).addScaledVector(u, r * Math.cos(a)).addScaledVector(v, r * Math.sin(a));
      // sky: anywhere above, more often high than low
      const b = 2 * Math.PI * halton(i, 11), h = Math.sqrt(halton(i, 13));
      this.sky.position.set(Math.cos(b) * Math.sqrt(1 - h * h), h, Math.sin(b) * Math.sqrt(1 - h * h)).multiplyScalar(8);
      this.frame(0, false); // poses the parts and the camera
      renderer.setRenderTarget(one); renderer.clear(); renderer.render(scene, camera);
      renderer.setRenderTarget(sum); renderer.render(add.s, camera);
    }
    camera.clearViewOffset();
    renderer.setRenderTarget(null); renderer.clear();
    renderer.autoClear = autoClear;
    out.mat.uniforms.t.value = sum.texture;
    renderer.render(out.s, camera);
    const url = renderer.domElement.toDataURL(type, quality);
    one.dispose(); sum.dispose();
    return url;
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
