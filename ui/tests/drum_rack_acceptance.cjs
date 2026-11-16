// Real-worker/native Electron checks. Samples live only in an OS temporary directory.
'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const OUT=path.resolve(ROOT,'../artifacts/recovery/drum-rack-m1');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-drum-ui-'));
const wav=path.join(tmp,'acceptance-kick.wav');
const project=path.join(tmp,'roundtrip.decksynth');
let app;
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 execFileSync('python3',['-c',`import wave,struct,math,sys
with wave.open(sys.argv[1],'wb') as f:
 f.setparams((1,2,48000,0,'NONE','not compressed'))
 f.writeframes(b''.join(struct.pack('<h',int(18000*math.sin(i*2*math.pi*90/48000)*math.exp(-i/12000))) for i in range(48000)))`,wav]);
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 const p=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,718);});
 await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 await p.evaluate(()=>{window.__drumMessages=[];window.deckApi.onMessage(m=>{if(m.state){window.__drumLatest=m;window.__drumMessages.push(m);if(window.__drumMessages.length>120)window.__drumMessages.shift();}});});
 await p.waitForFunction(()=>!!window.__drumLatest);
 const initial=await p.evaluate(()=>window.__drumLatest);
 assert.equal(initial.audio,'dummy');assert.deepEqual(initial.devices,[]);assert.equal(initial.connected,null);
 const send=async(cmd,args)=>p.evaluate(([c,a])=>window.deckApi.send(c,a),[cmd,args]);
 // Preserve a real recorded synth note through device changes and relink.
 await send('record');await p.waitForFunction(()=>window.__drumLatest.recording);
 await send('midi',[0x90,60,100]);await p.waitForTimeout(180);await send('midi',[0x80,60,0]);
 await p.waitForFunction(()=>window.__drumLatest.state.tracks[0].notes.length>0);
 await send('record');await send('stop');
 const notes=await p.evaluate(()=>window.__drumLatest.state.tracks[0].notes);
 await p.getByRole('tab',{name:/^Sound$/i}).click();
 const device=p.getByLabel('Track device');
 assert.equal(await device.count(),1,'Sound must expose a reversible Track device selector');
 await device.selectOption('drum_rack');
 await p.locator('.drum-rack').waitFor();
 assert.equal(await p.locator('.drum-output').count(),1,'native output footer is available');
 await p.waitForFunction(()=>document.querySelector('.drum-output [data-output=driver]')?.textContent==='dummy');
 assert.equal(await p.locator('.drum-output meter').getAttribute('aria-label'),'Native output peak');
 await p.waitForFunction(()=>Number(document.querySelector('.drum-output [data-output=voices]')?.dataset.value)===window.__drumLatest.voices);
 const pads=p.locator('.drum-pad');assert.equal(await pads.count(),16,'sixteen playable pads');
 const geometry=await pads.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,note:Number(n.dataset.note)};}));
 assert.deepEqual(geometry.map(g=>g.note),[36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51]);
 assert.equal(new Set(geometry.map(g=>Math.round(g.y))).size,2,'8×2 pad bank');
 assert.equal(geometry.filter(g=>Math.abs(g.y-geometry[0].y)<1).length,8);
 assert.ok(geometry.every(g=>g.w>=56&&g.h>=56),'touch-sized pads');
 console.log('PASS: 8×2 geometry; smallest pad',Math.min(...geometry.map(g=>g.w)).toFixed(1),'×',Math.min(...geometry.map(g=>g.h)).toFixed(1));
 assert.equal(await p.locator('.drum-pad.is-triggered').count(),0,'initial state never flashes');
 for(const label of ['SEQ','MIX','FX'])assert.equal(await p.locator('.drum-rack').getByRole('button',{name:label,exact:true}).isDisabled(),true,label+' unavailable');
 assert.equal(await p.getByRole('button',{name:'Pan',exact:true}).isDisabled(),true);
 assert.match(await p.locator('.drum-pan').innerText(),/mono/i);
 assert.match(await p.locator('.drum-unavailable').innerText(),/not available|unavailable/i);
 await pads.nth(1).click();assert.equal(await pads.nth(1).getAttribute('aria-pressed'),'true');
 assert.equal(await p.locator('.drum-pad.is-triggered').count(),0,'selecting an empty pad never flashes');
 await pads.first().click();
 // Stub only OS file selection: decoding, cache, engine trigger and IPC remain real.
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},wav);
 await p.getByRole('button',{name:/^Import WAV$/}).click();
 await p.waitForFunction(()=>window.__drumLatest.drum_racks?.[0]?.pads?.[0]?.status==='READY');
 assert.ok(await p.locator('[data-testid="drum-waveform"] line').count()>0,'waveform contains engine min/max peaks');
 const kit=await p.evaluate(()=>window.__drumLatest.state.tracks[0].drum_rack.id);
 // Observe flashes from engine events, including nonselected pads; no renderer synthesis.
 await p.evaluate(()=>{window.__drumFlashed=false;new MutationObserver(()=>{if(document.querySelector('.drum-pad[data-pad="0"].is-triggered'))window.__drumFlashed=true;}).observe(document.querySelector('.drum-pads'),{subtree:true,attributes:true,attributeFilter:['class']});});
 await pads.nth(1).click();await send('drum_note',[0,kit,0,110]);
 await p.waitForFunction(()=>window.__drumFlashed);
 await p.waitForFunction(()=>Number(document.querySelector('.drum-output meter')?.value)>0&&Number(document.querySelector('.drum-output [data-output=voices]')?.dataset.value)>0);
 await p.waitForFunction(()=>Number(document.querySelector('.drum-output [data-output=rms]')?.dataset.value)>0);
 await p.waitForFunction(()=>Number(document.querySelector('.drum-output [data-output=underruns]')?.dataset.value)===window.__drumLatest.underruns);
 await p.waitForTimeout(220);assert.equal(await pads.first().getAttribute('data-triggered'),'false','flash clears near 120ms');
 assert.equal(await pads.nth(1).getAttribute('aria-pressed'),'true','engine event does not change selection');
 await pads.first().click();
 for(const label of ['Mute','Solo']){
  const b=p.locator('.drum-pad-sound').getByRole('button',{name:label,exact:true});await b.click();await p.waitForFunction(label=>window.__drumLatest.state.tracks[0].drum_rack.pads[0][label.toLowerCase()]===true,label);assert.equal(await b.getAttribute('aria-pressed'),'true');await b.click();await p.waitForFunction(label=>window.__drumLatest.state.tracks[0].drum_rack.pads[0][label.toLowerCase()]===false,label);
 }
 // One keyboard gesture yields one committed edit, verified by persisted engine value.
 for(const [label,key,want] of [['Gain','gain',1.01],['Velocity','velocity',.99],['Tune','tune',1]]){
  const k=p.locator('.drum-pad-sound').getByRole('slider',{name:label,exact:true});await k.focus();await p.keyboard.press(label==='Tune'?'ArrowUp':label==='Velocity'?'Shift+ArrowDown':'Shift+ArrowUp');
  await p.waitForFunction(([k,v])=>Math.abs(window.__drumLatest.state.tracks[0].drum_rack.pads[0][k]-v)<.0001,[key,want]);
 }
 await p.getByLabel('Choke group').selectOption('1');
 await p.waitForFunction(()=>window.__drumLatest.state.tracks[0].drum_rack.pads[0].choke===1);
 // A drag updates its local readout but must not write per-frame to the worker.
 const gain=p.getByRole('slider',{name:'Gain',exact:true});const box=await gain.boundingBox();
 const before=await p.evaluate(()=>window.__drumLatest.state.tracks[0].drum_rack.pads[0].gain);
 await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();
 await p.mouse.move(box.x+box.width/2,box.y-25,{steps:8});await p.waitForTimeout(120);
 assert.equal(await p.evaluate(()=>window.__drumLatest.state.tracks[0].drum_rack.pads[0].gain),before,'drag remains local until release');
 await p.mouse.up();await p.waitForFunction(v=>window.__drumLatest.state.tracks[0].drum_rack.pads[0].gain!==v,before);
 const controlGeometry=[];
 for(const node of await p.locator('.drum-rack button,.drum-rack select,.drum-rack [role="slider"]').all()){
  const r=await node.boundingBox();controlGeometry.push({label:await node.getAttribute('aria-label')||await node.innerText(),...r});assert.ok(r&&r.width>=44&&r.height>=44,'all rack controls at least 44px '+await node.innerText());
  assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=1281&&r.y+r.height<=719,'control inside 1280×718 '+JSON.stringify(r));
 }
 // End numeric input on pad change must not apply a stale edit to either pad.
 const committedGain=await p.evaluate(()=>window.__drumLatest.state.tracks[0].drum_rack.pads[0].gain);
 await p.locator('[data-param="drum-0-0-gain"] .knob-value').click();
 await p.getByLabel('Gain numeric value').fill('1.37');
 await pads.nth(1).click();await p.waitForTimeout(180);
 assert.equal(await p.evaluate(()=>window.__drumLatest.state.tracks[0].drum_rack.pads[0].gain),committedGain,'changing pad discards the pending numeric edit');
 assert.equal(await p.evaluate(()=>window.__drumLatest.state.tracks[0].drum_rack.pads[1].gain),1,'pending edit never reaches the next pad');
 await pads.first().click();await p.waitForTimeout(1400);
 fs.writeFileSync(path.join(OUT,'drum-rack-native-geometry.json'),JSON.stringify({viewport:{width:1280,height:718},pads:geometry,controls:controlGeometry},null,2));
 await p.screenshot({path:path.join(OUT,'drum-rack-native-1280x718.png')});
 await send('save',project);await p.waitForTimeout(300);
 const saved=JSON.parse(fs.readFileSync(project,'utf8'));
 assert.deepEqual(saved.tracks[0].notes,notes,'device selection preserves notes');
 const source=saved.tracks[0].drum_rack.pads[0].source;
 saved.tracks[0].drum_rack.pads[0].source.path=path.join(tmp,'missing.wav');fs.writeFileSync(project,JSON.stringify(saved));
 await send('load',project);await p.waitForFunction(()=>window.__drumLatest.drum_racks?.[0]?.pads?.[0]?.status==='MISSING');
 assert.match(await p.locator('.drum-pad-sound').innerText(),/missing/i);
 assert.equal(await p.locator('[data-testid="drum-waveform"]').count(),0,'missing source never shows stale/fake peaks');
 await p.getByRole('button',{name:/^Relink WAV$/}).click();
 await p.waitForFunction(()=>window.__drumLatest.drum_racks?.[0]?.pads?.[0]?.status==='READY');
 assert.equal(await p.evaluate(()=>window.__drumLatest.state.tracks[0].drum_rack.pads[0].source.sha256),source.sha256);
 assert.deepEqual(await p.evaluate(()=>window.__drumLatest.state.tracks[0].notes),notes,'relink preserves recorded notes');
 await device.selectOption('synth');await p.locator('.drum-rack').waitFor({state:'detached'});await device.selectOption('drum_rack');await p.locator('.drum-rack').waitFor();
 assert.equal(await p.locator('.drum-pad.is-triggered').count(),0,'reentering does not flash historical events');
 assert.deepEqual(errors,[],'no renderer errors');
 console.log('PASS: native 1280×718 Drum Rack; real import/trigger/edit/missing/relink, notes preserved, no renderer errors');
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;}).finally(async()=>{if(app)await app.close();fs.rmSync(tmp,{recursive:true,force:true});});
