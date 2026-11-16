// Preview UI test for section A: nothing hides under the keyboard at Sir's 720 px window,
// the step record cursor moves on with each key, and link mode can be left by a blank tap or Esc.
'use strict';
const {_electron}=require('playwright');
const path=require('node:path');
const assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
const size=(app,h)=>app.evaluate(({BrowserWindow},h)=>BrowserWindow.getAllWindows()[0].setContentSize(1280,h),h);
// Every button inside the Perform panel must be the top element at its own centre.
async function covered(p){
  return p.evaluate(()=>[...document.querySelectorAll('.pf button')].filter(b=>{
    const r=b.getBoundingClientRect();if(!r.width||!r.height)return false;
    const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return !(hit&&(hit===b||b.contains(hit)));
  }).map(b=>(b.getAttribute('aria-label')||b.textContent||'?').trim()));
}
(async()=>{
 const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,
  env:{...process.env,DECKSYNTH_UI_PREVIEW:'1',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 try{
  const p=await app.firstWindow({timeout:15000});
  p.setDefaultTimeout(8000);
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.getByRole('tab',{name:/^Perform$/}).click();
  await p.locator('.pf').waitFor({state:'visible'});

  // 1. Nothing covered, in every mode, at 720 and 800 px.
  for(const h of [722,800]){
    await size(app,h);await p.waitForTimeout(300);
    for(const mode of ['Seq','Arp','Chord']){
      await p.getByRole('tab',{name:new RegExp('^'+mode)}).click();await p.waitForTimeout(80);
      assert.deepEqual(await covered(p),[],mode+' at '+h+' px: covered buttons');
    }
    await p.getByRole('tab',{name:/^Seq/}).click();
    await p.getByRole('button',{name:'Step rec'}).click();
    assert.deepEqual(await covered(p),[],'Seq with Step rec on at '+h+' px');
    await p.getByRole('button',{name:'Step rec'}).click();
  }

  // 2. Step record: each key goes to the next step, Rest skips, Back clears.
  await size(app,722);await p.waitForTimeout(200);
  await p.getByRole('button',{name:'Clear pattern'}).count();
  await p.getByRole('button',{name:'Step rec'}).click();
  const key=async n=>{const b=await p.locator('[data-note="'+n+'"]').first().boundingBox();
    await p.mouse.move(b.x+b.width/2,b.y+b.height*.8);await p.mouse.down();await p.waitForTimeout(40);await p.mouse.up();await p.waitForTimeout(60);};
  await key(60);await key(62);
  assert.equal(await p.locator('[data-testid="pf-cell-1-60"] .pf-note').count(),1,'first key on step 1');
  assert.equal(await p.locator('[data-testid="pf-cell-2-62"] .pf-note').count(),1,'second key on step 2');
  assert.equal(await p.locator('.pf-grid-head span.rec').innerText(),'3','cursor on step 3');
  await p.getByRole('button',{name:'Rest ▶'}).click();await key(64);
  assert.equal(await p.locator('[data-testid="pf-cell-4-64"] .pf-note').count(),1,'rest skipped step 3');
  await p.getByRole('button',{name:'◀ Back'}).click();
  assert.equal(await p.locator('[data-testid="pf-cell-4-64"] .pf-note').count(),0,'back clears step 4');
  assert.match(await p.locator('.pf-info').first().innerText(),/rec step 4/);
  await p.screenshot({path:path.join(ROOT,'..','artifacts','perform-steprec-722.png')});
  await p.getByRole('button',{name:'Step rec'}).click();

  // 3. Link mode: blank tap and Esc both end it.
  await size(app,800);await p.getByRole('tab',{name:/^FX$/}).click();
  const lip=p.getByRole('button',{name:'Link Mod pad 2 to knobs'});
  await lip.click();assert.equal(await p.locator('.pad-editor.linking').count(),1,'link mode on');
  const blank=await p.locator('.fx-page, .frame-window, .page-body').first().boundingBox();
  // a spot with no control: the page edge just inside the bottom-right corner
  const spot=await p.evaluate(()=>{for(let y=780;y>120;y-=8)for(let x=1270;x>700;x-=8){const e=document.elementFromPoint(x,y);
    if(e&&!e.closest('button,input,select,a,[role="button"],[role="slider"],[role="tab"],.parameter-knob,.mod-band,.pad-editor'))return [x,y];}return null;});
  assert.ok(spot&&blank,'found a blank spot');
  await p.mouse.click(spot[0],spot[1]);
  assert.equal(await p.locator('.pad-editor.linking').count(),0,'blank tap ends link mode');
  await lip.click();assert.equal(await p.locator('.pad-editor.linking').count(),1);
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('.pad-editor.linking').count(),0,'Esc ends link mode');
  await lip.click();await p.locator('[data-testid^="knob-"]').first().click();
  assert.equal(await p.locator('.pad-editor.linking').count(),1,'tapping a knob keeps link mode');
  await p.keyboard.press('Escape');

  assert.deepEqual(errs,[]);
  console.log('perform_fixes_acceptance: ok');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
