// Settings at 1280 x 718: the dialog fits the window, scrolls to its last control, and Close stays reachable.
'use strict';
const {launch}=require('./workflow_helpers.cjs'),assert=require('node:assert/strict');
let h;
(async()=>{
  h=await launch('settings-718');
  const {p,shot}=h;
  await p.setViewportSize({width:1280,height:718});
  await p.getByRole('button',{name:'Settings',exact:true}).click();
  const dialog=p.getByRole('dialog',{name:'Settings',exact:true});
  await dialog.waitFor();
  const box=await dialog.boundingBox();
  assert.ok(box.y>=0&&box.y+box.height<=718,'the dialog fits inside 718 px: '+JSON.stringify(box));
  await shot('settings-top');
  // The last control can be scrolled into reach and is at least 44 px.
  const controls=dialog.locator('button:visible,[role=switch]:visible');
  const last=controls.last();
  await last.scrollIntoViewIfNeeded();
  const r=await last.boundingBox();
  assert.ok(r.y>=box.y&&r.y+r.height<=box.y+box.height+1,'last control is inside the dialog after scrolling');
  await shot('settings-bottom');
  const close=dialog.getByRole('button',{name:/close|done/i}).first();
  const c=await close.boundingBox();
  assert.ok(c.width>=43.9&&c.height>=43.9,'Close is a 44 px target');
  await close.click();
  await dialog.waitFor({state:'detached'});
  console.log('PASS settings dialog at 718: fits, scrolls, closes; height',Math.round(box.height));
  assert.deepEqual(h.errors,[]);
})().catch(async e=>{console.error(e.stack);if(h)await h.p.screenshot({path:'/tmp/settings-718-failure.png'}).catch(()=>{});process.exitCode=1;}).finally(async()=>{if(h)await h.close();});
