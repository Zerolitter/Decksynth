// Preview-only UI test: KeyStep-inspired UI modules, project isolation, and touch geometry.
'use strict';
const {_electron}=require('playwright');
const path=require('node:path');
const assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
(async()=>{
 const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
  args:['electron/playwright-main.cjs'],cwd:ROOT,
  env:{...process.env,DECKSYNTH_UI_PREVIEW:'1',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:16000});
 try{
  const p=await app.firstWindow({timeout:15000});
  p.setDefaultTimeout(8000);
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.getByRole('tab',{name:/PERFORM/i}).click();
  await p.locator('.perf-workspace').waitFor({state:'visible'});
  assert.equal(await p.locator('.perf-step').count(),16);
  await p.screenshot({path:path.join(ROOT,'docs','keystep-sequencer-preview.png')});
  await p.locator('.perf-step').first().click();
  await p.getByRole('button',{name:/ADD NOTE/i}).click();
  await p.waitForFunction(()=>document.querySelector('.perf-step.programmed')!==null);
  const count=await p.locator('.perf-step.programmed').count();
  assert.equal(count,1);
  assert.match(await p.locator('.perf-step.programmed').first().innerText(),/C4/);
  // Bank selection must not discard the previous pattern's notes in the preview.
  await p.locator('.perf-top-controls .perf-select select').first().selectOption('2');
  assert.equal(await p.locator('.perf-step.programmed').count(),0);
  await p.locator('.perf-top-controls .perf-select select').first().selectOption('1');
  assert.equal(await p.locator('.perf-step.programmed').count(),1);
  const range=label=>p.locator('.perf-utilities .perf-level').filter({hasText:label}).locator('input');
  const setRange=async(label,value)=>{
    const input=range(label),min=Number(await input.getAttribute('min')),
      max=Number(await input.getAttribute('max')),step=Number(await input.getAttribute('step'));
    const fromMin=value-min<=max-value;
    await input.press(fromMin?'Home':'End');
    for(let i=0;i<Math.round((fromMin?value-min:max-value)/step);i++)await input.press(fromMin?'ArrowRight':'ArrowLeft');
    assert.equal(Number(await input.inputValue()),value);
  };
  const timing=()=>p.evaluate(()=>({
    length:Number(document.querySelector('.perf-top-controls .perf-counter strong').textContent),
    division:document.querySelector('.perf-top-controls .perf-select:last-of-type select')?.value
      ??[...document.querySelectorAll('.perf-top-controls select')].at(-1).value,
    gate:Number(document.querySelectorAll('.perf-utilities .perf-level input')[0].value),
    swing:Number(document.querySelectorAll('.perf-utilities .perf-level input')[1].value),
  }));
  for(let i=0;i<9;i++)await p.getByRole('button',{name:'Reduce pattern length',exact:true}).click();
  await p.locator('.perf-top-controls select').nth(2).selectOption('1/8T');
  await setRange('GATE',20);await setRange('SWING',70);
  assert.deepEqual(await timing(),{length:7,division:'1/8T',gate:20,swing:70});
  await p.locator('.perf-top-controls select').nth(0).selectOption('2');
  assert.deepEqual(await timing(),{length:16,division:'1/16',gate:80,swing:50});
  await setRange('GATE',90);await setRange('SWING',60);
  await p.locator('.perf-top-controls select').nth(0).selectOption('1');
  assert.deepEqual(await timing(),{length:7,division:'1/8T',gate:20,swing:70});
  await p.locator('.perf-top-controls select').nth(1).selectOption('2');
  assert.deepEqual(await timing(),{length:16,division:'1/16',gate:80,swing:50});
  await p.locator('.perf-top-controls select').nth(1).selectOption('1');
  assert.deepEqual(await timing(),{length:7,division:'1/8T',gate:20,swing:70});
  await p.getByRole('button',{name:/SONG → PATTERN/}).click();
  assert.deepEqual(await timing(),{length:7,division:'1/8T',gate:80,swing:50});
  console.log('PASS: preview bank/slot/conversion timing reconciles actual controls');
  await p.getByRole('tab',{name:/ARP/i}).click();
  await p.locator('.perf-arp-controls').waitFor();
  await p.getByLabel('PATTERN MODE').selectOption('UpDown');
  await p.getByRole('button',{name:/ENABLE ARP/i}).click();
  await p.screenshot({path:path.join(ROOT,'docs','keystep-arpeggiator-preview.png')});
  assert.ok(await p.getByRole('button',{name:/ARP ON/i}).isVisible());
  await p.getByRole('tab',{name:/CHORD/i}).click();
  await p.locator('.perf-chord-presets').waitFor();
  await p.getByRole('button',{name:'Minor 9',exact:true}).click();
  await p.getByRole('button',{name:/ENABLE CHORD/i}).click();
  await p.screenshot({path:path.join(ROOT,'docs','keystep-chord-preview.png')});
  await p.getByRole('tab',{name:/KEYS/i}).click();
  await p.locator('.perf-keyboard-controls').waitFor();
  await p.getByLabel('SCALE').selectOption('Dorian');
  await p.screenshot({path:path.join(ROOT,'docs','keystep-keyboard-preview.png')});
  await p.getByRole('tab',{name:/SONG/i}).click();
  assert.equal(await p.locator('.clip-note').count(),9);
  const layout=await p.evaluate(()=>{
    const bounds=sel=>{const el=document.querySelector(sel);if(!el)return null;const b=el.getBoundingClientRect();return {top:b.top,bottom:b.bottom,left:b.left,right:b.right,width:b.width,height:b.height};};
    return {width:innerWidth,height:innerHeight,perf:bounds('.perf-workspace'),clips:document.querySelectorAll('.clip-note').length};
  });
  assert.equal(layout.width,1280);
  if(errs.length)throw new Error(errs.join('; '));
  console.log('PASS: 16-step performance editor, add note, pattern bank retention');
  console.log('PASS: Arp, Chord, Scale/Keyboard controls and SONG notes remain separate');
  console.log('PASS: no Electron renderer errors, four native preview screenshots');
 }finally{await app.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
