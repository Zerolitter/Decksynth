'use strict';
const assert = require('node:assert/strict');
const { launch } = require('./usability-harness.cjs');

(async () => {
  const h = await launch('r2');
  const { page, send, height, point, move, commands, shot } = h;
  const failures = [];
  const check = async (name, run) => {
    try { await run(); console.log('PASS', name); }
    catch (e) { failures.push(name); console.error('FAIL', name, e.stack); }
  };
  const grid = page.locator('.pf-grid');
  const toggle = () => page.getByRole('button', { name: /^(Hide|Show) playable keyboard$/ });
  const musicalState = () => page.evaluate(() => JSON.stringify({
    patterns: window.usabilityState.state.performance.patterns,
    scale: window.usabilityState.state.performance.scale,
    tracks: window.usabilityState.state.tracks.map(t => ({ notes: t.notes, clips: t.clips })),
  }));
  const visible = () => grid.evaluate(el => {
    const origin = el.getBoundingClientRect().top + el.clientTop;
    const top = origin + 24, bottom = origin + el.clientHeight;
    return [...el.querySelectorAll('[data-pitch]')].filter(row => {
      const b = row.getBoundingClientRect(); return b.top >= top - 1 && b.bottom <= bottom + 1;
    }).map(row => Number(row.dataset.pitch));
  });
  try {
    await height(718);
    await page.getByRole('tab', { name: 'Perform', exact: true }).click();
    await grid.waitFor();
    await check('Hold and keyboard toggle fit lower-left at both sizes and folding returns editor space', async () => {
      for (const size of [718, 800]) {
        await height(size);
        const hold = page.getByRole('button', { name: 'Hold', exact: true });
        const t = toggle();
        const a = await hold.boundingBox(), b = await t.boundingBox();
        assert.ok(a && b); assert.ok(a.x < 100 && a.y > size - 170);
        assert.ok(b.y >= a.y + a.height && Math.abs(b.x - a.x) <= 2);
        for (const el of [hold, t, page.getByRole('button', { name: 'Panic', exact: true })]) {
          const r = await el.boundingBox(); assert.ok(r.width >= 44 && r.height >= 44);
          assert.ok(await el.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }));
        }
        const start = await grid.boundingBox();
        await shot('keyboard-visible', size);
        await t.click();
        await page.getByRole('group', { name: 'Touch keyboard', exact: true }).waitFor({ state: 'detached' });
        assert.equal(await t.getAttribute('aria-expanded'), 'false');
        assert.ok((await grid.boundingBox()).height >= start.height + 100);
        await shot('keyboard-folded', size);
        await t.click();
        await page.getByRole('group', { name: 'Touch keyboard', exact: true }).waitFor();
        assert.equal(await t.getAttribute('aria-expanded'), 'true');
      }
    });
    await height(718);
    await check('folding releases only pressed touch keys and preserves intentional Hold', async () => {
      await send('perform_set', ['arp', 'hold', true]);
      await page.waitForFunction(() => window.usabilityState.state.performance.arp.hold);
      await send('midi', [0x90, 55, 85]);
      await page.waitForFunction(() => window.usabilityState.held_notes.includes(55));
      await commands();
      await move(await point(page.locator('.pf-piano [data-note="48"]'), { y: 100 }));
      await page.mouse.down();
      try { await toggle().evaluate(el => el.click()); }
      finally { await page.mouse.up(); }
      const all = await commands(), log = all.filter(c => c.cmd === 'midi');
      assert.equal(log.filter(c => (c.args[0] & 0xf0) === 0x90 && c.args[1] === 48).length, 1);
      assert.equal(log.filter(c => (c.args[0] & 0xf0) === 0x80 && c.args[1] === 48).length, 1);
      assert.equal(await page.getByRole('button', { name: 'Hold', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.ok(!all.some(c => c.cmd === 'panic'));
      assert.ok(!log.some(c => (c.args[0] & 0xf0) === 0x80 && c.args[1] === 55));
      assert.ok(await page.evaluate(() => window.usabilityState.held_notes.includes(55)));
      await toggle().click();
      await send('midi', [0x80, 55, 0]);
      await send('perform_set', ['arp', 'hold', false]);
      await page.waitForFunction(() => !window.usabilityState.state.performance.arp.hold);
    });
    await check('folding resets a pressed pitch strip to its neutral value', async () => {
      await commands();
      await move(await point(page.getByRole('slider', { name: 'Pitch', exact: true }), { y: 12 }));
      await page.mouse.down();
      try { await toggle().evaluate(el => el.click()); }
      finally { await page.mouse.up(); }
      const log = (await commands()).filter(c => c.cmd === 'midi' && (c.args[0] & 0xf0) === 0xe0);
      try {
        assert.ok(log.length >= 2);
        assert.deepEqual(log.at(-1).args, [0xe0, 0, 64]);
      } finally { if (await toggle().getAttribute('aria-expanded') === 'false') await toggle().click(); }
    });
    // The viewed range is the Seq "View" value box (Performance.tsx): wheel after one click, hold-and-drag on touch, arrows, typing.
    const viewBox = page.locator('.pf-view-oct').getByRole('spinbutton', { name: 'View', exact: true });
    const viewText = () => viewBox.locator('.vbox-value').textContent();
    const viewIs = text => page.waitForFunction(t => document.querySelector('.pf-view-oct .vbox-value')?.textContent === t, text);
    await check('drum range opens on MIDI 36–47 (12 of 16 rows) without changing saved music', async () => {
      for (const size of [718, 800, 718]) {
        await height(size);
        await send('set_device', [0, 'synth']);
        await page.waitForFunction(() => (window.usabilityState.state.tracks[0].device ?? 'synth') === 'synth');
        await send('set_device', [0, 'drum_rack']);
        await page.waitForFunction(() => window.usabilityState.state.tracks[0].device === 'drum_rack');
        await viewBox.waitFor();
        await viewIs('C2');
        assert.deepEqual(await visible(), [47,46,45,44,43,42,41,40,39,38,37,36]);  // the drum roll shows 12 of its 16 rows and scrolls
        assert.equal(await page.locator('.pf-piano [data-note="36"]').count(), 1);
        await shot('drum-c2', size);
      }
    });
    await check('View box: wheel, held touch drag, arrows and typing change views only and remember each track', async () => {
      const before = await musicalState();
      await viewBox.click();                       // one click arms it for the wheel
      await page.mouse.wheel(0, -120);
      await viewIs('C3');
      const p = await point(viewBox);
      const cdp = await page.context().newCDPSession(page);
      try {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
        await page.waitForTimeout(350);            // touch holds first (220 ms), then drags
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y - 20 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } finally { await cdp.detach(); }
      await viewIs('C4');
      await viewBox.focus(); await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(600);
      await viewIs('C3');
      const normalWheel = await grid.evaluate(el => {
        const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 75 });
        el.dispatchEvent(e); return !e.defaultPrevented;
      });
      assert.ok(normalWheel, 'the ordinary grid wheel is left to native scrolling');
      assert.equal(await viewText(), 'C3', 'wheel outside the View box retains normal grid scrolling');
      // Each track remembers its own view: move track 2's by one octave, go back to track 1 and return.
      await send('select', 1); await page.waitForFunction(() => window.usabilityState.selected === 1);
      const octaveOf = async () => Number(await viewBox.getAttribute('aria-valuenow'));
      await page.waitForTimeout(600);
      const other = await octaveOf();
      await viewBox.focus(); await page.keyboard.press('ArrowUp');
      await page.waitForFunction(o => Number(document.querySelector('.pf-view-oct [role="spinbutton"]')?.getAttribute('aria-valuenow')) === o + 1, other);
      await page.waitForTimeout(500);
      await send('select', 0); await page.waitForFunction(() => window.usabilityState.selected === 0);
            await viewIs('C3');
      await send('select', 1); await page.waitForFunction(() => window.usabilityState.selected === 1);
      assert.equal(await octaveOf(), other + 1);
      await send('select', 0); await page.waitForFunction(() => window.usabilityState.selected === 0);
      await viewIs('C3');
      assert.equal(await musicalState(), before);
      const type = async text => { await viewBox.focus(); await page.keyboard.press('Enter'); const entry = page.locator('.pf-view-oct input.vbox-input'); await entry.fill(text); await entry.press('Enter'); };
      await type('9');                             // above the top: stops at 8
      await page.waitForFunction(() => document.querySelector('.pf-view-oct [role="spinbutton"]')?.getAttribute('aria-valuenow') === '8');
      await viewBox.focus(); await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(500);
      assert.equal(await viewBox.getAttribute('aria-valuenow'), '8');
      await type('-5');                            // below the bottom: stops at -1
      await page.waitForFunction(() => document.querySelector('.pf-view-oct [role="spinbutton"]')?.getAttribute('aria-valuenow') === '-1');
    });
    await check('range change and blur release a touch-key audition', async () => {
      await send('set_device', [0, 'synth']);
      await page.waitForFunction(() => window.usabilityState.state.tracks[0].device === 'synth');
      await commands();
      const key = page.locator('.pf-piano [data-note="48"]');
      await move(await point(key, { y: 100 })); await page.mouse.down();
      try { await viewBox.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))); await page.waitForTimeout(700); }
      finally { await page.mouse.up(); }
      let log = (await commands()).filter(c => c.cmd === 'midi');
      assert.deepEqual(log.map(c => [c.args[0] & 0xf0, c.args[1]]), [[0x90,48],[0x80,48]]);
      await move(await point(page.locator('.pf-piano [data-note="60"]'), { y: 100 })); await page.mouse.down();
      try { await page.evaluate(() => window.dispatchEvent(new Event('blur'))); }
      finally { await page.mouse.up(); }
      log = (await commands()).filter(c => c.cmd === 'midi');
      assert.deepEqual(log.map(c => [c.args[0] & 0xf0, c.args[1]]), [[0x90,60],[0x80,60]]);
    });
    await check('visible app and window titles use Decksynth', async () => {
      assert.equal(await page.title(), 'Decksynth');
      assert.equal(await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), 'Decksynth');
    });
  } finally { await h.close(); }
  assert.deepEqual(failures, []);
})().catch(e => { console.error(e); process.exitCode = 1; });
