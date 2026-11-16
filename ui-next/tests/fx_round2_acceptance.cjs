// Round 2 effects (16 Nov): Pitch shift, Auto-tune, Ducking and Vocoder in the FX rack.
// Ducking and Vocoder pick another track; their own track is offered but disabled, with a hint.
'use strict';
const {_electron}=require('playwright');
const path=require('node:path');
const assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.OUT?path.resolve(ROOT,process.env.OUT):path.join(ROOT,'docs');
const H=Number(process.env.HEIGHT||718);
(async()=>{
 const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,
  env:{...process.env,DECKSYNTH_UI_PREVIEW:'1',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 try{
  const p=await app.firstWindow({timeout:15000});
  p.setDefaultTimeout(8000);
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await app.evaluate(({BrowserWindow},h)=>BrowserWindow.getAllWindows()[0].setContentSize(1280,h),H);
  await p.getByRole('tab',{name:/^FX$/}).click();
  const add=async name=>{
    await p.getByRole('button',{name:'Add effect'}).click();
    const sheet=p.getByRole('dialog',{name:'Add effect'});
    const b=sheet.getByRole('button',{name:'Add '+name});
    await b.scrollIntoViewIfNeeded();
    const r=await b.boundingBox();assert.ok(r.height>=44,name+' button is 44 px');
    await b.click();
    if(await p.locator('.fx-picker-sheet').count())await p.keyboard.press('Escape');
  };
  for(const n of ['Pitch shift','Auto-tune','Ducking','Vocoder'])await add(n);

  const pitch=p.locator('[data-panel="fx-pitch"]');
  assert.ok(await pitch.isVisible(),'pitch card');
  assert.ok(await pitch.getByText('Semitones',{exact:true}).isVisible());
  assert.ok(await pitch.getByText('Cents',{exact:true}).isVisible());
  assert.equal(await pitch.locator('[aria-label="Cents value box"]').count(),1,'cents is a knob with a value box');

  const tune=p.locator('[data-panel="fx-autotune"]');
  assert.ok(await tune.getByRole('status',{name:'Auto-tune hears'}).isVisible(),'auto-tune shows what it hears');
  for(const k of ['Speed','Amount','Mix'])assert.ok(await tune.getByText(k,{exact:true}).isVisible(),k);

  const duck=p.locator('[data-panel="fx-duck"]');
  const pick=duck.getByRole('radiogroup',{name:'Ducking Ducked by'});
  assert.ok(await pick.isVisible(),'ducking track picker');
  const opts=pick.getByRole('radio');
  assert.ok(await opts.count()>=4,'every track is listed');
  assert.ok(await opts.first().isDisabled(),'its own track is not a choice');
  assert.ok(await duck.getByText(/can't drive itself/).isVisible(),'hint while it points at itself');
  const r=await opts.nth(1).boundingBox();assert.ok(r.height>=44,'track buttons are 44 px');
  await opts.nth(1).click();
  await p.waitForTimeout(300);
  assert.equal(await opts.nth(1).getAttribute('aria-checked'),'true','ducked by track 2');
  assert.match(await opts.nth(1).innerText(),/Bass/,'tracks show their names');
  assert.equal(await duck.getByText(/can't drive itself/).count(),0,'hint gone');
  assert.ok(await duck.getByRole('meter',{name:'Ducking now'}).isVisible(),'ducking meter');

  const voc=p.locator('[data-panel="fx-vocoder"]');
  const vpick=voc.getByRole('radiogroup',{name:'Vocoder Voice from'});
  await vpick.getByRole('radio').nth(2).click();await p.waitForTimeout(300);
  assert.equal(await vpick.getByRole('radio').nth(2).getAttribute('aria-checked'),'true');
  for(const k of ['Response','Formant','Air'])assert.ok(await voc.getByText(k,{exact:true}).count(),k);

  await pitch.scrollIntoViewIfNeeded();
  await p.screenshot({path:path.join(OUT,`fx-round2-${H}.png`)});
  await voc.scrollIntoViewIfNeeded();
  await p.screenshot({path:path.join(OUT,`fx-round2-b-${H}.png`)});
  assert.deepEqual(errs,[]);
  console.log(`PASS: round 2 effects at 1280×${H}: four new cards, track pickers skip their own track, readouts shown`);
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
