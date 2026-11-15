// Freeze track to audio (15 Nov). Real worker, dummy audio: freeze a Song track, the frozen look,
// out of date after a note edit, Refreeze / Unfreeze, undo, and the Clip notes view button.
'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.OUT||path.resolve(ROOT,'../artifacts/freeze');const H=Number(process.env.HEIGHT||718);
const DATA=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-freeze-'));
let app;
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const project=path.join(DATA,'ambiance.decksynth');fs.copyFileSync(path.join(__dirname,'fixtures-freeze-ambiance.decksynth'),project);
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:DATA,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 const p=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,h);},H);
 await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 await p.evaluate(()=>{window.__msgs=[];window.deckApi.onMessage(m=>{if(m.state)window.__latest=m;if(m.message)window.__msgs.push(m.message);if(m.error)window.__msgs.push('ERROR '+m.error);});});
 await p.waitForFunction(()=>!!window.__latest);
 const latest=()=>p.evaluate(()=>window.__latest);
 const send=(c,a)=>p.evaluate(([c,a])=>window.deckApi.send(c,a),[c,a]);
 const inside=async(loc,what)=>{const b=await loc.boundingBox();assert.ok(b&&b.width>=44&&b.height>=44,what+' is 44 px: '+JSON.stringify(b));
  assert.ok(b.y+b.height<=H+1&&b.x+b.width<=1281,what+' inside the window');
  const hit=await loc.evaluate(e=>{const r=e.getBoundingClientRect();const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!t&&(e===t||e.contains(t));});
  assert.ok(hit,what+' is not covered');};
 const state=tr=>p.evaluate(tr=>window.__latest.freeze?.[tr]?.state,tr);

 await send('load',project);
 await p.waitForFunction(()=>window.__latest.state.song?.on&&window.__latest.state.tracks[1].preset==='Drawbar Organ');
 await p.getByRole('tab',{name:/^Song$/i}).click();
 await p.getByRole('radio',{name:/Timeline/}).click();
 for(const name of ['Warm Keys','Drawbar Organ','Atmospheric Pad','Bell'])await inside(p.getByRole('button',{name:'Freeze '+name}),'Freeze '+name);
 assert.equal(await state(1),'none');

 // Freeze track 2: progress while it renders, then the frozen lane.
 await p.getByRole('button',{name:'Freeze Drawbar Organ'}).click();
 await p.waitForFunction(()=>window.__latest.freeze?.[1]?.state==='rendering');
 await p.waitForFunction(()=>(window.__latest.freeze?.[1]?.progress??0)>0.05,null,{timeout:60000});
 await p.screenshot({path:path.join(OUT,'freezing-'+H+'.png')});
 await inside(p.getByRole('button',{name:'Cancel freezing Drawbar Organ'}),'Cancel freezing');
 await p.waitForFunction(()=>window.__latest.freeze?.[1]?.state==='frozen',null,{timeout:400000});
 const meta=(await latest()).state.tracks[1].freeze;
 assert.equal(meta.mode,'song');assert.ok(fs.existsSync(meta.file),'frozen WAV exists');
 assert.equal(meta.peaks.length,96);
 assert.ok(meta.file.startsWith(DATA),'frozen audio in the data folder');
 await p.locator('.freeze-overlay.is-frozen').first().waitFor();
 await inside(p.getByRole('button',{name:'Unfreeze Drawbar Organ'}),'Unfreeze button');
 await p.screenshot({path:path.join(OUT,'frozen-'+H+'.png')});

 // Fader and mute stay live: still frozen.
 await send('track',[1,'volume',0.5]);await send('track',[1,'mute',true]);await send('track',[1,'mute',false]);
 await p.waitForTimeout(700);assert.equal(await state(1),'frozen','volume and mute keep the freeze');

 // Play: the frozen track's synth stays quiet (no voices from its notes) while the song runs.
 await send('track',[0,'mute',true]);  // tracks 3 and 4 are empty: only the frozen track plays
 await send('play');await p.waitForTimeout(1500);
 const v=(await latest()).voices;await send('stop');await send('track',[0,'mute',false]);
 assert.equal(v,0,'a frozen track plays no synth voices: '+v);

 // A note edit makes it out of date: it plays live, with Refreeze and Unfreeze in the lane.
 await send('edit_note',[1,0,null]);
 await p.waitForFunction(()=>window.__latest.freeze?.[1]?.state==='stale');
 await inside(p.getByRole('button',{name:'Refreeze',exact:true}),'Refreeze in lane');
 await inside(p.getByRole('button',{name:'Unfreeze',exact:true}),'Unfreeze in lane');
 await inside(p.getByRole('button',{name:'Refreeze Drawbar Organ'}),'Refreeze in head');
 await p.screenshot({path:path.join(OUT,'stale-'+H+'.png')});
 await send('undo');  // the note is back: the same audio matches again
 await p.waitForFunction(()=>window.__latest.freeze?.[1]?.state==='frozen');

 // Unfreeze, then undo brings the freeze back.
 await p.getByRole('button',{name:'Unfreeze Drawbar Organ'}).click();
 await p.waitForFunction(()=>window.__latest.freeze?.[1]?.state==='none'&&!window.__latest.state.tracks[1].freeze);
 await send('undo');
 await p.waitForFunction(()=>window.__latest.freeze?.[1]?.state==='frozen');

 // Refreeze of an unchanged track reuses the file at once.
 await p.getByRole('button',{name:'Unfreeze Drawbar Organ'}).click();
 await p.waitForFunction(()=>window.__latest.freeze?.[1]?.state==='none');
 await p.getByRole('button',{name:'Freeze Drawbar Organ'}).click();
 await p.waitForFunction(()=>window.__latest.freeze?.[1]?.state==='frozen',null,{timeout:3000});

 // Clip notes view has the same button; Clip loop mode shows the freeze is for Song mode.
 await p.getByRole('radio',{name:/Clip notes/}).click();
 await inside(p.getByRole('button',{name:'Unfreeze Drawbar Organ'}),'Unfreeze in Clip notes');
 await p.getByRole('radio',{name:'Clip loop'}).click();
 await p.waitForFunction(()=>!window.__latest.state.song.on);
 await p.getByText('Frozen for Song mode · plays live here').waitFor();
 await p.screenshot({path:path.join(OUT,'clip-notes-loop-'+H+'.png')});
 await p.getByRole('radio',{name:'Song',exact:true}).click();
 await p.waitForFunction(()=>window.__latest.state.song.on&&window.__latest.freeze?.[1]?.state==='frozen');

 // Save and reopen keeps the freeze.
 const saved=path.join(DATA,'saved.decksynth');await send('save',saved);
 await p.waitForFunction(()=>window.__msgs.some(m=>m.startsWith('Saved')));
 await send('load',project);await p.waitForFunction(()=>window.__latest.freeze?.[1]?.state==='none');
 await send('load',saved);await p.waitForFunction(()=>window.__latest.freeze?.[1]?.state==='frozen');

 // Escape and a blank tap don't leave anything open: no mode to exit here.
 assert.deepEqual(errors,[],'no page errors');
 const bad=(await p.evaluate(()=>window.__msgs)).filter(m=>m.startsWith('ERROR'));
 assert.deepEqual(bad,[],'no engine errors');
 console.log('freeze acceptance passed at 1280x'+H);
 await app.close();
})().catch(async e=>{console.error(e);try{console.error('messages',await app.windows()[0].evaluate(()=>window.__msgs));}catch{}try{await app?.close();}catch{}process.exit(1);});
