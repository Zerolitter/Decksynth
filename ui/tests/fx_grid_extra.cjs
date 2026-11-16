// FX grid (Sir, 16 Nov): Sir's chain of 7 effects, then 10. Checks cards line up in whole columns and fit at 718.
module.exports=async(p,shot)=>{
  await p.getByRole('tab',{name:/^FX$/i}).first().click();
  if(await p.locator('.link-box.lit').count())await p.locator('.link-box').click();
  const add=async n=>{
    if(await p.locator('.fx-cards [aria-label="Remove '+n+'"]').count())return;
    const open=p.locator('.fx-add-open');if(await open.count())await open.click();
    await p.locator('[aria-label="Add '+n+'"]').first().click();await p.waitForTimeout(150);
  };
  const measure=async label=>{
    const r=await p.evaluate(()=>{const rack=document.querySelector('.fx-cards'),cards=[...rack.children].filter(c=>c.matches('.ds-panel,.fx-add-card'));
      const rr=rack.getBoundingClientRect();
      return {rows:new Set(cards.map(c=>Math.round(c.getBoundingClientRect().top))).size,
        bottom:Math.max(...cards.map(c=>c.getBoundingClientRect().bottom)),rackBottom:rr.bottom,scroll:rack.scrollHeight>rack.clientHeight+1,
        lefts:[...new Set(cards.map(c=>Math.round(c.getBoundingClientRect().left)))].sort((a,b)=>a-b),
        rights:Math.max(...cards.map(c=>c.getBoundingClientRect().right))-rr.right};});
    console.log(label,JSON.stringify(r));
  };
  for(const n of ['Resonator','Stutter','Cloud','Audio gate','Time','EQ','Reverb'])await add(n);
  await shot('fx-grid-7');await measure('seven');
  for(const n of ['Delay','Chorus','Filter'])await add(n);
  await shot('fx-grid-10');await measure('ten');
};
