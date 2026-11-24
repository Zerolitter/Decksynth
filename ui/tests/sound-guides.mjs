import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SOUND_GUIDES,isRecommended} from '../src/sound-guides.ts';
import {SHAPES} from '../src/spectral-seeds.ts';

test('six visual guidance profiles use bounded 16-partial contours and existing starting shapes',()=>{
 const ids=['warm-round','bright-harmonic','bell-metallic','pluck-percussive','evolving-ambient','walking-bass'];
 assert.deepEqual(SOUND_GUIDES.map(guide=>guide.id),ids);
 for(const guide of SOUND_GUIDES){
  assert.ok(SHAPES.includes(guide.shape),guide.id+' shape');
  assert.equal(guide.contour.length,16,guide.id+' contour length');
  assert.ok(guide.contour.every(value=>value>=0&&value<=1),guide.id+' contour is bounded');
  assert.ok(guide.ranges.filter,guide.id+' has a brightness recommendation');
  for(const [key,[min,max]] of Object.entries(guide.ranges)){
   assert.ok(min<=max,guide.id+' '+key+' interval direction');
  }
 }
 assert.deepEqual(SOUND_GUIDES.find(guide=>guide.id==='warm-round')?.contour,[1,.5,.22,.12,.08,.04,.02,.01,0,0,0,0,0,0,0,0]);
 assert.deepEqual(SOUND_GUIDES.find(guide=>guide.id==='bell-metallic')?.contour,[1,0,.55,0,.3,0,.12,.08,0,.04,0,0,.02,0,0,0]);
});

test('recommendation checks include endpoints without mutating profile data',()=>{
 const guide=SOUND_GUIDES.find(guide=>guide.id==='walking-bass');
 assert.ok(guide);
 const range=guide.ranges.decay;
 assert.equal(isRecommended(range,range[0]),true);
 assert.equal(isRecommended(range,range[1]),true);
 assert.equal(isRecommended(range,range[1]+.01),false);
 assert.deepEqual(guide.ranges.decay,range);
});
