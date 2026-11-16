// Native Electron UI acceptance through Chromium DevTools, preview-only.
// Does not touch the live MIDI/audio engine or user's project files.
const { chromium } = require('playwright');
const path = require('node:path');
(async()=>{
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9333');
 const context=browser.contexts()[0], pages=context.pages();
 const page=pages.find(p=>p.url().includes('/dist/index.html'))??pages[0];
 if(!page)throw new Error('DeckSynth preview window unavailable');
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 console.log('PAGE',page.url(),'VIEWPORT',JSON.stringify(page.viewportSize()));
 await page.getByRole('tab',{name:/SONG/i}).first().click();
 // The preview may already have been used to inspect another track. Select the
 // known five-note fixture explicitly instead of relying on stale UI selection.
 await page.locator('.pattern-focus-chip').first().click();
 const pads=page.locator('.step-hardware-pad');
 await pads.first().waitFor({state:'visible',timeout:6000});
 if(await pads.count()!==16)throw new Error('Expected 16 hardware steps');
 const onsets=await page.locator('.step-hardware-pad.has-onset').count();
 if(onsets!==5)throw new Error('Expected five note onset pads for track 1, got '+onsets);
 const active=page.locator('.step-hardware-pad.is-live');
 if(await active.count()!==1)throw new Error('Expected single live playhead pad');
 const one=await active.first().getAttribute('data-testid');
 await page.waitForTimeout(700);
 const two=await active.first().getAttribute('data-testid');
 if(one===two)throw new Error('Step playhead did not move in 700ms');
 console.log('STEP_SYNC PASS: 16 pads, 5 onset steps, changing active step',one,'→',two);
 await pads.nth(2).click();
 const inspect=await page.locator('.step-inspect-label').innerText();
 if(!inspect.includes('STEP 03'))throw new Error('Step inspection did not show selected step: '+inspect);
 console.log('STEP_INSPECT PASS:',inspect);
 const title=page.getByRole('tab',{name:/SOUND/i}).first();
 await title.click();
 await page.locator('.sound-workspace').waitFor({state:'visible',timeout:4000});
 await page.screenshot({path:'docs/replicant-inspired-sound-validated.png'});
 const knobs=page.locator('.tactile-knob [role="slider"]');
 const count=await knobs.count();
 if(count<3)throw new Error('Expected tactile knobs in sound editor, found '+count);
 const knob=knobs.first();
 const ticks=await knob.locator('svg>line').count();
 if(ticks<12)throw new Error('Need procedural tick ring and white needle, found '+ticks);
 const before=Number(await knob.getAttribute('aria-valuenow'));
 await knob.focus();
 const limit=Number(await knob.getAttribute('aria-valuemax'));
 await page.keyboard.press(before>=limit-0.0001?'ArrowDown':'ArrowUp');
 await page.waitForTimeout(80);
 const after=Number(await knob.getAttribute('aria-valuenow'));
 if(before===after)throw new Error('Knob arrow interaction did not change the value');
 console.log('KNOB PASS:',count,'controls; SVG ticks',ticks,'value',before,'→',after);
 await page.getByRole('tab',{name:/SONG/i}).first().click();
 await page.locator('.pattern-panel').waitFor({state:'visible',timeout:4000});
 await page.screenshot({path:'docs/replicant-inspired-song-validated.png'});
 if(errors.length)throw new Error('Renderer exceptions: '+errors.join('; '));
 console.log('PAGE PASS: no renderer errors, song and sound screenshots saved');
 await browser.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
