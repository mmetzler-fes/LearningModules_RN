const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getModules: () => ipcRenderer.invoke('get-modules'),
  saveModule: (moduleData) => ipcRenderer.invoke('save-module', moduleData),
  deleteModule: (moduleId) => ipcRenderer.invoke('delete-module', moduleId),
  exportModules: (moduleIds) => ipcRenderer.invoke('export-modules', moduleIds),
  importModules: () => ipcRenderer.invoke('import-modules'),
  getH5pContentPath: () => ipcRenderer.invoke('get-h5p-content-path'),
  onMenuImport: (callback) => ipcRenderer.on('menu-import', callback),
  onMenuExport: (callback) => ipcRenderer.on('menu-export', callback),
});
