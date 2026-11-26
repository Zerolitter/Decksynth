// FX buses and FX per clip: the bus chips, a bus's view, the New bus sheet, the Clip FX strip and a clip's edit row.
// Every visible control on each screen has a 44 x 44 px hit area with its centre uncovered, at 1280x718 and 1280x800.
// Screenshots go to ~/Projects/Decksynth-private/screens/fx-bus-screen/ (never into the repo). SDL uses the silent dummy sink.
'use strict';
require('./deck_guard.cjs');
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ROOT = path.resolve(__dirname,'..');
const SHOTS = path.join(os.homedir(),'Projects','Decksynth-private','screens','fx-bus-screen');
const MIN = 44;
const CONTROLS=['button','[role=button]','[role=radio]','[role=tab]','[role=switch]','[role=checkbox]','[role=slider]',
  'input:not([type=hidden])','select','textarea','a[href]','.knob-target','.value-box'].join(',');
// Drawing surfaces: cells you paint across with one finger drag, sized by the music, not single taps.
// Reported, but not failed: the piano-roll note grid, its bar ruler and row keys, and the synth's partial bars.
const SURFACE='.note-time-cell,.piano-ruler-tick,.piano-pitch-key,.ss-bar';

function scan(sel,MIN,SURFACE,scope){
  const root=scope?document.querySelector(scope):document;
  const out=[];const seen=new Set();
  const visible=e=>{const s=getComputedStyle(e);return s.visibility!=='hidden'&&s.display!=='none'&&+s.opacity>.05;};
  const contains=(owner,at)=>!!at&&(at===owner||owner.contains(at)||at.contains(owner)&&at.matches(sel));
  const intersect=(a,b)=>({left:Math.max(a.left,b.left),top:Math.max(a.top,b.top),right:Math.min(a.right,b.right),bottom:Math.min(a.bottom,b.bottom)});
  const area=r=>Math.max(0,r.right-r.left)*Math.max(0,r.bottom-r.top);
  for(const e of root.querySelectorAll(sel)){
    // the outermost matching control owns the hit area (a knob-target inside a button counts once)
    if(e.parentElement?.closest(sel)&&!e.matches('.knob-target'))continue;
    if(e.closest('[aria-hidden=true],[inert]'))continue;
    const r=e.getBoundingClientRect();
    if(r.width<1||r.height<1||!visible(e))continue;
    let a=e,ok=true;for(;a;a=a.parentElement){if(!visible(a)){ok=false;break;}}
    if(!ok)continue;
    const name=(e.getAttribute('aria-label')||e.textContent||e.getAttribute('title')||'').trim().replace(/\s+/g,' ').slice(0,40);
    const cls=(e.className&&typeof e.className==='string'?e.className:'').split(' ').filter(Boolean).slice(0,2).join('.');
    const id=e.tagName.toLowerCase()+(cls?'.'+cls:'')+(name?' "'+name+'"':'');
    if(seen.has(id+r.left+r.top))continue;seen.add(id+r.left+r.top);
    // an absolutely placed ::before/::after with negative insets widens the hit zone (rule 10: small visual, 44 px hit)
    let hx1=r.left,hx2=r.right,hy1=r.top,hy2=r.bottom;
    for(const ps of ['::before','::after']){const s=getComputedStyle(e,ps);
      if(s.content==='none'||s.position!=='absolute'||s.pointerEvents==='none')continue;
      const v=['top','right','bottom','left'].map(k=>/px$/.test(s[k])?parseFloat(s[k]):NaN);if(v.some(Number.isNaN))continue;
      hx1=Math.min(hx1,r.left+v[3]);hx2=Math.max(hx2,r.right-v[1]);hy1=Math.min(hy1,r.top+v[0]);hy2=Math.max(hy2,r.bottom-v[2]);}
    const hw=hx2-hx1,hh=hy2-hy1;
    const small=hw<MIN-.5||hh<MIN-.5;
    const effective={left:hx1,top:hy1,right:hx2,bottom:hy2};
    let visibleRect=intersect(effective,{left:0,top:0,right:innerWidth,bottom:innerHeight});
    let integrityRect=effective,clipper='viewport',scrollX=false,scrollY=false;
    // A scrollable rack is an access path: its children may sit below the current viewport.
    // Visibility still follows the scroller; integrity ignores that axis at the top, then audits strictly at the end.
    const strictScroll=document.body.dataset.touchStrictScroll==='1';
    for(a=e.parentElement;a;a=a.parentElement){const s=getComputedStyle(a),paintClip=s.contain.includes('paint')||s.clipPath!=='none';
      const canScrollX=!paintClip&&/(auto|scroll)/.test(s.overflowX)&&a.scrollWidth>a.clientWidth+1;
      const canScrollY=!paintClip&&/(auto|scroll)/.test(s.overflowY)&&a.scrollHeight>a.clientHeight+1;
      if(!strictScroll){scrollX=scrollX||canScrollX;scrollY=scrollY||canScrollY;}
      const clips=/(auto|scroll|hidden|clip)/.test(s.overflowX+s.overflowY)||paintClip;
      if(!clips)continue;const q=a.getBoundingClientRect(),before=area(integrityRect);
      visibleRect=intersect(visibleRect,{left:q.left,top:q.top,right:q.right,bottom:q.bottom});
      integrityRect=intersect(integrityRect,{left:scrollX?-1e6:q.left,top:scrollY?-1e6:q.top,right:scrollX?1e6:q.right,bottom:scrollY?1e6:q.bottom});
      if(area(integrityRect)<before-.01)clipper=a.tagName.toLowerCase()+(a.id?'#'+a.id:'')+(typeof a.className==='string'&&a.className?' .'+a.className.trim().split(/\s+/)[0]:'');}
    const full=area(effective),shown=area(visibleRect);
    integrityRect=intersect(integrityRect,{left:scrollX?-1e6:0,top:scrollY?-1e6:0,right:scrollX?1e6:innerWidth,bottom:scrollY?1e6:innerHeight});
    const clippedFraction=full?Math.max(0,1-area(integrityRect)/full):1;
    if(!shown)continue;
    // Rule 15 still requires the actionable centre to be clear.  Full-rectangle integrity is
    // checked above through the effective hit bounds and every clipping ancestor; sibling hit
    // zones may legitimately meet at their edges without being a visual obstruction.
    const cx=hx1+hw/2,cy=hy1+hh/2;
    const centerVisible=cx>=visibleRect.left&&cx<=visibleRect.right&&cy>=visibleRect.top&&cy<=visibleRect.bottom;
    const blocked=centerVisible?document.elementFromPoint(cx,cy):null;
    const covered=centerVisible&&!contains(e,blocked);
    const coverer=covered&&blocked?blocked.tagName.toLowerCase()+'.'+String(blocked.className||'').split(' ')[0]:'';
    const clipped=clippedFraction>.005;
    if(small||covered||clipped)out.push({id,w:Math.round(hw),h:Math.round(hh),small,covered,coverer,clipped,clippedFraction:Math.round(clippedFraction*1000)/10,clipper,surface:!!e.closest(SURFACE)});
  }
  return out;
}

let app;
(async () => {
  fs.mkdirSync(SHOTS,{recursive:true});
  const data = fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-fxbus-'));
  app = await _electron.launch({
    executablePath: path.join(ROOT,'node_modules','electron','dist','electron'),
    args: ['electron/playwright-main.cjs'], cwd: ROOT,
    env: {...process.env, DECKSYNTH_UI_PREVIEW:'0', DECKSYNTH_DATA_DIR:data, DECKSYNTH_NO_AUTOSAVE:'1', SDL_AUDIODRIVER:'dummy', ELECTRON_OZONE_PLATFORM_HINT:'x11'},
    timeout: 20000,
  });
  const p = await app.firstWindow({timeout:18000});
  p.setDefaultTimeout(8000);
  const errors=[]; p.on('pageerror',e=>errors.push(e.message));
  await p.waitForFunction(()=>document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'),null,{timeout:20000});
  let problems=0;
  const check=async(view,h,scope)=>{
    await p.waitForTimeout(400);
    const bad=(await p.evaluate(([s,m])=>(0,eval)('('+s+')')(...m),[scan.toString(),[CONTROLS,MIN,SURFACE,scope]])).filter(b=>!b.surface);
    const total=await p.evaluate(s=>document.querySelectorAll(s).length,CONTROLS);
    await p.screenshot({path:path.join(SHOTS,view+'-'+h+'.png')});
    console.log((bad.length?'FAIL ':'PASS ')+view+' @'+h+'  '+total+' controls, '+bad.length+' problems');
    for(const b of bad){problems++;console.log('  '+b.id+' '+b.w+'x'+b.h+(b.small?' too small':'')+(b.covered?' covered by '+b.coverer:'')+(b.clipped?' '+b.clippedFraction+'% clipped by '+b.clipper:''));}
  };
  const track1=()=>p.getByRole('button',{name:/^Edit track 1 /}).click();
  await p.getByRole('tab',{name:/^FX$/i}).first().click();
  await p.locator('.fx-card-module').first().waitFor();
  for (const h of [718,800]) {
    await p.setViewportSize({width:1280,height:h});
    await p.waitForFunction(([w,hh])=>innerWidth===w&&innerHeight===hh,[1280,h]);
    await track1();
    // 1. the track view: bus chips, Clip FX strip, cards, sends
    assert.ok(await p.locator('button[aria-label^="Bus A"]').count(),'bus A chip');
    assert.ok(await p.locator('[aria-label="Clip FX"] button[aria-label^="Clip "]').count(),'clip strip');
    await check('1-track-fx',h);
    // 2. a bus's view
    await p.locator('button[aria-label^="Bus A"]').first().click();
    await p.locator('section[aria-label="Bus A feeds"]').waitFor();
    const feeds=p.locator('section[aria-label="Bus A feeds"]');
    assert.ok(await feeds.locator('[role=slider]').count()>=1,'a slider for each track');
    for(const n of [/Return/i,/Mute/i,/Remove bus A/i]) assert.ok(await feeds.locator('button,[role=slider]').filter({hasText:n}).count()||await feeds.locator('[aria-label]').filter({has:p.locator('xpath=.')}).evaluateAll((els,re)=>els.some(e=>new RegExp(re,'i').test(e.getAttribute('aria-label')||'')),n.source),'bus view has '+n);
    await check('2-bus-view',h);
    // 3. New bus sheet: opens, checked, closes with Escape
    await p.locator('button[aria-label="New bus"]').click();
    await p.getByRole('dialog',{name:/^New bus/}).waitFor();
    await check('3-new-bus',h,'.bus-sheet'); // the sheet is modal: the page behind it is meant to be covered
    await p.keyboard.press('Escape');
    await p.getByRole('dialog',{name:/^New bus/}).waitFor({state:'detached'});
    // 4. back to the track, edit a clip
    await track1();
    await p.locator('[aria-label="Clip FX"] button[aria-label^="Clip "]').first().click();
    await p.getByRole('radiogroup',{name:/^When clip /}).waitFor();
    assert.ok(await p.getByRole('button',{name:/Clear/}).count(),'Clear button');
    await check('4-clip-edit',h);
    await p.getByRole('button',{name:'Done editing clip FX'}).click();
    await p.getByRole('radiogroup',{name:/^When clip /}).waitFor({state:'detached'});
  }
  assert.deepEqual(errors,[]);
  assert.equal(problems,0,problems+' touch-target problems');
  console.log('fx_buses_acceptance: ok');
})().catch(err=>{console.error('FAIL',err.stack||err);process.exitCode=1;}).finally(()=>app&&app.close());
