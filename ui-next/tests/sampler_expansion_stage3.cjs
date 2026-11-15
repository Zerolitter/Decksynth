// Sampler expansion stage 3: load a WAV into a Sampler, chop it, hear a slice, send slices to pads.
'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({p,send,latest,inside,H,OUT,DATA,assert})=>{
  // A WAV longer than the old 30 s limit: 32 s of 8th-note hits at 120 BPM with silence between.
  const wav=path.join(DATA,'long take.wav'),rate=48000,n=rate*32,pcm=Buffer.alloc(n*2);
  for(let i=0;i<n;i++){const t=(i%(rate/4))/rate;const v=t<.12?.7*Math.exp(-t*30)*Math.sin(2*Math.PI*220*t):0;pcm.writeInt16LE(Math.round(v*32767),i*2);}
  const head=Buffer.alloc(44);head.write('RIFF',0);head.writeUInt32LE(36+pcm.length,4);head.write('WAVE',8);head.write('fmt ',12);
  head.writeUInt32LE(16,16);head.writeUInt16LE(1,20);head.writeUInt16LE(1,22);head.writeUInt32LE(rate,24);head.writeUInt32LE(rate*2,28);head.writeUInt16LE(2,32);head.writeUInt16LE(16,34);
  head.write('data',36);head.writeUInt32LE(pcm.length,40);fs.writeFileSync(wav,Buffer.concat([head,pcm]));

  await send('select',1);await send('set_device',[1,'sampler']);
  await p.getByRole('tab',{name:/^Sound$/}).click();
  await p.waitForFunction(()=>window.__latest?.state?.tracks?.[1]?.device==='sampler');
  await inside(p.getByRole('button',{name:'Load a WAV'}),'Load a WAV on the empty Sampler');
  await inside(p.locator('.sampler-page header').getByRole('button',{name:/Load WAV/}),'Load WAV in the header');
  const id=(await latest()).state.tracks[1].sampler.id;
  await send('sampler_load_wav',[1,id,wav]);
  await p.waitForFunction(()=>window.__latest?.samplers?.[1]?.status==='READY',null,{timeout:30000});
  assert.equal((await latest()).state.tracks[1].sampler.name,'long take');

  // Trim / Chop tabs in the header; Chop with Threshold finds every hit (64 of them is the cap).
  await inside(p.getByRole('radio',{name:/Trim/}),'Trim');await p.getByRole('radio',{name:/Chop/}).click();
  for(const name of ['Threshold','Regions','BPM'])await inside(p.getByRole('radio',{name,exact:true}),name);
  for(const name of ['Split','Join','Clear','Zoom','To pads'])await inside(p.getByRole('button',{name,exact:true}),name);
  await p.getByRole('radio',{name:'Threshold'}).click();
  await p.waitForFunction(()=>(window.__latest.state.tracks[1].sampler.slices||[]).length>=60,null,{timeout:15000});
  // Regions 16, then tap slice 3: it is chosen and heard.
  await p.getByRole('radio',{name:'Regions'}).click();
  await p.waitForFunction(()=>(window.__latest.state.tracks[1].sampler.slices||[]).length===16,null,{timeout:15000});
  const box=await p.locator('.smp-wave-shell').boundingBox();
  await p.mouse.click(box.x+box.width*(2.5/16),box.y+12);
  await p.waitForFunction(()=>window.__latest.samplers[1].audition?.index===2,null,{timeout:5000});
  assert.match(await p.locator('.smp-chop-info').textContent(),/16 slices · 3:/);
  // Split at a tap inside slice 3, then Join puts it back; both are undo steps.
  await p.mouse.click(box.x+box.width*(2.3/16),box.y+12);
  await p.getByRole('button',{name:'Split',exact:true}).click();
  await p.waitForFunction(()=>window.__latest.state.tracks[1].sampler.slices.length===17);
  await p.getByRole('button',{name:'Join',exact:true}).click();
  await p.waitForFunction(()=>window.__latest.state.tracks[1].sampler.slices.length===16);
  // Zoom to the chosen slice and back.
  await p.getByRole('button',{name:'Zoom',exact:true}).click();
  await p.waitForFunction(()=>window.__latest.samplers[1].view[1]-window.__latest.samplers[1].view[0]<.2);
  await p.screenshot({path:path.join(OUT,'sampler-chop-'+H+'.png')});
  await p.getByRole('button',{name:'Zoom',exact:true}).click();
  await p.waitForFunction(()=>window.__latest.samplers[1].view[1]-window.__latest.samplers[1].view[0]>.99);

  // To pads: a sheet; Esc and Done close it; Make the kit turns track 3 into a Drum Rack of the slices.
  const sheet=p.getByRole('dialog',{name:'Send slices to pads'});
  await p.getByRole('button',{name:'To pads'}).click();await sheet.waitFor();await p.keyboard.press('Escape');await sheet.waitFor({state:'detached'});
  await p.getByRole('button',{name:'To pads'}).click();await sheet.waitFor();
  await inside(sheet.getByRole('button',{name:'Done'}),'Done');
  await sheet.getByRole('radio',{name:/Track 3/}).click();
  await p.screenshot({path:path.join(OUT,'sampler-to-pads-'+H+'.png')});
  await sheet.getByRole('button',{name:/Make the kit on track 3/}).click();await sheet.waitFor({state:'detached'});
  await p.waitForFunction(()=>window.__latest.state.tracks[2].device==='drum_rack'&&window.__latest.drum_racks?.[2]?.pads?.[15]?.status==='READY',null,{timeout:20000});
  const kit=(await latest()).state.tracks[2].drum_rack;
  assert.equal(kit.name,'long take');assert.equal(kit.pads[0].name,'long take 01');assert.equal(kit.pads[15].name,'long take 16');
  assert.ok(fs.existsSync(kit.pads[0].source.path),'slice WAVs are written to the data folder');
  // One slice onto one pad of that kit.
  await p.mouse.click(box.x+box.width*(4.5/16),box.y+12);
  await p.getByRole('button',{name:'To pads'}).click();await sheet.waitFor();
  await sheet.getByRole('radio',{name:/Track 3/}).click();await sheet.getByRole('radio',{name:'Slice 5 to one pad'}).click();
  await sheet.getByRole('radio',{name:/^01/}).click();await sheet.getByRole('button',{name:'Put slice 5 on pad 1'}).click();
  await p.waitForFunction(()=>window.__latest.state.tracks[2].drum_rack.pads[0].name==='long take 05',null,{timeout:20000});
  console.log('PASS stage 3 at '+H);
};
