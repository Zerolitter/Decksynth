// Direct rack edits against the native worker; temporary user data and dummy audio only.
'use strict';
require('./deck_guard.cjs');
const {_electron}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const ROOT=path.resolve(__dirname,'..'),OUT=path.resolve(ROOT,'../artifacts/recovery/rack-direct');
const phase=process.env.DECKSYNTH_DIRECT_PHASE||'all',tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rack-direct-'));
let app,p;const errors=[];
const send=(cmd,args)=>p.evaluate(([c,a])=>window.deckApi.send(c,a),[cmd,args]);
const state=()=>p.evaluate(()=>window.__direct.state);
const order=()=>p.locator('.fx-cards [data-panel]').evaluateAll(ns=>ns.map(n=>n.dataset.panel));
const nativeOrder=()=>p.evaluate(()=>window.__direct.state.tracks[0].fx.modules.filter(m=>m.on).map(m=>'fx-'+m.id));
async function open(id){const c=p.locator('[data-panel="'+id+'"]');if(await c.evaluate(n=>n.classList.contains('folded')))await c.getByRole('button',{name:/^Unfold /}).click();await c.locator(':scope > .ds-panel-body').waitFor();return c;}
async function shot(name){await p.mouse.move(2,2);await p.screenshot({path:path.join(OUT,name+'-1280x718.png')});}
async function add(name){const count=(await state()).tracks[0].fx?.modules.filter(m=>m.on).length||0;await p.getByRole('button',{name:'Add effect',exact:true}).click();await p.getByRole('dialog',{name:'Add effect'}).getByRole('button',{name:'Add '+name,exact:true}).click();await p.waitForFunction(n=>window.__direct.state.tracks[0].fx?.modules.filter(m=>m.on).length===n,count+1);}
async function noAutoFold(){await p.getByRole('button',{name:'Settings',exact:true}).click();await p.getByRole('tab',{name:'Display',exact:true}).click();await p.getByRole('switch',{name:/Cards fold by themselves/}).uncheck();await p.getByRole('dialog',{name:'Settings'}).getByRole('button',{name:/CLOSE/}).click();}
async function dragCard(id,target,{cancel,owner}={}){
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].focus());await p.waitForFunction(()=>document.hasFocus());
 const c=await open(id),t=p.locator('[data-panel="'+target+'"]');await c.scrollIntoViewIfNeeded();
 const h=await c.locator('.ds-panel-title').boundingBox(),r=await t.boundingBox();
 await p.mouse.move(h.x+h.width/2,h.y+h.height/2);await p.mouse.down();await p.mouse.move(r.x+r.width-4,r.y+22,{steps:10});
 if(process.env.DECKSYNTH_DRAG_TRACE)console.log('DRAG',await p.locator('.fx-cards [data-panel]').evaluateAll(ns=>ns.map(n=>({id:n.dataset.panel,dragging:n.dataset.rackDragging,drop:n.dataset.dropSide,rect:n.getBoundingClientRect().toJSON()}))));
 if(cancel==='blur')await p.evaluate(()=>dispatchEvent(new Event('blur')));else if(cancel)await p.keyboard.press('Escape');if(owner!==undefined){await send('select',owner);await p.waitForFunction(v=>window.__direct.selected===v,owner);}
 await p.mouse.up();
}
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),args:['--ozone-platform=x11','electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:tmp,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 p=await app.firstWindow();p.setDefaultTimeout(6000);p.on('pageerror',e=>errors.push(e.message));
 await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].maximize());await p.waitForFunction(()=>innerWidth===1280&&innerHeight===718);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].focus());await p.waitForFunction(()=>document.hasFocus());
 await p.evaluate(()=>window.deckApi.onMessage(m=>{if(m.state)window.__direct=m;}));await p.waitForFunction(()=>window.__direct);
 assert.equal(await p.evaluate(()=>window.__direct.audio),'dummy');await noAutoFold();
 await p.getByRole('tab',{name:'FX',exact:true}).click();for(const n of ['Filter','Overdrive','Delay'])await add(n);
 if(phase==='space'||phase==='all'){
  assert.equal(await p.locator('.fx-graph-strip,.fx-output-tile,.fx-focus-pick').count(),0,'no wide FX graph, duplicate output or focus selector');
  assert.equal(await p.locator('.fx-cards').count(),1);assert.equal(await p.getByRole('button',{name:/^Move .* (earlier|later)$/}).count(),0,'drag replaces reorder arrows');
  assert.equal(await p.locator('.rack-card .ds-panel-fold').count(),0,'rack title owns folding without a chevron');
  const f=await open('fx-filter'),r=await f.boundingBox(),body=await f.locator('.rack-card-body').boundingBox();assert.ok(r.width<=body.width+22,'card wraps its controls');
  await shot('fx-direct');await p.locator('.morph-pad').waitFor();assert.equal(await p.locator('.frame-fx [role=tablist]').count(),0,'no FX view toggle');
  const morph=p.locator('.morph-pad'),mr=await morph.boundingBox();assert.ok(mr.width>=140&&mr.height>=140,'Morph pad retains a usable canvas');assert.ok(await morph.evaluate(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.left+40,r.top+12));}),'Morph controls cannot cover the pad');await morph.click({position:{x:40,y:12}});await p.waitForFunction(()=>window.__direct.state.tracks[0].fx.macros[1].value>.8);
  await p.getByRole('tab',{name:'Song',exact:true}).click();assert.equal(await p.locator('.audio-scope').count(),1,'SONG keeps its real output monitor');await p.getByRole('tab',{name:'FX',exact:true}).click();console.log('PASS space: no duplicate graphs/output/header controls; existing Morph and SONG monitor preserved');
 }
 if(phase==='order'||phase==='all'){
  assert.equal(await p.getByRole('button',{name:/^Move .* (earlier|later)$/}).count(),0,'no order arrows');
  const before=await nativeOrder(),project=await state();
  await dragCard('fx-filter','fx-delay');await p.waitForFunction(()=>window.__direct.state.tracks[0].fx.modules.filter(m=>m.on).at(-1).id==='filter');
  assert.deepEqual(await order(),['fx-overdrive','fx-delay','fx-filter']);
  const changed=await state();assert.deepEqual(changed.tracks[0].instrument,project.tracks[0].instrument);assert.deepEqual(changed.song,project.song);assert.deepEqual(changed.performance,project.performance);
  await send('undo');await p.waitForFunction(ids=>JSON.stringify(window.__direct.state.tracks[0].fx.modules.filter(m=>m.on).map(m=>'fx-'+m.id))===JSON.stringify(ids),before);assert.deepEqual(await order(),before,'one Undo restores the entire drag');
  await dragCard('fx-filter','fx-delay',{cancel:true});assert.deepEqual(await nativeOrder(),before,'Escape cancels reorder');
  await dragCard('fx-filter','fx-delay',{cancel:'blur'});assert.deepEqual(await nativeOrder(),before,'blur cancels reorder');
  await dragCard('fx-filter','fx-delay',{owner:1});assert.deepEqual((await state()).tracks[0].fx,project.tracks[0].fx,'track change cancels pending drag');assert.equal((await state()).tracks[1].fx,undefined);await send('select',0);await p.waitForFunction(()=>window.__direct.selected===0);
  const c=await open('fx-filter');await c.locator('.ds-panel-title').focus();await p.keyboard.press('Control+ArrowRight');await p.waitForFunction(()=>window.__direct.state.tracks[0].fx.modules.filter(m=>m.on)[1].id==='filter');await send('undo');await p.waitForFunction(ids=>JSON.stringify(window.__direct.state.tracks[0].fx.modules.filter(m=>m.on).map(m=>'fx-'+m.id))===JSON.stringify(ids),before);
  await c.locator('.ds-panel-title').dblclick();await c.getByRole('button',{name:'Unfold Filter'}).waitFor();const rail=await c.boundingBox();assert.equal(Math.round(rail.width),48);await c.getByRole('button',{name:'Unfold Filter'}).focus();const playing=await p.evaluate(()=>window.__direct.playing);await p.keyboard.press('Space');assert.equal(await p.evaluate(()=>window.__direct.playing),playing);
  await p.getByRole('tab',{name:'Sound',exact:true}).click();const initial=await p.locator('.sound-cards [data-panel]').evaluateAll(ns=>ns.map(n=>n.dataset.panel));const params=(await state()).tracks[0].instrument;await dragCard('sound-tone','rack-envelope');assert.deepEqual((await state()).tracks[0].instrument,params,'SOUND drag changes layout only');assert.notDeepEqual(await p.locator('.sound-cards [data-panel]').evaluateAll(ns=>ns.map(n=>n.dataset.panel)),initial);await p.getByRole('tab',{name:'FX',exact:true}).click();await p.getByRole('tab',{name:'Sound',exact:true}).click();assert.equal(await p.locator('.sound-cards [data-panel]').first().getAttribute('data-panel'),'rack-envelope','SOUND layout survives remount');
  console.log('PASS order: native drag/one Undo, Escape, owner cancellation, keyboard, folding and remembered SOUND layout');
 }
 if(phase==='envelope'||phase==='all'){
  await p.getByRole('tab',{name:'Sound',exact:true}).click();const c=await open('rack-envelope');await c.scrollIntoViewIfNeeded();assert.equal(await c.locator('.env-editor').count(),1,'editable envelope lives inside its card');assert.equal(await p.getByRole('button',{name:'Open the envelope editor'}).count(),0,'no giant envelope sheet affordance');
  const old=(await state()).tracks[0].instrument.attack;let h=await c.locator('[data-handle="a"] circle').last().boundingBox();await p.mouse.move(h.x+h.width/2,h.y+h.height/2);await p.mouse.down();await p.mouse.move(h.x+h.width/2+15,h.y+h.height/2,{steps:6});await p.mouse.up();await p.waitForFunction(v=>window.__direct.state.tracks[0].instrument.attack!==v,old);
  const rel=c.getByRole('slider',{name:'Release',exact:true});await rel.focus();await p.keyboard.press('Enter');await c.getByLabel('Release numeric value').fill('1.25');await p.keyboard.press('Enter');await p.waitForFunction(()=>window.__direct.state.tracks[0].instrument.release===1.25);assert.equal(await p.getByRole('dialog',{name:'Envelope',exact:true}).count(),0);await shot('envelope-inline');console.log('PASS envelope: compact direct handle edits and exact adjacent ADSR values');
 }
 if(phase==='colors'||phase==='all'){
  await p.getByRole('tab',{name:'FX',exact:true}).click();await open('fx-filter');let chain=(await state()).tracks[0].fx;chain.mods[0].targets=[{module:'filter',param:'cutoff',depth:.4}];chain.mods[1].targets=[{module:'filter',param:'cutoff',depth:.4}];chain.macros[0].targets=[{module:'filter',param:'cutoff',depth:.5}];await send('fx',[0,chain]);await p.waitForFunction(()=>window.__direct.state.tracks[0].fx.mods[1].targets.length===1);
  await p.getByRole('button',{name:'Link Mod pad 2 to knobs',exact:true}).click();
  const knob=p.locator('[data-param="0-fx-filter-cutoff"]');await p.waitForFunction(()=>document.querySelector('[data-param="0-fx-filter-cutoff"] .knob-mod circle'));
  assert.equal(await knob.locator('.knob-mod circle').getAttribute('fill'),'#6cb6f0','armed blue source owns the ring even with earlier macro/green routes');
  const badge=p.locator('[data-panel="fx-filter"] .ds-panel-mods');assert.ok(await badge.locator('[data-source-color="#6cb6f0"]').count(),'badge identifies actual blue route');
  await p.locator('.pe-linking').getByRole('button',{name:'Done'}).click();assert.equal(await knob.locator('.knob-mod circle').getAttribute('fill'),'#6cb6f0','selected blue source remains the ring color after linking');
  const blue=p.getByRole('button',{name:'Link Mod pad 2 to knobs'});assert.equal(await blue.evaluate(n=>getComputedStyle(n).color),'rgb(108, 182, 240)');const red=p.getByRole('button',{name:'Link Mod pad 8 to knobs'});assert.equal(await red.evaluate(n=>getComputedStyle(n).color),'rgb(242, 124, 124)','unselected unlinked source retains its color');await shot('blue-source');console.log('PASS colors: selected source ring, real source badges and stable default pad colors');
 }
 if(phase==='review-keyboard'||phase==='all'){
  await p.getByRole('tab',{name:'FX',exact:true}).click();const c=await open('fx-filter');await c.locator('.ds-panel-title').press('Enter');
  await dragCard('fx-overdrive','fx-delay');
  await c.getByRole('button',{name:'Unfold Filter',exact:true}).focus();await p.keyboard.press('Enter');await c.locator('.ds-panel-body').waitFor();
  await c.locator('.ds-panel-title').press('Enter');await c.getByRole('button',{name:'Unfold Filter',exact:true}).focus();await p.keyboard.press('Space');await c.locator('.ds-panel-body').waitFor();
  await c.locator('.ds-panel-title').press('Enter');
  const h=await c.getByRole('button',{name:'Unfold Filter',exact:true}).boundingBox(),t=await p.locator('[data-panel="fx-overdrive"]').boundingBox();await p.mouse.move(h.x+h.width/2,h.y+24);await p.mouse.down();await p.mouse.move(t.x+t.width-4,t.y+22,{steps:12});await p.mouse.up();await p.waitForFunction(()=>window.__direct.state.tracks[0].fx.modules.filter(m=>m.on).at(-1).id==='filter');assert.equal(await c.evaluate(n=>n.classList.contains('folded')),true,'dragging a folded rail never opens it');
  console.log('PASS review keyboard: Enter/Space unfold after a drag; folded rail drag preserves fold and power');
 }
 if(phase==='review-envelope'||phase==='all'){
  await p.getByRole('tab',{name:'Sound',exact:true}).click();for(const [key,value] of [['attack',.06],['decay',.06],['sustain',.8]])await send('parameter',[key,null,value]);await p.waitForFunction(()=>window.__direct.state.tracks[0].instrument.sustain===.8);
  const c=await open('rack-envelope');await c.scrollIntoViewIfNeeded();const h=await c.locator('[data-handle="a"] circle').last().boundingBox();await p.mouse.move(h.x+h.width/2,h.y+h.height/2);await p.mouse.down();await p.mouse.move(h.x+h.width/2+8,h.y+h.height/2,{steps:5});await p.mouse.up();await p.waitForFunction(()=>window.__direct.state.tracks[0].instrument.attack!==.06||window.__direct.state.tracks[0].instrument.decay!==.06);const v=(await state()).tracks[0].instrument;assert.notEqual(v.attack,.06,'touching the visible Attack dot edits Attack even when Decay hit area overlaps');assert.equal(v.decay,.06,'nearby Decay is not edited');console.log('PASS review envelope: nearest visible handle owns dense compact edits');
 }
 if(phase==='topology'||phase==='all'){
  await p.getByRole('tab',{name:'FX',exact:true}).click();assert.equal(await p.locator('.frame-fx [role=tablist]').count(),0,'Morph and cards are simultaneous without view tabs');await p.locator('.frame-fx .morph-pad').waitFor();assert.equal(await p.locator('.frame-fx>.fx-cards').count(),1,'cards occupy the bottom frame row');const band=await p.locator('.mod-band').boundingBox(),middle=await p.locator('.frame-fx .frame-window').boundingBox(),rack=await p.locator('.fx-cards').boundingBox();assert.ok(middle.y>=band.y+band.height&&middle.y+middle.height<=rack.y&&rack.y+rack.height<=719,'fixed middle and bottom geometry');const tags=p.getByRole('group',{name:'FX card tags'});assert.equal(await tags.getByRole('button').count(),3);await tags.getByRole('button',{name:'Show Filter card',exact:true}).click();await p.locator('[data-panel="fx-filter"] .ds-panel-body').waitFor();console.log('PASS topology: permanent Morph middle, bottom cards and existing-header title tags');
 }
 if(phase==='card-fit'||phase==='all'){
  await p.getByRole('tab',{name:'Sound',exact:true}).click();const c=await open('rack-envelope');await c.scrollIntoViewIfNeeded();const r=await c.boundingBox();for(const n of await c.locator('.knob-target,.knob-value').all()){const b=await n.boundingBox();assert.ok(b.x>=r.x&&b.x+b.width<=r.x+r.width&&b.y+b.height<=r.y+r.height,'every ADSR control fits inside its own card: '+JSON.stringify({card:r,control:b}));}console.log('PASS card fit: complete ADSR graph/knobs without Release clipping');
 }
 assert.deepEqual(errors,[]);console.log('PASS direct rack '+phase);
})().catch(async e=>{console.error(e.stack||e);if(p)await shot('failure-'+phase);process.exitCode=1;}).finally(async()=>{if(app)await app.close();fs.rmSync(tmp,{recursive:true,force:true});});
