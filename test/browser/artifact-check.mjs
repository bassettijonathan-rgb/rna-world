// Loads the built page the way claude.ai shows an Artifact (inside a
// sandboxed iframe with an opaque origin) at desktop and phone widths, and
// checks that it starts, runs and fits.

import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';

const fragment = readFileSync(new URL('../../dist/rna-world.html', import.meta.url), 'utf8');
const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${fragment}</body></html>`;
const host = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style></head><body><iframe sandbox="allow-scripts" id="f"></iframe><script>document.getElementById('f').srcdoc = ${JSON.stringify(doc).replace(/<\//g, '<\\/')};</script></body></html>`;

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(host);
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;

const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
let failed = 0;
for (const [name, viewport] of [
  ['desktop', { width: 1280, height: 800 }],
  ['phone', { width: 390, height: 844 }],
]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: name === 'phone' ? 2 : 1 });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  const frame = page.frames().find((f) => f !== page.mainFrame()) ?? (await (await page.waitForSelector('iframe')).contentFrame());
  await frame.waitForSelector('#view');
  await page.waitForTimeout(4000);
  const info = await frame.evaluate(() => {
    const s = window.__rnaWorld;
    const doc = document.documentElement;
    return {
      host: doc.dataset.host,
      step: s.last?.step ?? -1,
      running: s.running,
      overflowX: doc.scrollWidth - doc.clientWidth,
      fieldW: document.getElementById('field').getBoundingClientRect().width,
    };
  });
  // Let it run a little more, then make sure time moved on.
  await page.waitForTimeout(2000);
  const step2 = await frame.evaluate(() => window.__rnaWorld.last?.step ?? -1);
  // Tap the middle of the field at high zoom and open the strand tab.
  await frame.evaluate(() => {
    for (let k = 0; k < 6; k++) document.getElementById('z-in').click();
  });
  await page.waitForTimeout(800);
  const box = await (await frame.$('#view')).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(800);
  const inspected = await frame.evaluate(() => !!document.querySelector('#inspector .facts, #inspector .empty'));
  if (shots) await page.screenshot({ path: `${shots}/${name}-zoom.png` });
  // The guide: open chapter 2 and use its "Show me a replicase" button.
  await frame.evaluate(() => {
    document.getElementById('t-learn').click();
    document.querySelector('[data-chap="1"]').click();
    document.querySelector('[data-try="0"]').click();
  });
  await page.waitForTimeout(1500);
  const guided = await frame.evaluate(() => ({
    chapters: document.querySelectorAll('#chapters .chap').length,
    shown: !!document.querySelector('#inspector .facts'),
    narrated: document.getElementById('n-now').textContent.length > 20,
  }));
  await frame.evaluate(() => document.getElementById('z-fit').click());
  await frame.evaluate(() => document.getElementById('t-life').click());
  await page.waitForTimeout(700);
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
  const ok = errors.length === 0 && info.host === 'worker' && step2 > info.step && info.step > 0 && info.overflowX <= 0 && inspected && guided.chapters > 5 && guided.shown && guided.narrated;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: host=${info.host} steps ${info.step} → ${step2}, overflowX=${info.overflowX}, field=${Math.round(info.fieldW)}px, inspector=${inspected}, guide=${JSON.stringify(guided)}`);
  for (const e of errors) console.log('   error:', e);
  if (!ok) failed++;
  await page.close();
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
