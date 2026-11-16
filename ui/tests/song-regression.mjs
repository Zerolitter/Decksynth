import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import path from 'node:path';
import {buildSync} from 'esbuild';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const require=createRequire(import.meta.url);
function component(file,name){
 const dir=path.resolve('src/components');
 const source=readFileSync(process.env.DECKSYNTH_TIMELINE_SOURCE??path.join(dir,file),'utf8');
 const code=buildSync({stdin:{contents:source,resolveDir:dir,sourcefile:file,loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external'}).outputFiles[0].text;
 const m={exports:{}};new Function('require','module','exports',code)(require,m,m.exports);return m.exports[name];
}
const Timeline=component('Timeline.tsx','Timeline');
const fixture=JSON.parse(readFileSync(new URL('../src/preview-state.json',import.meta.url)));
// Evaluate the actual first-render CSS against the lane's containing box. A
// guessed pixel height fails here before any ResizeObserver can correct it.
function topAt(style,height){
 const top=style.match(/(?:^|;)top:([^;]+)/)?.[1];
 if(top?.endsWith('px')&&!top.startsWith('calc'))return parseFloat(top);
 const terms=top?.match(/calc\(([-\d.]+)% \+ ([-\d.]+)px\)/);
 assert.ok(terms,'relative pitch position: '+top);return Number(terms[1])*height/100+Number(terms[2]);
}
for(const height of [112,132])test('Clip notes first-render geometry agrees with its '+height+'px lane, including tails',()=>{
 const project=structuredClone(fixture.state);project.bars=4;
 project.tracks.forEach(t=>t.notes=[]);
 project.tracks[3].notes=[{start:15,duration:2,note:60,velocity:100}];
 for(const playing of [false,true])for(const selected of [0,3]){
  const html=renderToStaticMarkup(React.createElement(Timeline,{project,selected,beat:2,playing,recording:false,onSelect(){},onMute(){},onEdit(){}}));
  const note=html.match(/class="clip-note" style="([^"]+)"/),tail=html.match(/class="clip-tail" style="([^"]+)"/);
  assert.ok(note);assert.ok(tail);
  const expected=height===112?83.16666666666667:99.83333333333334;
  assert.ok(Math.abs(topAt(note[1],height)-expected)<1e-6,'first note paint must use actual containing height');
  assert.ok(Math.abs(topAt(tail[1],height)-expected)<1e-6,'wrapped tail shares first-paint geometry');
 }
});

test('Clip notes identifies open A while B plays; its cursor appears only for the heard clip',()=>{
 const project=structuredClone(fixture.state);project.bars=4;
 project.tracks.forEach(t=>t.notes=[{start:0,duration:1,note:60,velocity:100}]);
 project.clips={open:[0,0,0,0],slots:project.tracks.map(()=>Array.from({length:8},()=>[]))};
 project.song={on:true,loop:true,length:17,markers:[],lanes:[[{at:2,len:8,clip:1,off:1}],[],[],[]]};
 const props={project,selected:0,beat:12.5,songBeat:12.5,playing:true,recording:false,onSelect(){},onMute(){},onEdit(){}};
 const first=renderToStaticMarkup(React.createElement(Timeline,props));
 assert.equal((first.match(/class="clip-playhead"/g)??[]).length,0,'A is open but is not what the song plays');
 assert.match(first,/A OPEN · B PLAYING/);
 project.clips.open[0]=1;
 const heard=renderToStaticMarkup(React.createElement(Timeline,props));
 assert.equal((heard.match(/class="clip-playhead"/g)??[]).length,1);
 assert.match(heard,/class="clip-playhead" style="left:53.125%"/,'B uses block offset: beat 8.5 of 16');
});
