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
  await p.locator('.pf').waitFor({state:'visible'});
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
       audio:m.audio,connected:m.connected,devices:m.devices,arp_view:m.arp_view};
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
    const actual=await p.evaluate(()=>{
      const knob=id=>document.querySelector('[data-testid="knob-'+id+'"]');
      const bar=document.querySelector('[data-testid="pf-seq-timing"]');
      return {length:Number(bar.dataset.length),
        division:bar.dataset.division,
        gate:Number(knob('pf-seq-gate').getAttribute('aria-valuenow'))/100,
        swing:Number(knob('pf-seq-swing').getAttribute('aria-valuenow'))/100};
    });
    assert.deepEqual(actual,expected,'Actual SEQ controls must match effective pattern timing');
  };
  // Exact entry on a knob: tap its value, type, Enter.
  const enter=async(id,value)=>{await p.locator('[data-param="'+id+'"] .knob-value').click();
    const input=p.locator('[data-param="'+id+'"] .knob-entry');await input.fill(String(value));await input.press('Enter');};
  const initial=await stateAfter(0,()=>true);
  assert.equal(initial.audio,'dummy');assert.equal(initial.connected,null);assert.deepEqual(initial.devices,[]);
  assert.equal(initial.notes.reduce((a,b)=>a+b,0),0);
  console.log('PASS: native performance view connected to original audio worker; no physical MIDI used');

  // A real UI button edits the selected performance step in the backend.
  await act(()=>p.getByTestId('pf-cell-1-60').click(),
    v=>v.performance.patterns['1:1']?.steps?.[0]?.length===1);
  assert.equal(await p.locator('.pf-note').count(),1);
  await act(()=>p.getByRole('button',{name:/Turn sequencer on/}).click(),v=>v.performance.seq.enabled);
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
  await p.getByRole('tab',{name:/^Arp/}).click();
  await act(()=>p.getByRole('button',{name:/Turn arp on/}).click(),v=>v.performance.arp.enabled);
  await act(()=>p.evaluate(()=>{window.deckApi.send('midi',[144,60,100]);window.deckApi.send('midi',[144,64,107]);window.deckApi.send('midi',[144,67,97]);}),
    v=>v.performance.arp.enabled && v.held?.length===3 && v.peak>.001);
  // The step lane shows the arpeggiator's real notes, and the new controls reach the engine.
  await p.locator('.pf-roll:not(.example)').waitFor({state:'visible',timeout:8000});
  const lane=(await p.locator('.pf-roll:not(.example) .pf-roll-head [data-names]').evaluateAll(es=>es.map(e=>e.dataset.names))).slice(0,3);
  assert.deepEqual(lane,['C4','E4','G4'],'arp roll shows the held notes in Up order');
  await p.locator('.pf-roll-cell.live').first().waitFor({state:'visible',timeout:8000});
  const rate=p.getByRole('group',{name:'Arp rate'}),feel=p.getByRole('group',{name:'Arp feel'});
  await act(()=>rate.getByRole('button',{name:'1/32'}).click(),v=>v.performance.arp.division==='1/32');
  await act(()=>feel.getByRole('button',{name:'Triplet'}).click(),v=>v.performance.arp.division==='1/32T');
  await act(()=>rate.getByRole('button',{name:'1/16'}).click(),v=>v.performance.arp.division==='1/16T');
  await act(()=>feel.getByRole('button',{name:'Straight'}).click(),v=>v.performance.arp.division==='1/16');
  await act(()=>p.getByRole('group',{name:'Arp octaves'}).getByRole('button',{name:'3',exact:true}).click(),v=>v.performance.arp.octaves===3);
  const walk=await act(()=>p.getByRole('group',{name:'Octave direction'}).getByRole('button',{name:'Up-Down'}).click(),
    v=>v.performance.arp.octave_mode==='UpDown' && v.arp_view?.groups?.length===12);
  assert.deepEqual(walk.arp_view.groups.map(g=>g[0]),[60,64,67,72,76,79,84,88,91,72,76,79]);
  await act(()=>p.getByRole('button',{name:'Restart on bar'}).click(),v=>v.performance.arp.restart_bar===true);
  await act(()=>p.getByRole('button',{name:'Restart on bar'}).click(),v=>v.performance.arp.restart_bar===false);
  await act(()=>p.getByRole('group',{name:'Octave direction'}).getByRole('button',{name:'Up',exact:true}).click(),v=>v.performance.arp.octave_mode==='Up');
  await act(()=>p.getByRole('group',{name:'Arp octaves'}).getByRole('button',{name:'1',exact:true}).click(),v=>v.performance.arp.octaves===1);
  await act(()=>p.getByRole('button',{name:'Vel played'}).click(),v=>v.performance.arp.velocity==='Fixed 100');
  await act(()=>p.getByRole('button',{name:'Vel 100'}).click(),v=>v.performance.arp.velocity==='Accent first');
  await act(()=>enter('pf-arp-spice',50),v=>v.performance.arp.spice===.5);
  await act(()=>p.getByRole('button',{name:'Dice'}).click(),v=>v.performance.arp.spice_seed===2);
  await act(()=>send('perform_set',['arp','spice',0]),v=>v.performance.arp.spice===0);
  console.log('PASS: arp lane, rate shortcuts, velocity and Dice reach the engine');
  await p.screenshot({path:path.join(ROOT,'docs','keystep-real-arpeggio-diagnostic.png')});
  await act(()=>p.evaluate(()=>{window.deckApi.send('midi',[128,60,0]);window.deckApi.send('midi',[128,64,0]);window.deckApi.send('midi',[128,67,0]);}),
    v=>v.held?.length===0 && v.voices===0);
  console.log('PASS: live held MIDI chord feeds arpeggiator and produces real PCM');
  // The on-screen touch keyboard plays the same engine path as a MIDI keyboard.
  const key=await p.locator('.pf-piano [data-note="72"]').boundingBox();
  await p.mouse.move(key.x+key.width/2,key.y+key.height*.85);
  await act(()=>p.mouse.down(),v=>v.held?.includes(72) && v.peak>.001);
  await act(()=>p.mouse.up(),v=>v.held?.length===0);
  console.log('PASS: touch keyboard notes reach the arpeggiator and produce real PCM');

  await p.getByRole('tab',{name:/^Chord/}).click();
  await act(()=>p.getByRole('button',{name:/Turn chord on/}).click(),v=>v.performance.chord.enabled);
  await act(()=>send('perform_set',['arp','enabled',false]),v=>!v.performance.arp.enabled);
  const chord=await act(()=>send('midi',[144,62,120]),v=>v.performance.chord.enabled && v.held?.length===3);
  assert.deepEqual(chord.held,[62,66,69]);
  await act(()=>send('midi',[128,62,0]),v=>v.held?.length===0 && v.voices===0);
  await act(()=>p.getByRole('group',{name:'Bass note'}).getByRole('button',{name:'Bass −1 octave'}).click(),v=>v.performance.chord.bass===1);
  await act(()=>p.getByRole('group',{name:'Strum sync'}).getByRole('button',{name:'1/16'}).click(),v=>v.performance.chord.strum_sync==='1/16');
  const bass=await act(()=>send('midi',[144,62,120]),v=>v.held?.length===4);
  assert.deepEqual(bass.held,[50,62,66,69]);
  await act(()=>send('midi',[128,62,0]),v=>v.held?.length===0);
  await act(()=>send('perform_set',['chord','bass',0]),v=>v.performance.chord.bass===0);
  await act(()=>send('perform_set',['chord','strum_sync','Off']),v=>v.performance.chord.strum_sync==='Off');
  console.log('PASS: one-key major chord expanded and displayed from the same MIDI input');
  // A chord pad plays its exact notes through the real engine, and a long-press keeps it in My chords.
  const pad=await p.getByTestId('cb-pad-vi').boundingBox();
  await p.mouse.move(pad.x+pad.width/2,pad.y+pad.height/2);
  const padOn=await act(()=>p.mouse.down(),v=>v.held?.length===3 && v.peak>.001);
  assert.deepEqual(padOn.held,[57,60,64]);
  await act(()=>p.mouse.up(),v=>v.held?.length===0);
  await act(()=>send('perform_action',['save_slot',[0,[57,60,64]]]),v=>v.performance.chord.slots?.[0]?.length===3);
  await act(()=>send('perform_action',['clear_slot',0]),v=>v.performance.chord.slots?.[0]?.length===0);
  console.log('PASS: chord pad plays A C E through the engine; My chords slots save and clear');

  // M1a: fresh backend transitions AND actual rendered control values.
  await p.getByRole('tab',{name:'Seq',exact:true}).click();
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
  // Pattern pads: 1-16 are bank 1, 17-32 bank 2 (so 18 is bank 2, pattern 2). Pick the bank first.
  const pickPad=async v=>{const b=Math.ceil(v/16),sl=(v-1)%16+1,bank=p.getByRole('button',{name:'Bank '+b,exact:true});
    if((await bank.getAttribute('aria-pressed'))!=='true'){await bank.click();await p.getByTestId('pf-pad-'+b+'-'+sl).waitFor();}
    await p.getByTestId('pf-pad-'+b+'-'+sl).click();};
  for(const [value,t] of [
    [2,expectedTiming(12,'1/8',.9,.5)],
    [18,expectedTiming(9,'1/4',.3,.6)],
    [2,expectedTiming(12,'1/8',.9,.5)],
    [1,expectedTiming(7,'1/8T',.2,.7)],
    [3,expectedTiming(16,'1/16',.8,.5)],
  ]){
    current=await act(()=>pickPad(value),v=>matches(v,t)&&v.performance.seq.bank===Math.ceil(value/16)&&v.performance.seq.slot===(value-1)%16+1);
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
  await p.getByRole('button',{name:'More pattern tools'}).click();
  current=await act(()=>p.getByRole('button',{name:'Song → ptn'}).click(),v=>matches(v,expectedTiming(7,'1/8T',.8,.5)));
  await p.getByRole('tab',{name:'Seq',exact:true}).click();
  await checkControls(expectedTiming(7,'1/8T',.8,.5));assert.deepEqual(current.tracks,project.tracks);
  assert.deepEqual(current.performance.patterns['1:1'].steps[0],[{note:60,velocity:91,tie:2}]);
  await p.getByRole('tab',{name:/^Arp/}).click();
  await act(()=>p.evaluate(()=>{
    window.deckApi.send('perform_set',['arp','enabled',true]);
    window.deckApi.send('perform_set',['arp','division','1/8T']);
    window.deckApi.send('perform_set',['arp','gate',.6]);
    window.deckApi.send('perform_set',['arp','swing',.62]);
    for(const note of [60,64,67])window.deckApi.send('midi',[144,note,100]);
  }),v=>v.performance.arp.gate===.6 && v.performance.arp.swing===.62 && v.held?.length===3);
  current=await act(()=>p.getByRole('button',{name:'To seq'}).click(),v=>matches(v,expectedTiming(3,'1/8T',.6,.62)));
  await p.getByRole('tab',{name:'Seq',exact:true}).click();
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
