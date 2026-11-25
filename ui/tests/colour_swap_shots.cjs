// Screenshots for rules 40–41: orange selection, green secondary, charcoal toast.
'use strict';
require('./deck_guard.cjs');
const {_electron}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.OUT||path.resolve(ROOT,'../artifacts/sampler-editing/colours');const H=Number(process.env.HEIGHT||718);
const DATA=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-colours-'));
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DATA_DIR:DATA,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 const p=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
 await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,h);},H);
 await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 await p.getByRole('tab',{name:/^Sound$/}).click();await p.waitForTimeout(500);
 const pads=p.locator('[aria-label^="Mod pad "]');
 const pad4=p.getByRole('button',{name:/^Mod pad 4/}).first();
 if(await pad4.count()){await pad4.click();await p.waitForTimeout(400);}
 // A toast exactly as App.tsx renders it.
 await p.evaluate(()=>{const s=document.querySelector('.decksynth-shell');const d=document.createElement('div');d.className='toast';d.setAttribute('role','status');
  d.innerHTML='Recorded 4.2 s on track 3, normalized +5 dB<button aria-label="Dismiss message">✕</button>';s.appendChild(d);});
 await p.waitForTimeout(400);
 await p.screenshot({path:path.join(OUT,'sound-mods-toast-'+H+'.png')});
 for(const tab of ['Song','Sampler','Perform']){const t=p.getByRole('tab',{name:new RegExp('^'+tab+'$')});if(await t.count()){await t.click();await p.waitForTimeout(500);await p.screenshot({path:path.join(OUT,tab.toLowerCase()+'-'+H+'.png')});}}
 console.log('SHOTS', fs.readdirSync(OUT).join(' '), 'pads', await pads.count());
 await app.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
