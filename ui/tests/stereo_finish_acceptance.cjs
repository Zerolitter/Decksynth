// Stereo finish batch (28 Nov): a stereo Drum Rack pad says Stereo and has Fade in / Fade out; the Sampler's Env view
// keeps Whole : Env and Clear inside the rack display; the Chop view keeps its keyboard inside the window.
// Real worker, dummy audio. HEIGHT=718 or 800. OUT=<folder> for the screenshots.
'use strict';
require('./deck_guard.cjs');
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.OUT||path.resolve(ROOT,'../artifacts/stereo-finish');const H=Number(process.env.HEIGHT||718);
const DATA=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-stfin-'));
function wav(file,seconds=1.5,rate=48000){   // stereo: a 220 Hz saw on the left, a quieter 330 Hz saw on the right
  const n=Math.round(seconds*rate),b=Buffer.alloc(44+4*n);
  b.write('RIFF',0);b.writeUInt32LE(36+4*n,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);
  b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*4,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4*n,40);
  for(let i=0;i<n;i++){const l=(i*220/rate)%1,r=(i*330/rate)%1,g=((i/rate)*4)%1<.5?1:0;   // four bursts, so Chop finds slices
    b.writeInt16LE(Math.round((l*2-1)*.4*g*32767),44+4*i);b.writeInt16LE(Math.round((r*2-1)*.2*g*32767),46+4*i);}
  fs.writeFileSync(file,b);return file;}
let app,page;
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const file=wav(path.join(DATA,'wide.wav'));
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:DATA,DECKSYNTH_NO_AUTOSAVE:'1',SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 const p=page=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,h);},H);
 await p.setViewportSize({width:1280,height:H});await p.waitForFunction(h=>innerWidth===1280&&innerHeight===h,H,{timeout:5000});
 await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 await p.evaluate(()=>{window.deckApi.onMessage(m=>{if(m.state)window.__latest=m;});});
 await p.waitForFunction(()=>!!window.__latest);
 const send=(c,a)=>p.evaluate(([c,a])=>window.deckApi.send(c,a),[c,a]);
 const shot=async name=>{await p.waitForTimeout(300);await p.screenshot({path:path.join(OUT,name+'-'+H+'.png')});};
 const within=async(loc,box,what)=>{const b=await loc.boundingBox();const o=await box.boundingBox();
  assert.ok(b&&o,what+' is there');
  assert.ok(b.x>=o.x-.5&&b.x+b.width<=o.x+o.width+.5,what+' inside its box horizontally: '+JSON.stringify({b,o}));};
 const inWindow=async(loc,what)=>{const b=await loc.boundingBox();assert.ok(b,what+' is there');
  assert.ok(b.y+b.height<=H+.5&&b.x+b.width<=1280.5,what+' inside the window: '+JSON.stringify(b));};

 // ---- Drum Rack: a stereo pad
 await send('select',0);await send('set_device',[0,'drum_rack']);
 await p.waitForFunction(()=>window.__latest.state.tracks[0].device==='drum_rack');
 const kit=await p.evaluate(()=>window.__latest.state.tracks[0].drum_rack.id);
 await send('drum_import',[0,kit,0,file]);
 await p.waitForFunction(()=>window.__latest.drum_racks?.[0]?.pads?.[0]?.status==='READY'||window.__latest.drum_racks?.[0]?.pads?.[0]?.status==='PLAYING',null,{timeout:20000}).catch(()=>{});
 await p.getByRole('tab',{name:/^Sound$/i}).click();await p.locator('.drum-rack').waitFor();
 await p.locator('.drum-pad').first().click();
 await p.waitForFunction(()=>/Stereo/i.test(document.querySelector('.drum-pad-sound .smp-rack-stereo')?.textContent||''),null,{timeout:10000});
 const shape=p.locator('section.drum-card-shape');
 const names=(await shape.locator('.knob-heading').allTextContents()).map(t=>t.trim());
 assert.deepEqual(names,['Attack','Hold','Decay','Fade in','Fade out']);
 await shot('drumrack-stereo');
 // Fade in and Fade out are heard: the shaped pad keeps both channels.
 await send('drum_edit',[0,kit,0,'shape',{fade_in:.3,fade_out:.4}]);
 await p.waitForFunction(()=>{const s=window.__latest.state.tracks[0].drum_rack.pads[0].shape;return s&&s.fade_in===.3&&s.fade_out===.4;},null,{timeout:8000});
 await p.waitForTimeout(400);
 assert.equal(await p.evaluate(()=>window.__latest.drum_racks[0].pads[0].stereo),true,'still stereo after the fades');
 await p.getByRole('radio',{name:'Envelope'}).click();await shot('drumrack-env');
 await p.getByRole('radio',{name:'Trim'}).click();

 // ---- Sampler: Env and Chop
 await send('set_device',[0,'sampler']);
 await p.waitForFunction(()=>window.__latest.state.tracks[0].device==='sampler');
 const id=await p.evaluate(()=>window.__latest.state.tracks[0].sampler.id);await send('sampler_load_wav',[0,id,file]);
 await p.waitForFunction(()=>window.__latest.samplers?.[0]?.status==='READY',null,{timeout:20000});
 await p.locator('.sampler-page').waitFor();
 const tabs=p.getByRole('radiogroup',{name:'Edit'});
 await tabs.getByRole('radio',{name:'Envelope'}).click();await p.locator('.smp-scale-swap').waitFor();
 const display=p.locator('.sampler-page .smp-rack-display');
 await within(p.locator('.sampler-page .smp-scale-swap'),display,'Whole : Env');
 const db=await display.boundingBox(),gb=await p.locator('.sampler-page .smp-rack-grid').boundingBox();
 assert.ok(db.x>=gb.x+gb.width-.5,'the display does not overlap the tool buttons: '+JSON.stringify({db,gb}));
 const overflow=await p.locator('.sampler-page .smp-rack-grid').evaluate(g=>[...g.querySelectorAll('.smp-tool')].filter(b=>{const r=b.getBoundingClientRect(),o=g.getBoundingClientRect();return r.right>o.right+.5;}).map(b=>b.getAttribute('aria-label')));
 assert.deepEqual(overflow,[],'no tool button is cut off at the right');
 await shot('sampler-env');
 const clear=p.locator('.sampler-page .smp-clear-sample');
 await inWindow(clear,'Clear');
 const cb=await clear.boundingBox(),tb=await p.locator('.sampler-page .smp-tools').boundingBox();
 assert.ok(cb.x+cb.width<=tb.x+tb.width+.5,'Clear is not cut off at the right edge of the tools: '+JSON.stringify({cb,tb}));
 assert.ok(cb.x+cb.width<=1280,'Clear inside the window');
 const hit=await clear.evaluate(e=>{const r=e.getBoundingClientRect();const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!t&&(e===t||e.contains(t));});
 assert.ok(hit,'Clear is not covered');
 await tabs.getByRole('radio',{name:'Chop'}).click();await p.locator('.sampler-page .smp-chop').waitFor();await p.waitForTimeout(400);
 await shot('sampler-chop');
 const probe=async what=>{const b=await p.locator('.sampler-page .smp-keys').boundingBox();assert.ok(b.y+b.height<=H+.5,'the keyboard ends inside the window in '+what+': '+Math.round(b.y+b.height)+' of '+H);return b.y+b.height;};
 for(const mode of ['Threshold','Regions','BPM']){
  await p.locator('.sampler-page').getByText(mode,{exact:true}).first().click();await p.waitForTimeout(250);
  await probe(mode);await inWindow(p.locator('.sampler-page .smp-keys'),'the keyboard in Chop '+mode);
  if(mode==='Regions')await shot('sampler-chop-regions');}
 await p.locator('.sampler-page .smp-window').click({position:{x:400,y:60}});await p.waitForTimeout(300);await probe('slice selected');await shot('sampler-chop-selected');
 for(const m of ['Slices','Pitched']){await p.locator('.sampler-page').getByRole('button',{name:m,exact:true}).first().click().catch(()=>{});await p.waitForTimeout(300);await probe(m);await shot('sampler-chop-'+m.toLowerCase());}
 await p.locator('.sampler-page').getByRole('button',{name:/Pads/}).click().catch(()=>{});await p.waitForTimeout(300);await probe('pads sheet');await shot('sampler-chop-pads');
 await p.keyboard.press('Escape');
 for(const m of ['Grain','Loop','One shot']){await p.locator('.sampler-page').getByText(m,{exact:true}).first().click();await p.waitForTimeout(400);await probe('play '+m);await shot('sampler-chop-play-'+m.replace(' ','').toLowerCase());}
 assert.ok(await p.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),'the page does not scroll');
 const wave=await p.locator('.sampler-page .smp-window').boundingBox();
 assert.ok(wave.height>=90,'the waveform keeps room in Chop: '+wave.height);
 assert.deepEqual(errors,[],'no page errors');
 console.log('PASS stereo finish at '+H);
})().catch(async e=>{console.error(e);try{await page?.screenshot({path:path.join(OUT,'failure-'+H+'.png')});}catch{}process.exitCode=1;}).finally(async()=>{try{await app?.close();}catch{}});
