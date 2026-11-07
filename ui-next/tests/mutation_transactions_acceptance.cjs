// M1b: real backend, isolated profile/dummy audio/no physical MIDI scanning.
'use strict';
const {_electron}=require('playwright');
const path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
(async()=>{
 const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,timeout:18000,
  env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'}});
 try{
  const p=await app.firstWindow({timeout:15000});p.setDefaultTimeout(10000);
  await p.getByRole('tab',{name:/PERFORM/i}).click();
  await p.evaluate(()=>{
   window.__mutationSerial=0;window.__mutationState=null;window.__mutationError=null;
   window.deckApi.onMessage(m=>{const serial=++window.__mutationSerial;
    if(m.state)window.__mutationState={serial,...m};
    if(m.error)window.__mutationError={serial,error:m.error};
   });
  });
  const marker=()=>p.evaluate(()=>window.__mutationSerial);
  const send=(cmd,args)=>p.evaluate(([cmd,args])=>window.deckApi.send(cmd,args),[cmd,args]);
  const waitLatest=async(field,after,predicate)=>{
   const deadline=Date.now()+12000;let last;
   while(Date.now()<deadline){
    last=await p.evaluate(field=>window[field],field);
    if(last?.serial>after&&predicate(last))return last;
    await p.waitForTimeout(50);
   }
   assert.fail('No fresh '+field+': '+JSON.stringify(last));
  };
  const act=async(action,predicate)=>{const after=await marker();await action();
   return waitLatest('__mutationState',after,predicate);};
  const pattern=v=>v.state.performance.patterns['1:1'];
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const enter=async(id,value)=>{await p.locator('[data-param="'+id+'"] .knob-value').click();
    const input=p.locator('[data-param="'+id+'"] .knob-entry');await input.fill(String(value));await input.press('Enter');};
  const start=await waitLatest('__mutationState',0,()=>true);
  assert.equal(start.audio,'dummy');assert.deepEqual(start.devices,[]);assert.equal(start.connected,null);
  let current=await act(()=>p.evaluate(()=>{
   window.deckApi.send('edit_note',[1,null,{start:0,duration:.5,note:48,velocity:90}]);
   for(let step=0;step<16;step++)window.deckApi.send('perform_step',[step,Array.from({length:8},(_,i)=>({note:48+i,velocity:70+i,tie:1})),true]);
   window.deckApi.send('perform_set',['seq','mutate_seed',0]);
  }),v=>pattern(v)?.steps.every(step=>step.length===8)&&v.state.performance.seq.mutate_seed===0);
  const original=structuredClone(pattern(current)),song=structuredClone(current.state.tracks);
  await p.getByRole('tab',{name:/^Seq/}).click();
  current=await act(()=>p.getByRole('button',{name:'Mutate',exact:true}).click(),
   v=>v.state.performance.seq.mutate_seed===1&&!equal(pattern(v),original));
  assert.equal(pattern(current).steps.flat().length,128);
  assert.ok(pattern(current).steps.every(step=>step.length<=8));
  assert.deepEqual(current.state.tracks,song);
  const mutated=structuredClone(pattern(current));
  current=await act(()=>p.getByRole('button',{name:'Reset',exact:true}).click(),v=>equal(pattern(v),original));
  assert.deepEqual(current.state.tracks,song);
  current=await act(()=>p.getByRole('button',{name:'Undo',exact:true}).click(),v=>equal(pattern(v),mutated));
  current=await act(()=>send('perform_step',[0,[],true]),v=>pattern(v).steps[0].length===0);
  const edited=structuredClone(pattern(current));
  let after=await marker();await p.getByRole('button',{name:'Reset',exact:true}).click();
  const rejection=await waitLatest('__mutationError',after,v=>v.error.includes('changed'));
  current=await waitLatest('__mutationState',rejection.serial,v=>equal(pattern(v),edited));
  assert.deepEqual(current.state.tracks,song);
  await act(()=>p.getByRole('button',{name:'Undo',exact:true}).click(),v=>equal(pattern(v),mutated));
  await act(()=>p.getByRole('button',{name:'Reset',exact:true}).click(),v=>equal(pattern(v),original));
  await p.getByRole('tab',{name:'Seq',exact:true}).click();
  current=await act(()=>p.getByTestId('pf-pad-1-2').click(),v=>v.state.performance.seq.slot===2);
  await act(()=>send('perform_set',['seq','gate',.4]),v=>v.state.performance.seq.gate===.4);
  const other=(await p.evaluate(()=>window.__mutationState)).state.performance.patterns['1:2'];
  // Chronological Undo belongs to A even though B is selected and edited since then.
  current=await act(()=>p.getByRole('button',{name:'Undo',exact:true}).click(),v=>equal(pattern(v),mutated));
  assert.equal(current.state.performance.seq.slot,2);
  assert.equal(current.state.performance.seq.gate,.4);
  assert.deepEqual(current.state.performance.patterns['1:2'],other);
  assert.deepEqual(current.state.tracks,song);
  assert.equal(pattern(current).steps.flat().length,128);
  after=await marker();await p.getByRole('button',{name:'Reset',exact:true}).click();
  await waitLatest('__mutationError',after,v=>v.error.includes('No mutation'));
  await p.getByRole('tab',{name:/^Arp/}).click();
  await act(()=>p.getByRole('button',{name:/Turn arp on/}).click(),v=>v.state.performance.arp.enabled);
  await act(()=>send('midi',[0x90,60,100]),v=>v.held_notes.includes(60));
  await act(()=>p.getByRole('button',{name:'To seq'}).click(),v=>v.state.performance.seq.enabled&&!v.state.performance.arp.enabled);
  current=await act(()=>p.getByRole('button',{name:'Undo',exact:true}).click(),
   v=>!v.state.performance.seq.enabled&&v.state.performance.arp.enabled);
  assert.deepEqual(current.state.performance.patterns['1:2'],other);
  assert.deepEqual(current.state.tracks,song);
  await p.getByRole('button',{name:'Arp on',exact:true}).waitFor();
  assert.match(await p.getByRole('button',{name:'Arp on',exact:true}).getAttribute('class'),/\bon\b/);
  console.log('PASS: native Mutate conserves 128 notes; Reset and Undo restore the owning pattern');
  console.log('PASS: stale/wrong-slot Reset reports rejection; selected other pattern and SONG remain intact');
  console.log('PASS: conversion Undo restores its owned ARP/SEQ mode flags and original pattern');
 }finally{await app.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
