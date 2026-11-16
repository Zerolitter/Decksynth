'use strict';
// One real native workflow, generated audio and isolated settings only.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {launch}=require('./usability-harness.cjs');
(async()=>{
 const persistent=!!process.env.DECKSYNTH_FIXTURE;
 const tmp=persistent?path.resolve(process.env.DECKSYNTH_FIXTURE):fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-r6-music-'));
 const library=path.join(tmp,'Library'),kitDir=path.join(library,'Workflow Kit');fs.mkdirSync(kitDir,{recursive:true});
 execFileSync('python3',['-c',`import sys,wave,math,struct,pathlib
p=pathlib.Path(sys.argv[1])
for name,hz in [('Kick',90),('Snare',195),('_Demo Loop 124bpm',300)]:
 with wave.open(str(p/(name+'.wav')),'wb') as w:
  w.setparams((1,2,48000,0,'NONE','PCM'))
  w.writeframes(b''.join(struct.pack('<h',int(10000*math.sin(2*math.pi*hz*i/48000)*math.exp(-i/9000))) for i in range(24000)))`,kitDir]);
 const h=await launch('r6'),{page,send,height,shot}=h;
 const state=()=>page.evaluate(()=>window.usabilityState.state);
 const dismiss=async()=>{if(await page.getByRole('button',{name:'Dismiss message',exact:true}).count())await page.getByRole('button',{name:'Dismiss message',exact:true}).click();};
 try{
  await height(718);await page.getByRole('tab',{name:'Sound',exact:true}).click();
  await send('set_device',[0,'drum_rack']);await page.locator('.drum-rack').waitFor();
  await send('drum_library_root',library);
  await page.getByRole('button',{name:'Browse drum kits',exact:true}).click();
  await page.getByRole('button',{name:/Workflow Kit.*3 WAV/}).click();
  const empty=(await state()).tracks[0].drum_rack;
  await page.getByRole('button',{name:'Load kit',exact:true}).click();
  await page.waitForFunction(id=>window.usabilityState.state.tracks[0].drum_rack.id!==id,empty.id);
  await page.locator('.drum-kit-browser').waitFor({state:'detached'});
  const loaded=(await state()).tracks[0].drum_rack;
  assert.equal(loaded.pads.filter(p=>p.source).length,2);assert.equal(await page.locator('.drum-pad').count(),16);
  await page.getByRole('button',{name:'Browse drum kits',exact:true}).click();
  await page.getByRole('button',{name:/Workflow Kit.*3 WAV/}).click();
  await page.getByRole('button',{name:'Listen to Snare',exact:true}).click();
  await page.waitForFunction(()=>window.usabilityState.drum_library?.preview?.folder==='Workflow Kit');
  assert.deepEqual((await state()).tracks[0].drum_rack,loaded,'Listen is nonmutating');
  await page.getByRole('button',{name:'Replace pad 1 with Snare',exact:true}).click();
  await page.locator('.drum-kit-browser').waitFor({state:'detached'});
  await page.waitForFunction(()=>window.usabilityState.state.tracks[0].drum_rack.pads[0].name==='Snare');
  const swapped=(await state()).tracks[0].drum_rack;
  assert.equal(swapped.id,loaded.id);assert.deepEqual(swapped.pads.slice(1),loaded.pads.slice(1));
  console.log('PASS choose kit, return to pads, nonmutating Listen, one-pad Swap');
  // Drum steps write the open SEQ pattern (the same pattern Perform edits), not the Song clip.
  const original=(await state()).tracks[0].notes;
  for(const n of [1,5])await page.getByTestId('drum-step-'+n).click();
  await page.waitForFunction(()=>{const p=window.usabilityState.state.performance.patterns['1:1'];return p&&p.steps.flat().length===2;});
  const pattern=(await state()).performance.patterns['1:1'];
  assert.equal(pattern.steps[0][0].note,36);assert.equal(pattern.steps[4][0].note,36);
  assert.deepEqual((await state()).tracks[0].notes,original,'the Song clip is untouched by drum steps');
  await shot('steps-to-transfer',718);
  await page.getByRole('tab',{name:'Perform',exact:true}).click();
  await send('clip',[0,'open',1,null]);await page.waitForFunction(()=>window.usabilityState.state.clips.open[0]===1);
  await page.getByTestId('pf-transfer-target').filter({hasText:'Clip B'}).waitFor();
  await page.getByRole('button',{name:'Pattern → Song',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Pattern added to open Song clip'}).waitFor();
  await page.waitForFunction(()=>window.usabilityState.state.tracks[0].notes.length===8);
  const transferred=(await state()).tracks[0].notes;
  assert.deepEqual(transferred.map(n=>n.start),[0,1,4,5,8,9,12,13]);
  assert.ok(transferred.every(n=>n.note===36&&n.velocity===100));
  assert.deepEqual((await state()).clips.slots[0][0],original);
  console.log('PASS drum steps → Pattern → Clip B fill, preserving Clip A');
  await page.getByRole('tab',{name:'Song',exact:true}).click();
  await page.getByRole('radiogroup',{name:'Play mode',exact:true}).getByRole('radio',{name:'Song',exact:true}).click();
  await page.locator('.arr-block[aria-label^="Track 1 block"]').first().click();
  await page.getByRole('radiogroup',{name:'Block clip',exact:true}).getByRole('radio',{name:'Clip B',exact:true}).click();
  await page.waitForFunction(()=>window.usabilityState.state.song.on&&window.usabilityState.state.song.lanes[0][0].clip===1);
  {const len=page.getByRole('spinbutton',{name:'Block length',exact:true});await len.focus();await len.press('ArrowDown');}
  await page.waitForFunction(()=>window.usabilityState.state.song.lanes[0][0].len===15);
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await dismiss();
  for(const size of [718,800]){await height(size);await shot('arranged-native-project',size);}
  await send('play');await page.waitForFunction(()=>window.usabilityState.playing&&window.usabilityState.song_beat>0);
  await send('stop');await page.waitForFunction(()=>!window.usabilityState.playing);
  const before=await state(),file=path.join(tmp,'Generated recovery workflow.decksynth');
  await send('save',file);
  for(let i=0;i<100&&!fs.existsSync(file);i++)await new Promise(r=>setTimeout(r,20));
  assert.ok(fs.existsSync(file));const bytes=fs.readFileSync(file);
  await send('clip',[0,'clear',1,null]);await page.waitForFunction(()=>window.usabilityState.state.tracks[0].notes.length===0);
  await send('load',file);
  await page.waitForFunction(notes=>JSON.stringify(window.usabilityState.state.tracks[0].notes)===notes,JSON.stringify(transferred));
  const after=await state();
  for(const k of ['tracks','clips','performance','song'])assert.deepEqual(after[k],before[k],k+' round trip');
  assert.deepEqual(fs.readFileSync(file),bytes);assert.ok(!bytes.toString().includes('pcm'));
  await dismiss();await height(718);await shot('reopened-native-project',718);
  fs.writeFileSync(path.join(tmp,'ROUNDTRIP.json'),JSON.stringify({source:'generated WAVs only',project:file,track0:after.tracks[0].notes,clipA:after.clips.slots[0][0],song:after.song},null,2));
  console.log('PASS actual SONG arrangement, sample-clock transport, native save/reopen: music, kit, clips, pattern and arrangement preserved');
 }finally{await h.close();if(!persistent)fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
