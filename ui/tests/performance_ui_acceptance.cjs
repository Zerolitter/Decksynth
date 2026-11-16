// Preview-only UI test for the Perform panel: modes, step grid, touch keyboard and fixed layout.
'use strict';
const {_electron}=require('playwright');
const path=require('node:path');
const assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
(async()=>{
 const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,
  env:{...process.env,DECKSYNTH_UI_PREVIEW:'1',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:16000});
 try{
  const p=await app.firstWindow({timeout:15000});
  p.setDefaultTimeout(8000);
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.getByRole('tab',{name:/^Perform$/}).click();
  await p.locator('.pf').waitFor({state:'visible'});
  const box=sel=>p.locator(sel).first().boundingBox();
  const keys0=await box('.pf-keys');

  // Step grid: tap adds, tap again removes, Longer ties, Accent marks.
  assert.equal(await p.locator('.pf-row').count(),13,'C to C, 13 rows');
  await p.getByTestId('pf-cell-1-60').click();
  assert.equal(await p.locator('.pf-note').count(),1);
  await p.getByRole('button',{name:'Longer'}).click();
  await p.getByTestId('pf-cell-1-60').click();
  const tied=await box('.pf-note'),cell=await box('[data-testid="pf-cell-1-60"]');
  assert.ok(tied.width>cell.width*1.5,'tie 2 draws across two steps');
  await p.getByRole('button',{name:'Accent'}).click();
  await p.getByTestId('pf-cell-1-60').click();
  assert.equal(await p.locator('.pf-note.accent').count(),1);
  await p.getByRole('button',{name:'Note',exact:true}).click();
  await p.getByTestId('pf-cell-3-64').click();
  assert.equal(await p.locator('.pf-note').count(),2);
  await p.getByTestId('pf-cell-3-64').click();
  assert.equal(await p.locator('.pf-note').count(),1);

  // Scale folds the grid to scale notes.
  await p.getByRole('button',{name:'Key and scale'}).click();await p.getByRole('button',{name:'Minor',exact:true}).click();
  assert.equal(await p.locator('.pf-row').count(),8,'minor: 7 notes plus the octave');
  await p.getByRole('button',{name:'Key and scale'}).click();await p.getByRole('button',{name:'Chromatic',exact:true}).click();

  // Arp: on, hold, press three keys on the touch keyboard, lane shows them low to high.
  await p.getByRole('tab',{name:/Arp/}).click();
  await p.getByRole('button',{name:/Turn arp on/}).click();
  await p.getByRole('button',{name:'Hold',exact:true}).click();
  for(const note of [67,60,64]){
    const k=await box(`.pf-piano [data-note="${note}"]`);
    await p.mouse.move(k.x+k.width/2,k.y+k.height*.85);await p.mouse.down();await p.mouse.up();
  }
  assert.deepEqual((await p.locator('.pf-roll:not(.example) .pf-roll-head [data-names]').evaluateAll(es=>es.map(e=>e.dataset.names))).slice(0,3),['C4','E4','G4']);
  // Octaves and rate are buttons (rule 11).
  await p.getByRole('group',{name:'Arp octaves'}).getByRole('button',{name:'2',exact:true}).click();
  await p.getByRole('group',{name:'Octave direction'}).getByRole('button',{name:'Down',exact:true}).click();
  assert.deepEqual((await p.locator('.pf-roll:not(.example) .pf-roll-head [data-names]').evaluateAll(es=>es.map(e=>e.dataset.names))).slice(0,3),['C5','E5','G5'],'Down starts on the top octave');
  await p.getByRole('group',{name:'Octave direction'}).getByRole('button',{name:'Up',exact:true}).click();
  await p.getByRole('group',{name:'Arp octaves'}).getByRole('button',{name:'1',exact:true}).click();
  await p.getByRole('group',{name:'Arp rate'}).getByRole('button',{name:'1/8',exact:true}).click();
  assert.equal(await p.getByTestId('arp-timing').getAttribute('data-division'),'1/8');
  await p.getByRole('group',{name:'Arp feel'}).getByRole('button',{name:'Triplet'}).click();
  assert.equal(await p.getByTestId('arp-timing').getAttribute('data-division'),'1/8T');
  await p.getByRole('group',{name:'Arp steps'}).getByRole('button',{name:'8',exact:true}).click();
  assert.equal(await p.locator('.pf-roll-head [data-names]').count(),8,'roll shows the 8-step cycle');
  await p.getByRole('group',{name:'Arp steps'}).getByRole('button',{name:'16',exact:true}).click();
  await p.getByRole('group',{name:'Arp feel'}).getByRole('button',{name:'Straight'}).click();
  await p.getByRole('group',{name:'Arp rate'}).getByRole('button',{name:'1/16',exact:true}).click();
  assert.equal(await p.locator('[data-testid^="knob-pf-arp-rate"],[data-testid^="knob-pf-arp-oct"],[data-testid^="knob-pf-arp-len"]').count(),0,'no discrete knobs');
  await p.getByRole('button',{name:'UpDown'}).click();
  await p.getByRole('button',{name:'Panic'}).click();
  assert.equal(await p.locator('.pf-roll.example').count(),1,'after Panic the roll shows the example again');

  // Chord and Mutate open without moving the keyboard.
  await p.getByRole('tab',{name:/Chord/}).click();
  await p.getByRole('group',{name:'Chord type'}).getByRole('button',{name:'9th'}).click();
  assert.match(await p.getByTestId('cb-pad-ii').innerText(),/Dm9[\s\S]*D F A C E/);
  await p.getByRole('group',{name:'Chord type'}).getByRole('button',{name:'Triad'}).click();
  await p.getByRole('tab',{name:/^Seq/}).click();
  assert.ok(await p.getByRole('button',{name:/^Mutate$/}).isVisible(),'Mutate sits on the pattern tool rail');
  const keys1=await box('.pf-keys');
  assert.deepEqual(keys1,keys0,'keyboard stays in place across modes');
  const layout=await p.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight,
    small:[...document.querySelectorAll('.pf button:not(.pf-cell):not(.pf-row-note):not(.knob-value),.pf [role=slider]')].filter(e=>{const b=e.getBoundingClientRect();return b.width&&b.height<32;}).map(e=>e.className+' '+e.getAttribute('aria-label')),
    cell:Math.min(...[...document.querySelectorAll('.pf-cell')].map(e=>e.getBoundingClientRect().height))}));
  assert.ok(layout.w<=1280&&layout.h<=800,'no page scroll at 1280x800');
  assert.deepEqual(layout.small,[],'touch targets at least 32px tall');
  console.log('cell',layout.cell);assert.ok(layout.cell>=24,'grid cells at least 24px tall (they are ~70px wide)');
  if(errs.length)throw new Error(errs.join('; '));
  console.log('PASS: step grid add/remove/tie/accent, scale-folded rows');
  console.log('PASS: touch keyboard feeds the arp lane, hold and panic');
  console.log('PASS: chord builder, mutate tools, keyboard fixed across modes, no scroll');
 }finally{await app.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
