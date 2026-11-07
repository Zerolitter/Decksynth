// Native visual evidence only: isolated settings, disabled hardware MIDI, dummy SDL audio.
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'../ui-next'),OUT=path.resolve(__dirname,'../artifacts/recovery/rack-direct/native-screen');
const {_electron}=require(path.join(ROOT,'node_modules/playwright')),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rack-screen-'));
let app,p;const errors=[];
async function send(c,a){await p.evaluate(([cmd,args])=>window.deckApi.send(cmd,args),[c,a]);}
async function open(id){const c=p.locator('[data-panel="'+id+'"]');if(await c.evaluate(n=>n.classList.contains('folded')))await c.getByRole('button',{name:/^Unfold /}).click();await c.locator('.ds-panel-body').waitFor();return c;}
async function fold(id){const c=p.locator('[data-panel="'+id+'"]');if(!await c.evaluate(n=>n.classList.contains('folded')))await c.locator('.ds-panel-title').press('Enter');}
async function capture(name){
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.show();w.focus();});
 const xid=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE(0));
 execFileSync('xdotool',['windowactivate','--sync',String(xid)],{timeout:5000});
 await p.mouse.move(2,2);await p.waitForTimeout(180);
 await p.screenshot({path:path.join(OUT,name+'-1280x718.png')});
 execFileSync('xdotool',['windowactivate','--sync',String(xid)],{timeout:5000});
 execFileSync('spectacle',['-b','-n','-f','-o',path.join(OUT,name+'-deck-1280x800.png')],{timeout:15000});
 if(Number(execFileSync('xdotool',['getactivewindow'],{encoding:'utf8'}).trim())!==xid)throw new Error('Capture focus changed: '+name);
}
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),args:['--ozone-platform=x11','electron/playwright-main.cjs'],cwd:ROOT,
  env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:tmp,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 p=await app.firstWindow();p.setDefaultTimeout(7000);p.on('pageerror',e=>errors.push(e.message));
 await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 await p.evaluate(()=>window.deckApi.onMessage(m=>{if(m.state)window.__capture=m;}));await p.waitForFunction(()=>window.__capture);
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.maximize();w.show();w.focus();});await p.waitForFunction(()=>innerWidth===1280&&innerHeight===718);
 const xid=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE(0));
 execFileSync('xdotool',['windowactivate','--sync',String(xid)],{timeout:5000});
 if(Number(execFileSync('xdotool',['getactivewindow'],{encoding:'utf8'}).trim())!==xid)throw new Error('Capture window is not active');
 await p.getByRole('tab',{name:'Sound',exact:true}).click();
 for(const [key,value] of [['attack',.18],['decay',.55],['sustain',.4],['release',.8]])await send('parameter',[key,null,value]);
 await p.waitForFunction(()=>window.__capture.state.tracks[0].instrument.release===.8);
 for(const id of ['motion-synth','rack-output','sound-filter','sound-unison','sound-character'])await fold(id);
 await open('sound-tone');await open('rack-envelope');await p.evaluate(()=>document.querySelector('.sound-cards').scrollLeft=0);
 await capture('sound-inline-envelope');
 await p.getByRole('tab',{name:'FX',exact:true}).click();
 for(const name of ['Filter','Resonator','Auto-wah','Overdrive']){
  const count=await p.evaluate(()=>window.__capture.state.tracks[0].fx?.modules.filter(m=>m.on).length||0);
  await p.getByRole('button',{name:'Add effect',exact:true}).click();await p.getByRole('dialog',{name:'Add effect'}).getByRole('button',{name:'Add '+name,exact:true}).click();
  await p.waitForFunction(n=>window.__capture.state.tracks[0].fx?.modules.filter(m=>m.on).length===n,count+1);
 }
 let chain=await p.evaluate(()=>window.__capture.state.tracks[0].fx);
 chain.mods[1].targets=[{module:'filter',param:'cutoff',depth:.4},{module:'autowah',param:'mix',depth:.3}];
 chain.mods[2].targets=[{module:'filter',param:'reso',depth:.25}];await send('fx',[0,chain]);await p.waitForFunction(()=>window.__capture.state.tracks[0].fx.mods[1].targets.length===2);
 await fold('fx-resonator');await fold('fx-overdrive');await open('fx-filter');await open('fx-autowah');
 await p.getByRole('button',{name:/^Mod pad 2 /}).click();await p.evaluate(()=>document.querySelector('.fx-cards').scrollLeft=0);
 await capture('fx-direct');
 await p.getByRole('button',{name:'Link Mod pad 2 to knobs'}).click();await capture('blue-source-linking');await p.locator('.pe-linking').getByRole('button',{name:'Done'}).click();
 await p.locator('.pad-editor').getByRole('button',{name:'Edit links'}).click();await capture('source-inspector');await p.keyboard.press('Escape');
 await p.getByRole('tab',{name:'Song',exact:true}).click();await p.locator('.audio-scope').waitFor();await capture('song-live-output-retained');
 const geometry=await p.evaluate(()=>({screen:{width:screen.width,height:screen.height},content:{width:innerWidth,height:innerHeight},audio:window.__capture.audio,devices:window.__capture.devices,errors:[]}));
 if(errors.length)throw new Error(errors.join('\n'));
 fs.writeFileSync(path.join(OUT,'capture.json'),JSON.stringify({...geometry,physical_input_exercised:false,source_files_copied:false},null,2)+'\n');
 console.log('Captured native screen/renderers:',JSON.stringify(geometry));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;}).finally(async()=>{if(app)await app.close();fs.rmSync(tmp,{recursive:true,force:true});});
