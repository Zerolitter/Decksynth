import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SHAPES,harmonicShape,nextSeed} from '../src/spectral-seeds.ts';
import {spectralGain,evaluatedPartials} from '../src/spectral.ts';

test('seeded Random is repeatable, bounded and advances through uint32 seeds',()=>{
 assert.equal(SHAPES.length,7);
 for(const seed of [0,1,42,0xffffffff]){
  const a=harmonicShape('RANDOM',seed);assert.equal(a.length,16);assert.ok(a.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
  assert.deepEqual(a,harmonicShape('RANDOM',seed));assert.notDeepEqual(a,harmonicShape('RANDOM',nextSeed(seed)));
 }
 const golden=JSON.parse(readFileSync(new URL('../../tests/fixtures/spectral_s1_seeds.json',import.meta.url),'utf8'));
 for(const [seed,expected] of Object.entries(golden))assert.deepEqual(harmonicShape('RANDOM',Number(seed)),expected,'matches native Python seed math');
 assert.equal(nextSeed(0),0x9e3779b9);
 for(const seed of [-1,2**32,NaN,.5])assert.throws(()=>harmonicShape('RANDOM',seed));
});
test('Character reshapes the heard partials without changing the source',()=>{
 const p={harmonics:Array(16).fill(1),filter:1};const saved=[...p.harmonics];
 for(let k=1;k<=16;k++){assert.equal(spectralGain({...p,character:1},k),k%2?1:0);assert.equal(spectralGain({...p,character:-1},k),k%2?0:1);assert.equal(spectralGain({...p,character:0},k),1);}
 assert.equal(evaluatedPartials({...p,character:1})[1],0);assert.deepEqual(p.harmonics,saved);
});
test('heard partial overlay follows effective Character while saved amplitudes remain unchanged',()=>{
 const p={harmonics:Array(16).fill(1),filter:1,character:.5};
 assert.equal(evaluatedPartials(p,{character:1})[1],0);
 assert.equal(p.character,.5);assert.equal(p.harmonics[1],1);
});
