'use strict';
// Touch on the Perform note grid, with real CDP touch events (no mouse):
// tap empty = add, tap a note in Draw = remove it, drag the note end inside the finger zone = longer,
// two-finger pinch = zoom time without leaving a note behind. Also the "Hear notes while editing" switch.
require('./deck_guard.cjs');
const {_electron}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-touch-grid-'));
(async()=>{const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DATA_DIR:data,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 try{const p=await app.firstWindow();p.setDefaultTimeout(8000);await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
  await p.setViewportSize({width:1280,height:720});await p.waitForFunction(()=>innerWidth===1280&&innerHeight===720,null,{timeout:5000});
  await p.evaluate(()=>{window.__grid=null;window.deckApi.onMessage(m=>{if(m.state)window.__grid=m.state;});});
  await p.getByRole('tab',{name:'Perform',exact:true}).click();await p.locator('.compact-roll').waitFor();await p.waitForTimeout(400);
  await p.getByRole('button',{name:'Draw notes'}).click();
  const cdp=await p.context().newCDPSession(p);
  const touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
  const centre=async id=>{const b=await p.getByTestId(id).boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2,b};};
  const tap=async pt=>{await touch('touchStart',[{x:pt.x,y:pt.y,id:1}]);await p.waitForTimeout(40);await touch('touchEnd',[]);await p.waitForTimeout(150);};
  const notes=()=>p.locator('.pf-note').count();

  const c1=await centre('pf-cell-1-67');await tap(c1);
  await p.waitForFunction(()=>document.querySelectorAll('.pf-note').length===1);
  await tap(c1);await p.waitForFunction(()=>document.querySelectorAll('.pf-note').length===0,null,{timeout:3000});
  console.log('PASS: touch tap adds a note, a second tap on it removes it (Draw)');

  await tap(c1);await p.waitForFunction(()=>document.querySelectorAll('.pf-note').length===1);
  const note=await p.locator('.pf-note').first().boundingBox();
  // Press 12 px inside the right end (outside the 9 px mouse zone, inside the 18 px finger zone) and drag 2 cells right.
  const ex=note.x+note.width-12,ey=note.y+note.height/2;
  await touch('touchStart',[{x:ex,y:ey,id:2}]);for(let i=1;i<=8;i++)await touch('touchMove',[{x:ex+i*c1.b.width/4,y:ey,id:2}]);await touch('touchEnd',[]);
  await p.waitForTimeout(250);
  const longer=await p.locator('.pf-note').first().boundingBox();
  assert.equal(await notes(),1,'still one note');
  assert.ok(longer.width>note.width+c1.b.width*1.5,'finger end zone resizes: '+note.width+' -> '+longer.width);
  console.log('PASS: the finger end zone makes the note longer');

  const grid=await p.locator('.compact-roll').boundingBox(),gy=grid.y+grid.height/2,gx=grid.x+grid.width/2;
  const stored=()=>p.evaluate(()=>JSON.stringify(window.__grid?.performance?.patterns??null));const storedBefore=await stored();
  const before=Number(await p.locator('.compact-roll').getAttribute('data-time-px'));
  await touch('touchStart',[{x:gx-40,y:gy,id:3}]);await touch('touchStart',[{x:gx-40,y:gy,id:3},{x:gx+40,y:gy,id:4}]);
  for(let i=1;i<=8;i++)await touch('touchMove',[{x:gx-40-i*12,y:gy,id:3},{x:gx+40+i*12,y:gy,id:4}]);
  await touch('touchEnd',[]);await p.waitForTimeout(300);
  const after=Number(await p.locator('.compact-roll').getAttribute('data-time-px'));
  assert.ok(after>before*1.4,'pinch out zooms time: '+before+' -> '+after);
  // The grid draws only the cells in view, so count the notes in the engine's pattern.
  assert.equal(await stored(),storedBefore,'pinching added or removed no note');
  console.log('PASS: two-finger pinch zooms time and edits nothing');

  await p.getByRole('button',{name:'Settings'}).click();
  const sw=p.getByRole('switch',{name:'Hear notes while editing'});assert.equal(await sw.isChecked(),true,'on by default (rule 21)');
  await sw.click();assert.equal(await sw.isChecked(),false);await p.keyboard.press('Escape');
  console.log('PASS: Hear notes while editing switch in Settings');
 }finally{await app.close();fs.rmSync(data,{recursive:true,force:true});}
})().catch(error=>{console.error('FAIL',error.stack||error);process.exitCode=1;});
