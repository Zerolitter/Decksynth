'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const out=path.join(__dirname,'..','references');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
  fs.mkdirSync(out,{recursive:true});
  const win=new BrowserWindow({
    show:false,frame:false,width:1280,height:746,
    backgroundColor:'#111315',
    webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,sandbox:true}
  });
  win.webContents.on('console-message',(_, level, message)=>console.log('BROWSER CONSOLE',level,message));
  win.webContents.on('did-fail-load',(_,code,reason)=>console.error('LOAD FAIL',code,reason));
  try{
    await win.loadFile(path.join(__dirname,'..','dist','index.html'));
    await delay(1100);
    const info=await win.webContents.executeJavaScript("({title:document.title,root:document.querySelector('#root')?.children.length,body:document.body.innerText.slice(0,850),size:[innerWidth,innerHeight]})");
    console.log('DOM',JSON.stringify(info));
    const clipCheck=await win.webContents.executeJavaScript("(()=>{const notes=[...document.querySelectorAll('.clip-note')];const clipped=notes.filter(n=>{const nr=n.getBoundingClientRect(),pr=n.parentElement.getBoundingClientRect();return nr.bottom>pr.bottom+1||nr.top<pr.top-1;});return {notes:notes.length,clipped:clipped.length,details:clipped.map(x=>({label:x.title}))}})()");
    console.log('NOTE VISIBILITY',JSON.stringify(clipCheck));
    if(clipCheck.clipped>0)throw Error('Some notes render outside clip lanes');
    const pads=await win.webContents.executeJavaScript("(()=>{const a=[...document.querySelectorAll('.step-hardware-pad')];return {count:a.length,tag:a[0]?.tagName,display:a[0]&&getComputedStyle(a[0]).display,padding:a[0]&&getComputedStyle(a[0]).padding,background:a[0]&&getComputedStyle(a[0]).backgroundImage,clock:document.querySelector('[data-testid=pattern-live-step]')?.textContent?.trim()}})()");
    console.log('PATTERN PAD STYLE',JSON.stringify(pads));
    if(pads.count!==16 || pads.display!=='flex' || !pads.background?.includes('gradient'))throw Error('Hardware pad styling or count invalid');
    const song=await win.webContents.capturePage();
    fs.writeFileSync(path.join(out,'decksynth-song-preview.png'),song.toPNG());
    console.log('CAPTURED SONG',song.getSize(),song.toPNG().length);
    const clicked=await win.webContents.executeJavaScript("(()=>{const b=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.toLowerCase().includes('sound'));if(b){b.click();return true}return false})()");
    console.log('CLICKED SOUND?',clicked);
    await delay(700);
    const aside=await win.webContents.executeJavaScript("(()=>{const a=document.querySelector('.patch-browser');return a?{width:a.getBoundingClientRect().width,height:a.getBoundingClientRect().height,display:getComputedStyle(a).display}:null})()");
    console.log('PATCH BROWSER',JSON.stringify(aside));
    const snd=await win.webContents.capturePage();
    fs.writeFileSync(path.join(out,'decksynth-sound-preview.png'),snd.toPNG());
    console.log('CAPTURED SOUND',snd.getSize(),snd.toPNG().length);
    const js=await win.webContents.executeJavaScript("({panels:document.querySelectorAll('.rack-card').length,knobs:document.querySelectorAll('.parameter-knob').length,steps:document.querySelectorAll('.pattern-step').length})");
    console.log('UI COUNTS',JSON.stringify(js));
  }finally {win.destroy();app.quit();}
}
app.whenReady().then(main).catch(error=>{console.error(error);app.exit(1);});
