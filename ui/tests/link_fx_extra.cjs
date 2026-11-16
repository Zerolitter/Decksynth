// FX page with effects: add five from the empty-state picker and the Add effect card, then shoot; also the Sound graph views.
module.exports=async(p,shot)=>{
  const tab=n=>p.getByRole('tab',{name:new RegExp('^'+n+'$','i')}).first().click();
  if(await p.locator('.link-box.lit').count())await p.locator('.link-box').click();
  await tab('Sound');
  const synth=p.getByRole('radiogroup',{name:'Track instrument'}).getByRole('radio',{name:'Synth',exact:true});
  if(await synth.count())await synth.click();
  await p.getByRole('radio',{name:/Amp env/}).click();await shot('sound-amp');
  await p.getByRole('radio',{name:/Filter env/}).click();await shot('sound-filter');
  await p.getByRole('radio',{name:/^Wave/}).click();
  await tab('FX');
  for(const name of ['Delay','Reverb','Chorus','Phaser','EQ']){
    const grid=p.locator('.fx-picker-grid button',{hasText:new RegExp('^'+name)});
    if(!(await grid.count()))await p.getByRole('button',{name:'Add effect'}).first().click();
    await p.locator('.fx-picker-grid button',{hasText:new RegExp('^'+name)}).first().click();await p.waitForTimeout(250);
  }
  await shot('fx-five');
};
