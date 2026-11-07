import {test} from 'node:test';import assert from 'node:assert/strict';
import {knobControl,ccForControl} from '../src/parameter-registry.ts';
test('existing knob IDs resolve canonical controller targets and reject another track',()=>{
 assert.deepEqual(knobControl('0-brightness',0),{module:'sound',param:'filter'});
 assert.deepEqual(knobControl('0-fenv-a',0),{module:'sound',param:'fenv_a'});
 assert.deepEqual(knobControl('0-fx-gate-phase',0),{module:'gate',param:'phase'});
 assert.deepEqual(knobControl('0-macro-2',0),{module:'macro',param:'2'});
 assert.equal(knobControl('1-pitch',0),null);assert.equal(knobControl('morph-size',0),null);
});
test('CC badges reflect explicit bindings and default CC74 only while available',()=>{
 const t={module:'sound',param:'vcf_cutoff'};assert.equal(ccForControl(t,[]),74);
 assert.equal(ccForControl(t,[{module:'sound',param:'vcf_cutoff',cc:21,channel:0}]),21);
 assert.equal(ccForControl(t,[{module:'sound',param:'attack',cc:74,channel:0}]),null);
});
