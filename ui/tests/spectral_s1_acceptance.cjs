// Only S1's changed surface/IPC paths. Native worker; hardware MIDI disabled and temporary data.
'use strict';
const {_electron}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),OUT=path.resolve(ROOT,'../artifacts/recovery/spectral-s1');
const SCREENS=path.resolve(ROOT,'../decksynth/screens/spectral-s1'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spectral-s1-'));
let app,p;const errors=[];
const send=(cmd,args)=>p.evaluate(([c,a])=>window.deckApi.send(c,a),[cmd,args]);
const state=()=>p.evaluate(()=>window.__s1.state);
const wait=(fn,arg)=>p.waitForFunction(fn,arg);
async function capture(name){
 await p.mouse.move(2,2);await p.screenshot({path:path.join(SCREENS,name+'-1280x718.png')});
 if(process.env.DECKSYNTH_S1_SCREEN==='1'){
  const xid=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE(0));
  execFileSync('xdotool',['windowactivate','--sync',String(xid)],{timeout:5000});execFileSync('spectacle',['-b','-n','-f','-o',path.join(SCREENS,name+'-deck-1280x800.png')],{timeout:15000});
  assert.equal(Number(execFileSync('xdotool',['getactivewindow'],{encoding:'utf8'}).trim()),xid);
 }
}
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(SCREENS,{recursive:true});
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),args:['--ozone-platform=x11','electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:tmp,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 p=await app.firstWindow();p.setDefaultTimeout(6500);p.on('pageerror',e=>errors.push(e.message));
 await wait(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.maximize();w.focus();});await wait(()=>innerWidth===1280&&innerHeight===718&&document.hasFocus());
 await p.evaluate(()=>window.deckApi.onMessage(m=>{if(m.state)window.__s1=m;}));await wait(()=>window.__s1);
 await send('load',path.resolve(ROOT,'../tests/fixtures/spectral_s1_legacy.decksynth'));await wait(()=>window.__s1.state.tracks[3].notes.length===1);
 await p.getByRole('tab',{name:'Sound',exact:true}).click();
 const random=p.getByRole('button',{name:'RANDOM',exact:true});await random.waitFor();
 const before=await state();await random.click();await wait(()=>window.__s1.state.tracks[0].instrument.random_seed!==undefined);const first=(await state()).tracks[0].instrument;
 assert.equal(first.spectral_energy,1);assert.equal(first.harmonics.length,16);
 const copies=JSON.stringify((await state()).tracks.map(t=>t.notes)),song=JSON.stringify((await state()).song),perf=JSON.stringify((await state()).performance);
 for(let i=0;i<5;i++)await random.click();const expected=(first.random_seed+Math.imul(5,0x9e3779b9))>>>0;await wait(seed=>window.__s1.state.tracks[0].instrument.random_seed===seed,expected);
 const chosen=(await state()).tracks[0].instrument;assert.notDeepEqual(chosen.harmonics,first.harmonics);
 await send('undo');await wait(seed=>window.__s1.state.tracks[0].instrument.random_seed===seed,(expected-0x9e3779b9)>>>0);
 assert.equal(JSON.stringify((await state()).tracks.map(t=>t.notes)),copies);assert.equal(JSON.stringify((await state()).song),song);assert.equal(JSON.stringify((await state()).performance),perf);
 console.log('PASS S1: rapid Random taps, persisted uint32 seed, one committed shape Undo; notes/SONG/KeyStep intact');
 const card=p.locator('[data-panel="sound-character"]');if(await card.evaluate(n=>n.classList.contains('folded')))await card.getByRole('button',{name:/Unfold/}).click();await card.scrollIntoViewIfNeeded();
 const knob=card.getByRole('slider',{name:'Character',exact:true});await knob.focus();await p.keyboard.press('Enter');await card.getByLabel('Character numeric value').fill('.75');await p.keyboard.press('Enter');await wait(()=>window.__s1.state.tracks[0].instrument.character===.75);
 await send('midi',[0x90,60,100]);await wait(()=>window.__s1.voices>=1&&window.__s1.meter.peak>.001);
 await p.getByRole('button',{name:'Link Mod pad 2 to knobs'}).click();await card.locator('[data-param="0-character"] .knob-target').click();await wait(()=>window.__s1.state.tracks[0].fx?.mods[1].targets.some(t=>t.module==='sound'&&t.param==='character'));await p.locator('.pe-linking').getByRole('button',{name:'Done'}).click();await wait(()=>document.querySelector('[data-param="0-character"] .knob-mod circle'));
 assert.equal(await card.locator('.knob-mod circle').getAttribute('fill'),'#6cb6f0');
 const routed=(await state()).tracks[0].fx;routed.mods[1].shape='steps';routed.mods[1].steps=Array(16).fill(1);await send('fx',[0,routed]);await wait(()=>window.__s1.meter.fx_live.sound.character===1);await wait(()=>document.querySelectorAll('.bar-result')[1].style.bottom==='0%');
 await send('midi',[0x80,60,0]);await wait(()=>window.__s1.voices===0);
 const source=JSON.stringify((await state()).tracks[0].instrument);await send('parameter',['character',null,-.9,1]);await p.waitForTimeout(100);assert.equal(JSON.stringify((await state()).tracks[0].instrument),source,'foreign owner cannot write Character');
 const saved=path.join(tmp,'s1.decksynth');await send('save',saved);for(let i=0;i<30&&!fs.existsSync(saved);i++)await p.waitForTimeout(50);assert.ok(fs.existsSync(saved));
 const snapshot=JSON.parse(fs.readFileSync(saved,'utf8'));await random.click();await wait(seed=>window.__s1.state.tracks[0].instrument.random_seed!==seed,snapshot.tracks[0].instrument.random_seed);await send('load',saved);await wait(seed=>window.__s1.state.tracks[0].instrument.random_seed===seed,snapshot.tracks[0].instrument.random_seed);assert.deepEqual((await state()).tracks,snapshot.tracks);
 const preset=path.join(tmp,'s1.dspreset');await send('save_preset',preset);for(let i=0;i<30&&!fs.existsSync(preset);i++)await p.waitForTimeout(50);assert.ok(fs.existsSync(preset));const patch=JSON.parse(fs.readFileSync(preset,'utf8'));assert.deepEqual(patch,snapshot.tracks[0].instrument);await random.click();await wait(seed=>window.__s1.state.tracks[0].instrument.random_seed!==seed,patch.random_seed);await send('load_preset',preset);await wait(seed=>window.__s1.state.tracks[0].instrument.random_seed===seed,patch.random_seed);assert.deepEqual((await state()).tracks[0].instrument,patch);
 console.log('PASS S1: Character native PCM, source-colored modulation, note release, owner rejection and save/reopen');
 for(const n of await p.getByRole('group',{name:'Starting shape'}).getByRole('button').all()){const r=await n.boundingBox();assert.ok(r.width>=44&&r.height>=44&&r.x>=0&&r.x+r.width<=1280,'seed button accessible at718px');}
 for(const id of ['sound-tone','rack-envelope','motion-synth','rack-output','sound-filter','sound-unison']){const c=p.locator('[data-panel="'+id+'"]');if(!await c.evaluate(n=>n.classList.contains('folded')))await c.locator('.ds-panel-title').press('Enter');}
 if(await card.evaluate(n=>n.classList.contains('folded')))await card.getByRole('button',{name:/Unfold/}).click();await p.evaluate(()=>document.querySelector('.sound-cards').scrollLeft=0);
 if(await p.getByRole('button',{name:'Dismiss message'}).count())await p.getByRole('button',{name:'Dismiss message'}).click();
 for(const n of await card.locator('button,[role=slider]').all()){const r=await n.boundingBox();assert.ok(r.width>=43.9&&r.height>=43.9&&r.x>=0&&r.x+r.width<=1281&&r.y+r.height<=719,'Character card controls accessible');}
 await capture('random-character');
 assert.deepEqual(errors,[]);console.log('PASS S1: changed controls/geometry, real base/heard partials and no renderer exceptions');
})().catch(async e=>{console.error(e.stack||e);if(p)await p.screenshot({path:path.join(OUT,'failure-ui.png')});process.exitCode=1;}).finally(async()=>{if(app)await app.close();fs.rmSync(tmp,{recursive:true,force:true});});
