// Grain mode of the Sampler (24 Nov). Real worker, dummy audio: Play › Grain opens the Grain tab, the waveform shows
// Position and the spray zone, a held key sounds grains that show on the waveform, the Grain card's choices and knobs
// are 44 px and uncovered, dragging Position is one edit, and leaving Grain mode brings Pitch and Filter back.
'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.OUT||path.resolve(ROOT,'../artifacts/grain');const H=Number(process.env.HEIGHT||718);
const DATA=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-grain-'));
function toneWav(file,seconds){
 const rate=48000,n=Math.round(rate*seconds),b=Buffer.alloc(44+n*2);
 b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
 b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);
 // a chord that swells and fades, so the waveform has a shape
 for(let i=0;i<n;i++){const t=i/rate,env=Math.sin(Math.PI*t/seconds)**2;
  b.writeInt16LE(Math.round(9000*env*(Math.sin(2*Math.PI*220*t)+Math.sin(2*Math.PI*277*t)+.6*Math.sin(2*Math.PI*330*t))),44+i*2);}
 fs.writeFileSync(file,b);return file;
}
let app,page;
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const wav=toneWav(path.join(DATA,'Pad Chord.wav'),3);
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:DATA,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 const p=page=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,h);},H);
 await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 await p.evaluate(()=>{window.__msgs=[];window.deckApi.onMessage(m=>{if(m.state)window.__latest=m;if(m.samplers)window.__smp=m.samplers;if(m.message)window.__msgs.push(m.message);if(m.error)window.__msgs.push('ERROR '+m.error);});});
 await p.waitForFunction(()=>!!window.__latest);
 const latest=()=>p.evaluate(()=>window.__latest);
 const send=(c,a)=>p.evaluate(([c,a])=>window.deckApi.send(c,a),[c,a]);
 const inside=async(loc,what)=>{const b=await loc.boundingBox();assert.ok(b&&b.width>=44&&b.height>=44,what+' is 44 px: '+JSON.stringify(b));
  assert.ok(b.y+b.height<=H+1&&b.x+b.width<=1281,what+' inside the window: '+JSON.stringify(b));
  const hit=await loc.evaluate(e=>{const r=e.getBoundingClientRect();const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!t&&(e===t||e.contains(t));});
  assert.ok(hit,what+' is not covered');};

 // Track 1 plays the chord as a Sampler.
 await send('select',0);await send('set_device',[0,'sampler']);
 await p.waitForFunction(()=>window.__latest?.state?.tracks?.[0]?.device==='sampler');
 await send('sampler_load_wav',[0,(await latest()).state.tracks[0].sampler.id,wav]);
 await p.waitForFunction(()=>window.__latest?.samplers?.[0]?.status==='READY',null,{timeout:30000});
 await p.getByRole('tab',{name:/^Sound$/i}).click();
 await p.locator('.sampler-page').waitFor();

 // Play › Grain: the Grain tab opens with Position on the waveform and the Grain card in place of Pitch and Filter.
 const grainMode=p.getByRole('radio',{name:'Grain',exact:true}).first();
 await inside(grainMode,'Grain play mode');await grainMode.click();
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.mode==='grain');
 const card=p.locator('section.smp-grain');await card.waitFor();
 assert.equal(await p.locator('section.smp-pitch').count(),0,'Pitch makes way for the Grain card');
 await inside(p.getByRole('radio',{name:'Grain',exact:true}).last(),'Grain tab');
 const pos=p.getByRole('button',{name:/^Position \d/});await inside(pos,'Position tag');
 for(const name of ['Soft','Tri','Round','Hit','Flat'])await inside(card.getByRole('radio',{name,exact:true}),'shape '+name);
 for(const name of ['All','Maj','Min','Pent','Oct','5th'])await inside(card.getByRole('radio',{name,exact:true}),'scale '+name);
 const knobs=await card.locator('.knob-target').all();assert.equal(knobs.length,10,'ten grain knobs');
 for(const [i,k] of knobs.entries())await inside(k,'grain knob '+(i+1));
 await p.screenshot({path:path.join(OUT,'grain-card-'+H+'.png')});

 // A held key sounds grains, and they show on the waveform.
 await card.getByRole('radio',{name:'Hit',exact:true}).click();
 await card.getByRole('radio',{name:'Min',exact:true}).click();
 const id=(await latest()).state.tracks[0].sampler.id;
 await send('sampler_edit',[0,id,'patch',{g_spread:7,g_spray:.25,g_density:30,g_scan:.3}]);
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.g_spread===7);
 const root=p.locator('.smp-white.root');const rb=await root.boundingBox();
 await p.mouse.move(rb.x+rb.width/2,rb.y+rb.height-14);await p.mouse.down();
 await p.waitForFunction(()=>(window.__smp?.[0]?.grains?.length??0)>0,null,{timeout:8000});
 await p.waitForTimeout(400);
 assert.ok(await p.locator('.smp-wave .smp-grain-tick').count()>0,'grains are drawn');
 await p.screenshot({path:path.join(OUT,'grain-playing-'+H+'.png')});
 await p.mouse.up();
 await p.waitForFunction(()=>(window.__smp?.[0]?.voices??1)===0,null,{timeout:8000});

 // Dragging Position moves it, as one edit.
 const before=(await latest()).state.tracks[0].sampler.g_pos;const pb=await pos.boundingBox();
 const wave=await p.locator('.smp-wave-shell').boundingBox();
 await p.mouse.move(pb.x+pb.width/2,pb.y+20);await p.mouse.down();
 await p.mouse.move(wave.x+wave.width*.7,pb.y+20,{steps:8});await p.mouse.up();
 await p.waitForFunction(b=>Math.abs(window.__latest.state.tracks[0].sampler.g_pos-b)>.1,before);
 const after=(await latest()).state.tracks[0].sampler.g_pos;assert.ok(after>.55&&after<.85,'Position follows the drag: '+after);

 // Leaving Grain brings Pitch and Filter back; old modes still work.
 await p.getByRole('radio',{name:'Hold',exact:true}).click();
 await p.locator('section.smp-pitch').waitFor();assert.equal(await card.count(),0,'the Grain card goes with Grain mode');
 assert.equal(await p.getByRole('radio',{name:'Grain',exact:true}).count(),1,'only the play mode is left');
 assert.deepEqual(errors,[],'no page errors');
 console.log('grain mode acceptance OK at '+H);
 await app.close();fs.rmSync(DATA,{recursive:true,force:true});
})().catch(async e=>{console.error(e);try{await page?.screenshot({path:path.join(OUT,'grain-failure-'+H+'.png')});}catch{}try{await app?.close();}catch{}process.exit(1);});
