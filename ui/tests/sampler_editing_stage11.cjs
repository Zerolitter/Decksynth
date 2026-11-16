// Sampler editing stage 11 (15 Nov evening): the sample library. Save a trim of a take into a category, find it
// browsing like the presets, hear it, load it into the Sampler, and set the folders the library uses.
'use strict';
const path=require('node:path'),fs=require('node:fs');
module.exports=async({p,send,latest,inside,H,OUT,DATA,assert})=>{
  const lib=()=>p.evaluate(()=>window.__latest.sample_library);
  // A Sampler with a sample on it (the take from stage 5/6), or load the test WAV onto a new one.
  let st=(await latest()).state;let t=st.tracks.findIndex(x=>x.device==='sampler'&&x.sampler?.source);
  if(t<0){t=2;await send('set_device',[t,'sampler']);await p.waitForFunction(t=>window.__latest.state.tracks[t].device==='sampler',t);
    const id=(await latest()).state.tracks[t].sampler.id;await send('sampler_load_wav',[t,id,path.join(DATA,'piano notes.wav')]);
    await p.waitForFunction(t=>!!window.__latest.state.tracks[t].sampler?.source,t,{timeout:20000});}
  await p.getByRole('tab',{name:/^Sound$/}).click();
  await p.locator('.page-track').nth(t).click();await p.waitForFunction(t=>window.__latest.selected===t,t);await p.locator('.sampler-page').waitFor();
  const spec=(await latest()).state.tracks[t].sampler;
  const open=p.locator('.smp-lib-open');await inside(open,'Library button');await open.click();
  const sheet=p.getByRole('dialog',{name:'Sample library'});await sheet.waitFor();
  for(const name of ['Close sample library','Look again','Save to library','Change','Add folder'])await inside(sheet.getByRole('button',{name,exact:true}),name);
  // Save the trim as "Test take" in a new category.
  await sheet.getByRole('radio',{name:'Trim'}).click();
  await sheet.getByLabel('Name').fill('Test take');await sheet.getByLabel('Category').fill('Takes');
  await sheet.getByRole('button',{name:'Save to library'}).click();
  await p.waitForFunction(()=>(window.__latest.sample_library?.categories||[]).some(c=>c.name==='Takes'&&c.count===1),null,{timeout:15000});
  const save=(await lib()).save;const file=path.join(save,'Takes','Test take.wav');
  assert.ok(fs.existsSync(file),'the trim is a WAV in the save folder: '+file);
  // Browse it like the presets: its category tab, then its card.
  await sheet.getByRole('tab',{name:/^Takes/}).click();
  const card=sheet.getByRole('button',{name:'Load sample Test take'});await card.waitFor();await inside(card,'Sample card');
  const hear=sheet.getByRole('button',{name:'Hear Test take'});await inside(hear,'Hear');await hear.click();
  await p.waitForFunction(f=>window.__latest.sample_library?.preview===f,file);
  await sheet.getByRole('button',{name:'Stop Test take'}).click();
  await p.waitForFunction(()=>!window.__latest.sample_library?.preview);
  await p.screenshot({path:path.join(OUT,'sample-library-'+H+'.png')});
  // Load it into this Sampler: the source is the library file, and Undo brings the take back.
  await card.click();
  await p.waitForFunction(([t,f])=>window.__latest.state.tracks[t].sampler?.source?.path===f,[t,file],{timeout:15000});
  // Folders: browse one more folder, then stop browsing it.
  const extra=path.join(DATA,'More samples');fs.mkdirSync(path.join(extra,'Hits'),{recursive:true});
  fs.copyFileSync(file,path.join(extra,'Hits','Copy.wav'));
  await send('sample_library_folder',['add',extra]);
  await p.waitForFunction(x=>(window.__latest.sample_library?.load||[]).includes(x)&&window.__latest.sample_library.categories.some(c=>c.name==='Hits'),extra,{timeout:15000});
  const remove=sheet.getByRole('button',{name:'Stop browsing '+extra});await remove.waitFor();await remove.click();
  await p.waitForFunction(x=>!(window.__latest.sample_library?.load||[]).includes(x),extra);
  // The folders are remembered across launches.
  const cfg=JSON.parse(fs.readFileSync(path.join(DATA,'sample-library.json'),'utf8'));
  assert.equal(cfg.save,save,'the save folder is remembered');
  await sheet.getByRole('button',{name:'Close sample library'}).click();await sheet.waitFor({state:'detached'});
  await p.getByRole('button',{name:'Undo',exact:true}).click();
  await p.waitForFunction(([t,f])=>window.__latest.state.tracks[t].sampler?.source?.path!==f,[t,file],{timeout:10000});
  assert.equal((await latest()).state.tracks[t].sampler.source.path,spec.source.path,'Undo brings the take back');
  console.log('PASS stage 11 at '+H);
};
