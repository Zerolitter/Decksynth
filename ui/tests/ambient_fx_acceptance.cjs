// Ambient FX (Sir, 25 Nov): Tape, Smear, Shimmer and Space. Real worker, dummy audio, page set to 1280 x HEIGHT
// (718 or 800). All four are added from the picker on one track; every control on their cards is 44 px and uncovered;
// Character, Interval and Freeze buttons change the engine's value; each has six presets; then a screenshot.
'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.OUT||path.resolve(ROOT,'../artifacts/ambient-fx');const H=Number(process.env.HEIGHT||718);
const DATA=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-ambient-'));
const NAMES=['Tape','Smear','Shimmer','Space'];
let app,page;
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:DATA,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 const p=page=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,h);},H);
 // Windowed SteamOS caps the window at 772 px (taskbar): set the renderer viewport itself, like touch_target_acceptance.
 await p.setViewportSize({width:1280,height:H});await p.waitForFunction(h=>innerWidth===1280&&innerHeight===h,H,{timeout:5000});
 await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 await p.evaluate(()=>{window.deckApi.onMessage(m=>{if(m.state)window.__latest=m;});});
 await p.waitForFunction(()=>!!window.__latest);
 const fxParam=(id,key)=>p.evaluate(([id,key])=>window.__latest.state.tracks[window.__latest.state.selected??0]?.fx?.modules.find(m=>m.id===id)?.params[key],[id,key]);
 const engineIs=(id,key,v)=>p.waitForFunction(([id,key,v])=>{const s=window.__latest.state,t=s.tracks[s.selected??0];
  const m=t?.fx?.modules.find(m=>m.id===id);return !!m&&m.on&&Math.abs(m.params[key]-v)<1e-6;},[id,key,v]);

 await p.getByRole('tab',{name:/^FX$/i}).first().click();
 // The first track comes with the factory sound's effects: clear them so the four ambient cards share the page.
 await p.locator('.fx-cards').waitFor();
 while(await p.locator('.fx-card-module').count()){const n=await p.locator('.fx-card-module').count();
  await p.locator('.fx-card-module .fx-remove').first().click();
  await p.waitForFunction(k=>document.querySelectorAll('.fx-card-module').length<k,n);}
 // Add all four from the picker ("Add an effect" on the empty rack, then the Add effect sheet).
 for(const n of NAMES){
  const open=p.locator('.fx-add-open');if(await open.count())await open.click();
  await p.getByRole('button',{name:'Add '+n,exact:true}).first().click();
  await p.locator('[data-panel="fx-'+n.toLowerCase()+'"]').waitFor();
 }
 for(const id of ['tape','smear','shimmer','space'])await p.waitForFunction(id=>{const s=window.__latest.state,t=s.tracks[s.selected??0];
  return !!t?.fx?.modules.find(m=>m.id===id)?.on;},id);
 assert.equal(await p.locator('.fx-card-module').count(),4,'four cards');

 // Every control on the four cards: at least 44 x 44 (pseudo-element hit areas count, rule 10), inside the
 // window and not covered by anything else once its card is in view.
 let controls=0;
 for(const n of NAMES){
  const card=p.locator('[data-panel="fx-'+n.toLowerCase()+'"]');
  await card.scrollIntoViewIfNeeded();await p.waitForTimeout(120);
  const bad=await card.evaluate((root,H)=>{const out=[];let count=0;
   for(const e of root.querySelectorAll('button,[role=button],[role=radio],[role=slider],[role=switch],.knob-target,.value-box')){
    if(e.parentElement?.closest('button,[role=button],[role=radio],[role=slider],[role=switch],.knob-target,.value-box')&&!e.matches('.knob-target'))continue;
    const r=e.getBoundingClientRect();if(r.width<1||r.height<1||getComputedStyle(e).visibility==='hidden')continue;count++;
    let x1=r.left,x2=r.right,y1=r.top,y2=r.bottom;
    for(const ps of ['::before','::after']){const s=getComputedStyle(e,ps);if(s.content==='none'||s.position!=='absolute'||s.pointerEvents==='none')continue;
     const v=['top','right','bottom','left'].map(k=>/px$/.test(s[k])?parseFloat(s[k]):NaN);if(v.some(Number.isNaN))continue;
     x1=Math.min(x1,r.left+v[3]);x2=Math.max(x2,r.right-v[1]);y1=Math.min(y1,r.top+v[0]);y2=Math.max(y2,r.bottom-v[2]);}
    const name=(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,30);
    if(x2-x1<43.5||y2-y1<43.5)out.push(name+' is '+Math.round(x2-x1)+'x'+Math.round(y2-y1));
    if(r.bottom>H+1||r.right>1281||r.top<0||r.left<0)out.push(name+' is outside the window');
    const t=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    if(!t||!(t===e||e.contains(t)||t.contains(e)))out.push(name+' is covered by '+(t?.className||t?.tagName));}
   return {out,count};},H);
  controls+=bad.count;
  assert.deepEqual(bad.out,[],n+' card controls');
 }
 console.log('PASS '+controls+' controls on the four cards: 44 px, inside 1280x'+H+', uncovered');

 // Segmented choices set the engine value.
 const pick=async(id,group,label,key,value)=>{const card=p.locator('[data-panel="fx-'+id+'"]');await card.scrollIntoViewIfNeeded();
  const b=card.getByRole('radiogroup',{name:group}).getByRole('radio',{name:label,exact:true});
  await b.click();await engineIs(id,key,value);assert.equal(await b.getAttribute('aria-checked'),'true',group+' '+label+' shows it is on');};
 await pick('tape','Tape Character','Broken','character',2);await pick('tape','Tape Character','Worn','character',1);
 await pick('shimmer','Shimmer Interval','+19','interval',2);await pick('shimmer','Shimmer Interval','+7','interval',1);
 await pick('shimmer','Shimmer Interval','+24','interval',3);await pick('shimmer','Shimmer Interval','+12','interval',0);
 await pick('space','Space Freeze','Freeze','freeze',1);
 await p.locator('.fx-cards').evaluate(e=>e.scrollTop=0);await p.waitForTimeout(150);
 await p.screenshot({path:path.join(OUT,'ambient-fx-frozen-'+H+'.png')});
 await pick('space','Space Freeze','Off','freeze',0);
 console.log('PASS Character, Interval and Freeze change the engine (tape '+await fxParam('tape','character')+', shimmer '+await fxParam('shimmer','interval')+', space '+await fxParam('space','freeze')+')');

 // Six presets each; one tap sets the knobs in the engine.
 for(const [n,preset,key,value] of [['Tape','Cassette','hiss',.35],['Smear','Thick Fog','size',1],['Shimmer','Endless','decay',20],['Space','Frozen Pad','freeze',1]]){
  await p.getByRole('button',{name:'Presets for '+n}).click();
  const sheet=p.getByRole('dialog',{name:n+' presets'});
  assert.equal(await sheet.getByRole('button',{name:new RegExp('^'+n+' preset ')}).count(),6,n+' has six presets');
  await sheet.getByRole('button',{name:n+' preset '+preset,exact:true}).click();
  await engineIs(n.toLowerCase(),key,value);
  await p.keyboard.press('Escape');await sheet.waitFor({state:'detached'});
 }
 console.log('PASS six presets each; Cassette, Thick Fog, Endless and Frozen Pad set the engine');
 await p.locator('.fx-cards').evaluate(e=>e.scrollTop=0);await p.waitForTimeout(150);
 await p.screenshot({path:path.join(OUT,'ambient-fx-'+H+'.png')});
 assert.deepEqual(errors,[]);
 console.log('PASS ambient FX at 1280x'+H);
})().catch(async e=>{console.error('FAIL',e.stack||e);if(page)await page.screenshot({path:path.join(OUT,'failure-'+H+'.png')}).catch(()=>{});process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});});
