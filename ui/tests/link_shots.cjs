// Screenshots of Sound (synth), FX and Link for the Link makeover (Sir, 16 Nov). OUT=dir PREFIX=before|after HEIGHT=718|800
'use strict';
const {_electron}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const OUT=path.resolve(ROOT,process.env.OUT||'../artifacts/link-makeover');const H=Number(process.env.HEIGHT||718);const PRE=process.env.PREFIX||'shot';
const data=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-link-'));
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:data,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 try{
  const p=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
  p.on('pageerror',e=>console.error('pageerror',e.message));
  await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,h);},H);
  await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
  const shot=async name=>{await p.waitForTimeout(350);await p.screenshot({path:path.join(OUT,PRE+'-'+name+'-'+H+'.png')});console.log('shot',name);};
  const tab=async n=>{const t=p.getByRole('tab',{name:new RegExp('^'+n+'$','i')});if(await t.count()){await t.first().click();return true;}return false;};
  await tab('Sound');await shot('sound');
  await tab('FX');await shot('fx');
  if(await tab('Link')){await shot('link');
    const tile=p.locator('.lp-morph-tile');if(await tile.count()){await tile.click();await shot('link-morph');await tile.click();}
    const lip=p.locator('[aria-label="Link Macro 4 to knobs"],[aria-label^="Link Macro 4"]').first();
    if(await lip.count()){await lip.click();await shot('link-armed');await tab('Sound');await shot('sound-armed');}}
  const extra=process.env.EXTRA;if(extra)await require(path.resolve(extra))(p,shot);
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
