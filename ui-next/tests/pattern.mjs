import assert from 'node:assert/strict';
import {test} from 'node:test';
import {patternCells,activeStep,interpolateBeat,meterIntensity} from '../src/pattern.ts';

test('16-step overview reflects only existing MIDI onsets and sustained notes',()=>{
 const notes=[
   {start:0,duration:2,note:60,velocity:100},
   {start:4,duration:4,note:64,velocity:100},
   {start:15,duration:2,note:67,velocity:100},
 ];
 const steps=patternCells(notes,4);
 assert.equal(steps.length,16);
 assert.equal(steps[0].on,1);
 assert.equal(steps[1].held,true);
 assert.equal(steps[2].on,0);
 assert.equal(steps[4].on,1);
 assert.equal(steps[7].held,true);
 assert.equal(steps[15].on,1);
 // A note that crosses the end of a loop is still held across the seam.
 assert.equal(steps[0].held,true);
 assert.equal(steps[8].held,false);
 assert.equal(patternCells([],4).filter(s=>s.held||s.on).length,0);
});

test('sample-clock position maps consistently to each pattern step',()=>{
 assert.equal(activeStep(0,4),0);
 assert.equal(activeStep(.999,4),0);
 assert.equal(activeStep(1,4),1);
 assert.equal(activeStep(7.1,4),7);
 assert.equal(activeStep(15.999,4),15);
 assert.equal(activeStep(16,4),0);
 assert.equal(activeStep(4,1),0);
 assert.equal(activeStep(-.1,4),15);
});

test('interpolation is anchored to real transport and does not invent indefinite playback',()=>{
 const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,'Expected '+a+' ≈ '+b);
 near(interpolateBeat(8,1000,1100,120,4,true),8.2);
 near(interpolateBeat(8,1000,1500,120,4,true),8.44);
 near(interpolateBeat(8,1000,1500,120,4,false),8);
 near(interpolateBeat(15.9,1000,1100,120,4,true),.1);
 near(interpolateBeat(8,1000,1500,120,4,true,2000),9);
});

test('meter intensity distinguishes silence and nonzero audio safely',()=>{
 assert.equal(meterIntensity(0),0);
 assert.ok(meterIntensity(.12)>0);
 assert.equal(meterIntensity(100),1);
 assert.equal(meterIntensity(-1),0);
});
