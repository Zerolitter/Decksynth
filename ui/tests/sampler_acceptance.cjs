// Sampler track (15 Nov). Real worker, dummy audio: a Drum Rack pad becomes a Sampler from Pad Sound,
// the Sampler page (window handles, Play / Pitch / Amp cards, keyboard), Loop mode, Detect, undo,
// and the empty Sampler that offers the pads straight away.
'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.OUT||path.resolve(ROOT,'../artifacts/sampler');const H=Number(process.env.HEIGHT||718);
const DATA=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-sampler-'));
function toneWav(file,freq,seconds){
 const rate=48000,n=Math.round(rate*seconds),b=Buffer.alloc(44+n*2);
 b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
 b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);
 for(let i=0;i<n;i++)b.writeInt16LE(Math.round(20000*Math.sin(2*Math.PI*freq*i/rate)*Math.exp(-i/rate*1.5)),44+i*2);
 fs.writeFileSync(file,b);return file;
}
let app,page;
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const wav=toneWav(path.join(DATA,'Snare Tone.wav'),220,1.5);  // 220 Hz is A3
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:DATA,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 const p=page=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,h);},H);
 await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 await p.evaluate(()=>{window.__msgs=[];window.deckApi.onMessage(m=>{if(m.state)window.__latest=m;if(m.message)window.__msgs.push(m.message);if(m.error)window.__msgs.push('ERROR '+m.error);});});
 await p.waitForFunction(()=>!!window.__latest);
 const latest=()=>p.evaluate(()=>window.__latest);
 const send=(c,a)=>p.evaluate(([c,a])=>window.deckApi.send(c,a),[c,a]);
 const inside=async(loc,what)=>{const b=await loc.boundingBox();assert.ok(b&&b.width>=44&&b.height>=44,what+' is 44 px: '+JSON.stringify(b));
  assert.ok(b.y+b.height<=H+1&&b.x+b.width<=1281,what+' inside the window: '+JSON.stringify(b));
  const hit=await loc.evaluate(e=>{const r=e.getBoundingClientRect();const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!t&&(e===t||e.contains(t));});
  assert.ok(hit,what+' is not covered');};

 // Track 1: a Drum Rack with the tone on pad 3.
 await send('select',0);await send('set_device',[0,'drum_rack']);
 await p.waitForFunction(()=>window.__latest.state.tracks[0].device==='drum_rack');
 const kit=(await latest()).state.tracks[0].drum_rack.id;
 await send('drum_import',[0,kit,2,wav]);
 await p.waitForFunction(()=>window.__latest.drum_racks?.[0]?.pads[2]?.status==='READY',null,{timeout:20000});
 await p.getByRole('tab',{name:/^Sound$/i}).click();
 await p.getByRole('button',{name:/^Pad 3,/}).click();
 const keysButton=p.getByRole('button',{name:'Play this pad on the keys'});
 await inside(keysButton,'Play on keys button');
 await keysButton.click();

 // The sheet: three target tracks, the root, Make. Esc and a blank tap close it.
 const sheet=p.getByRole('dialog',{name:/on the keys/});await sheet.waitFor();
 for(const n of [2,3,4])await inside(sheet.getByRole('radio',{name:new RegExp('^Track '+n)}),'Target track '+n);
 await inside(sheet.getByRole('button',{name:'Detect'}),'Detect');await inside(sheet.getByRole('button',{name:/^Make Sampler/}),'Make');
 await p.screenshot({path:path.join(OUT,'sheet-'+H+'.png')});
 await p.keyboard.press('Escape');await sheet.waitFor({state:'detached'});
 await keysButton.click();await sheet.waitFor();
 await p.mouse.click(8,H-8);await sheet.waitFor({state:'detached'});
 await keysButton.click();await sheet.waitFor();
 await sheet.getByRole('radio',{name:/^Track 2/}).click();
 await sheet.getByRole('button',{name:/^Make Sampler on track 2/}).click();

 // Track 2 is now a Sampler playing the pad, root detected as A3, and it is selected.
 await p.waitForFunction(()=>window.__latest.state.tracks[1].device==='sampler'&&window.__latest.selected===1);
 await p.waitForFunction(()=>window.__latest.samplers?.[1]?.status==='READY');
 const spec=(await latest()).state.tracks[1].sampler;
 assert.equal(spec.root,57,'root detected from the 220 Hz tone');assert.equal(spec.family,'snare');
 assert.equal(spec.source.sha256,(await latest()).state.tracks[0].drum_rack.pads[2].source.sha256);
 await p.locator('.sampler-page').waitFor();
 for(const name of ['One shot','Hold','Loop','Poly','Mono'])await inside(p.getByRole('radio',{name,exact:true}),name);
 for(const name of ['Root note down','Root note up'])await inside(p.getByRole('button',{name}),name);
 await inside(p.getByRole('button',{name:'Detect'}),'Detect');
 await inside(p.getByRole('button',{name:/^Start /}),'Start handle');await inside(p.getByRole('button',{name:/^End /}),'End handle');
 for(const name of ['Attack handle','Decay and sustain handle','Release handle']){const b=await p.getByRole('slider',{name}).boundingBox();assert.ok(b&&b.y+b.height<=H+1,name+' visible');}
 const keys=p.getByRole('group',{name:'Sampler keyboard'});const kb=await keys.boundingBox();
 assert.ok(kb.y+kb.height<=H+1&&kb.height>=80,'keyboard fits: '+JSON.stringify(kb));
 assert.ok(await p.locator('.smp-white.root').count()===1,'the root key is marked');

 // Keys play it: a held key keeps a voice, letting go releases it.
 const root=p.locator('.smp-white.root');const rb=await root.boundingBox();
 await p.evaluate(()=>{window.__pd=[];for(const t of ['pointerdown','pointerup','pointercancel','lostpointercapture'])window.addEventListener(t,e=>window.__pd.push(t+':'+e.target.className+':'+e.button),true);});
 await p.mouse.move(rb.x+rb.width/2,rb.y+rb.height-12);await p.mouse.down();
 await p.waitForFunction(()=>window.__latest.samplers?.[1]?.voices>0).catch(async e=>{console.error('keys',await p.evaluate(()=>[document.elementFromPoint(0,0)&&0,{...window.__latest.samplers?.[1],peaks:0},window.__latest.held_notes,window.__latest.selected,window.__latest.voices,window.__pd]),await p.evaluate(([x,y])=>document.elementFromPoint(x,y)?.outerHTML.slice(0,120),[rb.x+rb.width/2,rb.y+rb.height-12]));throw e;});
 await p.screenshot({path:path.join(OUT,'sampler-'+H+'.png')});
 await p.mouse.up();
 await p.waitForFunction(()=>window.__latest.samplers?.[1]?.voices===0,null,{timeout:5000});

 // Loop mode shows the loop handles; dragging End is one edit.
 await p.getByRole('radio',{name:'Loop',exact:true}).click();
 await p.waitForFunction(()=>window.__latest.state.tracks[1].sampler.mode==='loop');
 await inside(p.getByRole('button',{name:/^Loop \d/}),'Loop start handle');await inside(p.getByRole('button',{name:/^Loop end /}),'Loop end handle');
 const end=await p.getByRole('button',{name:/^End /}).boundingBox();
 await p.mouse.move(end.x+22,end.y+end.height/2);await p.mouse.down();await p.mouse.move(end.x-200,end.y+end.height/2,{steps:6});await p.mouse.up();
 await p.waitForFunction(()=>window.__latest.state.tracks[1].sampler.end<.9);
 const after=(await latest()).state.tracks[1].sampler;assert.ok(after.loop_end<=after.end,'the loop stays inside the play range');
 await p.screenshot({path:path.join(OUT,'loop-'+H+'.png')});
 await send('undo');await p.waitForFunction(()=>window.__latest.state.tracks[1].sampler.end===1);

 // Root: down a semitone, then Detect finds A3 again.
 await p.getByRole('button',{name:'Root note down'}).click();
 await p.waitForFunction(()=>window.__latest.state.tracks[1].sampler.root===56);
 await p.getByRole('button',{name:'Detect'}).click();
 await p.waitForFunction(()=>window.__latest.state.tracks[1].sampler.root===57);

 // Track 3 switched to Sampler: the empty Sampler lists the pads to pick from.
 await send('select',2);await p.waitForFunction(()=>window.__latest.selected===2);await p.getByRole('radio',{name:'Sampler'}).click();
 await p.waitForFunction(()=>window.__latest.state.tracks[2].device==='sampler');
 const pick=p.getByRole('button',{name:/Track 1 · Pad 03/});await inside(pick,'Pad choice');
 await p.screenshot({path:path.join(OUT,'empty-'+H+'.png')});
 await pick.click();
 await p.waitForFunction(()=>window.__latest.state.tracks[2].sampler?.source&&window.__latest.samplers?.[2]?.status==='READY');

 // Undo takes track 3 back to the empty Sampler.
 await send('undo');await p.waitForFunction(()=>!window.__latest.state.tracks[2].sampler.source);
 const bad=(await p.evaluate(()=>window.__msgs)).filter(m=>m.startsWith('ERROR'));
 assert.deepEqual(bad,[]);assert.deepEqual(errors,[]);
 console.log('sampler acceptance ok at',H);
 await app.close();
})().catch(async e=>{console.error(e);try{console.error(await page.evaluate(()=>window.__msgs));await page.screenshot({path:path.join(OUT,'failure-'+H+'.png')});}catch{}if(app)await app.close();process.exit(1);});
