import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterEnvelope,filterMorph,fmtMorph} from '../src/sound-cards.ts';
test('missing filter ADSR follows this instrument, partial overrides stay independent',()=>{
 const p={attack:.42,decay:.8,sustain:.62,release:1.7};
 assert.deepEqual(filterEnvelope(p),p);
 assert.deepEqual(filterEnvelope({...p,fenv_a:.03,fenv_s:0}),{attack:.03,decay:.8,sustain:0,release:1.7});
 assert.deepEqual(p,{attack:.42,decay:.8,sustain:.62,release:1.7});
});
test('legacy filter choice maps to the same morph endpoint and continuous positions stay continuous',()=>{
 for(const [vcf_type,want] of [[0,0],[1,0],[2,.5],[3,1]])assert.equal(filterMorph({vcf_type}),want);
 assert.equal(filterMorph({vcf_type:3,vcf_morph:.25}),.25);
 assert.equal(fmtMorph(0),'LP');assert.equal(fmtMorph(.5),'BP');assert.equal(fmtMorph(1),'HP');
 assert.equal(fmtMorph(.25),'LP→BP');assert.equal(fmtMorph(.75),'BP→HP');
});
