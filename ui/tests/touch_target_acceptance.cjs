// Steam Deck touch targets (UI rules 3 and 15), on the real Electron renderer at 1280x718.
// Visits every page and instrument, and checks every visible control:
//  - its hit area is at least 44x44 px;
//  - nothing covers it: the element under its centre is the control itself (or inside it).
// Controls scrolled out of their scroller are skipped; scroll to reach them is allowed.
// Shots go to docs/touch-acceptance-<view>.png. Run: DISPLAY=:0 node tests/touch_target_acceptance.cjs
'use strict';
const {_electron}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const H=Number(process.env.HEIGHT||718),MIN=44;
const data=fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-touch-'));

const CONTROLS=['button','[role=button]','[role=radio]','[role=tab]','[role=switch]','[role=checkbox]','[role=slider]',
  'input:not([type=hidden])','select','textarea','a[href]','.knob-target','.value-box'].join(',');
// Drawing surfaces: cells you paint across with one finger drag, sized by the music, not single taps.
// Reported, but not failed: the piano-roll note grid, its bar ruler and row keys, and the synth's partial bars.
const SURFACE='.note-time-cell,.piano-ruler-tick,.piano-pitch-key,.ss-bar';

function scan(sel,MIN,SURFACE){
  const out=[];const seen=new Set();
  const visible=e=>{const s=getComputedStyle(e);return s.visibility!=='hidden'&&s.display!=='none'&&+s.opacity>.05;};
  for(const e of document.querySelectorAll(sel)){
    // the outermost matching control owns the hit area (a knob-target inside a button counts once)
    if(e.parentElement?.closest(sel)&&!e.matches('.knob-target'))continue;
    if(e.closest('[aria-hidden=true],[inert]'))continue;
    const r=e.getBoundingClientRect();
    if(r.width<1||r.height<1||!visible(e))continue;
    let a=e,ok=true;for(;a;a=a.parentElement){if(!visible(a)){ok=false;break;}}
    if(!ok)continue;
    const cx=r.left+r.width/2,cy=r.top+r.height/2;
    if(cx<0||cy<0||cx>innerWidth||cy>innerHeight)continue;
    // skip controls scrolled out of a clipping ancestor
    let clipped=false;
    for(a=e.parentElement;a;a=a.parentElement){const s=getComputedStyle(a);
      if(/(auto|scroll|hidden|clip)/.test(s.overflowX+s.overflowY)){const q=a.getBoundingClientRect();
        if(cx<q.left||cx>q.right||cy<q.top||cy>q.bottom){clipped=true;break;}}}
    if(clipped)continue;
    const name=(e.getAttribute('aria-label')||e.textContent||e.getAttribute('title')||'').trim().replace(/\s+/g,' ').slice(0,40);
    const cls=(e.className&&typeof e.className==='string'?e.className:'').split(' ').filter(Boolean).slice(0,2).join('.');
    const id=e.tagName.toLowerCase()+(cls?'.'+cls:'')+(name?' "'+name+'"':'');
    if(seen.has(id+r.left+r.top))continue;seen.add(id+r.left+r.top);
    const top=document.elementFromPoint(cx,cy);
    const covered=!(top&&(top===e||e.contains(top)||top.contains(e)&&top.matches(sel)));
    const coverer=covered&&top?top.tagName.toLowerCase()+'.'+String(top.className||'').split(' ')[0]:'';
    // an absolutely placed ::before/::after with negative insets widens the hit zone (rule 10: small visual, 44 px hit)
    let hx1=r.left,hx2=r.right,hy1=r.top,hy2=r.bottom;
    for(const ps of ['::before','::after']){const s=getComputedStyle(e,ps);
      if(s.content==='none'||s.position!=='absolute'||s.pointerEvents==='none')continue;
      const v=['top','right','bottom','left'].map(k=>/px$/.test(s[k])?parseFloat(s[k]):NaN);if(v.some(Number.isNaN))continue;
      hx1=Math.min(hx1,r.left+v[3]);hx2=Math.max(hx2,r.right-v[1]);hy1=Math.min(hy1,r.top+v[0]);hy2=Math.max(hy2,r.bottom-v[2]);}
    const hw=hx2-hx1,hh=hy2-hy1;
    const small=hw<MIN-.5||hh<MIN-.5;
    if(small||covered)out.push({id,w:Math.round(hw),h:Math.round(hh),small,covered,coverer,surface:!!e.closest(SURFACE)});
  }
  return out;
}

(async()=>{
  const app=await _electron.launch({executablePath:path.join(ROOT,'node_modules/electron/dist/electron'),
    args:['electron/playwright-main.cjs'],cwd:ROOT,
    env:{...process.env,DECKSYNTH_UI_PREVIEW:'0',DECKSYNTH_DATA_DIR:data,SDL_AUDIODRIVER:'dummy',ELECTRON_OZONE_PLATFORM_HINT:'x11'},timeout:20000});
  let fails=0;const report=[];
  try{
    const p=await app.firstWindow({timeout:18000});p.setDefaultTimeout(10000);
    p.on('pageerror',e=>{console.error('pageerror',e.message);fails++;});
    await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'),null,{timeout:20000});
    // The window maximizes once it is ready to show; size it after that, and retry until it takes.
    for(let i=0;i<30;i++){await app.evaluate(({BrowserWindow},h)=>{const w=BrowserWindow.getAllWindows()[0];if(w.isMaximized())w.unmaximize();w.setContentSize(1280,h);},H);
      await p.waitForTimeout(150);if(await p.evaluate(h=>innerWidth===1280&&innerHeight===h,H))break;}
    const size=await p.evaluate(()=>({w:innerWidth,h:innerHeight}));
    if(size.w!==1280||Math.abs(size.h-H)>2){console.error('FAIL window is',size);fails++;}
    const tab=n=>p.getByRole('tab',{name:new RegExp('^'+n+'$','i')}).first().click();
    const instrument=n=>p.getByRole('radiogroup',{name:'Track instrument'}).getByRole('radio',{name:n,exact:true}).click();
    const check=async view=>{
      await p.waitForTimeout(400);
      let bad=await p.evaluate(([s,m])=>(0,eval)('('+s+')')(...m),[scan.toString(),[CONTROLS,MIN,SURFACE]]);
      const total=await p.evaluate(s=>document.querySelectorAll(s).length,CONTROLS);
      await p.screenshot({path:path.join(ROOT,'docs','touch-acceptance-'+view+'.png')});
      const surf=bad.filter(b=>b.surface);bad=bad.filter(b=>!b.surface);
      report.push([view,total,bad.length,surf.length]);
      for(const b of bad){fails++;console.log('  '+view+': '+b.id+' '+b.w+'x'+b.h+(b.small?' too small':'')+(b.covered?' covered by '+b.coverer:''));}
    };
    await tab('Song');await check('song');
    await tab('Sound');await instrument('Synth');await check('sound-synth');
    await instrument('Drum Rack');await p.waitForTimeout(600);await check('sound-drums');
    await instrument('Sampler');await p.waitForTimeout(600);await check('sound-sampler');
    await instrument('Synth');
    await tab('FX');await check('fx');
    // a full chain, with every kind of control: choices, gate steps, track picks and readouts
    for(const n of ['Resonator','Stutter','Audio gate','Chorus','Filter','Ducking']){
      if(await p.locator('.fx-cards [aria-label="Remove '+n+'"]').count())continue;
      const open=p.locator('.fx-add-open');if(await open.count())await open.click();
      const b=p.locator('[aria-label="Add '+n+'"]').first();if(await b.count())await b.click();else await p.keyboard.press('Escape');
      await p.waitForTimeout(120);}
    await check('fx-full');
    await p.locator('.fx-cards').evaluate(e=>e.scrollTop=e.scrollHeight);await check('fx-full-end');
    await tab('Link');await check('link');
    await p.locator('.lp-morph-tile').click();await check('link-morph');await p.locator('.lp-morph-tile').click();
    await tab('Perform');await check('perform');
  }finally{await app.close();}
  for(const [v,t,b,sf] of report)console.log((b?'FAIL ':'PASS ')+v.padEnd(14)+String(t).padStart(4)+' controls, '+b+' problems'+(sf?' ('+sf+' drawing-surface cells under 44 px, allowed)':''));
  if(fails){console.error('FAIL: '+fails+' touch-target problems at 1280x'+H);process.exitCode=1;}
  else console.log('PASS: every visible control is at least 44x44 and uncovered at 1280x'+H);
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
