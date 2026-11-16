import test from 'node:test';import assert from 'node:assert/strict';
const g=await import('../src/drum-shape-graph.ts');
const D={start:0,end:1,reverse:false,fade_in:0,fade_out:0,attack:0,hold:0,decay:0,low_cut:20,high_cut:20000,eq_low:0,eq_mid:0,eq_freq:1000,eq_high:0,comp_threshold:-18,comp_ratio:1,comp_attack:5,comp_release:120,comp_makeup:0,drive:0,pan:0};
test('Hold with Decay off stops the pad after attack + hold (as the engine)',()=>{
 assert.ok(Math.abs(g.padLength({...D,hold:.1},1,1)-.105)<1e-9);
 assert.equal(g.padLength(D,1,1),1);
 assert.ok(Math.abs(g.padLength({...D,hold:.1},1,2)-.105)<1e-9,'real seconds whatever the tune');
 assert.equal(g.padGain({...D,hold:.1},.05,.105),1);
});
test('fades and decay shape the level line',()=>{
 assert.ok(Math.abs(g.padGain({...D,fade_in:.1},.05,1)-.5)<1e-9);
 assert.ok(Math.abs(g.padGain({...D,fade_out:.1},.95,1)-.5)<1e-9);
 assert.ok(g.padGain({...D,decay:.1},.1,.1)<.0011);
});
test('EQ response matches the bell and the cuts',()=>{
 assert.ok(Math.abs(g.responseDb({...D,eq_mid:6},1000)-6)<.01);
 assert.ok(Math.abs(g.responseDb(D,1000))<1e-9);
 assert.ok(g.responseDb({...D,low_cut:400},50)<-20);
 assert.ok(g.envelopePath({...D,hold:.1},1).startsWith('M'));
});
