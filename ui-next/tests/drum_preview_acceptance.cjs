'use strict';
/** Native Drum Kit: folder -> listen -> swap -> pads; failed kit stays open.
 * All audio and sample data are generated inside a temporary diagnostic sandbox.
 */
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const OUT=path.resolve(ROOT,'../artifacts/recovery/drum-preview-01');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-preview-ui-'));
const data=path.join(tmp,'settings'),library=path.join(tmp,'AudioSamples');
const soundDir=path.join(library,'Test set'),broken=path.join(library,'Broken Kit');
const pageErrors=[];
let app,p;
async function send(cmd,args){await p.evaluate(([c,a])=>window.deckApi.send(c,a),[cmd,args]);}
async function run(){
 fs.mkdirSync(data,{recursive:true});fs.mkdirSync(soundDir,{recursive:true});fs.mkdirSync(broken,{recursive:true});fs.mkdirSync(OUT,{recursive:true});
 execFileSync('python3',['-c',`import sys,wave,math,struct,pathlib
out=pathlib.Path(sys.argv[1])
for name,freq in [('Kick',90),('Snare',195),('ClosedHat',900),('OpenHat',1320)]:
 with wave.open(str(out/(name+'.wav')),'wb') as w:
  w.setparams((1,2,48000,0,'NONE','PCM'))
  w.writeframes(b''.join(struct.pack('<h',int(10000*math.sin(2*math.pi*freq*i/48000)*math.exp(-i/16000))) for i in range(48000)))`,soundDir]);
 fs.writeFileSync(path.join(broken,'Invalid.wav'),'not PCM');
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',
  DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:data,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 p=await app.firstWindow({timeout:18000});p.setDefaultTimeout(12000);
 p.on('pageerror',error=>pageErrors.push(error.message));
 await app.evaluate(({BrowserWindow})=>{let w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,718);});
 await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'),null,{timeout:15000});
 await p.evaluate(()=>window.deckApi.onMessage(m=>{if(m.state)window.__previewLatest=m;}));
 await p.waitForFunction(()=>!!window.__previewLatest?.state);
 await p.getByRole('tab',{name:/^Sound$/i}).click();
 await send('set_device',[0,'drum_rack']);
 await p.locator('.drum-rack').waitFor();
 const firstId=await p.evaluate(()=>window.__previewLatest.state.tracks[0].drum_rack.id);
 const browse=p.getByRole('button',{name:'Browse drum kits',exact:true});
 await browse.click();
 assert.equal(await p.locator('.drum-kit-browser').count(),1);
 await send('drum_library_root',library);
 await p.getByRole('button',{name:/Test set.*4 WAV/i}).waitFor();
 await p.getByRole('button',{name:/Test set.*4 WAV/i}).click();
 await p.getByRole('button',{name:'Listen to Snare'}).waitFor();
 await p.screenshot({path:path.join(OUT,'browse-sounds-1280x718.png')});
 const selected=await p.evaluate(()=>window.__previewLatest.state.tracks[0].drum_rack);
 assert.equal(selected.id,firstId);
 assert.equal(selected.pads[0].source,null);
 await p.getByRole('button',{name:'Listen to Snare'}).click();
 await p.waitForFunction(()=>window.__previewLatest?.drum_library?.preview?.folder==='Test set' && window.__previewLatest?.drum_library?.preview?.index===3,{},{timeout:10000});
 // Note: indexed order is alphabetic: ClosedHat, Kick, OpenHat, Snare.
 assert.equal(await p.evaluate(()=>window.__previewLatest.state.tracks[0].drum_rack.pads[0].source),null,
  'Audition must not mutate the current pad');
 await p.getByRole('button',{name:'Replace pad 1 with Snare'}).click();
 await p.waitForFunction(()=>window.__previewLatest?.state.tracks[0].drum_rack.pads[0].name==='Snare',null,{timeout:15000});
 await p.locator('.drum-kit-browser').waitFor({state:'detached'});
 assert.equal(await p.locator('.drum-pad').count(),16,'After one-padded swap, return to full pad overview');
 const swapped=await p.evaluate(()=>window.__previewLatest.state.tracks[0].drum_rack);
 assert.equal(swapped.id,firstId,'One pad swap cannot reload the whole kit');
 assert.ok(swapped.pads[0].source.path.endsWith('Snare.wav'));
 await browse.click();
 await p.getByRole('button',{name:/Test set.*4 WAV/i}).click();
 await p.getByRole('button',{name:'Load kit',exact:true}).click();
 await p.waitForFunction(()=>window.__previewLatest?.state.tracks[0]?.drum_rack?.id!==undefined &&
     window.__previewLatest.state.tracks[0].drum_rack.id!==window.__oldKit,
   null,{timeout:15000}).catch(()=>{});
 // Wait for a genuine kit identity change, not just a loading state.
 await p.waitForFunction(id=>window.__previewLatest.state.tracks[0].drum_rack.id!==id,firstId,{timeout:15000});
 await p.locator('.drum-kit-browser').waitFor({state:'detached',timeout:15000});
 assert.equal(await p.locator('.drum-pad').count(),16,'Full kit load returns to pad overview');
 await p.screenshot({path:path.join(OUT,'pads-loaded-1280x718.png')});
 const complete=await p.evaluate(()=>window.__previewLatest.state.tracks[0].drum_rack);
 assert.equal(complete.name,'Test set');
 assert.equal(complete.pads.filter(x=>x.source!==null).length,4);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,800));
 await p.screenshot({path:path.join(OUT,'pads-loaded-1280x800.png')});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,718));
 await browse.click();
 await p.getByRole('button',{name:/Broken Kit.*1 WAV/i}).click();
 await p.getByRole('button',{name:'Load kit',exact:true}).click();
 await p.locator('.drum-library-error').waitFor({timeout:15000});
 assert.equal(await p.locator('.drum-kit-browser').count(),1,'Failed kit load must keep browser open');
 assert.equal(await p.evaluate(()=>window.__previewLatest.state.tracks[0].drum_rack.id),complete.id,'Failed kit must not replace existing');
 assert.deepEqual(pageErrors,[],'No renderer errors');
 console.log('PASS: native audition non-mutating; successful swap returns to pad overview; full kit load returns; failed load stays open; screenshots at 1280×718/800');
}
run().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;}).finally(async()=>{try{if(app)await app.close();}finally{fs.rmSync(tmp,{recursive:true,force:true});}});
