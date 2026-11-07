// Preview UI test for Arp Pause / Stop (patch 24): the buttons appear in the Perform bar only while the arp is on,
// Pause toggles to Resume, Stop arp lets go of the chord, and the bar still fits at 722 px.
'use strict';
const {_electron}=require('playwright');
const path=require('node:path');
const assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
(async()=>{
 const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,
  env:{...process.env,DECKSYNTH_UI_PREVIEW:'1',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 try{
  const p=await app.firstWindow({timeout:15000});
  p.setDefaultTimeout(8000);
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,722));
  await p.getByRole('tab',{name:/^Perform$/}).click();
  await p.getByRole('tab',{name:/^Arp/}).click();
  const tool=name=>p.locator('button.pf-tool').filter({hasText:new RegExp('^'+name+'$')});
  const pause=tool('(Pause|Resume)');
  const power=p.locator('button.pf-power');
  if(await power.getAttribute('aria-pressed')==='true')await power.click();
  assert.equal(await pause.count(),0,'no Pause while the arp is off');
  await power.click();
  assert.ok(await pause.isVisible(),'Pause shows when the arp is on');
  assert.ok(await p.getByRole('button',{name:'Stop arp'}).isVisible());
  await pause.click();
  assert.equal(await tool('Resume').getAttribute('aria-pressed'),'true');
  await tool('Resume').click();
  assert.equal(await tool('Pause').getAttribute('aria-pressed'),'false');
  await p.getByRole('button',{name:'Stop arp'}).click();
  for(const name of ['Pause','Stop arp','Hold','Panic']){
    const b=await tool(name).boundingBox();
    assert.ok(b&&b.x+b.width<=1280&&b.height>=44,name+' fits and is 44 px tall');
  }
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no sideways scroll');
  await p.screenshot({path:path.join(ROOT,'docs/arp-interrupt-acceptance.png')});
  assert.deepEqual(errs,[]);
  console.log('arp interrupt acceptance: ok');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
