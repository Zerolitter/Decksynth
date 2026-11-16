// Sampler expansion stage 4: slices on the keys, pitched slices, and the tuning cards (runs after stage 3's chopped take).
'use strict';
const path=require('node:path');
module.exports=async({p,send,latest,inside,H,OUT,assert})=>{
  await send('select',1);
  await p.getByRole('tab',{name:/^Sound$/}).click();
  await p.waitForFunction(()=>window.__latest?.state?.tracks?.[1]?.sampler?.slices?.length>1);
  const spec=async()=>(await latest()).state.tracks[1].sampler;
  const until=(fn,arg)=>p.waitForFunction(fn,arg,{timeout:20000});
  // Four cards side by side above the keyboard, every target at least 44 px, no sideways scroll.
  const geo=await p.evaluate(()=>{
    const keys=document.querySelector('.smp-keys').getBoundingClientRect();
    const cards=[...document.querySelectorAll('.smp-card')].map(c=>c.getBoundingClientRect());
    const small=[...document.querySelectorAll('.smp-card button,.smp-card [role=radio]')].filter(b=>{const r=b.getBoundingClientRect();return r.width&&(r.width<44||r.height<44);}).map(b=>b.getAttribute('aria-label')||b.textContent);
    return {n:cards.length,bottom:Math.max(...cards.map(r=>r.bottom)),right:Math.max(...cards.map(r=>r.right)),keys:keys.top,small,scroll:document.documentElement.scrollWidth-innerWidth};
  });
  assert.equal(geo.n,4,'Play, Pitch, Filter and Amp');assert.ok(geo.bottom<=geo.keys,'cards stay above the keyboard');
  assert.ok(geo.right<=1280&&geo.scroll<=0,'no sideways scroll');assert.deepEqual(geo.small,[],'targets are at least 44 px');
  // Slices on keys: slice 1 starts at the root key and the keyboard labels the slices.
  await p.getByRole('radio',{name:'Slices',exact:true}).click();
  await until(()=>window.__latest.state.tracks[1].sampler.keymap==='slices');
  await inside(p.getByRole('group',{name:'First slice key'}),'First slice key');
  assert.ok(await p.locator('.smp-keys .slice em',{hasText:/^1$/}).count()>=1,'the keyboard shows slice 1');
  // Play options.
  await p.getByRole('button',{name:'Reverse'}).click();await until(()=>window.__latest.state.tracks[1].sampler.reverse===true);
  await p.getByRole('button',{name:'Normalize'}).click();await until(()=>window.__latest.state.tracks[1].sampler.normalize===true);
  // Filter: off dims the knobs; picking the Low-pass curve turns it on.
  assert.equal(await p.locator('.smp-filter.off').count(),1);
  await p.getByRole('radio',{name:'Low-pass',exact:true}).click();await until(()=>window.__latest.state.tracks[1].sampler.filter==='lp');
  assert.equal(await p.locator('.smp-filter.off').count(),0);
  // Pitched: finds each slice's note (the take is 220 Hz, A3) and spreads them over the keys.
  await p.getByRole('radio',{name:'Pitched',exact:true}).click();
  await until(()=>window.__latest.state.tracks[1].sampler.keymap==='pitched');
  const s=await spec();assert.ok(s.slices.some(x=>x[2]===57),'a slice root is A3');
  await inside(p.getByRole('button',{name:/Detect/}),'Detect again');
  await p.screenshot({path:path.join(OUT,'sampler-keys-tuning-'+H+'.png')});
  // Back to Whole and off again so the next run starts clean.
  await p.getByRole('radio',{name:'Whole',exact:true}).click();await until(()=>window.__latest.state.tracks[1].sampler.keymap==='whole');
  await p.getByRole('switch',{name:'Filter on'}).click();await until(()=>window.__latest.state.tracks[1].sampler.filter==='off');
  console.log('PASS stage 4 at '+H);
};
