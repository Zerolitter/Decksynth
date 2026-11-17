// Small drawings for the Chord panel: strum order icons and a one-octave dot diagram of a chord.

const PATHS:Record<string,string[]>={
  'Up':['M8 13V3','M4 7l4-4 4 4'],
  'Down':['M8 3v10','M4 9l4 4 4-4'],
  'Alt Up':['M5 13V3','M2 6l3-3 3 3','M11 3v10','M8 10l3 3 3-3'],
  'Alt Down':['M5 3v10','M2 10l3 3 3-3','M11 13V3','M8 6l3-3 3 3'],
  'Up-Down':['M4 13V4','M1.5 6.5 4 4l2.5 2.5','M12 3v9','M9.5 9.5 12 12l2.5-2.5','M6.5 8h3'],
};

export function StrumIcon({order,size=18}:{order:string;size?:number}){
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {(PATHS[order]??PATHS.Up).map((d,i)=><path key={i} d={d}/>)}</svg>;
}

// White keys sit at x = 5 + i*10; black keys between them. Each chord tone (by pitch class) gets a dot, the root a bigger one.
const WHITE=[0,2,4,5,7,9,11];
const BLACK:Record<number,number>={1:10,3:20,6:40,8:50,10:60};

export function ChordDots({notes}:{notes:number[]}){
  const pcs=new Set(notes.map(n=>((n%12)+12)%12));
  const root=notes.length?((notes[0]%12)+12)%12:-1;
  return <svg className="cb-dots" viewBox="0 0 70 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    {WHITE.map((pc,i)=><rect key={'w'+pc} className="cb-dot-key" x={1+i*10} y={1} width={8} height={22} rx={2}/>)}
    {Object.entries(BLACK).map(([pc,x])=><rect key={'b'+pc} className="cb-dot-key black" x={x-3} y={1} width={6} height={12} rx={1.5}/>)}
    {WHITE.map((pc,i)=>pcs.has(pc)?<circle key={'dw'+pc} className={pc===root?'root':''} cx={5+i*10} cy={17.5} r={pc===root?3.4:2.8}/>:null)}
    {Object.entries(BLACK).map(([pc,x])=>pcs.has(+pc)?<circle key={'db'+pc} className={+pc===root?'root':''} cx={x} cy={7.5} r={+pc===root?2.8:2.4}/>:null)}
  </svg>;
}
