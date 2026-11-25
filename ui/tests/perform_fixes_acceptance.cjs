// Preview UI test for section A: nothing hides under the keyboard at Sir's 720 px window,
// the step record cursor moves on with each key, and link mode can be left by a blank tap or Esc.
'use strict';
require('./deck_guard.cjs');
const {_electron}=require('playwright');
const path=require('node:path');
const assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
async function size(app,p,h){
  await p.setViewportSize({width:1280,height:h});
  await p.waitForFunction(h=>innerWidth===1280&&innerHeight===h,h,{timeout:5000});
}
// Every button inside the Perform panel must be the top element at its own centre.
async function covered(p){
  return p.evaluate(()=>[...document.querySelectorAll('.pf button')].filter(b=>{
    const r=b.getBoundingClientRect();if(!r.width||!r.height)return false;
    // Piano-roll rows are virtualised in a scroll viewport. Ignore row buttons whose centres
    // are outside that viewport; performance_ui_acceptance verifies the visible row set and
    // actual drawing/erasing behavior. Header, lane and keyboard controls remain fully audited.
    if(b.closest('.note-editor-row')){
      const g=document.querySelector('.pf-grid')?.getBoundingClientRect();if(!g)return false;
      const x=r.x+r.width/2,y=r.y+r.height/2;
      if(x<g.left||x>g.right||y<g.top+24||y>g.bottom)return false;
    }
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

  // 1. Nothing covered, in every mode, at the exact 720 and 800 px target viewports.
  for(const h of [720,800]){
    await size(app,p,h);await p.waitForTimeout(300);
    for(const mode of ['Seq','Arp','Chord']){
      await p.getByRole('tab',{name:new RegExp('^'+mode)}).click();await p.waitForTimeout(80);
      if(h===720&&mode==='Chord'){
        // Regression: these are real touch-sized controls, not merely visible DOM. At 720 px
        // the Loop row must receive its Playwright clicks and update the live chord state.
        const loop=p.getByRole('button',{name:'Loop the strum'});
        const rates=p.getByRole('group',{name:'Loop rate'});
        assert.equal(await loop.getAttribute('aria-pressed'),'false','Loop starts off');
        for(const rate of ['1/8','1/4','1/2','Bar'])assert.equal(await rates.getByRole('button',{name:rate,exact:true}).isDisabled(),true,rate+' disabled until Loop is on');
        await loop.click();
        assert.equal(await loop.getAttribute('aria-pressed'),'true','Loop click turns it on');
        for(const rate of ['1/8','1/4','1/2','Bar']){
          const button=rates.getByRole('button',{name:rate,exact:true});
          assert.equal(await button.isDisabled(),false,rate+' enabled with Loop on');
          await button.click();
          assert.equal(await button.getAttribute('aria-pressed'),'true',rate+' click selects that rate');
        }
        await loop.click();
        assert.equal(await loop.getAttribute('aria-pressed'),'false','Loop click turns it off');
        // Playwright scrolls overflow-hidden ancestors while preparing a click. Restore the
        // physical, unscrolled panel before auditing every control's actual centre hit target.
        await p.locator('.pf-ctl-chord').evaluate(node=>{node.scrollTop=0;});
      }
      assert.deepEqual(await covered(p),[],mode+' at '+h+' px: covered buttons');
    }
    await p.getByRole('tab',{name:/^Seq/}).click();
    await p.getByRole('button',{name:'Step rec'}).click();
    assert.deepEqual(await covered(p),[],'Seq with Step rec on at '+h+' px');
    await p.getByRole('button',{name:'Step rec'}).click();
  }

  // 2. Step record: each key goes to the next step, Rest skips, Back clears.
  await size(app,p,720);await p.waitForTimeout(200);
  await p.getByRole('button',{name:'Clear pattern'}).count();
  await p.getByRole('button',{name:'Step rec'}).click();
  const key=async n=>{const b=await p.locator('[data-note="'+n+'"]').first().boundingBox();
    await p.mouse.move(b.x+b.width/2,b.y+b.height*.8);await p.mouse.down();await p.waitForTimeout(40);await p.mouse.up();await p.waitForTimeout(60);};
  // The compact roll virtualizes pitches outside its rendered buffer. Use visible keyboard
  // pitches so these assertions inspect the real cells that the player sees and edits.
  await key(67);await key(69);
  assert.equal(await p.locator('[data-testid="pf-cell-1-67"] .pf-note').count(),1,'first key on step 1');
  assert.equal(await p.locator('[data-testid="pf-cell-2-69"] .pf-note').count(),1,'second key on step 2');
  assert.match(await p.locator('.pf-info').first().innerText(),/rec step 3/,'cursor on step 3');
  await p.getByRole('button',{name:'Rest ▶'}).click();await key(71);
  assert.equal(await p.locator('[data-testid="pf-cell-4-71"] .pf-note').count(),1,'rest skipped step 3');
  await p.getByRole('button',{name:'◀ Back'}).click();
  assert.equal(await p.locator('[data-testid="pf-cell-4-71"] .pf-note').count(),0,'back clears step 4');
  assert.match(await p.locator('.pf-info').first().innerText(),/rec step 4/);
  await p.screenshot({path:path.join(ROOT,'..','artifacts','perform-steprec-720.png')});
  await p.getByRole('button',{name:'Step rec'}).click();

  // 3. Link mode: blank tap and Esc both end it.
  await size(app,p,800);await p.getByRole('tab',{name:/^Link$/}).click();
  const arm=async()=>{
    await p.getByRole('tab',{name:/^Link$/}).click();
    await p.getByRole('button',{name:'Link Mod pad 2 to knobs'}).click();
    assert.equal(await p.locator('.link-box.lit').count(),1,'link mode on');
    await p.getByRole('tab',{name:/^Sound$/}).click();
  };
  await arm();
  const blank=await p.locator('.frame-window, .page-body').first().boundingBox();
  // a spot with no control: the page edge just inside the bottom-right corner
  const spot=await p.evaluate(()=>{for(let y=780;y>120;y-=8)for(let x=1270;x>700;x-=8){const e=document.elementFromPoint(x,y);
    if(e&&!e.closest('button,input,select,a,[role="button"],[role="slider"],[role="tab"],.parameter-knob,.mod-band,.pad-editor'))return [x,y];}return null;});
  assert.ok(spot&&blank,'found a blank spot');
  await p.mouse.click(spot[0],spot[1]);
  assert.equal(await p.locator('.link-box.lit').count(),0,'blank tap ends link mode');
  await arm();
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('.link-box.lit').count(),0,'Esc ends link mode');
  await arm();await p.getByTestId('knob-0-brightness').click();
  assert.equal(await p.locator('.link-box.lit').count(),1,'tapping a knob keeps link mode');
  await p.keyboard.press('Escape');

  assert.deepEqual(errs,[]);
  console.log('perform_fixes_acceptance: ok');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
