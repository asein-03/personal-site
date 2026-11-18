// Renders the poster stills in media/renders from the CAD models: node tools/renders/render.mjs [name ...]
// Each poster is the opening view of a viewer on the site (same model, yaw, pitch, zoom and size), so the still
// and the live model line up when the live one fades in. Set CHROME to use another Chrome-family browser.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = process.env.OUT || path.join(ROOT, 'media/renders');
// frames averaged per poster (see snapshot in assets/viewer.js): more is smoother and slower
const SAMPLES = +(process.env.SAMPLES || 160);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// name: model, yaw, pitch, zoom, explode, size, and fit/axis for long models
export const POSTERS = {
  // about twice the size each is shown at, for sharp stills on high-density screens
  'aperture-hero': { model: 'aperture', yaw: -112, pitch: 24, zoom: 1.18, explode: 1, w: 1200, h: 1200 },
  'aperture-169': { model: 'aperture', yaw: -42, pitch: 12, zoom: 1.12, w: 2240, h: 1260 },
  'aperture-apart': { model: 'aperture', yaw: -128, pitch: 16, zoom: 1.2, explode: 1, w: 1600, h: 900 },
  'aperture-electronics': { model: 'aperture', yaw: -128, pitch: 16, zoom: 1.2, explode: 1, w: 1280, h: 960 },
  'aperture-case': { model: 'aperture-case', yaw: -128, pitch: 30, zoom: 1.3, ground: 1, w: 1280, h: 960 },
  'snack-169': { model: 'snack', yaw: -30, pitch: 12, zoom: 1.1, w: 2240, h: 1260 },
  'snack-apart': { model: 'snack', yaw: -64, pitch: 14, zoom: 1.1, explode: 1, w: 1280, h: 960 },
  'snack-phone': { model: 'snack-phone', yaw: -52, pitch: 12, zoom: 1, w: 1280, h: 960 },
  ordo: { model: 'ordo', yaw: -30, pitch: 16, zoom: 1, w: 1280, h: 960 },
  skyfall: { model: 'skyfall', yaw: -14, pitch: 14, zoom: 1, fit: 'box', axis: 'x', w: 2240, h: 1120 },
  portafilter: { model: 'portafilter', yaw: -68, pitch: 26, zoom: 1, w: 1280, h: 960 },
  topology: { model: 'topology', yaw: -30, pitch: 22, zoom: 1, w: 1280, h: 960 },
};

// extra posters for trying views, as JSON: EXTRA='{"try-1": {"model": "aperture", "yaw": -40, ...}}'
Object.assign(POSTERS, JSON.parse(process.env.EXTRA || '{}'));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.bin': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const site = `http://127.0.0.1:${server.address().port}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'render-chrome-'));
const port = 9300 + Math.floor(Math.random() * 600);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', ...(process.env.GPU ? ['--use-angle=metal', '--enable-gpu'] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']), 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let pages;
  for (let i = 0; i < 60 && !pages; i++) { try { pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(250); } }
  const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const waiting = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { const { r, j } = waiting.get(d.id); waiting.delete(d.id); d.error ? j(new Error(d.error.message)) : r(d.result); } };
  const send = (method, params = {}) => new Promise((r, j) => { const id = ++seq; waiting.set(id, { r, j }); ws.send(JSON.stringify({ id, method, params })); });
  const run = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 1200, deviceScaleFactor: 1, mobile: false });
  const want = process.argv.slice(2);
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, p] of Object.entries(POSTERS)) {
    if (want.length && !want.includes(name)) continue;
    const t0 = Date.now();
    const q = new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)]));
    await send('Page.navigate', { url: `${site}/tools/renders/stage.html?${q}` });
    const url = await run(`(async () => {
      const t0 = Date.now();
      while (!(window.viewers && viewers[0] && viewers[0].ready)) {
        if (Date.now() - t0 > 30000) throw new Error('the model never loaded (no WebGL?)');
        await new Promise((r) => setTimeout(r, 100));
      }
      return viewers[0].snapshot('image/webp', 0.9, ${SAMPLES});
    })()`);
    const file = path.join(OUT, `${name}.webp`);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`${name}.webp  ${p.w}x${p.h}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  ws.close();
} finally {
  chrome.kill();
  server.close();
  setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500);
}
