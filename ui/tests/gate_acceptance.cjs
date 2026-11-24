// Preview UI test for the Audio gate effect (patch 24): add it, edit its steps in its sheet, cells and cell size
// as buttons, pattern tools, Esc / Done / blank tap close the sheet, and the steps aren't offered as link targets.
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
  await p.setViewportSize({width:1280,height:720});
  await p.waitForFunction(()=>innerWidth===1280&&innerHeight===720,{timeout:5000});
  await p.getByRole('tab',{name:/^FX$/}).click();
  await p.getByRole('button',{name:'Add Audio gate'}).click();
  const card=p.locator('[data-panel="fx-gate"]');
  assert.ok(await card.isVisible(),'gate card in the rack');
  const strip=card.getByRole('button',{name:'Edit gate steps'});
  assert.match(await strip.innerText(),/8 × 1\/16/);
  assert.equal(await card.locator('.gate-strip-cells i').count(),8);
  for(const k of ['Smooth','Depth','Pump'])assert.ok(await card.getByText(k,{exact:true}).isVisible(),k+' knob on the card');
  await p.screenshot({path:path.join(ROOT,'docs/gate-card-acceptance.png')});

  // The sheet: cells, size, steps.
  await strip.click();
  const sheet=p.getByRole('dialog',{name:'Audio gate steps'});
  assert.ok(await sheet.isVisible());
  assert.equal(await sheet.locator('.gate-cell').count(),8);
  await sheet.getByRole('radiogroup',{name:'Gate cells'}).getByRole('radio',{name:'16',exact:true}).click();
  assert.equal(await sheet.locator('.gate-cell').count(),16);
  await sheet.getByRole('radiogroup',{name:'Gate cell size'}).getByRole('radio',{name:'1/8T',exact:true}).click();
  const c2=sheet.getByRole('button',{name:/^Cell 2,/});
  const before=await c2.getAttribute('aria-pressed');
  await c2.click();
  assert.notEqual(await sheet.getByRole('button',{name:/^Cell 2,/}).getAttribute('aria-pressed'),before,'tapping a cell flips it');
  await sheet.getByRole('button',{name:'All closed'}).click();
  assert.equal(await sheet.locator('.gate-cell.open').count(),0);
  await sheet.getByRole('button',{name:'Off-beat'}).click();
  assert.equal(await sheet.locator('.gate-cell.open').count(),8);
  assert.equal(await sheet.getByRole('button',{name:/^Cell 1,/}).getAttribute('aria-pressed'),'false');
  await sheet.getByRole('button',{name:'Invert'}).click();
  assert.equal(await sheet.getByRole('button',{name:/^Cell 1,/}).getAttribute('aria-pressed'),'true');
  const b=await sheet.boundingBox();
  assert.ok(b.y+b.height<=720,'sheet fits the window');
  for(const cell of await sheet.locator('.gate-cell').all()){const r=await cell.boundingBox();assert.ok(r.width>=44&&r.height>=44,'44 px cells');}
  await p.screenshot({path:path.join(ROOT,'docs/gate-sheet-acceptance.png')});
  await p.keyboard.press('Escape');
  assert.equal(await sheet.count(),0,'Esc closes');
  assert.match(await strip.innerText(),/16 × 1\/8T/,'the card follows the sheet');
  await strip.click();await p.getByRole('dialog',{name:'Audio gate steps'}).getByRole('button',{name:'Done'}).click();
  assert.equal(await sheet.count(),0,'Done closes');

  // Steps, cells and size are not link targets; Smooth, Depth and Pump are.
  await p.getByRole('tab',{name:'Link',exact:true}).click();
  await p.locator('.lp-links').getByRole('button',{name:'By name'}).click();
  const linkEditor=p.getByRole('dialog',{name:'Mod pad 1 editor'});
  await linkEditor.getByRole('radiogroup',{name:'Target effect'}).getByRole('radio',{name:'Audio gate'}).click();
  const params=linkEditor.locator('.mod-link-params');
  for(const n of ['Smooth','Depth','Pump'])assert.ok(await params.getByRole('button',{name:n,exact:true}).isVisible(),n+' linkable');
  for(const n of ['Steps','Cells','Cell size'])assert.equal(await params.getByRole('button',{name:n,exact:true}).count(),0,n+' not linkable');
  await p.keyboard.press('Escape');
  assert.deepEqual(errs,[]);
  console.log('gate acceptance: ok');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
