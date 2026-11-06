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
       notes:m.state.tracks.map(t=>t.notes.length),
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
  let after=await marker();await send('save',out);
  await waitFresh('__performanceMessage',after,v=>v.message==='Saved '+out);
  const saved=JSON.parse(fs.readFileSync(out,'utf8'));
  assert.equal(saved.performance.patterns['1:1'].steps[0][0].note,60);
  // Poison the live pattern after saving, then switch away. Reload must restore it.
  await act(()=>send('perform_step',[0,[],true]),v=>v.performance.patterns['1:1']?.steps[0].length===0);
  await act(()=>send('perform_set',['seq','slot',2]),v=>v.performance.seq.slot===2);
  after=await marker();await send('load',out);
  const opened=await waitFresh('__performanceMessage',after,v=>v.message==='Opened '+out);
  const restored=await stateAfter(opened.serial,v=>v.performance.seq.slot===1 &&
    v.performance.patterns['1:1']?.steps[0]?.[0]?.note===60);
  assert.deepEqual(restored.performance,saved.performance);
  assert.deepEqual(restored.notes,[0,0,0,0]);
  assert.equal(restored.playing,false);
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
  if(errors.length)throw new Error('Renderer errors: '+errors.join('; '));
  console.log('PASS: no renderer errors; actual DSP/IPC evidence captured');
 }finally{
  if(fs.existsSync(out))fs.unlinkSync(out);
  await app.close();
 }
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
