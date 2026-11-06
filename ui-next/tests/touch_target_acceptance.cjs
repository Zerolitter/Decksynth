// Steam Deck 1280x800 touch ergonomics on the actual Electron renderer.
// Test runs as a disposable preview and never opens the Roland MIDI device.
'use strict';
const { _electron }=require('playwright');
const path=require('node:path');
const assert=require('node:assert/strict');

const ROOT=path.resolve(__dirname,'..');
(async()=>{
  const application=await _electron.launch({
    executablePath:path.join(ROOT,'node_modules','electron','dist','electron'),
    args:['electron/playwright-main.cjs'],cwd:ROOT,
    env:{...process.env,DECKSYNTH_UI_PREVIEW:'1',ELECTRON_OZONE_PLATFORM_HINT:'x11'},
    timeout:15000,
  });
  try {
    const page=await application.firstWindow({timeout:12000});
    await page.locator('.step-hardware-pad').first().waitFor({state:'visible'});
    const geometry=async (selector)=>{
      const element=page.locator(selector).first();
      const box=await element.boundingBox();
      assert.ok(box,'Missing element: '+selector);
      return box;
    };
    const touch={
      transport: await geometry('.transport-pad.play'),
      record:await geometry('.transport-pad.record'),
      step:await geometry('.step-hardware-pad'),
      mute:await geometry('.lane-mute'),
      track:await geometry('.track-title'),
      tempo:await geometry('.tempo-adjust button'),
      lane:await geometry('.clip-lane'),
    };
    for (const [name,r] of Object.entries(touch)){
      assert.ok(r.height>=44, name+' too short: '+r.height);
      assert.ok(r.width>=44, name+' too narrow: '+r.width);
    }
    const screen=page.viewportSize()??await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
    assert.equal(screen.width,1280);
    assert.ok(screen.height>=690&&screen.height<=746);
    assert.ok(touch.step.height>=48,'Musical step pads must be comfortably tappable');
    await page.screenshot({path:path.join(ROOT,'docs','touch-acceptance-song.png')});
    await page.getByRole('tab',{name:/SOUND/i}).click();
    const knob=await geometry('.tactile-knob .knob-target');
    assert.ok(knob.width>=48&&knob.height>=48,'Rotary target is too small: '+JSON.stringify(knob));
    await page.screenshot({path:path.join(ROOT,'docs','touch-acceptance-sound.png')});
    console.log('PASS: touch target dimensions',JSON.stringify(Object.fromEntries(
      Object.entries({...touch,knob}).map(([k,r])=>[k,[Math.round(r.width),Math.round(r.height)]]))));
    console.log('PASS: both modes fit into the Steam Deck viewport; captures saved');
  }finally{
    await application.close();
  }
})().catch(err=>{console.error('FAIL',err.stack||err);process.exitCode=1;});
