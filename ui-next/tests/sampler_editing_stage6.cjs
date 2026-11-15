// Sampler editing stage 6 (15 Nov evening): record on any Sampler track (an old take never blocks another),
// Input gain + Normalize take + peak hold, Clear sample (one undo), "Clear slices", and no text selection.
'use strict';
const path=require('node:path');
module.exports=async({p,send,latest,inside,H,OUT,assert})=>{
  const sheet=p.getByRole('dialog',{name:'Record into the Sampler'});
  const take=async(track)=>{
    await send('select',track);
    if((await latest()).state.tracks[track].device!=='sampler')await send('set_device',[track,'sampler']);
    await p.waitForFunction(t=>window.__latest?.state?.tracks?.[t]?.device==='sampler'&&window.__latest.selected===t,track);
    const open=p.locator('.sampler-page').getByRole('button',{name:/^Record$/}).first();
    await open.click();await sheet.waitFor();
    await p.waitForFunction(()=>window.__latest?.sampler_record?.input==='Test input');
    assert.doesNotMatch(await sheet.locator('.smp-record-words').textContent(),/Another track/,'an old take must not block track '+(track+1));
    await inside(sheet.getByRole('slider',{name:'Input gain'}),'Input gain');
    await inside(sheet.getByRole('button',{name:'Normalize take'}),'Normalize take');
    await sheet.getByRole('button',{name:'Record now'}).click();
    await p.waitForFunction(()=>window.__latest.sampler_record.state==='recording');
    await p.waitForFunction(()=>window.__latest.sampler_record.seconds>=1.2,null,{timeout:15000});
    await p.waitForFunction(()=>window.__latest.sampler_record.peak>-90,null,{timeout:15000});
    return open;
  };
  await p.getByRole('tab',{name:/^Sound$/}).click();
  // Track 2 records first (the earlier stage did this too), then track 3 must be free to record.
  await take(1);
  await sheet.getByRole('button',{name:'Stop and chop'}).click();await sheet.waitFor({state:'detached'});
  await p.waitForFunction(()=>window.__latest.samplers?.[1]?.status==='READY'&&window.__latest.sampler_record.state==='idle',null,{timeout:20000});
  assert.equal((await latest()).sampler_record.track,null,'an idle recorder holds no track');
  await take(2);
  await p.screenshot({path:path.join(OUT,'record-track3-gain-'+H+'.png')});
  await sheet.getByRole('button',{name:'Stop and chop'}).click();await sheet.waitFor({state:'detached'});
  await p.waitForFunction(()=>window.__latest.state.tracks[2].sampler.name.startsWith('Recording')&&window.__latest.samplers?.[2]?.status==='READY',null,{timeout:20000});
  assert.ok((await p.evaluate(()=>window.__msgs)).some(m=>/normalized \+\d+ dB/.test(m)),'a quiet take is normalized');
  // Chop: "Clear slices" says what it clears.
  await inside(p.getByRole('button',{name:'Clear slices'}),'Clear slices');
  // Clear sample: small, reddish, one undo step.
  const clear=p.getByRole('button',{name:'Clear sample'});await inside(clear,'Clear sample');
  const colour=await clear.evaluate(e=>getComputedStyle(e).color);assert.match(colour,/rgb\(255, 143, 134\)/,'Clear sample is reddish');
  await p.screenshot({path:path.join(OUT,'clear-sample-button-'+H+'.png')});
  await clear.click();
  await p.waitForFunction(()=>window.__latest.state.tracks[2].sampler.source===null);
  await p.getByText('Play a sound on the keys').waitFor();
  await p.getByRole('button',{name:'Undo',exact:true}).click();
  await p.waitForFunction(()=>window.__latest.state.tracks[2].sampler.source!==null);
  // No text selection: dragging across the cards selects nothing.
  await p.getByRole('radio',{name:/Trim/}).click();
  const a=await p.locator('.smp-card.smp-play h2').boundingBox(),b=await p.locator('.smp-card.smp-filter h2').boundingBox();
  await p.mouse.move(a.x+2,a.y+a.height/2);await p.mouse.down();await p.mouse.move(b.x+b.width,b.y+b.height/2,{steps:8});await p.mouse.up();
  assert.equal(await p.evaluate(()=>String(window.getSelection())),'','dragging selects no text');
  console.log('PASS stage 6 at '+H);
};
