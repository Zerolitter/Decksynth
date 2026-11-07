export type ContextKind='seq.empty'|'seq.note'|'song.empty'|'song.note'|'chord.key'|'drum.pad'|'library.pattern'|'rack.card'|'parameter'|'track.header';
export type Capability='cut'|'samePitch'|'chordSelection'|'halfLength'|'doubleLength'|'repeat'|'velocitySoft'|'velocityUp'|'velocityDown'|'major'|'minor'|'add'|'chord'|'paste'|'open'|'pitchUp'|'pitchDown'|'octaveUp'|'octaveDown'|'velocity'|'earlier'|'later'|'longer'|'shorter'|'quantize'|'duplicate'|'delete'|'copy'|'selectAll'|'play'|'invert'|'spread'|'chordType'|'saveChord'|'import'|'relink'|'level'|'mute'|'solo'|'kit'|'preview'|'load'|'details'|'library'|'fold'|'pin'|'previous'|'next'|'bypass'|'value'|'reset'|'automation'|'modulation'|'midi'|'focus'|'synth'|'drums'|'presets'|'song'|'sound'|'fx'|'perform';
export type Capabilities=Partial<Record<Capability,()=>void>>;
export type ContextAction={id:string;title:string;run?:()=>void;children?:ContextAction[];shortcut?:string};
const titles:Record<Capability,string>={cut:'Cut notes',samePitch:'Same pitch',chordSelection:'Chord notes',halfLength:'Half length',doubleLength:'Double length',repeat:'Repeat',velocitySoft:'Soft velocity',velocityUp:'Velocity +10',velocityDown:'Velocity −10',major:'Major triad',minor:'Minor triad',add:'Add note',chord:'Add chord',paste:'Paste notes',open:'Open editor',pitchUp:'Pitch +1',pitchDown:'Pitch −1',octaveUp:'Octave +1',octaveDown:'Octave −1',velocity:'Accent velocity',earlier:'Earlier',later:'Later',longer:'Longer',shorter:'Shorter',quantize:'Quantize',duplicate:'Duplicate',delete:'Delete notes',copy:'Copy notes',selectAll:'Select all',play:'Audition',invert:'Invert voicing',spread:'Spread voices',chordType:'Chord type',saveChord:'Save chord',import:'Import WAV',relink:'Relink WAV',level:'Edit level',mute:'Toggle mute',solo:'Toggle solo',kit:'Kit browser',preview:'Preview',load:'Load slot',details:'Details',library:'Library',fold:'Fold / unfold',pin:'Pin / unpin',previous:'Previous card',next:'Next card',bypass:'Toggle bypass',value:'Edit value',reset:'Reset default',automation:'Automation',modulation:'Modulation',midi:'MIDI Learn',focus:'Focus track',synth:'Synth',drums:'Drum Rack',presets:'Presets / kits',song:'Song',sound:'Sound',fx:'FX',perform:'Perform'};
type Entry=Capability|{id:string;title:string;items:Entry[]};
const group=(id:string,title:string,items:Entry[]):Entry=>({id,title,items});
const navigation=group('navigation','Navigate',['song','sound','fx','perform','library']);
const note:Entry[]=[
 group('note','Note',[group('transpose','Transpose',['pitchUp','pitchDown']),group('octave','Octave',['octaveUp','octaveDown']),group('velocityMenu','Velocity',['velocity','velocitySoft','velocityUp','velocityDown']),group('length','Length',['longer','shorter','halfLength','doubleLength'])]),
 group('timing','Timing',['quantize','earlier','later',group('rhythm','Rhythm',['halfLength','doubleLength','repeat'])]),
 group('selection','Selection',['selectAll','samePitch','chordSelection']),
 group('edit','Edit',['duplicate','copy','cut','paste','delete','open']),
 group('harmony','Harmony',['invert','spread',group('chordTypeMenu','Chord type',['major','minor'])]),navigation];
const shortcuts:Partial<Record<Capability,string>>={copy:'Ctrl+C',cut:'Ctrl+X',paste:'Ctrl+V',duplicate:'Ctrl+D',delete:'Del',selectAll:'Ctrl+A',quantize:'Q',octaveUp:'Ctrl+↑',octaveDown:'Ctrl+↓',pitchUp:'↑',pitchDown:'↓',earlier:'←',later:'→',shorter:'Shift+←',longer:'Shift+→'};
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
 const entry=(e:Entry):ContextAction|null=>{if(typeof e==='string')return caps[e]?{id:e,title:titles[e],run:caps[e],shortcut:shortcuts[e]}:null;const children=e.items.map(entry).filter((a):a is ContextAction=>a!==null);return children.length?{id:e.id,title:e.title,children}:null;};
 return kinds[kind].map(entry).filter((a):a is ContextAction=>a!==null);
}
export function wheelPosition(x:number,y:number,w:number,h:number){return {x:Math.max(164,Math.min(w-164,x)),y:Math.max(198,Math.min(h-208,y))};}
export function sectorAt(x:number,y:number,c:{x:number;y:number},count:number){const dx=x-c.x,dy=y-c.y,r=Math.hypot(dx,dy);if(r<32||r>100.01||!count)return -1;return Math.floor(((Math.atan2(dy,dx)*180/Math.PI+450)%360)/360*count);}
export function wheelHit(x:number,y:number,c:{x:number;y:number},roots:number,children:number,branch:number){
 const r=Math.hypot(x-c.x,y-c.y);if(r<=100)return sectorAt(x,y,c,roots);if(r<104||r>152||!children)return -1;
 const angle=Math.atan2(y-c.y,x-c.x),step=Math.min(Math.PI/3,2*Math.PI/children),origin=-Math.PI/2+(branch+.5)*2*Math.PI/roots-(children-1)*step/2;
 for(let i=0;i<children;i++){const delta=Math.atan2(Math.sin(angle-origin-i*step),Math.cos(angle-origin-i*step));if(Math.abs(delta)<=step/2)return roots+i;}return -1;
}

export type ContextArea='arp'|'perform'|'song'|'sound'|'fx'|'chord'|'drum'|'library';
export function contextPresentation(kind:ContextKind,area?:ContextArea){
 const resolved=area??(kind.startsWith('song.')?'song':kind.startsWith('seq.')?'perform':kind==='chord.key'?'chord':kind==='drum.pad'?'drum':kind==='library.pattern'?'library':'sound');
 const values={arp:{label:'ARP',color:'var(--c-arp)',icon:'arp'},perform:{label:'SEQ',color:'var(--c-seq)',icon:'sequence'},song:{label:'SONG',color:'var(--c-song)',icon:'song'},sound:{label:'SOUND',color:'var(--c-sound)',icon:'sound'},fx:{label:'FX',color:'var(--c-fx)',icon:'fx'},chord:{label:'CHORD',color:'var(--c-chord)',icon:'chord'},drum:{label:'DRUM',color:'#ff76a6',icon:'drum'},library:{label:'LIBRARY',color:'var(--t-library)',icon:'library'}};
 return {...values[resolved],area:resolved};
}
