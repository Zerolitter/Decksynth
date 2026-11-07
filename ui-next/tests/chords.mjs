import assert from 'node:assert/strict';
import {test} from 'node:test';
import {diatonicChords,chordName,voice,leadVoices,chordText} from '../src/chords.ts';

test('C major triads are I ii iii IV V vi vii°',()=>{
 const pads=diatonicChords(0,'Major','triad');
 assert.deepEqual(pads.map(p=>p.roman),['I','ii','iii','IV','V','vi','vii°']);
 assert.deepEqual(pads.map(p=>p.name),['C','Dm','Em','F','G','Am','B°']);
 assert.deepEqual(pads[5].notes,[57,60,64]);
 assert.equal(chordText(pads[5].notes),'A C E');
});
test('sevenths and A minor',()=>{
 const pads=diatonicChords(9,'Minor','7');
 assert.equal(pads[0].name,'Am7');assert.equal(pads[1].name,'Bm7♭5');assert.equal(pads[2].name,'Cmaj7');assert.equal(pads[4].name,'Em7');
});
test('chromatic falls back to the major key of the root',()=>{
 assert.deepEqual(diatonicChords(2,'Chromatic','triad').map(p=>p.name),['D','Em','F♯m','G','A','Bm','C♯°']);
});
test('pentatonic gives one pad per scale note',()=>{
 assert.equal(diatonicChords(0,'Major Pentatonic','triad').length,5);
});
test('voicing: inversion, voices and bass',()=>{
 assert.deepEqual(voice([60,64,67],60,{inversion:1}),[64,67,72]);
 assert.deepEqual(voice([60,64,67],60,{inversion:-1}),[55,60,64]);
 assert.deepEqual(voice([60,64,67,71],60,{voices:3}),[60,64,67]);
 assert.deepEqual(voice([60,64,67],60,{bass:1}),[48,60,64,67]);
});
test('voice leading picks the closest inversion',()=>{
 const f=leadVoices([53,57,60],[48,52,55]);
 assert.ok(Math.abs(f.reduce((a,b)=>a+b)/3-51.7)<4,'F near C: '+f);
 assert.equal(chordName(57,[0,3,7]),'Am');
});
