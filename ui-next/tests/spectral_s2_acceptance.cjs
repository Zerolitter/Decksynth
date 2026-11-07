// Changed S2 controls and native IPC only; isolated data/dummy audio, no hardware MIDI.
'use strict';
const {_electron}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),OUT=path.resolve(ROOT,'../artifacts/recovery/spectral-s2'),SCREENS=path.resolve(ROOT,'../decksynth/screens/spectral-s2');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'spectral-s2-'));let app,p;const errors=[];
const send=(cmd,args)=>p.evaluate(([c,a])=>window.deckApi.send(c,a),[cmd,args]);
const state=()=>p.evaluate(()=>window.__s2.state);
const wait=(fn,arg)=>p.waitForFunction(fn,arg);
async function edit(card,name,value){await card.getByRole('slider',{name,exact:true}).focus();await p.keyboard.press('Enter');await card.getByLabel(name+' numeric value').fill(String(value));await p.keyboard.press('Enter');}
async function fileReady(file){await p.waitForFunction(()=>true);for(let i=0;i<40&&!fs.existsSync(file);i++)await p.waitForTimeout(50);assert.ok(fs.existsSync(file));}
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(SCREENS,{recursive:true});
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),args:['--ozone-platform=x11','electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:tmp,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 p=await app.firstWindow();p.setDefaultTimeout(7000);p.on('pageerror',e=>errors.push(e.message));
 await wait(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.maximize();w.focus();});await wait(()=>innerWidth===1280&&innerHeight===718&&document.hasFocus());
 await p.evaluate(()=>window.deckApi.onMessage(m=>{if(m.state)window.__s2=m;}));await wait(()=>window.__s2);
 await send('load',path.resolve(ROOT,'../tests/fixtures/spectral_s1_legacy.decksynth'));await wait(()=>window.__s2.state.tracks[3].notes.length===1);
 const before=await state();await p.getByRole('tab',{name:'Sound',exact:true}).click();
 const card=p.locator('[data-panel="sound-filter"]');if(await card.evaluate(n=>n.classList.contains('folded')))await card.getByRole('button',{name:/Unfold/}).click();await card.scrollIntoViewIfNeeded();
 await card.getByRole('slider',{name:'Morph',exact:true}).waitFor();
 const initial=before.tracks[0].instrument;
 await edit(card,'Filter attack',.09);await wait(()=>window.__s2.state.tracks[0].instrument.fenv_a===.09);
 for(const [key,amp] of [['fenv_d','decay'],['fenv_s','sustain'],['fenv_r','release']])assert.equal((await state()).tracks[0].instrument[key],initial[amp],'first edit captures inherited envelope');
 await send('parameter',['attack',null,.75,0]);await wait(()=>window.__s2.state.tracks[0].instrument.attack===.75);assert.equal((await state()).tracks[0].instrument.fenv_a,.09);
 await card.getByRole('radio',{name:'Low-pass',exact:true}).click();await wait(()=>window.__s2.state.tracks[0].instrument.vcf_morph===0);
 await card.getByRole('radio',{name:'Band-pass',exact:true}).click();await wait(()=>window.__s2.state.tracks[0].instrument.vcf_morph===.5);
 await card.getByRole('radio',{name:'High-pass',exact:true}).click();await wait(()=>window.__s2.state.tracks[0].instrument.vcf_morph===1);
 await edit(card,'Morph',.37);await wait(()=>window.__s2.state.tracks[0].instrument.vcf_morph===.37);assert.equal(await card.getByRole('radio',{checked:true}).count(),0,'intermediate morph is not falsely an endpoint');
 await card.getByRole('button',{name:'Turn off filter',exact:true}).click();await wait(()=>window.__s2.state.tracks[0].instrument.vcf_type===0);await card.getByRole('button',{name:'Turn on filter',exact:true}).click();await wait(()=>window.__s2.state.tracks[0].instrument.vcf_type>0);assert.equal((await state()).tracks[0].instrument.vcf_morph,.37,'power preserves continuous morph');
 await edit(card,'Filter decay',.21);await edit(card,'Filter sustain',.48);await edit(card,'Filter release',.32);await wait(()=>window.__s2.state.tracks[0].instrument.fenv_r===.32);
 const old=(await state()).tracks[0].instrument.fenv_a;
 const h=await card.locator('[data-handle="a"] circle').last().boundingBox();await p.mouse.move(h.x+h.width/2,h.y+h.height/2);await p.mouse.down();await p.mouse.move(h.x+h.width/2+10,h.y+h.height/2,{steps:5});await p.mouse.up();await wait(v=>window.__s2.state.tracks[0].instrument.fenv_a!==v,old);
 assert.equal((await state()).tracks[0].instrument.attack,.75,'filter graph edits leave amp alone');assert.equal(await card.locator('.env-editor').count(),1);
 console.log('PASS S2: independent ADSR, inline graph and LP/BP/HP presets with continuous Morph');
 await p.getByRole('button',{name:'Link Mod pad 2 to knobs'}).click();await card.locator('[data-param="0-vcf-morph"] .knob-target').click();await wait(()=>window.__s2.state.tracks[0].fx?.mods[1].targets.some(t=>t.param==='vcf_morph'));await p.locator('.pe-linking').getByRole('button',{name:'Done'}).click();
 const chain=(await state()).tracks[0].fx;chain.mods[1].shape='steps';chain.mods[1].steps=Array(16).fill(1);await send('fx',[0,chain]);await send('midi',[0x90,60,100]);await wait(()=>window.__s2.voices>=1&&window.__s2.meter.peak>.001&&window.__s2.meter.fx_live.sound.vcf_morph===.57);
 await wait(()=>document.querySelector('[data-param="0-vcf-morph"] .knob-mod circle'));assert.equal(await card.locator('[data-param="0-vcf-morph"] .knob-mod circle').getAttribute('fill'),'#6cb6f0');
 await send('midi',[0x80,60,0]);await wait(()=>window.__s2.voices===0);
 const source=JSON.stringify((await state()).tracks[0].instrument);for(const key of ['fenv_a','vcf_morph'])await send('parameter',[key,null,.5,1]);await p.waitForTimeout(100);assert.equal(JSON.stringify((await state()).tracks[0].instrument),source,'wrong owner rejected');
 for(const key of ['fenv_a','vcf_morph'])await send('parameter',[key,null,'NaN',0]);await p.waitForTimeout(100);assert.equal(JSON.stringify((await state()).tracks[0].instrument),source,'nonfinite values rejected atomically');
 const saved=path.join(tmp,'s2.decksynth');await send('save',saved);await fileReady(saved);const snapshot=JSON.parse(fs.readFileSync(saved,'utf8'));
 await edit(card,'Morph',.1);await wait(()=>window.__s2.state.tracks[0].instrument.vcf_morph===.1);await send('load',saved);await wait(()=>window.__s2.state.tracks[0].instrument.vcf_morph===.37);assert.deepEqual((await state()).tracks,snapshot.tracks);
 const preset=path.join(tmp,'s2.dspreset');await send('save_preset',preset);await fileReady(preset);await edit(card,'Morph',.2);await wait(()=>window.__s2.state.tracks[0].instrument.vcf_morph===.2);await send('load_preset',preset);await wait(()=>window.__s2.state.tracks[0].instrument.vcf_morph===.37);assert.deepEqual((await state()).tracks[0].instrument,snapshot.tracks[0].instrument);
 const after=await state();assert.deepEqual(after.tracks.map(t=>t.notes),before.tracks.map(t=>t.notes));assert.deepEqual(after.tracks.slice(1),before.tracks.slice(1));assert.deepEqual(after.song,before.song);assert.deepEqual(after.performance,before.performance);
 console.log('PASS S2: native PCM, blue-source live modulation, release, owner/invalid rejection and project/preset recall; SONG/KeyStep/other tracks intact');
 for(const c of await p.locator('.sound-cards [data-panel]').all())if(await c.getAttribute('data-panel')!=='sound-filter'&&!await c.evaluate(n=>n.classList.contains('folded')))await c.locator('.ds-panel-title').press('Enter');
 if(await card.evaluate(n=>n.classList.contains('folded')))await card.getByRole('button',{name:/Unfold/}).click();await card.scrollIntoViewIfNeeded();
 if(await p.getByRole('button',{name:'Dismiss message'}).count())await p.getByRole('button',{name:'Dismiss message'}).click();
 const geometry=await card.locator('button,.knob-target,.knob-value,.env-handle').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {name:n.getAttribute('aria-label')||n.textContent,x:r.x,y:r.y,width:r.width,height:r.height,hit:n.contains(hit)};}));
 for(const r of geometry)assert.ok(r.width>=43.9&&r.height>=43.9&&r.x>=0&&r.x+r.width<=1281&&r.y+r.height<=719&&r.hit,JSON.stringify(r));
 fs.writeFileSync(path.join(OUT,'ui-geometry.json'),JSON.stringify({width:1280,height:718,controls:geometry},null,2));await p.mouse.move(2,2);await p.screenshot({path:path.join(SCREENS,'filter-adsr-morph-1280x718.png')});
 if(process.env.DECKSYNTH_S2_SCREEN==='1'){
  const xid=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE(0));execFileSync('xdotool',['windowactivate','--sync',String(xid)],{timeout:5000});execFileSync('spectacle',['-b','-n','-f','-o',path.join(SCREENS,'filter-adsr-morph-deck-1280x800.png')],{timeout:15000});assert.equal(Number(execFileSync('xdotool',['getactivewindow'],{encoding:'utf8'}).trim()),xid);
 }
 assert.deepEqual(errors,[]);console.log('PASS S2: all changed targets >=44px, complete card inside718px, no obscured controls or renderer exceptions');
})().catch(async e=>{console.error(e.stack||e);if(p){await p.screenshot({path:path.join(OUT,'failure-ui.png')});fs.writeFileSync(path.join(OUT,'failure-state.json'),JSON.stringify(await p.evaluate(()=>window.__s2),null,2));}process.exitCode=1;}).finally(async()=>{if(app)await app.close();fs.rmSync(tmp,{recursive:true,force:true});});
