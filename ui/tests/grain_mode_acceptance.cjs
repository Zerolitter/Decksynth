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
  args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:DATA,DECKSYNTH_TEST_INPUT:wav,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
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
 await inside(p.locator('.smp-tools').getByRole('radio',{name:'Grain',exact:true}),'Grain tab');
 for(const name of ['Grain','Roam','Motion'])await inside(card.getByRole('radiogroup',{name:'Grain page'}).getByRole('radio',{name,exact:true}),'card page '+name);
 const pos=p.getByRole('button',{name:/^Position \d/});await inside(pos,'Position tag');
 for(const name of ['Soft','Tri','Round','Hit','Flat'])await inside(card.getByRole('radio',{name,exact:true}),'shape '+name);
 for(const name of ['All','Maj','Min','Pent','Oct','5th'])await inside(card.getByRole('radio',{name,exact:true}),'scale '+name);
 const knobs=await card.locator('.knob-target').all();assert.equal(knobs.length,9,'nine grain knobs');
 for(const [i,k] of knobs.entries())await inside(k,'grain knob '+(i+1));
 await p.screenshot({path:path.join(OUT,'grain-card-'+H+'.png')});

 // A held key sounds grains, and they show on the waveform.
 await card.getByRole('radio',{name:'Hit',exact:true}).click();
 await card.getByRole('radio',{name:'Min',exact:true}).click();
 const id=(await latest()).state.tracks[0].sampler.id;
 await send('sampler_edit',[0,id,'patch',{g_spread:7,g_spray:.25,g_density:30}]);
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

 // Roam: direction and sync as buttons, the bracket and its end tag on the waveform, the read point travels while held.
 const pages=card.getByRole('radiogroup',{name:'Grain page'});
 await pages.getByRole('radio',{name:'Roam',exact:true}).click();
 for(const name of ['Off','Forward','Reverse','Bounce'])await inside(card.getByRole('radio',{name,exact:true}),'roam '+name);
 for(const name of ['Free','1/4 bars','1/2 bars','1 bar','2 bars','4 bars','8 bars','16 bars'])await inside(card.getByRole('radio',{name,exact:true}),'sync '+name);
 let rk=await card.locator('.knob-target').all();assert.equal(rk.length,4,'Range, Speed, Wander, Smooth');for(const [i,k] of rk.entries())await inside(k,'roam knob '+(i+1));
 assert.equal(await p.getByRole('button',{name:/^Roam end/}).count(),0,'no bracket while Roam is off');
 await card.getByRole('radio',{name:'Forward',exact:true}).click();
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.g_roam==='forward');
 const rend=p.getByRole('button',{name:/^Roam end/});await inside(rend,'Roam end tag');
 assert.ok(await p.locator('.smp-wave .smp-roam').count()>0,'the bracket is shaded');
 // drag Roam end closer to Position: Range shrinks, as one edit
 const g0=(await latest()).state.tracks[0].sampler;const reb=await rend.boundingBox();
 const target=wave.x+wave.width*(g0.g_pos+.15);
 await p.mouse.move(reb.x+reb.width/2,reb.y+reb.height-20);await p.mouse.down();
 await p.mouse.move(target,reb.y+reb.height-20,{steps:8});await p.mouse.up();
 await p.waitForFunction(r=>Math.abs(window.__latest.state.tracks[0].sampler.g_range-r)>.05,g0.g_range);
 const rg=(await latest()).state.tracks[0].sampler.g_range;assert.ok(rg>.08&&rg<.25,'Range follows the drag: '+rg);
 await card.getByRole('radio',{name:'1 bar',exact:true}).click();
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.g_sync==='1');
 rk=await card.locator('.knob-target').all();assert.equal(rk.length,3,'Speed goes while synced to bars');
 await card.getByRole('radio',{name:'Free',exact:true}).click();
 await send('sampler_edit',[0,id,'patch',{g_range:.5,g_speed:2,g_pos:.2}]);
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.g_speed===2);
 await p.mouse.move(rb.x+rb.width/2,rb.y+rb.height-14);await p.mouse.down();
 await p.waitForFunction(()=>(window.__smp?.[0]?.playing?.length??0)>0,null,{timeout:8000});
 const heads=new Set();for(let i=0;i<8;i++){await p.waitForTimeout(120);heads.add((await p.evaluate(()=>window.__smp?.[0]?.playing?.[0]))?.toFixed(3));}
 assert.ok(heads.size>=3,'the read point travels: '+[...heads]);
 await p.screenshot({path:path.join(OUT,'grain-roam-'+H+'.png')});
 await p.mouse.up();
 await p.waitForFunction(()=>(window.__smp?.[0]?.voices??1)===0,null,{timeout:8000});
 // Motion: five knobs.
 await pages.getByRole('radio',{name:'Motion',exact:true}).click();
 const mk=await card.locator('.knob-target').all();assert.equal(mk.length,5,'Jump, Hold, Rev, Chaos, Pulse');
 for(const [i,k] of mk.entries())await inside(k,'motion knob '+(i+1));
 await p.screenshot({path:path.join(OUT,'grain-motion-'+H+'.png')});

 // Rhythm: without slices the page offers Chop; with four slices it steps through them, and taps on the waveform turn slices off or reverse them.
 await send('sampler_edit',[0,id,'patch',{g_roam:'off',g_jump:0,g_wander:0}]);
 await pages.getByRole('radio',{name:'Rhythm',exact:true}).click();
 await inside(card.getByRole('button',{name:/Chop the sample/}),'Chop the sample (empty Rhythm)');
 await send('sampler_edit',[0,id,'patch',{slices:[[0,.25],[.25,.5],[.5,.75],[.75,1]],g_pos:.3,g_density:40,g_size:.06}]);
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.slices.length===4);
 for(const name of ['Off','Skip','Hold','Gate','Flow','Random step','Ping-pong'])await inside(card.getByRole('radio',{name,exact:true}),'rhythm '+name);
 for(const name of ['1/4','1/8','1/16','1/32','1/8t','1/16t','Pattern A','Pattern B','Pattern C','Pattern D','On/off','Reverse'])await inside(card.getByRole('radio',{name,exact:true}),'rhythm '+name);
 for(const name of ['even','sparse','dense','random','all','invert'])await inside(card.getByRole('button',{name:'Generate '+name,exact:true}),'generate '+name);
 const hk=await card.locator('.knob-target').all();assert.equal(hk.length,2,'Swing and Chance');for(const [i,k] of hk.entries())await inside(k,'rhythm knob '+(i+1));
 await card.getByRole('radio',{name:'Skip',exact:true}).click();
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.g_rhythm==='skip');
 assert.equal(await p.locator('.smp-wave .smp-step').count(),4,'the slices show on the waveform');
 assert.equal(await p.getByRole('button',{name:/^Position \d/}).count(),0,'Position is inside each slice now: no tag');
 const tapAt=async f=>{const w=await p.locator('.smp-wave-shell').boundingBox();await p.mouse.click(w.x+w.width*f,w.y+w.height*.6);};
 await tapAt(.37);await p.waitForFunction(()=>JSON.stringify(window.__latest.state.tracks[0].sampler.g_off)==='[[1],[],[],[]]');
 await card.getByRole('radio',{name:'Reverse',exact:true}).click();
 await tapAt(.62);await p.waitForFunction(()=>JSON.stringify(window.__latest.state.tracks[0].sampler.g_flip)==='[[2],[],[],[]]');
 await p.mouse.move(rb.x+rb.width/2,rb.y+rb.height-14);await p.mouse.down();
 const seen=new Set();let lit=0;for(let i=0;i<24&&!(seen.size>=3&&lit);i++){await p.waitForTimeout(110);for(const k of (await p.evaluate(()=>window.__smp?.[0]?.steps??[])))seen.add(k);lit+=await p.locator('.smp-wave .smp-step.now').count();}
 assert.ok(seen.has(0)&&seen.has(2)&&seen.has(3)&&!seen.has(1),'steps skip slice 2: '+[...seen]);
 assert.ok(lit>0,'the sounding slice lights up');
 await p.screenshot({path:path.join(OUT,'grain-rhythm-'+H+'.png')});
 await p.mouse.up();
 await p.waitForFunction(()=>(window.__smp?.[0]?.voices??1)===0,null,{timeout:8000});
 await card.getByRole('button',{name:'Generate all',exact:true}).click();
 await p.waitForFunction(()=>JSON.stringify(window.__latest.state.tracks[0].sampler.g_off)==='[[],[],[],[]]'&&JSON.stringify(window.__latest.state.tracks[0].sampler.g_flip)==='[[],[],[],[]]');

 // Harmony: what the sample holds; Spread then lands only on shifts that keep it in key, shown as text; the Grain page's scale gives way.
 await pages.getByRole('radio',{name:'Harmony',exact:true}).click();
 for(const name of ['Off','Root','Fifth','Triad','Scale','Own notes'])await inside(card.getByRole('radiogroup',{name:'The sample holds'}).getByRole('radio',{name,exact:true}),'harmony '+name);
 await card.getByRole('radio',{name:'Triad',exact:true}).click();
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.g_harm==='triad');
 const NN=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'],rootN=(await latest()).state.tracks[0].sampler.root,kn=k=>NN[(rootN+k)%12];
 for(const name of [kn(0)+' major',kn(0)+' minor'])await inside(card.getByRole('radio',{name,exact:true}),'key '+name);
 await p.getByText(/Spread lands on/).waitFor();
 assert.equal((await card.locator('.smp-harm-lands b').textContent()).replace(/\s+/g,' '),'-7 -5 0 +5 +7','a major chord sample: I, IV and V within ±7');
 await card.getByRole('radio',{name:'Own notes',exact:true}).click();
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.g_harm==='own');
 const noteRow=card.getByRole('group',{name:'Notes the sample holds'});await noteRow.waitFor();
 const notes=await noteRow.getByRole('button').all();assert.equal(notes.length,12,'twelve notes');
 for(const [i,b] of notes.entries())await inside(b,'note '+(i+1));
 await card.getByRole('button',{name:'Note '+kn(4),exact:true}).click();
 await p.waitForFunction(()=>JSON.stringify(window.__latest.state.tracks[0].sampler.g_notes)==='[0,7]');
 await p.screenshot({path:path.join(OUT,'grain-harmony-'+H+'.png')});
 await pages.getByRole('radio',{name:'Grain',exact:true}).click();
 assert.equal(await card.getByRole('radio',{name:'Maj',exact:true}).count(),0,'Harmony picks the steps, the scale buttons make way');
 await inside(card.getByRole('button',{name:'Steps: Harmony'}),'Steps: Harmony tag');
 await card.getByRole('button',{name:'Steps: Harmony'}).click();
 await card.getByRole('radio',{name:'Off',exact:true}).click();
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.g_harm==='off');

 // Presets: twenty, one tap sets the whole grain sound (one undo step) and keeps Position and the slices.
 await pages.getByRole('radio',{name:'Presets',exact:true}).click();
 const pr=await card.locator('.smp-preset').all();assert.equal(pr.length,20,'twenty presets');for(const [i,b] of pr.entries())await inside(b,'preset '+(i+1));
 await p.screenshot({path:path.join(OUT,'grain-presets-'+H+'.png')});
 const keep=(await latest()).state.tracks[0].sampler.g_pos;
 await card.getByRole('button',{name:'Tidal',exact:true}).click();
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.g_roam==='bounce'&&window.__latest.state.tracks[0].sampler.g_rhythm==='off');
 const tid=(await latest()).state.tracks[0].sampler;assert.equal(tid.g_pos,keep,'Position stays');assert.equal(tid.slices.length,4,'slices stay');assert.equal(tid.g_pulse,.8);

 // Live input: grains from the input as it comes in (the test input plays the chord in real time); Freeze keeps it.
 const play=p.locator('section.smp-play');const liveIn=play.getByRole('button',{name:/Live in/});await inside(liveIn,'Live in');
 await liveIn.click();await p.waitForFunction(()=>!!window.__smp?.[0]?.live,null,{timeout:8000});
 await p.waitForFunction(()=>(window.__smp?.[0]?.peaks??[]).some(([lo,hi])=>hi>.05),null,{timeout:8000});
 await p.mouse.move(rb.x+rb.width/2,rb.y+rb.height-14);await p.mouse.down();
 await p.waitForFunction(()=>(window.__smp?.[0]?.grains?.length??0)>0,null,{timeout:8000});await p.waitForTimeout(300);
 assert.match(await p.locator('.smp-caption').first().textContent(),/Live input/);
 await p.screenshot({path:path.join(OUT,'grain-live-'+H+'.png')});
 await p.mouse.up();
 const freeze=play.getByRole('button',{name:/Freeze/});await inside(freeze,'Freeze');await freeze.click();
 await p.waitForFunction(()=>window.__smp?.[0]?.live?.frozen===true);
 await liveIn.click();await p.waitForFunction(()=>!window.__smp?.[0]?.live);

 // Leaving Grain brings Pitch and Filter back; old modes still work.
 await p.locator('section.smp-play').getByRole('radio',{name:'Hold',exact:true}).click();
 await p.locator('section.smp-pitch').waitFor();assert.equal(await card.count(),0,'the Grain card goes with Grain mode');
 assert.equal(await p.getByRole('radio',{name:'Grain',exact:true}).count(),1,'only the play mode is left');
 assert.deepEqual(errors,[],'no page errors');
 console.log('grain mode acceptance OK at '+H);
 await app.close();fs.rmSync(DATA,{recursive:true,force:true});
})().catch(async e=>{console.error(e);try{console.error(JSON.stringify(await page.evaluate(()=>window.__msgs)))}catch{}try{await page?.screenshot({path:path.join(OUT,'grain-failure-'+H+'.png')});}catch{}try{await app?.close();}catch{}process.exit(1);});
