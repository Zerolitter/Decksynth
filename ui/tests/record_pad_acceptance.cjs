// Record the piano into a Drum Rack pad (16 Nov): an empty pad's drop zone has Record, the Record sheet opens for
// that pad, a take with the test input lands on the pad, and a filled pad offers "Record into pad" in the radial menu.
// HEIGHT=718|800 sets the window; OUT=<dir> keeps screenshots.
'use strict';
require('./deck_guard.cjs');
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const H=Number(process.env.HEIGHT||718),OUT=process.env.OUT?path.resolve(process.env.OUT):null;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-recpad-'));
const data=path.join(tmp,'data'),piano=path.join(tmp,'piano notes.wav');
(async()=>{
 fs.mkdirSync(data,{recursive:true});if(OUT)fs.mkdirSync(OUT,{recursive:true});
 execFileSync('python3',['-c',`import wave,struct,math,sys
with wave.open(sys.argv[1],'wb') as w:
 w.setparams((1,2,48000,0,'NONE','not compressed'))
 w.writeframes(b''.join(struct.pack('<h',int(26000*math.sin(i*2*math.pi*220/48000)*math.exp(-i/43000))) for i in range(48000*3)))`,piano]);
 const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:data,DECKSYNTH_TEST_INPUT:piano,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 try{
  const p=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'),null,{timeout:20000});
  for(let i=0;;i++){await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];if(w.isMaximized())w.unmaximize();w.setContentSize(1280,h);},H);
   await p.waitForTimeout(150);if(await p.evaluate(h=>innerHeight===h,H))break;if(i>30)throw Error('window did not size');}
  await p.evaluate(()=>{window.deckApi.onMessage(m=>{if(m.state)window.__rp=m;});});
  await p.waitForFunction(()=>!!window.__rp);
  const shot=name=>OUT?p.screenshot({path:path.join(OUT,name+'-'+H+'.png')}):null;
  await p.getByRole('tab',{name:/^Sound$/i}).click();
  await p.getByRole('radiogroup',{name:'Track instrument'}).getByRole('radio',{name:'Drum Rack',exact:true}).click();
  await p.locator('.drum-rack .drum-pad').first().waitFor();
  const tr=await p.evaluate(()=>window.__rp.selected??0);
  // Pick an empty pad: its drop zone offers Record next to Choose a WAV and Browse sounds.
  const empty=await p.evaluate(t=>window.__rp.state.tracks[t].drum_rack.pads.findIndex(x=>!x.source),tr);
  assert.ok(empty>=0,'there is an empty pad');
  await p.locator('.drum-pad[data-pad="'+empty+'"]').click();
  const rec=p.locator('.drum-wave-empty').getByRole('button',{name:'Record',exact:true});
  assert.ok(await rec.isVisible(),'an empty pad shows Record');
  await shot('empty-pad');
  await rec.click();
  const sheet=p.getByRole('dialog',{name:'Record into the pad'});
  await sheet.waitFor();
  assert.match(await sheet.locator('h2').innerText(),new RegExp('Pad '+(empty+1)));
  await sheet.getByRole('radio',{name:/Test input/}).click();
  await p.waitForFunction(()=>window.__rp.sampler_record?.input==='Test input');
  const box=await sheet.boundingBox();
  assert.ok(box.y>=0&&box.y+box.height<=H+1,'the sheet fits the window: '+JSON.stringify(box));
  await shot('record-sheet');
  await sheet.getByRole('button',{name:'Record now',exact:true}).click();
  await p.waitForFunction(p=>window.__rp.sampler_record?.state==='recording'&&window.__rp.sampler_record?.pad===p,empty);
  await p.waitForFunction(()=>window.__rp.sampler_record.seconds>.8);
  await shot('recording');
  await sheet.getByRole('button',{name:'Stop and keep'}).click();
  await p.waitForFunction(([t,i])=>!!window.__rp.state.tracks[t].drum_rack.pads[i].source,[tr,empty],{timeout:15000});
  const name=await p.evaluate(([t,i])=>window.__rp.state.tracks[t].drum_rack.pads[i].name,[tr,empty]);
  assert.match(name,/^Recording/,'the pad takes the take\'s name');
  await sheet.getByRole('button',{name:'Done'}).click();
  await sheet.waitFor({state:'detached'});
  await p.waitForFunction(i=>document.querySelector('.drum-pad[data-pad="'+i+'"]')?.dataset.status==='READY',empty);
  await shot('pad-filled');
  // A filled pad: Record over sits in the radial menu, not on screen, so it can't be pressed by accident.
  assert.equal(await p.locator('.drum-wave-empty').count(),0,'the waveform replaced the drop zone');
  await p.locator('.drum-pad[data-pad="'+empty+'"]').click({button:'right'});
  const menu=p.getByRole('menu',{name:/commands$/});await menu.waitFor();
  await menu.getByRole('menuitem',{name:'Pad sound',exact:true}).hover();
  await menu.getByRole('menuitem',{name:'Record into pad',exact:true}).dispatchEvent('click');
  await sheet.waitFor();
  await p.keyboard.press('Escape');
  await sheet.waitFor({state:'detached'});

  // Batch 2 (16 Nov): crop to Start-End, save the kit to the library, clear a pad.
  const kitId=await p.evaluate(t=>window.__rp.state.tracks[t].drum_rack.id,tr);
  const padState=()=>p.evaluate(([t,i])=>window.__rp.state.tracks[t].drum_rack.pads[i],[tr,empty]);
  const full=(await padState()).source.frames;
  assert.equal(await p.getByRole('button',{name:'Crop to Start–End'}).count(),0,'no Crop while the whole sample plays');
  await p.evaluate(([t,k,i])=>window.deckApi.send('drum_edit',[t,k,i,'shape',{start:.5,end:1}]),[tr,kitId,empty]);
  const crop=p.getByRole('button',{name:'Crop to Start–End'});await crop.waitFor();
  const cb=await crop.boundingBox();assert.ok(cb.height>=44,'Crop is 44 px');
  await shot('crop-button');
  await crop.click();
  await p.waitForFunction(([t,i,n])=>window.__rp.state.tracks[t].drum_rack.pads[i].source.frames<n*.6,[tr,empty,full],{timeout:15000});
  assert.equal((await padState()).shape.start,0,'Start back at the edge after the crop');
  const lib=path.join(tmp,'library');fs.mkdirSync(lib);
  await p.evaluate(dir=>window.deckApi.send('drum_library_root',dir),lib);
  await p.waitForFunction(()=>!!window.__rp.drum_library?.root&&!window.__rp.drum_library.scanning);
  const save=p.getByRole('button',{name:'Save this kit to the library'});
  assert.ok((await save.boundingBox()).height>=44,'Save kit is 44 px');
  await save.click();
  for(let i=0;i<100&&!(fs.existsSync(path.join(lib,'My kits'))&&fs.readdirSync(path.join(lib,'My kits')).some(d=>fs.existsSync(path.join(lib,'My kits',d,'decksynth-kit.json'))));i++)await p.waitForTimeout(100);
  const saved=fs.readdirSync(path.join(lib,'My kits'));
  assert.equal(saved.length,1,'one kit folder');
  await p.waitForFunction(()=>window.__rp.drum_library.folders.some(f=>f.id.startsWith('My kits/')),null,{timeout:10000});
  await shot('kit-saved');
  await p.getByRole('button',{name:'Clear this pad'}).click();
  await p.waitForFunction(([t,i])=>!window.__rp.state.tracks[t].drum_rack.pads[i].source,[tr,empty]);
  assert.ok(await p.locator('.drum-wave-empty').isVisible(),'the cleared pad shows its drop zone again');
  // Settings has the window controls now that there is no title bar.
  await p.getByRole('button',{name:'Settings'}).click();
  const win=p.getByRole('navigation',{name:'Settings sections'});await win.waitFor();
  for(const n of ['Full screen','Minimise','Quit'])assert.ok((await win.getByRole('button',{name:n}).boundingBox()).height>=44,n);
  await shot('settings-window');
  await p.keyboard.press('Escape');
  assert.deepEqual(errors,[],'no renderer errors');
  console.log('record_pad_acceptance: ok at 1280x'+H);
 }finally{await app.close();fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exit(1);});
