'use strict';
// Clip editor extras (24 Nov): Export loop as WAV sheet + engine export, MIDI channel picker,
// double-tap a note in Select removes it, double-tap the ruler plays from that bar, clip names.
// Dummy audio driver; no live MIDI or audio.
const {_electron}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-clip-extras-'));

function smf(tracks,tpb=96){
  const vlq=n=>{const out=[n&127];n>>=7;while(n){out.unshift((n&127)|128);n>>=7;}return Buffer.from(out);};
  const parts=[Buffer.from('MThd'),Buffer.from([0,0,0,6,0,1,0,tracks.length,tpb>>8,tpb&255])];
  for(const events of tracks){let prev=0;const body=[];
    for(const [tick,status,a,b] of events.sort((x,y)=>x[0]-y[0])){body.push(vlq(tick-prev),Buffer.from([status,a,b]));prev=tick;}
    body.push(Buffer.from([0,0xff,0x2f,0]));const b=Buffer.concat(body),len=Buffer.alloc(4);len.writeUInt32BE(b.length);
    parts.push(Buffer.from('MTrk'),len,b);}
  return Buffer.concat(parts);
}

(async()=>{const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DATA_DIR:data,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 try{const p=await app.firstWindow();p.setDefaultTimeout(8000);await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
  await p.setViewportSize({width:1280,height:720});await p.waitForFunction(()=>innerWidth===1280&&innerHeight===720,null,{timeout:5000});
  await p.evaluate(()=>{window.__s={};window.__msgs=[];window.deckApi.onMessage(m=>{if(m.message||m.error)window.__msgs.push(m.message||m.error);else Object.assign(window.__s,m);});});

  // 1. Export loop as WAV: the sheet, then the engine export itself.
  await p.getByRole('button',{name:'Project files'}).click();
  await p.getByRole('menuitem',{name:'Export loop as WAV'}).click();
  const sheet=p.getByRole('dialog',{name:'Export loop as WAV'});await sheet.waitFor();
  for(const g of ['What','Length','Level']){const n=await sheet.getByRole('radiogroup',{name:g}).getByRole('radio').count();assert.ok(n>=2,g+' has choices');}
  for(const b of await sheet.getByRole('radio').all()){const r=await b.boundingBox();assert.ok(r.height>=44&&r.width>=44,'44 px choice');}
  assert.equal(await sheet.getByRole('radio',{name:'Seamless loop'}).getAttribute('aria-checked'),'true','seamless loop is the default');
  await p.screenshot({path:path.join(ROOT,'..','artifacts','export-loop-720.png')});
  await p.keyboard.press('Escape');await sheet.waitFor({state:'detached'});
  // 2. Double-tap a note in Select removes it (and doesn't draw a new one).
  await p.getByRole('tab',{name:'Perform',exact:true}).click();await p.locator('.compact-roll').waitFor();await p.waitForTimeout(300);
  await p.getByRole('button',{name:'Draw notes'}).click();await p.getByTestId('pf-cell-1-67').click();
  await p.waitForFunction(()=>document.querySelectorAll('.pf-note').length===1);
  await p.getByRole('button',{name:'Select notes'}).click();await p.waitForTimeout(80);
  await p.getByTestId('pf-cell-1-67').dblclick();
  await p.waitForFunction(()=>document.querySelectorAll('.pf-note').length===0,null,{timeout:4000});
  await p.waitForTimeout(400);assert.equal(await p.locator('.pf-note').count(),0,'no note drawn back');

  // 3. Double-tap the ruler: play from that bar.
  const tick=p.locator('.piano-ruler-tick[aria-label*="plays from bar 1"]').first();
  await tick.dblclick();
  await p.waitForFunction(()=>window.__s.playing===true,null,{timeout:4000});
  await p.evaluate(()=>window.deckApi.send('stop'));

  // 4. MIDI import: two channels plus drums ask which to take; drums start unticked on a synth track.
  const mid=path.join(data,'two.mid');
  fs.writeFileSync(mid,smf([[[0,0x90,60,100],[96,0x80,60,0],[0,0x91,48,90],[96,0x81,48,0]],[[0,0x99,36,120],[24,0x89,36,0]]]));
  await p.evaluate(f=>window.deckApi.send('midi_channels',f),mid);
  const pick=p.getByRole('dialog',{name:'Import MIDI to clip'});await pick.waitFor();
  assert.equal(await pick.getByRole('button',{name:/Channel \d/}).count(),3,'three channels listed');
  assert.equal(await pick.getByRole('button',{name:/Channel 10/}).getAttribute('aria-pressed'),'false','drums unticked');
  await pick.getByRole('button',{name:/Channel 2/}).click();
  await p.screenshot({path:path.join(ROOT,'..','artifacts','midi-pick-720.png')});
  await pick.getByRole('button',{name:/Replace the clip with 1 note/}).click();
  await p.waitForFunction(()=>window.__msgs.some(m=>/Imported 1 notes/.test(m)),null,{timeout:4000});

  // 4b. Export the clip just imported as a seamless loop with headroom: a 24-bit WAV.
  const wav=path.join(data,'loop.wav');
  await p.evaluate(f=>window.deckApi.send('export_loop',[f,0,'loop',true]),wav);
  await p.waitForFunction(()=>window.__msgs.some(m=>/Loop exported|failed/.test(m)),null,{timeout:60000});
  const msg=await p.evaluate(()=>window.__msgs.find(m=>/Loop exported|failed/.test(m)));
  assert.match(msg,/Loop exported/,msg);
  const head=fs.readFileSync(wav).subarray(0,44);assert.equal(head.toString('ascii',0,4),'RIFF');assert.equal(head.readUInt16LE(34),24,'24-bit');


  // 5. Clip names show on the Song page.
  await p.evaluate(()=>window.deckApi.send('clip',[0,'rename',0,'Verse']));
  await p.getByRole('tab',{name:'Song',exact:true}).click();
  await p.waitForFunction(()=>[...document.querySelectorAll('.lane-loop small')].some(e=>e.textContent==='Verse'),null,{timeout:4000});
  console.log('PASS clip extras: export sheet + seamless 24-bit export, double-tap removes, ruler plays from bar, MIDI channel picker, clip names');
 }finally{await app.close();fs.rmSync(data,{recursive:true,force:true});}
})().catch(error=>{console.error('FAIL',error.stack||error);process.exitCode=1;});
