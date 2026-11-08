'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decksynth-r1-'));
  let app;
  const failures = [];
  try {
    const env = { ...process.env, DECKSYNTH_DIAGNOSTIC: '1',
      DECKSYNTH_UI_PREVIEW: '0', DECKSYNTH_DATA_DIR: tmp, SDL_AUDIODRIVER: 'dummy' };
    delete env.DISPLAY;
    delete env.WAYLAND_DISPLAY;
    app = await _electron.launch({
      cwd: path.resolve(__dirname, '..'),
      args: ['--ozone-platform=headless', '--disable-gpu', 'electron/playwright-main.cjs'],
      env,
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(5000);
    await page.waitForFunction(() => document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
    await page.evaluate(() => window.deckApi.onMessage(m => { if (m.state) { window.r1State = m.state; window.r1Snapshot = m; } }));
    await app.evaluate(({ ipcMain }) => {
      globalThis.r1Commands = [];
      globalThis.r1NoteEdits = [];
      ipcMain.prependListener('deck-command', (_, cmd, args) => {
        if (cmd === 'editor_note') r1Commands.push(args);
        if (cmd === 'note_edit') r1NoteEdits.push(args);
      });
    });
    const send = (cmd, args) => page.evaluate(([c, a]) => window.deckApi.send(c, a), [cmd, args]);
    const setHeight = async height => {
      await app.evaluate(({ BrowserWindow }, height) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.unmaximize();
        win.setContentSize(1280, height);
      }, height);
      await page.waitForFunction(height => innerWidth === 1280 && innerHeight === height, height);
    };
    const check = async (name, run) => {
      try { await run(); console.log('PASS', name); }
      catch (error) { failures.push(name); console.error('FAIL', name, error.message); }
    };
    const notes = async () => page.evaluate(() => window.r1State?.performance.patterns['1:1']?.steps ?? []);
    const waitNote = (step, pitch) => page.waitForFunction(([s, p]) =>
      window.r1State?.performance.patterns['1:1']?.steps[s]?.some(n => n.note === p), [step, pitch]);
    const cell = (step, pitch) => page.getByTestId('pf-cell-' + (step + 1) + '-' + pitch);
    const point = async (locator, left) => {
      const box = await locator.boundingBox();
      assert.ok(box);
      return { x: box.x + (left ?? box.width / 2), y: box.y + box.height / 2 };
    };
    const move = ({ x, y }, steps = 1) => page.mouse.move(x, y, { steps });
    const drag = async (from, to) => { await move(from); await page.mouse.down(); await move(to, 8); await page.mouse.up(); };
    const keys = pitch => grid.locator('[data-pitch="' + pitch + '"] .piano-pitch-key');
    const takeCommands = () => app.evaluate(() => r1Commands.splice(0));
    const count = async () => Number(await grid.getAttribute('data-selection-count'));
    const waitCount = length => page.waitForFunction(length =>
      (window.r1State?.performance.patterns['1:1']?.steps.flat().length ?? 0) === length, length);
    const view = () => grid.evaluate(el => ({
      left: el.scrollLeft, top: el.scrollTop, timePx: Number(el.dataset.timePx), rowHeight: Number(el.dataset.rowHeight),
    }));
    const modifier = async (key, run) => {
      await page.keyboard.down(key);
      try { await run(); } finally { await page.keyboard.up(key); }
    };
    const verifyReleased = async (track = 0) => {
      const log = await takeCommands();
      assert.ok(log.some(args => args[0] === track && args[3] > 0), 'no owned voice started');
      const held = new Map();
      for (const [owner, token, pitch, velocity] of log) {
        if (velocity) held.set(token, [owner, pitch]);
        else { assert.deepEqual(held.get(token), [owner, pitch]); held.delete(token); }
      }
      assert.equal(held.size, 0, 'editor left a voice on');
    };
    const shot = async (name, height) => {
      if (process.env.DECKSYNTH_R1_SHOTS) {
        fs.mkdirSync(process.env.DECKSYNTH_R1_SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(process.env.DECKSYNTH_R1_SHOTS, name + '-1280x' + height + '.png') });
      }
    };
    const grid = page.locator('.pf-grid');
    await setHeight(718);
    await page.getByRole('tab', { name: 'Perform', exact: true }).click();
    await grid.waitFor();
    await send('perform_set', ['seq', 'enabled', true]);

    for (const populated of [false, true]) {
      if (populated) { await cell(4, 64).click(); await waitNote(4, 64); }
      for (const height of [718, 800]) {
        await setHeight(height);
        await send('play');
        await page.waitForFunction(() => document.querySelector('.pf-grid .piano-playhead, .pf-grid .note-time-cell.live'));
        await shot(populated ? 'playing-notes' : 'playing-empty', height);
        await check('single white playhead, ' + (populated ? 'notes, ' : 'empty, ') + height, async () => {
          assert.equal(await grid.locator('.note-time-cell.live').count(), 0, 'playback outlines each pitch cell');
          const line = grid.locator('.piano-playhead');
          assert.equal(await line.count(), 1);
          const style = await line.evaluate(el => { const s = getComputedStyle(el); return [s.backgroundColor, s.width]; });
          assert.equal(style[0], 'rgb(255, 255, 255)');
          assert.ok(parseFloat(style[1]) <= 2);
        });
        await send('stop');
        await page.waitForFunction(() => !document.querySelector('.pf-grid .piano-playhead, .pf-grid .note-time-cell.live'));
      }
    }
    await setHeight(718);
    await page.keyboard.press('Tab');
    await cell(1, 67).focus();
    assert.ok(await cell(1, 67).evaluate(el => el.matches(':focus-visible')));
    await takeCommands();
    const a = await point(cell(4, 64), 12), b = await point(cell(7, 62), 12);
    await drag(a, b);
    await waitNote(7, 62);
    await shot('after-drag', 718);
    await setHeight(800);
    await shot('after-drag', 800);
    await setHeight(718);
    await check('pointer drag leaves no stale cell focus outline', async () => {
      assert.equal(await grid.locator('.note-time-cell:focus-visible').count(), 0);
    });
    await check('moving a note auditions actual new pitches and releases each voice', async () => {
      const log = await takeCommands();
      assert.equal(log[0]?.[2], 64);
      assert.equal(log.filter(a => a[3] > 0).at(-1)?.[2], 62);
      assert.equal(log.length % 2, 0);
      for (let i = 0; i < log.length; i += 2) {
        assert.ok(log[i][3] > 0);
        assert.deepEqual(log[i + 1], [...log[i].slice(0, 3), 0]);
      }
    });
    await drag(await point(keys(64)), await point(keys(62)));
    await check('pitch-key scrub releases each pitch including final key', async () => {
      const log = await takeCommands();
      assert.deepEqual(log.map(a => [a[2], !!a[3]]),
        [[64, true], [64, false], [63, true], [63, false], [62, true], [62, false]]);
      for (let i = 0; i < log.length; i += 2) assert.equal(log[i][1], log[i + 1][1]);
    });
    await cell(3, 64).click();
    await waitNote(3, 64);
    await cell(8, 62).click();
    await waitNote(8, 62);
    await cell(7, 62).click();
    await page.keyboard.press('Control+Shift+a');
    await check('select row uses the focused note pitch', async () => assert.equal(await count(), 2));
    await page.keyboard.press('Control+a');
    await check('select all includes other pitches', async () => assert.equal(await count(), 3));
    const beforeBox = await notes();
    await page.keyboard.down('Control');
    try { await drag(await point(cell(2, 65)), await point(cell(8, 61))); }
    finally { await page.keyboard.up('Control'); }
    await check('Ctrl-drag from empty Draw grid selects without painting', async () => {
      assert.equal(await count(), 3);
      assert.deepEqual(await notes(), beforeBox);
    });
    await check('ruler marks actual notes above and below the visible pitch range', async () => {
      await send('perform_step', [2, [
        { note: 90, tie: 1, velocity: 100 },
        { note: 29, tie: 1, velocity: 100 },
      ], true]);
      await waitNote(2, 90);
      await grid.locator('.piano-ruler-tick').filter({ hasText: '3' }).first().waitFor();
      const tick = grid.getByRole('button', { name: /^Set edit cursor at 2( |$)/ }).first();
      assert.equal(await tick.locator('[title="Notes above"]').count(), 1);
      assert.equal(await tick.locator('[title="Notes below"]').count(), 1);
      assert.equal(await grid.getByRole('button', { name: 'Set edit cursor at 1', exact: true })
        .locator('.piano-note-guide').count(), 0);
    });
    await check('Edit exposes Select All, Select Row and Delete', async () => {
      await cell(7, 62).click({ button: 'right' });
      const menu = page.getByRole('menu');
      await menu.getByRole('button', { name: 'Action list' }).click();
      await menu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
      await menu.getByRole('menuitem', { name: 'Select all', exact: true }).waitFor();
      await menu.getByRole('menuitem', { name: 'Delete notes', exact: true }).waitFor();
      await menu.getByRole('menuitem', { name: 'Select row', exact: true }).click();
      assert.equal(await count(), 2);
    });
    await check('recording retains one dark red marker', async () => {
      await send('record');
      try {
        await page.waitForFunction(() => window.r1Snapshot?.recording);
        const marker = grid.locator('.piano-playhead.recording');
        await marker.waitFor();
        assert.equal(await marker.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(168, 74, 84)');
      } finally {
        await send('record');
        await page.waitForFunction(() => !window.r1Snapshot?.recording);
        await send('stop');
        // Sending IPC does not acknowledge the worker's transport transition.
        // Let Stop finish before the next check starts selecting notes.
        await page.waitForFunction(() => window.r1Snapshot?.playing === false
          && !document.querySelector('.pf-grid .piano-playhead'));
      }
    });
    await check('Shift-click toggles selection and Ctrl-drag copies the group once', async () => {
      const before = await notes();
      const source = await point(cell(7, 62), 12);
      await cell(7, 62).click();
      await cell(8, 62).click({ modifiers: ['Shift'] });
      assert.equal(await count(), 2, 'Shift-click adds the second note');
      await cell(8, 62).click({ modifiers: ['Shift'] });
      assert.equal(await count(), 1, 'Shift-click removes the second note');
      await cell(8, 62).click({ modifiers: ['Shift'] });
      assert.equal(await count(), 2);
      await app.evaluate(() => r1NoteEdits.splice(0));
      await takeCommands();
      await modifier('Control', async () => {
        await move(source);
        await page.mouse.down();
        try {
          await move(await point(cell(11, 62), 12), 8);
          assert.equal(await grid.locator('.copy-preview').count(), 2);
          assert.deepEqual(await notes(), before, 'preview leaves the native model unchanged');
          assert.equal(await app.evaluate(() => r1NoteEdits.length), 0);
        } finally { await page.mouse.up(); }
      });
      await waitNote(11, 62);
      await waitNote(12, 62);
      await waitCount(before.flat().length + 2);
      assert.equal(await app.evaluate(() => r1NoteEdits.length), 1, 'release commits the group once');
      await verifyReleased();
      await page.keyboard.press('Control+z');
      await waitCount(before.flat().length);
      assert.deepEqual(await notes(), before);
    });
    await check('Select Row includes matching notes beyond the visible time range', async () => {
      await send('perform_set', ['seq', 'length', 32]);
      await send('perform_step', [23, [{ note: 62, tie: 1, velocity: 100 }], true]);
      await waitNote(23, 62);
      assert.equal(await cell(23, 62).count(), 0);
      await cell(7, 62).click();
      await page.keyboard.press('Control+Shift+a');
      assert.equal(await count(), 3);
      await page.keyboard.press('Control+a');
      assert.equal(await count(), 6);
    });
    await check('middle drag pans, and wheel zoom anchors the musical position', async () => {
      const r = await grid.boundingBox();
      const anchor = { x: r.x + r.width * .65, y: r.y + r.height * .5 };
      const before = await view();
      await move(anchor);
      await modifier('Control', () => page.mouse.wheel(0, -150));
      await page.waitForFunction(px => Number(document.querySelector('.pf-grid').dataset.timePx) > px, before.timePx);
      const zoomed = await view();
      assert.ok(Math.abs((before.left + anchor.x - r.x - 44) / before.timePx -
        (zoomed.left + anchor.x - r.x - 44) / zoomed.timePx) < .15);
      await page.mouse.down({ button: 'middle' });
      await move({ x: anchor.x - 90, y: anchor.y + 20 }, 6);
      await page.mouse.up({ button: 'middle' });
      assert.ok((await view()).left > zoomed.left);
      await modifier('Alt', () => page.mouse.wheel(0, -100));
      await page.waitForFunction(row => Number(document.querySelector('.pf-grid').dataset.rowHeight) > row, before.rowHeight);
    });
    await check('Escape, pointercancel and window blur restore a zoomed, panned long note', async () => {
      await send('perform_step', [8, [{ note: 62, tie: 4, velocity: 100 }], true]);
      await page.waitForFunction(() => window.r1State.performance.patterns['1:1'].steps[8]?.[0]?.tie === 4);
      const start = await point(cell(8, 62), 12);
      const end = await point(cell(10, 64), 12);
      const before = await notes();
      for (const kind of ['Escape', 'pointercancel', 'blur']) {
        await takeCommands();
        await move(start);
        await page.mouse.down();
        try {
          await move(end, 8);
          assert.equal(await cell(10, 64).locator('.note-editor-block').count(), 1);
          if (kind === 'Escape') await page.keyboard.press('Escape');
          else await grid.evaluate((el, kind) => {
            if (kind === 'blur') window.dispatchEvent(new Event('blur'));
            else el.dispatchEvent(new PointerEvent(kind, { bubbles: true, pointerId: 1, pointerType: 'mouse' }));
          }, kind);
        } finally { await page.mouse.up(); }
        assert.deepEqual(await notes(), before);
        assert.equal(await cell(10, 64).locator('.note-editor-block').count(), 0);
        assert.equal(await cell(8, 62).locator('.note-editor-block').count(), 1);
        assert.equal(await grid.locator('.piano-box-selection, .copy-preview, .note-time-cell:focus-visible').count(), 0);
        await verifyReleased();
      }
    });
    await check('touch tap still adds one note through the contextual gesture router', async () => {
      const p = await point(cell(13, 64));
      const cdp = await page.context().newCDPSession(page);
      await takeCommands();
      try {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await waitNote(13, 64);
        await verifyReleased();
      } finally { await cdp.detach(); }
    });
    await check('track switch releases the owned key audition', async () => {
      await takeCommands();
      await move(await point(keys(64)));
      await page.mouse.down();
      try {
        await send('select', 1);
        await page.waitForFunction(() => window.r1Snapshot.selected === 1);
        await verifyReleased();
      } finally { await page.mouse.up(); }
      await send('select', 0);
      await page.waitForFunction(() => window.r1Snapshot.selected === 0);
    });
    await check('leaving Perform releases the owned key audition', async () => {
      await takeCommands();
      await move(await point(keys(64)));
      await page.mouse.down();
      try {
        await page.getByRole('tab', { name: 'Sound', exact: true }).evaluate(el => el.click());
        await grid.waitFor({ state: 'detached' });
        await verifyReleased();
      } finally { await page.mouse.up(); }
    });
  } finally {
    if (app) await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  assert.deepEqual(failures, []);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
