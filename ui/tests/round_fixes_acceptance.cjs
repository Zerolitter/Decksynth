// Fixes from Sir's test round (25 Nov). Real worker, dummy audio: the Strike view has a Noise switch (44 px, writes noise_on),
// Settings has "Load presets with Strike noise" (off by default), the FX presets sheet closes on a tap outside it,
// and the Space card's Decay goes up to 20 s.
'use strict';
require('./deck_guard.cjs');
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.DECKSYNTH_SCREENS||process.env.OUT||path.resolve(ROOT,'../artifacts/round-fixes');
const OZONE=process.env.DECKSYNTH_OZONE||(process.env.WAYLAND_DISPLAY?'wayland':'x11');
const DATA=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-round-'));
let app;
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['--ozone-platform='+OZONE,'electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:DATA,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:OZONE},timeout:20000});
 const p=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 await p.evaluate(()=>{window.deckApi.onMessage(m=>{if(m.state)window.__latest=m;});});
 await p.waitForFunction(()=>!!window.__latest);
 const ins=()=>p.evaluate(()=>window.__latest.state.tracks[0].instrument);
 const sizeTo=async h=>{await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,h);},h);
  await p.setViewportSize({width:1280,height:h});await p.waitForFunction(h=>innerWidth===1280&&innerHeight===h,h,{timeout:5000});};
 const inside=async(loc,what,H)=>{const b=await loc.boundingBox();assert.ok(b&&b.y>=0&&b.y+b.height<=H+1,what+' inside the window: '+JSON.stringify(b));
  const hit=await loc.evaluate(e=>{const r=e.getBoundingClientRect();const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!t&&(e===t||e.contains(t));});
  assert.ok(hit,what+' is not covered');
  const zone=await loc.evaluate(e=>{const r=e.getBoundingClientRect(),a=getComputedStyle(e,'::after');
   const px=v=>parseFloat(v)||0;return {w:r.width-px(a.left)-px(a.right),h:r.height-px(a.top)-px(a.bottom)};});
  assert.ok(zone.w>=44&&zone.h>=44,what+' has a 44 px hit zone: '+JSON.stringify(zone));};

 // 1. Strike view: the Noise switch
 const soundTab=p.getByRole('tab',{name:/^Sound$/i});if(await soundTab.getAttribute('aria-selected')!=='true')await soundTab.click();
 await p.getByRole('radio',{name:'Strike',exact:true}).click();
 for(const H of [718,800]){
  await sizeTo(H);
  const sw=p.getByRole('switch',{name:/^Turn Strike noise/});
  await inside(sw,'Noise switch',H);
  await p.screenshot({path:path.join(OUT,'strike-noise-'+H+'.png')});
 }
 const sw=p.getByRole('switch',{name:/^Turn Strike noise/});
 const before=(await ins()).noise_on??1;
 await sw.click();
 await p.waitForFunction(b=>(window.__latest.state.tracks[0].instrument.noise_on??1)!==b,before);
 assert.equal(await sw.getAttribute('aria-checked'),String(!before));
 console.log('PASS: the Strike view has a Noise switch that turns the noise burst on and off');

 // 2. Settings: Load presets with Strike noise, off by default
 await p.getByRole('button',{name:'Settings',exact:true}).click();
 const opt=p.getByRole('switch',{name:'Load presets with Strike noise'});
 assert.equal(await opt.isChecked(),false,'off by default');
 await opt.scrollIntoViewIfNeeded();await p.screenshot({path:path.join(OUT,'settings-preset-noise-800.png')});
 await p.locator('.settings-dialog .modal-close').click();
 console.log('PASS: Settings has "Load presets with Strike noise", off by default');

 // 3. FX: the presets sheet closes on a tap outside it; Space decay is capped at 20 s
 await p.getByRole('tab',{name:/^FX$/i}).first().click();
 await p.locator('.fx-card-module').first().waitFor();
 while(await p.locator('.fx-card-module').count()){const n=await p.locator('.fx-card-module').count();
  await p.locator('.fx-card-module .fx-remove').first().click();
  await p.waitForFunction(k=>document.querySelectorAll('.fx-card-module').length<k,n);}
 await p.getByRole('button',{name:'Add Space'}).click();
 await p.locator('.fx-card-module').first().waitFor();
 for(const H of [718,800]){
  await sizeTo(H);
  await p.getByRole('button',{name:'Presets for Space'}).click();
  const sheet=p.getByRole('dialog',{name:'Space presets'});await sheet.waitFor();
  // outside the sheet: the top bar's empty middle
  const spot=await p.locator('.transport-spacer').boundingBox();
  await p.mouse.click(spot.x+spot.width/2,spot.y+spot.height/2);
  await sheet.waitFor({state:'detached'});
 }
 await p.getByRole('button',{name:'Presets for Space'}).click();
 await p.getByRole('dialog',{name:'Space presets'}).getByRole('button',{name:'Space preset Infinite'}).click();
 await p.waitForFunction(()=>window.__latest.state.tracks[0].fx.modules.find(m=>m.id==='space')?.params.decay===20);
 await p.keyboard.press('Escape');
 console.log('PASS: the FX presets sheet closes on a tap outside it; Space Infinite is 20 s');
 assert.deepEqual(errors,[]);
 console.log('round fixes acceptance: ok');
 await app.close();
})().catch(async e=>{console.error(e);try{await app?.close();}catch{}process.exit(1);});
