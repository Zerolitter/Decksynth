// Pad Sound design pass (Sir, 16 Nov): view tabs in the title bar, an empty state that does the job,
// quiet card icons, cards on one bottom edge, a compressor meter with a scale. Screenshots for review.
'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.OUT?path.resolve(ROOT,process.env.OUT):path.resolve(ROOT,'../artifacts/sampler-editing/r2');const H=Number(process.env.HEIGHT||718);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-pad-sound-'));
const wav=path.join(tmp,'kick.wav');
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
  const panel=p.locator('.drum-pad-sound');
  const small=async()=>panel.locator('button:visible').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return [e.getAttribute('aria-label')||e.textContent.trim(),Math.round(r.width),Math.round(r.height)];}).filter(([, w,h])=>w<44||h<44));
  // Empty: the waveform area offers the import itself; no view tabs while there is nothing to view.
  await p.locator('.drum-wave-empty').waitFor();
  assert.equal(await p.getByRole('radiogroup',{name:'Waveform view'}).count(),0,'no view tabs on an empty pad');
  assert.equal(await p.locator('.drum-wave-empty .drum-empty-main').count(),1,'Choose a WAV in the empty state');
  assert.deepEqual(await small(),[],'44 px controls (empty)');
  await panel.screenshot({path:path.join(OUT,'pad-sound-empty-'+H+'.png')});
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},wav);
  await p.locator('.drum-wave-empty .drum-empty-main').click();
  await p.waitForFunction(()=>window.__drumLatest.drum_racks?.[0]?.pads?.[0]?.status==='READY');
  // Loaded: Trim / Envelope / Tone are tabs in the title bar; the waveform spans the panel.
  const tabs=p.getByRole('radiogroup',{name:'Waveform view'});
  const bar=await p.locator('.drum-pad-sound .drum-section-bar').boundingBox(),tb=await tabs.boundingBox();
  assert.ok(tb.y>=bar.y-1&&tb.y+tb.height<=bar.y+bar.height+1,'tabs sit in the title bar');
  const wave=await p.locator('.drum-rack .smp-wave-shell').boundingBox(),pb=await panel.boundingBox();
  assert.ok(wave.width>=pb.width-40,'waveform gets the full width: '+wave.width+' of '+pb.width);
  const cards=await p.locator('.drum-cards>.smp-card').evaluateAll(els=>els.map(e=>Math.round(e.getBoundingClientRect().bottom)));
  assert.equal(new Set(cards).size,1,'cards share one bottom edge: '+cards);
  assert.equal(await p.locator('.comp-meter-scale i').count(),4,'meter has a dB scale');
  assert.deepEqual(await small(),[],'44 px controls (loaded)');
  for(const [name,file] of [['Trim','pad-sound-trim'],['Envelope','pad-sound-envelope'],['Tone','pad-sound-tone']]){
   await tabs.getByRole('radio',{name}).click();await p.waitForTimeout(250);
   assert.equal(await tabs.getByRole('radio',{name}).getAttribute('aria-checked'),'true');
   await p.screenshot({path:path.join(OUT,file+'-'+H+'.png')});
  }
  // The card arrow still opens its graph above.
  await p.getByRole('button',{name:'Edit the envelope on the waveform'}).click();
  assert.equal(await tabs.getByRole('radio',{name:'Envelope'}).getAttribute('aria-checked'),'true');
  assert.deepEqual(errors,[]);
  console.log('PASS pad sound design at 1280×'+H);
 }catch(e){console.error('FAIL',e);process.exitCode=1;}finally{await app.close();}
})();
