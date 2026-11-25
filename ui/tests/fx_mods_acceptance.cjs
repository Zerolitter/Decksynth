// Preview UI test: the FX page picker and Add effect sheet, and the mod pad editor on Link
// (shapes, drawn points that snap, Edit points / Done, merged steps, rate and feel buttons, links with bipolar depth).
'use strict';
require('./deck_guard.cjs');
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
  await p.setViewportSize({width:1280,height:720});
  await p.waitForFunction(()=>innerWidth===1280&&innerHeight===720,{timeout:5000});
  await p.getByRole('tab',{name:/^FX$/}).click();
  const covered=async()=>{const bad=[];for(const n of await p.locator('.fx-picker-sheet button,.mod-sheet button').all()){
    if(!await n.isVisible())continue;await n.scrollIntoViewIfNeeded();
    const ok=await n.evaluate(b=>{const r=b.getBoundingClientRect(),e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return e===b||b.contains(e);});
    if(!ok)bad.push(await n.getAttribute('aria-label')||await n.innerText());}return bad;};

  // An empty FX page shows the effect picker itself (rule 5); later effects come from the Add effect sheet.
  const empty=p.locator('.fx-empty-picker');
  assert.ok(await empty.isVisible(),'empty FX page shows the picker');
  await empty.getByRole('button',{name:'Add Chorus'}).click();
  await p.getByRole('button',{name:'Add effect'}).click();
  const sheet=p.getByRole('dialog',{name:'Add effect'});
  await sheet.waitFor();
  const sb=await sheet.boundingBox();
  assert.ok(sb.y>=0&&sb.y+sb.height<=720,'picker stays inside the Deck viewport');
  assert.deepEqual(await covered(),[],'nothing in the sheet is covered');
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('.fx-picker-sheet').count(),0,'Esc closes the sheet');
  for(const n of ['Compressor','Resonator']){
    await p.getByRole('button',{name:'Add effect'}).click();
    await sheet.getByRole('button',{name:'Add '+n}).click();
  }
  assert.equal(await p.locator('.fx-card-module').count(),3);
  // Option params are buttons.
  const ratio=p.getByRole('radiogroup',{name:'Compressor Ratio'}).getByRole('radio',{name:'8:1'});
  await ratio.click();
  assert.equal(await ratio.getAttribute('aria-checked'),'true');
  assert.equal(await p.locator('.fx-graph-tile').count(),0,'FX cards have no wide duplicate graph');

  // Mod pads live on Link: the editor shows the graph, feel, Snap, Edit points and the rate row.
  await p.getByRole('tab',{name:/^Link$/}).click();
  await p.getByRole('button',{name:/^Mod pad 1 /}).click();
  const editor=p.getByRole('group',{name:'Mod pad 1 editor'});
  assert.equal(await editor.locator('select,input[type=range]').count(),0,'no scroll list or slider in the editor');
  // Ten rates, 32 bars to 1/16 (32 bars added 16 Nov, as on the Morph pad).
  const inline=editor.getByRole('radiogroup',{name:'Rate of Mod pad 1'});
  assert.equal(await inline.getByRole('radio').count(),10);
  await inline.getByRole('radio',{name:'32 bars'}).click();
  assert.match(await p.getByRole('button',{name:'Link Mod pad 1 to knobs'}).innerText(),/32 bar/,'pad label shows 32 bars');

  // Shapes sit right under the graph (Sir, 16 Nov): ten on the first of five pages, tap to pick; feel and rate inline.
  const shapes=editor.getByRole('radiogroup',{name:'Shape of Mod pad 1'});
  assert.equal(await shapes.getByRole('radio').count(),10);
  assert.equal(await editor.getByRole('tablist',{name:'Shape pages'}).getByRole('tab').count(),5);
  const gBox=await editor.locator('.pad-graph-editor').boundingBox(),sBox=await shapes.boundingBox();
  assert.ok(sBox.y>gBox.y+gBox.height-1&&sBox.y-(gBox.y+gBox.height)<70,'shapes directly under the graph');
  await inline.getByRole('radio',{name:'1/4'}).click();
  await editor.getByRole('radiogroup',{name:'Mod pad feel'}).getByRole('radio',{name:/Triplet/}).click();
  assert.match(await p.getByRole('button',{name:'Link Mod pad 1 to knobs'}).innerText(),/1\/4 T/,'pad shows the triplet rate');
  await editor.getByRole('tab',{name:'Envelopes'}).click();
  await shapes.getByRole('radio',{name:/Pump$/}).click();
  assert.match(await editor.locator('.pe-sub').innerText(),/Pump/);
  await editor.getByRole('tab',{name:'Basic'}).click();

  // Steps: merge to 4 groups.
  await shapes.getByRole('radio',{name:/Steps/}).click();
  await editor.getByRole('radiogroup',{name:'Step count'}).getByRole('radio',{name:'4'}).click();
  assert.equal(await editor.locator('.pad-graph-editor .step-slot').count(),4,'four merged steps');
  await shapes.getByRole('radio',{name:/^Sine/}).click();

  // Edit points turns into Done in the same spot (Sir, 16 Nov); points show only while editing and snap to the grid.
  const tool=editor.locator('.lp-points');
  const at0=await tool.boundingBox();
  await tool.click();
  assert.match(await editor.locator('.pe-sub').innerText(),/Drawn/);
  assert.equal(await tool.innerText(),'Done','Edit points became Done');
  const at1=await tool.boundingBox();
  assert.ok(Math.abs(at0.x-at1.x)<=2&&Math.abs(at0.y-at1.y)<=2,'Done sits where Edit points was: '+JSON.stringify([at0,at1]));
  const dots=editor.locator('.pad-graph-editor circle[r="8"]');
  const n0=await dots.count();assert.ok(n0>=3);
  const drop=async dy=>{const d=await dots.nth(2).boundingBox();
    await p.mouse.move(d.x+d.width/2,d.y+d.height/2);await p.mouse.down();
    await p.mouse.move(d.x+d.width/2,d.y+d.height/2+dy,{steps:4});await p.mouse.up();
    return Number(await dots.nth(2).getAttribute('cy'));};
  const a=await drop(40),b=await drop(3);
  assert.equal(a,b,'snapped point stays on its grid line');
  const spot=await editor.locator('.pad-graph-editor svg').evaluate(n=>{const r=n.getBoundingClientRect();for(const y of [.85,.9,.7,.1])for(const x of [.19,.31,.43]){const px=r.x+r.width*x,py=r.y+r.height*y;if(document.elementFromPoint(px,py)===n)return {x:px,y:py};}return null;});
  assert.ok(spot,'an empty graph spot is reachable');await p.mouse.click(spot.x,spot.y);
  assert.equal(await dots.count(),n0+1,'tap adds a point');
  await tool.click();
  assert.equal(await dots.count(),0,'Done hides the point handles');
  assert.equal(await tool.innerText(),'Edit points');

  // Links by name: pick an effect, tap a param, set depth with the bipolar bar.
  await p.locator('.lp-links').getByRole('button',{name:/By name/}).click();
  const mod=p.getByRole('dialog',{name:'Mod pad 1 editor'});
  await mod.waitFor();
  await mod.getByRole('radiogroup',{name:'Target effect'}).getByRole('radio',{name:'Compressor'}).click();
  await mod.getByRole('button',{name:'Amount'}).click();
  // On Link the depth bars live in the page's Links list, beside the sheet.
  const depth=p.locator('.lp-links').getByRole('slider',{name:/Depth Compressor/});
  assert.equal(await depth.getAttribute('aria-valuenow'),'50');
  const db=await depth.boundingBox();
  await p.mouse.move(db.x+db.width*0.75,db.y+db.height/2);await p.mouse.down();
  await p.mouse.move(db.x+db.width,db.y+db.height/2,{steps:6});await p.mouse.up();
  const after=Number(await depth.getAttribute('aria-valuenow'));
  assert.ok(after>50&&after<=100,'relative drag raises depth, no jump: '+after);
  await depth.focus();await p.keyboard.press('ArrowLeft');
  assert.equal(Number(await depth.getAttribute('aria-valuenow')),after-5);
  // Dragging a bar beside the sheet counts as a tap outside it, so the sheet may already be closed.
  if(await mod.count())await mod.getByRole('button',{name:'Done'}).click();
  assert.equal(await p.locator('.mod-sheet').count(),0,'the sheet is closed');
  assert.match(await p.locator('.lp-links').innerText(),/Compressor/,'the Links list shows the link');
    assert.deepEqual(errs,[]);
  console.log('fx_mods_acceptance: ok');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
