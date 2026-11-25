// Real-worker restart check: generated WAVs/settings stay in a temporary directory.
'use strict';
require('./deck_guard.cjs');
const {_electron}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),OUT=path.resolve(ROOT,'../artifacts/recovery/drum-library');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-library-ui-')),data=path.join(tmp,'settings'),library=path.join(tmp,'AudioSamples'),folder=path.join(library,'Machines','Test Kit'),project=path.join(tmp,'project.decksynth');
const names=['Kick','Kick2','Snare','Clap','Rim','Perc','ClosedHat','OpenHat','Shaker','LowTom','MidTom','HiTom','Cowbell','Tambourine','Ride','Crash'],errors=[];
let app,p;
async function launch(){
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:data,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 p=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));
 await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 // The window maximizes once it is ready to show; size it after that, and check it took.
 for(let i=0;;i++){await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];if(w.isMaximized())w.unmaximize();w.setContentSize(1280,718);});await p.waitForTimeout(150);if(await p.evaluate(()=>innerWidth===1280&&innerHeight===718))break;if(i>30)throw Error('window did not take 1280x718');}
 await p.evaluate(()=>window.deckApi.onMessage(m=>{if(m.state)window.__libraryLatest=m;}));await p.waitForFunction(()=>!!window.__libraryLatest);
 assert.equal(await p.evaluate(()=>window.__libraryLatest.audio),'dummy');await p.getByRole('tab',{name:/^Sound$/i}).click();
}
async function send(cmd,args){await p.evaluate(([c,a])=>window.deckApi.send(c,a),[cmd,args]);}
async function close(){if(app){await app.close();app=null;}}
async function geometry(label){
 await p.locator('.drum-rack .drum-section-bar h2').first().click();await p.mouse.move(5,5);
 const dismiss=p.getByRole('button',{name:'Dismiss message',exact:true});if(await dismiss.count())await dismiss.click();await p.waitForTimeout(200);
 const rows=[];
 const pads=p.locator('.drum-pad');if(await pads.count()){const rects=await pads.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {y:Math.round(r.y),note:Number(n.dataset.note)};}));assert.equal(rects.length,16);assert.equal(new Set(rects.map(r=>r.y)).size,4,'4×4 pad layout');assert.equal(rects.filter(r=>r.y===rects[0].y).length,4);assert.deepEqual(rects.map(r=>r.note),Array.from({length:16},(_,i)=>36+i));}
 for(const n of await p.locator('.drum-rack button,.drum-rack select,.drum-rack input,.drum-rack [role="slider"]').all()){
  if(!await n.isVisible())continue;
  // A control scrolled out of its list is reached by scrolling (as in the touch test), not checked here.
  if(await n.evaluate(el=>{const r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
   for(let a=el.parentElement;a;a=a.parentElement){const s=getComputedStyle(a);if(/auto|scroll|hidden/.test(s.overflowY+s.overflowX)){const b=a.getBoundingClientRect();if(cy<b.top||cy>b.bottom||cx<b.left||cx>b.right)return true;}}return false;}))continue;
  const r=await n.boundingBox(),name=await n.getAttribute('aria-label')||await n.innerText();
  assert.ok(r&&r.width>=44&&r.height>=44,'44px control: '+name+' '+JSON.stringify(r));assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=1281&&r.y+r.height<=719,'viewport control: '+name+' '+JSON.stringify(r));rows.push({name,...r});
 }
 fs.writeFileSync(path.join(OUT,label+'-geometry.json'),JSON.stringify(rows,null,2));await p.screenshot({path:path.join(OUT,label+'-1280x718.png')});
}
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(folder,{recursive:true});fs.mkdirSync(data,{recursive:true});
 execFileSync('python3',['-c',`import wave,struct,math,sys,pathlib
for k,name in enumerate(sys.argv[2:]):
 with wave.open(str(pathlib.Path(sys.argv[1])/(name+'.wav')),'wb') as f:
  f.setparams((1,2,48000,0,'NONE','not compressed'))
  f.writeframes(b''.join(struct.pack('<h',int(16000*math.sin(i*2*math.pi*(75+k*10)/48000)*math.exp(-i/5000))) for i in range(12000)))`,folder,...names]);
 const broken=path.join(library,'Machines','Broken Kit');fs.mkdirSync(broken);fs.writeFileSync(path.join(broken,'Invalid.wav'),'not a WAV');
 const large=path.join(library,'Machines','Large Collection');fs.mkdirSync(large);for(let i=0;i<18;i++)fs.copyFileSync(path.join(folder,'Kick.wav'),path.join(large,'Sound '+i+'.wav'));
 await launch();await send('select',2);await p.waitForFunction(()=>window.__libraryLatest.selected===2);
 await p.getByRole('tab',{name:/^Sound$/i}).click();await p.getByRole('radiogroup',{name:'Track instrument'}).getByRole('radio',{name:'Drum Rack',exact:true}).click();await p.locator('.drum-rack').waitFor();
 assert.equal(await p.getByRole('button',{name:'Browse drum kits',exact:true}).count(),1,'Drum Rack exposes folder kit browser');assert.match(await p.locator('.drum-kits-wide').innerText(),/Choose a kit|Custom kit/);await p.getByRole('button',{name:'Browse drum kits',exact:true}).click();
 // Substitute only OS selection; scanning/decoding/audio/IPC are real.
 await app.evaluate(({dialog},directory)=>{dialog.showOpenDialog=async(_w,options)=>{if(!options.properties.includes('openDirectory'))throw Error('sample_folder must use openDirectory');return {canceled:false,filePaths:[directory]};};},library);
 await p.getByRole('button',{name:'Choose sample folder',exact:true}).click();await p.getByRole('button',{name:/Machines\/Test Kit.*16 WAV/i}).waitFor();await p.getByRole('button',{name:'Refresh',exact:true}).click();await p.getByRole('button',{name:/Machines\/Test Kit.*16 WAV/i}).waitFor({state:'visible'});await p.waitForFunction(()=>!window.__libraryLatest.drum_library.scanning);
 await p.getByRole('searchbox',{name:'Search kit folders'}).fill('large');await p.getByRole('button',{name:/Machines\/Large Collection.*18 WAV/i}).click();assert.match(await p.locator('.drum-kit-selection').innerText(),/16.*automatically/i);await geometry('library-browser');
 await p.getByRole('button',{name:'All kits',exact:true}).click();await p.getByRole('searchbox',{name:'Search kit folders'}).fill('test kit');await p.getByRole('button',{name:/Machines\/Test Kit.*16 WAV/i}).click();await p.getByRole('button',{name:'Load kit',exact:true}).click();
 await p.waitForFunction(()=>window.__libraryLatest.drum_racks?.[2]?.pads.every(x=>x.status==='READY'));await p.locator('.drum-kit-browser').waitFor({state:'detached'});
 const kit=await p.evaluate(()=>window.__libraryLatest.state.tracks[2].drum_rack);assert.equal(kit.name,'Machines/Test Kit');assert.deepEqual(kit.pads.map(x=>x.note),Array.from({length:16},(_,i)=>36+i));assert.deepEqual(kit.pads.map(x=>x.name),names,'filename roles map Kick before Kick2 and retain the sixteen pad order');assert.equal(kit.pads[6].choke,1);assert.equal(kit.pads[7].choke,1);assert.equal(new Set(kit.pads.map(x=>x.source.path)).size,16);
 await p.getByRole('slider',{name:'Tune',exact:true}).focus();await p.keyboard.press('ArrowUp');await p.waitForFunction(()=>window.__libraryLatest.state.tracks[2].drum_rack.pads[0].tune===1);
 await p.locator('.drum-pad').first().click();await p.locator('.drum-smp-wave canvas,.drum-smp-wave svg').first().waitFor();assert.equal(await p.locator('.drum-wave-empty').count(),0,'the loaded pad shows its waveform');await geometry('library-loaded');
 await p.getByRole('button',{name:'Browse drum kits',exact:true}).click();await p.getByRole('button',{name:/Machines\/Broken Kit.*1 WAV/i}).click();await p.getByRole('button',{name:'Load kit',exact:true}).click();await p.locator('.drum-library-error').waitFor();assert.equal(await p.locator('.drum-kit-browser').count(),1,'failed load keeps the browser open');assert.equal(await p.evaluate(()=>window.__libraryLatest.state.tracks[2].drum_rack.id),kit.id,'failed kit preserves current kit');await p.getByRole('button',{name:'Back to pads',exact:true}).click();
 const remembered=await p.evaluate(()=>window.__libraryLatest.state.tracks[2].drum_rack);await p.waitForTimeout(500);await close();await launch();await p.locator('.drum-rack').waitFor();await p.waitForFunction(()=>window.__libraryLatest.drum_racks?.[2]?.pads.every(x=>x.status==='READY'));
 assert.equal(await p.evaluate(()=>window.__libraryLatest.selected),2);assert.deepEqual(await p.evaluate(()=>window.__libraryLatest.state.tracks[2].drum_rack),remembered,'restart restores kit/sources/tune without imports');assert.match(await p.locator('.drum-kits-wide').innerText(),/Machines\/Test Kit/);
 console.log('PASS: folder chooser, nested search, 16 READY pads, real peaks/output, startup kit/tune/selected-track recall');
 await send('save',project);await p.waitForTimeout(300);const saved=JSON.parse(fs.readFileSync(project,'utf8'));saved.tracks[2].notes=[{start:0,duration:1,note:36,velocity:95}];saved.performance.seq.transpose=7;saved.tracks[2].device='synth';delete saved.tracks[2].drum_rack;fs.writeFileSync(project,JSON.stringify(saved));await send('load',project);await p.waitForFunction(()=>window.__libraryLatest.state.tracks[2].device==='synth');
 const loaded=await p.evaluate(()=>window.__libraryLatest.state);assert.deepEqual(loaded.tracks[2].notes,saved.tracks[2].notes);assert.deepEqual(loaded.performance,saved.performance);assert.deepEqual(loaded.song,saved.song);
 await p.getByRole('tab',{name:/^Sound$/i}).click();await p.getByRole('radiogroup',{name:'Track instrument'}).getByRole('radio',{name:'Drum Rack',exact:true}).click();await p.locator('.drum-rack').waitFor();await p.getByRole('button',{name:'Browse drum kits',exact:true}).click();await p.getByRole('button',{name:/Machines\/Test Kit.*16 WAV/i}).click();await p.getByRole('button',{name:'Load kit',exact:true}).click();await p.waitForFunction(()=>window.__libraryLatest.drum_racks?.[2]?.pads.every(x=>x.status==='READY'));
 const missingPath=await p.evaluate(()=>window.__libraryLatest.state.tracks[2].drum_rack.pads[0].source.path);await p.waitForTimeout(500);await close();fs.unlinkSync(missingPath);await launch();await p.waitForFunction(()=>window.__libraryLatest.drum_racks?.[2]?.pads[0]?.status==='MISSING');assert.match(await p.locator('.drum-pad-sound').innerText(),/missing/i);assert.equal(await p.locator('[data-testid="drum-waveform"]').count(),0);await geometry('library-missing');assert.deepEqual(errors,[]);
 console.log('PASS: missing asset on restart; project notes/SONG/performance override recall; 44px controls inside 1280×718; no renderer errors');
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;}).finally(async()=>{await close();fs.rmSync(tmp,{recursive:true,force:true});});
