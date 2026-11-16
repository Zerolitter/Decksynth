// Round 2, batch B (Sir's pictures, 16 Nov): the Sampler's big panel also shows Envelope and Filter with points to
// drag. Heard while dragging (sampler_live), saved as one edit on release; Trim and Chop still work.
'use strict';
const path=require('node:path');
module.exports=async({p,send,latest,inside,H,OUT,DATA,assert,app})=>{
  await p.getByRole('tab',{name:/^Sound$/}).click();
  let t=(await latest()).state.tracks.findIndex(x=>x.device==='sampler'&&x.sampler?.source);
  if(t<0){t=2;await send('set_device',[t,'sampler']);await p.waitForFunction(t=>window.__latest.state.tracks[t].device==='sampler',t);
    const id=(await latest()).state.tracks[t].sampler.id;await send('sampler_load_wav',[t,id,path.join(DATA,'piano notes.wav')]);
    await p.waitForFunction(t=>!!window.__latest.state.tracks[t].sampler?.source,t,{timeout:20000});}
  await p.locator('.page-track').nth(t).click();await p.waitForFunction(t=>window.__latest.selected===t,t);await p.locator('.sampler-page').waitFor();
  const S=()=>p.evaluate(t=>window.__latest.state.tracks[t].sampler,t);
  const id=(await S()).id;
  await send('sampler_edit',[t,id,'patch',{attack:.05,decay:.2,sustain:.8,release:.3,filter:'lp',cutoff:2000,resonance:.2}]);
  await p.waitForFunction(t=>window.__latest.state.tracks[t].sampler.filter==='lp',t);
  const tabs=p.getByRole('radiogroup',{name:'Edit'});
  for(const n of ['Trim','Chop','Envelope','Filter'])await inside(tabs.getByRole('radio',{name:n}),n+' tab');
  const live=[];
  await app.evaluate(({ipcMain})=>{globalThis.__live=[];ipcMain.on('deck-command',(_,c,a)=>{if(c==='sampler_live')globalThis.__live.push(a);});});

  // Envelope: drag Decay·Sustain down and right. Heard live, one edit on release.
  await tabs.getByRole('radio',{name:'Envelope'}).click();
  const env=p.getByRole('group',{name:/^Amp envelope: drag/});await env.waitFor();
  const eb=await env.boundingBox(),dh=env.locator('[data-handle=decay]'),db=await dh.boundingBox();
  const before=await S();
  await p.mouse.move(db.x+db.width/2,db.y+db.height/2);await p.mouse.down();
  for(let i=1;i<=6;i++)await p.mouse.move(db.x+db.width/2+i*eb.width*.02,db.y+db.height/2+i*eb.height*.04);
  await p.waitForTimeout(150);
  const mid=await S();assert.equal(mid.sustain,before.sustain,'nothing saved while dragging');
  const heard=await app.evaluate(()=>globalThis.__live.length);assert.ok(heard>0,'heard while dragging');
  await p.mouse.up();
  await p.waitForFunction(t=>{const s=window.__latest.state.tracks[t].sampler;return s.sustain<.7&&s.decay>.2;},t);
  // Release point.
  const rh=env.locator('[data-handle=release]'),rb=await rh.boundingBox();
  await p.mouse.move(rb.x+rb.width/2,rb.y+rb.height/2);await p.mouse.down();
  for(let i=1;i<=4;i++)await p.mouse.move(rb.x+rb.width/2-i*eb.width*.02,rb.y+rb.height/2);
  await p.mouse.up();
  await p.waitForFunction(t=>window.__latest.state.tracks[t].sampler.release<.3,t);
  await p.screenshot({path:path.join(OUT,'sampler-envelope-'+H+'.png')});

  // Filter: drag the point right (cutoff up) and up (more resonance).
  await tabs.getByRole('radio',{name:'Filter'}).click();
  const fil=p.getByRole('group',{name:/^Filter: drag/});await fil.waitFor();
  const fb=await fil.boundingBox(),ch=fil.locator('[data-handle=cut]'),cb=await ch.boundingBox();
  await p.mouse.move(cb.x+cb.width/2,cb.y+cb.height/2);await p.mouse.down();
  for(let i=1;i<=5;i++)await p.mouse.move(cb.x+cb.width/2+i*fb.width*.03,cb.y+cb.height/2-i*fb.height*.04);
  await p.mouse.up();
  await p.waitForFunction(t=>{const s=window.__latest.state.tracks[t].sampler;return s.cutoff>2500&&s.resonance>.2;},t);
  await p.screenshot({path:path.join(OUT,'sampler-filter-'+H+'.png')});

  // Undo takes back the filter drag in one step.
  await p.getByRole('button',{name:'Undo',exact:true}).click();
  await p.waitForFunction(t=>window.__latest.state.tracks[t].sampler.cutoff===2000,t);

  // Trim brings the waveform back.
  await tabs.getByRole('radio',{name:'Trim'}).click();
  await p.locator('.sampler-page .smp-wave-shell').waitFor();
  console.log('PASS round 2 batch B at '+H);
};
