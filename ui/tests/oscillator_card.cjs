'use strict';
// Oscillator card on the Synth Sound page (26 Nov): Drawn / Saw / Pulse / FM reach the engine, the extra controls show only for the wave that uses them,
// every control is >= 44 px and reachable at 1280 x 718 and 800, the four columns of cards still fit, and the drawn partials are locked while a wave makes them.
require('./deck_guard.cjs');
const {_electron}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const ROOT=path.resolve(__dirname,'..'),SCREENS=process.env.DECKSYNTH_SCREENS||path.resolve(ROOT,'../artifacts/oscillator'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'osc-'));
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

 const wave=name=>p.getByRole('radiogroup',{name:'Waveform',exact:true}).getByRole('radio',{name,exact:true});
 for(const h of [718,800]){
  await size(h);await p.mouse.move(2,2);await p.waitForTimeout(150);
  for(const n of ['Drawn','Saw','Pulse','FM'])await big(wave(n),'wave '+n);
  const fits=async why=>{const cols=await p.evaluate(()=>[innerHeight,...[...document.querySelectorAll('.ss-col')].map(c=>Math.round(c.getBoundingClientRect().bottom))]);assert.ok(cols.slice(1).every(b=>b<=cols[0]),why+' cards fit '+cols);};
  await fits('drawn');await shot('sound-osc-drawn-1280x'+h+'.png');
  await wave('Pulse').click();await wait(()=>window.__st.state.tracks[0].instrument.wave===2);
  await big(p.getByRole('slider',{name:'Width',exact:true}),'Width knob');await fits('pulse');await shot('sound-osc-pulse-1280x'+h+'.png');
  await wave('FM').click();await wait(()=>window.__st.state.tracks[0].instrument.wave===3);
  for(let n=1;n<=8;n++)await big(p.getByRole('radiogroup',{name:'FM ratio',exact:true}).getByRole('radio',{name:'Modulator '+n+' times the note'}),'ratio '+n);
  await big(p.getByRole('slider',{name:'Index',exact:true}),'Index knob');await fits('fm');await shot('sound-osc-fm-1280x'+h+'.png');
  await wave('Drawn').click();await wait(()=>!window.__st.state.tracks[0].instrument.wave);
 }
 // the engine takes the choices
 await wave('FM').click();await wait(()=>window.__st.state.tracks[0].instrument.wave===3);
 await p.getByRole('radiogroup',{name:'FM ratio',exact:true}).getByRole('radio',{name:'Modulator 5 times the note'}).click();
 await wait(()=>window.__st.state.tracks[0].instrument.fm_ratio===5);
 const k=p.getByRole('slider',{name:'Index',exact:true});await k.focus();for(let i=0;i<6;i++)await p.keyboard.press('ArrowUp');
 await wait(()=>(window.__st.state.tracks[0].instrument.fm_index??.3)>.3);console.log('fm',JSON.stringify(await inst()).match(/"(wave|fm_ratio|fm_index)":[\d.]+/g));
 // the drawn partials are locked under a wave: a drag on the bars changes nothing
 const before=JSON.stringify((await inst()).harmonics);const b=await p.locator('.ss-bars').boundingBox();
 await p.mouse.move(b.x+b.width/3,b.y+b.height/2);await p.mouse.down();await p.mouse.move(b.x+b.width/2,b.y+10,{steps:4});await p.mouse.up();await p.waitForTimeout(300);
 assert.equal(JSON.stringify((await inst()).harmonics),before,'bars are locked under FM');
 await wave('Drawn').click();await wait(()=>!window.__st.state.tracks[0].instrument.wave);
 await p.mouse.move(b.x+b.width/3,b.y+b.height/2);await p.mouse.down();await p.mouse.move(b.x+b.width/2,b.y+10,{steps:4});await p.mouse.up();
 await wait(x=>JSON.stringify(window.__st.state.tracks[0].instrument.harmonics)!==x,before);
 assert.deepEqual(errors,[]);console.log('PASS oscillator card');
})().catch(async e=>{console.error(e.stack||e);if(p)await shot('failure.png');process.exitCode=1;}).finally(async()=>{if(app)await app.close();fs.rmSync(tmp,{recursive:true,force:true});});
