export type ContextKind='seq.empty'|'seq.note'|'song.empty'|'song.note'|'chord.key'|'drum.pad'|'library.pattern'|'rack.card'|'parameter'|'track.header';
export type Capability='add'|'chord'|'paste'|'open'|'pitchUp'|'pitchDown'|'octaveUp'|'octaveDown'|'velocity'|'earlier'|'later'|'longer'|'shorter'|'quantize'|'duplicate'|'delete'|'copy'|'selectAll'|'play'|'invert'|'spread'|'chordType'|'saveChord'|'import'|'relink'|'level'|'mute'|'solo'|'kit'|'preview'|'load'|'details'|'library'|'fold'|'pin'|'previous'|'next'|'bypass'|'value'|'reset'|'automation'|'modulation'|'midi'|'focus'|'synth'|'drums'|'presets'|'song'|'sound'|'fx'|'perform';
export type Capabilities=Partial<Record<Capability,()=>void>>;
export type ContextAction={id:string;title:string;run?:()=>void;children?:ContextAction[]};
const titles:Record<Capability,string>={add:'Add note',chord:'Add chord',paste:'Paste notes',open:'Open editor',pitchUp:'Pitch +1',pitchDown:'Pitch −1',octaveUp:'Octave +1',octaveDown:'Octave −1',velocity:'Accent velocity',earlier:'Earlier',later:'Later',longer:'Longer',shorter:'Shorter',quantize:'Quantize',duplicate:'Duplicate',delete:'Delete notes',copy:'Copy notes',selectAll:'Select all',play:'Audition',invert:'Invert voicing',spread:'Spread voices',chordType:'Chord type',saveChord:'Save chord',import:'Import WAV',relink:'Relink WAV',level:'Edit level',mute:'Toggle mute',solo:'Toggle solo',kit:'Kit browser',preview:'Preview',load:'Load slot',details:'Details',library:'Library',fold:'Fold / unfold',pin:'Pin / unpin',previous:'Previous card',next:'Next card',bypass:'Toggle bypass',value:'Edit value',reset:'Reset default',automation:'Automation',modulation:'Modulation',midi:'MIDI Learn',focus:'Focus track',synth:'Synth',drums:'Drum Rack',presets:'Presets / kits',song:'Song',sound:'Sound',fx:'FX',perform:'Perform'};
type Entry=Capability|{id:string;title:string;items:Capability[]};
const group=(id:string,title:string,items:Capability[]):Entry=>({id,title,items});
const navigation=group('navigation','Navigate',['song','sound','fx','perform','library']);
const note:Entry[]=[group('note','Note',['pitchUp','pitchDown','octaveUp','octaveDown','velocity']),group('timing','Timing',['earlier','later','longer','shorter','quantize']),'duplicate',group('edit','Edit',['delete','copy','paste','selectAll','open']),navigation];
const kinds:Record<ContextKind,Entry[]>={
 'seq.empty':['add','chord','paste','open',navigation], 'seq.note':note,'song.note':note,
 'song.empty':['open','paste','focus',navigation],
 'chord.key':['play',group('voicing','Voicing',['invert','spread']),'chordType','saveChord',navigation],
 'drum.pad':['play',group('pad','Pad sound',['open','import','relink','level']),group('mix','Mute / solo',['mute','solo']),'kit',navigation],
 'library.pattern':['preview','load','details','copy','library'],
 'rack.card':['open',group('layout','Fold / pin',['fold','pin']),group('rack','Navigate rack',['previous','next']),'bypass',navigation],
 'parameter':['value','reset','automation','modulation',group('control','Control',['open','midi'])],
 'track.header':['focus',group('instrument','Instrument',['synth','drums']),'presets',group('track','Track',['mute']),navigation]
};
export function contextActions(kind:ContextKind,caps:Capabilities):ContextAction[]{
 const leaf=(id:Capability):ContextAction|null=>caps[id]?{id,title:titles[id],run:caps[id]}:null;
 return kinds[kind].flatMap(e=>{if(typeof e==='string'){const a=leaf(e);return a?[a]:[];}const children=e.items.flatMap(id=>{const a=leaf(id);return a?[a]:[];});return children.length?[{id:e.id,title:e.title,children}]:[];});
}
export function wheelPosition(x:number,y:number,w:number,h:number){return {x:Math.max(164,Math.min(w-164,x)),y:Math.max(198,Math.min(h-208,y))};}
export function sectorAt(x:number,y:number,c:{x:number;y:number},count:number){const dx=x-c.x,dy=y-c.y,r=Math.hypot(dx,dy);if(r<32||r>100.01||!count)return -1;return Math.floor(((Math.atan2(dy,dx)*180/Math.PI+450)%360)/360*count);}
export function wheelHit(x:number,y:number,c:{x:number;y:number},roots:number,children:number,branch:number){
 const r=Math.hypot(x-c.x,y-c.y);if(r<=100)return sectorAt(x,y,c,roots);if(r<104||r>152||!children)return -1;
 const angle=Math.atan2(y-c.y,x-c.x),step=Math.min(Math.PI/3,2*Math.PI/children),origin=-Math.PI/2+(branch+.5)*2*Math.PI/roots-(children-1)*step/2;
 for(let i=0;i<children;i++){const delta=Math.atan2(Math.sin(angle-origin-i*step),Math.cos(angle-origin-i*step));if(Math.abs(delta)<=step/2)return roots+i;}return -1;
}
