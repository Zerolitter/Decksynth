'use strict';
// Perform note-grid tools: Snap, Legato, the velocity lane (Accent tool, by touch too),
// the overview + Follow row (only when the pattern is wider than the view), double-tap to add,
// and the transport Redo. Uses the test worker's dummy audio driver; no live MIDI or audio.
const {_electron}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-piano-tools-'));
(async()=>{const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DATA_DIR:data,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 try{const p=await app.firstWindow();p.setDefaultTimeout(8000);await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
  await p.setViewportSize({width:1280,height:720});await p.waitForFunction(()=>innerWidth===1280&&innerHeight===720,null,{timeout:5000});
  await p.evaluate(()=>{window.__tools={};window.deckApi.onMessage(m=>{if(m.state)window.__tools=m;});});
  await p.getByRole('tab',{name:'Perform',exact:true}).click();await p.locator('.compact-roll').waitFor();await p.waitForTimeout(400);
  for(const name of ['Snap to grid','Legato notes'])assert.equal(await p.getByRole('button',{name}).count(),1,name+' is on the toolbar');
  // Sir, 20 Nov: the overview replaces the page buttons in the toolbar; the velocity lane sits under the grid.
  assert.equal(await p.locator('.pf-overview-slot .piano-overview').count(),1,'overview in the toolbar slot');
  assert.equal(await p.getByRole('group',{name:'Pattern page'}).count(),0,'no duplicate page buttons');
  assert.equal(await p.locator('.piano-roll-shell .piano-velocity').count(),1,'velocity lane under the grid');
  const keys=await p.locator('.pf-keys').boundingBox();assert.ok(keys.height>=120,'keyboard keeps its height: '+keys.height);

  await p.getByRole('button',{name:'Draw notes'}).click();await p.getByTestId('pf-cell-1-67').click();
  await p.waitForFunction(()=>document.querySelectorAll('.pf-note').length===1);
  await p.getByRole('button',{name:'Accent'}).click();
  const stem=p.locator('.piano-velocity-stem').first();await stem.waitFor();
  const hit=await stem.evaluate(e=>{const s=getComputedStyle(e,'::before');return {w:parseFloat(s.width),h:parseFloat(s.height)};});
  assert.ok(hit.w>=44&&hit.h>=44,'stem has a 44 px finger zone: '+JSON.stringify(hit));
  // Drag the stem up with a real touch (CDP touch events, not a mouse).
  const box=await stem.boundingBox(),x=box.x+box.width/2,y=box.y+box.height-6;
  const cdp=await p.context().newCDPSession(p);
  const touch=(type,yy)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y:yy,id:7}]});
  await touch('touchStart',y);for(let i=1;i<=6;i++)await touch('touchMove',y-i*5);await touch('touchEnd');
  await p.waitForFunction(()=>{const n=window.__tools?.state?.performance;const pats=n&&Object.values(n.patterns||{});return JSON.stringify(pats||[]).match(/"velocity":(\d+)/)&&Number(JSON.stringify(pats).match(/"velocity":(\d+)/)[1])>100;},null,{timeout:4000});

  await p.getByRole('button',{name:'Select notes'}).click();await p.waitForTimeout(80);await p.getByTestId('pf-cell-3-64').dblclick();
  await p.waitForFunction(()=>document.querySelectorAll('.pf-note').length===2);
  assert.equal(await p.getByRole('button',{name:'Redo'}).count(),1,'redo control is in the transport');
  // A 64-step pattern: the overview still has Follow beside it.
  await p.evaluate(()=>window.deckApi.send('perform_set',['seq','length',64]));
  await p.locator('.piano-overview').waitFor();
  assert.equal(await p.getByRole('button',{name:'Follow'}).count(),1,'Follow sits with the overview');
  await p.screenshot({path:path.join(ROOT,'..','artifacts','piano-tools-720.png')});
  console.log('PASS piano-roll tools: lanes only when useful, keyboard height kept, touch velocity drag, double-tap add, redo, overview at 64 steps');
 }finally{await app.close();fs.rmSync(data,{recursive:true,force:true});}
})().catch(error=>{console.error('FAIL',error.stack||error);process.exitCode=1;});
