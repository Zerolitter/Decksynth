// Native Electron ↔ real Python KeyStep-style performance engine acceptance.
// SDL dummy sink; physical MIDI scanning disabled. No user projects touched.
'use strict';
const {_electron}=require('playwright');
const path=require('node:path'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os');
const ROOT=path.resolve(__dirname,'..');
(async()=>{
 const app=await _electron.launch({
  executablePath:path.join(ROOT,'node_modules','electron','dist','electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,timeout:18000,
  env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',
       SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},
 });
 const out=path.join(os.tmpdir(),'decksynth-performance-accept-'+process.pid+'.decksynth');
 const timingDir=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-m1a-'));
 try{
  const p=await app.firstWindow({timeout:18000});const errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  await p.getByRole('tab',{name:/PERFORM/i}).click();
  await p.locator('.perf-workspace').waitFor({state:'visible'});
  await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent==='CONNECTED',{timeout:15000});
  await p.evaluate(()=>{
   window.__performanceSerial=0;
   window.__performanceEvent=null;
   window.__performanceMessage=null;
   window.__performanceErrors=[];
   window.__performanceUnsub=window.deckApi.onMessage(m=>{
    const serial=++window.__performanceSerial;
    if(m.message)window.__performanceMessage={serial,message:m.message};
    if(m.error)window.__performanceErrors.push(m.error);
    if(m.state){
     window.__performanceEvent={serial,performance:m.state.performance,
       notes:m.state.tracks.map(t=>t.notes.length),tracks:m.state.tracks,
       voices:m.voices,peak:m.meter?.peak??0, playing:m.playing,held:m.held_notes,
       audio:m.audio,connected:m.connected,devices:m.devices};
    }
   });
  });
  // Check only the latest snapshot, strictly after the action's receive marker.
  // A state that matched before the command must never satisfy a later check.
  const marker=()=>p.evaluate(()=>window.__performanceSerial);
  const waitFresh=async(field,after,predicate)=>{
   const deadline=Date.now()+12000;let latest;
   while(Date.now()<deadline){
    const observation=await p.evaluate(field=>({latest:window[field],errors:window.__performanceErrors}),field);
    assert.deepEqual(observation.errors,[],'Unexpected backend error');
    latest=observation.latest;
    if(latest?.serial>after && predicate(latest))return latest;
    await p.waitForTimeout(50);
   }
   assert.fail('No fresh '+field+' after '+after+': '+JSON.stringify(latest));
  };
  const stateAfter=(after,predicate)=>waitFresh('__performanceEvent',after,predicate);
  const act=async(action,predicate)=>{const after=await marker();await action();return stateAfter(after,predicate);};
  const send=(cmd,args)=>p.evaluate(([cmd,args])=>window.deckApi.send(cmd,args),[cmd,args]);
  const expectedTiming=(length,division,gate,swing)=>({length,division,gate,swing});
  const matches=(v,t)=>['length','division','gate','swing'].every(k=>v.performance.seq[k]===t[k]);
  const checkControls=async(expected)=>{
    const actual=await p.evaluate(()=>({
      length:Number(document.querySelector('.perf-top-controls .perf-counter strong').textContent),
      division:[...document.querySelectorAll('.perf-top-controls select')].at(-1).value,
      gate:Number(document.querySelectorAll('.perf-utilities .perf-level input')[0].value)/100,
      swing:Number(document.querySelectorAll('.perf-utilities .perf-level input')[1].value)/100,
    }));
    assert.deepEqual(actual,expected,'Actual SEQ controls must match effective pattern timing');
  };
  const initial=await stateAfter(0,()=>true);
  assert.equal(initial.audio,'dummy');assert.equal(initial.connected,null);assert.deepEqual(initial.devices,[]);
  assert.equal(initial.notes.reduce((a,b)=>a+b,0),0);
  console.log('PASS: native performance view connected to original audio worker; no physical MIDI used');

  // A real UI button edits the selected performance step in the backend.
  await act(()=>p.getByRole('button',{name:/ADD NOTE/i}).click(),
    v=>v.performance.patterns['1:1']?.steps?.[0]?.length===1);
  assert.equal(await p.locator('.perf-step.programmed').count(),1);
  await act(()=>p.getByRole('button',{name:/ENABLE SEQ/i}).click(),v=>v.performance.seq.enabled);
  await act(()=>send('play'),v=>v.playing && v.performance.seq.enabled && v.peak>.001 && v.voices>=1);
  console.log('PASS: programmed step produces synth PCM; sequencer visibly follows original engine clock');
  await p.screenshot({path:path.join(ROOT,'docs','keystep-real-sequence-diagnostic.png')});

  // Save and reopen the actual schema; do not save to user Music.
  const savedTiming=expectedTiming(7,'1/8T',.2,.7);
  const setTiming=t=>p.evaluate(t=>{
    for(const [key,value] of Object.entries(t))window.deckApi.send('perform_set',['seq',key,value]);
  },t);
  await act(()=>setTiming(savedTiming),v=>matches(v,savedTiming));
  await checkControls(savedTiming);
  let after=await marker();await send('save',out);
  await waitFresh('__performanceMessage',after,v=>v.message==='Saved '+out);
  const saved=JSON.parse(fs.readFileSync(out,'utf8'));
  assert.deepEqual(Object.fromEntries(Object.keys(savedTiming).map(k=>[k,saved.performance.seq[k]])),savedTiming);
  assert.equal(saved.performance.patterns['1:1'].steps[0][0].note,60);
  // Poison the live pattern after saving, then switch away. Reload must restore it.
  await act(()=>send('perform_step',[0,[],true]),v=>v.performance.patterns['1:1']?.steps[0].length===0);
  const changedTiming=expectedTiming(12,'1/8',.9,.5);
  await act(()=>setTiming(changedTiming),v=>matches(v,changedTiming));
  await checkControls(changedTiming);
  await act(()=>send('perform_set',['seq','slot',2]),v=>v.performance.seq.slot===2);
  after=await marker();await send('load',out);
  const opened=await waitFresh('__performanceMessage',after,v=>v.message==='Opened '+out);
  const restored=await stateAfter(opened.serial,v=>v.performance.seq.slot===1 && matches(v,savedTiming) &&
    v.performance.patterns['1:1']?.steps[0]?.[0]?.note===60);
  assert.deepEqual(restored.performance,saved.performance);
  assert.deepEqual(restored.notes,[0,0,0,0]);
  assert.equal(restored.playing,false);
  await checkControls(savedTiming);
  console.log('PASS: save/open restores performance bank, pattern, notes and settings');

  // Distinct arpeggio input with held notes and audio via real engine.
  await p.getByRole('tab',{name:/ARP/i}).click();
  await act(()=>p.getByRole('button',{name:/ENABLE ARP/i}).click(),v=>v.performance.arp.enabled);
  await act(()=>p.evaluate(()=>{window.deckApi.send('midi',[144,60,100]);window.deckApi.send('midi',[144,64,107]);window.deckApi.send('midi',[144,67,97]);}),
    v=>v.performance.arp.enabled && v.held?.length===3 && v.peak>.001);
  await p.screenshot({path:path.join(ROOT,'docs','keystep-real-arpeggio-diagnostic.png')});
  await act(()=>p.evaluate(()=>{window.deckApi.send('midi',[128,60,0]);window.deckApi.send('midi',[128,64,0]);window.deckApi.send('midi',[128,67,0]);}),
    v=>v.held?.length===0 && v.voices===0);
  console.log('PASS: live held MIDI chord feeds arpeggiator and produces real PCM');

  await p.getByRole('tab',{name:/CHORD/i}).click();
  await act(()=>p.getByRole('button',{name:/ENABLE CHORD/i}).click(),v=>v.performance.chord.enabled);
  await act(()=>send('perform_set',['arp','enabled',false]),v=>!v.performance.arp.enabled);
  const chord=await act(()=>send('midi',[144,62,120]),v=>v.performance.chord.enabled && v.held?.length===3);
  assert.deepEqual(chord.held,[62,66,69]);
  await act(()=>send('midi',[128,62,0]),v=>v.held?.length===0 && v.voices===0);
  console.log('PASS: one-key major chord expanded and displayed from the same MIDI input');

  // M1a: fresh backend transitions AND actual rendered control values.
  await p.getByRole('tab',{name:'SEQ',exact:true}).click();
  const loadTiming=async(file,t)=>{
    const start=await marker();await send('load',file);
    const acknowledgement=await waitFresh('__performanceMessage',start,v=>v.message==='Opened '+file);
    const result=await stateAfter(acknowledgement.serial,v=>matches(v,t));
    await checkControls(t);return result;
  };
  const makePattern=(length,division,gate,swing,note)=>({length,division,gate,swing,
    steps:Array.from({length},(_,i)=>i===0?[{note,velocity:100,tie:1}]:[])});
  const project=structuredClone(saved);
  project.tracks[0].notes=[{start:0,duration:.5,note:60,velocity:91},{start:1,duration:.25,note:64,velocity:82}];
  project.performance.seq={...project.performance.seq,slot:1,length:16,division:'1/16',gate:.9,swing:.5};
  project.performance.patterns={'1:1':makePattern(7,'1/8T',.2,.7,60),
    '1:2':makePattern(12,'1/8',.9,.5,64),'2:2':makePattern(9,'1/4',.3,.6,67)};
  const inconsistent=path.join(timingDir,'inconsistent.decksynth');
  const original=JSON.stringify(project);fs.writeFileSync(inconsistent,original);
  let current=await loadTiming(inconsistent,expectedTiming(7,'1/8T',.2,.7));
  assert.deepEqual(current.tracks,project.tracks);
  for(const [label,value,t] of [
    ['PATTERN','2',expectedTiming(12,'1/8',.9,.5)],
    ['BANK','2',expectedTiming(9,'1/4',.3,.6)],
    ['BANK','1',expectedTiming(12,'1/8',.9,.5)],
    ['PATTERN','1',expectedTiming(7,'1/8T',.2,.7)],
    ['PATTERN','3',expectedTiming(16,'1/16',.8,.5)],
  ]){
    current=await act(()=>p.locator('.perf-top-controls select').nth(label==='BANK'?0:1).selectOption(value),v=>matches(v,t));
    await checkControls(t);
    assert.deepEqual(current.tracks,project.tracks);
    assert.deepEqual(current.performance.patterns,project.performance.patterns);
  }
  const legacy=structuredClone(project);legacy.performance.patterns={};delete legacy.performance.sync;
  legacy.performance.seq={...legacy.performance.seq,length:7,division:'1/8T',gate:.2,swing:.7,recording:true};
  const legacyFile=path.join(timingDir,'empty.decksynth');fs.writeFileSync(legacyFile,JSON.stringify(legacy));
  current=await loadTiming(legacyFile,expectedTiming(7,'1/8T',.8,.5));
  assert.equal(current.performance.seq.recording,false);assert.deepEqual(current.performance.patterns,{});
  await loadTiming(inconsistent,expectedTiming(7,'1/8T',.2,.7));
  current=await act(()=>p.getByRole('button',{name:/SONG → PATTERN/}).click(),v=>matches(v,expectedTiming(7,'1/8T',.8,.5)));
  await checkControls(expectedTiming(7,'1/8T',.8,.5));assert.deepEqual(current.tracks,project.tracks);
  assert.deepEqual(current.performance.patterns['1:1'].steps[0],[{note:60,velocity:91,tie:2}]);
  await p.getByRole('tab',{name:'ARP',exact:true}).click();
  await act(()=>p.evaluate(()=>{
    window.deckApi.send('perform_set',['arp','enabled',true]);
    window.deckApi.send('perform_set',['arp','division','1/8T']);
    window.deckApi.send('perform_set',['arp','gate',.6]);
    window.deckApi.send('perform_set',['arp','swing',.62]);
    for(const note of [60,64,67])window.deckApi.send('midi',[144,note,100]);
  }),v=>v.performance.arp.gate===.6 && v.performance.arp.swing===.62 && v.held?.length===3);
  current=await act(()=>p.getByRole('button',{name:/ARP → SEQUENCE/}).click(),v=>matches(v,expectedTiming(3,'1/8T',.6,.62)));
  await p.getByRole('tab',{name:'SEQ',exact:true}).click();
  await checkControls(expectedTiming(3,'1/8T',.6,.62));assert.deepEqual(current.tracks,project.tracks);
  const chainFile=path.join(timingDir,'chain23.decksynth');
  const chainBytes=fs.readFileSync(path.resolve(ROOT,'../tests/fixtures/m1a-chain-23.decksynth'));
  fs.writeFileSync(chainFile,chainBytes);
  current=await loadTiming(chainFile,expectedTiming(7,'1/16',.2,.5));
  assert.equal(current.performance.patterns['1:2'].length,16);
  assert.deepEqual(fs.readFileSync(chainFile),chainBytes);
  assert.equal(fs.readFileSync(inconsistent,'utf8'),original);
  console.log('PASS: M1a bank/slot, stored/empty load, SONG/ARP timing and 23-step chain migration; fresh native controls');
  if(errors.length)throw new Error('Renderer errors: '+errors.join('; '));
  console.log('PASS: no renderer errors; actual DSP/IPC evidence captured');
 }finally{
  if(fs.existsSync(out))fs.unlinkSync(out);
  fs.rmSync(timingDir,{recursive:true,force:true});
  await app.close();
 }
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
