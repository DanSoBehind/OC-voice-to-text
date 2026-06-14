const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ocApi', {
  setTrayState: (state) => ipcRenderer.invoke('tray:set-state', state),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  openSettings: () => ipcRenderer.invoke('settings:open'),
  hideSettings: () => ipcRenderer.invoke('settings:hide'),
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  downloadWhisper: (model) => ipcRenderer.invoke('whisper:download', model),
  whisperStatus: () => ipcRenderer.invoke('whisper:status'),
  notifyIndicatorClick: () => ipcRenderer.send('indicator:click'),
  on: (channel, listener) => {
    const allowed = [
      'recording:starting',
      'recording:start',
      'recording:stop',
      'transcribing',
      'done',
      'error',
    ];
    if (!allowed.includes(channel)) return () => {};
    const wrapped = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
