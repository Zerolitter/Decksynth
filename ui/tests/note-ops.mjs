import test from 'node:test';import assert from 'node:assert/strict';import {editNotes,paintNotes} from '../src/note-ops.ts';
const bounds={span:16,snap:1,maxDuration:8};const note=(start=0,pitch=60)=>({start,duration:1,note:pitch,velocity:100});
test('painting a gesture adds each visited step once and preserves existing chord notes',()=>{const a=paintNotes([note(1,64)],0,3,60,bounds);assert.equal(a.length,5);assert.deepEqual(paintNotes(a,0,3,60,bounds),a);assert.equal(a.filter(n=>n.start===1).length,2);});
test('group move clamps as a group and leaves unselected music untouched',()=>{const a=[note(1,60),note(2,64),note(12,70)];const r=editNotes(a,[0,1],{kind:'move',time:-10,pitch:-100},bounds);assert.deepEqual(r.events.map(n=>[n.start,n.note]),[[0,0],[1,4],[12,70]]);assert.deepEqual(a,[note(1,60),note(2,64),note(12,70)]);});
test('duplicate delete length velocity and quantize are explicit one-batch operations',()=>{const a=[note(.2),note(6,67)];let r=editNotes(a,[0],{kind:'quantize'},bounds);assert.equal(r.events[0].start,0);r=editNotes(r.events,[0],{kind:'duplicate'},bounds);assert.equal(r.events.length,3);assert.equal(r.events[2].start,1);r=editNotes(r.events,r.selection,{kind:'length',delta:20},bounds);assert.equal(r.events[2].duration,8);r=editNotes(r.events,r.selection,{kind:'velocity',value:45},bounds);assert.equal(r.events[2].velocity,45);r=editNotes(r.events,r.selection,{kind:'delete'},bounds);assert.equal(r.events.length,2);});
test('duplicate chooses a free grid position instead of overlapping the same pitch',()=>{const r=editNotes([note(0),note(1)],[0],{kind:'duplicate'},bounds);assert.equal(r.events[2].start,2);});
test('legato joins selected chord voices to the next onset and quantize can target every note',()=>{
 const chord=[{start:.2,duration:.25,note:60,velocity:80},{start:.2,duration:.25,note:64,velocity:90},{start:2,duration:.25,note:67,velocity:100}];
 const legato=editNotes(chord,[0,1],{kind:'legato'},bounds);
 assert.deepEqual(legato.events.slice(0,2).map(n=>n.duration),[1.8,1.8]);
 const all=editNotes(chord,chord.map((_,i)=>i),{kind:'quantize'},bounds);
 assert.deepEqual(all.events.map(n=>n.start),[0,0,2]);
});
test('painting can retain a chosen note length without affecting existing notes',()=>{
 const painted=paintNotes([note(2,67)],0,1,60,bounds,false,3);
 assert.deepEqual(painted.filter(n=>n.note===60).map(n=>n.duration),[3,3]);
 assert.equal(painted.find(n=>n.note===67)?.duration,1);
});
