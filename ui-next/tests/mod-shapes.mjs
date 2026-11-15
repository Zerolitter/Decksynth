import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import path from 'node:path';import {fileURLToPath} from 'node:url';
const fx=await import('../src/fx.ts');
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
test('42 shapes in pages of at most 10, same list as the engine',()=>{
 assert.equal(fx.MOD_SHAPES.length,42);assert.ok(fx.SHAPE_PAGES.every(p=>p.shapes.length<=10));
 const py=JSON.parse(execFileSync('python3',['-c','import json,sys;sys.path.insert(0,sys.argv[1]);from decksynth.fx import SHAPES;print(json.dumps(SHAPES))',ROOT]).toString());
 assert.deepEqual(fx.MOD_SHAPES,py);
});
test('the editor draws what the engine plays (every shape, 128 phases, two cycles)',()=>{
 const py=JSON.parse(execFileSync('python3',['-c',`import json,sys;sys.path.insert(0,sys.argv[1])
from decksynth.fx import SHAPES,shape_value
print(json.dumps({s:[shape_value(s,i/128,[((k*5)%7)/3-1 for k in range(16)],c,16,[[0,0],[.5,1],[1,0]]) for c in (0,3) for i in range(128)] for s in SHAPES}))`,ROOT]).toString());
 const steps=Array.from({length:16},(_,k)=>((k*5)%7)/3-1);
 for(const s of fx.MOD_SHAPES){
  const js=[0,3].flatMap(c=>Array.from({length:128},(_,i)=>fx.shapeValue(s,i/128,steps,c,16,[[0,0],[.5,1],[1,0]])));
  js.forEach((v,i)=>{assert.ok(v>=-1&&v<=1,s);assert.ok(Math.abs(v-py[s][i])<1e-9,s+' at '+i+': '+v+' vs '+py[s][i]);});
 }
});
test('8 and 16 bars keep old rate numbers',()=>{
 assert.deepEqual(fx.MOD_RATES.slice(0,7),['4 bars','2 bars','1 bar','1/2','1/4','1/8','1/16']);
 assert.equal(fx.MOD_RATES[fx.MOD_RATE_ORDER[0]],'16 bars');assert.equal(fx.MOD_RATES[fx.MOD_RATE_ORDER[1]],'8 bars');
});
