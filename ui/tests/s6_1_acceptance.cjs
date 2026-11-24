'use strict';
// S6.1 is exercised against the isolated test worker with SDL's dummy driver.
// It does not connect to the active MIDI device or audio service.
const {_electron}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-s61-'));
const screenshots=process.env.DECKSYNTH_S61_SCREEN_DIR;

async function setSize(app,page,height){
 await page.setViewportSize({width:1280,height});
 await page.waitForFunction(h=>innerWidth===1280&&innerHeight===h,height);
}

(async()=>{
 const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),args:['electron/playwright-main.cjs'],cwd:ROOT,
  env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DATA_DIR:data,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 try{
  const page=await app.firstWindow();page.setDefaultTimeout(8000);
  await page.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
  await page.evaluate(()=>{window.__s61Errors=[];window.deckApi.onMessage(message=>{if(message.state)window.__s61=message;if(message.error)window.__s61Errors.push(message.error);});});
  await page.waitForFunction(()=>window.__s61?.state);
  await page.getByRole('tab',{name:'Perform',exact:true}).click();
  await page.locator('.compact-roll').waitFor({state:'visible'});
  for(const height of [720,800]){
   await setSize(app,page,height);
   for(const name of ['Snap to grid','Legato notes'])assert.equal(await page.getByRole('button',{name}).count(),1,name+' remains available at 1280x'+height);
   assert.equal(await page.getByRole('slider',{name:'Overview viewport'}).count(),1,'one overview in the toolbar at 1280x'+height);
   if(screenshots)await page.screenshot({path:path.join(screenshots,'s6_1-1280x'+height+'.png')});
  }
  await setSize(app,page,720);
  await page.getByRole('button',{name:'Draw notes'}).click();
  const cell=page.getByTestId('pf-cell-1-67');
  await cell.click();
  await page.waitForFunction(()=>document.querySelectorAll('.pf-note').length===1);
  await page.keyboard.press('Control+z');
  await page.waitForFunction(()=>document.querySelectorAll('.pf-note').length===0);
  await page.getByRole('button',{name:'Redo'}).waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('[aria-label="Redo"]')?.hasAttribute('disabled'));
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.pf-note').count(),1,'Ctrl+Shift+Z restores the undone note');
  await page.evaluate(()=>window.deckApi.send('perform_set',['seq','length',64]));
  await page.evaluate(()=>window.deckApi.send('perform_set',['seq','enabled',true]));
  await page.waitForFunction(()=>window.__s61?.state?.performance?.seq?.length===64&&window.__s61.state.performance.seq.enabled);
  await page.getByRole('slider',{name:'Overview viewport'}).waitFor();
  const roll=page.locator('.compact-roll');
  await roll.evaluate(node=>{node.scrollLeft=node.scrollWidth;});
  await page.waitForFunction(()=>document.querySelector('.compact-roll')?.scrollLeft>50);
  await page.getByRole('button',{name:'Follow'}).click();
  await page.evaluate(()=>window.deckApi.send('play'));
  await page.waitForFunction(()=>window.__s61?.playing);
  await page.waitForFunction(()=>document.querySelector('.compact-roll')?.scrollLeft<50);
  await page.evaluate(()=>window.deckApi.send('stop'));
  assert.deepEqual(await page.evaluate(()=>window.__s61Errors??[]),[]);
  console.log('PASS S6.1: exact 1280x720/800 controls, one overview, redo, and off-screen follow');
 }finally{await app.close();fs.rmSync(data,{recursive:true,force:true});}
})().catch(error=>{console.error('FAIL S6.1',error.stack||error);process.exitCode=1;});
