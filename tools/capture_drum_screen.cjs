// Isolated native diagnostic window. Never opens hardware MIDI or saves music.
'use strict';
const path=require('node:path');
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'../ui-next');
const {_electron}=require(path.join(ROOT,'node_modules/playwright'));
const OUT=path.resolve(__dirname,'../artifacts/recovery/drum-rack-m1');
const samples=process.argv[2];
if(!samples)throw new Error('Usage: node tools/capture_drum_screen.cjs USER_SAMPLE_DIRECTORY');
let app;
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),args:['--ozone-platform=x11','electron/playwright-main.cjs'],cwd:ROOT,
  env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 const page=await app.firstWindow();
 await page.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 await page.evaluate(()=>window.deckApi.onMessage(m=>{if(m.state)window.__captureState=m;}));
 await page.waitForFunction(()=>window.__captureState?.state);
 const send=(c,a)=>page.evaluate(([cmd,args])=>window.deckApi.send(cmd,args),[c,a]);
 await send('select',3);await send('set_device',[3,'drum_rack']);
 await page.waitForFunction(()=>window.__captureState.state.tracks[3].drum_rack);
 const kit=await page.evaluate(()=>window.__captureState.state.tracks[3].drum_rack.id);
 for(const [pad,file] of [[0,'Kick Berlin 512.wav'],[6,'Hi-Hat Berlin 512 Closed.wav'],[7,'Hi-Hat Berlin 512 Open.wav']]){
  const source=path.join(samples,'Berlin 512',file);if(!fs.existsSync(source))throw new Error('Missing private user sample: '+source);
  await send('drum_import',[3,kit,pad,source,null]);
 }
 await page.waitForFunction(()=>[0,6,7].every(i=>window.__captureState.drum_racks[3].pads[i].status==='READY'));
 await page.getByRole('tab',{name:'Sound',exact:true}).click();
 await page.locator('.drum-rack').waitFor();
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.maximize();w.show();w.focus();});
 await page.bringToFront();await page.waitForTimeout(400);
 const xid=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE(0));
 execFileSync('xdotool',['windowactivate','--sync',String(xid)],{timeout:5000});
 const active=execFileSync('xdotool',['getactivewindow'],{encoding:'utf8'}).trim();
 if(Number(active)!==xid)throw new Error('Diagnostic window did not become active');
 await page.locator('.drum-pad').nth(7).click();await page.waitForTimeout(180);
 const geometry=await page.evaluate(()=>({screen:{width:screen.width,height:screen.height},content:{width:innerWidth,height:innerHeight},
  controls:[...document.querySelectorAll('.drum-rack button,.drum-rack select,.drum-rack [role=slider]')].map(n=>({name:n.getAttribute('aria-label')||n.textContent,bounds:n.getBoundingClientRect().toJSON()}))}));
 if(geometry.content.width!==1280||geometry.content.height!==718)throw new Error('Unexpected native content geometry: '+JSON.stringify(geometry.content));
 await page.screenshot({path:path.join(OUT,'drum-rack-final-renderer-1280x718.png')});
 execFileSync('spectacle',['-b','-n','-f','-o',path.join(OUT,'drum-rack-deck-screen-1280x800.png')],{timeout:15000});
 const state=await page.evaluate(()=>window.__captureState);
 fs.writeFileSync(path.join(OUT,'drum-rack-physical-screen.json'),JSON.stringify({geometry,audio:state.audio,devices:state.devices,connected:state.connected,
  selected:state.selected,voices:state.voices,underruns:state.underruns,physical_input_exercised:false,source_files_copied:false},null,2));
 console.log('Captured actual Deck screen and native renderer:',JSON.stringify({screen:geometry.screen,content:geometry.content,audio:state.audio,devices:state.devices}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{if(app)await app.close();});
