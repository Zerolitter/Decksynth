// Native UI patch acceptance. Generated data/settings are isolated; no hardware MIDI/audio.
'use strict';
const {_electron}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const ROOT=path.resolve(__dirname,'..'),OUT=path.resolve(ROOT,'../artifacts/recovery/ui-top-rack');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-ui-patch-'));
const phase=process.env.DECKSYNTH_PATCH_PHASE||'all';let app,p;const errors=[];
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
 if(phase==='inspector'||phase==='all'){
  await send('select',0);await p.getByRole('tab',{name:'Sound',exact:true}).click();
  const opener=p.locator('.pad-editor').getByRole('button',{name:/Add target|Edit links/});await opener.click();
  const sheet=p.getByRole('dialog',{name:'Mod pad 1 editor',exact:true});let b=await sheet.boundingBox(),a=await p.locator('.pad-editor').boundingBox();
  assert.ok(b.width<=880&&b.height<=360,'compact inspector cap: '+JSON.stringify(b));assert.ok(b.y>=a.y+a.height&&b.x+b.width<=1280,'inspector stays near summary and within viewport');
  await sheet.locator('.mod-link-params').getByRole('button',{name:'Cutoff',exact:true}).click();await p.waitForFunction(()=>window.__patchLatest.state.tracks[0].fx?.mods[0].targets.some(t=>t.param==='vcf_cutoff'));
  const depth=sheet.getByRole('slider',{name:/Depth Sound Cutoff/});await depth.focus();await p.keyboard.press('Enter');await sheet.getByRole('textbox',{name:/Depth Sound Cutoff value/}).fill('25');await p.keyboard.press('Enter');await p.waitForFunction(()=>window.__patchLatest.state.tracks[0].fx.mods[0].targets.find(t=>t.param==='vcf_cutoff').depth===.25);
  await frame('inspector-one-link');await sheet.getByRole('button',{name:'Unlink Sound Cutoff',exact:true}).click();await p.waitForFunction(()=>window.__patchLatest.state.tracks[0].fx.mods[0].targets.length===0);
  await frame('inspector-empty');await p.keyboard.press('Escape');assert.equal(await sheet.count(),0);assert.equal(await opener.evaluate(n=>n===document.activeElement),true,'Escape restores the opener');
  await p.getByRole('button',{name:/^Shape of Mod pad 1/}).click();await sheet.getByRole('radio',{name:'Drawn',exact:true}).click();await sheet.locator('.pad-point').first().waitFor();assert.ok(await sheet.locator('.pad-point').count()>=2);await sheet.getByRole('radio',{name:'Steps',exact:true}).click();await sheet.getByRole('radiogroup',{name:'Step count',exact:true}).getByRole('radio',{name:'4',exact:true}).click();await p.waitForFunction(()=>window.__patchLatest.state.tracks[0].fx.mods[0].count===4);await frame('inspector-shape');await sheet.getByRole('button',{name:'Done',exact:true}).click();
  await opener.click();
  for(let count=1;count<=16;count++){await sheet.locator('.mod-link-params button:not([aria-pressed="true"])').first().click();await p.waitForFunction(n=>window.__patchLatest.state.tracks[0].fx.mods[0].targets.length===n,count);}
  assert.ok(await sheet.locator('.mod-link-params button:disabled').count()>0,'16-target limit');await frame('inspector-sixteen');
  const ownerBefore=(await read()).tracks;const firstDepth=sheet.getByRole('slider').first();await firstDepth.focus();await p.keyboard.press('Enter');await sheet.locator('.bipolar input').fill('-80');await send('select',1);await sheet.waitFor({state:'detached'});await p.waitForTimeout(180);assert.deepEqual((await read()).tracks[0].fx,ownerBefore[0].fx,'pending numeric gesture cancelled on owner change');assert.deepEqual((await read()).tracks[1].fx,ownerBefore[1].fx,'new owner never receives late edits');await send('select',0);
  console.log('PASS inspector: anchored cap, real route/depth/unlink, focus return, advanced shape/steps, 16 routes and stale owner cancellation');
 }
 if(phase==='envelope'||phase==='all'){
  await send('select',0);await p.getByRole('tab',{name:'Sound',exact:true}).click();const card=await openCard('rack-envelope');await card.getByRole('button',{name:'Open the envelope editor',exact:true}).click();
  const sheet=p.getByRole('dialog',{name:'Envelope',exact:true});const b=await sheet.boundingBox();assert.ok(b.width>1000&&b.height>360,'envelope keeps its useful focused surface');await assertInView(sheet.locator('button,[role=slider]'));
  for(const n of await sheet.locator('button,[role=slider]').all()){const r=await n.boundingBox();assert.ok(r.width>=43.9&&r.height>=43.9,'ADSR control target >=44px '+await n.getAttribute('aria-label')+' '+JSON.stringify(r));}
  const before=(await read()).tracks[0].instrument.attack;const h=await sheet.locator('[data-handle="a"]').boundingBox();await p.mouse.move(h.x+h.width/2,h.y+h.height/2);await p.mouse.down();await p.mouse.move(h.x+h.width/2+45,h.y+h.height/2,{steps:6});await p.mouse.up();await p.waitForFunction(v=>window.__patchLatest.state.tracks[0].instrument.attack!==v,before);
  const release=sheet.getByRole('slider',{name:'Release',exact:true});await release.focus();await p.keyboard.press('Enter');await sheet.getByLabel('Release numeric value').fill('1.25');await p.keyboard.press('Enter');await p.waitForFunction(()=>window.__patchLatest.state.tracks[0].instrument.release===1.25);await frame('focused-envelope');await p.keyboard.press('Escape');assert.equal(await sheet.count(),0);
  console.log('PASS envelope: separate useful graph/ADSR surface, native handle/readout agreement, exact release value and close');
 }
 if(phase==='graphs'||phase==='all'){
  await send('select',0);await p.getByRole('tab',{name:'FX',exact:true}).click();
  for(const name of ['Overdrive','Filter']){if(!await p.locator('[data-panel="fx-'+name.toLowerCase()+'"]').count()){await p.getByRole('button',{name:'Add effect',exact:true}).click();await p.getByRole('dialog',{name:'Add effect',exact:true}).getByRole('button',{name:'Add '+name,exact:true}).click();}}
  await p.getByRole('button',{name:'Focus Overdrive',exact:true}).click();const canvas=p.locator('.fx-graph-tile[data-module="overdrive"] canvas');await canvas.waitFor();
  assert.equal(await p.locator('.fx-graph-tile').count(),2,'focused module plus real output');assert.match(await canvas.getAttribute('aria-label'),/parameter preview/i);
  await p.waitForTimeout(180);const still=await canvas.evaluate(n=>n.toDataURL());await p.waitForTimeout(160);assert.ok(await canvas.evaluate(n=>n.toDataURL())===still,'silence has no invented moving signal');
  const c=await openCard('fx-overdrive');await c.getByRole('button',{name:'Turn off Overdrive',exact:true}).click();await p.waitForFunction(()=>window.__patchLatest.state.tracks[0].fx.modules.find(m=>m.id==='overdrive').bypass);await p.waitForFunction(()=>document.querySelector('.fx-graph-tile[data-module=overdrive] canvas')?.dataset.bypassed==='true');
  await frame('fx-focused-preview');console.log('PASS graphs: focused controls/preview, real bypass state, stationary silence, separate output');
 }
 assert.deepEqual(errors,[]);console.log('PASS ui patch '+phase);
})().catch(async e=>{console.error(e.stack||e);if(p){await frame('failure-'+phase);fs.writeFileSync(path.join(OUT,'failure-'+phase+'-layout.json'),JSON.stringify(await p.locator('.app-header>*').evaluateAll(nodes=>nodes.map(n=>({cls:n.className,text:n.textContent,rect:n.getBoundingClientRect().toJSON()}))),null,2));}process.exitCode=1;}).finally(async()=>{if(app)await app.close();fs.rmSync(tmp,{recursive:true,force:true});});
