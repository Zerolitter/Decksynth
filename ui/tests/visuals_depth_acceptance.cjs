// Preview UI test for sections E and F: the envelope editor, on-knob depth while linking, the macro link sheet,
// exact depth entry, and no stretched graphs.
'use strict';
require('./deck_guard.cjs');
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
  const val=id=>p.locator(`[data-param="${id}"] .knob-value`).innerText();

  // Rule 42 keeps ADSR knobs in their card and the editable envelope on the large graph.
  assert.equal(await p.getByRole('tab',{name:'Envelope'}).count(),0,'no Envelope tab');
  assert.equal(await p.locator('[data-panel="rack-envelope"] .env-editor').count(),0,'Amp envelope card does not duplicate the graph editor');
  await p.getByRole('radio',{name:'Amp env',exact:true}).click();
  const env=p.locator('.ss-graph.view-amp .env-editor');await env.waitFor({state:'visible'});
  const before=await val('0-attack'),a=await env.locator('[data-handle="a"] circle').last().boundingBox();
  await p.mouse.move(a.x+a.width/2,a.y+a.height/2);await p.mouse.down();await p.mouse.move(a.x+a.width/2+15,a.y+a.height/2,{steps:6});assert.ok(await p.locator('.env-bubble').isVisible());await p.mouse.up();
  const after=await val('0-attack');assert.notEqual(after,before,'attack follows the inline handle');
  const s0=await val('0-sustain'),d=await env.locator('[data-handle="d"] circle').last().boundingBox();await p.mouse.move(d.x+d.width/2,d.y+d.height/2);await p.mouse.down();await p.mouse.move(d.x+d.width/2,d.y+d.height/2-15,{steps:6});await p.mouse.up();assert.ok(parseInt(await val('0-sustain'))>parseInt(s0));
  assert.equal(await p.getByRole('dialog',{name:'Envelope'}).count(),0,'no envelope overlay');
  await p.screenshot({path:path.join(ROOT,'..','artifacts','envelope-722.png')});
  // No stretched graphs with dots anywhere in the frame.
  assert.equal(await p.locator('.frame svg[preserveAspectRatio="none"] circle').count(),0,'no stretched dots');
  // Header hint moved to Help.
  assert.equal(await p.getByText("Tap the pad's label to link it").count(),0);

  // Macro 1: link Brightness, then drag the knob's outer ring to set the depth (+25 % for 50 px up on a small ring).
  await p.getByRole('tab',{name:'Link',exact:true}).click();
  await p.getByRole('button',{name:'Link Macro 1 to knobs'}).click();
  await p.getByRole('tab',{name:'Sound',exact:true}).click();
  const knob=p.locator('[data-param="0-brightness"] .knob-svg');
  const k=await knob.boundingBox();const cx=k.x+k.width/2,cy=k.y+k.height/2;
  await p.mouse.click(cx,cy);
  await p.mouse.move(cx+k.width*.42,cy);await p.mouse.down();
  await p.mouse.move(cx+k.width*.42,cy-50,{steps:8});
  assert.match(await p.locator('.ring-bubble').innerText(),/\+75%/,'bubble shows the depth while dragging');
  await p.mouse.up();
  assert.equal(await p.locator('.ring-bubble').count(),0);
  await p.getByRole('button',{name:'Linking Macro 1: tap to stop',exact:true}).click();

  // The Link page owns modulation: no copied slider, a link summary, and direct exact depth entry.
  await p.getByRole('tab',{name:'Link',exact:true}).click();
  const editor=p.locator('.lp-editor').filter({has:p.getByRole('textbox',{name:'Macro 1 name'})});
  assert.equal(await editor.locator('input[type=range]').count(),0,'macro slider is gone');
  await editor.getByRole('textbox',{name:'Macro 1 name'}).fill('Bright');
  assert.ok(await p.getByRole('button',{name:'Link Bright to knobs'}).isVisible(),'rename from the title');
  const links=p.locator('.lp-links');
  const depth=links.getByRole('slider',{name:/Depth .*Brightness/});
  assert.equal(await depth.getAttribute('aria-valuenow'),'75','ring drag set the stored depth');
  // Long-press the bar to type an exact value.
  const db=await depth.boundingBox();
  await p.mouse.move(db.x+db.width/2,db.y+db.height/2);await p.mouse.down();await p.waitForTimeout(800);await p.mouse.up();
  const input=links.getByRole('textbox',{name:/Depth .*Brightness value/});
  await input.fill('-30');await input.press('Enter');
  assert.equal(await links.getByRole('slider',{name:/Depth .*Brightness/}).getAttribute('aria-valuenow'),'-30');
  await p.screenshot({path:path.join(ROOT,'..','artifacts','macro-links-722.png')});
  await p.keyboard.press('Escape');
  assert.equal(await links.getByRole('textbox',{name:/Depth .*Brightness value/}).count(),0,'Esc exits exact depth entry');
  assert.deepEqual(errs,[]);
  console.log('visuals_depth_acceptance: ok');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
