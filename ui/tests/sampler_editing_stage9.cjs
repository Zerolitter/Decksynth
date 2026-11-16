// Sampler editing stage 9 (15 Nov evening): the radial menu on the Sampler waveform (Zoom, Split, Join, Audition,
// Clear slices) and on every knob: Link to › Macros / Mod pads in their colours, Unlink. Sampler and Drum Rack knobs link too.
'use strict';
const path=require('node:path');
module.exports=async({p,send,latest,inside,H,OUT,DATA,assert})=>{
  const S=()=>p.evaluate(()=>window.__latest.state.tracks[1].sampler);
  const fx=tr=>p.evaluate(t=>window.__latest.state.tracks[t].fx,tr);
  const wheel=p.locator('.context-wheel');
  const item=name=>wheel.getByRole('menuitem',{name,exact:true});
  const linked=(tr,kind,i,module,param)=>p.waitForFunction(([tr,kind,i,module,param])=>(window.__latest.state.tracks[tr].fx?.[kind]?.[i]?.targets??[]).some(t=>t.module===module&&t.param===param),[tr,kind,i,module,param]);
  const unlinked=(tr,kind,i,module,param)=>p.waitForFunction(([tr,kind,i,module,param])=>!(window.__latest.state.tracks[tr].fx?.[kind]?.[i]?.targets??[]).some(t=>t.module===module&&t.param===param),[tr,kind,i,module,param]);
  await p.getByRole('tab',{name:/^Sound$/}).click();
  await send('select',1);
  if((await latest()).state.tracks[1].device!=='sampler')await send('set_device',[1,'sampler']);
  await p.waitForFunction(()=>window.__latest?.state?.tracks?.[1]?.device==='sampler');
  // A fresh Sampler's id can land a snapshot after its device: send the load again if the first went to an old id.
  let id;
  for(let attempt=0;;attempt++){
    await p.waitForTimeout(300);id=(await S()).id;
    await send('sampler_load_wav',[1,id,path.join(DATA,'piano notes.wav')]);
    try{await p.waitForFunction(()=>window.__latest.samplers?.[1]?.status==='READY'&&window.__latest.state.tracks[1].sampler.name==='piano notes',null,{timeout:attempt<2?8000:20000});break;}
    catch(e){if(attempt>=2)throw e;}
  }
  id=(await S()).id;
  // Let the load finish settling (a detected root lands later and would close an open menu: the target changed).
  for(let last='';;){await p.waitForTimeout(500);const now=JSON.stringify(await S());if(now===last)break;last=now;}

  // A Sampler knob: right-click › Link to › Macros › Macro 1, shown in the macro's colour.
  const tune=p.locator('[data-param="smp-1-'+id+'-tune"]');await inside(tune,'Tune knob');
  await tune.locator('.knob-target').click({button:'right'});await wheel.waitFor();
  assert.equal(await wheel.getAttribute('aria-label'),'Tune commands');
  for(const name of ['Edit value','Reset default','Link to'])await item(name).waitFor();
  await item('Link to').click();await item('Macros').click();
  const swatch=wheel.locator('[data-swatch="macro0"] circle');await swatch.waitFor();
  assert.equal((await swatch.getAttribute('fill')).toLowerCase(),'#f2c46d','Macro 1 shows its colour');
  await p.screenshot({path:path.join(OUT,'link-macros-'+H+'.png')});
  await item('Macro 1').click();await wheel.waitFor({state:'detached'});
  await linked(1,'macros',0,'sampler','tune');
  await tune.locator('.knob-link-dots i').first().waitFor();
  // Linked sources get a tick; the same entry unlinks, and so does Unlink.
  await tune.locator('.knob-target').click({button:'right'});await item('Link to').click();await item('Macros').click();
  await item('Macro 1 (linked)').waitFor();await p.keyboard.press('Escape');await p.keyboard.press('Escape');await p.keyboard.press('Escape');
  await wheel.waitFor({state:'detached'});
  // Mod pads too: Cutoff › Mod 3.
  const cutoff=p.locator('[data-param="smp-1-'+id+'-cutoff"]');
  await cutoff.locator('.knob-target').click({button:'right'});await item('Link to').click();await item('Mod pads').click();
  await item('Mod 3').click();await linked(1,'mods',2,'sampler','cutoff');
  await tune.locator('.knob-target').click({button:'right'});await item('Unlink Macro 1').click();
  await unlinked(1,'macros',0,'sampler','tune');
  assert.equal(await tune.locator('.knob-link-dots').count(),0,'no dots once unlinked');
  // A knob that cannot be moved by a mod (Glide) has no Link entry.
  await p.locator('[data-param="smp-1-'+id+'-glide"] .knob-target').click({button:'right'});await item('Edit value').waitFor();
  assert.equal(await item('Link to').count(),0,'Glide is not linkable');await p.keyboard.press('Escape');await wheel.waitFor({state:'detached'});

  // The waveform: Trim has Zoom; Chop adds the slice under the pointer.
  const shell=p.locator('.smp-wave-shell');let sb=await shell.boundingBox();
  await p.mouse.click(sb.x+sb.width*.6,sb.y+sb.height*.5,{button:'right'});await wheel.waitFor();
  assert.equal(await wheel.getAttribute('data-context-kind'),'sample.wave');
  await item('Zoom in').click();
  await p.waitForFunction(()=>{const v=window.__latest.samplers[1].view;return v[1]-v[0]<.6;});
  await p.mouse.click(sb.x+sb.width*.5,sb.y+sb.height*.5,{button:'right'});await item('Fit whole').click();
  await p.waitForFunction(()=>{const v=window.__latest.samplers[1].view;return v[0]===0&&v[1]===1;});
  await p.getByRole('radio',{name:/Chop/}).click();
  await p.getByRole('radio',{name:'Threshold',exact:true}).click();
  await p.waitForFunction(()=>window.__latest.state.tracks[1].sampler.slices.length===3,null,{timeout:20000});
  const sl=(await S()).slices;sb=await shell.boundingBox();
  const mid=(sl[1][0]+sl[1][1])/2;
  await p.mouse.click(sb.x+sb.width*mid,sb.y+sb.height*.5,{button:'right'});await wheel.waitFor();
  assert.equal(await wheel.getAttribute('aria-label'),'Slice 2 commands');
  for(const name of ['Split here','Join next','Audition','Clear slices'])await item(name).waitFor();
  await p.screenshot({path:path.join(OUT,'wave-wheel-'+H+'.png')});
  await item('Split here').click();
  await p.waitForFunction(()=>window.__latest.state.tracks[1].sampler.slices.length===4);
  const q=sl[1][0]+(sl[1][1]-sl[1][0])*.25;   // inside the first half
  await p.mouse.click(sb.x+sb.width*q,sb.y+sb.height*.5,{button:'right'});await item('Clear slices').click();
  await p.waitForFunction(()=>window.__latest.state.tracks[1].sampler.slices.length===0);
  assert.ok((await S()).source,'Clear slices keeps the sample');

  // A Drum Rack pad knob links the same way.
  await send('select',3);
  if((await latest()).state.tracks[3].device!=='drum_rack')await send('set_device',[3,'drum_rack']);
  const dtune=p.locator('.drum-rack [data-param^="drum-3-"][data-param$="-tune"]').first();await dtune.waitFor({timeout:20000});
  const pad=Number((await dtune.getAttribute('data-param')).split('-')[2]);
  await dtune.locator('.knob-target').click({button:'right'});await item('Link to').click();await item('Mod pads').click();await item('Mod 1').click();
  await linked(3,'mods',0,'drum',pad+':tune');
  await dtune.locator('.knob-link-dots i').first().waitFor();
  await p.screenshot({path:path.join(OUT,'drum-linked-'+H+'.png')});
  await dtune.locator('.knob-target').click({button:'right'});await item('Unlink Mod 1').click();await unlinked(3,'mods',0,'drum',pad+':tune');
  await send('select',1);
  console.log('PASS stage 9 at '+H);
};
