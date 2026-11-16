// Preview UI test for the Filter, Unison and Character cards (patch 24): buttons for the fixed choices,
// knobs that show units, the filter's power button, mod pad links to the new knobs, and nothing off screen at 722 px.
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
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,722));
  await p.getByRole('tab',{name:/^Sound$/}).click();
  const checked=(group,name)=>p.getByRole('radiogroup',{name:group}).getByRole('radio',{name,exact:true}).getAttribute('aria-checked');
  const val=id=>p.locator(`[data-param="${id}"] .knob-value`).innerText();

  // Cards remain reachable within the rack; the page never scrolls sideways.
  for(const id of ['sound-filter','sound-unison','sound-character']){
    const card=p.locator('[data-panel="'+id+'"]');if(await card.evaluate(n=>n.classList.contains('folded')))await card.getByRole('button',{name:/Unfold/}).click();await card.scrollIntoViewIfNeeded();const b=await card.boundingBox();
    assert.ok(b&&b.y+b.height<=722&&b.x+b.width<=1280,id+' is on screen: '+JSON.stringify(b));
  }
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no sideways scroll');

  // Filter: off by default; the power button turns on low-pass; BP/HP are buttons; cutoff shows Hz.
  assert.equal(await p.locator('[data-panel="sound-filter"] .rack-knobs.is-off').count(),1,'filter starts off');
  await p.getByRole('button',{name:'Turn on filter'}).click();
  assert.equal(await checked('Filter type','Low-pass'),'true');
  await p.getByRole('radio',{name:'Band-pass',exact:true}).click();
  assert.equal(await checked('Filter type','Band-pass'),'true');
  assert.match(await val('0-vcf-cutoff'),/kHz|Hz/);
  assert.match(await val('0-vcf-env'),/oct/);
  await p.getByRole('button',{name:'Turn off filter'}).click();
  await p.getByRole('button',{name:'Turn on filter'}).click();
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
  await p.getByRole('button',{name:'Reset character'}).click();
  assert.equal(await val('0-formant'),'0%');
  assert.equal(await checked('Sub octave','One octave down'),'true');

  // Mod pad links: the new knobs are in the Sound list.
  await p.locator('.mod-band').getByRole('button',{name:/Add target|Edit links/}).first().click();
  for(const name of ['Cutoff','Resonance','Detune','Formant','Vowel','Stretch','Sub'])
    assert.ok(await p.locator('.mod-link-params').getByRole('button',{name,exact:true}).isVisible(),name+' can be linked');
  await p.locator('.mod-link-params').getByRole('button',{name:'Cutoff',exact:true}).click();
  await p.keyboard.press('Escape');
  assert.ok(await p.locator('[data-panel="sound-filter"] .fx-route-dots').count()>0,'linked knob shows its route dot');
  await p.screenshot({path:path.join(ROOT,'docs/voice-cards-acceptance.png')});
  assert.deepEqual(errs,[]);
  console.log('voice cards acceptance: ok');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
