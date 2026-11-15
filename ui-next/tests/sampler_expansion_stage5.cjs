// Sampler expansion stage 5: record an input into a Sampler (a test WAV stands in for the piano), then chop the take.
'use strict';
const path=require('node:path');
module.exports=async({p,send,latest,inside,H,OUT,assert})=>{
  await send('select',1);
  await p.getByRole('tab',{name:/^Sound$/}).click();
  if((await latest()).state.tracks[1].device!=='sampler')await send('set_device',[1,'sampler']);
  await p.waitForFunction(()=>window.__latest?.state?.tracks?.[1]?.device==='sampler');
  const open=p.locator('.sampler-page header').getByRole('button',{name:/^Record$/});
  const sheet=p.getByRole('dialog',{name:'Record into the Sampler'});
  await inside(open,'Record in the header');
  // Every way out: Esc, a blank tap, the same button, Done.
  await open.click();await sheet.waitFor();await p.keyboard.press('Escape');await sheet.waitFor({state:'detached'});
  await open.click();await sheet.waitFor();await p.mouse.click(8,H-8);await sheet.waitFor({state:'detached'});
  await open.click();await sheet.waitFor();await open.click({force:true}).catch(()=>{});
  if(await sheet.count()){await sheet.getByRole('button',{name:'Done'}).click();}
  await sheet.waitFor({state:'detached'});
  // Open, check the input and the controls, arm, play.
  await open.click();await sheet.waitFor();
  await p.waitForFunction(()=>window.__latest?.sampler_record?.input==='Test input');
  for(const [loc,what] of [[sheet.getByRole('radio',{name:/Test input/}),'Input'],[sheet.getByRole('spinbutton',{name:'Threshold'}),'Threshold'],
    [sheet.getByRole('spinbutton',{name:'Longest'}),'Longest'],[sheet.getByRole('button',{name:'Record now'}),'Record now'],[sheet.getByRole('button',{name:'Arm'}),'Arm'],[sheet.getByRole('button',{name:'Done'}),'Done']])await inside(loc,what);
  await sheet.getByRole('spinbutton',{name:'Threshold'}).click();for(let i=0;i<3;i++)await p.keyboard.press('ArrowUp');
  await p.waitForFunction(()=>window.__latest.sampler_record.threshold===-37);
  await sheet.getByRole('button',{name:'Arm'}).click();
  await p.waitForFunction(()=>window.__latest.sampler_record.state==='armed');
  await p.screenshot({path:path.join(OUT,'sampler-record-armed-'+H+'.png')});
  await p.waitForFunction(()=>window.__latest.sampler_record.state==='recording',null,{timeout:15000});
  await p.waitForFunction(()=>window.__latest.sampler_record.seconds>=2.2,null,{timeout:15000});
  await p.screenshot({path:path.join(OUT,'sampler-record-take-'+H+'.png')});
  await sheet.getByRole('button',{name:'Stop and chop'}).click();
  await sheet.waitFor({state:'detached'});
  await p.waitForFunction(()=>window.__latest.state.tracks[1].sampler.name.startsWith('Recording')&&window.__latest.samplers?.[1]?.status==='READY',null,{timeout:20000});
  assert.equal(await p.getByRole('radio',{name:/Chop/}).getAttribute('aria-checked'),'true','the take opens in Chop');
  await p.getByRole('radio',{name:'Threshold',exact:true}).click();
  await p.waitForFunction(()=>window.__latest.state.tracks[1].sampler.slices.length===3,null,{timeout:20000});
  await p.screenshot({path:path.join(OUT,'sampler-record-chopped-'+H+'.png')});
  console.log('PASS stage 5 at '+H);
};
