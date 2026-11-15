// Sampler editing stage 7 (15 Nov evening): value boxes replace − / + (wheel, Shift/Ctrl, slow double click to type),
// and a quick double click on a knob resets it to its default.
'use strict';
const path=require('node:path');
module.exports=async({p,send,latest,inside,H,OUT,DATA,assert})=>{
  const settle=()=>p.waitForTimeout(450);
  const slowDouble=async loc=>{const b=await loc.boundingBox();const x=b.x+b.width/2,y=b.y+b.height/2;
    await p.mouse.click(x,y);await p.waitForTimeout(650);await p.mouse.click(x,y);};
  // Top bar tempo: no − / +, the wheel moves it once armed.
  const bpm=p.getByRole('spinbutton',{name:'BPM'}).first();await inside(bpm,'BPM box');
  assert.equal(await p.getByRole('button',{name:/Tempo [−+]/}).count(),0,'the tempo − / + buttons are gone');
  const start=(await latest()).state.bpm;
  await bpm.click();await bpm.hover();await p.mouse.wheel(0,-100);await settle();
  await p.waitForFunction(b=>window.__latest.state.bpm===b+1,start);
  await p.keyboard.down('Shift');await p.mouse.wheel(0,-100);await p.keyboard.up('Shift');await settle();
  await p.waitForFunction(b=>window.__latest.state.bpm===b+11,start);
  await p.keyboard.down('Control');await p.mouse.wheel(0,100);await p.keyboard.up('Control');await settle();
  await p.waitForFunction(b=>Math.abs(window.__latest.state.bpm-(b+10.9))<1e-6,start);
  await slowDouble(bpm);const entry=p.getByRole('textbox',{name:'BPM value'});await entry.waitFor();
  await entry.fill('128');await entry.press('Enter');
  await p.waitForFunction(()=>window.__latest.state.bpm===128);
  // A Sampler with a sample: Root, Chop Level and the record sheet use value boxes.
  await p.getByRole('tab',{name:/^Sound$/}).click();
  await send('select',1);
  if((await latest()).state.tracks[1].device!=='sampler')await send('set_device',[1,'sampler']);
  await p.waitForFunction(()=>window.__latest?.state?.tracks?.[1]?.device==='sampler');
  const id=(await latest()).state.tracks[1].sampler.id;
  await send('sampler_load_wav',[1,id,path.join(DATA,'piano notes.wav')]);
  await p.waitForFunction(()=>window.__latest.samplers?.[1]?.status==='READY',null,{timeout:20000});
  const page=p.locator('.sampler-page');
  assert.equal(await page.getByRole('button',{name:/ (up|down)$/}).count(),0,'no − / + steppers on the Sampler');
  const root=page.getByRole('spinbutton',{name:'Root'});await inside(root,'Root box');
  const r0=(await latest()).state.tracks[1].sampler.root;
  await root.click();await root.hover();await p.mouse.wheel(0,-100);await settle();
  await p.waitForFunction(r=>window.__latest.state.tracks[1].sampler.root===r+1,r0);
  await p.keyboard.down('Shift');await p.mouse.wheel(0,-100);await p.keyboard.up('Shift');await settle();
  await p.waitForFunction(r=>window.__latest.state.tracks[1].sampler.root===r+13,r0);
  await slowDouble(root);const re=p.getByRole('textbox',{name:'Root value'});await re.waitFor();
  await re.fill('C3');await re.press('Enter');
  await p.waitForFunction(()=>window.__latest.state.tracks[1].sampler.root===48);
  // Esc drops a typed value.
  await slowDouble(root);await re.waitFor();await re.fill('G5');await re.press('Escape');await settle();
  assert.equal((await latest()).state.tracks[1].sampler.root,48,'Esc keeps the old value');
  // Chop Level: a value box in 1 dB steps (Ctrl: 0.5 dB).
  await p.getByRole('radio',{name:/Chop/}).click();
  const level=p.getByRole('spinbutton',{name:'Level'});await inside(level,'Chop Level');
  await level.click();await p.keyboard.press('ArrowUp');
  await p.waitForFunction(()=>document.querySelector('[data-testid="vbox-Level"]')?.getAttribute('aria-valuenow')==='-29');
  await inside(p.getByRole('spinbutton',{name:'Min'}),'Chop Min');
  await p.screenshot({path:path.join(OUT,'value-boxes-chop-'+H+'.png')});
  // Knob: two quick clicks reset to the default.
  await p.getByRole('radio',{name:/Trim/}).click();
  const tune=page.getByRole('slider',{name:'Tune',exact:true});
  await tune.focus();await p.keyboard.press('ArrowUp');await p.keyboard.press('ArrowUp');
  await p.waitForFunction(()=>window.__latest.state.tracks[1].sampler.tune===2);
  await tune.dblclick();
  await p.waitForFunction(()=>window.__latest.state.tracks[1].sampler.tune===0,null,{timeout:5000});
  const gain=page.getByRole('slider',{name:'Gain',exact:true});
  await gain.focus();await p.keyboard.press('ArrowDown');
  await p.waitForFunction(()=>window.__latest.state.tracks[1].sampler.gain<1);
  await gain.dblclick();await p.waitForFunction(()=>window.__latest.state.tracks[1].sampler.gain===1);
  // Record sheet: Threshold and Longest are value boxes too.
  await page.getByRole('button',{name:/^Record$/}).first().click();
  const sheet=p.getByRole('dialog',{name:'Record into the Sampler'});await sheet.waitFor();
  for(const name of ['Threshold','Longest'])await inside(sheet.getByRole('spinbutton',{name}),name);
  await sheet.getByRole('spinbutton',{name:'Longest'}).click();await p.mouse.wheel(0,-100);
  await p.waitForFunction(()=>document.querySelector('[data-testid="vbox-Longest"]')?.getAttribute('aria-valuetext')==='2:00');
  await p.screenshot({path:path.join(OUT,'value-boxes-record-'+H+'.png')});
  await sheet.getByRole('button',{name:'Done'}).click();await sheet.waitFor({state:'detached'});
  console.log('PASS stage 7 at '+H);
};
