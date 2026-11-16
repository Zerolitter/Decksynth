import test from 'node:test';import assert from 'node:assert/strict';import {zoomAt,fitNotesView} from '../src/piano-viewport.ts';
test('performance range starts drum editing at MIDI 36–51 and preserves the melodic C4 view',async()=>{
 const {performanceRange}=await import('../src/piano-viewport.ts');
 assert.deepEqual(performanceRange('drum_rack'),{base:36,top:51,rows:16,keyboardBase:36,keyCount:16,viewTop:47,viewRows:12});
 assert.deepEqual(performanceRange('synth'),{base:60,top:72,rows:13,keyboardBase:48,keyCount:37,viewTop:72,viewRows:9});
 assert.deepEqual(performanceRange('drum_rack',48),{base:48,top:63,rows:16,keyboardBase:48,keyCount:16,viewTop:59,viewRows:12});
 assert.equal(performanceRange('synth',-12).base,0);
 assert.equal(performanceRange('drum_rack',120).top,123);
});
test('pointer-centered zoom preserves the musical coordinate under the mouse',()=>{const left=245,x=217,before=(left+x-44)/64;const after=zoomAt(left,x,64,100,44);assert.equal((after+x-44)/100,before);const top=300,y=90,pitch=(top+y-24)/44;assert.equal((zoomAt(top,y,44,60,24)+y-24)/60,pitch);});
test('fit frames actual note timing and pitch extents with useful bounds',()=>{const r=fitNotesView([{start:4,duration:2,note:48,velocity:100},{start:10,duration:1,note:72,velocity:90}],16,.25,1000,376);assert.ok(r.timePx>=12&&r.timePx<=192);assert.ok(r.rowHeight>=12&&r.rowHeight<=88);assert.ok(r.left>=0&&r.top>=0);assert.ok((4/.25*r.timePx+44)-r.left>=0);assert.ok((11/.25*r.timePx+44)-r.left<=1000);});
test('Fit keeps note heads beyond the sticky pitch gutter even in a wide phrase',()=>{const notes=[{start:0,duration:.25,note:48,velocity:90},{start:12,duration:.5,note:60,velocity:100}],v=fitNotesView(notes,16,.25,1032,376);assert.ok(44-v.left>=44,'first head is not underneath pitch labels');assert.ok(24+(127-60)*v.rowHeight-v.top>=24);});
