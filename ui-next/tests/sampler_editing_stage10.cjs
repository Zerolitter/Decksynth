// Sampler editing stage 10 (15 Nov evening): add tracks up to 8 (the + after the track chips) and remove them from a
// track's radial menu (Track › Remove track), down to 4. One undo step each.
'use strict';
const path=require('node:path');
module.exports=async({p,send,latest,inside,H,OUT,assert})=>{
  const n=()=>p.evaluate(()=>window.__latest.state.tracks.length);
  const wheel=p.locator('.context-wheel');const item=name=>wheel.getByRole('menuitem',{name,exact:true});
  // A track's menu: Track › Remove track (on a track that is not selected, Track is the only group, so its items show at once).
  const menu=async(chip,name)=>{await chip.click({button:'right'});await wheel.waitFor();if(await item('Track').count())await item('Track').click();return item(name);};
  await p.getByRole('tab',{name:/^Sound$/}).click();
  const start=await n();assert.equal(start,4,'a new project has 4 tracks');
  const add=p.getByRole('button',{name:'Add track'});
  for(let k=5;k<=8;k++){await inside(add,'Add track');await add.click();await p.waitForFunction(k=>window.__latest.state.tracks.length===k&&window.__latest.selected===k-1,k);}
  assert.equal(await add.count(),0,'no + at 8 tracks');
  const chips=p.locator('.page-track');assert.equal(await chips.count(),8);
  for(let i=0;i<8;i++)await inside(chips.nth(i),'Track chip '+(i+1));
  const tools=await p.locator('.page-tools').boundingBox();assert.ok(tools.x+tools.width<=1280+.5,'the page tools stay on screen with 8 tracks ('+(tools.x+tools.width)+')');
  await p.screenshot({path:path.join(OUT,'eight-tracks-'+H+'.png')});
  // The new tracks are full tracks: a Sampler on track 8.
  await send('set_device',[7,'sampler']);
  await p.waitForFunction(()=>window.__latest.state.tracks[7].device==='sampler');
  await p.locator('.sampler-page').waitFor();
  // F9 goes round all eight.
  await p.locator('body').press('F9');await p.waitForFunction(()=>window.__latest.selected===0);
  // Remove track 6 from its radial menu; Undo brings it back.
  const names=(await latest()).state.tracks.map(t=>t.name);
  await (await menu(chips.nth(5),'Remove track')).dispatchEvent('click');
  await p.waitForFunction(()=>window.__latest.state.tracks.length===7);
  assert.deepEqual((await latest()).state.tracks.map(t=>t.name),names.filter((_,i)=>i!==5),'the tracks after it move up');
  assert.equal((await latest()).state.tracks[6].device,'sampler','track 8 is now track 7, still a Sampler');
  await p.getByText('Removed track 6. Undo brings it back.').waitFor();
  await p.getByRole('button',{name:'Undo',exact:true}).click();
  await p.waitForFunction(()=>window.__latest.state.tracks.length===8);
  // The Song page shows a lane per track.
  await p.getByRole('tab',{name:/^Song$/}).click();await p.waitForTimeout(400);
  await p.screenshot({path:path.join(OUT,'song-eight-'+H+'.png')});
  await p.getByRole('tab',{name:/^Sound$/}).click();
  // Back down to 4; the menu stops offering Remove at 4.
  for(let k=7;k>=4;k--){await (await menu(chips.nth(k),'Remove track')).dispatchEvent('click');await p.waitForFunction(k=>window.__latest.state.tracks.length===k,k);}
  await (await menu(chips.nth(3),'Add track')).waitFor();
  assert.equal(await item('Remove track').count(),0,'4 tracks is the least');
  await p.keyboard.press('Escape');if(await wheel.count())await p.keyboard.press('Escape');await wheel.waitFor({state:'detached'});
  console.log('PASS stage 10 at '+H);
};
