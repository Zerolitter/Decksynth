// Grain workflow (Sir, 25 Nov). Real worker, dummy audio: Perform's To Grain bounces the synth track's loop onto a new
// Sampler track in Grain mode (no WAV export by hand), the Sampler keys have a Hold that keeps notes after they are
// let go, and Chop chops at once when it opens on a sample with no slices. Every new control is 44 px and uncovered.
'use strict';
require('./deck_guard.cjs');
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.OUT||path.resolve(ROOT,'../artifacts/grain-workflow');const H=Number(process.env.HEIGHT||718);
const DATA=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-grainflow-'));
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
 await p.evaluate(()=>{window.__msgs=[];window.deckApi.onMessage(m=>{if(m.state)window.__latest=m;if(m.samplers)window.__smp=m.samplers;if(m.message)window.__msgs.push(m.message);if(m.error)window.__msgs.push('ERROR '+m.error);});});
 await p.waitForFunction(()=>!!window.__latest);
 const send=(c,a)=>p.evaluate(([c,a])=>window.deckApi.send(c,a),[c,a]);
 const inside=async(loc,what)=>{const b=await loc.boundingBox();assert.ok(b&&b.width>=44&&b.height>=44,what+' is 44 px: '+JSON.stringify(b));
  assert.ok(b.y+b.height<=H+1&&b.x+b.width<=1281,what+' inside the window: '+JSON.stringify(b));
  const hit=await loc.evaluate(e=>{const r=e.getBoundingClientRect();const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!t&&(e===t||e.contains(t));});
  assert.ok(hit,what+' is not covered');};

 // Track 1: a synth with a short phrase in its clip.
 await send('select',0);
 for(const [start,note] of [[0,60],[1,64],[2,67],[3,72],[8,62],[10,65],[12,69]])await send('edit_note',[0,null,{start,duration:.9,note,velocity:100}]);
 await p.waitForFunction(()=>window.__latest.state.tracks[0].notes.length===7);
 await p.getByRole('tab',{name:/^Perform$/i}).click();
 const toGrain=p.getByRole('button',{name:'To Grain',exact:true});
 await inside(toGrain,'To Grain');
 await p.screenshot({path:path.join(OUT,'perform-to-grain-'+H+'.png')});
 await toGrain.click();
 await p.waitForFunction(()=>window.__latest.state.tracks.length===2&&window.__latest.state.tracks[1].device==='sampler',null,{timeout:60000});
 await p.waitForFunction(()=>window.__smp?.[1]?.status==='READY',null,{timeout:30000});
 const t=(await p.evaluate(()=>window.__latest)).state.tracks[1];
 assert.equal(t.sampler.mode,'grain');assert.equal(t.sampler.g_rhythm,'off');assert.match(t.name,/grains$/);
 assert.ok((await p.evaluate(()=>window.__msgs)).some(m=>/plays as Grain on track 2/.test(m)),'says where the grains went');

 // Sound: Hold beside the keys.
 await p.getByRole('tab',{name:/^Sound$/i}).click();
 await p.locator('.sampler-page').waitFor();
 const hold=p.locator('.sampler-page').getByRole('button',{name:'Hold',exact:true});
 await inside(hold,'Hold');await hold.click();
 await p.waitForFunction(()=>window.__smp?.[1]?.hold===true);
 assert.equal(await hold.getAttribute('aria-pressed'),'true');
 await p.screenshot({path:path.join(OUT,'grain-hold-'+H+'.png')});
 await hold.click();await p.waitForFunction(()=>window.__smp?.[1]?.hold===false);

 // Chop chops at once.
 const chop=p.locator('.smp-tools').getByRole('radio',{name:'Chop',exact:true});
 assert.equal(t.sampler.slices.length,0);
 await chop.click();
 await p.waitForFunction(()=>window.__latest.state.tracks[1].sampler.slices.length>0,null,{timeout:20000});
 await p.screenshot({path:path.join(OUT,'chop-at-once-'+H+'.png')});
 assert.deepEqual(errors,[]);
 console.log('PASS grain workflow at '+H+': To Grain, Hold, Chop at once ('+(await p.evaluate(()=>window.__latest.state.tracks[1].sampler.slices.length))+' slices)');
})().catch(async e=>{console.error(e.stack||e);if(page)await page.screenshot({path:path.join(OUT,'failure-'+H+'.png')}).catch(()=>{});process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});});
