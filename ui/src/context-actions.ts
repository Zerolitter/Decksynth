export type ContextKind='seq.empty'|'seq.note'|'song.empty'|'song.note'|'song.clip'|'chord.key'|'drum.pad'|'library.pattern'|'rack.card'|'parameter'|'track.header'|'sample.wave';
export type Capability='fillQuarter'|'fillEighth'|'fillSixteenth'|'buildChord'|'cut'|'samePitch'|'chordSelection'|'halfLength'|'doubleLength'|'repeat'|'velocitySoft'|'velocityUp'|'velocityDown'|'major'|'minor'|'add'|'chord'|'paste'|'open'|'pitchUp'|'pitchDown'|'octaveUp'|'octaveDown'|'velocity'|'earlier'|'later'|'longer'|'shorter'|'quantize'|'duplicate'|'delete'|'copy'|'selectAll'|'play'|'invert'|'spread'|'chordType'|'saveChord'|'import'|'relink'|'level'|'mute'|'solo'|'kit'|'preview'|'load'|'details'|'library'|'fold'|'pin'|'previous'|'next'|'bypass'|'value'|'reset'|'automation'|'modulation'|'midi'|'focus'|'synth'|'drums'|'presets'|'song'|'sound'|'fx'|'perform'|'zoomIn'|'zoomOut'|'zoomFit'|'split'|'join'|'clearSlices'|'addTrack'|'removeTrack'|'saveSample'|'record'|'clearPad';
export type Capabilities=Partial<Record<Capability,()=>void>>;
export type ContextAction={id:string;title:string;run?:()=>void;children?:ContextAction[];shortcut?:string;
 /** A source colour (macro / mod pad) drawn as a swatch instead of an icon; checked draws a tick in it. */
 color?:string;checked?:boolean};
const titles:Record<Capability,string>={fillQuarter:'Quarter notes',fillEighth:'Eighth notes',fillSixteenth:'Sixteenth notes',buildChord:'Build chord',cut:'Cut notes',samePitch:'Select row',chordSelection:'Chord notes',halfLength:'Half length',doubleLength:'Double length',repeat:'Repeat',velocitySoft:'Soft velocity',velocityUp:'Velocity +10',velocityDown:'Velocity −10',major:'Major triad',minor:'Minor triad',add:'Add note',chord:'Add chord',paste:'Paste notes',open:'Open editor',pitchUp:'Pitch +1',pitchDown:'Pitch −1',octaveUp:'Octave +1',octaveDown:'Octave −1',velocity:'Accent velocity',earlier:'Earlier',later:'Later',longer:'Longer',shorter:'Shorter',quantize:'Quantize',duplicate:'Duplicate',delete:'Delete notes',copy:'Copy notes',selectAll:'Select all',play:'Audition',invert:'Invert voicing',spread:'Spread voices',chordType:'Chord type',saveChord:'Save chord',import:'Import WAV',relink:'Relink WAV',level:'Edit level',mute:'Toggle mute',solo:'Toggle solo',kit:'Kit browser',preview:'Preview',load:'Load slot',details:'Details',library:'Library',fold:'Fold / unfold',pin:'Pin / unpin',previous:'Previous card',next:'Next card',bypass:'Toggle bypass',value:'Edit value',reset:'Reset default',automation:'Automation',modulation:'Modulation',midi:'MIDI Learn',focus:'Focus track',synth:'Synth',drums:'Drum Rack',presets:'Presets / kits',song:'Song',sound:'Sound',fx:'FX',perform:'Perform',zoomIn:'Zoom in',zoomOut:'Zoom out',zoomFit:'Fit whole',split:'Split here',join:'Join next',clearSlices:'Clear slices',addTrack:'Add track',removeTrack:'Remove track',saveSample:'Save to library',record:'Record into pad',clearPad:'Clear pad'};
type Entry=Capability|{id:string;title:string;items:Entry[]};
const group=(id:string,title:string,items:Entry[]):Entry=>({id,title,items});

const note:Entry[]=[
 group('note','Note',[group('transpose','Transpose',['pitchUp','pitchDown']),group('octave','Octave',['octaveUp','octaveDown']),group('velocityMenu','Velocity',['velocity','velocitySoft','velocityUp','velocityDown']),group('length','Length',['longer','shorter','halfLength','doubleLength'])]),
 group('timing','Timing',['quantize','earlier','later',group('rhythm','Rhythm',['halfLength','doubleLength','repeat'])]),
 group('selection','Selection',['chordSelection']),
 group('edit','Edit',['selectAll','samePitch','delete','duplicate','copy','cut','paste','open']),
 group('harmony','Harmony',['invert','spread',group('chordTypeMenu','Chord type',['major','minor'])])];
const shortcuts:Partial<Record<Capability,string>>={copy:'Ctrl+C',cut:'Ctrl+X',paste:'Ctrl+V',duplicate:'Ctrl+D',delete:'Del',selectAll:'Ctrl+A',samePitch:'Ctrl+Shift+A',quantize:'Q',octaveUp:'Ctrl+↑',octaveDown:'Ctrl+↓',pitchUp:'↑',pitchDown:'↓',earlier:'←',later:'→',shorter:'Shift+←',longer:'Shift+→',zoomIn:'+',zoomOut:'−',zoomFit:'F',split:'S',join:'J'};
const kinds:Record<ContextKind,Entry[]>={
 'seq.empty':[group('fill','Fill / Repeat',['fillQuarter','fillEighth','fillSixteenth']),group('edit','Edit',['selectAll','samePitch']),'paste','open'], 'seq.note':note,'song.note':note,
 'song.empty':[group('edit','Edit',['selectAll','samePitch']),'open','paste'],
 'song.clip':[group('clipTiming','Clip timing',['quantize','earlier','later']),group('clipPitch','Transpose clip',['pitchUp','pitchDown','octaveUp','octaveDown']),'duplicate','open'],
 'chord.key':['play',group('voicing','Voicing',['invert','spread']),'chordType','saveChord'],
 'drum.pad':['play',group('pad','Pad sound',['open','import','record','relink','clearPad','level']),group('mix','Mute / solo',['mute','solo']),'kit'],
 'library.pattern':['preview','load','details','copy','library'],
 'rack.card':['bypass','reset','modulation','presets'],
 'parameter':['value','reset','automation','modulation',group('control','Control',['open','midi'])],
 'track.header':[group('instrument','Instrument',['synth','drums']),'presets',group('track','Track',['mute','addTrack','removeTrack'])],
 'sample.wave':['zoomIn','zoomOut','zoomFit','split','join','play','saveSample','clearSlices']
};
export function contextActions(kind:ContextKind,caps:Capabilities):ContextAction[]{
 const entry=(e:Entry):ContextAction|null=>{if(typeof e==='string')return caps[e]?{id:e,title:titles[e],run:caps[e],shortcut:shortcuts[e]}:null;const children=e.items.map(entry).filter((a):a is ContextAction=>a!==null);return children.length?{id:e.id,title:e.title,children}:null;};
 return kinds[kind].map(entry).filter((a):a is ContextAction=>a!==null);
}
// Rendering and hit testing use exactly the same annular sectors, including gaps.
export const WHEEL={primary:288,expanded:480,center:240,dead:40,inner:140,outerStart:152,outerEnd:232,gap:.025,dwell:240};
export function wheelPosition(x:number,y:number,w:number,h:number){return {x:Math.max(252,Math.min(w-252,x)),y:Math.max(302,Math.min(h-252,y))};}
export function wheelSector(index:number,count:number,outer=false,roots=count,branch=0){
 const step=outer?Math.min(Math.PI/3,2*Math.PI/count):2*Math.PI/count;
 const origin=outer?-Math.PI/2+(branch+.5)*2*Math.PI/roots-(count-1)*step/2:-Math.PI/2+step/2;
 const angle=origin+index*step;
 return {angle,from:angle-step/2+WHEEL.gap,to:angle+step/2-WHEEL.gap,inside:outer?WHEEL.outerStart:WHEEL.dead,outside:outer?WHEEL.outerEnd:WHEEL.inner,label:outer?192:92};
}
export function sectorAt(x:number,y:number,c:{x:number;y:number},count:number){return wheelHit(x,y,c,count,0,0);}
export function wheelHit(x:number,y:number,c:{x:number;y:number},roots:number,children:number,branch:number){
 const r=Math.hypot(x-c.x,y-c.y),angle=Math.atan2(y-c.y,x-c.x);
 for(const outer of [false,true]){const count=outer?children:roots;for(let i=0;i<count;i++){const g=wheelSector(i,count,outer,roots,branch),delta=Math.atan2(Math.sin(angle-g.angle),Math.cos(angle-g.angle));if(r>=g.inside&&r<=g.outside&&Math.abs(delta)<(g.to-g.from)/2)return (outer?roots:0)+i;}}
 return -1;
}

export type ContextArea='arp'|'perform'|'song'|'sound'|'fx'|'chord'|'drum'|'library';
export function contextPresentation(kind:ContextKind,area?:ContextArea){
 const resolved=area??(kind.startsWith('song.')?'song':kind.startsWith('seq.')?'perform':kind==='chord.key'?'chord':kind==='drum.pad'?'drum':kind==='library.pattern'?'library':'sound');
 const values={arp:{label:'ARP',color:'var(--c-arp)',icon:'arp'},perform:{label:'SEQ',color:'var(--c-seq)',icon:'sequence'},song:{label:'SONG',color:'var(--c-song)',icon:'song'},sound:{label:'SOUND',color:'var(--c-sound)',icon:'sound'},fx:{label:'FX',color:'var(--c-fx)',icon:'fx'},chord:{label:'CHORD',color:'var(--c-chord)',icon:'chord'},drum:{label:'DRUM',color:'#ff76a6',icon:'drum'},library:{label:'LIBRARY',color:'var(--t-library)',icon:'library'}};
 return {...values[resolved],area:resolved};
}
