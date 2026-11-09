'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {_electron}=require('playwright');
const dist=process.env.DECKSYNTH_CANDIDATE_DIST;
assert.ok(dist,'Set DECKSYNTH_CANDIDATE_DIST to the exact isolated candidate dist');
const output=path.resolve(process.env.DECKSYNTH_EVIDENCE||'../artifacts/recovery/song-regression-2026-11-09');
fs.mkdirSync(output,{recursive:true});
const shots=path.resolve(process.env.DECKSYNTH_SHOTS||'../decksynth/screens/song-regression-2026-11-09');
fs.mkdirSync(shots,{recursive:true});
const snapshot=JSON.parse(fs.readFileSync(path.resolve('src/preview-state.json')));
snapshot.preview=false;snapshot.playing=false;snapshot.recording=false;snapshot.song_beat=47.95;snapshot.beat=15.95;
snapshot.state.bars=4;
snapshot.state.tracks.forEach(t=>t.notes=[{start:15,duration:2,note:60,velocity:100}]);
snapshot.state.clips={open:[0,0,0,0],slots:snapshot.state.tracks.map(()=>Array.from({length:8},()=>[]))};
snapshot.state.song={on:true,loop:true,length:17,markers:[],lanes:Array.from({length:4},()=>[{at:0,len:16,clip:0,off:0}])};
(async()=>{
 const app=await _electron.launch({args:['--ozone-platform=headless','--disable-gpu','tests/song-regression-main.cjs']});
 try{
  const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(s=>{
   localStorage.setItem('decksynth.page','SONG');
   window.fixture=s;window.trace=[];window.tracing=false;
   window.commands=[];window.epochs=[];
   let listener;window.emit=()=>{window.receipt=performance.now();window.epochs.push({beat:s.song_beat,bpm:s.state.bpm,playing:s.playing});listener?.(structuredClone(window.fixture));};
   window.deckApi={available:true,onMessage(f){listener=f;setTimeout(window.emit,0);return()=>listener=null;},chooseFile:async()=>null,send(cmd,args){
    window.commands.push({cmd,args});
    if(cmd==='bars'){s.state.bars=args;s.playing=false;s.song_beat=0;s.beat=0;}
    if(cmd==='song')s.state.song=args;
    if(cmd==='select')s.selected=args;
    if(cmd==='clip'&&args[1]==='open')s.state.clips.open[args[0]]=args[2];
    window.emit();
   }};
   const measure=kind=>{
    if(!window.tracing)return;
    const first=Number(document.querySelector('.arr-tick span')?.textContent);
    const ruler=document.querySelectorAll('.arr-tick').length;
    const head=document.querySelector('.arr-playhead');
    const beat=head?((parseFloat(head.style.left)/100*ruler)+first-1)*4:null;
    window.trace.push({kind,now:performance.now(),receipt:window.receipt,absolute:s.song_beat,bpm:s.state.bpm,playing:s.playing,epochs:window.epochs.slice(-2),first,ruler,beat,
     position:document.querySelector('.transport-beat strong')?.textContent,
     blocks:[...document.querySelectorAll('.arr-block')].map(e=>({id:e.getAttribute('aria-label'),live:e.classList.contains('live')})),
     geometry:[...document.querySelectorAll('.clip-note,.clip-tail')].map(e=>({top:parseFloat(getComputedStyle(e).top),height:e.parentElement.clientHeight}))});
   };
   addEventListener('DOMContentLoaded',()=>{
    new MutationObserver(()=>measure('commit')).observe(document.getElementById('root'),{subtree:true,attributes:true,childList:true,characterData:true});
    const tick=()=>{measure('raf');requestAnimationFrame(tick);};requestAnimationFrame(tick);
   });
  },snapshot);
  await page.goto('file://'+path.resolve(dist,'index.html'));
  await page.locator('.arr-block').first().waitFor();
  const view=name=>page.getByRole('radiogroup',{name:'View',exact:true}).getByRole('radio',{name,exact:true});
  const settled=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  for(const height of [718,800]){
   await app.evaluate(({BrowserWindow},height)=>BrowserWindow.getAllWindows()[0].setContentSize(1280,height),height);
   await page.waitForFunction(height=>innerWidth===1280&&innerHeight===height,height);
   for(const bars of [1,2,4,8])for(const zoom of [8,16,32]){
    await page.evaluate(bars=>{fixture.playing=false;fixture.song_beat=0;fixture.beat=0;fixture.state.bars=bars;emit();},bars);
    await page.getByRole('radiogroup',{name:'Bars in view',exact:true}).getByRole('radio',{name:String(zoom),exact:true}).click();
    await settled();
    await page.evaluate(async()=>{
     trace=[];fixture.song_beat=47.95;fixture.beat=47.95%(fixture.state.bars*4);fixture.playing=true;emit();
     await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));window.tracing=true;
     for(let i=1;i<=9;i++){
      await new Promise(r=>setTimeout(r,100+[0,7,-9][i%3]));
      fixture.song_beat=47.95+i*.2;fixture.beat=fixture.song_beat%(fixture.state.bars*4);emit();
     }
     await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));window.tracing=false;
    });
    const trace=await page.evaluate(()=>window.trace);
    fs.writeFileSync(path.join(output,`clock-${height}-${bars}-${zoom}.json`),JSON.stringify(trace));
    assert.ok(trace.some(x=>x.kind==='commit')&&trace.some(x=>x.kind==='raf'));
    for(const frame of trace){
     if(frame.beat!==null){
      assert.ok(frame.beat>=47.9&&frame.beat<51,'no false clip-loop advance: '+JSON.stringify(frame));
      assert.ok(frame.blocks.every(b=>b.live),'actual block remains live before bar 17');
      const clock=frame.position.replace(/\s/g,'').split(':').map(Number);
      assert.equal(clock[0],Math.floor(frame.beat/4)+1);assert.equal(clock[1],Math.floor(frame.beat%4)+1);
     }
    }
   }
   // Real page/loop edges and manual browsing remain distinct from a false
   // phase edge. Inspect every commit/rAF, including delayed/focus-return frames.
   await page.getByRole('radiogroup',{name:'Bars in view',exact:true}).getByRole('radio',{name:'16',exact:true}).click();
   await page.evaluate(()=>{fixture.playing=false;fixture.song_beat=0;fixture.beat=0;fixture.state.bars=4;fixture.state.bpm=120;emit();});await settled();
   while(!await page.getByRole('button',{name:'Earlier bars',exact:true}).isDisabled())await page.getByRole('button',{name:'Earlier bars',exact:true}).click();
   await page.getByRole('button',{name:'Later bars',exact:true}).click();
   await page.evaluate(async()=>{
    trace=[];window.tracing=true;
    for(const beat of [1.1,2.2,4.1]){fixture.song_beat=beat;fixture.beat=beat%16;fixture.playing=true;emit();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}
    window.tracing=false;
   });
   assert.ok((await page.evaluate(()=>trace)).every(f=>f.first===9),'manual page is retained while clock is outside it');
   await page.getByRole('button',{name:'Earlier bars',exact:true}).click();
   await page.evaluate(async()=>{
    trace=[];window.tracing=true;
    for(const [beat,playing,bpm] of [[63.9,true,120],[64.1,true,120],[67.95,true,120],[68.1,true,120],[8,false,120],[8,true,60],[8.2,true,60]]){
     fixture.song_beat=beat;fixture.beat=beat%16;fixture.playing=playing;fixture.state.bpm=bpm;emit();
     await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    }
    await new Promise(r=>setTimeout(r,500));dispatchEvent(new Event('focus'));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));window.tracing=false;
   });
   const edges=await page.evaluate(()=>trace);fs.writeFileSync(path.join(output,`transport-edges-${height}.json`),JSON.stringify(edges));
   for(const f of edges){
    const [bar,beat]=f.position.replace(/\s/g,'').split(':').map(Number),shown=(bar-1)*4+beat-1;
    assert.ok(f.epochs.some(epoch=>{
     const start=((epoch.beat%68)+68)%68,end=(start+(epoch.playing ? .22*epoch.bpm/60 : 0))%68;
     return end>=start?shown>=Math.floor(start)&&shown<=Math.floor(end):shown>=Math.floor(start)||shown<=Math.floor(end);
    }),'transport stays in a permitted native epoch: '+JSON.stringify(f));
   }
   assert.ok(edges.some(f=>f.first===17)&&edges.some(f=>f.first===1),'follow crosses real page and 17-bar wrap');
   await page.evaluate(()=>{fixture.playing=false;fixture.state.bars=4;emit();});
   for(let entry=0;entry<4;entry++){
    await view('Timeline').click();await settled();
    await page.evaluate(()=>{trace=[];window.tracing=true;});
    await view('Clip notes').click();await settled();
    const trace=await page.evaluate(()=>{window.tracing=false;return window.trace;});
    fs.writeFileSync(path.join(output,`geometry-${height}-${entry}.json`),JSON.stringify(trace));
    for(const f of trace)for(const n of f.geometry)assert.ok(Math.abs(n.top-(24+(n.height-41)*5/6))<1,'first commit/paint already fits lane');
   }
   await page.evaluate(()=>window.commands=[]);
   const dragged=page.locator('.clip-note').first(),bounds=await dragged.boundingBox();
   await page.mouse.move(bounds.x+3,bounds.y+3);await page.mouse.down();await page.mouse.move(bounds.x+30,bounds.y+8);
   await dragged.dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();
   assert.equal(await page.evaluate(()=>commands.filter(x=>x.cmd==='note_edit').length),0,'pointer cancel does not commit a clip edit');
   const trigger=page.getByRole('button',{name:'Loop bars',exact:true});
   await trigger.click();const popup=page.getByRole('listbox',{name:'Clip loop length'});await popup.waitFor();
   assert.ok(await popup.evaluate(e=>{const c=getComputedStyle(e).backgroundColor.match(/\d+/g);return c.slice(0,3).every(n=>Number(n)<65);}));
   for(const option of await popup.getByRole('option').all()){
    const b=await option.boundingBox();assert.ok(b.width>=44&&b.height>=44);
    assert.ok(await option.evaluate(e=>e.contains(document.elementFromPoint(e.getBoundingClientRect().x+10,e.getBoundingClientRect().y+10))));
   }
   await page.screenshot({path:path.join(shots,`loop-bars-open-1280x${height}.png`)});
   await page.keyboard.press('Escape');await popup.waitFor({state:'detached'});assert.ok(await trigger.evaluate(e=>document.activeElement===e));
   await trigger.press('ArrowDown');await page.keyboard.press('Home');await page.keyboard.press('Enter');
   await page.waitForFunction(()=>fixture.state.bars===1);assert.equal(await page.evaluate(()=>fixture.state.song.length),17);
   await trigger.click();await popup.getByRole('option',{name:'8 bars',exact:true}).click();await page.waitForFunction(()=>fixture.state.bars===8);
   await trigger.press('ArrowUp');await popup.waitFor();await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');await page.waitForFunction(()=>fixture.state.bars===4);
   await trigger.click();await popup.waitFor();await page.keyboard.press('Tab');
   assert.ok(await page.locator('.metronome-button').evaluate(e=>document.activeElement===e),'Tab continues from the transport trigger');
   await trigger.click();await page.getByRole('button',{name:'Help',exact:true}).click();await popup.waitFor({state:'detached'});await page.keyboard.press('Escape');
   await page.screenshot({path:path.join(shots,`candidate-1280x${height}.png`)});
  }
  assert.deepEqual(errors,[]);console.log('PASS coherent DOM/rAF clocks, mount geometry and actual opened in-app Loop bars at both sizes');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
