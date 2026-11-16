'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launch } = require('./usability-harness.cjs');
(async () => {
  const h = await launch('r4');
  const { page, send, height, shot, commands, point, move } = h;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decksynth-r4-music-'));
  const failures = [];
  const check = async (name, run) => {
    try { await run(); console.log('PASS', name); }
    catch (e) { failures.push(name); console.error('FAIL', name, e.stack);
      await page.getByRole('dialog', { name: 'MIDI note editor', exact: true }).getByRole('button', { name: 'Done', exact: true }).evaluateAll(els => els.forEach(el => el.click()));
    }
  };
  const state = () => page.evaluate(() => window.usabilityState.state);
  const pattern = () => page.evaluate(() => window.usabilityState.state.performance.patterns['1:1']);
  const songNotes = () => page.evaluate(() => window.usabilityState.state.tracks[0].notes);
  const grid = page.locator('.pf-grid');
  const toSong = () => page.getByRole('button', { name: 'Pattern → Song', exact: true });
  const toPattern = () => page.getByRole('button', { name: 'Song → Pattern', exact: true });
  try {
    await height(718); await page.getByRole('tab', { name: 'Perform', exact: true }).click();
    await send('perform_step', [0, [{ note: 60, velocity: 91, tie: 2 }], true]);
    await send('perform_step', [4, [{ note: 64, velocity: 82, tie: 1 }], true]);
    await page.waitForFunction(() => window.usabilityState.state.performance.patterns['1:1']?.steps[4]?.[0]?.note === 64);
    let addCommand;
    await check('direct transfers name the track, clip and pattern and fit both sizes', async () => {
      for (const size of [718, 800]) {
        await height(size);
        await page.getByTestId('pf-transfer-target').waitFor();
        assert.match(await page.getByTestId('pf-transfer-target').textContent(), /Track 1.*Clip A.*Pattern 1[·:]1/);
        for (const button of [toSong(), toPattern()]) {
          const b = await button.boundingBox(); assert.ok(b.height >= 44 && b.y + b.height <= size);
          assert.ok(await button.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }));
        }
        await shot('direct-transfers', size);
      }
    });
    await height(718);
    await check('Pattern → Song adds into the named open clip, fills the loop, and undoes once', async () => {
      const before = await state(); await commands(); await toSong().click();
      await page.waitForFunction(() => window.usabilityState.state.tracks[0].notes.length === 8);
      const notes = await songNotes();
      assert.deepEqual(notes.map(n => [n.start,n.note,n.duration,n.velocity]),
        [[0,60,.4,91],[1,64,.2,82],[4,60,.4,91],[5,64,.2,82],[8,60,.4,91],[9,64,.2,82],[12,60,.4,91],[13,64,.2,82]]);
      const transfers = (await commands()).filter(c => c.cmd === 'perform_action' && c.args[0] === 'commit_song');
      assert.equal(transfers.length, 1); assert.equal(transfers[0].args.length, 3);
      assert.equal(transfers[0].args[2].clip, 0); addCommand = transfers[0].args;
      await send('undo'); await page.waitForFunction(() => window.usabilityState.state.tracks[0].notes.length === 0);
      assert.deepEqual((await state()).tracks, before.tracks);
    });
    await check('occupied-clip Add and Song → Pattern Replace preserve other clips and undo independently', async () => {
      await send('clip', [0,'open',1,null]);
      await page.waitForFunction(() => window.usabilityState.state.clips.open[0] === 1);
      const notes = [{ start: 2, note: 67, duration: .25, velocity: 77 }];
      await send('note_edit', [{ kind: 'clip', track: 0, clip: 1, bars: 4, device: 'synth' }, [], notes]);
      await page.waitForFunction(() => window.usabilityState.state.tracks[0].notes.length === 1);
      assert.match(await page.getByTestId('pf-transfer-target').textContent(), /Clip B/);
      const before = await state(), beforePattern = await pattern();
      await toSong().click(); await page.waitForFunction(() => window.usabilityState.state.tracks[0].notes.length === 9);
      assert.deepEqual((await songNotes())[0], notes[0]);
      await send('undo'); await page.waitForFunction(() => window.usabilityState.state.tracks[0].notes.length === 1);
      await toPattern().click();
      await page.waitForFunction(() => window.usabilityState.state.performance.patterns['1:1'].steps[8]?.[0]?.note === 67);
      const captured = await pattern();
      assert.deepEqual(captured.steps.flat(), [{ note: 67, velocity: 77, tie: 2 }]);
      assert.equal(captured.gate, .5);
      assert.deepEqual((await state()).tracks, before.tracks);
      assert.deepEqual((await state()).clips, before.clips);
      await send('undo');
      await page.waitForFunction(p => JSON.stringify(window.usabilityState.state.performance.patterns['1:1']) === p, JSON.stringify(beforePattern));
    });
    await check('a stale transfer is rejected instead of redirecting to a different clip', async () => {
      assert.ok(addCommand);
      await send('clip', [0,'open',2,null]); await page.waitForFunction(() => window.usabilityState.state.clips.open[0] === 2);
      const before = await state(); await send('perform_action', addCommand);
      await page.getByRole('status').filter({ hasText: /Transfer target changed/ }).waitFor();
      assert.deepEqual(await state(), before);
      await shot('stale-transfer-rejected', 718);
      await page.getByRole('button', { name: 'Dismiss message', exact: true }).click();
    });
    await check('Expand enlarges the same piano roll, preserves selection and releases owned keys', async () => {
      await grid.getByTestId('pf-cell-5-64').click();
      assert.equal(await grid.getAttribute('data-selection-count'), '1');
      await grid.evaluate(el => el.dataset.r4Identity = 'same-grid');
      const before = await grid.boundingBox(), model = await state();
      await commands(); await move(await point(page.locator('.pf-piano [data-note="48"]'), { y: 100 })); await page.mouse.down();
      try { await page.getByRole('button', { name: 'Expand notes', exact: true }).evaluate(el => el.click()); }
      finally { await page.mouse.up(); }
      assert.equal(await page.locator('.note-editor-backdrop').count(), 0);
      assert.equal(await page.locator('.pf-grid').count(), 1);
      assert.equal(await grid.getAttribute('data-r4-identity'), 'same-grid');
      assert.equal(await grid.getAttribute('data-selection-count'), '1');
      const expanded = await grid.boundingBox();
      assert.ok(expanded.width * expanded.height >= before.width * before.height * 1.5);
      const midi = (await commands()).filter(c => c.cmd === 'midi');
      assert.deepEqual(midi.map(c => [c.args[0] & 0xf0,c.args[1]]), [[0x90,48],[0x80,48]]);
      for (const size of [718,800]) { await height(size); await shot('expanded-same-grid', size); }
      await page.getByRole('button', { name: 'Restore compact notes', exact: true }).click();
      assert.deepEqual(await state(), model);
      assert.equal(await grid.getAttribute('data-selection-count'), '1');
      await page.getByRole('button', { name: 'Expand notes', exact: true }).click();
      await page.getByRole('tab', { name: 'Arp', exact: true }).click();
      assert.equal(await page.locator('.pf.notes-expanded').count(), 0, 'switching modes restores their controls');
      await page.getByRole('tab', { name: 'Seq', exact: true }).click();
    });
    await check('SONG uses the global clock and its note editor has a substantially larger viewport', async () => {
      await page.getByRole('tab', { name: 'Song', exact: true }).click();
      assert.equal(await page.getByLabel('Song position', { exact: true }).count(), 0);
      for (const size of [718,800]) {
        await height(size); await page.getByRole('button', { name: 'Edit notes of track 1', exact: true }).click();
        const editor = page.getByRole('dialog', { name: 'MIDI note editor', exact: true });
        const b = await editor.locator('.note-editor-grid').boundingBox();
        assert.ok(b.height >= size - 230 && b.width >= 1200);
        await shot('song-note-editor', size);
        await editor.getByRole('button', { name: 'Done', exact: true }).click();
      }
      await page.getByRole('tab', { name: 'Perform', exact: true }).click();
    });
    await check('transfers are unavailable during recording and a temporary native project reopens unchanged', async () => {
      await send('record'); await page.waitForFunction(() => window.usabilityState.recording);
      assert.ok(await toSong().isDisabled()); assert.ok(await toPattern().isDisabled());
      await send('record'); await page.waitForFunction(() => !window.usabilityState.recording);
      await send('stop'); await page.waitForFunction(() => !window.usabilityState.playing);
      const before = await state(), file = path.join(tmp, 'R4 generated music.decksynth');
      await send('save', file);
      for (let i=0;i<100&&!fs.existsSync(file);i++) await new Promise(r=>setTimeout(r,20));
      assert.ok(fs.existsSync(file), 'save completed');
      const bytes = fs.readFileSync(file);
      await send('perform_step', [7,[{ note: 69, velocity: 90, tie: 1 }],true]);
      await page.waitForFunction(() => window.usabilityState.state.performance.patterns['1:1'].steps[7]?.[0]?.note === 69);
      await send('load', file);
      await page.waitForFunction(p => JSON.stringify(window.usabilityState.state.performance.patterns) === p, JSON.stringify(before.performance.patterns));
      assert.deepEqual((await state()).tracks, before.tracks);
      assert.deepEqual((await state()).clips, before.clips);
      assert.deepEqual(fs.readFileSync(file), bytes);
    });
  } finally { await h.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
  assert.deepEqual(failures, []);
})().catch(e => { console.error(e); process.exitCode = 1; });
