// Morph pad path speed reaches 32 bars (Sir, 16 Nov: "32 bars should be plenty").
module.exports=async(p,shot)=>{
  await p.getByRole('tab',{name:/^Link$/i}).first().click();
  await p.locator('.lp-morph-tile').click();
  const slower=p.getByRole('button',{name:'Slower path'});
  for(let i=0;i<12&&await slower.isEnabled();i++){await slower.click();await p.waitForTimeout(80);}
  const label=(await p.locator('.morph-rate strong').first().textContent())||'';
  const box=await p.locator('.morph-rate strong').first().evaluate(e=>({sw:e.scrollWidth,cw:e.clientWidth}));
  console.log('slowest path',JSON.stringify(label),'fits',box.sw<=box.cw);
  await shot('morph-32');
  if(label.trim()!=='32 bars')throw new Error('slowest path is '+label);
};
