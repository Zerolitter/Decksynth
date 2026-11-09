// Isolated renderer gate: no Python bridge, device access or owner profile.
const {app,BrowserWindow,Menu}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'decksynth-clock-gate-')));
app.whenReady().then(()=>{
 Menu.setApplicationMenu(null);
 const win=new BrowserWindow({width:1280,height:718,show:true,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false,sandbox:true}});
 win.loadURL('about:blank');
});
app.on('window-all-closed',()=>app.quit());
