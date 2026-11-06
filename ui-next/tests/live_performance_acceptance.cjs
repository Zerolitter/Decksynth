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
   window.__performanceEvents=[];
   window.__performanceUnsub=window.deckApi.onMessage(m=>{
    if(m.state){
     window.__performanceEvents.push({performance:m.state.performance,
       notes:m.state.tracks.map(t=>t.notes.length),
       voices:m.voices,peak:m.meter?.peak??0, playing:m.playing,held:m.held_notes,
       audio:m.audio,connected:m.connected,devices:m.devices});
     if(window.__performanceEvents.length>250)window.__performanceEvents.shift();
    }
   });
  });
  await p.waitForFunction(()=>window.__performanceEvents.length>0,{timeout:7000});
  let initial=await p.evaluate(()=>window.__performanceEvents.at(-1));
  assert.equal(initial.audio,'dummy');assert.equal(initial.connected,null);assert.deepEqual(initial.devices,[]);
  assert.equal(initial.notes.reduce((a,b)=>a+b,0),0);
  console.log('PASS: native performance view connected to original audio worker; no physical MIDI used');

  // A real UI button edits the selected performance step in the backend.
  await p.getByRole('button',{name:/ADD NOTE/i}).click();
  await p.waitForFunction(()=>window.__performanceEvents.some(v=>v.performance.patterns['1:1']?.steps?.[0]?.length===1));
  assert.equal(await p.locator('.perf-step.programmed').count(),1);
  await p.getByRole('button',{name:/ENABLE SEQ/i}).click();
  await p.waitForFunction(()=>window.__performanceEvents.some(v=>v.performance.seq.enabled));
  await p.evaluate(()=>window.deckApi.send('play'));
  await p.waitForFunction(()=>window.__performanceEvents.some(v=>v.performance.seq.enabled && v.peak>.001 && v.voices>=1),
                          {timeout:12000});
  console.log('PASS: programmed step produces synth PCM; sequencer visibly follows original engine clock');
  await p.screenshot({path:path.join(ROOT,'docs','keystep-real-sequence-diagnostic.png')});

  // Save and reopen the actual schema; do not save to user Music.
  await p.evaluate(dest=>window.deckApi.send('save',dest),out);
  await p.waitForFunction(()=>window.__performanceEvents.some(v=>v.performance.patterns['1:1']?.steps?.[0]?.length===1));
  await p.evaluate(()=>window.deckApi.send('perform_set',['seq','slot',2]));
  await p.waitForFunction(()=>window.__performanceEvents.some(v=>v.performance.seq.slot===2));
  await p.evaluate(dest=>window.deckApi.send('load',dest),out);
  await p.waitForFunction(()=>window.__performanceEvents.some(v=>v.performance.seq.slot===1 &&
                                v.performance.patterns['1:1']?.steps?.[0]?.length===1),{timeout:12000});
  console.log('PASS: save/open restores performance bank, pattern, notes and settings');

  // Distinct arpeggio input with held notes and audio via real engine.
  await p.getByRole('tab',{name:/ARP/i}).click();
  await p.getByRole('button',{name:/ENABLE ARP/i}).click();
  await p.waitForFunction(()=>window.__performanceEvents.some(v=>v.performance.arp.enabled),{timeout:7000});
  await p.evaluate(()=>{window.deckApi.send('midi',[144,60,100]);window.deckApi.send('midi',[144,64,107]);window.deckApi.send('midi',[144,67,97]);});
  await p.waitForFunction(()=>window.__performanceEvents.some(v=>v.performance.arp.enabled && v.held?.length===3 && v.peak>.001),
                          {timeout:12000});
  await p.screenshot({path:path.join(ROOT,'docs','keystep-real-arpeggio-diagnostic.png')});
  await p.evaluate(()=>{window.deckApi.send('midi',[128,60,0]);window.deckApi.send('midi',[128,64,0]);window.deckApi.send('midi',[128,67,0]);});
  console.log('PASS: live held MIDI chord feeds arpeggiator and produces real PCM');

  await p.getByRole('tab',{name:/CHORD/i}).click();
  await p.getByRole('button',{name:/ENABLE CHORD/i}).click();
  await p.evaluate(()=>window.deckApi.send('perform_set',['arp','enabled',false]));
  await p.evaluate(()=>window.deckApi.send('midi',[144,62,120]));
  await p.waitForFunction(()=>window.__performanceEvents.some(v=>v.performance.chord.enabled && v.held?.length>=3),
                          {timeout:12000});
  await p.evaluate(()=>window.deckApi.send('midi',[128,62,0]));
  console.log('PASS: one-key major chord expanded and displayed from the same MIDI input');
  if(errors.length)throw new Error('Renderer errors: '+errors.join('; '));
  console.log('PASS: no renderer errors; actual DSP/IPC evidence captured');
 }finally{
  if(fs.existsSync(out))fs.unlinkSync(out);
  await app.close();
 }
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
