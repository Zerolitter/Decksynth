// Sampler filter batch (25 Nov): the Filter card's LP 24 drawing, Hold / Sustain / Release and velocity knobs, the filter
// envelope's points on the big Filter view (heard while dragging, one edit on release), Glide Legato / Always and Pan.
// Real worker, dummy audio. Every new control is 44 px, inside the window and not covered. HEIGHT=718 or 800.
'use strict';
require('./deck_guard.cjs');
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.OUT||path.resolve(ROOT,'../artifacts/sampler-filter');const H=Number(process.env.HEIGHT||718);
const DATA=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-smpfilter-'));
function wav(file,seconds=1.5,rate=48000){   // a 220 Hz saw: bright enough to hear the filter
  const n=Math.round(seconds*rate),b=Buffer.alloc(44+2*n);
  b.write('RIFF',0);b.writeUInt32LE(36+2*n,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
  b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(2*n,40);
  for(let i=0;i<n;i++){const ph=(i*220/rate)%1;b.writeInt16LE(Math.round((ph*2-1)*.4*32767*Math.min(1,(n-i)/2000)),44+2*i);}
  fs.writeFileSync(file,b);return file;}
let app,page;
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const file=wav(path.join(DATA,'saw.wav'));
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:DATA,DECKSYNTH_NO_AUTOSAVE:'1',SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 const p=page=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,h);},H);
 await p.setViewportSize({width:1280,height:H});await p.waitForFunction(h=>innerWidth===1280&&innerHeight===h,H,{timeout:5000});
 await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 await p.evaluate(()=>{window.deckApi.onMessage(m=>{if(m.state)window.__latest=m;});});
 await p.waitForFunction(()=>!!window.__latest);
 const send=(c,a)=>p.evaluate(([c,a])=>window.deckApi.send(c,a),[c,a]);
 const S=()=>p.evaluate(()=>window.__latest.state.tracks[0].sampler);
 const inside=async(loc,what)=>{const b=await loc.boundingBox();assert.ok(b&&b.width>=44&&b.height>=44,what+' is 44 px: '+JSON.stringify(b));
  assert.ok(b.y+b.height<=H+1&&b.x+b.width<=1281,what+' inside the window: '+JSON.stringify(b));
  const hit=await loc.evaluate(e=>{const r=e.getBoundingClientRect();const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!t&&(e===t||e.contains(t));});
  assert.ok(hit,what+' is not covered');};
 await send('select',0);await send('set_device',[0,'sampler']);
 await p.waitForFunction(()=>window.__latest.state.tracks[0].device==='sampler');
 const id=(await S()).id;await send('sampler_load_wav',[0,id,file]);
 await p.waitForFunction(()=>!!window.__latest.state.tracks[0].sampler?.source,null,{timeout:20000});
 await p.getByRole('tab',{name:/^Sound$/i}).click();await p.locator('.sampler-page').waitFor();
 await send('sampler_edit',[0,id,'patch',{filter:'lp',cutoff:400,f_env:.6,f_attack:.02,f_decay:.4}]);
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.filter==='lp');
 await p.waitForTimeout(400);
 await p.screenshot({path:path.join(OUT,'sampler-'+H+'.png')});
 if(process.env.SHOT_ONLY){await app.close();return;}
 const card=n=>p.locator('.sampler-page section.smp-card[aria-label="'+n+'"]');
 // Filter card: Filter / Env pages are its title, four drawn types with LP 24.
 const fpages=card('Filter').getByRole('radiogroup',{name:'Filter page'});
 for(const n of ['Filter','Env'])await inside(fpages.getByRole('radio',{name:n,exact:true}),'Filter page '+n);
 const types=card('Filter').getByRole('radiogroup',{name:'Filter type'});
 for(const n of ['Low-pass','Low-pass 24 dB','Band-pass','High-pass'])await inside(types.getByRole('radio',{name:n,exact:true}),n);
 await types.getByRole('radio',{name:'Low-pass 24 dB',exact:true}).click();
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.filter==='lp24');
 let k=await card('Filter').locator('.knob-target').all();assert.equal(k.length,5,'Cutoff, Resonance, Env, Env vel, Velocity');
 for(const [i,x] of k.entries())await inside(x,'filter knob '+(i+1));
 await fpages.getByRole('radio',{name:'Env',exact:true}).click();
 k=await card('Filter').locator('.knob-target').all();assert.equal(k.length,5,'Attack, Hold, Decay, Sustain, Release');
 for(const [i,x] of k.entries())await inside(x,'filter env knob '+(i+1));
 const names=await card('Filter').locator('.knob-heading').allTextContents();
 assert.deepEqual(names.map(t=>t.trim()),['Attack','Hold','Decay','Sustain','Release']);
 await p.screenshot({path:path.join(OUT,'sampler-filter-env-page-'+H+'.png')});

 // The big Filter view: the curve and the envelope side by side; drag Hold right and Decay·Sustain up.
 const tabs=p.getByRole('radiogroup',{name:'Edit'});await tabs.getByRole('radio',{name:'Filter'}).click();
 await p.getByRole('group',{name:/^Filter: drag/}).waitFor();
 const env=p.getByRole('group',{name:/^Filter envelope: drag/});await env.waitFor();
 const eb=await env.boundingBox();
 const drag=async(key,dx,dy)=>{const b=await env.locator('[data-handle='+key+']').boundingBox();
  await p.mouse.move(b.x+b.width/2,b.y+b.height/2);await p.mouse.down();
  for(let i=1;i<=6;i++)await p.mouse.move(b.x+b.width/2+i*dx*eb.width/6,b.y+b.height/2+i*dy*eb.height/6);
  await p.waitForTimeout(120);await p.mouse.up();};
 for(const h of ['f_attack','f_hold','f_decay','f_release']){const b=await env.locator('[data-handle='+h+']').boundingBox();assert.ok(b.width>=44&&b.height>=44,h+' point has a 44 px hit zone');}
 await drag('f_hold',.12,0);
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.f_hold>.05);
 await drag('f_decay',.05,-.3);
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.f_sustain>.2);
 assert.ok((await S()).f_hold>.05,'Hold kept');
 await p.screenshot({path:path.join(OUT,'sampler-filter-view-'+H+'.png')});
 await p.getByRole('button',{name:'Undo',exact:true}).click();
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.f_sustain===0,null,{timeout:5000});
 assert.ok((await S()).f_hold>.05,'one drag is one undo step');

 // Play: Glide Legato / Always (Mono only), Pan and Vel attack.
 await tabs.getByRole('radio',{name:'Trim'}).click();
 const glide=card('Play').getByRole('radiogroup',{name:'Glide mode'});
 assert.ok(await glide.getByRole('radio',{name:'Always'}).isDisabled(),'Glide mode waits for Mono');
 await card('Play').getByRole('radio',{name:'Mono'}).click();
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.poly===false);
 for(const n of ['Legato','Always'])await inside(glide.getByRole('radio',{name:n}),'Glide '+n);
 await glide.getByRole('radio',{name:'Always'}).click();
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.glide_mode==='always');
 k=await card('Play').locator('.knob-target').all();assert.equal(k.length,5,'Glide, Gain, Pan, Velocity, Vel attack');
 for(const [i,x] of k.entries())await inside(x,'play knob '+(i+1));
 await send('sampler_edit',[0,id,'patch',{pan:-.5,vel_attack:.4}]);
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.pan===-.5);
 await p.waitForFunction(()=>{const t=document.querySelector('.sampler-page section.smp-card[aria-label="Play"]')?.textContent||'';return /L 50/.test(t)&&/40%/.test(t);});
 await inside(card('Play').getByRole('button',{name:'Normalize'}),'Normalize');
 await p.screenshot({path:path.join(OUT,'sampler-play-'+H+'.png')});
 // Chop: the waveform keeps the same room as before the batch (120 px at 718).
 await tabs.getByRole('radio',{name:'Chop'}).click();await p.locator('.sampler-page .smp-chop').waitFor();await p.waitForTimeout(300);
 const cards=await p.locator('.sampler-page .smp-deck>.smp-cards').boundingBox(),wave=await p.locator('.sampler-page .smp-window').boundingBox();
 assert.ok(cards.y>0,'cards on screen');assert.ok(wave.height>=(H<760?118:100),'waveform keeps its room in Chop: '+wave.height);
 await p.screenshot({path:path.join(OUT,'sampler-chop-'+H+'.png')});
 await tabs.getByRole('radio',{name:'Trim'}).click();

 // Grain mode: Live in still fits in the Play card.
 await card('Play').getByRole('radio',{name:'Grain'}).click();
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.mode==='grain');
 await inside(card('Play').getByRole('button',{name:'Live in'}),'Live in');
 await inside(card('Play').getByRole('button',{name:'Normalize'}),'Normalize in Grain mode');
 await p.screenshot({path:path.join(OUT,'sampler-grain-play-'+H+'.png')});
 assert.deepEqual(errors,[],'no page errors');
 console.log('PASS sampler filter batch at '+H);
})().catch(async e=>{console.error(e);try{await page?.screenshot({path:path.join(OUT,'failure-'+H+'.png')});}catch{}process.exitCode=1;}).finally(async()=>{try{await app?.close();}catch{}});
