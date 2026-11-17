import type {StepPattern} from './types';
export type PatternCategory='bass'|'melodie'|'arp'|'chords'|'effects'|'drums';
export type FxRole='intro'|'bridge'|'tension'|'builder'|'ending';
export type CatalogTemplate={id:string;version:number;name:string;genre:string;kind:string;bpm:number[]|null;brief:string;device:string;category?:PatternCategory;fx_role?:FxRole;tags:string[];roles:string[];pattern:StepPattern};
/** Library tabs. "All" holds every pattern; the others are its sub-labels. Every pattern is MIDI, so any track can load any of them. */
export type PatternCollection='all'|PatternCategory|'user';
export const COLLECTIONS:[PatternCollection,string][]=[['all','All'],['bass','Bass'],['melodie','Melodie'],['arp','Arp'],['chords','Chords'],['effects','Effects'],['drums','Drums'],['user','User slots']];
export const MELODIE_GENRES=['All','Classic','EDM','House','Techno','Drum & Bass','Trance','Lo-fi'];
export const DRUM_GENRES=['All','EDM','House','Techno','Drum & Bass'];
export const FX_ROLES:[FxRole|'all',string][]=[['all','All'],['intro','Intro'],['bridge','Bridge'],['tension','Transition / tension'],['builder','Builder'],['ending','Ending']];
export type LibraryFilter={genre?:string;role?:FxRole|'all';device?:'synth'|'drum_rack'};

export function userTemplates(patterns:Record<string,StepPattern>):CatalogTemplate[]{
 return Object.entries(patterns).filter(([,p])=>p.steps.some(s=>s.length)).sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true}))
  .map(([address,pattern])=>({id:'user.'+address.replace(':','.'),version:1,name:'Slot '+address,genre:'User',kind:'User',bpm:null,brief:'Existing project bank '+address+' · original MIDI preserved',device:'any',tags:['User',address,pattern.division],roles:[],pattern}));
}
const inCategory=(p:CatalogTemplate,c:PatternCategory)=>p.category===c||(c==='effects'&&!!p.fx_role);

export function patternCollection(factory:CatalogTemplate[],patterns:Record<string,StepPattern>,collection:PatternCollection,filter:LibraryFilter|string={},search=''){
 const f:LibraryFilter=typeof filter==='string'?{genre:filter}:filter;
 const users=userTemplates(patterns);
 const pool=collection==='user'?users:collection==='all'?[...factory,...users]:factory.filter(p=>inCategory(p,collection));
 const genre=f.genre??'All',role=f.role??'all';
 return pool.filter(p=>(collection==='all'||collection==='user'||genre==='All'||p.genre===genre)
  &&(collection!=='effects'||((role==='all'||p.fx_role===role)&&(!f.device||p.device===f.device)))
  &&(!search||[p.name,p.kind,p.genre,p.brief,...p.tags].join(' ').toLowerCase().includes(search.toLowerCase())));
}
/** What a pattern does on this track, in words: every combination plays. */
export function crossDeviceNote(p:CatalogTemplate,device:string){
 if(p.device==='any'||p.device===device)return '';
 return device==='drum_rack'?'Melodic MIDI on the Drum Rack: plays from C2 (pad 1) up':'Drum MIDI on the synth: the drum notes play as pitches from C2';
}
/** The genre filters a tab offers: every genre its patterns carry, most used first ("All" leads). */
export function collectionGenres(factory:CatalogTemplate[],collection:PatternCollection|'structures'){
 if(collection==='all'||collection==='user'||collection==='effects'||collection==='structures')return ['All'];
 const counts=new Map<string,number>();
 for(const p of factory)if(inCategory(p,collection)&&!['Existing','Effects','User'].includes(p.genre))counts.set(p.genre,(counts.get(p.genre)??0)+1);
 return ['All',...[...counts].sort((a,b)=>b[1]-a[1]).map(([g])=>g)];
}
