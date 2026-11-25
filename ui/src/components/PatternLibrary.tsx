import {useEffect,useMemo,useRef,useState,type CSSProperties} from 'react';import {createPortal} from 'react-dom';
import {ArrowLeft,ArrowRight,ChevronLeft,ChevronRight,Copy,ListOrdered,Play,Plus,Search,Square,Trash2,Undo2,X} from 'lucide-react';
import library from '../genre-library.json';import type {DeckUpdate,PerformanceState,StepPattern,Track} from '../types';import {useContextTarget} from './ContextWheel';
import {COLLECTIONS,FX_ROLES,crossDeviceNote,patternCollection,collectionGenres,type CatalogTemplate,type FxRole,type PatternCollection} from '../pattern-collections';
import {useClockValue} from '../frame-clock';
import {chainPosition,flattenParts,structureBars,structureParts,MAX_PLAYS,type StructurePart} from '../structure';
import {matches} from '../hotkeys';

/* Pattern library: a sheet that drops under the top bar and hugs its cards (like the Sound presets), so the
   Seq page stays in view below it; a press down there closes it. 15 cards a page (5 x 3). The Structure strip
   at its foot puts patterns in play order, each with a repeat count (the seq chain), like My chords on Chords. */
let copiedTemplateId:string|null=null;
const templates=library.templates as CatalogTemplate[];
type FactoryStructure={id:string;name:string;genre:string;device:string;brief:string;parts:[string,number][]};
const factoryStructures=((library as unknown as {structures?:FactoryStructure[]}).structures??[]);
const PER_PAGE=15;
/** A loaded pattern keeps its rhythm (a Drum Rack may move its pitches), so the rhythm finds its library name again. */
const shape=(p:StepPattern)=>p.length+'/'+p.steps.map(s=>s.length).join('');
const BY_SHAPE=new Map(templates.map(t=>[shape(t.pattern),t] as const).reverse());
const CATEGORY_LABEL:Record<string,string>={bass:'Bass',melodie:'Melodie',arp:'Arp',chords:'Chords',effects:'Effects',drums:'Drums'};
type Tab=PatternCollection|'structures';
const TABS:[Tab,string][]=[...COLLECTIONS,['structures','Structures']];
type Props={trackIndex:number;track:Track;pattern:StepPattern;patterns:Record<string,StepPattern>;seq:PerformanceState['seq'];playing:boolean;recording:boolean;status:DeckUpdate['pattern_library'];send:(command:string,args?:unknown)=>void;close:()=>void};
type Focus={zone:'grid'}|{zone:'part';index:number};

/** The pattern's real notes, drawn as a tiny piano roll (pitch up, ties as length). */
function Notes({p}:{p:StepPattern}){
  const notes=p.steps.flatMap((s,i)=>s.map(n=>({i,note:n.note,tie:n.tie,vel:n.velocity})));
  if(!notes.length)return <svg className="plib-notes" aria-hidden="true"/>;
  const lo=Math.min(...notes.map(n=>n.note)),hi=Math.max(...notes.map(n=>n.note)),span=Math.max(6,hi-lo);
  return <svg className="plib-notes" viewBox={'0 0 '+p.length*4+' 26'} preserveAspectRatio="none" aria-label={notes.length+' notes over '+p.length+' steps'}>
    {notes.map((n,k)=><rect key={k} x={n.i*4} y={22-(n.note-lo)/span*20} width={Math.max(2.4,n.tie*4-1)} height="3.2" rx=".6" fill="currentColor" opacity={.45+.55*n.vel/127}/>)}
  </svg>;
}

export function PatternLibrary({trackIndex,track,pattern,patterns,seq,playing,recording,status,send,close}:Props){
 const device=(track.device==='drum_rack'?'drum_rack':'synth') as 'synth'|'drum_rack';
 const bank=seq.bank,slot=seq.slot;
 const [tab,setTab]=useState<Tab>(()=>copiedTemplateId?.startsWith('user.')?'user':copiedTemplateId?'all':device==='drum_rack'?'drums':'all');
 const [genre,setGenre]=useState('All'),[role,setRole]=useState<FxRole|'all'>('all'),[search,setSearch]=useState(''),[page,setPage]=useState(0);
 const [selected,setSelected]=useState<string|null>(copiedTemplateId),[replace,setReplace]=useState<CatalogTemplate|null>(null),[copied,setCopied]=useState('');
 const [focus,setFocus]=useState<Focus>({zone:'grid'}),[history,setHistory]=useState<{chain:string[];on:boolean}[]>([]),[drag,setDrag]=useState<{from:number;to:number}|null>(null);
 const sheet=useRef<HTMLElement>(null),searchBox=useRef<HTMLInputElement>(null);
 const target={kind:'pattern',track:trackIndex,bank,slot,device:track.device??'synth',kit:track.drum_rack??null};
 const owner=trackIndex+':'+(track.device??'synth'),initialOwner=useRef(owner);
 useEffect(()=>{if(initialOwner.current!==owner)close();},[owner]);
 const signature=JSON.stringify([trackIndex,bank,slot,track.device,track.drum_rack,pattern,recording]);
 const dispatch=(action:string,p?:CatalogTemplate)=>send('catalog_action',[p?.id.startsWith('user.')&&action!=='stop'?action+'_user':action,target,pattern,p?.id??'',...(p?.id.startsWith('user.')?[p.pattern]:[])]);
 useEffect(()=>()=>send('catalog_action',['stop',null,null,'']),[]);
 useEffect(()=>{setReplace(null);},[signature]);

 /* ---------- what the grid shows ---------- */
 const all=useMemo(()=>patternCollection(templates,patterns,'all'),[patterns]);
 const users=all.filter(p=>p.device==='any');
 const isStructures=tab==='structures';
 const genres=isStructures?['All',...new Set(factoryStructures.map(s=>s.genre))]:collectionGenres(templates,tab);
 const filtered=isStructures?[]:patternCollection(templates,patterns,tab,{genre,role},search);
 const structureList=isStructures?factoryStructures.filter(s=>(genre==='All'||s.genre===genre)&&(!search||(s.name+' '+s.brief+' '+s.genre).toLowerCase().includes(search.toLowerCase()))):[];
 const count=isStructures?structureList.length:filtered.length,pages=Math.max(1,Math.ceil(count/PER_PAGE)),pg=Math.min(page,pages-1);
 const visible=filtered.slice(pg*PER_PAGE,pg*PER_PAGE+PER_PAGE),visibleStructures=structureList.slice(pg*PER_PAGE,pg*PER_PAGE+PER_PAGE);
 const item=all.find(p=>p.id===selected),chosenStructure=factoryStructures.find(s=>s.id===selected);
 const nameOf=(key:string)=>{const p=patterns[key];if(!p||!p.steps.some(s=>s.length))return 'Empty';return BY_SHAPE.get(shape(p))?.name??'Pattern '+key.replace(':','·');};

 const reason=()=>recording?'Finish the take to preview or load':'';
 const missing=(p:CatalogTemplate)=>p.device==='drum_rack'&&device==='drum_rack'?p.roles.filter(r=>!status?.ready[r]):[];
 const load=(p:CatalogTemplate)=>{if(reason())return;if(pattern.steps.some(s=>s.length)){setSelected(p.id);setReplace(structuredClone(p));}else dispatch('load',p);};
 const preview=(p:CatalogTemplate)=>{setSelected(p.id);setReplace(null);setFocus({zone:'grid'});if(!reason()&&!track.mute)dispatch('preview',p);else dispatch('stop');};
 const addToStructure=(p:CatalogTemplate,repeats=1)=>{if(reason())return;remember();send('structure_add',[target,pattern,p.id,p.device==='any'?p.pattern:null,repeats]);};
 const loadStructure=(s:FactoryStructure)=>{if(reason())return;dispatch('stop');remember();send('structure_load',[target,pattern,s.id]);};
 const context=useContextTarget(el=>{const tile=el.closest<HTMLElement>('[data-template]'),p=all.find(t=>t.id===tile?.dataset.template);if(!p)return null;const why=reason();return {kind:'library.pattern',label:p.name,caps:{...(!why?{...(!track.mute?{preview:()=>preview(p)}:{}),load:()=>load(p)}:{}),details:()=>setSelected(p.id),copy:()=>{copiedTemplateId=p.id;setCopied(p.id);setSelected(p.id);}}};});
 const chooseTab=(v:Tab)=>{dispatch('stop');setTab(v);setGenre('All');setRole('all');setPage(0);setSelected(null);setReplace(null);setFocus({zone:'grid'});};
 const refilter=(f:()=>void)=>{dispatch('stop');f();setPage(0);setSelected(null);setReplace(null);};

 /* ---------- the Structure (seq chain as parts) ---------- */
 // Play in order off with only the open slot in the chain is the untouched default: no structure yet.
 const untouched=!seq.chain_enabled&&seq.chain.length===1&&seq.chain[0]===bank+':'+slot;
 const parts=useMemo(()=>untouched?[]:structureParts(seq.chain),[seq.chain,untouched]);
 const fallback={length:seq.length,division:seq.division};
 const now=useClockValue(p=>playing&&seq.enabled&&seq.chain_enabled?chainPosition(p.absoluteBeat,seq.chain,patterns,fallback)?.part??-1:-1);
 const bars=structureBars(seq.chain,patterns,fallback);
 const remember=()=>setHistory(h=>[...h.slice(-29),{chain:[...seq.chain],on:seq.chain_enabled}]);
 const setStructure=(next:StructurePart[],on=seq.chain_enabled,keep=true)=>{if(keep)remember();send('structure_set',[flattenParts(next),on&&next.length>0]);};
 const selectedPart=focus.zone==='part'&&focus.index<parts.length?focus.index:-1;
 const editPart=(i:number,f:(p:StructurePart[])=>StructurePart[],nextFocus?:number)=>{if(i<0||i>=parts.length)return;setStructure(f(parts.map(p=>({...p}))));if(nextFocus!==undefined)setFocus(nextFocus<0?{zone:'grid'}:{zone:'part',index:nextFocus});};
 const removePart=(i:number)=>editPart(i,p=>{p.splice(i,1);return p;},parts.length>1?Math.min(i,parts.length-2):-1);
 const movePart=(i:number,to:number)=>{if(to<0||to>=parts.length||to===i)return;editPart(i,p=>{const [m]=p.splice(i,1);p.splice(to,0,m);return p;},to);};
 const setRepeats=(i:number,n:number)=>{const total=parts.reduce((a,p,k)=>a+(k===i?0:p.repeats),0);const r=Math.max(1,Math.min(16,n,MAX_PLAYS-total));if(parts[i]&&r!==parts[i].repeats)editPart(i,p=>{p[i].repeats=r;return p;});};
 const duplicatePart=(i:number)=>{if(seq.chain.length+(parts[i]?.repeats??0)>MAX_PLAYS)return;editPart(i,p=>{p.splice(i+1,0,{...p[i]});return p;},i+1);};
 // Half or double the part's pattern (as a copy in an empty slot); a half part makes a short lift before the verse.
 const resizePart=(i:number,factor:.5|2)=>{const p=parts[i];if(!p||recording)return;remember();send('structure_part_length',[parts.slice(0,i).reduce((n,x)=>n+x.repeats,0),p.repeats,factor]);};
 const undo=()=>{const last=history[history.length-1];if(!last)return;setHistory(h=>h.slice(0,-1));send('structure_set',[last.chain,last.on]);};
 const clearAll=()=>{setStructure([],false);setFocus({zone:'grid'});};

 /* ---------- closing (rule 14): a press outside, Esc, the X ---------- */
 useEffect(()=>{
  const down=(e:PointerEvent)=>{const t=e.target as Element;if(sheet.current?.contains(t)||t.closest?.('.pf-lib-btn,.context-wheel,[role=menu]'))return;close();};
  document.addEventListener('pointerdown',down,true);return()=>document.removeEventListener('pointerdown',down,true);
 },[close]);

 /* ---------- keyboard: works wherever the pointer is, while the sheet is open ---------- */
 const keys=useRef<(e:KeyboardEvent)=>boolean>(()=>false);
 keys.current=e=>{
  const typing=(e.target as HTMLElement)?.matches?.('input,textarea'),ctrl=e.ctrlKey||e.metaKey,k=e.key;
  if(k==='Escape'){if(replace)setReplace(null);else if(typing&&search){setSearch('');}else close();return true;}
  if(typing)return k==='Enter'?(searchBox.current?.blur(),true):false;
  if(matches(e,'transport.undo')&&k!=='F10'){undo();return true;}
  if(matches(e,'library.search')){searchBox.current?.focus();return true;}
  if(selectedPart>=0){
   const i=selectedPart;
   if(matches(e,'library.remove')){removePart(i);return true;}
   if(k==='ArrowLeft'||k==='ArrowRight'){const d=k==='ArrowLeft'?-1:1;if(e.altKey||ctrl)movePart(i,i+d);else setFocus({zone:'part',index:Math.max(0,Math.min(parts.length-1,i+d))});return true;}
   if(/^[1-9]$/.test(k)){setRepeats(i,Number(k));return true;}
   if(k==='+'||k==='='){setRepeats(i,parts[i].repeats+1);return true;}
   if(k==='-'){setRepeats(i,parts[i].repeats-1);return true;}
   if(matches(e,'library.duplicate')){duplicatePart(i);return true;}
   if(k==='ArrowUp'){setFocus({zone:'grid'});return true;}
   if(k==='Home'){setFocus({zone:'part',index:0});return true;}
   if(k==='End'){setFocus({zone:'part',index:parts.length-1});return true;}
   return false;
  }
  // grid
  const list=isStructures?visibleStructures.map(s=>s.id):visible.map(p=>p.id),at=selected?list.indexOf(selected):-1;
  const pick=(i:number)=>{if(i<0&&pg>0){setPage(pg-1);setSelected(null);return;}if(i>=list.length&&pg+1<pages){setPage(pg+1);setSelected(null);return;}
   const id=list[Math.max(0,Math.min(list.length-1,i))];if(id){setSelected(id);setReplace(null);}};
  if(k==='ArrowRight'){pick(at+1);return true;}if(k==='ArrowLeft'){pick(at<0?0:at-1);return true;}
  if(k==='ArrowDown'){if(at<0)pick(0);else if(at+5>=list.length&&parts.length)setFocus({zone:'part',index:Math.max(0,now)});else pick(at+5);return true;}
  if(k==='ArrowUp'){pick(at<0?0:at-5);return true;}
  if(k==='PageDown'){if(pg+1<pages){setPage(pg+1);setSelected(null);}return true;}if(k==='PageUp'){if(pg>0){setPage(pg-1);setSelected(null);}return true;}
  if(chosenStructure){if(matches(e,'library.load')){loadStructure(chosenStructure);return true;}return false;}
  if(!item)return false;
  if(matches(e,'library.hear')){status?.preview?.id===item.id?dispatch('stop'):preview(item);return true;}
  if(matches(e,'library.add')){addToStructure(item);return true;}
  if(matches(e,'library.load')){load(item);return true;}
  if(matches(e,'library.remove')){setSelected(null);dispatch('stop');return true;}
  return false;
 };
 useEffect(()=>{const on=(e:KeyboardEvent)=>{if(keys.current(e)){e.preventDefault();e.stopImmediatePropagation();}};
  window.addEventListener('keydown',on,true);return()=>window.removeEventListener('keydown',on,true);},[]);

 /* ---------- drag a part to reorder (mouse and touch) ---------- */
 const partDown=(e:React.PointerEvent,i:number)=>{if(e.button!==0)return;const x0=e.clientX;let moved=false;
  const over=(x:number,y:number)=>{const el=document.elementFromPoint(x,y)?.closest<HTMLElement>('[data-part]');return el?Number(el.dataset.part):-1;};
  const move=(m:PointerEvent)=>{if(!moved&&Math.abs(m.clientX-x0)<8)return;moved=true;const to=over(m.clientX,m.clientY);setDrag({from:i,to:to<0?i:to});};
  const up=(m:PointerEvent)=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);
   setDrag(null);if(moved&&m.type==='pointerup'){const to=over(m.clientX,m.clientY);if(to>=0)movePart(i,to);}};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);};

 const status1=item?(reason()||(missing(item).length?'Loads anyway · silent until filled or unmuted: '+missing(item).join(', '):'')||(track.mute?'Track muted · unmute to preview':item.device==='any'?'Plays through the current instrument':crossDeviceNote(item,device)||'')):'';
 const previewing=!!item&&status?.preview?.id===item.id;
 const meta=(p:CatalogTemplate)=>p.device==='any'?'User slot':p.category==='effects'?(p.device==='drum_rack'?'Drums':'Synth')+' · '+p.kind:(p.genre&&!['Existing','Classic','Effects'].includes(p.genre)?p.genre+' · ':'')+(p.tags[0]==='Song part'?p.kind:CATEGORY_LABEL[p.category??'melodie']);
 const cat=(c?:string)=>({'--cat':'var(--c-pat-'+(c??'user')+')'}) as CSSProperties;

 return createPortal(<section ref={sheet} role="dialog" aria-label="Pattern library" className="plib">
  <header className="plib-head">
   <div className="plib-tabs" role="tablist" aria-label="Pattern collection">{TABS.map(([id,label])=><button type="button" role="tab" aria-selected={id===tab} key={id} style={cat(id==='all'?'all':id==='structures'?'structure':id)} onClick={()=>chooseTab(id)}>{id==='structures'?<ListOrdered size={14}/>:null}{label}{id==='user'&&users.length?<small>{users.length}</small>:null}</button>)}</div>
   <label className="plib-search"><Search size={14}/><input ref={searchBox} type="search" aria-label="Search patterns" placeholder="Search" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></label>
   <span className="plib-count">{count}</span>
   <button type="button" className="plib-icon" aria-label="Previous library page" disabled={!pg} onClick={()=>setPage(pg-1)}><ChevronLeft size={16}/></button>
   <span className="plib-page">{pg+1}/{pages}</span>
   <button type="button" className="plib-icon" aria-label="Next library page" disabled={pg+1>=pages} onClick={()=>setPage(pg+1)}><ChevronRight size={16}/></button>
   <button type="button" className="plib-icon plib-close" aria-label="Done" title="Close (Esc, or press anywhere below)" onClick={close}><X size={17}/></button>
  </header>
  {genres.length>2||tab==='effects'?<div className="plib-facets" role="group" aria-label="Filter">
   {tab==='effects'?FX_ROLES.map(([r,label])=><button type="button" aria-pressed={r===role} key={r} onClick={()=>refilter(()=>setRole(r))}>{label}</button>)
    :genres.map(g=><button type="button" aria-pressed={g===genre} key={g} onClick={()=>refilter(()=>setGenre(g))}>{g}</button>)}
  </div>:null}

  {isStructures?<div className="plib-grid">{visibleStructures.map(s=>{const plays=s.parts.reduce((a,[,n])=>a+n,0);
   return <button type="button" key={s.id} className={'plib-card plib-structure-card'+(s.id===selected?' selected':'')} aria-pressed={s.id===selected} style={cat(s.device==='drum_rack'?'drums':s.id.includes('.bass.')?'bass':'chords')}
    onClick={()=>{setSelected(s.id);setFocus({zone:'grid'});}} onDoubleClick={()=>loadStructure(s)}>
    <strong>{s.name}</strong>
    <span className="plib-parts-preview">{s.parts.map(([id,n],k)=><i key={k} style={{flexGrow:n*(templates.find(t=>t.id===id)?.pattern.length??16)}} title={templates.find(t=>t.id===id)?.kind}/>)}</span>
    <span className="plib-meta">{s.genre} · {s.device==='drum_rack'?'Drums':'Synth'} · {s.parts.length} parts · {plays} plays</span>
   </button>;})}</div>
  :<div {...context} className="plib-grid">{visible.map((p,i)=><button type="button" data-template={p.id} key={p.id} aria-pressed={p.id===selected} style={cat(p.device==='any'?'user':p.category)}
    className={'plib-card'+(p.id===selected?' selected':'')+(status?.preview?.id===p.id?' previewing':'')} onClick={()=>preview(p)} onDoubleClick={()=>load(p)}>
    <span className="plib-title"><b>{p.device==='any'?p.tags[1].replace(':','·'):String(pg*PER_PAGE+i+1).padStart(2,'0')}</b><strong>{p.name}</strong></span>
    <Notes p={p.pattern}/>
    <span className="plib-meta">{meta(p)}<em>{p.pattern.length} st</em></span>
   </button>)}</div>}
  {!count?<p className="plib-empty">{tab==='user'?'No user patterns yet. Record or draw one on a pad, and it shows up here.':'Nothing matches this search.'}</p>:null}

  <div className="plib-actions" aria-live="polite">
   {chosenStructure?<><div className="plib-detail"><strong>{chosenStructure.name}</strong><span>{chosenStructure.brief}</span></div>
     <button type="button" className="plib-primary" disabled={!!reason()} onClick={()=>loadStructure(chosenStructure)}><ListOrdered size={15}/>Load structure</button></>
   :item?<><div className="plib-detail"><strong>{item.name}</strong><span>{item.brief} · {item.pattern.length} steps{copied===item.id?' · copied':''}</span>{status1?<small>{status1}</small>:null}</div>
     <button type="button" aria-label={previewing?'Stop preview':'Preview template'} disabled={!previewing&&(!!reason()||track.mute)} onClick={()=>previewing?dispatch('stop'):preview(item)}>{previewing?<Square size={13}/>:<Play size={14}/>}{previewing?'Stop':'Preview'}</button>
     {item.device==='any'?<button type="button" onClick={()=>{const [,b,s]=item.id.split('.');close();send('perform_set',['seq','bank',Number(b)]);send('perform_set',['seq','slot',Number(s)]);}}>Open slot {item.tags[1].replace(':','·')}</button>
      :<button type="button" disabled={!!reason()} onClick={()=>load(item)}>Load into {bank}·{slot}</button>}
     <button type="button" className="plib-primary" disabled={!!reason()} onClick={()=>addToStructure(item)}><Plus size={15}/>Structure</button></>
   :<span className="plib-hint">{isStructures?'A structure fills empty pattern slots and plays its parts in order.':'Click a card to hear it. Double-click loads it into '+bank+'·'+slot+'; + Structure adds it to the play order below.'}</span>}
  </div>
  {replace?<div className="plib-confirm" role="alert"><span>Replace the notes in {bank}·{slot} with {replace.name}? Undo restores them.</span><button type="button" onClick={()=>{dispatch('load',replace);setReplace(null);}}>Replace</button><button type="button" aria-label="Cancel replacement" onClick={()=>setReplace(null)}>Cancel</button></div>:null}

  <footer className="plib-structure" aria-label="Structure">
   <div className="plib-structure-head">
    <span className="plib-structure-label"><ListOrdered size={14}/>Structure</span>
    <button type="button" className={'plib-order'+(seq.chain_enabled?' on':'')} aria-pressed={seq.chain_enabled} onClick={()=>setStructure(parts,!seq.chain_enabled)} title="Play the parts one after the other, then start again">Play in order</button>
    <span className="plib-bars">{parts.length?parts.length+' part'+(parts.length===1?'':'s')+' · ':''}{parts.length?(Number.isInteger(bars)?bars:bars.toFixed(1))+' bar'+(bars===1?'':'s'):'empty'}</span>
   </div>
   <div className="plib-parts" role="listbox" aria-label="Parts in play order">
    {parts.map((p,i)=><button type="button" role="option" key={i+':'+p.key} data-part={i} aria-selected={i===selectedPart}
      className={'plib-part'+(i===selectedPart?' selected':'')+(i===now?' now':'')+(drag?.to===i&&drag.from!==i?' drop':'')+(drag?.from===i?' dragging':'')+(patterns[p.key]?'':' empty')}
      style={cat(patterns[p.key]?BY_SHAPE.get(shape(patterns[p.key]))?.category??'user':'user')}
      onPointerDown={e=>partDown(e,i)} onClick={()=>setFocus({zone:'part',index:i})}
      onWheel={e=>{if(i===selectedPart){e.preventDefault();setRepeats(i,p.repeats+(e.deltaY<0?1:-1));}}}>
      <b>{i+1}</b><strong>{nameOf(p.key)}</strong><small>{p.key.replace(':','·')}</small><em>×{p.repeats}</em>
    </button>)}
    {!parts.length?<span className="plib-hint">Add patterns with + Structure, or load one from Structures.</span>:null}
   </div>
   <div className="plib-part-tools" role="group" aria-label="Selected part">
    {selectedPart>=0?<>
     <button type="button" className="plib-icon" aria-label="Move part earlier" disabled={!selectedPart} onClick={()=>movePart(selectedPart,selectedPart-1)}><ArrowLeft size={15}/></button>
     <button type="button" className="plib-icon" aria-label="Move part later" disabled={selectedPart>=parts.length-1} onClick={()=>movePart(selectedPart,selectedPart+1)}><ArrowRight size={15}/></button>
     <span className="plib-repeats" role="radiogroup" aria-label="Plays">{[1,2,4,8].map(n=><button type="button" role="radio" key={n} aria-checked={parts[selectedPart].repeats===n} onClick={()=>setRepeats(selectedPart,n)}>×{n}</button>)}</span>
     <button type="button" className="plib-text plib-len" aria-label="Half length" title="Keep the first half of this part (a short lift before the verse). Makes a copy; the original stays." onClick={()=>resizePart(selectedPart,.5)}>½ len</button>
     <button type="button" className="plib-text plib-len" aria-label="Double length" title="Play this part twice in one pattern (double length). Makes a copy; the original stays." onClick={()=>resizePart(selectedPart,2)}>2× len</button>
     <button type="button" className="plib-icon" aria-label="Duplicate part" onClick={()=>duplicatePart(selectedPart)}><Copy size={14}/></button>
     <button type="button" className="plib-icon danger" aria-label="Remove part" onClick={()=>removePart(selectedPart)}><Trash2 size={14}/></button>
    </>:parts.length?<button type="button" className="plib-text danger" onClick={clearAll}>Clear structure</button>:null}
    {history.length?<button type="button" className="plib-icon" aria-label="Undo structure change" title="Undo (Ctrl+Z)" onClick={undo}><Undo2 size={15}/></button>:null}
   </div>
   <div className="plib-send" role="group" aria-label="Use the Structure">
    <button type="button" className="plib-text" disabled={!parts.length||recording} onClick={()=>send('structure_merge')}
     title="Merge every part, in order and with its repeats, into one long pattern in an empty slot. The sequencer grows to fit.">To pattern</button>
    <button type="button" className="plib-text plib-primary" disabled={!parts.length||recording} onClick={()=>send('structure_extend')}
     title="Write the whole Structure onto the end of the open clip, from the bar after its last note. The clip grows to fit (up to 32 bars).">Extend clip</button>
   </div>
  </footer>
 </section>,document.querySelector('.harness-shell')??document.body);
}
