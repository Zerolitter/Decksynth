// Sampler Recipes (25 Nov). Real worker, dummy audio: the Recipes tool in the rack opens a sheet of 44 px buttons that fits at 718 and 800 px,
// a tap applies the recipe (play style, filter, FX chain, sends) and closes it, the sample and its points stay, one Undo takes it all back,
// and a blank tap, Esc and Done close the sheet without changing anything.
'use strict';
require('./deck_guard.cjs');
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.DECKSYNTH_SCREENS||process.env.OUT||path.resolve(ROOT,'../artifacts/sampler-recipes');
const OZONE=process.env.DECKSYNTH_OZONE||(process.env.WAYLAND_DISPLAY?'wayland':'x11');
const DATA=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-recipes-'));
function toneWav(file,seconds){
 const rate=48000,n=Math.round(rate*seconds),b=Buffer.alloc(44+n*2);
 b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
 b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);
 for(let i=0;i<n;i++){const t=i/rate,env=Math.sin(Math.PI*t/seconds)**2;
  b.writeInt16LE(Math.round(9000*env*(Math.sin(2*Math.PI*220*t)+Math.sin(2*Math.PI*277*t))),44+i*2);}
 fs.writeFileSync(file,b);return file;
}
let app;
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const wav=toneWav(path.join(DATA,'Pad Chord.wav'),3);
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['--ozone-platform='+OZONE,'electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:DATA,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:OZONE},timeout:20000});
 const p=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 await p.evaluate(()=>{window.deckApi.onMessage(m=>{if(m.state)window.__latest=m;if(m.error)window.__err=m.error;});});
 await p.waitForFunction(()=>!!window.__latest);
 const latest=()=>p.evaluate(()=>window.__latest);
 const send=(c,a)=>p.evaluate(([c,a])=>window.deckApi.send(c,a),[c,a]);
 const sizeTo=async h=>{await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,h);},h);
  await p.setViewportSize({width:1280,height:h});await p.waitForFunction(h=>innerWidth===1280&&innerHeight===h,h,{timeout:5000});};
 const inside=async(loc,what,H)=>{const b=await loc.boundingBox();assert.ok(b&&b.width>=44&&b.height>=44,what+' is 44 px: '+JSON.stringify(b));
  assert.ok(b.y>=0&&b.y+b.height<=H+1&&b.x+b.width<=1281,what+' inside the window: '+JSON.stringify(b));
  const hit=await loc.evaluate(e=>{const r=e.getBoundingClientRect();const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!t&&(e===t||e.contains(t));});
  assert.ok(hit,what+' is not covered');};
 const spec=async()=>(await latest()).state.tracks[0].sampler;
 const on=async()=>((await latest()).state.tracks[0].fx?.modules??[]).filter(m=>m.on).map(m=>m.id);

 await send('select',0);await send('set_device',[0,'sampler']);
 await p.waitForFunction(()=>window.__latest?.state?.tracks?.[0]?.device==='sampler');
 await send('sampler_load_wav',[0,(await latest()).state.tracks[0].sampler.id,wav]);
 await p.waitForFunction(()=>window.__latest?.samplers?.[0]?.status==='READY',null,{timeout:30000});
 await sizeTo(800);
 const soundTab=p.getByRole('tab',{name:/^Sound$/i});if(await soundTab.getAttribute('aria-selected')!=='true')await soundTab.click();
 await p.locator('.sampler-page').waitFor();
 const id=(await spec()).id;
 await send('sampler_edit',[0,id,'patch',{start:.1,end:.8}]);
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.start===.1);

 for(const H of [718,800]){
  await sizeTo(H);
  const tool=p.locator('.smp-tools').getByRole('button',{name:'Recipes',exact:true});
  await inside(tool,'Recipes tool',H);
  for(const t of await p.locator('.smp-tools .smp-tool').all())await inside(t,'rack tool',H);
  await tool.click();
  const sheet=p.getByRole('dialog',{name:'Recipes'});await sheet.waitFor();
  const buttons=await sheet.locator('.smp-recipe').all();assert.equal(buttons.length,11,'eleven recipes');
  for(const [i,b] of buttons.entries())await inside(b,'recipe '+(i+1),H);
  await inside(sheet.getByRole('button',{name:'Done'}),'Done',H);
  const box=await sheet.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=H,'the sheet fits at '+H+': '+JSON.stringify(box));
  assert.equal(await sheet.evaluate(e=>e.scrollHeight<=e.clientHeight+1),true,'no scrolling inside the sheet');
  await p.screenshot({path:path.join(OUT,'recipes-sheet-'+H+'.png')});
  // Esc, a blank tap and Done close it and change nothing
  await p.keyboard.press('Escape');await sheet.waitFor({state:'detached'});
  await tool.click();await sheet.waitFor();await p.mouse.click(4,4);await sheet.waitFor({state:'detached'});
  await tool.click();await sheet.waitFor();await sheet.getByRole('button',{name:'Done'}).click();await sheet.waitFor({state:'detached'});
  assert.equal((await spec()).filter,'off');assert.equal((await spec()).poly,true);
 }

 // A tap applies the recipe, keeps the sample and its points, and closes the sheet.
 const pick=async name=>{await p.locator('.smp-tools').getByRole('button',{name:'Recipes',exact:true}).click();
  await p.getByRole('dialog',{name:'Recipes'}).getByRole('button',{name:new RegExp('^'+name)}).click();
  await p.getByRole('dialog',{name:'Recipes'}).waitFor({state:'detached'});};
 await pick('Acid');
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.filter==='lp24');
 let s=await spec();
 assert.deepEqual([s.poly,s.glide_mode,s.start,s.end,s.id],[false,'always',.1,.8,id]);
 assert.deepEqual(await on(),['overdrive']);
 await p.screenshot({path:path.join(OUT,'recipe-applied-acid.png')});
 // Another recipe replaces the chain; one Undo goes back to the one before.
 await pick('Space Pad');
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.mode==='loop');
 assert.deepEqual(await on(),['chorus','cloud']);
 await send('undo',null);
 await p.waitForFunction(()=>window.__latest.state.tracks[0].sampler.mode==='hold');
 s=await spec();assert.deepEqual([s.filter,s.poly],['lp24',false]);assert.deepEqual(await on(),['overdrive']);
 assert.equal(await p.evaluate(()=>window.__err),undefined,'no error from the engine');
 assert.deepEqual(errors,[]);
 console.log('sampler recipes acceptance: ok');
 await app.close();
})().catch(async e=>{console.error(e);try{await app.close();}catch{}process.exit(1);});
