import type {StepPattern} from './types';
export type CatalogTemplate={id:string;version:number;name:string;genre:string;kind:string;bpm:number[]|null;brief:string;device:string;tags:string[];roles:string[];pattern:StepPattern};
export type PatternCollection='existing'|'user'|'melodic'|'drums';
export function patternCollection(factory:CatalogTemplate[],patterns:Record<string,StepPattern>,collection:PatternCollection,genre:string,search:string){
 const users=Object.entries(patterns).filter(([,p])=>p.steps.some(s=>s.length)).sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true})).map(([address,pattern])=>({id:'user.'+address.replace(':','.'),version:1,name:'Slot '+address,genre:'User',kind:'User',bpm:null,brief:'Existing project bank '+address+' · original MIDI preserved',device:'any',tags:['User',address,pattern.division],roles:[],pattern} satisfies CatalogTemplate));
 const pool=collection==='user'?users:collection==='melodic'?factory.filter(p=>p.device==='synth'):collection==='drums'?factory.filter(p=>p.device==='drum_rack'):[...factory,...users];
 return pool.filter(p=>(p.device!=='drum_rack'||genre==='All'||p.genre===genre)&&(!search||[p.name,p.kind,p.genre,p.brief,...p.tags].join(' ').toLowerCase().includes(search.toLowerCase())));
}
