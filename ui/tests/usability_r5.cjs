'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launch } = require('./usability-harness.cjs');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decksynth-r5-music-'));
  const library = path.join(tmp, 'Library'); fs.mkdirSync(path.join(library,'Kit'), { recursive: true });
  execFileSync('python3', ['-c', `import sys,wave,struct,math,pathlib
p=pathlib.Path(sys.argv[1])
for name,hz in [('Kick',90),('Snare',195),('_Demo Loop 116bpm',300)]:
 with wave.open(str(p/(name+'.wav')),'wb') as w:
  w.setparams((1,2,48000,0,'NONE','PCM'))
  w.writeframes(b''.join(struct.pack('<h',int(10000*math.sin(2*math.pi*hz*i/48000)*math.exp(-i/9000))) for i in range(24000)))`, path.join(library,'Kit')]);
  const h = await launch('r5');
  const { page, send, height, commands, shot, point, move } = h;
  const failures=[];
  const check=async(name,run)=>{try{await run();console.log('PASS',name);}catch(e){failures.push(name);console.error('FAIL',name,e.stack);}};
  const notes=()=>page.evaluate(()=>window.usabilityState.state.tracks[0].notes);
  const step=i=>page.getByTestId('drum-step-'+i);
  const pad=i=>page.locator('.drum-pad[data-pad="'+i+'"]');
  const target=()=>page.getByTestId('drum-step-target');
  const waitNotes=n=>page.waitForFunction(n=>window.usabilityState.state.tracks[0].notes.length===n,n);
  try {
    await height(718);await page.getByRole('tab',{name:'Sound',exact:true}).click();
    await send('set_device',[0,'drum_rack']);
    await page.waitForFunction(()=>window.usabilityState.state.tracks[0].device==='drum_rack');
    const id=await page.evaluate(()=>window.usabilityState.state.tracks[0].drum_rack.id);
    await send('drum_library_root',library);
    await page.waitForFunction(()=>window.usabilityState.drum_library?.folders?.some(f=>f.id==='Kit'));
    await send('drum_load_folder',[0,id,'Kit']);
    await page.waitForFunction(id=>window.usabilityState.state.tracks[0].drum_rack.id!==id,id);
    await send('note_edit',[{kind:'clip',track:0,clip:0,bars:4,device:'drum_rack'},[],[{start:.5,note:42,duration:.25,velocity:79}]]);await waitNotes(1);
    await send('select',1);await page.waitForFunction(()=>window.usabilityState.selected===1);
    await send('note_edit',[{kind:'clip',track:1,clip:0,bars:4,device:'synth'},[],[{start:1,note:72,duration:.5,velocity:82}]]);
    await page.waitForFunction(()=>window.usabilityState.state.tracks[1].notes.length===1);
    await send('select',0);await page.waitForFunction(()=>window.usabilityState.selected===0);
    await page.locator('.drum-rack').waitFor();
    await check('automatic kit selection skips demo audio and the 16-step lane fits beside untouched Pad Sound',async()=>{
      const kit=await page.evaluate(()=>window.usabilityState.state.tracks[0].drum_rack);
      assert.equal(kit.pads.filter(p=>p.source).length,2);
      assert.ok(!kit.pads.some(p=>p.source?.path.includes('Demo Loop')));
      for(const size of [718,800]){
        await height(size);await target().waitFor();assert.match(await target().textContent(),/Track 1.*Clip A.*MIDI 36/);
        assert.equal(await page.locator('.drum-pad').count(),16);
        assert.equal(await page.locator('.drum-step-grid>button').count(),16);
        assert.equal(await page.getByRole('group',{name:'Unavailable Drum Rack pages',exact:true}).count(),0);
        assert.equal(await page.getByLabel('Native audio output',{exact:true}).count(),0);
        for(let i=1;i<=16;i++){
          const b=await step(i).boundingBox();assert.ok(b.width>=44&&b.height>=44&&b.y+b.height<=size);
          assert.ok(await step(i).evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
        }
        await page.getByRole('heading',{name:'PAD SOUND',exact:true}).waitFor();
        await shot('drum-step-workflow',size);
      }
    });
    await height(718);
    await check('step edits target the selected pad, bar and open clip; the native clock plays real generated PCM',async()=>{
      await step(1).click();await waitNotes(2);
      assert.ok((await notes()).some(n=>n.note===36&&n.start===0&&n.duration===.25&&n.velocity===100));
      await page.waitForFunction(()=>window.usabilityState.voices===0);
      const serial=await page.evaluate(()=>window.usabilityState.drum_racks[0].pads[0].event);
      await page.evaluate(()=>{window.r5Peak=0;window.deckApi.onMessage(m=>{if(m.meter)window.r5Peak=Math.max(window.r5Peak,m.meter.peak);});});
      await send('play');await page.waitForFunction(serial=>window.usabilityState.drum_racks[0].pads[0].event>serial,serial);
      await page.waitForFunction(()=>window.r5Peak>.001);
      await send('stop');await page.waitForFunction(()=>!window.usabilityState.playing);
      await step(5).focus();await page.keyboard.press('Space');await waitNotes(3);
      await pad(2).click();assert.match(await target().textContent(),/MIDI 38/);
      await step(3).click();await waitNotes(4);
      await page.getByRole('button',{name:'Next drum bar',exact:true}).click();
      await step(3).click();await waitNotes(5);
      assert.ok((await notes()).some(n=>n.note===38&&n.start===4.5));
      assert.ok((await notes()).some(n=>n.note===42&&n.start===.5&&n.velocity===79));
      assert.deepEqual(await page.evaluate(()=>window.usabilityState.state.tracks[1].notes),[{start:1,note:72,duration:.5,velocity:82}]);
    });
    await check('pad, bar and clip changes cannot redirect an in-flight step edit',async()=>{
      for(const kind of ['pad','bar','clip','blur','Escape','leave']){
        const before=await notes();await commands();await move(await point(step(9)));await page.mouse.down();
        try{
          if(kind==='pad')await pad(0).evaluate(el=>el.click());
          if(kind==='bar')await page.getByRole('button',{name:'Next drum bar',exact:true}).evaluate(el=>el.click());
          if(kind==='clip'){await send('clip',[0,'open',1,null]);await page.waitForFunction(()=>window.usabilityState.state.clips.open[0]===1);await page.waitForFunction(()=>document.querySelector('[data-testid="drum-step-target"]')?.textContent?.includes('Clip B'));}
          if(kind==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
          if(kind==='Escape')await page.keyboard.press('Escape');
          if(kind==='leave')await page.mouse.move(100,130);
        }finally{await page.mouse.up();}
        assert.ok(!(await commands()).some(c=>c.cmd==='note_edit'));
        if(kind==='clip')assert.deepEqual(await page.evaluate(()=>window.usabilityState.state.clips.slots[0][0]),before);
        else assert.deepEqual(await notes(),before);
      }
      assert.match(await target().textContent(),/Clip B/);
    });
    await check('Undo and native save/reopen preserve other pitches, clips and tracks',async()=>{
      const original=await page.evaluate(()=>window.usabilityState.state.clips.slots[0][0]);
      await page.evaluate(()=>{
        document.querySelector('[data-testid="drum-step-2"]').click();
        document.querySelector('.transport-utility[aria-label="Undo"]').click();
      });
      assert.equal(await step(2).getAttribute('aria-pressed'),'false','immediate Undo clears an unacknowledged preview');
      await step(2).click();await waitNotes(1);
      await page.getByRole('button',{name:'Undo last edit',exact:true}).click();await waitNotes(0);
      await step(4).click();await waitNotes(1);
      const before=await page.evaluate(()=>window.usabilityState.state),file=path.join(tmp,'Generated R5.decksynth');
      await send('save',file);for(let i=0;i<100&&!fs.existsSync(file);i++)await new Promise(r=>setTimeout(r,20));assert.ok(fs.existsSync(file));
      const bytes=fs.readFileSync(file);
      await step(8).click();await waitNotes(2);await send('load',file);
      await page.waitForFunction(notes=>JSON.stringify(window.usabilityState.state.tracks[0].notes)===notes,JSON.stringify(before.tracks[0].notes));
      assert.deepEqual(await page.evaluate(()=>window.usabilityState.state.clips.slots[0][0]),original);
      assert.deepEqual(await page.evaluate(()=>window.usabilityState.state.tracks[1].notes),before.tracks[1].notes);
      assert.deepEqual(fs.readFileSync(file),bytes);
      assert.ok(!bytes.toString().includes('pcm'));
    });
    await check('recording disables destructive step edits and SONG retains only truthful live output',async()=>{
      if(await page.getByRole('button',{name:'Dismiss message',exact:true}).count())await page.getByRole('button',{name:'Dismiss message',exact:true}).click();
      const before=await notes();
      await send('record');await page.waitForFunction(()=>window.usabilityState.recording);
      assert.ok(await step(1).isDisabled());assert.ok(await page.getByRole('button',{name:'Undo last edit',exact:true}).isDisabled());
      const serial=await page.evaluate(()=>window.usabilityState.drum_racks[0].pads[0].event);
      await page.getByRole('button',{name:'Audition selected drum pad',exact:true}).click();
      await page.waitForFunction(serial=>window.usabilityState.drum_racks[0].pads[0].event>serial,serial);
      await send('record');await page.waitForFunction(()=>!window.usabilityState.recording);await send('stop');await page.waitForFunction(()=>!window.usabilityState.playing);
      assert.deepEqual(await notes(),before,'editor audition never writes into a recorded clip');
      await page.getByRole('tab',{name:'Song',exact:true}).click();
      assert.equal(await page.getByTestId('hardware-sequencer').count(),0);
      assert.equal(await page.getByText('LIVE OUTPUT',{exact:true}).count(),1);
      await shot('song-live-output',718);
    });
  }finally{await h.close();fs.rmSync(tmp,{recursive:true,force:true});}
  assert.deepEqual(failures,[]);
})().catch(e=>{console.error(e);process.exitCode=1;});
