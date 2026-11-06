// Preview-only pointer/knob acceptance in a disposable Electron instance.
'use strict';
const { _electron } = require('playwright');
const path=require('node:path');
const assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
(async()=>{
 let app;
 try {
  app=await _electron.launch({
   executablePath:path.join(ROOT,'node_modules','electron','dist','electron'),
   args:['electron/playwright-main.cjs'],cwd:ROOT,
   env:{...process.env,DECKSYNTH_UI_PREVIEW:'1',ELECTRON_OZONE_PLATFORM_HINT:'x11'},
   timeout:15000,
  });
  const page=await app.firstWindow({timeout:12000});
  await page.getByRole('tab',{name:/SOUND/i}).click();
  const knob=page.locator('[data-param="0-brightness"] .knob-target');
  await knob.waitFor({state:'visible',timeout:8000});
  const start=Number(await knob.getAttribute('aria-valuenow'));
  const rect=await knob.boundingBox();if(!rect)throw Error('knob not visible');
  const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x,y-20,{steps:7});
  const during=Number(await knob.getAttribute('aria-valuenow'));
  await page.mouse.up();
  const after=Number(await knob.getAttribute('aria-valuenow'));
  assert.ok(Math.abs(start-during)>0.0001 || Math.abs(start-after)>0.0001,
    'Knob did not respond to pointer drag '+[start,during,after]);
  const bubble=page.locator('[data-param="0-brightness"] .knob-live-value');
  assert.ok(await bubble.isVisible(),'Expected temporary tactile parameter readout');
  console.log('PASS: pointer drag changed brightness from',start,'to',after,'(during',during+')');
  await page.waitForTimeout(1650);
  assert.ok(!await bubble.isVisible(),'Knob value bubble should not remain indefinitely');
  console.log('PASS: live value popup appears on adjustment and disappears cleanly');
 } finally {if(app) await app.close();}
})().catch(error=>{console.error('FAIL',error.stack||error);process.exitCode=1});
