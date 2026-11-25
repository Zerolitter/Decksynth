'use strict';
// Sample layer on the Synth Sound page: its view fits at 1280 x 718 and 800, every control is >= 44 px and reachable, the empty state offers
// "Choose a sample", the picker sheet hands a factory sound to the engine, the mode / power / knobs reach the engine and Spectrum writes the partials.
require('./deck_guard.cjs');
const {_electron}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const ROOT=path.resolve(__dirname,'..'),SCREENS=process.env.DECKSYNTH_SCREENS||path.resolve(ROOT,'../artifacts/sample-layer'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'layer-'));
const OZONE=process.env.DECKSYNTH_OZONE||(process.env.WAYLAND_DISPLAY?'wayland':'x11');let app,p;const errors=[];
const wait=(fn,arg)=>p.waitForFunction(fn,arg);
async function size(h){await app.evaluate(({BrowserWindow},h)=>BrowserWindow.getAllWindows()[0].setContentSize(1280,h),h);await wait(h=>innerWidth===1280&&Math.abs(innerHeight-h)<=40,h);}
const shot=name=>p.screenshot({path:path.join(SCREENS,name),timeout:30000});
const inst=()=>p.evaluate(()=>window.__st.state.tracks[0].instrument);
async function big(loc,label){const r=await loc.boundingBox();assert.ok(r,label+' is there');assert.ok(r.width>=44&&r.height>=44,label+' 44px '+JSON.stringify(r));
 const hit=await loc.evaluate(el=>{const b=el.getBoundingClientRect(),t=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return !!t&&(el===t||el.contains(t)||t.contains(el));});assert.ok(hit,label+' reachable');return r;}
(async()=>{
 fs.mkdirSync(SCREENS,{recursive:true});
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),args:['--ozone-platform='+OZONE,'electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:tmp,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:OZONE},timeout:20000});
 p=await app.firstWindow();p.setDefaultTimeout(8000);p.on('pageerror',e=>errors.push(e.message));
 await wait(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 await p.evaluate(()=>window.deckApi.onMessage(m=>{window.__st={...window.__st,...m};}));await wait(()=>window.__st?.state);
 await size(800);
 await p.getByRole('tab',{name:'Sound',exact:true}).click();
 const c=p.locator('.ss-graph.view-layer');
 for(const h of [718,800]){
  await size(h);await p.getByRole('radio',{name:'Sample layer',exact:true}).click();await c.waitFor();await p.mouse.move(2,2);await p.waitForTimeout(150);
  for(const t of await p.locator('.ss-tools .smp-tool').all()){const r=await t.boundingBox();assert.ok(r.width>=44&&r.height>=44,'tool 44px '+JSON.stringify(r));}
  const cols=await p.evaluate(()=>[innerHeight,...[...document.querySelectorAll('.ss-col')].map(c=>Math.round(c.getBoundingClientRect().bottom))]);assert.ok(cols.slice(1).every(b=>b<=cols[0]),'cards fit '+cols);
  const noScroll=await p.evaluate(()=>{const e=document.querySelector('.ss-layer');return e.scrollWidth<=e.clientWidth+1&&e.scrollHeight<=e.clientHeight+1;});assert.ok(noScroll,'layer view has no hidden overflow');
  // empty state: the card itself offers the choice
  await big(c.getByRole('button',{name:'Choose a sample',exact:true}),'Choose a sample');
  for(const name of ['Level','Tune','Start'])await big(c.getByRole('slider',{name,exact:true}),'knob '+name);
  for(const name of ['Attack','Body'])await big(c.getByRole('radio',{name,exact:true}),'mode '+name);
  await big(c.getByRole('switch',{name:'Through filter'}),'Through filter');await big(c.getByRole('switch',{name:'Loop'}),'Loop');
  await shot('sound-layer-empty-1280x'+h+'.png');
 }
 // choose a factory sound in the sheet over the window
 await c.getByRole('button',{name:'Choose a sample',exact:true}).click();
 const sheet=p.getByRole('dialog',{name:'Sample library'});await sheet.waitFor();
 await shot('sound-layer-picker-1280x800.png');
 await big(sheet.getByRole('button',{name:'808 kick',exact:true}),'factory 808 kick');
 assert.equal(await sheet.getByRole('region',{name:'Save to library'}).count(),0,'no Save row when picking');
 await sheet.getByRole('button',{name:'808 kick',exact:true}).click();await sheet.waitFor({state:'detached'});
 await wait(()=>window.__st.state.tracks[0].instrument.layer_file==='factory:808-kick-attack.wav');
 assert.equal((await inst()).layer_on,1);
 await wait(()=>window.__st.layer?.status==='ready');console.log('layer info',JSON.stringify({...await p.evaluate(()=>window.__st.layer),peaks:undefined}));
 for(const h of [800,718]){
  await size(h);await p.mouse.move(2,2);await p.waitForTimeout(150);
  await big(c.locator('.ss-layer-wave'),'sample outline');await big(c.getByRole('button',{name:/Write the sample's spectrum/}),'Spectrum button');
  await shot('sound-layer-1280x'+h+'.png');
 }
 // controls reach the engine
 await c.getByRole('radio',{name:'Body',exact:true}).click();await wait(()=>window.__st.state.tracks[0].instrument.layer_mode===2);
 await c.getByRole('radio',{name:'Attack',exact:true}).click();await wait(()=>window.__st.state.tracks[0].instrument.layer_mode===1);
 await c.getByRole('switch',{name:'Through filter'}).click();await wait(()=>window.__st.state.tracks[0].instrument.layer_follow===1);
 const k=c.getByRole('slider',{name:'Level',exact:true});await k.focus();for(let i=0;i<8;i++)await p.keyboard.press('ArrowDown');
 await wait(()=>(window.__st.state.tracks[0].instrument.layer_level??1)<1);console.log('layer_level',(await inst()).layer_level);
 const before=JSON.stringify((await inst()).harmonics);
 await c.getByRole('button',{name:/Write the sample's spectrum/}).click();await wait(b=>JSON.stringify(window.__st.state.tracks[0].instrument.harmonics)!==b,before);
 console.log('partials',JSON.stringify((await inst()).harmonics));
 await c.getByRole('switch',{name:/Turn sample layer off/}).click();await wait(()=>window.__st.state.tracks[0].instrument.layer_on===0);
 await c.getByRole('switch',{name:/Turn sample layer on/}).click();await wait(()=>window.__st.state.tracks[0].instrument.layer_on===1);
 assert.deepEqual(errors,[]);console.log('PASS sample layer card');
})().catch(async e=>{console.error(e.stack||e);if(p)await shot('failure.png');process.exitCode=1;}).finally(async()=>{if(app)await app.close();fs.rmSync(tmp,{recursive:true,force:true});});
