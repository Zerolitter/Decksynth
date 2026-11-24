// End-to-end Decksynth Electron UI ↔ original Python audio engine.
// SDL is forced to a silent dummy device; the diagnostic worker never opens physical USB MIDI.
// This is a real synthesis + MIDI-recording test, not a design-fixture preview.
'use strict';
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = path.resolve(__dirname,'..');
const electronPath = path.join(ROOT,'node_modules','electron','dist','electron');
let app;
(async () => {
  app = await _electron.launch({
    executablePath: electronPath,
    args: ['electron/playwright-main.cjs'],
    cwd: ROOT,
    env: {
      ...process.env,
      DECKSYNTH_UI_PREVIEW: '0',
      DECKSYNTH_DIAGNOSTIC: '1',
      SDL_AUDIODRIVER: 'dummy',
      ELECTRON_OZONE_PLATFORM_HINT: 'x11',
    },
    timeout: 18000,
  });
  const page = await app.firstWindow({timeout:18000});
  const errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  await page.getByRole('tab',{name:/SONG/i}).first().click();
  await page.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'),
                             {timeout:15000});
  assert.equal(await page.locator('.demo-badge').count(),0, 'Diagnostic engine must not masquerade as a sample fixture');
  assert.equal(await page.locator('.clip-note').count(),0, 'Diagnostic engine must start with empty project');

  await page.evaluate(() => {
    window.__deckDiagnosticEvents=[];
    window.__deckDiagnosticStop=window.deckApi.onMessage(message=>{
      if (message.state) {
        window.__deckDiagnosticEvents.push({
          voices:message.voices,
          playing:message.playing,
          recording:message.recording,
          tracks:message.state.tracks.map(track=>track.notes.length),
          rms:message.meter?.rms??0,
          peak:message.meter?.peak??0,
          waveform:message.meter?.wave?.length??0,
          connected:message.connected,
          audio:message.audio,
        });
        if (window.__deckDiagnosticEvents.length > 400) window.__deckDiagnosticEvents.shift();
      }
    });
  });
  // Physical input must remain unclaimed by this test.
  const initial = await page.evaluate(()=>new Promise(resolve=>{
    const remove=window.deckApi.onMessage(msg=>{if(msg.state){remove();resolve(msg);}});
  }));
  assert.equal(initial.audio,'dummy');
  assert.equal(initial.connected,null);
  assert.deepEqual(initial.devices,[]);
  console.log('PASS: independent Electron shell + original audio engine; silent sink, physical USB MIDI untouched');

  await page.evaluate(()=>window.deckApi.send('midi',[0x90,60,115]));
  await page.waitForFunction(()=>window.__deckDiagnosticEvents.some(v=>v.voices>=1 && v.rms>.0001 &&
                        v.peak>.001 && v.waveform===96),{timeout:10000});
  await page.waitForFunction(()=>[...document.querySelectorAll('.scope-meter-leds')].some(e=>Number(e.dataset.lit)>1),{timeout:5000});
  const levels=await page.evaluate(()=>window.__deckDiagnosticEvents.filter(x=>x.rms>.0001).slice(-1)[0]);
  console.log('PASS: PCM from live synth drives the real oscilloscope/meter; RMS',levels.rms,'peak',levels.peak);
  await page.screenshot({path:path.join(ROOT,'docs','next-real-engine-meter-diagnostic.png')});
  await page.evaluate(()=>window.deckApi.send('midi',[0x80,60,0]));
  await page.waitForFunction(()=>window.__deckDiagnosticEvents.some(v=>v.voices===0),{timeout:8000});

  await page.evaluate(()=>{window.deckApi.send('stop');window.deckApi.send('tempo',240);});
  await page.waitForFunction(()=>document.querySelector('.tempo-display')?.textContent?.includes('240'),{timeout:8000});
  await page.evaluate(()=>window.deckApi.send('record'));
  await page.waitForFunction(()=>window.__deckDiagnosticEvents.some(v=>v.recording),{timeout:9000});
  await page.evaluate(()=>window.deckApi.send('midi',[0x90,64,104]));
  await page.waitForTimeout(240);
  await page.evaluate(()=>window.deckApi.send('midi',[0x80,64,0]));
  await page.waitForFunction(()=>window.__deckDiagnosticEvents.some(v=>v.tracks?.[0]>=1),{timeout:10000});
  await page.waitForFunction(()=>document.querySelectorAll('.clip-note').length>=1,{timeout:6000});
  console.log('PASS: recorded real engine MIDI note appears in the SONG clip');
  await page.screenshot({path:path.join(ROOT,'docs','next-real-midi-diagnostic.png')});

  // A new session has one track; create the second track through the same
  // bridge command used by the track bar before testing separate recording.
  await page.evaluate(()=>window.deckApi.send('record'));
  await page.waitForFunction(()=>window.__deckDiagnosticEvents.some(v=>!v.recording),{timeout:8000});
  await page.evaluate(()=>window.deckApi.send('add_track'));
  await page.waitForFunction(()=>window.__deckDiagnosticEvents.some(v=>v.tracks?.length===2),{timeout:8000});
  await page.evaluate(()=>window.deckApi.send('select',1));
  await page.waitForTimeout(500); // the track chip changes with the engine's selected track
  await page.evaluate(()=>window.deckApi.send('record'));
  await page.waitForFunction(()=>window.__deckDiagnosticEvents.some(v=>v.recording && v.tracks?.[0]>=1),{timeout:8000});
  await page.evaluate(()=>window.deckApi.send('midi',[0x90,38,104]));
  await page.waitForTimeout(250);
  await page.evaluate(()=>window.deckApi.send('midi',[0x80,38,0]));
  await page.waitForFunction(()=>window.__deckDiagnosticEvents.some(v=>v.tracks?.[0]>=1 && v.tracks?.[1]>=1),
                             {timeout:10000});
  assert.ok(await page.locator('.clip-note').count()>=2);
  console.log('PASS: two tracks recorded separately while sharing live transport; first track was retained');
  if(errors.length)throw new Error('Renderer errors: '+errors.join('; '));
  console.log('PASS: no renderer exceptions, diagnostic screenshots written');
})().catch(error=>{
  console.error('FAIL',error.stack||error);
  process.exitCode=1;
}).finally(async()=>{if(app)await app.close();});
