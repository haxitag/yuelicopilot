const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yueliDesktop', {
  platform: process.platform,
  pickFiles: () => ipcRenderer.invoke('yueli:pick-files'),
  pickDirectory: () => ipcRenderer.invoke('yueli:pick-directory'),
  openDevTools: () => ipcRenderer.invoke('yueli:open-devtools'),
  restartBackend: () => ipcRenderer.invoke('yueli:restart-backend'),
});
