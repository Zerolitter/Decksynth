// Plugin tracks (27 Nov): the page, its Knobs and Resample sheets, the window button on the track chip, the picker and
// Settings > Plugins, at 1280 x 718 and 1280 x 800, against the real engine.
// No VST3 plugin runs in a test, so the plugin host's status (what is loaded, its parameters, its output peaks, a take)
// is played in from the Electron main process in place of the engine's; everything else is the real engine.
// Opens Electron: never run it while the maintainer's own Decksynth is open (tools/deck_busy.sh).
'use strict';
require('./deck_guard.cjs');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process'), { _electron } = require('playwright');
const ROOT = path.resolve(__dirname, '..'), SHOTS = process.env.DECKSYNTH_SHOTS || path.join(os.tmpdir(), 'plugin-track-shots');
const VST3 = path.join(os.homedir(), '.vst3');
const PATH = path.join(VST3, 'yabridge', 'Massive X.vst3');

function project(dir) {
  const file = path.join(dir, 'plugin.decksynth');
  execFileSync('python3', ['-c', `
import sys; sys.path.insert(0, ${JSON.stringify(path.resolve(ROOT, '..'))})
from decksynth.core import Engine
e = Engine(48000); e.set_device(1, 'plugin'); e.set_device(2, 'plugin')
p = e.project.tracks[1]['plugin']; p.update(path=${JSON.stringify(PATH)}, name='Massive X')
for i, n in [(0, 'Cutoff'), (1, 'Resonance'), (2, 'Drive'), (3, 'Macro 1'), (4, 'Attack'), (5, 'Release')]: p['quick'][i] = dict(i=10 + i, name=n)
e.project.save(sys.argv[1])`, file], { env: { ...process.env, DECKSYNTH_NO_AUTOSAVE: '1' } });
  return file;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-track-')), file = project(tmp);
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', '--user-data-dir=' + tmp + '/electron', 'electron/playwright-main.cjs'], cwd: ROOT,
    env: { ...process.env, DECKSYNTH_UI_PREVIEW: '0', DECKSYNTH_WINDOWED: '1', DECKSYNTH_NO_AUTOSAVE: '1', DECKSYNTH_DATA_DIR: tmp, SDL_AUDIODRIVER: 'dummy' }, timeout: 30000 });
  const p = await app.firstWindow(); p.setDefaultTimeout(8000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  try {
    await p.waitForFunction(() => document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'), null, { timeout: 30000 });
    // The plugin host's side, played in from the main process (the engine's own plugin packets are held back).
    await app.evaluate(({ BrowserWindow }, { PATH, VITAL, PIGMENTS }) => {
      const w = BrowserWindow.getAllWindows()[0], real = w.webContents.send.bind(w.webContents);
      const params = ['Cutoff', 'Resonance', 'Drive', 'Macro 1', 'Attack', 'Release', 'Osc 1 Pitch', 'Osc 1 Wave', 'Osc 2 Pitch', 'Osc 2 Wave', 'Filter Mode', 'Filter Env',
        'Env 1 Decay', 'Env 1 Sustain', 'Lfo 1 Rate', 'Lfo 1 Depth', 'Noise Level', 'Noise Colour', 'Macro 2', 'Macro 3', 'Macro 4', 'Delay Mix', 'Reverb Mix', 'Master Level']
        .map((name, k) => ({ i: 10 + k, name, raw: ((k * 37) % 100) / 100, text: ((k * 37) % 100) + ' %', label: '', kind: 'value' }));
      globalThis.fake = { live: true, editor: false, take: null, learning: null, loaded: true, track: 1, t: 0 };
      const plugins = () => ({ setup: 'ready', progress: null, version: '0.9.16', native_ready: true, native_version: '1', vst2: 0, scanning: false, scanned: true,
        plugins: [{ path: PATH, name: 'Massive X', windows: true }, { path: '/usr/lib/vst3/Surge XT.vst3', name: 'Surge XT', windows: false },
          { path: VITAL, name: 'Vital', windows: false }, { path: PIGMENTS, name: 'Pigments', windows: true }],
        loaded: fake.loaded ? { path: PATH, name: 'Massive X', vendor: '', kind: 'instrument', paged: false, editor: fake.editor, live: fake.live, live_fault: fake.fault || null, track: fake.track } : null,
        busy: null, take: null, error: null, revision: 1 });
      const out = () => Array.from({ length: 19 }, () => { const t = fake.t++, beat = (t % 94) / 94, env = Math.exp(-beat * 3.2) * (.55 + .3 * Math.sin(t / 40));
        return [Math.max(0, env * (.92 + .08 * Math.sin(t))), Math.max(0, env * (.78 + .1 * Math.cos(t * .7)))]; });
      const quick = params.slice(0, 8).map(q => [q.raw, q.text]);
      w.webContents.send = (channel, msg, ...rest) => {
        if (channel === 'deck-message' && msg && typeof msg === 'object') { msg = { ...msg }; delete msg.plugins; delete msg.plugin_track; delete msg.plugin_params; }
        return real(channel, msg, ...rest);
      };
      globalThis.fakeTimer = setInterval(() => real('deck-message', { plugins: plugins(), plugin_params: { path: PATH, params, parameter_count: params.length },
        plugin_track: { out: fake.live ? out() : [], quick, take: fake.take, learning: fake.learning, saving: false } }), 100);
    }, { PATH, VITAL: path.join(VST3, 'Vital.vst3'), PIGMENTS: path.join(VST3, 'yabridge', 'Pigments.vst3') });
    await p.evaluate(f => window.deckApi.send('load', f), file);
    await p.waitForTimeout(600);
    await p.evaluate(() => window.deckApi.send('select', 1));
    await p.getByRole('button', { name: 'Dismiss message' }).click().catch(() => {});
    const size = async H => {
      for (let i = 0; i < 40; i++) {
        await app.evaluate(({ BrowserWindow }, H) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMaximized()) w.unmaximize(); w.setContentSize(1280, H); }, H);
        await p.waitForTimeout(120); if (await p.evaluate(H => innerWidth === 1280 && innerHeight === H, H)) return;
      }
      throw Error('window did not take 1280x' + H);
    };
    const fake = v => app.evaluate((_, v) => Object.assign(globalThis.fake, v), v);
    const shot = async name => { await p.mouse.move(2, 2); await p.waitForTimeout(400); await p.screenshot({ path: path.join(SHOTS, name + '.png') }); };
    // every visible button / slider in `root` is a 44 px target that is not covered, inside the window
    const targets = async (root, H) => {
      const bad = await p.evaluate(([sel, H]) => [...document.querySelectorAll(sel + ' button, ' + sel + ' [role=slider], ' + sel + ' input')].filter(el => {
        const r = el.getBoundingClientRect(); if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') return false;
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return r.width < 43.5 || r.height < 43.5 || r.bottom > H + .5 || r.right > 1280.5 || !(hit && (el === hit || el.contains(hit)));
      }).map(el => (el.getAttribute('aria-label') || el.textContent.trim()).slice(0, 40) + ' ' + JSON.stringify(el.getBoundingClientRect())), [root, H]);
      assert.deepEqual(bad, [], 'targets in ' + root + ' at ' + H);
    };
    for (const H of [718, 800]) {
      await size(H);
      await fake({ take: null, learning: null, editor: false, live: true });
      await p.getByRole('tab', { name: 'Sound', exact: true }).click();
      await p.locator('.pt-page .pt-rack').waitFor();
      assert.equal(await p.locator('.pt-display b').textContent(), 'Massive X');
      assert.equal(await p.locator('.page-track-window').count(), 1, 'one window button: the Plugin track with a plugin');
      await targets('.pt-page', H); await targets('.page-bar', H);
      const keys = await p.locator('.pt-keys-card .pf-piano').boundingBox(); assert.ok(keys.y + keys.height <= H, 'keys fit at ' + H);
      await shot('page-' + H);
      // live audio that fell behind: the page says so and offers Start again (it also restarts by itself)
      await fake({ live: false, fault: 'Live renderer fell behind' });
      await p.getByRole('button', { name: 'Start again' }).waitFor();
      await targets('.pt-page', H); await shot('fault-' + H);
      await fake({ live: true, fault: null }); await p.getByRole('button', { name: 'Start again' }).waitFor({ state: 'detached' });
      // the plugin window from the chip
      await fake({ editor: true }); await p.waitForTimeout(250);
      assert.equal(await p.locator('.page-track-window').getAttribute('aria-pressed'), 'true');
      await fake({ editor: false });
      // Knobs: choose knob 7, then Learn
      await p.getByRole('button', { name: 'Choose quick knob 7' }).click();
      const qs = p.getByRole('dialog', { name: 'Choose quick knobs' }); await qs.waitFor();
      await targets('.pt-quick-sheet', H);
      let b = await qs.boundingBox(); assert.ok(b.y >= 0 && b.y + b.height <= H, 'Knobs sheet fits at ' + H);
      await shot('knobs-sheet-' + H);
      // a real round trip through the bridge and the engine: the chosen parameter is saved on the track
      if (H === 718) {
        await qs.locator('.pt-params').getByRole('button', { name: /^Osc 1 Pitch/ }).click();
        await qs.getByRole('radio', { name: /7\s*Osc 1 Pitch/ }).waitFor();
        await qs.getByRole('button', { name: 'Clear knob 7' }).click();
        await qs.getByRole('radio', { name: /7\s*empty/ }).waitFor();
      }
      await fake({ learning: [1, 6] }); await p.waitForTimeout(300); await shot('knobs-learning-' + H);
      await fake({ learning: null });
      await p.keyboard.press('Escape'); await qs.waitFor({ state: 'detached' });
      // Resample: modes, recording, review
      await p.getByRole('button', { name: 'Resample' }).click();
      const rs = p.getByRole('dialog', { name: 'Resample' }); await rs.waitFor();
      await targets('.pt-resample', H); await shot('resample-' + H);
      const wave = n => Array.from({ length: n }, (_, i) => { const e = Math.exp(-((i % 60) / 60) * 3) * (i < 210 ? 1 : Math.max(0, 1 - (i - 210) / 30)); return [-e * .7, e * .75, -e * .6, e * .62]; });
      await fake({ take: { mode: 'play', state: 'recording', seconds: 3.4, peak: .74, wave: wave(130), track: 1 } }); await p.waitForTimeout(300);
      await shot('resample-recording-' + H);
      await fake({ take: { mode: 'play', state: 'done', seconds: 5.9, peak: .75, wave: wave(240), track: 1, span: [0, 5.9] } }); await p.waitForTimeout(300);
      await rs.getByText('New Sampler track').waitFor();
      await targets('.pt-resample', H);
      b = await rs.boundingBox(); assert.ok(b.y >= 0 && b.y + b.height <= H, 'Resample sheet fits at ' + H);
      await shot('resample-review-' + H);
      await rs.getByRole('button', { name: 'Done' }).click(); await rs.waitFor({ state: 'detached' });
      await fake({ take: null });
      // an empty Plugin track is the picker
      await p.evaluate(() => window.deckApi.send('select', 2)); await p.locator('.pt-picker').waitFor();
      await targets('.pt-page', H); await shot('picker-' + H);
      await p.evaluate(() => window.deckApi.send('select', 1)); await p.locator('.pt-rack').waitFor();
    }
    // Settings > Plugins: only setup, what was found (and where it plays), and the folders
    await size(718);
    await p.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = p.getByRole('dialog', { name: 'Settings', exact: true }); await dialog.waitFor();
    await dialog.getByRole('tab', { name: 'Plugins' }).click();
    await dialog.getByText('on track 2').waitFor();
    assert.equal(await dialog.getByText('Record as a sample').count(), 0, 'recording moved to the Plugin track');
    await shot('settings-plugins-718');
    assert.deepEqual(errors, []);
    console.log('PASS plugin track at 718 and 800; shots in ' + SHOTS);
  } finally { await app.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
}
main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
