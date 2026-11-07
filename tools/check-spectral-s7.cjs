'use strict';
// Attach to the owned development app. Synthetic MIDI and short real-output checks are labelled explicitly.
// This disconnects from CDP without closing the user's app, and restores the prior project/output.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),{chromium}=require(path.join(ROOT,'ui-next/node_modules/playwright'));
const OUT=path.join(ROOT,'artifacts/recovery/spectral-s7'),SCREENS=path.join(ROOT,'decksynth/screens/spectral-s7');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(SCREENS,{recursive:true});const config=JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts/recovery/active-development.json')));
 execFileSync('python3',['-c',`
from pathlib import Path
from decksynth.core import Project
from decksynth.fx import default_chain
out=Path('artifacts/recovery/spectral-s7')
p=Project();p.bars=8
for i,t in enumerate(p.tracks):
 t['volume']=.15;t['instrument'].update(attack=.005,decay=.02,sustain=.7,release=.1,pan=[-.6,-.2,.2,.6][i]);t['notes']=[dict(start=0.,duration=32.,note=48+i+j*4,velocity=60) for j in range(4)];c=default_chain()
 for m in c['modules']:
  if m['id'] in ('chorus','delay','reverb','cloud'):
   m['on']=True
   if m['id']!='cloud':m['params']['width']=.7
 t['fx']=c
p.save(out/'four-track-stress.decksynth')
p=Project()
for t in p.tracks:t['volume']=.15;t['instrument'].update(attack=.005,decay=.02,sustain=.7,release=.1)
p.save(out/'midi-probe.decksynth')
`],{cwd:ROOT});
 const browser=await chromium.connectOverCDP('http://127.0.0.1:'+config.port),p=browser.contexts()[0].pages()[0];
 await p.evaluate(()=>{window.__s7messages=[];window.deckApi.onMessage(m=>{if(m.state)window.__s7=m;if(m.error)window.__s7messages.push(m.error);});});await p.waitForFunction(()=>window.__s7?.state);
 const initial=await p.evaluate(()=>window.__s7);const restore=path.join(OUT,'development-before-'+Date.now()+'.decksynth');fs.writeFileSync(restore,JSON.stringify(initial.state));
 const fixture=path.join(OUT,'four-track-stress.decksynth');
 const send=(cmd,args)=>p.evaluate(([c,a])=>window.deckApi.send(c,a),[cmd,args]);let result={physical_acceptance:'pending',source:config.source_checkpoint,started:new Date().toISOString(),synthetic_midi_injection:true,real_sdl_driver:initial.audio,output_initial:initial.audio_output,midi_connected:initial.connected,audio_channels:initial.audio_channels,checks:[],status_samples:[]};
 try{
  assert.equal(initial.audio_channels,2);assert.notEqual(initial.audio,'dummy');assert.ok(initial.connected?.includes('/dev/snd/midi'));result.checks.push('Real stereo SDL and connected raw MIDI path');
  if(process.env.DECKSYNTH_S7_PHASE==='io'){
   const prior=JSON.parse(fs.readFileSync(path.join(OUT,'real-device-stress-results.json')));assert.equal(prior.source,config.source_checkpoint);result.status_samples=prior.status_samples;result.underruns_during_ten_second_four_track_run=prior.underruns_during_ten_second_four_track_run;result.checks.push(prior.checks[1]);result.stress_reused_from='real-device-stress-results.json';
  }else{
  await send('load',fixture);await p.waitForFunction(()=>window.__s7.state.bars===8&&window.__s7.state.tracks.every(t=>t.notes.length===4));
  // Existing sequencer plays sixteen total held voices for ten seconds, below the first loop wrap.
  await send('play');await p.waitForFunction(()=>window.__s7.voices>=16);const start=await p.evaluate(()=>window.__s7.underruns);
  for(let i=0;i<40;i++){await delay(250);const s=await p.evaluate(()=>({voices:window.__s7.voices,underruns:window.__s7.underruns,dsp_load:window.__s7.dsp_load,buffer_ms:window.__s7.buffer_ms,peak:window.__s7.meter.peak,channels:window.__s7.meter.channels.map(c=>({peak:c.peak,rms:c.rms}))}));result.status_samples.push(s);}
  const end=result.status_samples.at(-1);result.underruns_during_ten_second_four_track_run=end.underruns-start;assert.equal(result.underruns_during_ten_second_four_track_run,0);assert.ok(result.status_samples.every(s=>s.voices>=16));result.checks.push('10s real PipeWire speaker stream, four tracks/16totalvoices, no reported underrun increment');
  await p.getByRole('tab',{name:'Song',exact:true}).click();await p.screenshot({path:path.join(SCREENS,'real-four-track-1280x718.png')});
  try{execFileSync('spectacle',['-b','-n','-f','-o',path.join(SCREENS,'real-four-track-deck-1280x800.png')],{timeout:15000});}catch(e){result.screen_capture_error=String(e);}
  }
  if(process.env.DECKSYNTH_S7_PHASE!=='stress'){
  await send('stop');await send('load',path.join(OUT,'midi-probe.decksynth'));await send('select',0);await delay(300);
  // Brief injected velocity/pedal sequence through the production bridge, not physical keyboard evidence.
  await send('midi',[0x90,60,30]);await delay(180);const quiet=await p.evaluate(()=>window.__s7.meter.peak);await send('midi',[0x80,60,0]);await delay(300);await send('midi',[0x90,60,110]);await delay(180);const loud=await p.evaluate(()=>window.__s7.meter.peak);result.injected_velocity_peaks={quiet,loud};assert.ok(loud>quiet);
  await send('midi',[0xb0,64,127]);await send('midi',[0x80,60,0]);await delay(180);assert.ok(await p.evaluate(()=>window.__s7.voices>0));await send('midi',[0xe0,127,127]);await send('midi',[0xe0,0,64]);await send('midi',[0xb0,64,0]);await p.waitForFunction(()=>window.__s7.voices===0);result.checks.push('Injected velocity, sustain/release and pitch-bend commands traverse production bridge');
  const outputs=await p.evaluate(()=>window.__s7.audio_outputs);result.available_outputs=outputs;
  const headphones=outputs.find(x=>x.includes('Coprocessor Headphones'));
  if(headphones){await send('audio_device',headphones);await p.waitForFunction(x=>window.__s7.audio_output===x,headphones);await send('midi',[0x90,64,45]);await delay(250);assert.ok(await p.evaluate(()=>window.__s7.meter.peak>0));await send('midi',[0x80,64,0]);result.checks.push('SDL switched to available headphone endpoint and generated stereoPCM; listening pending');}
  await send('device','None');await p.waitForFunction(()=>window.__s7.connected===null);await send('device',initial.connected);await p.waitForFunction(x=>window.__s7.connected===x,initial.connected,{timeout:6000});result.checks.push('Software raw-MIDI close/reopen reconnects; physical USB unplug pending');
  }
  result.worker_errors=await p.evaluate(()=>window.__s7messages);assert.deepEqual(result.worker_errors,[]);result.result=process.env.DECKSYNTH_S7_PHASE==='stress'?'PASS stress confirmation':'PASS automated real-device checks';
 }catch(e){result.result='FAIL';result.error=e.stack||String(e);process.exitCode=1;}
 finally{
  await send('stop');await send('audio_device',initial.audio_output);await send('device',initial.connected||'Auto');await send('load',restore);await send('select',initial.selected);await delay(350);
  result.restored=await p.evaluate(()=>({audio_output:window.__s7.audio_output,selected:window.__s7.selected,playing:window.__s7.playing,automation_arm:window.__s7.automation_arm}));result.finished=new Date().toISOString();fs.writeFileSync(path.join(OUT,'real-device-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({result:result.result,error:result.error,checks:result.checks,underruns:result.underruns_during_ten_second_four_track_run,restored:result.restored},null,2));
 }
 // Do not browser.close(): it would close the persistent development app.
 process.exit(process.exitCode||0);
})().catch(e=>{console.error(e.stack||e);process.exit(1);});
