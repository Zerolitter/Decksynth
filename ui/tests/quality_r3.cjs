// Sir's quality round (16 Nov): even value boxes, Sampler envelope over the whole sound, Comp On/Off,
// the kit browser like the presets, the empty Sampler page and a compact Record sheet. Screenshots for review.
'use strict';
require('./deck_guard.cjs');
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.OUT?path.resolve(ROOT,process.env.OUT):path.resolve(ROOT,'../artifacts/sampler-editing/r3');const H=Number(process.env.HEIGHT||718);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-r3-'));
const data=path.join(tmp,'data'),library=path.join(tmp,'library');
const tone=(file,freq,secs,decay)=>execFileSync('python3',['-c',`import wave,struct,math,sys
f,s,d=float(sys.argv[2]),float(sys.argv[3]),float(sys.argv[4])
with wave.open(sys.argv[1],'wb') as w:
 w.setparams((1,2,48000,0,'NONE','not compressed'))
 w.writeframes(b''.join(struct.pack('<h',int(26000*math.sin(i*2*math.pi*f/48000)*math.exp(-i/(48000*d)))) for i in range(int(48000*s))))`,file,String(freq),String(secs),String(decay)]);
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(data,{recursive:true});
 for(const [kit,n] of [['Brush Light',16],['Chrome 909',17],['Carbon Room',12],['Darkroom Hybrid',16],['Hand Drum Bloom',9],['Tape Dust',16]]){
  const dir=path.join(library,'kits',kit);fs.mkdirSync(dir,{recursive:true});
  ['Kick','Snare','Clap','Closed Hat','Open Hat','Low Tom','Mid Tom','High Tom','Rim','Shaker','Cowbell','Ride','Crash','Perc','Tambourine','FX Riser','Kick 2'].slice(0,n)
   .forEach((name,i)=>tone(path.join(dir,String(i+1).padStart(2,'0')+' '+name+'.wav'),80+i*40,.25,.08));
 }
 const piano=path.join(tmp,'piano notes.wav');tone(piano,220,3,.9);
 const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:data,DECKSYNTH_TEST_INPUT:piano,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 try{
  const p=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,h);},H);
  await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
  await p.evaluate(()=>{window.deckApi.onMessage(m=>{if(m.state)window.__r3=m;});});
  await p.waitForFunction(()=>!!window.__r3);
  const small=async(scope)=>p.locator(scope+' button:visible').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return [e.getAttribute('aria-label')||e.textContent.trim(),Math.round(r.width),Math.round(r.height)];}).filter(([, w,h])=>w<44||h<44));
  const shot=name=>p.screenshot({path:path.join(OUT,name+'-'+H+'.png')});
  await p.getByRole('tab',{name:/^Sound$/i}).click();
  const instrument=name=>p.getByRole('radiogroup',{name:'Track instrument'}).getByRole('radio',{name,exact:true}).click();

  // --- Sampler: empty page, Record sheet ---
  await instrument('Sampler');
  await p.locator('.smp-empty-zone').waitFor();
  assert.equal(await p.locator('.smp-empty-card').count(),3,'three ways in');
  assert.deepEqual(await small('.smp-pick'),[],'44 px (empty Sampler)');
  await shot('sampler-empty');
  await p.locator('.smp-empty-card',{hasText:'Record'}).click();
  const sheet=p.getByRole('dialog',{name:'Record into the Sampler'});
  await sheet.waitFor();
  await sheet.getByRole('radiogroup',{name:'Input'}).getByRole('radio',{name:/Test input/}).click().catch(()=>{});
  await p.waitForTimeout(900);
  assert.equal(await sheet.locator('.rec-segs i').count(),30,'segment meter');
  assert.deepEqual(await small('.smp-record'),[],'44 px (Record)');
  await shot('record-sheet');
  await sheet.getByRole('button',{name:'Done'}).click();

  // --- Sampler with a sound: value boxes, arrows, envelope over the whole sound ---
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},piano);
  await p.locator('.smp-empty-card',{hasText:'Load a WAV'}).click();
  await p.waitForFunction(()=>window.__r3.samplers?.[0]?.status==='READY'||document.querySelector('.sampler-page .drum-status')?.textContent==='READY');
  const boxes=await p.locator('.sampler-page .smp-knobs.two .knob-value:visible').evaluateAll(els=>els.map(e=>Math.round(e.getBoundingClientRect().width)));
  assert.ok(boxes.length>=16&&new Set(boxes).size===1,'value boxes share one width: '+boxes);
  const heads=await p.locator('.sampler-page .smp-knobs.two .knob-heading:visible').evaluateAll(els=>els.filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent));
  assert.deepEqual(heads,[],'no cut-off names');
  assert.equal(await p.locator('.smp-env').count(),0,'no small Amp graph');
  await shot('sampler-trim');
  await p.getByRole('button',{name:'Edit the envelope on the waveform'}).click();
  await p.locator('.smp-scale-swap').waitFor();
  await p.keyboard.down('a');await p.waitForTimeout(300);
  await shot('sampler-envelope');
  await p.keyboard.up('a');
  await p.getByRole('button',{name:'Edit the filter on the waveform'}).click();
  await shot('sampler-filter');
  assert.deepEqual(await small('.sampler-page .smp-cards'),[],'44 px (Sampler cards)');

  // --- Drum Rack: Comp On/Off, kit browser ---
  await instrument('Drum Rack');
  await p.locator('.drum-rack .drum-pads').waitFor();
  const power=p.getByRole('switch',{name:'Compressor on'});
  assert.equal(await power.getAttribute('aria-checked'),'false','Comp starts off');
  await power.click();
  await p.waitForFunction(()=>(window.__r3.state.tracks[0].drum_rack.pads[0].shape?.comp_ratio??1)>1);
  assert.equal(await power.getAttribute('aria-checked'),'true');
  await shot('drum-comp-on');
  await power.click();
  await p.waitForFunction(()=>(window.__r3.state.tracks[0].drum_rack.pads[0].shape?.comp_ratio??1)<=1);
  await app.evaluate(({dialog},directory)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]});},library);
  await p.getByRole('button',{name:'Browse drum kits'}).click();
  await p.getByRole('button',{name:'Choose sample folder',exact:true}).click();
  await p.getByRole('button',{name:/kits\/Chrome 909.*17 WAV/i}).waitFor();
  const pad=await p.locator('.drum-pad-sound').boundingBox();
  assert.ok(pad.width>=800,'Pad Sound keeps its width while browsing: '+pad.width);
  assert.deepEqual(await small('.kit-browser'),[],'44 px (kits)');
  await shot('kits-grid');
  await p.getByRole('button',{name:/kits\/Brush Light.*16 WAV/i}).click();
  await p.getByRole('button',{name:'Listen to 01 Kick'}).waitFor();
  await shot('kits-sounds');
  assert.deepEqual(errors,[]);
  console.log('PASS quality r3 at 1280×'+H);
 }catch(e){console.error('FAIL',e);process.exitCode=1;}finally{await app.close();}
})();
