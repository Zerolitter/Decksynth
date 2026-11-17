// FX drawer -> real Python engine: enable a module from the UI, play a note, and confirm the
// native FX library processes audio (module level > 0) and the spectrum data arrives.
// SDL uses the silent dummy sink; physical MIDI is never opened.
'use strict';
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
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'),{timeout:15000});
  await page.getByRole('tab',{name:/^FX$/i}).first().click();
  assert.equal(await page.locator('.fx-card-module').count(),0,'a new track starts with an empty rack');
  // An empty rack shows the effect picker itself (UI rule 5): no button to press first.
  await page.getByRole('button',{name:'Add Reverb'}).click();
  await page.locator('.fx-card-module').first().waitFor({timeout:5000});
  assert.equal(await page.locator('.fx-card-module').count(),1);
  await page.waitForFunction(()=>true);
  await page.evaluate(()=>window.deckApi.send('midi',[0x90,60,115]));
  const result = await page.evaluate(()=>new Promise((resolve,reject)=>{
    const stop=setTimeout(()=>reject(new Error('no FX level reported')),8000);
    const remove=window.deckApi.onMessage(msg=>{
      const lv=msg.meter?.fx?.[0]?.[9];
      if(lv>0.001){clearTimeout(stop);remove();resolve({lv,fx:msg.state.tracks[0].fx.modules.find(m=>m.id==='reverb').on,spec:msg.meter.spectrum.length});}
    });
  }));
  assert.equal(result.fx,true);
  assert.ok(result.spec>=256,'spectrum samples: '+result.spec);
  console.log('PASS: UI enabled Reverb on track 1; native FX processed live audio (level',result.lv+')');
  await page.evaluate(()=>window.deckApi.send('midi',[0x80,60,0]));
  assert.ok(await page.locator('.morph-pad').isVisible(),'Morph pad is always visible above the FX cards');
  await page.locator('.morph-pad').click({position:{x:40,y:12}});
  await page.waitForTimeout(400);
  const macro=await page.evaluate(()=>new Promise(r=>{const rm=window.deckApi.onMessage(m=>{if(m.state){rm();r(m.state.tracks[0].fx.macros[1].value);}});}));
  assert.ok(macro>.8,'Morph pad Y should set macro 2 high: '+macro);
  console.log('PASS: Morph pad writes its macro values into the engine project');
  // Path symbol: the engine moves the puck around the circle in audio time and reports it back.
  await page.getByRole('radio',{name:'Circle'}).click();
  for(let i=0;i<4;i++)await page.getByRole('button',{name:'Faster path'}).click();
  assert.equal(await page.locator('.morph-rate strong').textContent(),'1/4','four quick taps on Faster all count');
  await page.locator('select[aria-label="Pad mix drives"]').selectOption('2');
  await page.waitForTimeout(300);
  const ride=await page.evaluate(()=>new Promise(r=>{const xs=[];let morph=null;const rm=window.deckApi.onMessage(m=>{
    if(m.state)morph=m.state.tracks[0].fx.morph;const p=m.meter?.fx_live?.puck;if(p)xs.push(p[0]);
    if(xs.length>=40){rm();r({morph,xs});}});}));
  assert.equal(ride.morph.path,'circle'); assert.equal(ride.morph.rate,4); assert.equal(ride.morph.mixMacro,2);
  assert.ok(Math.max(...ride.xs)-Math.min(...ride.xs)>.25,'puck should travel the circle: '+ride.xs.slice(0,8));
  await page.getByRole('radio',{name:'Freeze'}).click(); await page.waitForTimeout(300);
  const still=await page.evaluate(()=>new Promise(r=>{const xs=[];const rm=window.deckApi.onMessage(m=>{
    const p=m.meter?.fx_live?.puck;if(p)xs.push(p[0]);if(xs.length>=12){rm();r(xs);}});}));
  assert.ok(Math.max(...still)-Math.min(...still)<.001,'Freeze holds the puck: '+still);
  await page.getByRole('radio',{name:'Hand'}).click();
  console.log('PASS: Morph pad path symbols move the puck in the engine; Freeze holds it',Math.min(...ride.xs).toFixed(2),Math.max(...ride.xs).toFixed(2));
  // Rack: arm mod pad 1, tap Filter cutoff, and confirm the engine sweeps the live cutoff value.
  assert.equal(await page.locator('.frame-fx [role=tablist]').count(),0,'no Effects/Morph switching');
  await page.getByRole('button',{name:'Add effect'}).click();
  await page.getByRole('button',{name:'Add Filter'}).click();
  await page.locator('[data-param="0-fx-filter-cutoff"]').waitFor({timeout:5000});
  await page.getByRole('radio',{name:'High pass'}).click();
  await page.getByRole('radio',{name:'Low pass'}).click();
  await page.getByRole('button',{name:/^Mod pad 1 /}).click();
  await page.getByRole('button',{name:'Link Mod pad 1 to knobs'}).click();
  await page.locator('[data-param="0-fx-filter-cutoff"]').click();
  await page.getByRole('button',{name:'Done'}).click();
  await page.evaluate(()=>window.deckApi.send('midi',[0x90,48,110]));
  const sweep=[];
  for(let i=0;i<8;i++){await page.waitForTimeout(250);
    sweep.push(await page.evaluate(()=>new Promise(r=>{const rm=window.deckApi.onMessage(m=>{if(m.meter?.fx_live){rm();r(m.meter.fx_live.params[7]);}});})));}
  assert.ok(Math.max(...sweep)-Math.min(...sweep)>.15,'cutoff should move with the mod pad: '+sweep);
  assert.equal(await page.locator('[data-param="0-fx-filter-cutoff"] .knob-mod').count(),1);
  // The pad editor beside the pads shows the new link.
  assert.ok(await page.locator('.pad-editor').getByText('Filter · Cutoff').isVisible(),'pad editor lists the link');
  console.log('PASS: tap-to-route mod pad sweeps the real Filter cutoff',sweep.map(v=>v.toFixed(2)).join(' '));
  // Remove Reverb: its card goes away and the engine stops running it.
  await page.getByRole('button',{name:'Remove Reverb'}).click();
  await page.waitForTimeout(300);
  const off=await page.evaluate(()=>new Promise(r=>{const rm=window.deckApi.onMessage(m=>{if(m.state){rm();r(m.state.tracks[0].fx.modules.find(x=>x.id==='reverb').on);}});}));
  assert.equal(off,false);
  console.log('PASS: effects are added and removed from the rack; LP/BP/HP are tap buttons');
  await page.evaluate(()=>window.deckApi.send('midi',[0x80,48,0]));
  const engineFx=()=>page.evaluate(()=>new Promise(r=>{const rm=window.deckApi.onMessage(m=>{if(m.state){rm();r(m.state.tracks[0].fx);}});}));
  // Power button: the Filter card stays in the rack but is switched off in the engine.
  await page.getByRole('button',{name:'Turn off Filter'}).click();
  await page.waitForTimeout(250);
  assert.equal((await engineFx()).modules.find(m=>m.id==='filter').bypass,true,'Filter should be bypassed');
  await page.getByRole('button',{name:'Turn on Filter'}).click();
  await page.waitForTimeout(250);
  assert.equal((await engineFx()).modules.find(m=>m.id==='filter').bypass,undefined,'Filter should run again');
  // Folding an effect keeps a slim title bar with its power button and a badge for its links.
  await page.getByRole('button',{name:'Fold Filter',exact:true}).dblclick();
  assert.ok(await page.locator('[data-panel="fx-filter"].folded .ds-panel-mods').isVisible(),'folded Filter shows its mod badge');
  await page.getByRole('button',{name:'Turn off Filter'}).waitFor({timeout:3000});
  await page.getByRole('button',{name:'Unfold Filter',exact:true}).click();
  // Clean up from Settings: clear every link, then empty the rack.
  await page.getByRole('button',{name:'Settings'}).click();
  await page.getByRole('button',{name:/Clear all mod links/}).click();
  await page.waitForTimeout(250);
  assert.equal((await engineFx()).mods[0].targets.length,0,'links cleared');
  await page.getByRole('button',{name:'Settings'}).click();
  await page.getByRole('button',{name:/Remove all effects/}).click();
  await page.waitForTimeout(250);
  assert.equal((await engineFx()).modules.filter(m=>m.on).length,0,'rack emptied');
  assert.equal(await page.locator('.fx-card-module').count(),0);
  console.log('PASS: power buttons bypass effects; folded cards keep power and mod badge; Settings clean-up clears links and effects');
  // Presets: the browser loads a library sound and its FX chain into the engine.
  await page.getByRole('tab',{name:/^Sound$/}).first().click();
  // Layout: Sound cards fold with a double-tap on the title bar; no sideways scrolling on the page.
  await page.getByRole('button',{name:'Fold Tone',exact:true}).dblclick();
  assert.equal(await page.locator('[data-param="0-brightness"]').count(),0,'Tone card should fold');
  await page.getByRole('button',{name:'Unfold Tone',exact:true}).click();
  assert.equal(await page.locator('[data-param="0-brightness"]').count(),1,'Tone card should unfold');
  // Sound knobs take links too: from the Sound page, link mod pad 2 to Brightness and the engine moves it.
  await page.getByRole('button',{name:/^Mod pad 2 /}).click();
  await page.getByRole('button',{name:'Link Mod pad 2 to knobs'}).click();
  await page.locator('[data-param="0-brightness"]').click();
  assert.equal(await page.getByRole('tab',{name:/^Sound$/}).first().getAttribute('aria-selected'),'true','linking stays on the Sound page');
  await page.getByRole('button',{name:'Done'}).click();
  await page.evaluate(()=>window.deckApi.send('midi',[0x90,60,100]));
  await page.waitForTimeout(300);
  const bright=await page.evaluate(()=>new Promise(r=>{const v=[];let t=null;const rm=window.deckApi.onMessage(m=>{
    if(m.state)t=m.state.tracks[0].fx.mods[1].targets;const x=m.meter?.fx_live?.sound?.filter;if(x!==undefined)v.push(x);
    if(v.length>=30){rm();r({t,v,saved:m.state?.tracks[0].instrument.filter});}});}));
  await page.evaluate(()=>window.deckApi.send('midi',[0x80,60,0]));
  assert.deepEqual(bright.t.map(x=>x.module+':'+x.param),['sound:filter']);
  assert.ok(Math.max(...bright.v)-Math.min(...bright.v)>.05,'Brightness should follow mod pad 2: '+bright.v.slice(0,6));
  assert.equal(await page.locator('[data-param="0-brightness"] .knob-mod').count(),1,'the Brightness knob shows its live ring');
  assert.ok(await page.locator('[data-panel="sound-tone"] .ds-panel-mods').isVisible(),'Tone card shows its link badge');
  console.log('PASS: mod pad 2 linked from the Sound page moves Brightness in the engine',Math.min(...bright.v).toFixed(2),Math.max(...bright.v).toFixed(2));
  // One frame: the mod band, focus window and rack sit at the same place on Sound and FX.
  const frame=()=>page.evaluate(()=>['.mod-band','.frame-window','.frame-rack'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();
    return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)].join(',');}));
  const soundFrame=await frame();
  const cards=await page.evaluate(()=>{const body=document.querySelector('.page-body').getBoundingClientRect();
    return [...document.querySelectorAll('.frame-rack .rack-card')].map(el=>{const r=el.getBoundingClientRect();
      return {id:el.dataset.panel,h:Math.round(r.height),inside:r.bottom<=body.bottom+1&&r.right<=body.right+1};});});
  assert.deepEqual(cards.map(c=>c.id),['sound-tone','rack-envelope','motion-synth','rack-output','sound-filter','sound-unison','sound-character']);
  for(const {id} of cards){const card=page.locator('[data-panel="'+id+'"]');await card.scrollIntoViewIfNeeded();const r=await card.boundingBox();assert.ok(r.x>=0&&r.x+r.width<=1281&&r.y+r.height<=723,'Sound card reachable within its rack: '+id);}
  assert.ok(cards.every(c=>c.h===cards[0].h),'rack cards share one height: '+JSON.stringify(cards));
  await page.getByRole('tab',{name:/^FX$/i}).first().click();
  // SOUND and FX use the same band, focus window and single rail rack.
  const fxFrame=await frame(),top=f=>[f[0],f[1].split(',').slice(0,3).join(',')];
  assert.deepEqual(top(fxFrame),top(soundFrame),'FX uses the same frame as Sound');
  await page.getByRole('tab',{name:/^Sound$/}).first().click();
  // Tapping another pad switches the editor beside the pads.
  await page.getByRole('button',{name:/^Mod pad 4 /}).click();
  assert.ok(await page.locator('.pad-editor strong').filter({hasText:'Mod pad 4'}).isVisible());
  for(const t of ['Morph pad','Partials'])await page.getByRole('tab',{name:t,exact:true}).click();
  assert.equal(await page.locator('.song-strip').count(),0,'no Song strip on the Sound page');
  // Spectral shaping is real DSP: turning Curve reaches the engine's saved instrument.
  const curveKnob=page.locator('[data-param="0-curve"] .knob-target');
  await curveKnob.scrollIntoViewIfNeeded();
  const cb=await curveKnob.boundingBox();
  await page.mouse.move(cb.x+cb.width/2,cb.y+cb.height/2);await page.mouse.down();
  await page.mouse.move(cb.x+cb.width/2,cb.y-90,{steps:8});await page.mouse.up();
  const curve=await page.evaluate(()=>new Promise(r=>{const rm=window.deckApi.onMessage(m=>{const v=m.state?.tracks?.[0]?.instrument?.curve;if(v!==undefined){rm();r(v);}});}));
  assert.ok(curve>.1,'curve should rise: '+curve);
  const sideways=await page.evaluate(()=>{const b=document.querySelector('.page-body');return b.scrollWidth-b.clientWidth;});
  assert.ok(sideways<=1,'Sound page scrolls sideways by '+sideways);
  console.log('PASS: Sound and FX share one frame; pad editor follows the tapped pad; cards fold on double-tap; no sideways scroll');
  await page.getByRole('button',{name:'Browse presets'}).click();
  await page.getByRole('tab',{name:'Bass'}).click();
  await page.getByRole('button',{name:'Load preset Wobble Bass'}).click();
  const loaded=await page.evaluate(()=>new Promise(r=>{const rm=window.deckApi.onMessage(m=>{const t=m.state?.tracks?.[0];if(t?.preset==='Wobble Bass'){rm();r({mods:t.fx.mods[0].targets.length,on:t.fx.modules.filter(x=>x.on).length});}});}));
  assert.ok(loaded.mods>0&&loaded.on>0,'preset FX: '+JSON.stringify(loaded));
  assert.equal(await page.getByRole('button',{name:/^(Previous|Next) preset$/}).count(),0,'no preset arrows');
  await page.getByRole('button',{name:'Load preset Acid Bass'}).click();
  await page.waitForFunction(()=>document.querySelector('.preset-current strong')?.textContent==='Acid Bass');
  console.log('PASS: preset browser loads library sounds with their FX and mod pads');
  // Factory patterns fill a bank in the engine.
  await page.getByRole('tab',{name:/^Perform$/}).first().click();
  await page.getByRole('button',{name:'Library'}).click();
  await page.getByRole('button',{name:'Load Arps into bank 3'}).click();
  const pats=await page.evaluate(()=>new Promise(r=>{const rm=window.deckApi.onMessage(m=>{const p=m.state?.performance;if(p&&Object.keys(p.patterns).length===16){rm();r({keys:Object.keys(p.patterns),bank:p.seq.bank});}});}));
  assert.ok(pats.keys.every(k=>k.startsWith('3:')),'bank 3 keys: '+pats.keys);
  console.log('PASS: Pattern library loads 16 factory patterns into a bank');
  // Start over empties the session; Undo brings the old one back.
  await page.getByRole('button',{name:'Settings'}).click();
  await page.getByRole('button',{name:/Start over/}).click();
  await page.getByRole('button',{name:'Start over',exact:true}).click();
  const fresh=await page.evaluate(()=>new Promise(r=>{const rm=window.deckApi.onMessage(m=>{if(m.state){rm();r(m.state.tracks[0].preset);}});}));
  assert.equal(fresh,'Warm Keys');
  await page.getByRole('button',{name:'Undo'}).click();
  await page.waitForTimeout(300);
  const back=await page.evaluate(()=>new Promise(r=>{const rm=window.deckApi.onMessage(m=>{if(m.state){rm();r(m.state.tracks[0].preset);}});}));
  assert.equal(back,'Acid Bass','Undo restores the session from before Start over');
  console.log('PASS: Start over asks once, empties the session, and Undo restores it');
  assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(ROOT,'docs','live-fx-acceptance.png')});
  console.log('PASS: no renderer errors in live FX session');
})().catch(err=>{console.error('FAIL',err.stack||err);process.exitCode=1;}).finally(()=>app&&app.close());
