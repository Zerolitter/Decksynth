// Preview UI test for section C: one keyboard with chord outlines, chord pads that play, segmented chord settings,
// My chords slots, and the colour/icon pass.
'use strict';
const {_electron}=require('playwright');
const path=require('node:path');
const assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
(async()=>{
 const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,
  env:{...process.env,DECKSYNTH_UI_PREVIEW:'1',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 try{
  const p=await app.firstWindow({timeout:15000});
  p.setDefaultTimeout(8000);
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,722));
  await p.getByRole('tab',{name:/^Perform$/}).click();
  await p.getByRole('tab',{name:/^Chord$/}).click();
  await p.locator('.cb').waitFor({state:'visible'});

  // One keyboard: the old chord mini keyboard and chord preset list are gone.
  assert.equal(await p.locator('.pf-mini-piano,.pf-chord-view,.pf-chords').count(),0,'no second keyboard');
  assert.equal(await p.locator('.pf-piano').count(),1);
  // Discrete chord settings are buttons, not knobs.
  assert.equal(await p.locator('[data-testid="knob-pf-spread"],[data-testid="knob-pf-bass"],[data-testid="knob-pf-strum-sync"]').count(),0);
  for(const g of ['Voices','Bass note','Strum sync','Chord type','Inversion'])assert.ok(await p.getByRole('group',{name:g}).isVisible(),g);

  // C major (Chromatic falls back to the major key of the root): seven pads.
  assert.equal(await p.locator('.cb-pad').count(),7);
  const vi=p.getByTestId('cb-pad-vi');
  assert.match(await vi.innerText(),/Am[\s\S]*A C E/);

  // Holding vi plays A C E (one key with its exact notes); releasing sends the note-off.
  const b=await vi.boundingBox();
  await p.mouse.move(b.x+b.width/2,b.y+b.height/2);await p.mouse.down();await p.waitForTimeout(120);
  const held=await p.evaluate(()=>[...document.querySelectorAll('.pf-piano [data-note].held')].map(e=>Number(e.dataset.note)));
  assert.deepEqual(held.sort((a,c)=>a-c),[57,60,64],'A3 C4 E4 sound while vi is held');
  assert.match(await vi.getAttribute('class'),/sounding/);
  // Chord outline on the playable keyboard, root marked.
  const outline=await p.evaluate(()=>[...document.querySelectorAll('.pf-piano .chord')].map(e=>Number(e.dataset.note)));
  assert.deepEqual(outline.sort((a,c)=>a-c),[57,60,64]);
  assert.equal(await p.locator('.pf-piano .chord-root').getAttribute('data-note'),'57');
  await p.screenshot({path:path.join(ROOT,'..','artifacts','chord-builder-722.png')});
  await p.mouse.up();await p.waitForTimeout(60);
  assert.equal(await p.locator('.pf-piano .held').count(),0,'released with the pad');
  // A pressed key draws above the chord outline (rule 22).
  const key=p.locator('.pf-piano [data-note="60"]');const kb=await key.boundingBox();
  await p.mouse.move(kb.x+kb.width/2,kb.y+kb.height-14);await p.mouse.down();await p.waitForTimeout(60);
  const cls=await key.getAttribute('class');
  assert.match(cls,/chord/);assert.match(cls,/down/);
  const bg=await key.evaluate(e=>getComputedStyle(e).backgroundImage);
  await p.mouse.up();
  const bgIdle=await key.evaluate(e=>getComputedStyle(e).backgroundImage);
  assert.notEqual(bg,bgIdle,'pressed look replaces the outline look');

  // Chord types change the pads; sevenths name themselves.
  await p.getByRole('group',{name:'Chord type'}).getByRole('button',{name:'7th'}).click();
  assert.match(await p.getByTestId('cb-pad-V').innerText(),/G7/);
  await p.getByRole('group',{name:'Chord type'}).getByRole('button',{name:'Triad'}).click();
  const inv=p.getByRole('group',{name:'Inversion'}).getByRole('spinbutton',{name:'Inversion'});await inv.focus();await inv.press('ArrowUp');
  assert.match(await vi.innerText(),/C E A/,'first inversion of Am');
  await inv.press('ArrowDown');await p.waitForTimeout(450);

  // Voices and Bass.
  await p.getByRole('group',{name:'Bass note'}).getByRole('button',{name:'Bass −1 octave'}).click();
  assert.match(await vi.innerText(),/A A C E/);
  await p.getByRole('group',{name:'Bass note'}).getByRole('button',{name:'Bass off'}).click();

  // Key and scale change the pads.
  await p.getByRole('button',{name:'Key and scale'}).click();
  await p.getByRole('button',{name:'A',exact:true}).click();
  await p.getByRole('button',{name:'Minor',exact:true}).click();
  assert.match(await p.getByTestId('cb-pad-i').innerText(),/Am/);
  assert.match(await p.getByTestId('cb-pad-III').innerText(),/C/);

  // Holding a pad no longer saves it (Sir, 16 Nov): sliding across pads plays one chord after another.
  const iii=p.getByTestId('cb-pad-III'),iv=p.getByTestId('cb-pad-iv');const ib=await iii.boundingBox(),vb=await iv.boundingBox();
  await p.mouse.move(ib.x+ib.width/2,ib.y+ib.height/2);await p.mouse.down();await p.waitForTimeout(750);
  assert.match(await iii.getAttribute('class'),/sounding/);
  await p.mouse.move(vb.x+vb.width/2,vb.y+vb.height/2,{steps:4});await p.waitForTimeout(80);
  assert.match(await iv.getAttribute('class'),/sounding/,'the slide moved on to iv');
  assert.doesNotMatch(await iii.getAttribute('class'),/sounding/);
  await p.mouse.up();
  assert.doesNotMatch(await p.getByTestId('cb-slot-1').getAttribute('class'),/full/,'holding does not save');
  // Keep C in slot 1: tap it, then the empty slot.
  await iii.click();await p.getByTestId('cb-slot-1').click();
  const slot=p.getByTestId('cb-slot-1');
  assert.match(await slot.getAttribute('class'),/full/);
  assert.match(await slot.innerText(),/C/);
  // Tap an empty slot to keep the last chord there.
  await p.getByTestId('cb-pad-i').click();
  await p.getByTestId('cb-slot-2').click();
  assert.match(await p.getByTestId('cb-slot-2').innerText(),/Am/);
  // Long-press a filled slot to clear it.
  const sb=await p.getByTestId('cb-slot-2').boundingBox();
  await p.mouse.move(sb.x+sb.width/2,sb.y+sb.height/2);await p.mouse.down();await p.waitForTimeout(750);await p.mouse.up();
  await p.getByRole('menuitem',{name:'Clear'}).click();
  assert.doesNotMatch(await p.getByTestId('cb-slot-2').getAttribute('class'),/full/);

  // Play in order: each key plays the next saved chord, the next one is marked.
  await p.getByTestId('cb-pad-i').click();await p.getByTestId('cb-slot-2').click();
  await p.getByTestId('cb-follow').click();
  assert.match(await p.getByTestId('cb-slot-1').getAttribute('class'),/next/,'the first saved chord is next');
  const k50=p.locator('.pf-piano [data-note="50"]');const kb50=await k50.boundingBox();
  await p.mouse.move(kb50.x+kb50.width/2,kb50.y+kb50.height-14);await p.mouse.down();await p.waitForTimeout(80);
  assert.match(await p.getByTestId('cb-display').innerText(),/C\b/);await p.mouse.up();
  await p.mouse.down();await p.waitForTimeout(80);
  assert.match(await p.getByTestId('cb-display').innerText(),/Am/);await p.mouse.up();
  await p.getByTestId('cb-follow').click();
  // Nothing covered at 722 px.
  const covered=await p.evaluate(()=>[...document.querySelectorAll('.pf button')].filter(b=>{const r=b.getBoundingClientRect();
    if(!r.width||!r.height)return false;const e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return !(e===b||b.contains(e));}).map(b=>b.getAttribute('aria-label')||b.textContent));
  assert.deepEqual(covered,[],'covered buttons');
  const small=await p.evaluate(()=>[...document.querySelectorAll('.cb button,.pf-ctl-chord button')].filter(b=>!b.closest('.parameter-knob')).filter(b=>{const r=b.getBoundingClientRect();
    return r.width&&(r.width<44||r.height<44);}).map(b=>b.getAttribute('aria-label')||b.textContent));
  assert.deepEqual(small,[],'chord buttons under 44 px');

  // Colour pass: rail tools and the Library button carry their own accent and an icon, and show a label.
  await p.getByRole('tab',{name:/^Seq$/}).click();
  const tools=await p.evaluate(()=>[...document.querySelectorAll('.pf-rail button,.pf-lib-btn')].map(b=>({
    name:b.getAttribute('aria-label'),tool:getComputedStyle(b).getPropertyValue('--tool').trim(),
    icon:!!b.querySelector('svg,b'),label:b.querySelector('span')?.textContent??''})));
  for(const t of tools){assert.ok(t.tool&&!/82ddc1/i.test(t.tool),t.name+' has its own colour');assert.ok(t.icon,t.name+' icon');assert.ok(t.label,t.name+' label');}
  const lib=p.getByRole('button',{name:'Library'});
  assert.ok(await lib.isVisible());assert.match(await lib.innerText(),/Library/);
  const sec=await p.evaluate(()=>[...document.querySelectorAll('.page-tabs button,.pf-tabs button')].map(b=>getComputedStyle(b).getPropertyValue('--sec').trim()));
  assert.equal(new Set(sec).size,sec.length-1,'every page and mode has a colour (Perform and Seq share one)');
  await p.screenshot({path:path.join(ROOT,'..','artifacts','colour-seq-722.png')});

  assert.deepEqual(errs,[]);
  console.log('chord_builder_acceptance: ok');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
