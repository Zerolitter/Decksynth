'use strict';
const assert = require('node:assert/strict');
const { launch } = require('./usability-harness.cjs');
(async () => {
  const h = await launch('r3');
  const { page, send, height, shot, commands } = h;
  const failures = [];
  const help = () => page.getByRole('dialog', { name: 'Decksynth help', exact: true });
  const openEditor = async () => {
    await page.getByRole('tab', { name: 'Song', exact: true }).click();
    await page.getByRole('button', { name: 'Edit notes of track 1', exact: true }).click();
  };
  const check = async (name, run) => {
    try { await run(); console.log('PASS', name); }
    catch (e) {
      failures.push(name); console.error('FAIL', name, e.stack);
      await page.locator('.modal-close').evaluateAll(els => els.forEach(el => el.click()));
      await page.getByRole('dialog', { name: 'MIDI note editor', exact: true }).getByRole('button', { name: 'Done', exact: true }).evaluateAll(els => els.forEach(el => el.click()));
    }
  };
  try {
    await height(718);
    await check('? Help combines the current guide and truthful editing shortcuts at both sizes', async () => {
      for (const size of [718, 800]) {
        await height(size);
        await page.getByRole('button', { name: 'Help', exact: true }).click();
        await help().waitFor();
        assert.equal(await page.getByRole('dialog', { name: /help|shortcuts/i }).count(), 1);
        await help().getByRole('heading', { name: 'Guide', exact: true }).waitFor();
        await help().getByRole('heading', { name: 'Note editing', exact: true }).waitFor();
        const content = await help().textContent();
        for (const text of ['Ctrl+Shift+A', 'empty grid', 'selected notes', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'ADSR']) assert.ok(content.includes(text), text);
        assert.ok(!content.includes('envelope picture'));
        assert.ok(!content.includes('R = Record'));
        assert.equal(await page.locator('.note-shortcuts-backdrop').count(), 0);
        const r = await help().boundingBox(); assert.ok(r.y >= 16 && r.y + r.height <= size - 16);
        await shot('help-guide', size);
        await page.keyboard.press('Escape'); await help().waitFor({ state: 'detached' });
        assert.ok(await page.getByRole('button', { name: 'Help', exact: true }).evaluate(el => el === document.activeElement));
      }
    });
    await height(718);
    await page.getByRole('tab', { name: 'Perform', exact: true }).click();
    await check('contextual note help opens the same surface and returns focus on close', async () => {
      const button = page.getByRole('button', { name: 'Note editing help', exact: true });
      for (const size of [718, 800]) {
        await height(size); await button.click(); await help().waitFor();
        assert.equal(await help().count(), 1);
        assert.equal(await help().getAttribute('data-help-section'), 'notes');
        assert.ok(await help().locator('.help-content').evaluate(el => el.scrollTop > 0));
        const heading = await help().getByRole('heading', { name: 'Note editing', exact: true }).boundingBox();
        const viewport = await help().locator('.help-content').boundingBox();
        assert.ok(heading.y >= viewport.y && heading.y <= viewport.y + 20, 'contextual help starts at the Note editing section');
        await shot('help-notes', size);
        const close = help().getByRole('button', { name: 'Close help', exact: true });
        await close.focus(); await page.keyboard.press('Shift+Tab');
        assert.ok(await help().evaluate(el => el.contains(document.activeElement)));
        await close.click(); await help().waitFor({ state: 'detached' });
        assert.ok(await button.evaluate(el => el === document.activeElement));
      }
    });
    await check('help opened from an editor suspends that editor and Escape returns to its invoker', async () => {
      await openEditor();
      const editor = page.getByRole('dialog', { name: 'MIDI note editor', exact: true });
      await editor.waitFor();
      const button = editor.getByRole('button', { name: 'Note editing help', exact: true });
      await button.click(); await help().waitFor();
      assert.ok(await editor.evaluate(el => el.inert));
      await page.keyboard.press('Escape'); await help().waitFor({ state: 'detached' });
      assert.ok(await button.evaluate(el => el === document.activeElement));
      assert.ok(!(await editor.evaluate(el => el.inert)));
      await page.keyboard.press('Escape'); await editor.waitFor({ state: 'detached' });
      await page.getByRole('tab', { name: 'Perform', exact: true }).click();
    });
    await check('documented global keys act outside inputs; help and numeric text entry retain ownership', async () => {
      await commands();
      await page.getByRole('button', { name: 'Help', exact: true }).click();
      await page.keyboard.press('F5');
      assert.ok(!(await commands()).some(c => c.cmd === 'play'));
      await page.keyboard.press('Escape');
      await page.locator('.modal-close').evaluateAll(els => els.forEach(el => el.click()));
      await page.locator('.pf-grid').focus();
      await page.keyboard.press('F5'); await page.waitForFunction(() => window.usabilityState.playing);
      await page.keyboard.press('F6'); await page.waitForFunction(() => !window.usabilityState.playing);
      await page.keyboard.press('F7'); await page.waitForFunction(() => window.usabilityState.recording);
      await page.keyboard.press('F7'); await page.waitForFunction(() => !window.usabilityState.recording);
      await send('stop'); await page.waitForFunction(() => !window.usabilityState.playing);
      await page.keyboard.press('F8'); await page.waitForFunction(() => window.usabilityState.selected === 3);
      await page.keyboard.press('F9'); await page.waitForFunction(() => window.usabilityState.selected === 0);
      await page.keyboard.press('F10');
      assert.ok((await commands()).some(c => c.cmd === 'undo'));
      await openEditor();
      const editor = page.getByRole('dialog', { name: 'MIDI note editor', exact: true });
      const input = editor.getByRole('spinbutton', { name: 'Selected note velocity', exact: true });
      await input.fill('88'); await commands();
      await page.keyboard.press('Control+a'); await page.keyboard.press('F5');
      assert.equal(await input.inputValue(), '88');
      assert.ok(!(await commands()).some(c => c.cmd === 'play' || c.cmd === 'note_edit'));
      await editor.getByRole('button', { name: 'Done', exact: true }).click();
    });
  } finally { await h.close(); }
  assert.deepEqual(failures, []);
})().catch(e => { console.error(e); process.exitCode = 1; });
