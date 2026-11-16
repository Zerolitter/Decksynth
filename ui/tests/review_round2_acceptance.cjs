// Review 2026-11-15 round 2. Real worker, dummy audio. Samples live only in an OS temporary directory.
// Drum Rack steps edit the SEQ pattern (same as Perform); Partials / Morph pad fold away and the sound cards wrap.
'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.OUT||path.resolve(ROOT,'../artifacts/review-fixes');const H=Number(process.env.HEIGHT||718);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-r2-'));
let app;
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const wavs=['kick','snare','hat'].map((name,k)=>{const f=path.join(tmp,name+'.wav');execFileSync('python3',['-c',`import wave,struct,math,random,sys
k=int(sys.argv[2]);random.seed(k)
with wave.open(sys.argv[1],'wb') as f:
 f.setparams((1,2,48000,0,'NONE','not compressed'))
 f.writeframes(b''.join(struct.pack('<h',int(16000*((math.sin(i*2*math.pi*(60+k*120)/48000) if k<2 else 0)+(random.uniform(-.6,.6) if k else 0))*math.exp(-i/(9000 if k<2 else 2500)))) for i in range(36000)))`,f,String(k)]);return f;});
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 const p=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,h);},H);
 await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 await p.evaluate(()=>{window.deckApi.onMessage(m=>{if(m.state)window.__latest=m;});});
 await p.waitForFunction(()=>!!window.__latest);
 const state=()=>p.evaluate(()=>window.__latest.state);
 await p.getByRole('tab',{name:/^Sound$/i}).click();
 await p.evaluate(()=>{try{localStorage.removeItem('decksynth.soundFolded');}catch{}});

 // --- Partials / Morph pad fold toggle (synth track) ---
 const fold=p.locator('.frame-window-fold');
 await fold.waitFor();
 const rackBefore=await p.locator('.frame-rack.sound-cards').boundingBox();
 await p.screenshot({path:path.join(OUT,'sound-open-'+H+'.png')});
 await fold.click();
 assert.equal(await p.locator('.frame-window[data-window=sound] .frame-window-body').count(),0,'folded: no partials body');
 const rackAfter=await p.locator('.frame-rack.sound-cards').boundingBox();
 assert.ok(rackAfter.height>rackBefore.height+100,'cards gain the room: '+rackBefore.height+' -> '+rackAfter.height);
 const cards=await p.locator('.frame-rack.sound-cards>.rack-card').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {top:Math.round(r.top),right:r.right};}));
 const wrapped=new Set(cards.map(c=>c.top)).size;
 const clientW=await p.locator('.frame-rack.sound-cards').evaluate(e=>[e.scrollWidth,e.clientWidth]);
 assert.ok(clientW[0]<=clientW[1]+1,'no sideways scrolling when folded '+clientW);
 await p.screenshot({path:path.join(OUT,'sound-folded-'+H+'.png')});
 assert.equal(await p.evaluate(()=>localStorage.getItem('decksynth.soundFolded')),'1','remembered');
 await fold.click();
 assert.equal(await p.locator('.frame-window[data-window=sound] .frame-window-body').count(),1,'shown again');

 // --- Drum Rack: compact pads, the step row edits the SEQ pattern ---
 await p.getByRole('radiogroup',{name:'Track instrument'}).getByRole('radio',{name:'Drum Rack',exact:true}).click();
 await p.locator('.drum-rack').waitFor();
 const pads=p.locator('.drum-pad');
 for(const [i,f] of [[0,wavs[0]],[2,wavs[1]],[6,wavs[2]]]){
  await pads.nth(i).click();
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},f);
  await p.getByRole('button',{name:/^Import (replacement )?WAV file$/}).click();
  await p.waitForFunction(i=>window.__latest.drum_racks?.[0]?.pads?.[i]?.status==='READY',i);
 }
 const padBox=await pads.first().boundingBox();
 assert.ok(padBox.height<=60&&padBox.width<=110,'pads are compact: '+JSON.stringify(padBox));
 const sound=await p.locator('.drum-pad-sound').boundingBox();
 assert.ok(sound.width>=780,'the pad sound editor gets the room: '+sound.width);
 await pads.nth(0).click();
 const seq0=(await state()).performance.seq;
 const ref=seq0.bank+':'+seq0.slot;
 for(const s of [1,5,9,13])await p.getByTestId('drum-step-'+s).click();
 await p.waitForFunction(ref=>(window.__latest.state.performance.patterns[ref]?.steps??[]).filter(s=>s.some(n=>n.note===36)).length===4,ref);
 await pads.nth(6).click();
 for(const s of [3,7,11,15])await p.getByTestId('drum-step-'+s).click();
 await p.waitForFunction(ref=>(window.__latest.state.performance.patterns[ref]?.steps??[]).filter(s=>s.some(n=>n.note===42)).length===4,ref);
 const song=JSON.stringify((await state()).tracks[0].notes);
 assert.equal(song,'[]','the Song clip is untouched: steps belong to the SEQ pattern');
 // SEQ power in the drum row is the same switch as in Perform.
 const power=p.locator('.drum-seq-power');
 const was=(await state()).performance.seq.enabled;
 await power.click();await p.waitForFunction(was=>window.__latest.state.performance.seq.enabled===!was,was);
 if(!was){/* leave it on for the picture */}else{await power.click();await p.waitForFunction(()=>window.__latest.state.performance.seq.enabled===true);}
 // Stage 12: EQ and the compressor are cards in Pad Sound, always in view.
 await p.getByRole('slider',{name:'Low',exact:true}).focus();for(let i=0;i<3;i++)await p.keyboard.press('Shift+ArrowUp');
 await p.waitForFunction(()=>window.__latest.state.tracks[0].drum_rack.pads[6].shape?.eq_low>0);
 await p.waitForTimeout(300);
 await p.screenshot({path:path.join(OUT,'drum-rack-eq-'+H+'.png')});
 for(const node of await p.locator('.drum-rack button,.drum-rack select,.drum-rack [role="slider"]').all()){
  if(!await node.isVisible())continue;const r=await node.boundingBox();
  if(await node.evaluate(e=>e.classList.contains('smp-handle')))continue;
  assert.ok(r.width>=44&&r.height>=44,'44px '+(await node.getAttribute('aria-label')||await node.innerText()));
  assert.ok(r.y+r.height<=H+1&&r.x+r.width<=1281,'inside window '+(await node.getAttribute('aria-label')||await node.innerText())+' '+JSON.stringify(r));
 }
 await p.getByRole('region',{name:'Compressor',exact:true}).getByRole('slider',{name:'Ratio',exact:true}).waitFor();
 await p.screenshot({path:path.join(OUT,'drum-rack-comp-'+H+'.png')});
 // Perform shows the same pattern.
 await p.getByRole('tab',{name:/^Perform$/i}).click();await p.waitForTimeout(400);
 await p.screenshot({path:path.join(OUT,'perform-after-drum-steps-'+H+'.png')});
 assert.deepEqual(errors,[],'no renderer errors');
 console.log('PASS round 2 at 1280×'+H+': fold toggle ('+wrapped+' card rows), compact pads, drum steps edit SEQ '+ref+', EQ/compressor cards, 44px controls');
 await app.close();
})().catch(async e=>{console.error('FAIL',e);try{await app?.close();}catch{}process.exit(1);});
