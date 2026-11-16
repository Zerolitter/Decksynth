// Sir, 16 Nov: while linking, a drag still turns a knob and a tap links it. Shots of FX armed, Link editor and By name.
module.exports=async(p,shot)=>{
  const tab=n=>p.getByRole('tab',{name:new RegExp('^'+n+'$','i')}).first().click();
  await tab('Link');
  if(await p.locator('.link-box.lit').count())await p.locator('.link-box').click();
  await p.locator('.fx-pad-main').first().click();await p.waitForTimeout(300);
  await shot('editor');
  // control: does a mouse drag turn this knob when nothing is armed?
  await tab('FX');await p.waitForTimeout(300);
  if(!(await p.locator('.fx-cards .fx-knob-cell').count())){const o=p.locator('.fx-add-open');if(await o.count())await o.click();await p.locator('[aria-label="Add Overdrive"]').first().click();await p.waitForTimeout(300);}
  {const k=p.locator('.fx-cards .fx-knob-cell .knob-target').first();const v0=await k.getAttribute('aria-valuenow');const bb=await k.boundingBox();
   await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2);await p.mouse.down();for(let i=1;i<=8;i++){await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2-i*6);await p.waitForTimeout(16);}
   await p.mouse.up();await p.waitForTimeout(300);console.log('unarmed drag',v0,'->',await k.getAttribute('aria-valuenow'));}
  await tab('Link');await p.waitForTimeout(300);
  await p.locator('.lp-arm').first().click();await p.waitForTimeout(200);
  console.log('armed',await p.locator('.link-box.lit').count());
  await tab('FX');await p.waitForTimeout(400);
  if(!(await p.locator('.fx-cards .fx-knob-cell').count())){const o=p.locator('.fx-add-open');if(await o.count())await o.click();await p.locator('[aria-label="Add Overdrive"]').first().click();await p.waitForTimeout(300);}
  const knob=p.locator('.fx-cards .fx-knob-cell .knob-target').first();
  const before=await knob.getAttribute('aria-valuenow');
  const b=await knob.boundingBox();
  await p.mouse.move(b.x+b.width/2,b.y+b.height/2);await p.mouse.down();
  for(let i=1;i<=8;i++){await p.mouse.move(b.x+b.width/2,b.y+b.height/2-i*6);await p.waitForTimeout(16);}
  await p.mouse.up();await p.waitForTimeout(300);
  const after=await knob.getAttribute('aria-valuenow');
  const linkedAfterDrag=await p.locator('.fx-cards .fx-knob-cell.routed-here').count();
  console.log('drag turns',before,'->',after,'links after drag',linkedAfterDrag);
  await knob.click({force:true});await p.waitForTimeout(300);
  console.log('links after tap',await p.locator('.fx-cards .fx-knob-cell.routed-here').count(),'still armed',await p.locator('.link-box.lit').count());
  await shot('fx-armed');
  await tab('Link');await p.waitForTimeout(300);
  await p.getByRole('button',{name:/By name/}).first().click();await p.waitForTimeout(400);
  const links=p.locator('.source-inspector button',{hasText:/^Links$/});if(await links.count())await links.first().click();
  await p.waitForTimeout(300);await shot('byname-links');
  if(before===after)throw new Error('knob did not turn while linking');
};
