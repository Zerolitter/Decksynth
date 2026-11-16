'use strict';
const assert = require('node:assert/strict');
const { launch } = require('./usability-harness.cjs');

(async () => {
  const { app, page, height, shot, send, close } = await launch('song-surface');
  const tab = name => page.getByRole('tab', { name, exact: true });
  const radio = (group, name) => page.getByRole('radiogroup', { name: group, exact: true })
    .getByRole('radio', { name, exact: true });
  const repeat = page.getByRole('button', { name: 'Repeat song', exact: true });
  const waitLoop = loop => page.waitForFunction(loop => window.usabilityState.state.song?.loop === loop, loop);
  try {
    await height(718);
    await tab('Song').click();
    await radio('Play mode', 'Song').click();
    await shot('song-before-or-after', 718);
    await height(800);
    await shot('song-before-or-after', 800);

    assert.equal(await repeat.count(), 1, 'Song end behavior is a single repeat button');
    assert.equal(await page.getByRole('radio', { name: 'Play once', exact: true }).count(), 0);
    assert.equal(await repeat.getAttribute('aria-pressed'), 'true');
    await repeat.click();
    await waitLoop(false);
    assert.equal(await repeat.getAttribute('aria-pressed'), 'false');
    await repeat.press('Space');
    await waitLoop(true);
    assert.equal(await repeat.getAttribute('aria-pressed'), 'true');

    const surface = page.locator('.song-page');
    assert.equal(await page.locator('.page-bar').count(), 0);
    assert.equal(await surface.getByText(/Tap an empty bar to place/).count(), 0);
    assert.equal(await surface.locator('.arr-title').count(), 4);
    assert.equal(await surface.locator('.audio-scope canvas').count(), 0);
    const output = surface.getByRole('region', { name: 'Live output' });
    await output.getByText('LIVE OUTPUT', { exact: true }).waitFor();
    await output.getByText(/voices/).waitFor();
    await output.getByText(/dropouts?/).waitFor();
    await output.getByText(/DSP /).waitFor();
    await output.getByText('RMS', { exact: false }).waitFor();
    await output.getByText('Peak', { exact: false }).waitFor();
    const meters = output.locator('.scope-meter-leds');
    await page.waitForFunction(() => document.querySelectorAll('.scope-meter-leds').length === 2);
    assert.match(await meters.first().getAttribute('aria-label'), /^Left peak/);
    assert.match(await meters.last().getAttribute('aria-label'), /^Right peak/);

    const timeline = radio('View', 'Timeline'), notes = radio('View', 'Clip notes');
    assert.equal(await timeline.locator('svg').count(), 1);
    assert.equal(await notes.locator('svg').count(), 1);
    assert.notEqual(await timeline.locator('svg').innerHTML(), await notes.locator('svg').innerHTML());
    await notes.click();
    assert.equal(await notes.getAttribute('aria-checked'), 'true');
    assert.equal(await page.locator('.page-bar').count(), 0);
    await timeline.click();
    const controls = surface.locator('.song-toolbar button');
    for (const [width, size] of [[1280, 718], [1280, 800], [1024, 650]]) {
      if (width === 1280) await height(size);
      else {
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1024, 650));
        await page.waitForFunction(() => innerWidth === 1024 && innerHeight === 650);
      }
      const problems = await controls.evaluateAll(buttons => buttons.filter(button => {
        if (button.disabled) return false;
        const r = button.getBoundingClientRect(), hit = document.elementFromPoint(r.x+r.width/2, r.y+r.height/2);
        return r.width < 44 || r.height < 44 || r.right > innerWidth || r.bottom > innerHeight
          || !button.contains(hit);
      }).map(button => button.getAttribute('aria-label') || button.textContent));
      assert.deepEqual(problems, [], 'arrangement toolbar controls stay tappable at ' + width + '×' + size);
    }
    const loopBars=page.getByRole('button',{name:'Loop bars',exact:true});
    await loopBars.click();
    const choices=page.getByRole('listbox',{name:'Clip loop length'});
    await choices.waitFor();
    assert.equal(await choices.evaluate(e=>getComputedStyle(e).colorScheme),'dark');
    await page.keyboard.press('Escape');
    await choices.waitFor({state:'detached'});
    assert.ok(await loopBars.evaluate(e=>document.activeElement===e));

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 718));
    await height(718);
    await send('parameter', ['pan', null, 1, 0]);
    await send('midi', [0x90, 60, 110]);
    await page.waitForFunction(() => window.usabilityState.meter?.channels?.[1]?.peak > .01
      && window.usabilityState.meter.channels[0].peak === 0);
    assert.equal(await meters.first().locator('.lit').count(), 0);
    assert.ok(await meters.last().locator('.lit').count() > 1);
    await shot('right-channel-live-peak', 718);
    await send('midi', [0x80, 60, 0]);
    await tab('Sound').click();
    assert.equal(await page.locator('.page-tracks .page-track').count(), 4);
    console.log('PASS Song repeat, view icons, touch bounds, single track controls, dark Bars and live stereo peak LEDs');
  } finally {
    await close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
