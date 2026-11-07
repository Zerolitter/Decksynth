// Preview UI test: five new effects, the Add effect sheet over the FX window, and the mod pad editor sheet
// (shapes, drawn points that snap, merged steps, rate and feel buttons, links with bipolar depth).
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
  await p.getByRole('tab',{name:/^FX$/}).click();
  const covered=async()=>{const bad=[];for(const n of await p.locator('.fx-picker-sheet button,.mod-sheet button').all()){
    if(!await n.isVisible())continue;await n.scrollIntoViewIfNeeded();
    const ok=await n.evaluate(b=>{const r=b.getBoundingClientRect(),e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return e===b||b.contains(e);});
    if(!ok)bad.push(await n.getAttribute('aria-label')||await n.innerText());}return bad;};

  // An empty rack shows the picker in the window itself; the Add effect sheet sits over the window, not under the rack.
  const win=p.getByRole('region',{name:'FX window'});
  assert.ok(await p.locator('.fx-cards').getByRole('button',{name:'Add effect',exact:true}).isVisible(),'empty bottom rack has one Add action');
  await p.getByRole('button',{name:'Add effect'}).click();
  const sheet=p.getByRole('dialog',{name:'Add effect'});
  await sheet.waitFor();
  const sb=await sheet.boundingBox(),wb=await p.locator('.frame-window').boundingBox();
  assert.ok(sb.y<=wb.y+4&&sb.y+sb.height<=722,'picker stays inside the Deck viewport');
  assert.deepEqual(await covered(),[],'nothing in the sheet is covered');
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('.fx-picker-sheet').count(),0,'Esc closes the sheet');
  for(const n of ['Chorus','Compressor','Resonator']){
    await p.getByRole('button',{name:'Add effect'}).click();
    await sheet.getByRole('button',{name:'Add '+n}).click();
  }
  assert.equal(await p.locator('.fx-card-module').count(),3);
  // Option params are buttons.
  const ratio=p.getByRole('radiogroup',{name:'Compressor Ratio'}).getByRole('radio',{name:'8:1'});
  await ratio.click();
  assert.equal(await ratio.getAttribute('aria-checked'),'true');
  assert.equal(await p.locator('.fx-graph-tile').count(),0,'FX cards have no wide duplicate graph');

  // Compact mod editor: Shape, Rate and the link summary, no scroll list.
  await p.getByRole('button',{name:/^Mod pad 1 /}).click();
  assert.equal(await p.locator('.pad-editor select,.pad-editor input[type=range]').count(),0,'no scroll list in the compact editor');
  await p.getByRole('button',{name:/^Shape of Mod pad 1/}).click();
  const mod=p.getByRole('dialog',{name:'Mod pad 1 editor'});
  await mod.waitFor();
  assert.deepEqual(await covered(),[],'nothing in the mod sheet is covered');

  // Ten shapes, seven rates, three feels.
  assert.equal(await mod.getByRole('radiogroup',{name:'Mod pad 1 shape'}).getByRole('radio').count(),10);
  const rate=mod.getByRole('radiogroup',{name:'Mod pad rate'});
  assert.equal(await rate.getByRole('radio').count(),7);
  await rate.getByRole('radio',{name:'1/4'}).click();
  await mod.getByRole('radiogroup',{name:'Mod pad feel'}).getByRole('radio',{name:/Triplet/}).click();
  assert.match(await p.locator('.fx-pad-row .fx-pad').first().innerText(),/1\/4 T/,'pad shows the triplet rate');

  // Steps: merge to 4 groups; dragging sets one group.
  await mod.getByRole('radio',{name:/Steps/}).click();
  await mod.getByRole('radiogroup',{name:'Step count'}).getByRole('radio',{name:'4'}).click();
  assert.equal(await p.locator('.pad-graph-editor .step-slot').count(),4,'four merged steps');

  // Drawn shape: points snap to the grid (two drops a few px apart land on the same spot).
  await mod.getByRole('radio',{name:/Sine/}).click();
  await mod.getByRole('button',{name:'Edit points'}).click();
  assert.equal(await mod.getByRole('radio',{name:/Drawn/}).getAttribute('aria-checked'),'true');
  const dots=p.locator('.pad-graph-editor circle[r="8"]');
  const n0=await dots.count();assert.ok(n0>=3);
  const drop=async dy=>{const d=await dots.nth(2).boundingBox();
    await p.mouse.move(d.x+d.width/2,d.y+d.height/2);await p.mouse.down();
    await p.mouse.move(d.x+d.width/2,d.y+d.height/2+dy,{steps:4});await p.mouse.up();
    return Number(await dots.nth(2).getAttribute('cy'));};
  const a=await drop(40),b=await drop(3);
  assert.equal(a,b,'snapped point stays on its grid line');
  // Tap empty space to add a point.
  // At the compact size the previous fixed point hits a 44px handle, not empty space.
  const empty=await p.locator('.pad-graph-editor svg').evaluate(n=>{const r=n.getBoundingClientRect();for(const y of [.85,.9,.7,.1]){const x=r.x+r.width*.19,py=r.y+r.height*y;if(document.elementFromPoint(x,py)===n)return {x,y:py};}return null;});
  assert.ok(empty,'an actual empty graph location is reachable');await p.mouse.click(empty.x,empty.y);
  assert.equal(await dots.count(),n0+1,'tap adds a point');

  // Links: pick an effect, tap a param, set depth with the bipolar bar.
  await mod.getByRole('tab',{name:'Links'}).click();
  await mod.getByRole('radiogroup',{name:'Target effect'}).getByRole('radio',{name:'Compressor'}).click();
  await mod.getByRole('button',{name:'Amount'}).click();
  const depth=mod.getByRole('slider',{name:/Depth Compressor/});
  assert.equal(await depth.getAttribute('aria-valuenow'),'50');
  const db=await depth.boundingBox();
  await p.mouse.move(db.x+db.width*0.75,db.y+db.height/2);await p.mouse.down();
  await p.mouse.move(db.x+db.width*0.75+db.width*0.25,db.y+db.height/2,{steps:6});await p.mouse.up();
  const after=Number(await depth.getAttribute('aria-valuenow'));
  assert.ok(after>50&&after<=100,'relative drag raises depth, no jump: '+after);
  await depth.focus();await p.keyboard.press('ArrowLeft');
  assert.equal(Number(await depth.getAttribute('aria-valuenow')),after-5);
  await mod.getByRole('button',{name:'Done'}).click();
  assert.equal(await p.locator('.mod-sheet').count(),0,'Done closes the sheet');
  assert.match(await p.locator('.pad-editor').innerText(),/Compressor/,'compact editor lists the link');
  await p.screenshot({path:path.join(ROOT,'..','artifacts','fx-mods-722.png')});
  assert.deepEqual(errs,[]);
  console.log('fx_mods_acceptance: ok');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
