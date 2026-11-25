// Every knob and value box has the gestures Help describes (Sir, 16 Nov). Visits every page and instrument at
// 1280 x HEIGHT and checks: every knob resets on a double-tap (it knows its default) and has a value box; numbers are
// value boxes, never number fields, native selects with more than 4 options or − / + stepper pairs; a value box
// arms on click and turns with the wheel, and a knob's value box turns with a hold and drag.
'use strict';
require('./deck_guard.cjs');
const {_electron}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
const H=Number(process.env.HEIGHT||718);
const data=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-gestures-'));
(async()=>{
 const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,
  env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DATA_DIR:data,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 const errs=[];
 try{
  const p=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
  p.on('pageerror',e=>errs.push(e.message));
  await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'),null,{timeout:20000});
  for(let i=0;i<30;i++){await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];if(w.isMaximized())w.unmaximize();w.setContentSize(1280,h);},H);
   await p.waitForTimeout(150);if(await p.evaluate(h=>innerWidth===1280&&innerHeight===h,H))break;}
  const tab=n=>p.getByRole('tab',{name:new RegExp('^'+n+'$','i')}).first().click();
  const instrument=n=>p.getByRole('radiogroup',{name:'Track instrument'}).getByRole('radio',{name:n,exact:true}).click();
  const bad=[];let knobs=0,boxes=0;
  const scan=async view=>{
   await p.waitForTimeout(400);
   const r=await p.evaluate(()=>{
    const shown=e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0;};
    const out=[];
    const ks=[...document.querySelectorAll('.parameter-knob')].filter(shown);
    for(const k of ks){
     if(k.dataset.resettable!=='1')out.push('knob without a default (double-tap reset): '+k.dataset.param);
     if(!k.querySelector('.knob-value,.knob-entry'))out.push('knob without a value box: '+k.dataset.param);
    }
    const vb=[...document.querySelectorAll('.vbox')].filter(shown);
    for(const i of [...document.querySelectorAll('input[type=number],input[type=range]')].filter(shown))out.push('number field: '+(i.getAttribute('aria-label')||i.className));
    for(const s of [...document.querySelectorAll('select')].filter(shown))if(s.options.length>4)out.push('native select with '+s.options.length+' options: '+(s.getAttribute('aria-label')||s.className));
    for(const b of [...document.querySelectorAll('button[aria-label]')].filter(shown))
     if(/^(Fewer|More|Shorter|Longer) (steps|arp steps|song|block)$|an octave (up|down)$|^Inversion (up|down)$|later clip bar|earlier clip bar/.test(b.getAttribute('aria-label')))out.push('stepper button: '+b.getAttribute('aria-label'));
    return {out,knobs:ks.length,boxes:vb.length};
   });
   knobs+=r.knobs;boxes+=r.boxes;
   for(const o of r.out)bad.push(view+': '+o);
   console.log(view,'knobs',r.knobs,'value boxes',r.boxes,r.out.length?'problems '+r.out.length:'ok');
  };
  await tab('Song');await scan('song');
  await tab('Sound');await instrument('Synth');await scan('sound-synth');
  await instrument('Drum Rack');await p.waitForTimeout(600);await scan('sound-drums');
  await instrument('Sampler');await p.waitForTimeout(600);await scan('sound-sampler');
  await instrument('Synth');
  await tab('FX');await scan('fx');
  await tab('Link');await scan('link');
  await tab('Perform');await scan('perform-seq');
  for(const m of ['Arp','Chord']){await p.getByRole('tab',{name:new RegExp('^'+m)}).click();await scan('perform-'+m.toLowerCase());}
  await p.getByRole('tab',{name:/^Seq/}).click();

  // A value box: click arms it, the wheel moves it (one change when it rests).
  const steps=p.getByRole('spinbutton',{name:'Pattern steps'});
  const before=Number(await steps.getAttribute('aria-valuenow'));
  await steps.click();const sb=await steps.boundingBox();await p.mouse.move(sb.x+sb.width/2,sb.y+sb.height/2);
  await p.mouse.wheel(0,-100);await p.waitForTimeout(500);
  assert.equal(Number(await steps.getAttribute('aria-valuenow')),before+1,'wheel on an armed value box steps it');
  await steps.focus();await steps.press('ArrowDown');await p.waitForTimeout(450);

  // A knob's value box: hold and drag up moves the value; double-tap on the knob resets it.
  const swing=p.locator('[data-param="pf-seq-swing"]');
  const box=swing.locator('.knob-value'),dial=swing.getByRole('slider');
  const v0=Number(await dial.getAttribute('aria-valuenow'));
  const bb=await box.boundingBox();
  await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2);await p.mouse.down();
  for(let y=1;y<=8;y++)await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2-y*6);
  await p.mouse.up();await p.waitForTimeout(300);
  const v1=Number(await dial.getAttribute('aria-valuenow'));
  assert.ok(v1>v0,'dragging a knob value box up raises it ('+v0+' -> '+v1+')');
  const db=await dial.boundingBox();
  await p.mouse.click(db.x+db.width/2,db.y+db.height/2);await p.mouse.click(db.x+db.width/2,db.y+db.height/2);
  await p.waitForTimeout(300);
  assert.equal(Number(await dial.getAttribute('aria-valuenow')),50,'double-tap resets Swing to 50 %');

  // Settings › Knob pop-up value off hides the pop-up; the value box still shows the value (Sir, 16 Nov).
  await p.getByRole('button',{name:'Settings',exact:true}).click();await p.getByRole('tab',{name:'Display',exact:true}).click();
  await p.getByRole('switch',{name:'Knob pop-up value'}).uncheck();
  await p.getByRole('dialog',{name:'Settings'}).getByRole('button',{name:/CLOSE/}).click();
  await p.mouse.move(db.x+db.width/2,db.y+db.height/2);await p.mouse.down();await p.mouse.move(db.x+db.width/2,db.y+db.height/2-30,{steps:5});
  assert.equal(await p.locator('.knob-live-value').evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().width>0).length),0,'no pop-up while turning');
  await p.mouse.up();
  assert.ok(await box.isVisible(),'the value box stays');
  await p.getByRole('button',{name:'Settings',exact:true}).click();await p.getByRole('tab',{name:'Display',exact:true}).click();
  await p.getByRole('switch',{name:'Knob pop-up value'}).check();
  await p.getByRole('dialog',{name:'Settings'}).getByRole('button',{name:/CLOSE/}).click();
  console.log('knobs',knobs,'value boxes',boxes);
  if(errs.length)bad.push('page errors: '+errs.join('; '));
  if(bad.length){console.error('FAIL\n'+bad.join('\n'));process.exitCode=1;}
  else console.log('PASS: every knob resets and has a value box; no number fields, long selects or steppers; wheel and drag work');
 }finally{await app.close();fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
