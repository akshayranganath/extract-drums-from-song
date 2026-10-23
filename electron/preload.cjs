const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Expose narrow app actions instead of giving the renderer raw ipcRenderer access.
contextBridge.exposeInMainWorld('drumApp', {
  chooseAudio: () => ipcRenderer.invoke('audio:choose'),
  registerDroppedAudio: (filePath) => ipcRenderer.invoke('audio:register-drop', filePath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  startSeparation: (mode) => ipcRenderer.invoke('separation:start', mode),
  cancelSeparation: () => ipcRenderer.invoke('separation:cancel'),
  openOutputInVlc: () => ipcRenderer.invoke('player:open-output'),
  // Return an unsubscribe function so a reloaded page cannot accumulate listeners.
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('separation:progress', listener);
    return () => ipcRenderer.removeListener('separation:progress', listener);
  },
});
