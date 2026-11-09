import assert from 'node:assert/strict';
import {test} from 'node:test';
import {transportPosition,clipPlayback} from '../src/transport-clock.ts';
const sample=(patch={})=>({beat:.2,song_beat:48.2,playing:true,state:{bpm:120,bars:4,song:{on:true,loop:true,length:17,markers:[],lanes:[]}},...patch});
const near=(actual,want)=>assert.ok(Math.abs(actual-want)<1e-8,`${actual} ≈ ${want}`);

test('new native epoch cannot inherit a previous visual phase or advance to bar 17',()=>{
 const p=transportPosition(sample(),1000,980);
 near(p.absoluteBeat,48.2);near(p.songBeat,48.2);near(p.clipBeat,.2);
});
test('paired native snapshots with jitter stay in the coherent allowed interval',()=>{
 for(const bars of [1,2,4,8])for(const zoom of [8,16,32]){
  for(let i=0;i<30;i++){
   const time=1000+i*100+(i%3)*7,absolute=47.95+(time-1000)*.002;
   const s=sample({beat:absolute%(bars*4),song_beat:absolute,state:{...sample().state,bars}});
   for(const delta of [-20,0,17,33,99,107,1000]){
    const p=transportPosition(s,time,time+delta),want=absolute+Math.max(0,Math.min(220,delta))*.002;
    near(p.absoluteBeat,want);near(p.songBeat,want);near(p.clipBeat,want%(bars*4));
    assert.equal(Math.floor(p.songBeat/(zoom*4)),Math.floor(want/(zoom*4)));
   }
  }
 }
});
test('song wrap and clip wrap remain independent for a 17-bar arrangement',()=>{
 const p=transportPosition(sample({song_beat:67.9,beat:3.9}),1000,1100);
 near(p.absoluteBeat,68.1);near(p.songBeat,.1);near(p.clipBeat,4.1);
 const once=sample({song_beat:67.9});once.state.song.loop=false;
 near(transportPosition(once,1000,1100).songBeat,68);
});
test('seek, stop/restart, tempo, loop length, focus return and delayed delivery anchor explicitly',()=>{
 near(transportPosition(sample({song_beat:8,beat:8,playing:false}),1000,2000).absoluteBeat,8);
 near(transportPosition(sample({song_beat:0,beat:0}),2000,2050).absoluteBeat,.1);
 near(transportPosition(sample({song_beat:40,beat:8}),3000,2900).absoluteBeat,40);
 const changed=sample({song_beat:40,beat:0,state:{...sample().state,bpm:60,bars:2}});
 near(transportPosition(changed,3000,3100).clipBeat,.1);
 near(transportPosition(changed,3000,9000).absoluteBeat,40.22);
 near(transportPosition(sample({song_beat:12,beat:12}),9000,9010).absoluteBeat,12.02);
 near(transportPosition(sample({song_beat:12,beat:12}),9000,9010).songBeat,12.02);
});
test('legacy snapshots and local preview use the same single-clock projection',()=>{
 const legacy=sample();delete legacy.song_beat;legacy.beat=15.9;
 near(transportPosition(legacy,1000,1100).clipBeat,.1);
 near(transportPosition(sample({song_beat:1}),1000,3000,100000).absoluteBeat,5);
});
test('open A receives no playing cursor while B sounds at a block offset',()=>{
 const project={bars:4,tracks:[{notes:[]}],clips:{open:[0],slots:[[[],[]]]},song:{on:true,loop:true,length:17,markers:[],lanes:[[{at:2,len:8,clip:1,off:1}]]}};
 assert.deepEqual(clipPlayback(project,0,12.5,12.5,true),{playing:false,beat:8.5,heard:1,open:0});
 project.clips.open[0]=1;
 assert.deepEqual(clipPlayback(project,0,12.5,12.5,true),{playing:true,beat:8.5,heard:1,open:1});
 assert.equal(clipPlayback(project,0,60,12,true).playing,false,'empty arrangement gap has no playing clip');
 project.song.on=false;
 assert.deepEqual(clipPlayback(project,0,12.5,7.25,true),{playing:true,beat:7.25,heard:1,open:1});
});
