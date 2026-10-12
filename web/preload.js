const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reviewAPI', {
  setList: (list) => ipcRenderer.invoke('set-list', list),
  decide: (slot, decision) => ipcRenderer.invoke('decide', { slot, decision }),
  reloadSlot: (slot) => ipcRenderer.invoke('reload-slot', slot),
  exportResults: () => ipcRenderer.invoke('export-results'),
  onState: (cb) => ipcRenderer.on('state', (_e, state) => cb(state))
});
