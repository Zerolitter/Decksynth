// Sampler expansion (15 Nov evening). Real worker, dummy audio.
// Stage 1: one Undo, the Sound header in one row, Automation as a slim strip that leaves the knobs free.
// Stage 2: the Freeze sheet in the top bar, on every page; a freeze holds the whole Song and the Loop.
'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.OUT||path.resolve(ROOT,'../artifacts/sampler-expansion');const H=Number(process.env.HEIGHT||718);
const DATA=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-smpx-'));
const STAGES=(process.env.STAGES||'1,2,3,4,5').split(',');
let app,page;
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 if(STAGES.some(s=>Number(s)>=5)){
  // A stand-in for the piano: 3 s of silence, then three notes, played as the 'Test input'.
  const rate=48000,n=rate*6,pcm=Buffer.alloc(n*2);
  for(let i=0;i<n;i++){const t=i/rate-3,k=Math.floor(t/.7),u=t-k*.7;const v=t>=0&&k<3&&u<.4?.5*Math.exp(-u*4)*Math.sin(2*Math.PI*[220,330,440][k]*u):0;pcm.writeInt16LE(Math.round(v*32767),i*2);}
  const head=Buffer.alloc(44);head.write('RIFF',0);head.writeUInt32LE(36+pcm.length,4);head.write('WAVE',8);head.write('fmt ',12);
  head.writeUInt32LE(16,16);head.writeUInt16LE(1,20);head.writeUInt16LE(1,22);head.writeUInt32LE(rate,24);head.writeUInt32LE(rate*2,28);head.writeUInt16LE(2,32);head.writeUInt16LE(16,34);
  head.write('data',36);head.writeUInt32LE(pcm.length,40);fs.writeFileSync(path.join(DATA,'piano notes.wav'),Buffer.concat([head,pcm]));
  process.env.DECKSYNTH_TEST_INPUT=path.join(DATA,'piano notes.wav');
 }
 app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:DATA,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 const p=page=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,h);},H);
 await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
 await p.evaluate(()=>{window.__msgs=[];window.deckApi.onMessage(m=>{if(m.state)window.__latest=m;if(m.message)window.__msgs.push(m.message);if(m.error)window.__msgs.push('ERROR '+m.error);});});
 await p.waitForFunction(()=>!!window.__latest);
 const latest=()=>p.evaluate(()=>window.__latest);
 const send=(c,a)=>p.evaluate(([c,a])=>window.deckApi.send(c,a),[c,a]);
 const inside=async(loc,what)=>{const b=await loc.boundingBox();assert.ok(b&&b.width>=44&&b.height>=44,what+' is 44 px: '+JSON.stringify(b));
  assert.ok(b.y+b.height<=H+1&&b.x+b.width<=1281,what+' inside the window: '+JSON.stringify(b));
  const hit=await loc.evaluate(e=>{const r=e.getBoundingClientRect();const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!t&&(e===t||e.contains(t))?'':(t?t.tagName+'.'+t.className+' '+(t.textContent||'').slice(0,40):'nothing');});
  assert.ok(!hit,what+' is not covered (under '+hit+')');};
 globalThis.T={p,send,latest,inside,H,OUT,DATA,assert,errors,app};

 if(STAGES.includes('1')){
  await p.getByRole('tab',{name:/^Sound$/}).click();
  assert.equal(await p.getByRole('button',{name:'Sound undo'}).count(),0,'only the top-bar Undo is left');
  await inside(p.getByRole('button',{name:'Undo',exact:true}),'Undo');
  // The track chips and the Sound tools share one row (no wrapped second row with gaps).
  const chips=await p.locator('.page-tracks').boundingBox(),tools=await p.locator('.page-tools').boundingBox();
  assert.ok(Math.abs((chips.y+chips.height/2)-(tools.y+tools.height/2))<6,'chips and tools in one row: '+JSON.stringify([chips,tools]));
  for(const name of ['Compare sound A','Edit automation','Browse presets','Save patch'])await inside(p.getByRole('button',{name}),name);
  // Automation: a strip over the window; the Tone knobs stay visible and free.
  await p.getByRole('button',{name:'Edit automation'}).click();
  const strip=p.getByRole('dialog',{name:'Parameter automation'});await strip.waitFor();
  const sb=await strip.boundingBox();assert.ok(sb.height<=240,'the strip is slim: '+sb.height);
  const tone=p.locator('[data-panel="sound-tone"]');
  if(await tone.count()){const k=tone.getByRole('slider',{name:'Brightness',exact:true});if(await k.count())await inside(k,'Brightness knob with the strip open');}
  for(const name of ['Done','Arm REC'])await inside(strip.getByRole('button',{name,exact:true}),name);
  await p.screenshot({path:path.join(OUT,'automation-strip-'+H+'.png')});
  await p.keyboard.press('Escape');await strip.waitFor({state:'detached'});
  await p.getByRole('button',{name:'Edit automation'}).click();await strip.waitFor();
  await p.getByRole('button',{name:'Edit automation'}).click();await strip.waitFor({state:'detached'});
  console.log('PASS stage 1 at '+H);
 }
 if(STAGES.includes('2')){
  await p.getByRole('tab',{name:/^FX$/}).click();
  // A song with a 4-bar timeline while Loop mode is on (1-bar loop): Freeze from the FX page holds both.
  await send('select',0);
  const s=(await latest()).state;const song=JSON.parse(JSON.stringify(s.song));song.on=false;song.length=4;
  song.lanes=[[{at:0,len:4,clip:s.clips.open[0],off:0}],[],[],[]];await send('song',song);
  await send('bars',1);
  const top=p.getByRole('button',{name:'Freeze tracks'});await inside(top,'Freeze button in the top bar');
  await top.click();const sheet=p.getByRole('dialog',{name:'Freeze tracks'});await sheet.waitFor();
  await p.keyboard.press('Escape');await sheet.waitFor({state:'detached'});
  await top.click();await sheet.waitFor();
  const row=sheet.locator('.fs-row').nth(0);await inside(row.getByRole('button',{name:/Freeze/}),'Freeze track 1');
  await row.getByRole('button',{name:/Freeze/}).click();
  await p.waitForFunction(()=>window.__latest.freeze?.[0]?.state==='frozen',null,{timeout:120000});
  const f=(await latest()).freeze[0];assert.deepEqual(f.holds.map(h=>[h.mode,h.bars]),[['song',4],['loop',1]]);
  await p.getByText('Frozen · Song 4 bars + Loop 1 bar').waitFor();
  assert.ok((await p.evaluate(()=>window.__msgs)).some(m=>m==='Track 1 frozen: Song 4 bars + Loop 1 bar'));
  await p.screenshot({path:path.join(OUT,'freeze-sheet-'+H+'.png')});
  await p.mouse.click(640,H-30);await sheet.waitFor({state:'detached'});
  assert.equal(await p.locator('.page-track-ice').count(),1,'the frozen track shows a snowflake on its chip');
  console.log('PASS stage 2 at '+H);
 }
 if(STAGES.includes('3')||STAGES.includes('4'))await require(path.join(__dirname,'sampler_expansion_stage3.cjs'))(globalThis.T);
 if(STAGES.includes('4'))await require(path.join(__dirname,'sampler_expansion_stage4.cjs'))(globalThis.T);
 if(STAGES.includes('5'))await require(path.join(__dirname,'sampler_expansion_stage5.cjs'))(globalThis.T);
 if(STAGES.includes('6'))await require(path.join(__dirname,'sampler_editing_stage6.cjs'))(globalThis.T);
 if(STAGES.includes('7'))await require(path.join(__dirname,'sampler_editing_stage7.cjs'))(globalThis.T);
 if(STAGES.includes('8'))await require(path.join(__dirname,'sampler_editing_stage8.cjs'))(globalThis.T);
 if(STAGES.includes('9'))await require(path.join(__dirname,'sampler_editing_stage9.cjs'))(globalThis.T);
 if(STAGES.includes('10'))await require(path.join(__dirname,'sampler_editing_stage10.cjs'))(globalThis.T);
 if(STAGES.includes('11'))await require(path.join(__dirname,'sampler_editing_stage11.cjs'))(globalThis.T);
 if(STAGES.includes('13'))await require(path.join(__dirname,'sampler_round2_a.cjs'))(globalThis.T);
 assert.deepEqual(errors,[]);
 await app.close();console.log('PASS sampler expansion at '+H);
})().catch(async e=>{console.error(e);try{await page?.screenshot({path:path.join(OUT,'failure-'+H+'.png')});}catch{}try{await app?.close();}catch{}process.exit(1);});
