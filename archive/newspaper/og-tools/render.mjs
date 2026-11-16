// Renders og.png, the link-preview card, from the live site: node tools/og/render.mjs
// It serves the site locally, opens it in headless Chrome with reduced motion (so the halftone plate holds one
// still pose of the Aperture case), copies the plate once it has printed, drops it into card.html and
// photographs the card at 1200 x 630. Set CHROME to use another Chrome-family browser.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PLATE = { w: 904, h: 836 }; // twice the plate's box on the card, so the dots print finer when it is scaled down
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.bin': 'application/octet-stream' };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const real = file.endsWith(path.sep) ? path.join(file, 'index.html') : file;
  if (!real.startsWith(ROOT) || !fs.existsSync(real) || fs.statSync(real).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(real)] || 'application/octet-stream' });
  fs.createReadStream(real).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const site = `http://127.0.0.1:${server.address().port}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'og-chrome-'));
const port = 9300 + Math.floor(Math.random() * 600);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', 'about:blank'], { stdio: 'ignore' });
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

  // 1. the site, dark and still; the plate set to the card's box, then left to print
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'dark' }] });
  await send('Page.navigate', { url: `${site}/` });
  await run(`new Promise((ok) => { const t = setInterval(() => { if (document.readyState === 'complete') { clearInterval(t); ok(); } }, 100); })`);
  const plate = await run(`(async () => {
    const s = document.createElement('style');
    s.textContent = '.plate { aspect-ratio: auto !important; width: ${PLATE.w}px !important; height: ${PLATE.h}px !important; } .plate-status { display: none !important; }';
    document.head.append(s);
    document.getElementById('plate').scrollIntoView({ block: 'center' });
    const t0 = Date.now();
    while (!(document.documentElement.classList.contains('has-3d') && AS.plate.data && AS.plate.caption.startsWith('Aperture'))) {
      if (Date.now() - t0 > 30000) throw new Error('the plate never printed (no WebGL?)');
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 1500));
    return document.getElementById('field').toDataURL('image/png');
  })()`);

  // 2. the card, with the plate in it
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${site}/tools/og/card.html` });
  await run(`new Promise((ok) => { const t = setInterval(() => { if (document.readyState === 'complete') { clearInterval(t); ok(); } }, 100); })`);
  await run(`(async () => { const img = document.getElementById('plate'); img.src = ${JSON.stringify(plate)}; await img.decode(); await document.fonts.ready; })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
  fs.writeFileSync(path.join(ROOT, 'og.png'), Buffer.from(data, 'base64'));
  console.log(`og.png written, ${(fs.statSync(path.join(ROOT, 'og.png')).size / 1024).toFixed(0)} KB`);
  ws.close();
} finally {
  chrome.kill();
  server.close();
  setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500);
}
