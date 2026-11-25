// FX: an empty rack shows the effect picker and "Add Reverb" works; every effect has presets and a tap on one sets its knobs in the engine.
// The Link page shows three mod pads and a "+" slot that adds the next one. SDL uses the silent dummy sink.
'use strict';
require('./deck_guard.cjs');
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = path.resolve(__dirname,'..');
let app;
(async () => {
  app = await _electron.launch({
    executablePath: path.join(ROOT,'node_modules','electron','dist','electron'),
    args: ['electron/playwright-main.cjs'], cwd: ROOT,
    env: {...process.env, DECKSYNTH_UI_PREVIEW:'0', DECKSYNTH_DIAGNOSTIC:'1', SDL_AUDIODRIVER:'dummy', ELECTRON_OZONE_PLATFORM_HINT:'x11'},
    timeout: 18000,
  });
  const page = await app.firstWindow({timeout:18000});
  page.setDefaultTimeout(8000);
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'),{timeout:15000});
  const fx=()=>page.evaluate(()=>new Promise(r=>{const rm=window.deckApi.onMessage(m=>{if(m.state){rm();r(m.state.tracks[0].fx);}});}));
  await page.getByRole('tab',{name:/^FX$/i}).first().click();
  // The first track of a new session comes with the factory sound's effects: clear them to get the empty rack.
  await page.locator('.fx-card-module').first().waitFor();
  while(await page.locator('.fx-card-module').count()){const n=await page.locator('.fx-card-module').count();
    await page.locator('.fx-card-module .fx-remove').first().click();
    await page.waitForFunction(k=>document.querySelectorAll('.fx-card-module').length<k,n);}
  await page.getByRole('button',{name:'Add Reverb'}).click();
  await page.locator('.fx-card-module').first().waitFor();
  assert.equal(await page.locator('.fx-card-module').count(),1);
  console.log('PASS: the empty rack shows the picker and Add Reverb adds the effect');
  // Presets: the sheet lists six, a tap sets the effect's knobs in the engine, and Escape closes it.
  await page.getByRole('button',{name:'Presets for Reverb'}).click();
  const sheet=page.getByRole('dialog',{name:'Reverb presets'});
  assert.equal(await sheet.getByRole('button',{name:/^Reverb preset /}).count(),6,'six presets');
  await sheet.getByRole('button',{name:'Reverb preset Cathedral'}).click();
  await page.waitForTimeout(300);
  const reverb=(await fx()).modules.find(m=>m.id==='reverb');
  assert.ok(Math.abs(reverb.params.decay-.95)<1e-6&&Math.abs(reverb.params.mix-.4)<1e-6,'Cathedral sets Decay .95 and Mix .4: '+JSON.stringify(reverb.params));
  assert.equal(await sheet.getByRole('button',{name:'Reverb preset Cathedral'}).getAttribute('aria-pressed'),'true','the matching preset is marked');
  await page.keyboard.press('Escape');
  await sheet.waitFor({state:'detached'});
  console.log('PASS: Reverb presets set the knobs in the engine');
  // Link: three mod pads and a "+" slot.
  await page.getByRole('tab',{name:/^Link$/}).click();
  assert.equal(await page.locator('.lp-pads .fx-pad').count(),3,'three mod pads by default');
  await page.getByRole('button',{name:'Add mod pad'}).click();
  assert.equal(await page.locator('.lp-pads .fx-pad').count(),4,'+ adds the fourth');
  assert.ok(await page.getByRole('group',{name:'Mod pad 4 editor'}).isVisible(),'the new pad opens in the editor');
  console.log('PASS: Link shows 3 mod pads and a + slot');
  assert.deepEqual(errors,[]);
  console.log('PASS: no renderer errors');
})().catch(err=>{console.error('FAIL',err.stack||err);process.exitCode=1;}).finally(()=>app&&app.close());
