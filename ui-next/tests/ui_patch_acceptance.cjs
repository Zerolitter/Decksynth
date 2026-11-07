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
 assert.deepEqual(errors,[]);console.log('PASS ui patch '+phase);
})().catch(async e=>{console.error(e.stack||e);if(p){await frame('failure-'+phase);fs.writeFileSync(path.join(OUT,'failure-'+phase+'-layout.json'),JSON.stringify(await p.locator('.app-header>*').evaluateAll(nodes=>nodes.map(n=>({cls:n.className,text:n.textContent,rect:n.getBoundingClientRect().toJSON()}))),null,2));}process.exitCode=1;}).finally(async()=>{if(app)await app.close();fs.rmSync(tmp,{recursive:true,force:true});});
