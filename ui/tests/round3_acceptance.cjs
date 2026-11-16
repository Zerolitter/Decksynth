// 15 Nov round 3. Real worker, dummy audio: Song -> Pattern of an arp take on 8 bars, 32 bars and 256 steps,
// keys octave in Arp / Chord, count-in, FX Morph pad Hide, mod pad 16 bars and paged shapes.
'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.OUT||path.resolve(ROOT,'../artifacts/round3');const H=Number(process.env.HEIGHT||718);
let app;
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 const p=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,h);},H);
 await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 await p.evaluate(()=>{window.__msgs=[];window.deckApi.onMessage(m=>{if(m.state)window.__latest=m;if(m.message)window.__msgs.push(m.message);if(m.error)window.__msgs.push('ERROR '+m.error);});
  try{localStorage.removeItem('decksynth.fxFolded');localStorage.removeItem('decksynth.settings');}catch{}});
 await p.waitForFunction(()=>!!window.__latest);
 const latest=()=>p.evaluate(()=>window.__latest);
 const send=(c,a)=>p.evaluate(([c,a])=>window.deckApi.send(c,a),[c,a]);
 const inside=async(loc,what)=>{const b=await loc.boundingBox();assert.ok(b&&b.width>=44&&b.height>=44,what+' is 44 px: '+JSON.stringify(b));
  assert.ok(b.y+b.height<=H+1&&b.x+b.width<=1281,what+' inside the window');
  const hit=await loc.evaluate(e=>{const r=e.getBoundingClientRect();const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!t&&(e===t||e.contains(t));});
  assert.ok(hit,what+' is not covered');};

 // --- Loop bars: 16 and 32 ---
 await p.getByRole('button',{name:'Loop bars'}).click();
 await p.getByRole('option',{name:'32 bars'}).waitFor();
 const bars=await p.getByRole('listbox').getByRole('option').allTextContents();
 assert.deepEqual(bars,['1 bar','2 bars','4 bars','8 bars','16 bars','32 bars']);
 await p.getByRole('option',{name:'32 bars'}).click();
 await p.waitForFunction(()=>window.__latest.state.bars===32);
 await p.getByRole('button',{name:'Loop bars'}).click();await p.getByRole('option',{name:'8 bars'}).click();
 await p.waitForFunction(()=>window.__latest.state.bars===8);

 // --- Sir's case: arp take into an empty clip on 8 bars, then Song -> Pattern ---
 await p.getByRole('tab',{name:/^Perform$/i}).click();
 await p.getByRole('tab',{name:/^Arp/}).click();
 await p.getByRole('button',{name:'Turn arp on'}).click();
 await p.waitForFunction(()=>window.__latest.state.performance.arp.enabled);
 await p.getByRole('button',{name:'Record'}).click();
 await p.waitForFunction(()=>window.__latest.recording);
 for(const n of [60,64,67])await send('midi',[0x90,n,100]);
 await p.waitForTimeout(2200);
 for(const n of [60,64,67])await send('midi',[0x80,n,0]);
 await p.getByRole('button',{name:'Finish take'}).click();
 await p.waitForFunction(()=>!window.__latest.recording);
 const take=(await latest()).state.tracks[0].notes;
 assert.ok(take.length>=8,'arp notes recorded: '+take.length);
 await send('perform_set',['arp','enabled',false]);
 await p.getByRole('tab',{name:/^Seq/}).click();
 await p.getByRole('button',{name:'Song → Pattern'}).click();
 await p.waitForFunction(()=>window.__msgs.some(m=>m.startsWith('Song → Pattern')||m.startsWith('ERROR')));
 const msg=(await p.evaluate(()=>window.__msgs)).find(m=>m.startsWith('Song → Pattern')||m.startsWith('ERROR'));
 assert.ok(msg.startsWith('Song → Pattern'),msg);
 await p.waitForFunction(()=>{const f=window.__latest.state.performance;return f.patterns[f.seq.bank+':'+f.seq.slot]?.length===128;},null,{timeout:4000}).catch(()=>{});
 const perf=(await latest()).state.performance;console.log(msg,Object.keys(perf.patterns),perf.seq.bank,perf.seq.slot);const pat=perf.patterns[perf.seq.bank+':'+perf.seq.slot];
 assert.equal(pat.length,128,'8 bars at 1/16');
 assert.equal(pat.steps.flat().length,take.length,'every note in the pattern');
 await p.screenshot({path:path.join(OUT,'song-to-pattern-'+H+'.png')});

 // --- SEQ steps list ---
 const list=p.getByTestId('pf-steps-list');await inside(list,'steps list');
 await list.click();
 await p.getByRole('option',{name:'256'}).waitFor();
 const choices=await p.getByRole('listbox').getByRole('option').allTextContents();
 assert.deepEqual(choices.map(Number),[4,8,12,16,24,32,48,64,96,128,192,256]);
 await p.screenshot({path:path.join(OUT,'steps-list-'+H+'.png')});
 await p.getByRole('option',{name:'256'}).click();
 await p.waitForFunction(()=>window.__latest.state.performance.seq.length===256);
 const pages=await p.getByRole('group',{name:'Pattern page'}).getByRole('button').allTextContents();
 assert.deepEqual(pages,['1–64','65–128','129–192','193–256']);
 await list.click();await p.getByRole('option',{name:'128'}).click();
 await p.waitForFunction(()=>window.__latest.state.performance.seq.length===128);

 // --- Keys octave in Arp and Chord ---
 for(const tab of ['Arp','Chord']){
  await p.getByRole('tab',{name:new RegExp('^'+tab)}).click();
  const up=p.getByTestId('pf-transpose-oct').getByRole('spinbutton',{name:'Oct'});await inside(up,tab+' octave up');
 }
 const before=(await latest()).state.performance.scale.octave;
 {const oct=p.getByTestId('pf-transpose-oct').getByRole('spinbutton',{name:'Oct'});await oct.focus();await oct.press('ArrowUp');await oct.press('ArrowUp');}
 await p.waitForFunction(o=>window.__latest.state.performance.scale.octave===o+2,before);
 await p.screenshot({path:path.join(OUT,'chord-octave-'+H+'.png')});
 // A key now sounds two octaves up: hold C4 and read the held notes.
 await send('midi',[0x90,60,100]);await p.waitForFunction(()=>(window.__latest.held_notes??[]).length>0);
 assert.ok((await latest()).held_notes.includes(84),'C4 plays C6: '+(await latest()).held_notes);
 await send('midi',[0x80,60,0]);
 await p.getByRole('tab',{name:/^Arp/}).click();
 assert.equal(await p.getByTestId('pf-transpose-oct').locator('.vbox-value').textContent(),'+2');
 await p.screenshot({path:path.join(OUT,'arp-octave-'+H+'.png')});
 {const oct=p.getByTestId('pf-transpose-oct').getByRole('spinbutton',{name:'Oct'});await oct.focus();await oct.press('ArrowDown');await oct.press('ArrowDown');await p.waitForTimeout(450);}

 // --- Count-in from Settings ---
 await p.getByRole('button',{name:'Settings',exact:true}).click();
 await p.getByRole('group',{name:'Count-in'}).getByRole('button',{name:'4 beats'}).click();
 await p.screenshot({path:path.join(OUT,'settings-countin-'+H+'.png')});
 await inside(p.getByRole('button',{name:/CLOSE/}),'Settings close');
 for(const b of await p.getByRole('group',{name:'Start recording'}).getByRole('button').all())await inside(b,'start choice');
 for(const b of await p.getByRole('group',{name:'Count-in'}).getByRole('button').all())await inside(b,'count-in choice');
 await p.getByRole('button',{name:/CLOSE/}).click();
 await send('stop');await p.waitForFunction(()=>!window.__latest.playing);
 await p.getByRole('button',{name:'Record'}).click();
 await p.waitForFunction(()=>window.__latest.count_in?.state==='count');
 const rec=p.getByTestId('rec-button');
 await p.waitForFunction(()=>document.querySelector('[data-testid=rec-button]')?.dataset.count==='2');
 await p.screenshot({path:path.join(OUT,'rec-counting-'+H+'.png')});
 assert.equal(await rec.locator('span').textContent(),'2');
 assert.ok(await rec.locator('span').isVisible(),'the count shows on REC');
 await p.waitForFunction(()=>window.__latest.recording,null,{timeout:8000});
 assert.equal(await rec.locator('span').textContent(),'FINISH');
 await rec.click();await p.waitForFunction(()=>!window.__latest.recording);
 await send('stop');
 // Wait for the first note: armed until a key.
 await p.getByRole('button',{name:'Settings',exact:true}).click();
 await p.getByRole('group',{name:'Count-in'}).getByRole('button',{name:'Off'}).click();
 await p.getByRole('group',{name:'Start recording'}).getByRole('button',{name:'First note'}).click();
 await p.getByRole('button',{name:/CLOSE/}).click();
 await rec.click();await p.waitForFunction(()=>window.__latest.count_in?.state==='armed');
 assert.equal(await rec.locator('span').textContent(),'ARMED');
 await p.waitForTimeout(400);assert.equal((await latest()).playing,false,'waits');
 await send('midi',[0x90,62,100]);await p.waitForFunction(()=>window.__latest.recording);
 await send('midi',[0x80,62,0]);await rec.click();await p.waitForFunction(()=>!window.__latest.recording);
 assert.ok((await latest()).state.tracks[0].notes.some(n=>n.note===62&&n.start<.01),'first note recorded at the start');
 await p.getByRole('button',{name:'Settings',exact:true}).click();
 await p.getByRole('group',{name:'Start recording'}).getByRole('button',{name:'On REC'}).click();
 await p.getByRole('button',{name:/CLOSE/}).click();

 // The Morph pad Hide/Show on FX and the mod pad editor moved to the Link page (UI rules 54 and 58);
 // fx_mods_acceptance.cjs covers mod pad rates and shape pages there.

 assert.deepEqual(errors,[]);
 console.log('round3 acceptance OK at 1280x'+H);
 await app.close();
})().catch(async e=>{console.error(e);try{await app?.close();}catch{}process.exit(1);});
