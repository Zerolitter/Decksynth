// Native UI patch acceptance. Generated data/settings are isolated; no hardware MIDI/audio.
'use strict';
const {_electron}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const ROOT=path.resolve(__dirname,'..'),OUT=path.resolve(ROOT,'../artifacts/recovery/ui-top-rack');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-ui-patch-'));
const phase=process.env.DECKSYNTH_PATCH_PHASE||'top';let app,p;const errors=[];
async function send(c,a){await p.evaluate(([cmd,args])=>window.deckApi.send(cmd,args),[c,a]);}
async function read(){return p.evaluate(()=>window.__patchLatest.state);}
async function frame(label){await p.mouse.move(2,2);await p.screenshot({path:path.join(OUT,label+'-1280x718.png')});}
async function openCard(id){const c=p.locator('[data-panel="'+id+'"]');if(await c.evaluate(n=>n.classList.contains('folded')))await c.getByRole('button',{name:/^Unfold /}).click();return c;}
async function assertInView(nodes){for(const n of await nodes.all()){if(!await n.isVisible())continue;const r=await n.boundingBox();assert.ok(r&&r.x>=0&&r.y>=0&&r.x+r.width<=1281&&r.y+r.height<=719,'inside Deck viewport: '+JSON.stringify(r));}}
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),args:['--ozone-platform=x11','electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:tmp,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 p=await app.firstWindow();p.setDefaultTimeout(7000);p.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,718);});
 await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 await p.evaluate(()=>window.deckApi.onMessage(m=>{if(m.state)window.__patchLatest=m;}));await p.waitForFunction(()=>window.__patchLatest);
 assert.equal(await p.evaluate(()=>window.__patchLatest.audio),'dummy');
 if(phase==='top'||phase==='all'){
  assert.equal(await p.locator('header[aria-label="Music transport"] [role="tablist"][aria-label="Workspace"]').count(),1,'compact page tabs remain in the transport');
  for(const page of ['Song','Sound','FX','Perform']){await p.getByRole('tab',{name:page,exact:true}).click();await assertInView(p.locator('.app-header button,.app-header select,.page-bar button,.page-bar select'));assert.equal(await p.getByRole('group',{name:'Track to edit'}).getByRole('button').count(),4);}
  await p.getByRole('tab',{name:'Sound',exact:true}).click();
  const rates=p.getByRole('radiogroup',{name:'Rate of Mod pad 1',exact:true});
  // Legacy tracks omit neutral FX until the first committed edit.
  await rates.getByRole('radio',{name:'1/4',exact:true}).click();await p.waitForFunction(()=>window.__patchLatest.state.tracks[0].fx?.mods[0].rate===4);
  const before=await read();await rates.getByRole('radio',{name:'1/8',exact:true}).click();
  await p.waitForFunction(()=>window.__patchLatest.state.tracks[0].fx?.mods[0].rate===5);
  const after=await read();assert.deepEqual(after.tracks[0].fx.mods.slice(1),before.tracks[0].fx.mods.slice(1));assert.deepEqual(after.song,before.song);assert.deepEqual(after.performance,before.performance);
  await frame('top-sound');console.log('PASS top: compact navigation, 4 tracks per page, native direct rate change, SONG/performance unchanged');
 }
 if(phase==='rack'||phase==='all'){
  await p.getByRole('tab',{name:'Sound',exact:true}).click();const before=await read();
  const order=await p.locator('.sound-cards [data-panel]').evaluateAll(ns=>ns.map(n=>n.dataset.panel));
  for(const id of ['sound-tone','rack-envelope','motion-synth']){const c=await openCard(id);await c.getByRole('button',{name:/^Fold /}).click();const r=await c.boundingBox();assert.equal(Math.round(r.width),48,'individual upright rail '+id);assert.ok(r.height>=160);}
  assert.deepEqual(await p.locator('.sound-cards [data-panel]').evaluateAll(ns=>ns.map(n=>n.dataset.panel)),order,'folding preserves order');
  for(const id of ['rack-envelope','sound-tone','motion-synth']){const c=p.locator('[data-panel="'+id+'"]');await c.getByRole('button',{name:/^Unfold /}).focus();await p.keyboard.press('Enter');assert.equal(await c.evaluate(n=>n.classList.contains('folded')),false);}
  const movement=p.locator('[data-panel="motion-synth"]');await movement.getByRole('button',{name:'Fold Movement',exact:true}).click();await movement.getByRole('button',{name:'Unfold Movement',exact:true}).focus();const wasPlaying=await p.evaluate(()=>window.__patchLatest.playing);await p.keyboard.press('Space');await p.waitForTimeout(100);assert.equal(await p.evaluate(()=>window.__patchLatest.playing),wasPlaying,'Space opens a rail without starting transport');
  assert.deepEqual((await read()).tracks[0].instrument,before.tracks[0].instrument,'folds do not change sound');
  await p.getByRole('tab',{name:'FX',exact:true}).click();
  for(const name of ['Filter','EQ']){await p.getByRole('button',{name:'Add effect',exact:true}).click();await p.getByRole('dialog',{name:'Add effect',exact:true}).getByRole('button',{name:'Add '+name,exact:true}).click();}
  await p.waitForFunction(()=>window.__patchLatest.state.tracks[0].fx?.modules.filter(m=>m.on).length===2);const fx=(await read()).tracks[0].fx;
  const c=await openCard('fx-filter');await c.getByRole('button',{name:'Fold Filter',exact:true}).click();
  await c.getByRole('button',{name:'Turn off Filter',exact:true}).click();await p.waitForFunction(()=>window.__patchLatest.state.tracks[0].fx.modules.find(m=>m.id==='filter').bypass);
  assert.equal(await c.evaluate(n=>n.classList.contains('folded')),true,'power never unfolds rail');
  const changed=structuredClone(fx);changed.modules.find(m=>m.id==='filter').bypass=true;assert.deepEqual((await read()).tracks[0].fx,changed,'folded power changes bypass only');
  await c.getByRole('button',{name:'Unfold Filter',exact:true}).click();assert.deepEqual((await read()).tracks[0].fx,changed);
  await frame('rack-fx');
  await p.getByRole('tab',{name:'Sound',exact:true}).click();await p.getByRole('button',{name:'Settings',exact:true}).click();
  await p.getByRole('switch',{name:/Turn off sound card auto-fold/}).uncheck();await p.getByRole('dialog',{name:'Settings',exact:true}).getByRole('button',{name:/CLOSE/}).click();
  await p.waitForFunction(()=>{const n=document.querySelector('.sound-cards');return n.scrollWidth<=n.clientWidth+1;});
  const tone=await openCard('sound-tone'),k=await tone.getByRole('slider',{name:'Brightness',exact:true}).boundingBox();
  await p.mouse.move(k.x+k.width/2,k.y+k.height/2);await p.mouse.down();await p.evaluate(()=>document.querySelector('.sound-cards').style.width='800px');await p.waitForTimeout(180);
  assert.equal(await tone.evaluate(n=>n.classList.contains('folded')),false,'auto-fold protects the drag owner');await p.mouse.up();await p.evaluate(()=>document.querySelector('.sound-cards').style.width='');
  await frame('rack-sound');console.log('PASS rack: individual rails, stable order/values, power-only bypass, auto-fold and active owner protection');
 }
 assert.deepEqual(errors,[]);console.log('PASS ui patch '+phase);
})().catch(async e=>{console.error(e.stack||e);if(p){await frame('failure-'+phase);fs.writeFileSync(path.join(OUT,'failure-'+phase+'-layout.json'),JSON.stringify(await p.locator('.app-header>*').evaluateAll(nodes=>nodes.map(n=>({cls:n.className,text:n.textContent,rect:n.getBoundingClientRect().toJSON()}))),null,2));}process.exitCode=1;}).finally(async()=>{if(app)await app.close();fs.rmSync(tmp,{recursive:true,force:true});});
