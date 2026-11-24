// Preview UI test for the Filter, Unison and Character cards on the Sound page (16 Nov layout): buttons for the fixed choices,
// knobs that show units, the filter's On/Off switch, Reset in the radial menu, a mod pad link from the Link box, and nothing off screen at 722 px.
'use strict';
const {_electron}=require('playwright');
const path=require('node:path');
const assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
(async()=>{
 const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,
  env:{...process.env,DECKSYNTH_UI_PREVIEW:'1',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 try{
  const p=await app.firstWindow({timeout:15000});
  p.setDefaultTimeout(8000);
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.setViewportSize({width:1280,height:720});
  await p.waitForFunction(()=>innerWidth===1280&&innerHeight===720,{timeout:5000});
  await p.getByRole('tab',{name:/^Sound$/}).click();
  const checked=(group,name)=>p.getByRole('radiogroup',{name:group}).getByRole('radio',{name,exact:true}).getAttribute('aria-checked');
  const val=id=>p.locator(`[data-param="${id}"] .knob-value`).innerText();

  // Cards remain reachable within the rack; the page never scrolls sideways.
  for(const id of ['sound-filter','sound-unison','sound-character']){
    const b=await p.locator('[data-panel="'+id+'"]').boundingBox();
    assert.ok(b&&b.y+b.height<=720&&b.x+b.width<=1280,id+' is on screen: '+JSON.stringify(b));
  }
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no sideways scroll');

  // Filter: off by default; the power button turns on low-pass; BP/HP are buttons; cutoff shows Hz.
  assert.equal(await p.locator('[data-panel="sound-filter"] .ss-knobs.is-off').count(),1,'filter starts off');
  await p.getByRole('switch',{name:'Turn filter on'}).click();
  assert.equal(await checked('Filter type','Low-pass'),'true');
  await p.getByRole('radio',{name:'Band-pass',exact:true}).click();
  assert.equal(await checked('Filter type','Band-pass'),'true');
  assert.match(await val('0-vcf-cutoff'),/kHz|Hz/);
  assert.match(await val('0-vcf-env'),/oct/);
  await p.getByRole('switch',{name:'Turn filter off'}).click();
  await p.getByRole('switch',{name:'Turn filter on'}).click();
  assert.equal(await checked('Filter type','Band-pass'),'true','power remembers the last type');

  // Unison: voice count buttons, detune in cents.
  await p.getByRole('radio',{name:'5 voices',exact:true}).click();
  assert.equal(await checked('Unison voices','5 voices'),'true');
  assert.match(await val('0-uni-detune'),/ct/);

  // Character: a vowel button turns the formant on; sub octave buttons.
  assert.equal(await val('0-formant'),'0%');
  await p.getByRole('radio',{name:'Vowel O',exact:true}).click();
  assert.equal(await checked('Vowel','Vowel O'),'true');
  assert.equal(await val('0-formant'),'70%','picking a vowel turns Formant up');
  await p.getByRole('radio',{name:'Two octaves down',exact:true}).click();
  assert.equal(await checked('Sub octave','Two octaves down'),'true');

  // Reset puts a card back to neutral.
  await p.locator('[data-panel="sound-character"] .ss-card-head h2').click({button:'right'});
  const menu=p.getByRole('menu',{name:/commands$/});await menu.waitFor();
  await menu.getByRole('button',{name:'Action list',exact:true}).click();
  await p.getByRole('menuitem',{name:'Reset default',exact:true}).click();
  await menu.waitFor({state:'hidden'}).catch(()=>p.keyboard.press('Escape'));
  assert.equal(await val('0-formant'),'0%');
  assert.equal(await checked('Sub octave','One octave down'),'true');

  // Mod pad links: arm Mod pad 1 on Link (the Link box lights), then a tap on Cutoff links it.
  await p.getByRole('tab',{name:/^Link$/}).click();
  await p.getByRole('button',{name:'Link Mod pad 1 to knobs'}).click();
  await p.getByRole('tab',{name:/^Sound$/}).click();
  assert.equal(await p.locator('.link-box.lit').count(),1,'Link box is lit');
  await p.locator('[data-param="0-vcf-cutoff"] .knob-target').click();
  await p.keyboard.press('Escape');
  assert.ok(await p.locator('[data-panel="sound-filter"] .fx-route-dots').count()>0,'linked knob shows its route dot');
  await p.screenshot({path:path.join(ROOT,'docs/voice-cards-acceptance.png')});
  assert.deepEqual(errs,[]);
  console.log('voice cards acceptance: ok');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
