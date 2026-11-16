// Sir's screencast 16 Nov: Link page mod pad graph grows; By name sheet is squashed. Watch the graph height over time.
module.exports=async(p,shot)=>{
  await p.getByRole('tab',{name:/^Link$/i}).first().click();
  if(await p.locator('.link-box.lit').count())await p.locator('.link-box').click();
  await p.locator('.fx-pad-main').first().click();await p.waitForTimeout(300);
  const h=()=>p.evaluate(()=>{const g=document.querySelector('.lp-editor .pad-graph-editor');const e=document.querySelector('.lp-editor');
    return {graph:g?Math.round(g.getBoundingClientRect().height):null,editor:e?Math.round(e.getBoundingClientRect().height):null,cls:g?.className?.baseVal??g?.className};});
  for(let i=0;i<5;i++){console.log('t'+i,JSON.stringify(await h()));await p.waitForTimeout(1000);}
  await shot('link-wait');
  await p.getByRole('button',{name:/By name/}).first().click();await p.waitForTimeout(500);
  await shot('link-byname');
};
