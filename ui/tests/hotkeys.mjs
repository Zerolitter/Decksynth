import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ACTIONS,SCOPES,comboOf,matches,actionFor,keysOf,problem,withKeys,setOverrides,cleanOverrides,show,conflict} from '../src/hotkeys.ts';

const press=(key,mods={})=>({key,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,...mods});
test.afterEach(()=>setOverrides({}));

test('key presses get one canonical name',()=>{
 assert.equal(comboOf(press(' ')),'Space');
 assert.equal(comboOf(press('z',{ctrlKey:true,shiftKey:true})),'Ctrl+Shift+Z');
 assert.equal(comboOf(press('Z',{ctrlKey:true,shiftKey:true})),'Ctrl+Shift+Z');
 assert.equal(comboOf(press('q')),'Q');
 assert.equal(comboOf(press('Q',{shiftKey:true})),'Q');            // Shift does not change a plain letter
 assert.equal(comboOf(press('+',{shiftKey:true})),'+');
 assert.equal(comboOf(press('ArrowLeft',{shiftKey:true})),'Shift+Left');
 assert.equal(comboOf(press('ArrowUp',{ctrlKey:true})),'Ctrl+Up');
 assert.equal(comboOf(press('Enter',{shiftKey:true})),'Shift+Enter');
 assert.equal(comboOf(press('Shift',{shiftKey:true})),null);
 assert.equal(comboOf(press('a',{metaKey:true})),'Ctrl+A');
});
test('the shipped keys match what the old code checked',()=>{
 assert.equal(actionFor(press('F5'),'transport'),'transport.play');
 assert.equal(actionFor(press(' '),'transport'),'transport.play');
 assert.equal(actionFor(press('z',{ctrlKey:true}),'transport'),'transport.undo');
 assert.equal(actionFor(press('z',{ctrlKey:true,shiftKey:true}),'transport'),'transport.redo');
 assert.equal(actionFor(press('d',{ctrlKey:true}),'notes'),'notes.duplicate');
 assert.equal(actionFor(press('d',{ctrlKey:true}),'library'),'library.duplicate');   // the same keys in two panels
 assert.equal(actionFor(press('ArrowRight',{shiftKey:true}),'notes'),'notes.longer');
 assert.equal(actionFor(press('ArrowRight'),'notes'),'notes.right');
 assert.equal(actionFor(press('Backspace'),'notes'),'notes.delete');
 assert.equal(actionFor(press('=' ),'sample'),'sample.zoomIn');
 assert.equal(actionFor(press('A'),'library'),'library.add');
 assert.equal(actionFor(press('F6'),'notes'),null);                // transport keys belong to transport only
});
test('every action has keys, a label and a known scope; no key repeats inside a scope',()=>{
 const scopes=new Set(SCOPES.map(s=>s.id));
 for(const s of scopes){
  const seen=new Map();
  for(const a of ACTIONS.filter(a=>a.scope===s)){
   assert.ok(a.keys.length&&a.label&&a.about,a.id);
   for(const k of a.keys){assert.ok(!seen.has(k),`${k} is on ${seen.get(k)} and ${a.id}`);seen.set(k,a.id);}
  }
 }
 for(const a of ACTIONS)assert.ok(scopes.has(a.scope),a.id);
});
test('changed keys replace the defaults, reset puts them back',()=>{
 let map=withKeys({},'notes.quantize',['F6']);
 setOverrides(map);
 assert.deepEqual(keysOf('notes.quantize'),['F6']);
 assert.equal(matches(press('q'),'notes.quantize'),false);
 assert.equal(matches(press('F6'),'notes.quantize'),true);
 map=withKeys(map,'notes.quantize',['Q']);                 // back to the default: nothing stored
 assert.deepEqual(map,{});
});
test('a clash is caught before it is saved',()=>{
 assert.match(problem('notes.quantize','F5'),/Play or pause/);        // a panel may not take a transport key
 assert.match(problem('notes.quantize','Ctrl+C'),/Copy/);             // two keys of one panel
 assert.match(problem('transport.stop','Q'),/Quantize/);              // nor a transport key take a panel key
 assert.match(problem('notes.quantize','F11'),/window/);
 assert.match(problem('notes.quantize','Q'),/already on this row/);
 assert.equal(problem('notes.quantize','Ctrl+Alt+K'),null);
 assert.equal(problem('library.add','Ctrl+C'),null);                  // the same key in another panel is fine
 assert.equal(conflict('library.hear','Space'),null);                 // shipped overlap: Space plays in the library and in Transport
});
test('saved keys are cleaned: unknown actions and defaults are dropped',()=>{
 assert.deepEqual(cleanOverrides({'nope.x':['A'],'notes.quantize':['F6'],'notes.copy':['Ctrl+C'],'notes.cut':'x','notes.paste':[]}),{'notes.quantize':['F6']});
 assert.deepEqual(cleanOverrides(null),{});
});
test('arrows are shown as arrows',()=>{
 assert.equal(show('Ctrl+Left'),'Ctrl+←');
 assert.equal(show('Down'),'↓');
});
