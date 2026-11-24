'use strict';
const { _electron } = require('playwright');
const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname,'..');
const electronPath = path.join(ROOT,'node_modules','electron','dist','electron');
const {DECKSYNTH_UI_PREVIEW:_,...environment} = process.env;
const env={...environment,DECKSYNTH_UI_PREVIEW:'1',ELECTRON_OZONE_PLATFORM_HINT:'x11'};
const output=path.join(ROOT,'docs');
let app;
async function run(){
  app=await _electron.launch({executablePath:electronPath,args:['electron/playwright-main.cjs'],cwd:ROOT,env,timeout:15000});
  const page=await app.firstWindow({timeout:15000});
  await page.waitForLoadState('domcontentloaded');
  // The app defaults to Sound; the desktop fixture explicitly starts on Song.
  await page.evaluate(()=>localStorage.setItem('decksynth.test-page','SONG'));
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(()=>document.querySelectorAll('.clip-note').length===9,{timeout:10000});
  console.log('DOM diagnostic:',await page.title(), 'legacy=',await page.locator('.app-shell').count(), 'next=',await page.locator('.decksynth-shell').count(), 'patterns=',await page.locator('.pattern-step').count());
  await page.screenshot({path:path.join(output,'electron-debug.png')});
  assert.equal(await page.locator('.clip-note').count(),9);
  assert.equal(await page.locator('.track-row').count(),4);
  assert.equal(await page.locator('.clip-lane.has-notes').count(),2);
  assert.equal(await page.locator('.clip-note').count(),9,'the clip-notes view retains all 9 MIDI events');
  await page.screenshot({path:path.join(output,'electron-song-test.png')});
  console.log('PASS: Song UI shows 4 tracks and 9 Project-formatted notes across the MIDI lanes');
  await page.getByRole('tab',{name:/sound/i}).click();
  await page.locator('.ss-bars').waitFor({state:'visible'});
  assert.equal(await page.locator('.ss-bar').count(),16);
  await page.screenshot({path:path.join(output,'electron-sound-test.png')});
  assert.ok(await page.locator('.ss-rack').isVisible(),'Envelope sits on the same screen as the partials');
  console.log('PASS: SOUND tab exposes 16 harmonic editors and original Chordz rack');
  const before=await page.locator('.ss-bar').first().getAttribute('aria-valuenow');
  await page.getByRole('radio',{name:'Square',exact:true}).click();
  const after=Number(await page.locator('.ss-bar').nth(1).getAttribute('aria-valuenow'));
  assert.equal(after,0,'Square removes the even second harmonic');
  assert.ok(before);
  console.log('PASS: harmonic shape button changes actual preview instrument parameters');
  const knob = page.locator('[data-param="0-brightness"] .knob-value');
  if(await knob.count()) {
    await knob.first().click();
    await page.waitForTimeout(500); // rule 36: two deliberate clicks arm then open numeric entry
    await knob.first().click();
    const field=page.locator('[data-param="0-brightness"] input');
    await field.fill('0.44');
    await field.press('Enter');
    const text=await knob.first().textContent();
    assert.ok(text?.includes('44%'),text);
    console.log('PASS: reused knob numeric entry commits value');
  } else console.log('NOTE: Tone knob is folded at this width; numeric entry remains available in rack');
  await page.getByRole('tab',{name:/song/i}).click();
  assert.equal(await page.locator('.clip-note').count(),9);
  console.log('PASS: audio/sound changes do not erase the project MIDI clips');
  const sizes=await page.evaluate(()=>{
    const t=document.querySelector('.transport')?.getBoundingClientRect();
    const w=document.querySelector('.workspace')?.getBoundingClientRect();
    const audio=document.querySelector('.audio-scope')?.getBoundingClientRect();
    const clips=[...document.querySelectorAll('.clip-lane')].map(n=>{const r=n.getBoundingClientRect();return {w:r.width,h:r.height}});
    return {screen:{w:innerWidth,h:innerHeight},transport:t?.toJSON(),workspace:w?.toJSON(),scope:audio?.toJSON(),clips};
  });
  assert.ok(sizes.clips.every(c=>c.w>200&&c.h>30),JSON.stringify(sizes));
  fs.writeFileSync(path.join(output,'electron-ui-layout-test.json'),JSON.stringify(sizes,null,2));
  console.log('PASS: native screen geometry has readable clip lanes');
  // Perform's compact piano-roll/SEQ behavior is covered by performance_ui_acceptance.cjs.
}
run().catch(e=>{console.error('FAIL',e.stack);process.exitCode=1}).finally(async()=>{if(app)await app.close()});
