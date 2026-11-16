// Sir's round 4 (16 Nov): the Sampler without a header bar (tools in a rack above Amp, colour labels like the SEQ rail),
// Chop as a rack strip, Whole : Env as one swap box, filter curves with a power switch, toasts above the keys,
// green Play / orange Record with no logo, and the Drum Rack fades as drag points. Screenshots for review.
'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.OUT?path.resolve(ROOT,process.env.OUT):path.resolve(ROOT,'../artifacts/sampler-editing/r4');const H=Number(process.env.HEIGHT||718);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-r4-'));
const data=path.join(tmp,'data'),library=path.join(tmp,'library');
const tone=(file,freq,secs,decay,beats=0)=>execFileSync('python3',['-c',`import wave,struct,math,sys
f,s,d,b=float(sys.argv[2]),float(sys.argv[3]),float(sys.argv[4]),int(sys.argv[5])
def g(i):
 t=i/48000
 if b: t=t%(s/b)
 return math.exp(-t/d)
with wave.open(sys.argv[1],'wb') as w:
 w.setparams((1,2,48000,0,'NONE','not compressed'))
 w.writeframes(b''.join(struct.pack('<h',int(26000*math.sin(i*2*math.pi*f/48000)*g(i))) for i in range(int(48000*s))))`,file,String(freq),String(secs),String(decay),String(beats)]);
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(data,{recursive:true});
 const dir=path.join(library,'kits','Brush Light');fs.mkdirSync(dir,{recursive:true});
 ['Kick','Snare','Clap','Closed Hat','Open Hat','Low Tom','Mid Tom','High Tom','Rim','Shaker','Cowbell','Ride','Crash','Perc','Tambourine','FX Riser']
  .forEach((name,i)=>tone(path.join(dir,String(i+1).padStart(2,'0')+' '+name+'.wav'),80+i*40,.6,.12));
 const piano=path.join(tmp,'piano notes.wav');tone(piano,220,6,.25,8);
 const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DIAGNOSTIC:'1',DECKSYNTH_DATA_DIR:data,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 let p0;
 try{
  const p=await app.firstWindow({timeout:18000});p0=p;p.setDefaultTimeout(10000);
  const errors=[];p.on('pageerror',e=>{errors.push(e.message);console.error('pageerror',e.message);});
  await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1280,h);},H);
  await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
  await p.evaluate(()=>{window.deckApi.onMessage(m=>{if(m.state)window.__r4=m;});});
  await p.waitForFunction(()=>!!window.__r4);
  const small=async(scope)=>p.locator(scope+' button:visible').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return [e.getAttribute('aria-label')||e.textContent.trim(),Math.round(r.width),Math.round(r.height)];}).filter(([, w,h])=>w<44||h<44));
  const box=sel=>p.locator(sel).first().boundingBox();
  const shot=name=>p.screenshot({path:path.join(OUT,name+'-'+H+'.png')});
  const smp=()=>window.__r4.state.tracks[0].sampler;

  // --- top bar: no logo, green Play, orange Record ---
  assert.equal(await p.locator('.brand-glyph').count(),0,'no logo glyph');
  const [play,rec]=await p.evaluate(()=>['.transport-pad.play','.transport-pad.record'].map(s=>getComputedStyle(document.querySelector(s)).backgroundColor));
  const rgb=s=>s.match(/[\d.]+/g).map(Number).slice(-3);
  {const [r,g,b]=rgb(play);assert.ok(g>r&&g>b,'Play is green: '+play);}
  {const [r,g,b]=rgb(rec);assert.ok(r>g&&g>b,'Record is orange: '+rec);}

  // --- Sampler with a sound ---
  await p.getByRole('tab',{name:/^Sound$/i}).click();
  const instrument=name=>p.getByRole('radiogroup',{name:'Track instrument'}).getByRole('radio',{name,exact:true}).click();
  await instrument('Sampler');
  await p.locator('.smp-empty-zone').waitFor();
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},piano);
  await p.locator('.smp-empty-card',{hasText:'Load a WAV'}).click();
  await p.waitForFunction(()=>document.querySelector('.sampler-page .smp-rack .drum-status')?.textContent==='READY');
  assert.equal(await p.locator('.sampler-page .drum-device-bar').count(),0,'no header bar');
  assert.equal(await p.locator('.sampler-page .smp-name').count(),0,'no sample name on the page');
  const rack=p.getByRole('toolbar',{name:'Sampler tools'});
  for(const n of ['Trim','Chop','Envelope','Filter','Library','Record','Load WAV','Clear sample'])
   assert.ok(await rack.getByRole(/^(Trim|Chop|Envelope|Filter)$/.test(n)?'radio':'button',{name:n,exact:true}).isVisible(),n+' in the rack');
  const labels=await rack.locator('.smp-tool').evaluateAll(els=>els.map(e=>[e.querySelector('svg')&&getComputedStyle(e.querySelector('svg')).color,e.querySelector('span')?.textContent]));
  assert.ok(labels.every(([c,t])=>c&&t),'each tool has a coloured icon and a label');
  assert.ok(new Set(labels.map(([c])=>c)).size>=7,'tools have their own colours');
  assert.deepEqual(await small('.sampler-page .smp-rack'),[],'44 px (rack)');
  // Amp sits under the rack and ends with the cards
  const [side,cards,amp,toolsBox]=[await box('.smp-side'),await box('.smp-deck>.smp-cards'),await box('.smp-amp-card'),await box('.smp-tools')];
  assert.ok(Math.abs(side.y+side.height-(cards.y+cards.height))<=2,'side ends with the cards');
  assert.ok(amp.y>toolsBox.y+toolsBox.height,'Amp is below the rack');
  const knobsGap=await p.evaluate(()=>{const c=document.querySelector('.smp-amp-card').getBoundingClientRect(),k=document.querySelector('.smp-amp-knobs').getBoundingClientRect();return c.bottom-k.bottom;});
  assert.ok(knobsGap<40,'no empty block under the Amp knobs: '+knobsGap);
  const wave=await box('.smp-window');
  await shot('sampler-trim');

  // Chop: a rack strip, Pads in the tool rack
  await rack.getByRole('radio',{name:'Chop',exact:true}).click();
  await p.getByRole('toolbar',{name:'Chop'}).waitFor();
  await p.getByRole('radiogroup',{name:'Find slices by'}).getByRole('radio',{name:'Regions'}).click();
  await p.waitForFunction(()=>(window.__r4.state.tracks[0].sampler.slices??[]).length>=8);
  await p.locator('.smp-wave-shell').click({position:{x:180,y:60}});
  await p.waitForFunction(()=>/· \d+:/.test(document.querySelector('.smp-chop-info')?.textContent||''));
  assert.ok(await rack.getByRole('button',{name:'To pads'}).isVisible(),'Pads in the rack');
  assert.equal(await p.getByRole('toolbar',{name:'Chop'}).locator('.smp-chop-info').count(),0,'info left the strip');
  assert.deepEqual(await small('.sampler-page .smp-chop'),[],'44 px (chop)');
  const strip=await box('.smp-chop'),deckCards=await box('.smp-deck>.smp-cards');
  assert.ok(strip.x+strip.width<=deckCards.x+deckCards.width+1,'strip stays over the cards');
  const chopWave=await box('.smp-window');
  assert.ok(chopWave.height>=wave.height-60,'waveform keeps its room in Chop');
  await shot('sampler-chop');

  // Envelope: Whole : Env swap in the rack
  await rack.getByRole('radio',{name:'Envelope',exact:true}).click();
  const swap=rack.locator('.smp-scale-swap');
  await swap.waitFor();
  assert.equal(await p.getByRole('radiogroup',{name:'Time scale'}).count(),0,'old pair is gone');
  assert.match(await swap.textContent(),/^Whole:Env/);
  await shot('sampler-envelope');
  await swap.click();
  assert.match(await swap.textContent(),/^Env:Whole/);
  await shot('sampler-envelope-zoom');

  // a message: at the bottom, just above the keys
  await p.evaluate(()=>{const s=document.querySelector('.decksynth-shell');const d=document.createElement('div');d.className='toast';d.id='r4-toast';d.setAttribute('role','status');
   d.innerHTML='Found the pitch of 8 of 8 slices<button aria-label="Dismiss message">✕</button>';s.appendChild(d);});
  await p.waitForTimeout(400);
  const toast=await box('#r4-toast'),keys=await box('.smp-keys');
  assert.ok(toast.y+toast.height<=keys.y+1&&keys.y-(toast.y+toast.height)<30,'toast sits just above the keys: '+JSON.stringify([toast,keys.y]));
  await shot('sampler-toast');
  await p.evaluate(()=>document.getElementById('r4-toast')?.remove());

  // Filter: curve icons and a power switch
  await rack.getByRole('radio',{name:'Filter',exact:true}).click();
  const fpower=p.getByRole('switch',{name:'Filter on'});
  assert.equal(await fpower.getAttribute('aria-checked'),'false','filter starts off');
  assert.equal(await p.locator('.smp-filter-shapes svg.smp-filter-icon').count(),3,'three curve icons');
  await fpower.click();
  await p.waitForFunction(()=>window.__r4.state.tracks[0].sampler.filter==='lp');
  await p.getByRole('radio',{name:'High-pass',exact:true}).click();
  await p.waitForFunction(()=>window.__r4.state.tracks[0].sampler.filter==='hp');
  await fpower.click();
  await p.waitForFunction(()=>window.__r4.state.tracks[0].sampler.filter==='off');
  assert.equal(await p.getByRole('radio',{name:'High-pass',exact:true}).getAttribute('aria-checked'),'true','off keeps the shape');
  await fpower.click();
  await p.waitForFunction(()=>window.__r4.state.tracks[0].sampler.filter==='hp');
  assert.deepEqual(await small('.sampler-page .smp-cards'),[],'44 px (cards)');
  await shot('sampler-filter');

  // --- Drum Rack: fades on the envelope ---
  await instrument('Drum Rack');
  await p.locator('.drum-rack .drum-pads').waitFor();
  await app.evaluate(({dialog},directory)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]});},library);
  await p.getByRole('button',{name:'Browse drum kits'}).click();
  await p.getByRole('button',{name:'Choose sample folder',exact:true}).click();
  await p.getByRole('button',{name:/kits\/Brush Light.*16 WAV/i}).click();
  await p.getByRole('button',{name:/^Load kit/}).click();
  await p.waitForFunction(()=>window.__r4.state.tracks[0].drum_rack?.pads[0]?.source);
  await p.getByRole('button',{name:'Back to pads'}).click().catch(()=>{});
  await p.getByRole('button',{name:'Edit the envelope on the waveform'}).click();
  const fin=p.locator('[data-handle="fade_in"]'),fout=p.locator('[data-handle="fade_out"]');
  await fin.waitFor();await fout.waitFor();
  const graph=await box('.drag-envelope .drag-box');
  const drag=async(h,dx)=>{const b=await h.boundingBox();const x=b.x+b.width/2,y=b.y+b.height/2;await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+dx/2,y,{steps:4});await p.mouse.move(x+dx,y,{steps:4});await p.mouse.up();};
  await drag(fin,graph.width*.08);
  await p.waitForFunction(()=>(window.__r4.state.tracks[0].drum_rack.pads[0].shape?.fade_in??0)>0);
  await drag(fout,-graph.width*.12);
  await p.waitForFunction(()=>(window.__r4.state.tracks[0].drum_rack.pads[0].shape?.fade_out??0)>0);
  assert.equal(await p.locator('.drag-envelope .fade-line').count(),2,'both fades drawn');
  await shot('drum-fades');
  assert.deepEqual(errors,[]);
  console.log('PASS quality r4 at 1280×'+H);
 }catch(e){console.error('FAIL',e);process.exitCode=1;await p0?.screenshot({path:path.join(OUT,'fail-'+H+'.png')}).catch(()=>{});}finally{await app.close();}
})();
