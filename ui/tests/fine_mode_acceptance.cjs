// Fine-mode gesture acceptance: stationary 400 ms hold and a second touch before/during drag.
'use strict';
require('./deck_guard.cjs');
const {_electron}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-fine-'));
(async()=>{
 const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,
  env:{...process.env,DECKSYNTH_UI_PREVIEW:'1',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 try{
  const p=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
  await p.locator('.decksynth-shell').waitFor({state:'visible',timeout:20000});
  await p.getByRole('tab',{name:/^Perform/}).click();
  await p.getByRole('tab',{name:/^Seq/}).click();
  const dial=p.locator('[data-param="pf-seq-swing"]').getByRole('slider');
  await dial.waitFor({state:'visible'});
  const r=await dial.boundingBox(),x=r.x+r.width/2,y=r.y+r.height/2;
  const fine=()=>p.locator('.knob-fine-indicator');
  const waitFine=()=>fine().waitFor({state:'visible',timeout:1200});
  const waitNormal=()=>fine().waitFor({state:'detached',timeout:1200});
  const down=async()=>{await p.mouse.move(x,y);await p.mouse.down();};
  const move=async(dy)=>p.mouse.move(x,y+dy,{steps:1});
  const up=async()=>p.mouse.up();
  const second=async(id,type)=>p.evaluate(({id,type})=>{const e=new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',isPrimary:false,button:0,buttons:type==='pointerdown'?1:0,clientX:900,clientY:600});document.body.dispatchEvent(e);return e.defaultPrevented;},{id,type});

  await down();await waitFine();
  await move(-3.5);await up();await waitNormal();

  await down();
  if(!await second(9001,'pointerdown'))throw Error('second touch before movement must be captured by the active knob');
  await waitFine();
  await second(9001,'pointerup');await waitNormal();
  await up();
  // Knob double-tap reset owns two primary presses within 330 ms; this next
  // case must begin a new drag, not deliberately exercise that separate gesture.
  await p.waitForTimeout(360);

  const beforeDrag=Number(await dial.getAttribute('aria-valuenow'));
  await down();await move(-10);
  await p.waitForFunction(before=>Number(document.querySelector('[data-param="pf-seq-swing"] [role="slider"]')?.getAttribute('aria-valuenow'))!==before,beforeDrag,{timeout:1200});
  if(!await second(9002,'pointerdown'))throw Error('second touch during drag must be captured by the active knob');
  await waitFine();
  await second(9002,'pointerup');await waitNormal();
  await up();
  console.log('PASS: 400 ms hold, second touch before movement, second touch mid-drag, event ownership and release reset');
 }finally{await app.close();fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
