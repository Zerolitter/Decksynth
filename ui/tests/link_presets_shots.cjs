// Screenshots for the Link "+" slot, the FX presets sheet and the Drum Rack / Sampler link rings (17 Nov batch).
'use strict';
const {_electron}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.OUT||path.join(os.tmpdir(),'link-presets-shots');const H=Number(process.env.HEIGHT||718);
const DATA=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-shots-'));
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DATA_DIR:DATA,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 const p=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
 await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,h);},H);
 await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 const shot=async n=>{await p.waitForTimeout(400);await p.screenshot({path:path.join(OUT,n+'-'+H+'.png')});};
 await p.getByRole('tab',{name:/^Link$/}).click();await p.waitForTimeout(500);
 console.log('pads shown',await p.locator('.lp-pads .fx-pad').count(),'add slot',await p.locator('.lp-pad-add').count());
 await shot('link-default');
 await p.locator('.lp-pad-add').click();await shot('link-fourth-pad');
 await p.getByRole('tab',{name:/^FX$/}).click();await p.waitForTimeout(500);
 await p.getByRole('button',{name:/^Presets for /}).first().click();await shot('fx-presets');
 await p.keyboard.press('Escape');
 await p.getByRole('tab',{name:/^Sound$/}).click();await p.waitForTimeout(400);
 await p.locator('.instrument-switcher, [class*=switcher]').getByText('Drum Rack',{exact:true}).first().click();await p.waitForTimeout(500);
 await p.getByRole('tab',{name:/^Link$/}).click();await p.waitForTimeout(400);
 await p.getByRole('button',{name:'Link Mod pad 1 to knobs'}).click();
 await p.getByRole('tab',{name:/^Sound$/}).click();await shot('drum-linkable');
 await p.locator('.instrument-switcher, [class*=switcher]').getByText('Sampler',{exact:true}).first().click();await shot('sampler-linkable');
 console.log('SHOTS',fs.readdirSync(OUT).join(' '));
 await app.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
