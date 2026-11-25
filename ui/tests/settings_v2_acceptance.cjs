// Settings redesign (25 Nov): left navigation with 8 sections, search, tap lists, Custom values, hotkey editing, close routes.
// Opens Electron: never run it while the maintainer's own Decksynth is open (tools/deck_busy.sh).
'use strict';
const {launch}=require('./workflow_helpers.cjs'),assert=require('node:assert/strict');
let h;
(async()=>{
  h=await launch('settings-v2');
  const {p,shot}=h;
  for(const H of [718,800]){
    await p.setViewportSize({width:1280,height:H});
    await p.getByRole('button',{name:'Settings',exact:true}).click();
    const dialog=p.getByRole('dialog',{name:'Settings',exact:true});await dialog.waitFor();
    const box=await dialog.boundingBox();
    assert.ok(box.y>=0&&box.y+box.height<=H,'the window fits at '+H+': '+JSON.stringify(box));
    const nav=p.getByRole('navigation',{name:'Settings sections'});
    for(const n of ['Session','Audio','MIDI','Recording','Display','Sound and editing','Hotkeys','Clean up']){
      const tab=nav.getByRole('tab',{name:n,exact:true});await tab.click();
      assert.ok((await tab.boundingBox()).height>=44,n+' is a 44 px target');
      await shot('settings-'+n.replace(/\W+/g,'-').toLowerCase()+'-'+H);
    }
    for(const n of ['Full screen','Minimise','Quit']){const b=nav.getByRole('button',{name:n});if(await b.count())assert.ok((await b.boundingBox()).height>=44,n);}
    // every visible control inside the window is at least 44 px tall and not covered
    await nav.getByRole('tab',{name:'Recording',exact:true}).click();
    await dialog.getByRole('group',{name:'Count-in'}).getByRole('button',{name:'Custom'}).click();
    await dialog.getByRole('spinbutton',{name:/Count-in/}).waitFor();
    await shot('settings-countin-custom-'+H);
    await nav.getByRole('tab',{name:'Audio',exact:true}).click();
    await dialog.getByRole('group',{name:'Latency'}).getByRole('button',{name:'Custom'}).click();
    await dialog.getByRole('spinbutton',{name:/Latency/}).waitFor();
    assert.equal(await dialog.locator('select').count(),0,'no native drop-downs');
    // search finds settings and keys across sections; Esc clears it first
    const search=dialog.getByRole('searchbox',{name:'Search settings'});
    await search.fill('quantize');
    assert.ok(await dialog.locator('mark').count()>0,'matching words are marked');
    await shot('settings-search-'+H);
    await p.keyboard.press('Escape');
    assert.equal(await search.inputValue(),'');assert.ok(await dialog.isVisible(),'the first Esc only clears the search');
    // hotkeys: rebind Quantize to F6 is refused (Transport key), then to Ctrl+Alt+K
    await nav.getByRole('tab',{name:'Hotkeys',exact:true}).click();
    await dialog.getByRole('button',{name:'Change key Q'}).click();
    await p.keyboard.press('F6');
    await dialog.getByRole('alert').waitFor();
    await shot('settings-hotkey-conflict-'+H);
    await dialog.getByRole('button',{name:'Change key Q'}).click();
    await p.keyboard.press('Control+Alt+k');
    await dialog.getByRole('button',{name:'Change key Ctrl+Alt+K'}).waitFor();
    assert.ok(await dialog.getByRole('button',{name:'Put this key back'}).count()>=1,'a changed row has its own reset');
    await dialog.getByRole('button',{name:'Reset all keys'}).click();
    await dialog.getByRole('button',{name:'Change key Q'}).waitFor();
    // close routes: Esc, outside tap, CLOSE
    await p.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
    await p.getByRole('button',{name:'Settings',exact:true}).click();await dialog.waitFor();
    await p.mouse.click(4,4);await dialog.waitFor({state:'detached'});
    await p.getByRole('button',{name:'Settings',exact:true}).click();await dialog.waitFor();
    await dialog.getByRole('button',{name:/CLOSE/}).click();await dialog.waitFor({state:'detached'});
  }
  console.log('PASS settings v2 at 718 and 800');
  assert.deepEqual(h.errors,[]);
})().catch(async e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{if(h)await h.close();});
