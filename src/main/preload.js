const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Authentication
  verifyAdmin: (username, password) => ipcRenderer.invoke('verify-admin', username, password),
  getAdminCredentials: () => ipcRenderer.invoke('get-admin-credentials'),
  updateAdminPassword: (newPassword) => ipcRenderer.invoke('update-admin-password', newPassword),

  // Topics CRUD
  getTopics: () => ipcRenderer.invoke('get-topics'),
  saveTopic: (topicData) => ipcRenderer.invoke('save-topic', topicData),
  deleteTopic: (topicId) => ipcRenderer.invoke('delete-topic', topicId),
  toggleTopicSelection: (topicId, selected) => ipcRenderer.invoke('toggle-topic-selection', topicId, selected),

  // Modules CRUD (within a topic)
  getTopicModules: (topicId) => ipcRenderer.invoke('get-topic-modules', topicId),
  saveModule: (topicId, moduleData) => ipcRenderer.invoke('save-module', topicId, moduleData),
  deleteModule: (topicId, moduleId) => ipcRenderer.invoke('delete-module', topicId, moduleId),
  toggleModuleSelection: (topicId, moduleId, selected) => ipcRenderer.invoke('toggle-module-selection', topicId, moduleId, selected),

  // Export/Import
  exportTopic: (topicId) => ipcRenderer.invoke('export-topic', topicId),
  importTopic: () => ipcRenderer.invoke('import-topic'),
  importModulesToTopic: (topicId) => ipcRenderer.invoke('import-modules-to-topic', topicId),
  confirmImportModules: (topicId, modules) => ipcRenderer.invoke('confirm-import-modules', topicId, modules),

  // H5P import/export
  importH5p: () => ipcRenderer.invoke('import-h5p'),
  exportTopicAsH5p: (topicId) => ipcRenderer.invoke('export-topic-as-h5p', topicId),

  // Student selections
  getSelectedTopics: () => ipcRenderer.invoke('get-selected-topics'),
  getStudentSelections: (username) => ipcRenderer.invoke('get-student-selections', username),
  saveStudentSelections: (username, topicIds) => ipcRenderer.invoke('save-student-selections', username, topicIds),

  // Quiz Results
  saveQuizResult: (resultData) => ipcRenderer.invoke('save-quiz-result', resultData),
  getQuizResults: () => ipcRenderer.invoke('get-quiz-results'),
  deleteQuizResult: (resultId) => ipcRenderer.invoke('delete-quiz-result', resultId),
  deleteAllQuizResults: () => ipcRenderer.invoke('delete-all-quiz-results'),

  // H5P
  getH5pContentPath: () => ipcRenderer.invoke('get-h5p-content-path'),
  selectImage: () => ipcRenderer.invoke('select-image'),
  selectAudio: () => ipcRenderer.invoke('select-audio'),

  // Menu events
  onMenuImport: (callback) => ipcRenderer.on('menu-import', callback),
  onMenuExport: (callback) => ipcRenderer.on('menu-export', callback),

  // Window focus recovery (fixes Electron focus corruption after native dialogs)
  focusWindow: () => ipcRenderer.send('focus-window'),

  // Web server URL for WLAN access
  getWebServerUrl: () => ipcRenderer.invoke('get-web-server-url'),
});
