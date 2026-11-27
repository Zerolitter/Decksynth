// Sampler batch (27 Nov): a stereo sample says so in the rack display, the Amp card holds Fade in and Fade out, and
// the Env view has their points on the middle line (one edit per drag, double-click resets; no Fade out point while it
// loops). Every new control is 44 px, inside the window and not covered; the waveform keeps its room.
// Real worker, dummy audio. HEIGHT=718 or 800.
'use strict';
require('./deck_guard.cjs');
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.OUT||path.resolve(ROOT,'../artifacts/sampler-stereo');const H=Number(process.env.HEIGHT||718);
const DATA=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-smpstereo-'));
function wav(file,seconds=1.5,rate=48000){   // stereo: a 220 Hz saw on the left, a quieter 330 Hz saw on the right
  const n=Math.round(seconds*rate),b=Buffer.alloc(44+4*n);
  b.write('RIFF',0);b.writeUInt32LE(36+4*n,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);
  b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*4,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4*n,40);
  for(let i=0;i<n;i++){const l=(i*220/rate)%1,r=(i*330/rate)%1;
    b.writeInt16LE(Math.round((l*2-1)*.4*32767),44+4*i);b.writeInt16LE(Math.round((r*2-1)*.2*32767),46+4*i);}
  fs.writeFileSync(file,b);return file;}
let app,page;
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const file=wav(path.join(DATA,'wide.wav'));
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
 await p.waitForFunction(()=>window.__latest.samplers?.[0]?.status==='READY',null,{timeout:20000});
 assert.equal(await p.evaluate(()=>window.__latest.samplers[0].stereo),true,'the engine plays it in stereo');
 await p.getByRole('tab',{name:/^Sound$/i}).click();await p.locator('.sampler-page').waitFor();
 await p.waitForFunction(()=>/Stereo/i.test(document.querySelector('.sampler-page .smp-rack-stereo')?.textContent||''));
 await p.waitForTimeout(300);
 await p.screenshot({path:path.join(OUT,'sampler-stereo-'+H+'.png')});
 const amp=p.locator('.sampler-page section.smp-card[aria-label="Amp"]');
 const names=(await amp.locator('.knob-heading').allTextContents()).map(t=>t.trim());
 assert.deepEqual(names,['Attack','Decay','Sustain','Release','Fade in','Fade out']);
 const knobs=await amp.locator('.knob-target').all();
 for(const [i,x] of knobs.entries())await inside(x,'Amp knob '+names[i]);
 const tabs=p.getByRole('radiogroup',{name:'Edit'});
 // Chop: the waveform keeps the same room as before the batch (120 px at 718).
 await tabs.getByRole('radio',{name:'Chop'}).click();await p.locator('.sampler-page .smp-chop').waitFor();await p.waitForTimeout(300);
 const wave=await p.locator('.sampler-page .smp-window').boundingBox();
 assert.ok(wave.height>=(H<760?118:100),'waveform keeps its room in Chop: '+wave.height);
 await tabs.getByRole('radio',{name:'Trim'}).click();

 // The Env view: Fade in and Fade out points on the middle line.
 await tabs.getByRole('radio',{name:'Envelope'}).click();
 const env=p.getByRole('group',{name:/^Amp envelope: drag/});await env.waitFor();
 const eb=await env.boundingBox();
 for(const h of ['fade_in','fade_out']){const b=await env.locator('[data-handle='+h+']').boundingBox();
  assert.ok(b.width>=44&&b.height>=44,h+' point has a 44 px hit zone');assert.ok(b.x>=eb.x-23&&b.x+b.width<=eb.x+eb.width+23,h+' point on the view');}
 const drag=async(key,dx)=>{const b=await env.locator('[data-handle='+key+']').boundingBox();
  await p.mouse.move(b.x+b.width/2,b.y+b.height/2);await p.mouse.down();
  for(let i=1;i<=6;i++)await p.mouse.move(b.x+b.width/2+i*dx*eb.width/6,b.y+b.height/2);
  await p.waitForTimeout(120);await p.mouse.up();};
 await drag('fade_in',.15);
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.fade_in>.05);
 await drag('fade_out',-.2);
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.fade_out>.05);
 assert.ok((await S()).fade_in>.05,'Fade in kept');
 await p.waitForFunction(()=>(document.querySelector('.sampler-page section.smp-card[aria-label="Amp"]')?.textContent||'').includes('ms'));
 await p.waitForTimeout(200);
 await p.screenshot({path:path.join(OUT,'sampler-fades-env-'+H+'.png')});
 assert.ok(!(await p.locator('body').innerText()).includes('Unknown Sampler parameter'),'the fades are heard while dragging (no error)');
 await p.getByRole('button',{name:'Undo',exact:true}).click();
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.fade_out===0,null,{timeout:5000});
 assert.ok((await S()).fade_in>.05,'one drag is one undo step');
 // Double-click resets a point.
 const fb=await env.locator('[data-handle=fade_in]').boundingBox();
 await p.mouse.dblclick(fb.x+fb.width/2,fb.y+fb.height/2);
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.fade_in===0,null,{timeout:5000});
 // Loop: a loop never reaches End, so there is no Fade out point.
 await send('sampler_edit',[0,id,'patch',{mode:'loop'}]);
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.mode==='loop');
 await p.waitForTimeout(200);
 assert.equal(await env.locator('[data-handle=fade_out]').count(),0,'no Fade out point while it loops');
 assert.equal(await env.locator('[data-handle=fade_in]').count(),1);
 assert.deepEqual(errors,[],'no page errors');
 console.log('PASS sampler stereo and fades at '+H);
})().catch(async e=>{console.error(e);try{await page?.screenshot({path:path.join(OUT,'failure-'+H+'.png')});}catch{}process.exitCode=1;}).finally(async()=>{try{await app?.close();}catch{}});
