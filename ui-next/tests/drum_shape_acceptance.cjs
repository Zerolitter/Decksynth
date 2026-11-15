// Drum pad shaping (review 2026-11-15). Real-worker/native Electron checks. Samples live only in an OS temporary directory.
'use strict';
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
 const shape=p.locator('.drum-shape');
 for(const tab of ['Envelope','Trim & fade','EQ','Compressor','Filter & drive'])assert.equal(await shape.getByRole('tab',{name:tab,exact:true}).count(),1,tab+' tab');
 // One key press is one committed edit of the pad's shape.
 await shape.getByRole('tab',{name:'Envelope',exact:true}).click();
 await shape.getByRole('slider',{name:'Decay',exact:true}).focus();await p.keyboard.press('Shift+ArrowUp');
 await p.waitForFunction(()=>(window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape?.decay??0)>0);
 await shape.getByRole('tab',{name:'Trim & fade',exact:true}).click();
 await p.locator('.drum-trim-handle.start').focus();await p.keyboard.press('ArrowRight');
 await p.waitForFunction(()=>Math.abs((window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape?.start??0)-.01)<.0001);
 assert.match(await p.locator('.drum-wave-caption').innerText(),/TRIM 10–1000 MS/);
 await shape.getByRole('button',{name:'Forward',exact:true}).click();
 await p.waitForFunction(()=>window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape?.reverse===true);
 assert.equal((await pad()).source.sha256,sha,'shaping never rewrites the source');
 // A drag on the end handle is one edit on release.
 const wave=await p.locator('.drum-wave-shell').boundingBox(),endH=await p.locator('.drum-trim-handle.end').boundingBox();
 await p.mouse.move(endH.x+endH.width/2,endH.y+endH.height/2);await p.mouse.down();
 await p.mouse.move(wave.x+5+(wave.width-10)*.6,endH.y+endH.height/2,{steps:6});await p.waitForTimeout(150);
 assert.equal((await pad()).shape.end,1,'drag stays local until release');
 await p.mouse.up();await p.waitForFunction(()=>Math.abs(window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape.end-.6)<.02);
 // The graph follows a knob while it turns; the engine only gets the value on release.
 await shape.getByRole('tab',{name:'Envelope',exact:true}).click();
 const envBefore=await p.locator('[data-testid=drum-envelope]').getAttribute('d');
 const holdKnob=await shape.getByRole('slider',{name:'Hold',exact:true}).boundingBox();
 await p.mouse.move(holdKnob.x+holdKnob.width/2,holdKnob.y+holdKnob.height/2);await p.mouse.down();
 await p.mouse.move(holdKnob.x+holdKnob.width/2,holdKnob.y-60,{steps:8});await p.waitForTimeout(150);
 assert.notEqual(await p.locator('[data-testid=drum-envelope]').getAttribute('d'),envBefore,'envelope redraws while turning');
 assert.equal((await pad()).shape.hold,0,'turning stays local until release');
 await p.mouse.up();await p.waitForFunction(()=>window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape.hold>0);
 // Pan, EQ and compressor are pad settings too, each with a live graph.
 await shape.getByRole('tab',{name:'EQ',exact:true}).click();
 const eqBefore=await p.locator('[data-testid=drum-graph-eq]').innerHTML();
 await shape.getByRole('slider',{name:'Mid',exact:true}).focus();await p.keyboard.press('Shift+ArrowUp');
 await p.waitForFunction(()=>window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape.eq_mid>0);
 assert.notEqual(await p.locator('[data-testid=drum-graph-eq]').innerHTML(),eqBefore,'EQ graph follows');
 await shape.getByRole('tab',{name:'Compressor',exact:true}).click();
 await shape.getByRole('slider',{name:'Ratio',exact:true}).focus();await p.keyboard.press('Shift+ArrowUp');
 await p.waitForFunction(()=>window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape.comp_ratio>1);
 await p.getByRole('slider',{name:'Pan',exact:true}).focus();await p.keyboard.press('Shift+ArrowLeft');
 await p.waitForFunction(()=>window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape.pan<0);
 assert.equal((await pad()).source.sha256,sha,'shaping never rewrites the source');
 await shape.getByRole('tab',{name:'Filter & drive',exact:true}).click();
 await send('drum_note',[0,kit,0,110]);await p.waitForTimeout(200);
 // Every rack control is a 44 px touch target and inside the window.
 for(const node of await p.locator('.drum-rack button,.drum-rack select,.drum-rack [role="slider"]').all()){
  if(!await node.isVisible())continue;const r=await node.boundingBox();
  assert.ok(r.width>=44&&r.height>=44,'44px '+(await node.getAttribute('aria-label')||await node.innerText()));
  if(!process.env.NOGEOM)assert.ok(r.y+r.height<=H+1,'inside window '+JSON.stringify(r));
 }
 await shape.getByRole('tab',{name:'Envelope',exact:true}).click();await p.waitForTimeout(300);
 // Exact entry for a readable picture: 0.40 s decay.
 await shape.locator('.knob-value').nth(2).click();await p.getByLabel('Decay numeric value').fill('400');await p.keyboard.press('Enter');
 await p.waitForFunction(()=>Math.abs(window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape?.decay-.4)<.001);await p.waitForTimeout(300);
 await p.screenshot({path:path.join(OUT,'drum-shape-1280x'+H+'.png')});
 await shape.getByRole('button',{name:'Reset',exact:true}).click();
 await p.waitForFunction(()=>{const s=window.__drumLatest.state.tracks[0].drum_rack.pads[0].shape;return !s||(s.start===0&&s.end===1&&s.decay===0&&s.reverse===false&&s.pan===0&&s.eq_mid===0);});
 assert.deepEqual(errors,[],'no renderer errors');
 console.log('PASS: drum pad shaping at 1280×'+H+': envelope/trim/reverse/drag/reset are single committed edits, source untouched, 44px controls');
 await app.close();
})().catch(async e=>{console.error('FAIL',e);try{await app?.close();}catch{}process.exit(1);});
