// Preview UI test for the song timeline (PLAN K): Loop/Song mode, clip blocks per track (place, select, change clip,
// length, clip bar, duplicate, split, make a new clip, delete, drag to move), markers, song length, the clips sheet,
// the Clip notes view, Esc / blank tap / Done ending a selection, and everything in view at 722 px.
'use strict';
require('./deck_guard.cjs');
const {_electron}=require('playwright');
const path=require('node:path');
const assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
(async()=>{
 const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,
  env:{...process.env,DECKSYNTH_UI_PREVIEW:'1',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
 try{
  const p=await app.firstWindow({timeout:15000});
  p.setDefaultTimeout(8000);
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.evaluate(()=>localStorage.clear());
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,722));
  await p.getByRole('tab',{name:/^Song$/}).click();
  const checked=async(group,name)=>p.getByRole('radiogroup',{name:group}).getByRole('radio',{name,exact:true}).getAttribute('aria-checked');
  const blocks=tr=>p.getByRole('group',{name:'Track '+tr+' lane'}).locator('.arr-block');
  const labels=async tr=>{const out=[];for(const b of await blocks(tr).all())out.push((await b.getAttribute('aria-label')).replace(/^Track \d block /,''));return out;};
  const tapBar=async(tr,bar,zoom=16)=>{const b=await p.getByRole('group',{name:'Track '+tr+' lane'}).boundingBox();
    await p.mouse.click(b.x+b.width*((bar-.5)/zoom),b.y+b.height/2);};

  // Loop mode is the default and shows the clip notes; Song switches it on and shows the timeline.
  assert.equal(await checked('Play mode','Clip loop'),'true');
  assert.equal(await checked('View','Clip notes'),'true');
  await p.getByRole('radio',{name:'Song',exact:true}).click();
  assert.equal(await checked('Play mode','Song'),'true');
  assert.equal(await checked('View','Timeline'),'true');
  assert.deepEqual(await labels(1),['A, bars 1 to 16'],'every track starts with clip A over the whole song');

  // Everything is in view at 722 px and every control is a touch target.
  const lower=await p.locator('.song-output').first().boundingBox();
  for(let i=1;i<=4;i++){const b=await p.getByRole('group',{name:'Track '+i+' lane'}).boundingBox();
    assert.ok(b&&b.height>=44&&b.y+b.height<=lower.y+1,'lane '+i+' is in view above live output');}
  for(const b of await p.locator('.song-bar button, .arr-ruler button, .arr-head button').all()){
    const r=await b.boundingBox();if(r)assert.ok(r.height>=40&&r.width>=36,'touch target '+(await b.getAttribute('aria-label')||await b.textContent()));}

  // Select a block: the block tools show; change its clip and length; Esc ends the selection.
  await blocks(3).first().click();
  assert.ok(await p.getByRole('group',{name:'Block',exact:true}).isVisible());
  {const len=p.getByRole('spinbutton',{name:'Block length'});await len.focus();await len.press('ArrowDown');}
  await p.waitForTimeout(450);
  assert.deepEqual(await labels(3),['A, bars 1 to 15']);
  await p.getByRole('radiogroup',{name:'Block clip'}).getByRole('radio',{name:/^Clip C/}).click();
  assert.deepEqual(await labels(3),['C, bars 1 to 15']);
  await p.keyboard.press('Escape');
  assert.equal(await p.getByRole('group',{name:'Block',exact:true}).count(),0,'Esc ends the selection');

  // Delete, then place clips on empty bars: one clip length, in line with the bar grid, and a one-bar fill at the end.
  await blocks(3).first().click();
  await p.getByRole('button',{name:'Delete block'}).click();
  assert.equal(await blocks(3).count(),0);
  await tapBar(3,5);
  assert.deepEqual(await labels(3),['A, bars 5 to 8'],'a tap places the open clip for one clip length');
  await tapBar(3,4);
  assert.deepEqual(await labels(3),['A, bars 4 to 4','A, bars 5 to 8'],'a tap on the last bar of a phrase is a one-bar fill');
  await blocks(3).first().click();
  const from=p.getByRole('spinbutton',{name:'Starts on clip bar'});
  assert.match(await from.textContent(),/from 4\/4/,'the fill plays the clip\'s last bar');
  await from.focus();await from.press('ArrowDown');await p.waitForTimeout(450);
  assert.match(await from.textContent(),/from 3\/4/,'a value box moves the clip bar');
  // A blank tap ends the selection without placing anything.
  await tapBar(3,12);
  assert.equal(await p.getByRole('group',{name:'Block',exact:true}).count(),0,'a blank tap ends the selection');
  assert.equal(await blocks(3).count(),2,'and places nothing');

  // Duplicate, split, make a new clip (copied and opened), Done.
  await blocks(3).nth(1).click();
  await p.getByRole('button',{name:'Duplicate block'}).click();
  assert.deepEqual(await labels(3),['A, bars 4 to 4','A, bars 5 to 8','A, bars 9 to 12']);
  await p.getByRole('button',{name:'Split block'}).click();
  assert.deepEqual(await labels(3),['A, bars 4 to 4','A, bars 5 to 8','A, bars 9 to 10','A, bars 11 to 12']);
  await blocks(1).first().click();
  await p.getByRole('button',{name:'Make a new clip from this block'}).click();
  assert.deepEqual(await labels(1),['B, bars 1 to 16'],'the block now plays the new clip B');
  assert.match(await p.getByRole('button',{name:/^Clips of track 1/}).getAttribute('aria-label'),/clip B is open/,'and B is open for editing');
  await p.getByRole('group',{name:'Block',exact:true}).getByRole('button',{name:'Done'}).click();
  assert.equal(await p.getByRole('group',{name:'Block',exact:true}).count(),0,'Done ends the selection');

  // Drag a block two bars to the right.
  const fill=await blocks(3).first().boundingBox(),lane=await p.getByRole('group',{name:'Track 3 lane'}).boundingBox();
  await p.mouse.move(fill.x+fill.width/2,fill.y+fill.height/2);await p.mouse.down();
  await p.mouse.move(fill.x+fill.width/2+lane.width/16*1,fill.y+fill.height/2,{steps:6});
  await p.mouse.move(fill.x+fill.width/2+lane.width/16*2,fill.y+fill.height/2,{steps:6});await p.mouse.up();
  assert.deepEqual(await labels(3),['A, bars 5 to 5','A, bars 6 to 6','A, bars 7 to 8','A, bars 9 to 10','A, bars 11 to 12'],
    'the fill moved two bars later, to bar 6, and cut the block under it in two');
  await p.keyboard.press('Escape');

  // Markers: tap the ruler, add one, name it from the buttons, delete another.
  await p.getByRole('button',{name:'Bar 9',exact:true}).click();
  await p.getByRole('button',{name:'Add a marker here'}).click();
  await p.getByRole('radiogroup',{name:'Marker names'}).getByRole('radio',{name:'Drop'}).click();
  assert.ok(await p.getByRole('button',{name:'Bar 9, marker Drop'}).isVisible());
  await p.getByRole('button',{name:'Bar 1, marker Intro'}).click();
  await p.getByRole('button',{name:'Delete marker'}).click();
  assert.ok(await p.getByRole('button',{name:'Bar 1',exact:true}).isVisible());
  await p.getByRole('group',{name:'Marker',exact:true}).getByRole('button',{name:'Done'}).click();

  // Song length, repeat toggle, zoom and paging.
  {const len=p.getByRole('spinbutton',{name:'Song length'});await len.focus();await len.press('Shift+ArrowUp');await p.waitForTimeout(450);
  assert.match(await len.textContent(),/20 bars/);}
  const repeat=p.getByRole('button',{name:'Repeat song',exact:true});
  await repeat.click();
  assert.equal(await repeat.getAttribute('aria-pressed'),'false');
  await p.getByRole('radio',{name:'32',exact:true}).click();
  assert.equal(await p.locator('.arr-tick').count(),32);
  await p.getByRole('radio',{name:'16',exact:true}).click();
  await p.getByRole('button',{name:'Later bars'}).click();
  assert.ok(await p.getByRole('button',{name:'Bar 9, marker Drop'}).isVisible(),'paged to bars 9-24');
  await p.getByRole('button',{name:'Earlier bars'}).click();
  await p.screenshot({path:path.join(ROOT,'docs/song-timeline-acceptance.png')});

  // Clips sheet: open another clip, copy, Esc and Done close it.
  await p.getByRole('button',{name:/^Clips of track 2/}).click();
  const sheet=p.getByRole('dialog',{name:'Track 2 clips'});
  await sheet.getByRole('button',{name:/Copy A to a new clip \(B\)/}).click();
  assert.match(await sheet.getByRole('radio',{name:/^Clip B,/}).getAttribute('aria-label'),/notes/,'B holds a copy of A');
  assert.equal(await sheet.getByRole('radio',{name:/^Clip B,/}).getAttribute('aria-checked'),'true','and is open');
  await p.keyboard.press('Escape');
  assert.equal(await sheet.count(),0,'Esc closes the clips sheet');
  await p.getByRole('button',{name:/^Clips of track 2/}).click();
  await sheet.getByRole('button',{name:'Done'}).click();
  assert.equal(await sheet.count(),0,'Done closes the clips sheet');

  // Edit a block's notes: opens that clip in the Clip notes view.
  await blocks(2).first().click();
  await p.getByRole('button',{name:"Edit this clip's notes"}).click();
  assert.equal(await checked('View','Clip notes'),'true');
  assert.equal(await p.locator('.track-row').count(),4,'the note lanes show');
  await p.getByRole('radio',{name:'Timeline'}).click();

  // Back to Loop mode shows the clip notes and keeps the timeline.
  await p.getByRole('radio',{name:'Clip loop',exact:true}).click();
  assert.equal(await checked('Play mode','Clip loop'),'true');
  assert.equal(await checked('View','Clip notes'),'true');
  await p.getByRole('radio',{name:'Timeline'}).click();
  assert.equal(await blocks(3).count(),5);
  assert.ok(await p.locator('.arranger.is-off').isVisible(),'the timeline shows as off in Loop mode');
  assert.deepEqual(errs,[]);
  console.log('song timeline acceptance: ok');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
