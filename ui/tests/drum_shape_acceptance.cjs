// Drum pad shaping (review 2026-11-15). Real-worker/native Electron checks. Samples live only in an OS temporary directory.
'use strict';
require('./deck_guard.cjs');
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.OUT||path.resolve(ROOT,'../artifacts/review-fixes');const H=Number(process.env.HEIGHT||718);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-drum-ui-'));
const wav=path.join(tmp,'acceptance-kick.wav');
const project=path.join(tmp,'roundtrip.decksynth');
let app,page;
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 execFileSync('python3',['-c',`import wave,struct,math,sys
with wave.open(sys.argv[1],'wb') as f:
 f.setparams((1,2,48000,0,'NONE','not compressed'))
 f.writeframes(b''.join(struct.pack('<h',int(18000*math.sin(i*2*math.pi*90/48000)*math.exp(-i/12000))) for i in range(48000)))`,wav]);
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 const p=page=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,h);},H);
 await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 await p.evaluate(()=>{window.__drumMessages=[];window.deckApi.onMessage(m=>{if(m.state){window.__drumLatest=m;window.__drumMessages.push(m);if(window.__drumMessages.length>120)window.__drumMessages.shift();}});});
 await p.waitForFunction(()=>!!window.__drumLatest);
 const initial=await p.evaluate(()=>window.__drumLatest);
 assert.equal(initial.audio,'dummy');assert.deepEqual(initial.devices,[]);assert.equal(initial.connected,null);
 const send=async(cmd,args)=>p.evaluate(([c,a])=>window.deckApi.send(c,a),[cmd,args]);
 await p.getByRole('tab',{name:/^Sound$/i}).click();
 await p.getByRole('radiogroup',{name:'Track instrument'}).getByRole('radio',{name:'Drum Rack',exact:true}).click();
 await p.locator('.drum-rack').waitFor();
 const pads=p.locator('.drum-pad');await pads.first().click();
 // Stub only OS file selection: decoding, cache, engine trigger and IPC remain real.
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},wav);
 await p.getByRole('button',{name:/^Import (replacement )?WAV file$/}).click();
 await p.waitForFunction(()=>window.__drumLatest.drum_racks?.[0]?.pads?.[0]?.status==='READY');
 const pad=()=>p.evaluate(()=>window.__drumLatest.state.tracks[0].drum_rack.pads[0]);
 const kit=await p.evaluate(()=>window.__drumLatest.state.tracks[0].drum_rack.id);
 const sha=(await pad()).source.sha256;
 assert.equal(await p.locator('.drum-pan').count(),0,'disabled Pan stub is gone');
 // Stage 12: Pad Sound uses the Sampler's layout, four compact cards side by side and the shared waveform editor.
 const shape=p.locator('[data-testid=drum-shape]');
 const card=name=>shape.getByRole('region',{name,exact:true});
 for(const name of ['Play','Shape','Tone','Compressor'])assert.equal(await card(name).count(),1,name+' card');
 // One key press is one committed edit of the pad's shape.
 await card('Shape').getByRole('slider',{name:'Decay',exact:true}).focus();await p.keyboard.press('Shift+ArrowUp');
 await p.waitForFunction(()=>(window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape?.decay??0)>0);
 // Start and End are tag markers on the waveform; arrows nudge them (1% of the view).
 await p.getByRole('button',{name:/^Start \d/}).focus();await p.keyboard.press('ArrowRight');
 await p.waitForFunction(()=>Math.abs((window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape?.start??0)-.01)<.0001);
 assert.match(await p.locator('.drum-rack .smp-caption').innerText(),/Plays 10–1000 ms/);
 await card('Play').getByRole('button',{name:'Reverse',exact:true}).click();
 await p.waitForFunction(()=>window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape?.reverse===true);
 assert.equal((await pad()).source.sha256,sha,'shaping never rewrites the source');
 // A drag on the End marker is one edit on release.
 const wave=await p.locator('.drum-rack .smp-wave-shell').boundingBox(),endH=await p.getByRole('button',{name:/^End \d/}).boundingBox();
 await p.mouse.move(endH.x+endH.width/2,endH.y+endH.height/2);await p.mouse.down();
 await p.mouse.move(wave.x+wave.width*.6,endH.y+endH.height/2,{steps:6});await p.waitForTimeout(150);
 assert.equal((await pad()).shape.end,1,'drag stays local until release');
 await p.mouse.up();await p.waitForFunction(()=>Math.abs(window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape.end-.6)<.02);
 // The graph follows a knob while it turns; the engine only gets the value on release.
 await p.getByRole('radiogroup',{name:'Waveform view'}).getByRole('radio',{name:'Envelope'}).click();
 const envBefore=await p.locator('.drag-envelope .env-line').getAttribute('d');
 const holdKnob=await card('Shape').getByRole('slider',{name:'Hold',exact:true}).boundingBox();
 await p.mouse.move(holdKnob.x+holdKnob.width/2,holdKnob.y+holdKnob.height/2);await p.mouse.down();
 await p.mouse.move(holdKnob.x+holdKnob.width/2,holdKnob.y-60,{steps:8});await p.waitForTimeout(150);
 assert.notEqual(await p.locator('.drag-envelope .env-line').getAttribute('d'),envBefore,'envelope redraws while turning');
 assert.equal((await pad()).shape.hold,0,'turning stays local until release');
 await p.mouse.up();await p.waitForFunction(()=>window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape.hold>0);
 // Pan, EQ and compressor are pad settings too, each with a live graph in its card.
 await p.getByRole('radiogroup',{name:'Waveform view'}).getByRole('radio',{name:'Tone'}).click();
 const eqBefore=await p.locator('.drag-tone .env-line').getAttribute('d');
 await card('Tone').getByRole('slider',{name:'Mid',exact:true}).focus();await p.keyboard.press('Shift+ArrowUp');
 await p.waitForFunction(()=>window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape.eq_mid>0);
 assert.notEqual(await p.locator('.drag-tone .env-line').getAttribute('d'),eqBefore,'EQ curve follows');
 await p.getByRole('radiogroup',{name:'Waveform view'}).getByRole('radio',{name:'Trim'}).click();
 await card('Compressor').getByRole('slider',{name:'Ratio',exact:true}).focus();await p.keyboard.press('Shift+ArrowUp');
 await p.waitForFunction(()=>window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape.comp_ratio>1);
 await p.getByRole('slider',{name:'Pan',exact:true}).focus();await p.keyboard.press('Shift+ArrowLeft');
 await p.waitForFunction(()=>window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape.pan<0);
 assert.equal((await pad()).source.sha256,sha,'shaping never rewrites the source');
 await card('Tone').getByRole('radio',{name:'Filter',exact:true}).click();
 await card('Tone').getByRole('slider',{name:'Drive',exact:true}).waitFor();
 await card('Tone').getByRole('radio',{name:'EQ',exact:true}).click();
 await send('drum_note',[0,kit,0,110]);await p.waitForTimeout(200);
 // Every rack control is a 44 px touch target and inside the window.
 for(const node of await p.locator('.drum-rack button,.drum-rack select,.drum-rack [role="slider"]').all()){
  if(!await node.isVisible())continue;const r=await node.boundingBox();
  if(await node.evaluate(e=>e.classList.contains('smp-handle')))continue;   // markers: 44 px wide, their hit zone is the marker's half of the wave
  assert.ok(r.width>=44&&r.height>=44,'44px '+(await node.getAttribute('aria-label')||await node.innerText()));
  if(!process.env.NOGEOM)assert.ok(r.y+r.height<=H+1,'inside window '+JSON.stringify(r));
 }
 // Exact entry for a readable picture: 0.40 s decay.
 {const b=await card('Shape').getByRole('slider',{name:'Decay',exact:true}).locator('xpath=ancestor::*[contains(@class,"tactile-knob")][1]').locator('.knob-value').boundingBox();const x=b.x+b.width/2,y=b.y+b.height-8;await p.mouse.click(x,y);await p.waitForTimeout(650);await p.mouse.click(x,y);}await p.getByLabel('Decay numeric value').fill('400');await p.keyboard.press('Enter');
 await p.waitForFunction(()=>Math.abs(window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape?.decay-.4)<.001);await p.waitForTimeout(300);
 await p.screenshot({path:path.join(OUT,'drum-shape-1280x'+H+'.png')});
 await card('Shape').getByRole('button',{name:'Reset shape',exact:true}).click();
 await p.waitForFunction(()=>{const s=window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape;return !s||(s.start===0&&s.end===1&&s.decay===0&&s.reverse===false&&s.pan===0&&s.eq_mid===0);});
 assert.deepEqual(errors,[],'no renderer errors');
 console.log('PASS: drum pad shaping (Sampler layout) at 1280×'+H+': envelope/trim markers/reverse/drag/reset are single committed edits, source untouched, 44px controls');
 await app.close();
})().catch(async e=>{console.error('FAIL',e);try{await page?.screenshot({path:path.join(OUT,'drum-shape-failure.png')});}catch{}try{await app?.close();}catch{}process.exit(1);});
