import test from 'node:test';
import assert from 'node:assert/strict';
import {drumKind, padLabel} from '../src/drum-kinds.ts';

// Wrong precedence or unbounded filename matching would mislabel real kit sounds.
test('sample families recognise descriptive and compact kit filenames',()=>{
  for(const [name,want] of [
    ['Kick Legend 909 01','kick'],['BD_808_01','kick'],['Snare02','snare'],
    ['Clap 707','clap'],['Snare Rimshot','rim'],['CHH_01','hat'],['OpenHat02','hat'],
    ['Hi-Hat Legend 707 Closed','hat'],['HH Open','hat'],['closedhat_01','hat'],['OHH02','hat'],['Tom Low','tom'],
    ['TomHi01','tom'],['Cymbal Ride','cymbal'],['Crash02','cymbal'],
    ['Cowbell','perc'],['Percussion Tambourine','perc'],['Shaker01','perc'],
    ['Riser 01','fx'],['Workshop','other'],['Tomato','other'],['','other']
  ])assert.equal(drumKind(name),want,name);
});

test('family comes from the sample rather than its parent kit or stale pad label',()=>{
  assert.equal(drumKind('Kick','/kits/Kick Collection/ClosedHat.wav'),'hat');
  assert.equal(drumKind('Pad 01','/kits/All Percussion/BD_01.wav'),'kick');
  assert.equal(drumKind('Hat','/kits/Kick Collection/Texture.wav'),'hat');
  assert.equal(drumKind('Texture','/kits/Kicks And Snares/Texture.wav'),'other');
});

test('pad names remove only a repeated kit phrase without eating sound words',()=>{
  assert.equal(padLabel('Kick Legend 909 01','Legend 909'),'Kick 01');
  assert.equal(padLabel('Hi-Hat Legend 707 Closed','Machines/Legend 707'),'Hi-Hat Closed');
  assert.equal(padLabel('Kick 01','Kick Collection'),'Kick 01');
  assert.equal(padLabel('Kick Big Room 01','Big Room'),'Kick 01');
  assert.equal(padLabel('Legend 909','Legend 909'),'Legend 909');
});
