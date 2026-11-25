'use strict';
// Strike card on the Synth Sound page: fits at 1280 x 718 and 800, every knob reachable, edits reach the engine.
require('./deck_guard.cjs');
const {_electron}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const ROOT=path.resolve(__dirname,'..'),SCREENS=process.env.DECKSYNTH_SCREENS||path.resolve(ROOT,'../artifacts/strike'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'strike-'));
const OZONE=process.env.WAYLAND_DISPLAY?'wayland':'x11';let app,p;const errors=[];
const wait=(fn,arg)=>p.waitForFunction(fn,arg);
async function size(h){await app.evaluate(({BrowserWindow},h)=>BrowserWindow.getAllWindows()[0].setContentSize(1280,h),h);await wait(h=>innerWidth===1280&&Math.abs(innerHeight-h)<=40,h);}
(async()=>{
 fs.mkdirSync(SCREENS,{recursive:true});
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),args:['--ozone-platform='+OZONE,'electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:tmp,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:OZONE},timeout:20000});
 p=await app.firstWindow();p.setDefaultTimeout(8000);p.on('pageerror',e=>errors.push(e.message));
 await wait(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 await p.evaluate(()=>window.deckApi.onMessage(m=>{window.__st={...window.__st,...m};}));await wait(()=>window.__st?.state);
 await p.getByRole('tab',{name:'Sound',exact:true}).click();
 for(const h of [718,800]){
  await size(h);await p.getByRole('radio',{name:'Strike',exact:true}).click();const c=p.locator('.ss-graph.view-strike');await c.waitFor();
  await p.mouse.move(2,2);await p.waitForTimeout(150);
  for(const t of await p.locator('.ss-tools .smp-tool').all()){const r=await t.boundingBox();assert.ok(r.width>=44&&r.height>=44,'tool 44px '+JSON.stringify(r));}
  const cols=await p.evaluate(()=>[innerHeight,...[...document.querySelectorAll('.ss-col')].map(c=>Math.round(c.getBoundingClientRect().bottom))]);assert.ok(cols.slice(1).every(b=>b<=cols[0]),'cards fit '+cols);console.log('window and column bottoms',cols);
  await p.screenshot({path:path.join(SCREENS,'sound-strike-1280x'+h+'.png')});
  for(const name of ['Damping','Noise','Noise time','Noise tone','Pitch drop','Drop time']){
   const k=c.getByRole('slider',{name,exact:true}),r=await k.boundingBox();assert.ok(r,'knob '+name);
   assert.ok(r.width>=44&&r.height>=44,name+' 44px '+JSON.stringify(r));
   const hit=await k.evaluate(el=>{const b=el.getBoundingClientRect(),t=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return !!t&&(el===t||el.contains(t)||t.contains(el));});
   assert.ok(hit,name+' reachable');console.log(h,name,JSON.stringify(r));
  }
  const scroll=await p.evaluate(()=>{const s=document.querySelector('.ss-cards');return s?[s.scrollHeight,s.clientHeight]:null;});console.log(h,'cards scroll/client',JSON.stringify(scroll));
 }
 const c=p.locator('.ss-graph.view-strike'),k=c.getByRole('slider',{name:'Damping',exact:true});await k.focus();for(let i=0;i<8;i++)await p.keyboard.press('ArrowUp');
 await wait(()=>(window.__st.state.tracks[0].instrument.damp??0)>0);console.log('damp reaches the engine',await p.evaluate(()=>window.__st.state.tracks[0].instrument.damp));
 assert.deepEqual(errors,[]);console.log('PASS strike card');
})().catch(async e=>{console.error(e.stack||e);if(p)await p.screenshot({path:path.join(SCREENS,'failure.png')});process.exitCode=1;}).finally(async()=>{if(app)await app.close();fs.rmSync(tmp,{recursive:true,force:true});});
