import assert from 'node:assert/strict';
import {test} from 'node:test';
import {addModule,defaultFxChain} from '../src/fx.ts';
import {chainFor,splitEdit,summary,playingClip} from '../src/clip-fx.ts';

const base=()=>{let c=addModule(defaultFxChain(),'chorus');c=addModule(c,'smear');return c;};
const mod=(c,id)=>c.modules.find(m=>m.id===id);
const setParam=(c,id,k,v)=>({...c,modules:c.modules.map(m=>m.id===id?{...m,params:{...m.params,[k]:v}}:m)});
const setBypass=(c,id,v)=>({...c,modules:c.modules.map(m=>m.id===id?{...m,bypass:v}:m)});

test('while editing a clip, a knob and a power button go to the clip and Base stays',()=>{
  const b=base();let r=splitEdit(b,setParam(b,'smear','mix',.9),b,null,true);
  assert.deepEqual(r.entry,{fx:{smear:{params:{mix:.9}}}});assert.equal(mod(r.base,'smear').params.mix,mod(b,'smear').params.mix);assert.equal(r.power,false);
  const shown=chainFor(b,r.entry);r=splitEdit(shown,setBypass(shown,'chorus',true),b,r.entry,true);
  assert.deepEqual(r.entry.fx.chorus,{on:false});assert.equal(r.power,true);assert.ok(!mod(r.base,'chorus').bypass);
});
test('outside editing, a knob the clip holds edits the clip, others edit Base',()=>{
  const b=base(),e={fx:{smear:{params:{mix:.9}}}},shown=chainFor(b,e);
  let r=splitEdit(shown,setParam(shown,'smear','mix',.4),b,e,false);
  assert.equal(r.entry.fx.smear.params.mix,.4);
  r=splitEdit(shown,setParam(shown,'chorus','mix',.1),b,e,false);
  assert.equal(mod(r.base,'chorus').params.mix,.1);assert.deepEqual(r.entry,e);
});
test('a card added while editing a clip is off in Base and on in the clip',()=>{
  const b=base(),r=splitEdit(b,addModule(b,'eq'),b,null,true);
  assert.ok(mod(r.base,'eq').on);assert.ok(mod(r.base,'eq').bypass);assert.deepEqual(r.entry.fx.eq,{on:true});
  assert.ok(!mod(chainFor(r.base,r.entry),'eq').bypass);assert.ok(mod(chainFor(r.base,null),'eq').bypass);
});
test('the summary names one change and counts more',()=>{
  assert.equal(summary(null,[]),'same as Base');
  assert.equal(summary({fx:{chorus:{on:false}}},[]),'Chorus off');
  assert.equal(summary({fx:{chorus:{on:false}},sends:{'0':{amount:.5,through:false}}},[{name:'Hall'}]),'2 changes');
});
test('the playing clip: the song block under the playhead, or the open clip',()=>{
  const p={bars:1,tracks:[{notes:[]}],clips:{open:[3],slots:[[]]},song:{on:false,loop:true,length:4,markers:[],lanes:[[{at:0,len:2,clip:0},{at:2,len:2,clip:1}]]}};
  assert.equal(playingClip(p,0,null),3);
  p.song.on=true;assert.equal(playingClip(p,0,0),0);assert.equal(playingClip(p,0,3),1);assert.equal(playingClip(p,0,null),null);
});
