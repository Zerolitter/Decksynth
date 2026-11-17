// Colours come from src/tokens.css. Older raw hex colours are listed per file in colour-baseline.json and may only
// go away: a file that gains a raw hex colour it didn't have fails here. Use var(--ui-...) / var(--c-...) instead.
// After moving colours onto tokens, shrink the list:  UPDATE_COLOUR_BASELINE=1 node --test tests/colour-tokens.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,readdirSync,writeFileSync,statSync} from 'node:fs';
import path from 'node:path';

const SRC=path.resolve('src'),BASELINE=path.resolve('tests/colour-baseline.json');
const HEX=/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
function files(dir){
  return readdirSync(dir).flatMap(name=>{const full=path.join(dir,name);
    return statSync(full).isDirectory()?files(full):/\.(css|tsx?)$/.test(name)&&name!=='tokens.css'?[full]:[];});
}
function scan(){
  const found={};
  for(const file of files(SRC)){
    const hex=[...new Set((readFileSync(file,'utf8').match(HEX)??[]).map(h=>h.toLowerCase()))].sort();
    if(hex.length)found[path.relative(SRC,file)]=hex;
  }
  return found;
}

test('no new raw hex colours outside tokens.css',()=>{
  const now=scan();
  if(process.env.UPDATE_COLOUR_BASELINE){writeFileSync(BASELINE,JSON.stringify(now,null,1)+'\n');return;}
  const allowed=JSON.parse(readFileSync(BASELINE,'utf8'));
  const added=Object.entries(now).flatMap(([file,hex])=>hex.filter(h=>!(allowed[file]??[]).includes(h)).map(h=>file+' '+h));
  assert.deepEqual(added,[],'New raw colours; use a token from src/tokens.css:\n'+added.join('\n'));
});

test('tokens.css defines the palette the rules ask for',()=>{
  const css=readFileSync(path.join(SRC,'tokens.css'),'utf8');
  for(const name of ['--ui-bg','--ui-surface','--ui-line','--ui-text','--ui-accent','--ui-rec','--c-song','--c-sound','--c-fx','--c-perform','--ui-r-md','--ui-s-2','--ui-fs-md'])
    assert.match(css,new RegExp(name+'\\s*:'),name+' is missing');
});
