const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(app.getPath('userData'), 'learning-modules');
const DB_FILE = path.join(DATA_DIR, 'database.json');

// --- Default database structure ---
const DEFAULT_DB = {
  admin: { username: 'admin', password: 'lehrer1' },
  topics: [],
  results: [],
  studentSelectedTopics: {},
  nextResultId: 1,
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2), 'utf-8');
  }
}

function loadDB() {
  ensureDataDir();
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  const db = JSON.parse(raw);
  // Ensure all keys exist (migration from old format)
  if (!db.admin) db.admin = DEFAULT_DB.admin;
  if (!db.topics) db.topics = [];
  if (!db.results) db.results = [];
  if (!db.studentSelectedTopics) db.studentSelectedTopics = {};
  if (!db.nextResultId) db.nextResultId = 1;
  // Migrate old modules.json format: convert flat modules list into a single topic
  if (db.modules && Array.isArray(db.modules) && db.modules.length > 0) {
    db.topics.push({
      id: 'topic_migrated',
      title: 'Importierte Module',
      description: 'Automatisch migrierte Module aus der vorherigen Version',
      selected: true,
      createdAt: new Date().toISOString(),
      modules: db.modules,
    });
    delete db.modules;
    saveDB(db);
  }
  return db;
}

function saveDB(db) {
  ensureDataDir();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'LearningModules',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../../assets/icons/icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  const menu = Menu.buildFromTemplate(getMenuTemplate());
  Menu.setApplicationMenu(menu);
}

function getMenuTemplate() {
  return [
    {
      label: 'Datei',
      submenu: [
        {
          label: 'Module importieren...',
          accelerator: 'CmdOrCtrl+I',
          click: () => mainWindow.webContents.send('menu-import'),
        },
        {
          label: 'Module exportieren...',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow.webContents.send('menu-export'),
        },
        { type: 'separator' },
        {
          label: 'Beenden',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'reload', label: 'Neu laden' },
        { role: 'toggleDevTools', label: 'Entwicklertools' },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Vergrößern' },
        { role: 'zoomOut', label: 'Verkleinern' },
        { role: 'resetZoom', label: 'Zoom zurücksetzen' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbild' },
      ],
    },
    {
      label: 'Hilfe',
      submenu: [
        {
          label: 'Über LearningModules',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Über LearningModules',
              message: 'LearningModules v2.0.0',
              detail: 'Interaktive Lernmodule mit H5P.\nLehrer- & Schüler-System.\nErstellt mit Electron.',
            });
          },
        },
      ],
    },
  ];
}

// --- IPC: Authentication ---

ipcMain.handle('verify-admin', (_event, username, password) => {
  const db = loadDB();
  return db.admin.username === username && db.admin.password === password;
});

ipcMain.handle('get-admin-credentials', () => {
  const db = loadDB();
  return { username: db.admin.username };
});

ipcMain.handle('update-admin-password', (_event, newPassword) => {
  const db = loadDB();
  db.admin.password = newPassword;
  saveDB(db);
  return { success: true };
});

// --- IPC: Topics CRUD ---

ipcMain.handle('get-topics', () => {
  const db = loadDB();
  return db.topics;
});

ipcMain.handle('save-topic', (_event, topicData) => {
  const db = loadDB();
  const idx = db.topics.findIndex((t) => t.id === topicData.id);
  if (idx >= 0) {
    // Preserve modules when updating topic metadata
    topicData.modules = topicData.modules || db.topics[idx].modules || [];
    db.topics[idx] = topicData;
  } else {
    topicData.modules = topicData.modules || [];
    db.topics.push(topicData);
  }
  saveDB(db);
  return { success: true };
});

ipcMain.handle('delete-topic', (_event, topicId) => {
  const db = loadDB();
  db.topics = db.topics.filter((t) => t.id !== topicId);
  saveDB(db);
  return { success: true };
});

ipcMain.handle('toggle-topic-selection', (_event, topicId, selected) => {
  const db = loadDB();
  const topic = db.topics.find((t) => t.id === topicId);
  if (topic) {
    topic.selected = selected;
    saveDB(db);
  }
  return { success: true };
});

// --- IPC: Modules CRUD (within a topic) ---

ipcMain.handle('get-topic-modules', (_event, topicId) => {
  const db = loadDB();
  const topic = db.topics.find((t) => t.id === topicId);
  return topic ? topic.modules || [] : [];
});

ipcMain.handle('save-module', (_event, topicId, moduleData) => {
  const db = loadDB();
  const topic = db.topics.find((t) => t.id === topicId);
  if (!topic) return { success: false, error: 'Thema nicht gefunden' };
  if (!topic.modules) topic.modules = [];
  const idx = topic.modules.findIndex((m) => m.id === moduleData.id);
  if (idx >= 0) {
    topic.modules[idx] = moduleData;
  } else {
    topic.modules.push(moduleData);
  }
  saveDB(db);
  return { success: true };
});

ipcMain.handle('delete-module', (_event, topicId, moduleId) => {
  const db = loadDB();
  const topic = db.topics.find((t) => t.id === topicId);
  if (!topic) return { success: false };
  topic.modules = (topic.modules || []).filter((m) => m.id !== moduleId);
  saveDB(db);
  return { success: true };
});

// --- IPC: Export/Import (per topic) ---

ipcMain.handle('export-topic', async (_event, topicId) => {
  const db = loadDB();
  const topic = db.topics.find((t) => t.id === topicId);
  if (!topic) return { success: false, error: 'Thema nicht gefunden' };

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Lernthema exportieren',
    defaultPath: `${topic.title.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g, '_')}.json`,
    filters: [{ name: 'JSON-Dateien', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { success: false };

  const exportData = {
    exportVersion: '2.0',
    exportDate: new Date().toISOString(),
    topic: {
      title: topic.title,
      description: topic.description,
      modules: topic.modules || [],
    },
  };
  fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf-8');
  return { success: true, filePath };
});

ipcMain.handle('import-topic', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Lernthema importieren',
    filters: [{ name: 'JSON-Dateien', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return { success: false };

  const raw = fs.readFileSync(filePaths[0], 'utf-8');
  let importData;
  try {
    importData = JSON.parse(raw);
  } catch {
    return { success: false, error: 'Ungültiges JSON-Format' };
  }

  const db = loadDB();

  // Support v2.0 format (topic) and v1.0 format (flat modules)
  if (importData.topic) {
    const newTopic = {
      id: 'topic_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
      title: importData.topic.title || 'Importiertes Thema',
      description: importData.topic.description || '',
      selected: false,
      createdAt: new Date().toISOString(),
      modules: importData.topic.modules || [],
    };
    db.topics.push(newTopic);
    saveDB(db);
    return { success: true, importedCount: (newTopic.modules || []).length, topicTitle: newTopic.title };
  } else if (importData.modules && Array.isArray(importData.modules)) {
    // Legacy v1.0 format
    const newTopic = {
      id: 'topic_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
      title: 'Importierte Module',
      description: 'Importiert aus einer v1.0 Exportdatei',
      selected: false,
      createdAt: new Date().toISOString(),
      modules: importData.modules,
    };
    db.topics.push(newTopic);
    saveDB(db);
    return { success: true, importedCount: importData.modules.length, topicTitle: newTopic.title };
  }

  return { success: false, error: 'Ungültiges Export-Format' };
});

// --- IPC: Student topic selection ---

ipcMain.handle('get-selected-topics', () => {
  const db = loadDB();
  // Return only topics the teacher has enabled (selected = true)
  return db.topics.filter((t) => t.selected);
});

ipcMain.handle('get-student-selections', (_event, username) => {
  const db = loadDB();
  return db.studentSelectedTopics[username] || [];
});

ipcMain.handle('save-student-selections', (_event, username, topicIds) => {
  const db = loadDB();
  db.studentSelectedTopics[username] = topicIds;
  saveDB(db);
  return { success: true };
});

// --- IPC: Quiz Results ---

ipcMain.handle('save-quiz-result', (_event, resultData) => {
  const db = loadDB();
  resultData.id = db.nextResultId++;
  resultData.timestamp = new Date().toISOString();
  db.results.push(resultData);
  saveDB(db);
  return { success: true, id: resultData.id };
});

ipcMain.handle('get-quiz-results', () => {
  const db = loadDB();
  return db.results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
});

ipcMain.handle('delete-quiz-result', (_event, resultId) => {
  const db = loadDB();
  db.results = db.results.filter((r) => r.id !== resultId);
  saveDB(db);
  return { success: true };
});

ipcMain.handle('delete-all-quiz-results', () => {
  const db = loadDB();
  db.results = [];
  saveDB(db);
  return { success: true };
});

ipcMain.handle('get-h5p-content-path', () => {
  return path.join(__dirname, '../../h5p-content');
});

ipcMain.on('focus-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    mainWindow.webContents.focus();
  }
});

// --- App lifecycle ---

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
