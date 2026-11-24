import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

const source=fs.readFileSync(path.resolve('src/chordz-primitives/knob.ts'),'utf8');
const {code}=await transform(source,{loader:'ts',format:'esm'});
const moduleUrl='data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const {knobDragValue}=await import(moduleUrl);

test('knob fine drag moves at exactly one-fifth normal travel',()=>{
  const bounds={min:0,max:100};
  const normal=knobDragValue(50,-20,bounds,false);
  const fine=knobDragValue(50,-20,bounds,true);
  assert.equal(normal-50,10);
  assert.equal(fine-50,2);
  assert.equal((fine-50)/(normal-50),.2);
});
