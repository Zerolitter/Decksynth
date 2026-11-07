// Preview UI test for sections E and F: the envelope editor, on-knob depth while linking, the macro link sheet,
// exact depth entry, and no stretched graphs.
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
  await p.getByRole('tab',{name:/^Sound$/}).click();
  await p.getByRole('tab',{name:'Partials'}).click();
  const val=id=>p.locator(`[data-param="${id}"] .knob-value`).innerText();

  // Envelope: the card's picture opens the editor; the graph is not shown twice.
  // Envelope: the card's picture opens the envelope sheet (no Envelope or Wave tab in the Sound window any more).
  assert.equal(await p.getByRole('tab',{name:'Envelope'}).count(),0,'no Envelope tab');
  assert.equal(await p.getByRole('tab',{name:'Wave'}).count(),0,'no Wave tab');
  await p.getByRole('button',{name:'Open the envelope editor'}).click();
  const envSheet=p.getByRole('dialog',{name:'Envelope'});
  assert.ok(await envSheet.isVisible(),'envelope sheet opens');
  const val3=id=>p.locator(`[data-param="${id.replace(/^0-/,'envsheet-0-')}"] .knob-value`).innerText();
  const before=await val3('0-attack');
  const a=await p.locator('[data-handle="a"] circle').last().boundingBox();
  await p.mouse.move(a.x+a.width/2,a.y+a.height/2);await p.mouse.down();
  await p.mouse.move(a.x+a.width/2+80,a.y+a.height/2,{steps:6});
  assert.ok(await p.locator('.env-bubble').isVisible(),'value bubble while dragging');
  await p.mouse.up();
  const after=await val3('0-attack');
  assert.notEqual(after,before,'attack knob follows the handle: '+before+' → '+after);
  const s0=await val3('0-sustain');
  const d=await p.locator('[data-handle="d"] circle').last().boundingBox();
  await p.mouse.move(d.x+d.width/2,d.y+d.height/2);await p.mouse.down();
  await p.mouse.move(d.x+d.width/2,d.y+d.height/2-40,{steps:6});await p.mouse.up();
  assert.ok(parseInt(await val3('0-sustain'))>parseInt(s0),'dragging up raises sustain');
  const eb=await envSheet.boundingBox();assert.ok(eb.y+eb.height<=722,'envelope sheet fits');
  await p.screenshot({path:path.join(ROOT,'..','artifacts','envelope-722.png')});
  await p.keyboard.press('Escape');
  assert.equal(await envSheet.count(),0,'Esc closes the envelope sheet');
  assert.equal(await val('0-attack'),after,'the card knob shows the same attack');
  // No stretched graphs with dots anywhere in the frame.
  assert.equal(await p.locator('.frame svg[preserveAspectRatio="none"] circle').count(),0,'no stretched dots');
  // Header hint moved to Help.
  assert.equal(await p.getByText("Tap the pad's label to link it").count(),0);

  // Macro 1: link Brightness, then drag the knob's outer ring to set the depth (+25 % for 50 px up on a small ring).
  await p.getByRole('button',{name:'Link Macro 1 to knobs'}).click();
  const knob=p.locator('[data-param="0-brightness"] .knob-svg');
  const k=await knob.boundingBox();const cx=k.x+k.width/2,cy=k.y+k.height/2;
  await p.mouse.click(cx,cy);
  await p.mouse.move(cx+k.width*.42,cy);await p.mouse.down();
  await p.mouse.move(cx+k.width*.42,cy-50,{steps:8});
  assert.match(await p.locator('.ring-bubble').innerText(),/\+75%/,'bubble shows the depth while dragging');
  await p.mouse.up();
  assert.equal(await p.locator('.ring-bubble').count(),0);
  await p.getByRole('button',{name:'Done'}).click();

  // The macro editor: no copied slider, a link summary, and the shared link sheet.
  assert.equal(await p.locator('.pad-editor input[type=range]').count(),0,'macro slider is gone');
  await p.locator('.pad-editor').getByRole('textbox',{name:'Macro 1 name'}).fill('Bright');
  assert.ok(await p.getByRole('button',{name:'Link Bright to knobs'}).isVisible(),'rename from the title');
  await p.locator('.pad-editor').getByRole('button',{name:/Edit links/}).click();
  const sheet=p.getByRole('dialog',{name:'Macro 1 links'});
  await sheet.waitFor();
  const depth=sheet.getByRole('slider',{name:/Depth .*Brightness/});
  assert.equal(await depth.getAttribute('aria-valuenow'),'75','ring drag set the stored depth');
  // Long-press the bar to type an exact value.
  const db=await depth.boundingBox();
  await p.mouse.move(db.x+db.width/2,db.y+db.height/2);await p.mouse.down();await p.waitForTimeout(800);await p.mouse.up();
  const input=sheet.getByRole('textbox',{name:/Depth .*Brightness value/});
  await input.fill('-30');await input.press('Enter');
  assert.equal(await sheet.getByRole('slider',{name:/Depth .*Brightness/}).getAttribute('aria-valuenow'),'-30');
  await p.screenshot({path:path.join(ROOT,'..','artifacts','macro-sheet-722.png')});
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('.mod-sheet').count(),0,'Esc closes the sheet');
  assert.deepEqual(errs,[]);
  console.log('visuals_depth_acceptance: ok');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
