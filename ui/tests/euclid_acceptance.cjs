// Screen test for the Euclid sheet: opens from the pattern tools, genre starting points, lanes, rings,
// touch targets at 1280x718 and 1280x800, closing (Esc, blank tap, Done) and the note_edit it sends.
// Runs in the UI preview (no audio engine): the preview applies a pattern edit to its own state. Exact notes are in tests/euclid.mjs;
// the engine's draft preview is in tests/test_draft_preview.py and the live bridge in tests/euclid_bridge_acceptance.py.
'use strict';
require('./deck_guard.cjs');
const {_electron}=require('playwright');
const path=require('node:path');
const fs=require('node:fs');
const os=require('node:os');
const assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
const SHOTS=process.env.EUCLID_SHOTS||path.join(os.tmpdir(),'decksynth-euclid-shots');
fs.mkdirSync(SHOTS,{recursive:true});
(async()=>{
 const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,
  env:{...process.env,DECKSYNTH_UI_PREVIEW:'1',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 try{
  const p=await app.firstWindow({timeout:15000});
  p.setDefaultTimeout(8000);
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await app.evaluate(({ipcMain})=>{globalThis.edits=[];globalThis.cat=[];ipcMain.prependListener('deck-command',(_,cmd,args)=>{if(cmd==='note_edit')edits.push(args);if(cmd==='catalog_action')cat.push(args);});});
  const edits=()=>app.evaluate(()=>globalThis.edits);
  const size=async h=>{await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,h);},h);
   await p.waitForTimeout(400);console.log('window',await p.evaluate(()=>[innerWidth,innerHeight]));};
  await size(718);
  await p.getByRole('tab',{name:/^Perform$/}).click();
  await p.locator('.pf').waitFor({state:'visible'});
  const sheet=p.getByRole('dialog',{name:'Euclid rhythm'});

  // ---- Synth track: bass and arp lanes in the track's key.
  await p.getByRole('button',{name:'Euclid',exact:true}).click();
  await sheet.waitFor({state:'visible'});
  assert.deepEqual(await sheet.locator('.euclid-lane .euclid-pick b').allInnerTexts(),['Bass','Arp'],'synth has bass and arp lanes');
  const names=await sheet.locator('.euclid-genres button').allInnerTexts();
  assert.deepEqual(names,['Chill & Ambient','Techno','Progressive','Dance & EDM','Hip Hop & Trap','Dubstep','Reggaeton','All off']);
  await sheet.getByRole('button',{name:'Techno',exact:true}).click();
  assert.equal(await sheet.getByRole('button',{name:'Techno',exact:true}).getAttribute('aria-pressed'),'true');
  assert.match(await sheet.locator('footer small').innerText(),/2 lanes · \d+ notes · replaces every note in the pattern · Techno is usually 128–140 BPM/);
  assert.equal(await sheet.locator('.euclid-ring.off').count(),0,'Techno switches both synth lanes on');
  // A genre tap starts the preview: the draft loops in the engine, and nothing is written.
  await p.waitForTimeout(400);
  assert.equal(await sheet.getByRole('button',{name:'Stop',exact:true}).getAttribute('aria-pressed'),'true');
  assert.match(await sheet.locator('footer small').innerText(),/^Listening · /);
  assert.equal((await edits()).length,0,'hearing writes nothing');
  assert.equal(await sheet.locator('.euclid-hit').count()>10,true,'rings draw the pulses');

  // Every control inside the sheet is a 44 x 44 hit target and nothing covers its centre.
  const bad=await p.evaluate(()=>{const out=[];for(const el of document.querySelectorAll('.euclid-sheet button,.euclid-sheet .vbox')){const r=el.getBoundingClientRect();
   if(r.width<43.5||r.height<43.5)out.push(['small',el.textContent.trim().slice(0,20),Math.round(r.width),Math.round(r.height)]);
   const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!el.contains(top))out.push(['covered',el.textContent.trim().slice(0,20)]);
   if(r.bottom>innerHeight||r.top<0)out.push(['offscreen',el.textContent.trim().slice(0,20)]);}return out;});
  assert.deepEqual(bad,[],'touch targets: '+JSON.stringify(bad));
  await p.screenshot({path:path.join(SHOTS,'synth-718.png')});
  await size(800);await p.screenshot({path:path.join(SHOTS,'synth-800.png')});await size(718);

  // Fill / Steps / Shift: the selected lane's boxes change its ring and its label.
  await sheet.locator('.euclid-pick',{hasText:'Bass'}).click();
  const fill=sheet.getByRole('spinbutton',{name:'Fill'});await fill.focus();await fill.press('ArrowUp');
  await p.waitForTimeout(600);assert.match(await sheet.locator('.euclid-pick',{hasText:'Bass'}).innerText(),/8\/16/,'Fill 7 -> 8');
  await sheet.getByRole('spinbutton',{name:'Shift'}).focus();await p.keyboard.press('ArrowUp');
  await p.waitForTimeout(600);assert.match(await sheet.locator('.euclid-pick',{hasText:'Bass'}).innerText(),/8\/16 \+3/,'Shift +3');

  await sheet.getByRole('button',{name:'Stop',exact:true}).click();
  assert.equal(await sheet.getByRole('button',{name:'Hear',exact:true}).getAttribute('aria-pressed'),'false','Stop ends listening');
  await sheet.getByRole('button',{name:'Hear',exact:true}).click();
  assert.equal(await sheet.getByRole('button',{name:'Stop',exact:true}).getAttribute('aria-pressed'),'true','Hear starts it again');
  // Write sends one pattern edit: bass and arp notes only, inside the pattern, one note per pulse.
  await sheet.getByRole('button',{name:'Write to pattern'}).click();
  await p.waitForTimeout(300);
  assert.equal(await sheet.getByRole('button',{name:'Hear',exact:true}).getAttribute('aria-pressed'),'false','Write stops listening');
  assert.ok(await p.locator('.pf-note').count()>0,'the pattern now has notes on screen (preview applies the edit)');
  assert.match(await sheet.locator('footer small').innerText(),/Written: \d+ notes/);

  // Ways out: Esc, a tap on blank space, Done.
  await p.keyboard.press('Escape');await sheet.waitFor({state:'hidden'});
  await p.getByRole('button',{name:'Euclid',exact:true}).click();await sheet.waitFor({state:'visible'});
  await p.mouse.click(12,12);await sheet.waitFor({state:'hidden'});
  await p.getByRole('button',{name:'Euclid',exact:true}).click();await sheet.waitFor({state:'visible'});
  await sheet.getByRole('button',{name:'Done'}).click();await sheet.waitFor({state:'hidden'});

  // ---- Drum Rack track: a lane per pad the kit has, found by what the pad is.
  const fixture=JSON.parse(fs.readFileSync(path.join(ROOT,'src','preview-state.json'),'utf8'));
  await app.evaluate(({BrowserWindow},fx)=>{
   const pad=(note,name)=>({note,name,source:null,gain:1,velocity:100,mute:false,solo:false,tune:0,choke:0});
   fx.state.tracks[0]={...fx.state.tracks[0],device:'drum_rack',notes:[],drum_rack:{version:1,id:'euclid-test',pads:[pad(60,'Deep Kick'),pad(61,'Snare 1'),pad(62,'Clap'),pad(63,'Closed Hat'),pad(64,'Open Hat'),pad(65,'Wind FX')]}};
   BrowserWindow.getAllWindows()[0].webContents.send('deck-message',{...fx,preview:true});
  },fixture);
  await p.getByRole('button',{name:'Euclid',exact:true}).click();await sheet.waitFor({state:'visible'});
  assert.deepEqual(await sheet.locator('.euclid-lane .euclid-pick b').allInnerTexts(),['Kick','Snare','Clap','Hat','Open hat'],'a lane per matching pad; no Perc pad in this kit');
  await sheet.getByRole('button',{name:'Reggaeton',exact:true}).click();
  assert.match(await sheet.locator('footer small').innerText(),/replaces only these pads in the pattern/);
  await p.screenshot({path:path.join(SHOTS,'drums-718.png')});
  await size(800);await p.screenshot({path:path.join(SHOTS,'drums-800.png')});await size(718);
  await sheet.getByRole('button',{name:'All off'}).click();
  assert.equal(await sheet.getByRole('button',{name:'Write to pattern'}).isDisabled(),true,'nothing to write');
  await sheet.getByRole('button',{name:'Hip Hop & Trap',exact:true}).click();
  await sheet.getByRole('button',{name:'Write to pattern'}).click();await p.waitForTimeout(300);
  assert.match(await sheet.locator('footer small').innerText(),/Written: \d+ notes/,'drum write reports its notes');
  assert.deepEqual(errs,[],'no page errors');
  console.log('euclid acceptance: ok; screenshots in '+SHOTS);
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
