// Sampler editing stage 8 (15 Nov evening): the waveform editor. Every slice edge is a draggable tag marker; it works like the
// MIDI editor (Ctrl+wheel zoom at the pointer, wheel scroll, F fit, Z zoom, arrows, S/J/Delete, double-click split).
'use strict';
const path=require('node:path');
module.exports=async({p,send,latest,inside,H,OUT,DATA,assert})=>{
  const S=()=>p.evaluate(()=>window.__latest.state.tracks[1].sampler);
  const view=()=>p.evaluate(()=>window.__latest.samplers?.[1]?.view??[0,1]);
  await p.getByRole('tab',{name:/^Sound$/}).click();
  await send('select',1);
  if((await latest()).state.tracks[1].device!=='sampler')await send('set_device',[1,'sampler']);
  await p.waitForFunction(()=>window.__latest?.state?.tracks?.[1]?.device==='sampler');
  const id=(await S()).id;
  await send('sampler_load_wav',[1,id,path.join(DATA,'piano notes.wav')]);
  await p.waitForFunction(()=>window.__latest.samplers?.[1]?.status==='READY'&&window.__latest.state.tracks[1].sampler.name==='piano notes',null,{timeout:20000});
  await p.getByRole('radio',{name:/Chop/}).click();
  await p.getByRole('radio',{name:'Threshold',exact:true}).click();
  await p.waitForFunction(()=>window.__latest.state.tracks[1].sampler.slices.length===3,null,{timeout:20000});
  // Every slice edge is a tag marker with a 44 px hit zone.
  // The markers render a frame after the slices arrive; wait for each before measuring it.
  for(const n of [1,2,3]){const m=p.getByRole('button',{name:new RegExp('^Slice '+n+' \\d')});await m.waitFor();await p.waitForTimeout(150);await inside(m,'Slice '+n+' marker');}
  // Drag slice 2's start: one undo step.
  const before=(await S()).slices.map(s=>s.slice(0,2));
  const m2=await p.getByRole('button',{name:/^Slice 2 \d/}).boundingBox();
  await p.mouse.move(m2.x+m2.width/2,m2.y+m2.height/2);await p.mouse.down();
  await p.mouse.move(m2.x+m2.width/2-30,m2.y+m2.height/2,{steps:6});await p.mouse.up();
  await p.waitForFunction(b=>window.__latest.state.tracks[1].sampler.slices[1][0]<b-.001,before[1][0]);
  await p.getByRole('button',{name:'Undo',exact:true}).click();
  await p.waitForFunction(b=>Math.abs(window.__latest.state.tracks[1].sampler.slices[1][0]-b)<1e-6,before[1][0]);
  // Ctrl+wheel zooms at the pointer, the wheel scrolls, F fits.
  const shell=p.locator('.smp-wave-shell');const sb=await shell.boundingBox();
  await p.mouse.move(sb.x+sb.width*.6,sb.y+12);
  await p.keyboard.down('Control');for(let i=0;i<4;i++)await p.mouse.wheel(0,-100);await p.keyboard.up('Control');
  await p.waitForFunction(()=>{const v=window.__latest.samplers?.[1]?.view;return v&&v[1]-v[0]<.6;});
  const v1=await view();
  await p.mouse.wheel(0,100);
  await p.waitForFunction(a=>{const v=window.__latest.samplers?.[1]?.view;return v&&v[0]>a+.01;},v1[0]);
  await p.getByText(/^View /).waitFor();
  await p.screenshot({path:path.join(OUT,'wave-zoomed-'+H+'.png')});
  await shell.focus();await p.keyboard.press('f');
  await p.waitForFunction(()=>{const v=window.__latest.samplers?.[1]?.view;return !v||(v[0]===0&&v[1]===1);});
  // Tap slice 1, → selects slice 2 (and plays it), Z zooms to it, F fits again.
  const s=(await S()).slices;
  await p.mouse.click(sb.x+sb.width*((s[0][0]+s[0][1])/2),sb.y+12);
  await p.waitForFunction(()=>/· 1:/.test(document.querySelector('.smp-chop-info')?.textContent||''));
  await p.keyboard.press('ArrowRight');
  await p.waitForFunction(()=>/· 2:/.test(document.querySelector('.smp-chop-info')?.textContent||''));
  await p.keyboard.press('z');
  await p.waitForFunction(()=>{const v=window.__latest.samplers?.[1]?.view;return v&&v[1]-v[0]<.5;});
  await p.keyboard.press('f');
  await p.waitForFunction(()=>{const v=window.__latest.samplers?.[1]?.view;return !v||(v[0]===0&&v[1]===1);});
  // Double-click inside slice 2 splits it there; Delete takes that edge out again.
  const mid=(s[1][0]+s[1][1])/2;
  await p.mouse.dblclick(sb.x+sb.width*mid,sb.y+12);
  await p.waitForFunction(()=>window.__latest.state.tracks[1].sampler.slices.length===4);
  await p.mouse.click(sb.x+sb.width*(mid+(s[1][1]-mid)/2),sb.y+12);
  await p.waitForFunction(()=>/· 3:/.test(document.querySelector('.smp-chop-info')?.textContent||''));
  await p.keyboard.press('Delete');
  await p.waitForFunction(()=>window.__latest.state.tracks[1].sampler.slices.length===3);
  await p.screenshot({path:path.join(OUT,'wave-markers-'+H+'.png')});
  // Trim keeps its tag markers.
  await p.getByRole('radio',{name:/Trim/}).click();
  for(const n of ['Start','End'])await inside(p.getByRole('button',{name:new RegExp('^'+n+' \\d')}),n+' marker');
  console.log('PASS stage 8 at '+H);
};
