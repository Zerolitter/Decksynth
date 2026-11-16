// Preview UI test for section B: pattern pads, rate/steps buttons, tool rail, playable note labels, key/scale sheet.
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
  await p.locator('.pf').waitFor({state:'visible'});
  assert.equal(await p.getByRole('tab',{name:/Mutate/}).count(),0,'no Mutate tab');
  assert.equal(await p.locator('[data-testid="knob-pf-pattern"],[data-testid="knob-pf-steps"],[data-testid="knob-pf-seq-rate"]').count(),0,'no discrete knobs');
  const bar=p.getByTestId('pf-seq-timing');

  // Bank 3, pattern 7: one tap each.
  await p.getByRole('button',{name:'Bank 3',exact:true}).click();
  await p.getByTestId('pf-pad-3-7').click();
  assert.equal(await p.getByTestId('pf-pad-3-7').getAttribute('aria-pressed'),'true');
  assert.match(await p.locator('.pf-info').innerText(),/Pattern 3·07/);

  // Rate, feel and steps are buttons.
  await p.getByRole('group',{name:'Sequencer rate'}).getByRole('button',{name:'1/8',exact:true}).click();
  assert.equal(await bar.getAttribute('data-division'),'1/8');
  await p.getByRole('button',{name:'Triplet'}).click();
  assert.equal(await bar.getAttribute('data-division'),'1/8T');
  await p.getByRole('button',{name:'Straight'}).click();
  // Steps are a pick list plus a value box (16 Nov).
  await p.getByTestId('pf-steps-list').click();await p.getByRole('listbox').getByRole('option',{name:'32',exact:true}).click();
  assert.equal(await bar.getAttribute('data-length'),'32');
  {const n=p.getByRole('spinbutton',{name:'Pattern steps'});await n.focus();await n.press('ArrowDown');}
  await p.waitForFunction(()=>document.querySelector('[data-testid=pf-seq-timing]')?.dataset.length==='31');
  await p.getByTestId('pf-steps-list').click();await p.getByRole('listbox').getByRole('option',{name:'16',exact:true}).click();

  // Copy a pattern with a long-press and paste it into another pad.
  // The roll shows about an octave around the notes (12 rows, scrolls); E4 is on screen.
  await p.getByTestId('pf-cell-1-64').click();
  const pad=async id=>{const b=await p.getByTestId(id).boundingBox();await p.mouse.move(b.x+b.width/2,b.y+b.height/2);
    await p.mouse.down();await p.waitForTimeout(600);await p.mouse.up();};
  await pad('pf-pad-3-7');await p.getByRole('menuitem',{name:'Copy'}).click();
  assert.match(await p.getByTestId('pf-pad-3-7').getAttribute('class'),/full/,'pad with notes looks full');
  await pad('pf-pad-3-9');await p.getByRole('menuitem',{name:/^Paste/}).click();
  assert.equal(await p.getByTestId('pf-pad-3-9').getAttribute('aria-pressed'),'true');
  assert.equal(await p.locator('[data-testid="pf-cell-1-64"] .pf-note').count(),1,'pasted note on pattern 3·9');

  // Tool rail: Mutate and the rest are one tap; the More sheet holds amount, transpose, song and clear.
  for(const n of ['Mutate','Reset','×2 length','◀ Nudge','Nudge ▶','Oct −','Oct +','Dice'])
    assert.ok(await p.getByRole('button',{name:n,exact:true}).isVisible(),n+' on the rail');
  await p.getByRole('button',{name:'More pattern tools'}).click();
  for(const n of ['Song → Pattern','Pattern → Song','Clear pattern'])assert.ok(await p.getByRole('button',{name:n,exact:true}).isVisible(),n+' in More');
  assert.ok(await p.getByTestId('knob-pf-mutate').isVisible());
  await p.getByRole('dialog',{name:'Pattern tools'}).getByRole('button',{name:'Close'}).click();

  // A note label plays its note while held.
  const label=p.getByRole('button',{name:'Play E4'});const lb=await label.boundingBox();
  await p.mouse.move(lb.x+lb.width/2,lb.y+lb.height/2);await p.mouse.down();await p.waitForTimeout(80);
  const held=await p.evaluate(()=>[...document.querySelectorAll('.pf-piano [data-note].held,.pf-piano [data-note].on,.pf-piano .down')].map(e=>e.getAttribute('data-note')));
  await p.mouse.up();
  assert.ok(held.includes('64'),'E4 sounds while its label is held: '+held);

  // Key and scale sheet.
  await p.getByRole('button',{name:'Key and scale'}).click();
  await p.getByRole('button',{name:'D',exact:true}).click();
  await p.getByRole('button',{name:'Dorian',exact:true}).click();
  assert.match(await p.getByRole('button',{name:'Key and scale'}).innerText(),/D\s*Dorian/);
  // (The 8-row step grid became the piano roll; the key and scale show on the button above.)

  await p.screenshot({path:path.join(ROOT,'..','artifacts','seq-patterns-722.png')});
  assert.deepEqual(errs,[]);
  console.log('seq_patterns_acceptance: ok');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
