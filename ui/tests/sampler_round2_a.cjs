// Round 2, batch A (Sir, 16 Nov). Knob gestures: a quick double-click only resets; one click on the value box arms
// the wheel (Shift bigger, Ctrl finer); two slow clicks open number entry. A Sampler knob is heard while it turns.
// The MIDI status sits in Settings, not in the top bar.
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
  const tune=p.getByRole('slider',{name:'Tune',exact:true}),box=p.getByRole('button',{name:'Tune value box'});
  const entry=p.getByLabel('Tune numeric value');
  const mid=async l=>{const b=await l.boundingBox();return [b.x+b.width/2,b.y+b.height/2];};
  await send('sampler_edit',[t,(await S()).id,'tune',5]);await p.waitForFunction(t=>window.__latest.state.tracks[t].sampler.tune===5,t);
  // 1. One click on the value box arms it; it does not open number entry.
  const [bx,by]=await mid(box);
  await p.mouse.click(bx,by);await p.waitForTimeout(250);
  assert.equal(await entry.count(),0,'one click does not open number entry');
  assert.match(await box.getAttribute('class'),/armed/,'one click arms the wheel');
  // 2. The wheel moves it: a notch is a semitone, Shift is bigger; one run of the wheel is one undo step.
  await p.mouse.wheel(0,-100);await p.mouse.wheel(0,-100);
  await p.waitForFunction(t=>window.__latest.state.tracks[t].sampler.tune===7,t);
  await p.keyboard.down('Shift');await p.mouse.wheel(0,100);await p.keyboard.up('Shift');
  await p.waitForFunction(t=>window.__latest.state.tracks[t].sampler.tune===2,t);
  // 3. Two quick clicks on the box: still no entry.
  await p.mouse.click(bx,by);await p.waitForTimeout(90);await p.mouse.click(bx,by);await p.waitForTimeout(300);
  assert.equal(await entry.count(),0,'two quick clicks do not open number entry');
  // 4. Two slow clicks open it.
  await p.waitForTimeout(1700);await p.mouse.click(bx,by);await p.waitForTimeout(650);await p.mouse.click(bx,by);
  await entry.waitFor();await entry.fill('9');await entry.press('Enter');
  await p.waitForFunction(t=>window.__latest.state.tracks[t].sampler.tune===9,t);
  // 5. A quick double-click on the knob resets it, and nothing opens.
  const [kx,ky]=await mid(tune);
  await p.mouse.click(kx,ky);await p.waitForTimeout(80);await p.mouse.click(kx,ky);
  await p.waitForFunction(t=>window.__latest.state.tracks[t].sampler.tune===0,t);await p.waitForTimeout(300);
  assert.equal(await entry.count(),0,'a double-click on the knob only resets it');
  // 6. While the knob turns, the engine already plays the value; the project gets it on release.
  // Watch the commands in the main process (the renderer's bridge object is frozen).
  await app.evaluate(({ipcMain})=>{globalThis.__sent=[];ipcMain.on('deck-command',(_e,c)=>globalThis.__sent.push(c));});
  await p.mouse.move(kx,ky);await p.mouse.down();await p.mouse.move(kx,ky-40,{steps:8});await p.waitForTimeout(200);
  const sent=await app.evaluate(()=>globalThis.__sent);
  assert.ok(sent.includes('sampler_live'),'a turning knob sends live values');assert.ok(!sent.includes('sampler_edit'),'the edit waits for the release');
  assert.equal((await S()).tune,0);
  await p.mouse.up();await p.waitForFunction(t=>window.__latest.state.tracks[t].sampler.tune>0,t);
  await p.getByRole('button',{name:'Undo',exact:true}).click();await p.waitForFunction(t=>window.__latest.state.tracks[t].sampler.tune===0,t);
  // 7. MIDI status: gone from the top bar, shown in Settings.
  assert.equal(await p.locator('.device-pill').count(),0,'no MIDI pill in the top bar');
  await p.getByRole('button',{name:'Settings',exact:true}).click();await p.getByRole('tab',{name:'MIDI',exact:true}).click();
  const status=p.getByRole('status',{name:'MIDI keyboard'});await status.waitFor();
  assert.match(await status.innerText(),/No MIDI keyboard[\s\S]*CONNECTED/);
  await p.screenshot({path:path.join(OUT,'settings-midi-'+H+'.png')});
  await p.keyboard.press('Escape');if(await status.count())await p.getByRole('button',{name:/CLOSE/}).click();
  console.log('PASS round 2 A at '+H);
};
