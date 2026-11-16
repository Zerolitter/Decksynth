import assert from 'node:assert/strict';
import {test} from 'node:test';
import {depthAt,ringDelta,parseDepth} from '../src/depth.ts';

test('100 px on a 60 px ring gives +50 % from 0 (travel is at least 200 px)',()=>{
 assert.equal(depthAt(0,100,{length:60}),.5);
 assert.equal(depthAt(0,-100,{length:60}),-.5);
});
test('a long bar uses its own length as travel',()=>{
 assert.equal(depthAt(0,200,{length:400}),.5);
});
test('fine mode is five times slower',()=>{
 assert.equal(depthAt(0,100,{length:60,fine:true}),.1);
});
test('crossing zero sticks for 12 px',()=>{
 assert.equal(depthAt(.2,-40-6,{length:60}),0,'6 px past zero');
 assert.equal(depthAt(.2,-40-11,{length:60}),0,'11 px past zero');
 assert.equal(depthAt(.2,-40-32,{length:60}),-.1,'32 px past zero is 20 px of real travel');
});
test('quantise to 1 %, or 5 % when fast',()=>{
 assert.equal(depthAt(0,33.3,{length:60}),.17);
 assert.equal(depthAt(0,33.3,{length:60,fast:true}),.15);
 assert.equal(depthAt(0,33.3,{length:60,fast:true,fine:true}),.03);
});
test('clamped to −100 … +100 %',()=>{
 assert.equal(depthAt(.9,500),1);assert.equal(depthAt(-.9,-500),-1);
});
test('ring uses the bigger axis, up is positive',()=>{
 assert.equal(ringDelta(5,-30),30);assert.equal(ringDelta(-40,10),-40);
});
test('exact entry',()=>{
 assert.equal(parseDepth('+35'),.35);assert.equal(parseDepth('-20 %'),-.2);assert.equal(parseDepth('0.5'),.5);
 assert.equal(parseDepth('250'),1);assert.equal(parseDepth('abc'),null);
});
