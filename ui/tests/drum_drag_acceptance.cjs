// Round 2 (Sir's pictures, 16 Nov): Kits under the pads; the big Pad Sound panel shows Trim, Envelope or Tone
// with points to drag (one undo step per drag); the compressor has a live meter with a threshold line.
'use strict';
require('./deck_guard.cjs');
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.OUT?path.resolve(ROOT,process.env.OUT):path.resolve(ROOT,'../artifacts/sampler-editing/r2');const H=Number(process.env.HEIGHT||718);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-drum-drag-'));
const wav=path.join(tmp,'drag-kick.wav');
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 execFileSync('python3',['-c',`import wave,struct,math,sys
with wave.open(sys.argv[1],'wb') as f:
 f.setparams((1,2,48000,0,'NONE','not compressed'))
 f.writeframes(b''.join(struct.pack('<h',int(30000*math.sin(i*2*math.pi*70/48000)*math.exp(-i/16000))) for i in range(48000)))`,wav]);
 const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 try{
  const p=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,h);},H);
  await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
  await p.evaluate(()=>{window.deckApi.onMessage(m=>{if(m.state)window.__drumLatest=m;});});
  await p.waitForFunction(()=>!!window.__drumLatest);
  await p.getByRole('tab',{name:/^Sound$/i}).click();
  await p.getByRole('radiogroup',{name:'Track instrument'}).getByRole('radio',{name:'Drum Rack',exact:true}).click();
  await p.locator('.drum-rack').waitFor();
  await p.locator('.drum-pad').first().click();
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},wav);
  await p.getByRole('button',{name:/^Import (replacement )?WAV file$/}).click();
  await p.waitForFunction(()=>window.__drumLatest.drum_racks?.[0]?.pads?.[0]?.status==='READY');
  const shape=()=>p.evaluate(()=>window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape??{});
  const undo=()=>p.evaluate(()=>window.__drumLatest.history?.undo??window.__drumLatest.undo_depth??null);

  // Kits: a wide button under the pads (Sir's green box), not in the pads header.
  const kits=p.getByRole('button',{name:'Browse drum kits'});
  assert.equal(await kits.count(),1,'one Kits button');
  const kb=await kits.boundingBox(),grid=await p.locator('.drum-pads').boundingBox();
  assert.ok(kb.y>=grid.y+grid.height,'Kits sits below the pads');
  assert.ok(kb.height>=44,'44 px');
  assert.match(await kits.innerText(),/Kits/i);

  // The small graph boxes are gone.
  for(const id of ['drum-graph-eq','drum-graph-comp','drum-envelope-graph'])assert.equal(await p.locator(`[data-testid=${id}]`).count(),0,id+' removed');
  const rail=p.getByRole('radiogroup',{name:'Waveform view'});
  for(const n of ['Trim','Envelope','Tone']){const r=await rail.getByRole('radio',{name:n}).boundingBox();assert.ok(r.height>=44,n+' tab is 44 px');}

  // Envelope: with Decay off, Hold starts at the end of the sound (plays to the end); drag it left: one committed edit, heard live while dragging.
  await rail.getByRole('radio',{name:'Envelope'}).click();
  const env=p.getByRole('group',{name:/^Envelope: drag/});
  await env.waitFor();
  const before=await shape();
  const hold=env.locator('[data-handle=hold]'),hb=await hold.boundingBox(),eb=await env.boundingBox();
  await p.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2);await p.mouse.down();
  assert.ok(hb.x+hb.width/2>eb.x+eb.width*.6,'Hold sits at the end while the pad plays to the end');
  for(let i=1;i<=6;i++)await p.mouse.move(hb.x+hb.width/2-i*eb.width*.04,hb.y+hb.height/2);
  assert.equal(JSON.stringify(await shape()),JSON.stringify(before),'nothing saved while dragging');
  await p.mouse.up();
  await p.waitForFunction(()=>(window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape?.hold??0)>.05);
  const held=(await shape()).hold;
  // Decay point: drag right sets a decay.
  const dec=env.locator('[data-handle=decay]'),db=await dec.boundingBox();
  await p.mouse.move(db.x+db.width/2,db.y+db.height/2);await p.mouse.down();
  for(let i=1;i<=5;i++)await p.mouse.move(db.x+db.width/2+i*eb.width*.03,db.y+db.height/2);
  await p.mouse.up();
  await p.waitForFunction(()=>(window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape?.decay??0)>.02);
  assert.equal((await shape()).hold,held,'decay drag leaves hold');
  await p.screenshot({path:path.join(OUT,`drum-envelope-${H}.png`)});
  // Double-click resets one point.
  await env.locator('[data-handle=decay]').dblclick();
  await p.waitForFunction(()=>(window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape?.decay??1)===0);

  // Tone: drag the Mid point up and right.
  await rail.getByRole('radio',{name:'Tone'}).click();
  const tone=p.getByRole('group',{name:/^Tone: drag/});
  const mid=tone.locator('[data-handle=mid]'),mb=await mid.boundingBox(),tb=await tone.boundingBox();
  await p.mouse.move(mb.x+mb.width/2,mb.y+mb.height/2);await p.mouse.down();
  for(let i=1;i<=5;i++)await p.mouse.move(mb.x+mb.width/2+i*tb.width*.02,mb.y+mb.height/2-i*tb.height*.04);
  await p.mouse.up();
  await p.waitForFunction(()=>{const s=window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape;return s&&s.eq_mid>2&&s.eq_freq>1000;});
  const lc=tone.locator('[data-handle=low_cut]'),lb=await lc.boundingBox();
  await p.mouse.move(lb.x+lb.width/2,lb.y+lb.height/2);await p.mouse.down();
  for(let i=1;i<=4;i++)await p.mouse.move(lb.x+lb.width/2+i*tb.width*.05,lb.y+lb.height/2);
  await p.mouse.up();
  await p.waitForFunction(()=>(window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape?.low_cut??20)>40);
  await p.screenshot({path:path.join(OUT,`drum-tone-${H}.png`)});

  // Compressor: a threshold line to drag in the meter; the meter moves while the pad plays.
  const comp=p.locator('[data-testid=drum-shape]').getByRole('region',{name:'Compressor',exact:true});
  await comp.getByRole('slider',{name:'Ratio',exact:true}).focus();for(let i=0;i<5;i++)await p.keyboard.press('Shift+ArrowUp');
  await p.waitForFunction(()=>(window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape?.comp_ratio??1)>1);
  const meter=comp.getByRole('group',{name:'Compressor level and threshold'});
  const mbox=await meter.boundingBox();assert.ok(mbox.height>=120,'meter is tall: '+mbox.height);
  const thr=meter.locator('[data-handle=thr]'),tbx=await thr.boundingBox();
  await p.mouse.move(tbx.x+tbx.width/2,tbx.y+tbx.height/2);await p.mouse.down();
  for(let i=1;i<=4;i++)await p.mouse.move(tbx.x+tbx.width/2,tbx.y+tbx.height/2+i*mbox.height*.05);
  await p.mouse.up();
  await p.waitForFunction(()=>(window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape?.comp_threshold??-18)<-22);
  const levels=[];
  await p.locator('.drum-pad').first().dispatchEvent('pointerdown',{button:0,pointerType:'mouse'});
  for(let i=0;i<12;i++){const l=await p.evaluate(()=>window.__drumLatest.drum_racks?.[0]?.pads?.[0]?.lvl);if(l)levels.push(l);await p.waitForTimeout(40);}
  assert.ok(levels.length>0,'pad reports its level while playing');
  assert.ok(levels.some(([a])=>a>-20),'input level is loud: '+JSON.stringify(levels.slice(0,3)));
  assert.ok(levels.some(([a,b])=>b<a-1),'compressor turns it down: '+JSON.stringify(levels.slice(0,3)));
  await p.screenshot({path:path.join(OUT,`drum-comp-${H}.png`)});
  assert.deepEqual(errors,[]);
  console.log(`PASS: drum drag graphs at 1280×${H}: Kits under the pads, envelope and tone points, compressor meter with threshold line`);
 }finally{await app.close();fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
