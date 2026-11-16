// Sir 16 Nov: Shape sheet and Morph pad on Link need room for their options.
module.exports=async(p,shot)=>{
  await p.getByRole('tab',{name:/^Link$/i}).first().click();
  if(await p.locator('.link-box.lit').count())await p.locator('.link-box').click();
  await p.locator('.fx-pad-main').first().click();await p.waitForTimeout(300);
  await p.getByRole('button',{name:/By name/}).first().click();await p.waitForTimeout(300);
  await p.locator('.source-inspector').getByRole('tab',{name:'Shape'}).or(p.locator('.source-inspector button',{hasText:/^Shape$/})).first().click();
  await p.waitForTimeout(400);await shot('sheet-shape');
  await p.keyboard.press('Escape');await p.waitForTimeout(200);
  await p.locator('.lp-morph-tile').click();await p.waitForTimeout(400);await shot('morph-open');
  const clipped=await p.evaluate(()=>{const ed=document.querySelector('.lp-editor.lp-morph').getBoundingClientRect();
    return [...document.querySelectorAll('.lp-morph button,.lp-morph select')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&(r.right>ed.right+1||r.bottom>ed.bottom+1);}).length;});
  console.log('morph controls outside the editor',clipped);
};
