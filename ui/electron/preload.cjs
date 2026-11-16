'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('deckApi', {
  send: (command, args = null) => ipcRenderer.send('deck-command', command, args),
  onMessage: callback => {
    const handler = (_, message) => callback(message);
    ipcRenderer.on('deck-message', handler);
    ipcRenderer.send('deck-snapshot-request');
    return () => ipcRenderer.removeListener('deck-message', handler);
  },
  chooseFile: (operation, extension) => ipcRenderer.invoke('deck-file-dialog', operation, extension),
  windowAction: op => ipcRenderer.send('deck-window', op),
  available: true,
});
