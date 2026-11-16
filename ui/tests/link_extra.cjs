// Link mode across pages: arm Macro 4 on Link, tap a Drum Rack knob, check the link shows on the Link page.
module.exports=async(p,shot)=>{
  const tab=n=>p.getByRole('tab',{name:new RegExp('^'+n+'$','i')}).first().click();
  await tab('Link');
  const lip=p.locator('[aria-label^="Link Macro 4"]').first();
  if(!(await p.locator('.link-box.lit').count()))await lip.click();
  await tab('Sound');
  await p.getByRole('radiogroup',{name:'Track instrument'}).getByRole('radio',{name:'Drum Rack',exact:true}).click();
  await p.waitForTimeout(800);
  const ready=p.locator('.parameter-knob.link-ready .knob-target');
  console.log('link-ready knobs',await ready.count());
  await shot('drum-armed');
  if(await ready.count()){await ready.first().click();await p.waitForTimeout(400);}
  await tab('Link');await shot('link-after-drum');
  console.log('links rows',await p.locator('.lp-link').count(),'box lit',await p.locator('.link-box.lit').count());
  await p.locator('.link-box').click();
  console.log('box lit after tap',await p.locator('.link-box.lit').count());
};
