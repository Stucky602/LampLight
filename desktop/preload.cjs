// The only doorway between the game page and the computer. Sandboxed: no file system here; every
// call goes over IPC to main.cjs, which checks the caller and validates the arguments.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lamplightNative', Object.freeze({
  platform: 'desktop',
  readSave: (kind) => ipcRenderer.invoke('save:read', kind),
  writeSave: (kind, text, opts) => ipcRenderer.invoke('save:write', kind, text, opts),
  quarantineSave: (kind) => ipcRenderer.invoke('save:quarantine', kind),
  writeReplay: (name, bytes) => ipcRenderer.invoke('replay:write', name, bytes),
  writeReport: (name, text) => ipcRenderer.invoke('report:write', name, text),
  openSavesFolder: () => ipcRenderer.invoke('app:openSaves'),
  setFullscreen: (on) => ipcRenderer.invoke('app:fullscreen', on),
  setDisplayMode: (mode) => ipcRenderer.invoke('app:displayMode', mode),
  quit: () => ipcRenderer.invoke('app:quit'),
  setUnsaved: (on) => ipcRenderer.invoke('app:unsaved', on === true),
  ready: () => ipcRenderer.invoke('app:ready'),
  onDisplayModeChanged: (fn) => {
    const f = (_e, mode) => fn(mode);
    ipcRenderer.on('app:displayModeChanged', f);
    return () => ipcRenderer.removeListener('app:displayModeChanged', f);
  },
  info: () => ipcRenderer.invoke('app:info'),
  smokeDone: (result) => ipcRenderer.invoke('smoke:done', result),
}));
