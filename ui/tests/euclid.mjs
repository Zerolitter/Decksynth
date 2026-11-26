import test from 'node:test';
import assert from 'node:assert/strict';
import {euclidCycle,euclidOnsets,euclidNotes,degreePitch,writeLanes} from '../src/euclid.ts';
import {GENRES,DRUM_ROLES,drumRolePads} from '../src/euclid-genres.ts';

const on=c=>c.flatMap((v,i)=>v?[i]:[]);

test('classic Euclidean rhythms land where drummers expect them',()=>{
 assert.deepEqual(on(euclidCycle(4,16)),[0,4,8,12]);            // four on the floor
 assert.deepEqual(on(euclidCycle(3,8)),[0,3,6]);                // tresillo
 assert.deepEqual(on(euclidCycle(5,8)),[0,2,4,5,7]);            // cinquillo: gaps 2-2-1-2-1, a turn of 2-1-2-1-2
 assert.deepEqual(on(euclidCycle(2,16,4)),[4,12]);              // shifted: beats two and four
 assert.deepEqual(on(euclidCycle(1,16,8)),[8]);
});

test('fill, steps and shift are clamped and keep the pulse count',()=>{
 for(let steps=2;steps<=32;steps++)for(let fill=0;fill<=steps;fill++)for(const shift of [0,1,steps-1,steps,-3]){
  assert.equal(on(euclidCycle(fill,steps,shift)).length,fill,`${fill}/${steps} shift ${shift}`);
 }
 assert.equal(on(euclidCycle(99,8)).length,8);
 assert.equal(on(euclidCycle(-2,8)).length,0);
});

test('shift turns the pattern forward and wraps',()=>{
 assert.deepEqual(on(euclidCycle(3,8,1)),[1,4,7]);
 assert.deepEqual(on(euclidCycle(3,8,8)),on(euclidCycle(3,8,0)));
 assert.deepEqual(on(euclidCycle(3,8,-1)),[2,5,7]);
});

test('a lane shorter than the pattern repeats and is cut at the pattern end',()=>{
 assert.deepEqual(euclidOnsets({fill:3,steps:8,shift:0},16),[0,3,6,8,11,14]);
 assert.deepEqual(euclidOnsets({fill:3,steps:5,shift:0},16).length,10);
 assert.deepEqual(euclidOnsets({fill:4,steps:16,shift:0},8),[0,4]);
});

test('notes carry the pulse number so a lane can walk through pitches',()=>{
 const notes=euclidNotes({on:true,fill:4,steps:16,shift:0,velocity:100},16,k=>60+k);
 assert.deepEqual(notes.map(n=>[n.start,n.note,n.duration,n.velocity]),[[0,60,1,100],[4,61,1,100],[8,62,1,100],[12,63,1,100]]);
 assert.equal(euclidNotes({on:true,fill:1,steps:4,shift:0,velocity:500},4,()=>36)[0].velocity,127);
});

test('scale degrees follow the scale, past the octave and below the root',()=>{
 assert.equal(degreePitch(48,'Minor',0),48);
 assert.equal(degreePitch(48,'Minor',2),51);
 assert.equal(degreePitch(48,'Minor',7),60);
 assert.equal(degreePitch(48,'Minor',-1),46);
 assert.equal(degreePitch(48,'Major',2),52);
 assert.equal(degreePitch(48,'Chromatic',2),51);               // chromatic reads as minor, not as semitones
 assert.equal(degreePitch(120,'Minor',7),127);                  // never past MIDI
});

test('writing lanes replaces only the lanes pitches, or the whole pattern',()=>{
 const old=[{start:0,note:36,duration:1,velocity:90},{start:2,note:42,duration:1,velocity:80},{start:4,note:36,duration:1,velocity:90}];
 const kick=[{start:0,note:36,duration:1,velocity:100},{start:8,note:36,duration:1,velocity:100}];
 assert.deepEqual(writeLanes(old,[kick],[36]).map(n=>[n.start,n.note]),[[0,36],[2,42],[8,36]]);
 assert.deepEqual(writeLanes(old,[kick],null).map(n=>[n.start,n.note]),[[0,36],[8,36]]);
});

test('every genre has the seven the user asked for and sane lanes',()=>{
 assert.deepEqual(GENRES.map(g=>g.name),['Chill & Ambient','Techno','Progressive','Dance & EDM','Hip Hop & Trap','Dubstep','Reggaeton']);
 for(const g of GENRES){
  assert.ok(g.drums.kick||g.drums.snare,g.name+' has a backbone');
  for(const [role,[fill,steps,shift,vel]] of Object.entries(g.drums)){
   assert.ok(DRUM_ROLES.includes(role));
   assert.ok(steps>=2&&steps<=32&&fill>=0&&fill<=steps&&shift>=0&&shift<steps&&vel>=1&&vel<=127,g.name+' '+role);
  }
  for(const s of Object.values(g.synth)){const [fill,steps,shift,vel]=s.lane;assert.ok(steps>=2&&steps<=32&&fill>=1&&fill<=steps&&shift<steps&&vel<=127&&s.degrees.length>0,g.name);}
 }
});

test('drum roles find pads by what they are, not by MIDI note, and skip what the kit lacks',()=>{
 const pad=(note,name)=>({note,name,source:null,gain:1,velocity:100,mute:false,solo:false,tune:0,choke:0});
 const kit=[pad(60,'Big Kick'),pad(61,'Snare 2'),pad(62,'Clap'),pad(63,'Closed Hat'),pad(64,'Open Hat'),pad(65,'FX Riser')];
 const r=drumRolePads(kit);
 assert.deepEqual([r.kick.note,r.snare.note,r.clap.note,r.hat.note,r.openhat.note],[60,61,62,63,64]);
 assert.equal(r.perc,undefined);
 assert.equal(drumRolePads([pad(36,'Kick')]).hat,undefined);
});
