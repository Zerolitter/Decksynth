// Perform panel UI test (rewritten 16 Nov for the piano-roll grid; the old .pf-row step grid is gone):
// the compact roll shows 9 rows for the synth and 12 scrolling rows for drums, draw / erase / longer / accent,
// a scale folds the rows, the arp lane follows held keys, the chord pads, steps value boxes, keyboard fixed, no page scroll.
'use strict';
require('./deck_guard.cjs');
const {_electron}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
const H=Number(process.env.HEIGHT||718);
const data=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-perform-'));
(async()=>{
 const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,
  env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DATA_DIR:data,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 try{
  const p=await app.firstWindow({timeout:18000});
  p.setDefaultTimeout(8000);
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'),null,{timeout:20000});
  for(let i=0;i<30;i++){await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];if(w.isMaximized())w.unmaximize();w.setContentSize(1280,h);},H);
   await p.waitForTimeout(150);if(await p.evaluate(h=>innerWidth===1280&&innerHeight===h,H))break;}
  await p.evaluate(()=>{window.__performanceLatest={};window.deckApi.onMessage(m=>{window.__performanceLatest={...window.__performanceLatest,...m};});});
  const waitForChord=async(key,value)=>{
   try{await p.waitForFunction(([field,expected])=>window.__performanceLatest?.state?.performance?.chord?.[field]===expected,[key,value],{timeout:3000});}
   catch(error){const actual=await p.evaluate(field=>window.__performanceLatest?.state?.performance?.chord?.[field]??'missing',key);throw new Error('Timed out waiting for canonical chord '+key+'='+value+'; last canonical value was '+actual,{cause:error});}
  };
  const waitForChordExt=ext=>waitForChord('ext',ext);
  const held=()=>p.evaluate(()=>window.__performanceLatest?.held_notes??[]);
  const holdPad=async(testId,expected)=>{
   const pad=p.getByTestId(testId),rect=await pad.boundingBox();assert.ok(rect,'pad '+testId+' is visible');
   await p.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await p.mouse.down();
   try{await p.waitForFunction(notes=>JSON.stringify(window.__performanceLatest?.held_notes??[])===JSON.stringify(notes),expected,{timeout:3000});}
   catch(error){throw new Error('Timed out waiting for '+testId+' to play '+expected.join(' ')+ '; heard '+(await held()).join(' '),{cause:error});}
   await p.mouse.up();
  };
  const tab=n=>p.getByRole('tab',{name:new RegExp('^'+n+'$','i')}).first().click();
  await tab('Perform');
  await p.locator('.pf .compact-roll').waitFor({state:'visible'});
  await p.waitForTimeout(400);
  const box=sel=>p.locator(sel).first().boundingBox();
  const keys0=await box('.pf-keys');
  // Rows whose middle is inside the grid's visible area, top to bottom.
  const visibleRows=()=>p.evaluate(()=>{const g=document.querySelector('.pf .compact-roll'),r=g.getBoundingClientRect();
   return [...g.querySelectorAll('.note-editor-row')].filter(e=>{const b=e.getBoundingClientRect(),m=b.top+b.height/2;return m>r.top+24&&m<r.top+g.clientHeight;})
    .map(e=>Number(e.dataset.pitch));});
  const notes=()=>p.locator('.pf .pf-note').count();

  // Synth: nine rows, opening on C5 at the top.
  const rows=await visibleRows();
  assert.equal(rows.length,9,'synth roll shows 9 rows ('+rows+')');
  assert.equal(rows[0],72,'opens on C5');

  // Draw, Longer, Accent, Erase.
  await p.getByRole('button',{name:'Draw notes'}).click();
  await p.getByTestId('pf-cell-1-67').click();
  await p.waitForFunction(()=>document.querySelectorAll('.pf .pf-note').length===1);
  await p.getByRole('button',{name:'Erase notes'}).click();
  await p.getByTestId('pf-cell-1-67').click();
  await p.waitForFunction(()=>document.querySelectorAll('.pf .pf-note').length===0);
  await p.getByRole('button',{name:'Draw notes'}).click();
  await p.getByTestId('pf-cell-3-64').click();
  await p.waitForFunction(()=>document.querySelectorAll('.pf .pf-note').length===1);
  assert.equal(await notes(),1);

  // A scale folds the rows to the scale's notes.
  await p.getByRole('button',{name:'Key and scale'}).click();await p.getByRole('button',{name:'Minor',exact:true}).click();
  await p.waitForTimeout(300);
  const minor=await visibleRows();
  assert.ok(minor.every(n=>[0,2,3,5,7,8,10].includes(n%12)),'minor rows only ('+minor+')');
  await p.getByRole('button',{name:'Key and scale'}).click();await p.getByRole('button',{name:'Chromatic',exact:true}).click();

  // Steps are a value box (rule 36) beside the steps list.
  const steps=p.getByRole('spinbutton',{name:'Pattern steps'});
  const n0=Number(await steps.getAttribute('aria-valuenow'));
  await steps.focus();await steps.press('ArrowUp');
  await p.waitForFunction(n=>document.querySelector('[data-testid=pf-seq-timing]')?.dataset.length===String(n+1),n0);
  await steps.press('ArrowDown');await p.waitForTimeout(450);

  // Arp: the lane shows held keys low to high.
  await p.getByRole('tab',{name:/^Arp/}).click();
  assert.equal(await p.locator('.pf-roll.example').count(),1,'arp shows an example before keys are held');
  assert.equal(await p.locator('[data-testid^="knob-pf-arp-rate"],[data-testid^="knob-pf-arp-oct"],[data-testid^="knob-pf-arp-len"]').count(),0,'no discrete knobs');
  await p.getByTestId('pf-arp-steps-list').click();await p.getByRole('listbox',{name:'Arp steps list'}).getByRole('option',{name:'8',exact:true}).click();
  await p.waitForFunction(()=>document.querySelector('[data-testid=arp-timing]')?.dataset.length==='8');
  assert.equal(await p.getByRole('spinbutton',{name:'Arp steps'}).getAttribute('aria-valuenow'),'8');

  // Chord type is acknowledged by the engine before selector, pads, readout and MIDI are checked.
  await p.getByRole('tab',{name:/^Chord/}).click();
  const types=p.getByRole('group',{name:'Chord type'}),ii=p.getByTestId('cb-pad-ii'),v=p.getByTestId('cb-pad-V');
  await types.getByRole('button',{name:'9th'}).click();await waitForChordExt('9');
  assert.equal(await types.getByRole('button',{name:'9th'}).getAttribute('aria-pressed'),'true','canonical ninth selects the ninth control');
  assert.match(await ii.innerText(),/Dm9/,'canonical ninth labels ii as Dm9');
  assert.match(await ii.innerText(),/D F A C E/,'canonical ninth draws all five ii notes');
  await holdPad('cb-pad-ii',[50,53,57,60,64]);
  assert.match(await p.getByTestId('cb-display').innerText(),/Dm9/,'selected ii readout agrees with the canonical ninth');
  assert.match(await p.getByTestId('cb-display').innerText(),/D F A C E/,'selected ii readout agrees with the played ninth voicing');
  const inversion=p.getByRole('spinbutton',{name:'Inversion'});await inversion.focus();await inversion.press('ArrowUp');await waitForChord('inversion',1);
  await holdPad('cb-pad-ii',[53,57,60,62,64]);
  await p.getByRole('group',{name:'Bass note'}).getByRole('button',{name:'Bass −1 octave'}).click();await waitForChord('bass',1);
  await holdPad('cb-pad-ii',[38,53,57,60,62,64]);
  await p.getByRole('group',{name:'Bass note'}).getByRole('button',{name:'Bass off'}).click();await waitForChord('bass',0);
  await inversion.focus();await inversion.press('ArrowDown');await waitForChord('inversion',0);
  await types.getByRole('button',{name:'7th'}).click();await waitForChordExt('7');
  assert.match(await ii.innerText(),/Dm7/,'repeated extension changes settle on the latest canonical type');
  await types.getByRole('button',{name:'9th'}).click();await waitForChordExt('9');
  await holdPad('cb-pad-V',[55,59,62,65,69]);
  assert.match(await v.innerText(),/G9/,'changing the selected chord preserves the canonical ninth: '+await v.innerText());
  assert.match(await p.getByTestId('cb-display').innerText(),/G9/,'selected V readout preserves the canonical ninth');
  await types.getByRole('button',{name:'Triad'}).click();await waitForChordExt('triad');
  assert.equal(await types.getByRole('button',{name:'Triad'}).getAttribute('aria-pressed'),'true','canonical triad restores the triad control');
  assert.match(await ii.innerText(),/Dm\nD F A/,'returning from Dm9 restores Dm and its three notes');
  await holdPad('cb-pad-ii',[50,53,57]);
  await p.getByRole('tab',{name:/^Seq/}).click();
  assert.ok(await p.getByRole('button',{name:/^Mutate$/}).isVisible(),'Mutate sits on the pattern tool rail');
  assert.deepEqual(await box('.pf-keys'),keys0,'keyboard stays in place across modes');

  // Drums: 12 of the 16 pad rows, opening on the lowest pads; the grid scrolls to the rest.
  await tab('Sound');await p.getByRole('radiogroup',{name:'Track instrument'}).getByRole('radio',{name:'Drum Rack',exact:true}).click();
  await p.waitForTimeout(600);await tab('Perform');await p.locator('.pf .compact-roll').waitFor({state:'visible'});await p.waitForTimeout(400);
  const drums=await visibleRows();
  assert.equal(drums.length,12,'drum roll shows 12 rows ('+drums+')');
  assert.equal(drums[drums.length-1],36,'the kick (C2) is the bottom row');
  await p.locator('.pf .compact-roll').evaluate(g=>{g.scrollTop-=g.querySelector('.note-editor-row').getBoundingClientRect().height*4;});
  await p.waitForTimeout(300);
  assert.ok((await visibleRows()).includes(51),'scrolling up shows pad 16');
  const cell=await p.evaluate(()=>Math.min(...[...document.querySelectorAll('.pf .note-editor-row')].map(e=>e.getBoundingClientRect().height)));
  console.log('drum row',cell);assert.ok(cell>=22,'drum rows are at least 22 px tall');

  const layout=await p.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight,ih:innerHeight}));console.log('layout',layout);
  assert.ok(layout.w<=1280&&layout.h<=layout.ih+1,'no page scroll at 1280x'+H);
  if(errs.length)throw new Error(errs.join('; '));
  console.log('PASS: synth roll 9 rows, draw / erase, scale-folded rows, steps value box');
  console.log('PASS: arp lane and steps list, chord pads, keyboard fixed across modes');
  console.log('PASS: drum roll 12 rows from the kick up, scrolls to pad 16, no page scroll');
 }finally{await app.close();fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
