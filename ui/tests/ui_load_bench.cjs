// How much the screen costs while a song plays: real engine (silent dummy sound), a project loaded and playing,
// then for each page the CPU of the window (renderer), GPU and main processes, screen updates (React commits)
// and DOM changes per second.
// usage: node tests/ui_load_bench.cjs [project] [seconds-per-page]   (needs the display; see PLAN.md)
'use strict';
require('./deck_guard.cjs');
const { _electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const project = path.resolve(process.argv[2] || path.join(ROOT, '..', 'tools', 'bench', 'stress4.decksynth'));
const secs = Number(process.argv[3] || 8);
const tick = 100; // /proc CPU times are in 1/100 s
const cpu = pid => { try { const f = fs.readFileSync('/proc/' + pid + '/stat', 'utf8').split(')').pop().trim().split(/\s+/); return (+f[11] + +f[12]) / tick; } catch { return 0; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const app = await _electron.launch({
    executablePath: path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron'),
    args: ['electron/playwright-main.cjs'], cwd: ROOT, timeout: 18000,
    env: { ...process.env, DECKSYNTH_UI_PREVIEW: '0', DECKSYNTH_DIAGNOSTIC: '1', SDL_AUDIODRIVER: 'dummy', ELECTRON_OZONE_PLATFORM_HINT: 'x11' },
  });
  const page = await app.firstWindow({ timeout: 18000 });
  // Count React commits through the hook React looks for (the one developer tools use); reload so React sees it.
  await page.context().addInitScript(() => {
    window.__commits = 0;
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(), inject() { return 1; },
      onCommitFiberRoot() { window.__commits++; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {} };
  });
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 718 }).catch(() => {});
  await page.waitForFunction(() => document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'), { timeout: 20000 });
  await page.evaluate(p => window.deckApi.send('load', p), project);
  await sleep(3000);
  await page.evaluate(() => {
    window.__mut = 0;
    new MutationObserver(list => { window.__mut += list.length; }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map(m => ({ pid: m.pid, type: m.type })));
  const pids = type => metrics.filter(m => m.type === type).map(m => m.pid);
  const sum = list => list.reduce((s, p) => s + cpu(p), 0);
  const measure = async label => {
    await sleep(1500);
    const r0 = sum(pids('Tab')), g0 = sum(pids('GPU')), b0 = sum(pids('Browser')), m0 = await page.evaluate(() => window.__mut), c0 = await page.evaluate(() => window.__commits), t0 = Date.now();
    await sleep(secs * 1000);
    const dt = (Date.now() - t0) / 1000, m1 = await page.evaluate(() => window.__mut), c1 = await page.evaluate(() => window.__commits);
    const pct = (a, b) => ((b - a) / dt * 100).toFixed(0).padStart(4) + ' %';
    console.log(label.padEnd(16), 'window', pct(r0, sum(pids('Tab'))), ' gpu', pct(g0, sum(pids('GPU'))), ' main', pct(b0, sum(pids('Browser'))), ' commits/s', ((c1 - c0) / dt).toFixed(0).padStart(3), ' DOM changes/s', ((m1 - m0) / dt).toFixed(0));
  };
  await page.getByRole('tab', { name: /SONG/i }).first().click();
  await measure('SONG, stopped');
  await page.evaluate(() => window.deckApi.send('play'));
  for (const tab of ['SONG', 'PERFORM', 'SOUND', 'FX', 'LINK']) {
    await page.getByRole('tab', { name: new RegExp('^' + tab, 'i') }).first().click();
    await measure(tab + ', playing');
  }
  await page.evaluate(() => window.deckApi.send('stop'));
  await app.close();
})().catch(e => { console.error(e); process.exit(1); });
