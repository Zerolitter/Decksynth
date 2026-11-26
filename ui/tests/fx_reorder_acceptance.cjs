// Preview UI test: FX cards move by dragging their title bar, with the mouse and with real CDP touch events.
// The FX page is a grid with several rows, so drags go up, down, left and right; the dragged card follows the
// pointer, a drop marker shows where it lands, and a drop on its own place or outside changes nothing.
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
  await p.locator('.fx-empty-picker').getByRole('button',{name:'Add Chorus'}).click();
  const sheet=p.getByRole('dialog',{name:'Add effect'});
  for(const n of ['Compressor','Delay','Reverb','Resonator','Vocoder']){
    await p.getByRole('button',{name:'Add effect'}).click();
    await sheet.getByRole('button',{name:'Add '+n}).click();
  }
  await p.waitForTimeout(400);  // the sheet closes and the grid settles
  const order=()=>p.locator('.fx-cards [data-panel]').evaluateAll(n=>n.map(e=>e.dataset.panel.slice(3)));
  // Grab the card by its title, as a player would (the power button sits at the bar's left end).
  const bar=async id=>{const b=await p.locator('[data-panel="fx-'+id+'"] > .ds-panel-bar .ds-panel-title').boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};};
  const card=async id=>p.locator('[data-panel="fx-'+id+'"]').boundingBox();
  const start=await order();
  assert.equal(start.length,6);
  const rows=new Set();for(const id of start)rows.add(Math.round((await card(id)).y));
  assert.ok(rows.size>=2,'the six cards fill more than one row');
  await p.screenshot({path:path.join(ROOT,'docs/fx-reorder-before.png')});

  // Mouse: drag the last card (bottom row) up onto the left half of the first card.
  const mouse=async(from,to,check)=>{
    const a=await bar(from),b=await card(to);
    await p.mouse.move(a.x,a.y);await p.mouse.down();
    for(let i=1;i<=12;i++)await p.mouse.move(a.x+(b.x+12-a.x)*i/12,a.y+(b.y+b.height/2-a.y)*i/12);
    if(check)await check();
    await p.mouse.up();await p.waitForTimeout(150);
  };
  const last=start[5];
  await mouse(last,start[0],async()=>{
    assert.equal(await p.locator('[data-panel="fx-'+last+'"]').getAttribute('data-rack-dragging'),'true','the card is lifted');
    const t=await p.locator('[data-panel="fx-'+last+'"]').evaluate(e=>e.style.transform);
    assert.match(t,/translate\(-?\d/,'the card follows the pointer');
    assert.equal(await p.locator('[data-panel="fx-'+start[0]+'"]').getAttribute('data-drop-side'),'before','drop marker on the target');
    await p.screenshot({path:path.join(ROOT,'docs/fx-reorder-dragging.png')});
  });
  let now=await order();
  assert.deepEqual(now,[last,...start.slice(0,5)],'mouse: bottom row to the front');
  assert.equal(await p.locator('[data-rack-dragging],[data-drop-side]').count(),0,'nothing left marked after the drop');

  // Mouse: the first card down onto the right half of the last card.
  const first=now[0];
  {
    const a=await bar(first),b=await card(now[5]);
    await p.mouse.move(a.x,a.y);await p.mouse.down();
    // The last card can sit below the visible rack (Clip FX strip and sends band): let the finger rest near the bottom edge
    // until the rack's edge autoscroll has brought it fully into view, then drop on its right half.
    const rack=await p.locator('.fx-cards').boundingBox(),rest={x:rack.x+rack.width/2,y:rack.y+rack.height-10};
    for(let i=1;i<=12;i++)await p.mouse.move(a.x+(rest.x-a.x)*i/12,a.y+(rest.y-a.y)*i/12);
    const t0=Date.now();let last=await card(now[5]);
    while(last.y+last.height>rack.y+rack.height-4&&Date.now()-t0<6000){await p.waitForTimeout(50);last=await card(now[5]);}
    assert.ok(last.y+last.height<=rack.y+rack.height,'edge autoscroll brought the last card into view');
    for(let i=1;i<=12;i++)await p.mouse.move(rest.x+(last.x+last.width-12-rest.x)*i/12,rest.y+(last.y+last.height/2-rest.y)*i/12);
    await p.mouse.up();await p.waitForTimeout(150);
  }
  assert.deepEqual(await order(),[...now.slice(1),first],'mouse: front to the end');
  now=await order();

  // A drag that ends where it began, or is cancelled with Esc, changes nothing.
  {
    const a=await bar(now[2]);
    await p.mouse.move(a.x,a.y);await p.mouse.down();
    for(let i=1;i<=6;i++)await p.mouse.move(a.x+i*4,a.y+i*3);
    for(let i=5;i>=0;i--)await p.mouse.move(a.x+i*4,a.y+i*3);
    await p.mouse.up();await p.waitForTimeout(150);
    assert.deepEqual(await order(),now,'a drop on its own place');
    const b=await card(now[0]);
    await p.mouse.move(a.x,a.y);await p.mouse.down();
    for(let i=1;i<=8;i++)await p.mouse.move(a.x+(b.x+10-a.x)*i/8,a.y+(b.y+20-a.y)*i/8);
    await p.keyboard.press('Escape');await p.mouse.up();await p.waitForTimeout(150);
    assert.deepEqual(await order(),now,'Esc cancels');
  }

  // Touch: real touch events, straight down a column and diagonally up, as a finger would.
  const cdp=await p.context().newCDPSession(p);
  const touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
  const finger=async(from,toX,toY)=>{
    const a=await bar(from);
    await touch('touchStart',[{x:a.x,y:a.y,id:1}]);await p.waitForTimeout(60);
    for(let i=1;i<=14;i++){await touch('touchMove',[{x:a.x+(toX-a.x)*i/14,y:a.y+(toY-a.y)*i/14,id:1}]);await p.waitForTimeout(16);}
    await touch('touchEnd',[]);await p.waitForTimeout(200);
  };
  {
    const bottom=now[5],b=await card(now[1]);
    await finger(bottom,b.x+b.width-14,b.y+b.height/2);
    const want=[...now.slice(0,2),bottom,...now.slice(2,5)];
    assert.deepEqual(await order(),want,'touch: up from the bottom row');
    now=want;
  }
  {
    // From the rack's top, the top row and the target row's upper part are both in reach; aim above the bottom edge zone so
    // the drop is not left to the edge autoscroll.
    await p.locator('.fx-cards').evaluate(e=>{e.scrollTop=0;});await p.waitForTimeout(150);
    const top=now[0],b=await card(now[4]),rack=await p.locator('.fx-cards').boundingBox();
    await finger(top,b.x+14,Math.min(b.y+b.height/2,rack.y+rack.height-60));
    const want=[...now.slice(1,4),top,...now.slice(4)];
    assert.deepEqual(await order(),want,'touch: down from the top row');
    now=want;
  }
  // A short touch on the title bar is still a tap: no move.
  {
    const a=await bar(now[3]);
    await touch('touchStart',[{x:a.x,y:a.y,id:1}]);await p.waitForTimeout(60);await touch('touchEnd',[]);await p.waitForTimeout(200);
    assert.deepEqual(await order(),now,'a tap moves nothing');
  }
  await p.screenshot({path:path.join(ROOT,'docs/fx-reorder-after.png')});
  assert.deepEqual(errs,[]);
  console.log('fx reorder acceptance: ok');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
