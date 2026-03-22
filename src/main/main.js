const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Linux: disable GPU/hardware acceleration to prevent SIGSEGV crashes
if (process.platform === 'linux') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}
const express = require('express');
const QRCode = require('qrcode');

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
const WEB_PORT = 3000;
let webServerUrl = null;

// --- Network helpers ---
function getPreferredIP() {
  const interfaces = os.networkInterfaces();
  
  // Kategorisiere Netzwerk-Interfaces
  let wlanIPs = [];
  let lanIPs = [];
  let otherIPs = [];

  for (const name of Object.keys(interfaces)) {
    // Bestimme Typ des Interfaces basierend auf Namen
    const lowerName = name.toLowerCase();
    const isWLAN = /wi-?fi|wlan|wireless/.test(lowerName);
    const isLAN = /ethernet|eth|en\d|bridge/.test(lowerName);

    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        if (isWLAN) {
          wlanIPs.push(iface.address);
        } else if (isLAN) {
          lanIPs.push(iface.address);
        } else {
          otherIPs.push(iface.address);
        }
      }
    }
  }

  // Bevorzuge WLAN > LAN > Andere
  if (wlanIPs.length > 0) {
    console.log(`WLAN IP gefunden: ${wlanIPs[0]}`);
    return wlanIPs[0];
  }
  if (lanIPs.length > 0) {
    console.log(`LAN IP gefunden: ${lanIPs[0]}`);
    return lanIPs[0];
  }
  if (otherIPs.length > 0) {
    console.log(`Andere IP gefunden: ${otherIPs[0]}`);
    return otherIPs[0];
  }
  
  return null;
}

// --- Embedded Web Server for WLAN access ---
function startWebServer() {
  const web = express();
  const rendererDir = path.join(__dirname, '../renderer');
  const assetsDir = path.join(__dirname, '../../assets');

  // REST API for read-only student access
  web.get('/api/selected-topics', (_req, res) => {
    const db = loadDB();
    const selected = (db.topics || []).filter((t) => t.selected !== false);
    // Return topics with only selected modules
    const cleaned = selected.map((topic) => ({
      ...topic,
      modules: (topic.modules || []).filter((m) => m.moduleSelected !== false),
    }));
    res.json(cleaned);
  });

  web.get('/api/topics/:topicId/modules', (req, res) => {
    const db = loadDB();
    const topic = (db.topics || []).find((t) => t.id === req.params.topicId);
    if (!topic) return res.json([]);
    res.json((topic.modules || []).filter((m) => m.moduleSelected !== false));
  });

  web.get('/api/student-selections/:username', (req, res) => {
    const db = loadDB();
    res.json(db.studentSelectedTopics[req.params.username] || []);
  });

  web.post('/api/student-selections/:username', express.json({ limit: '1mb' }), (req, res) => {
    const db = loadDB();
    if (!db.studentSelectedTopics) db.studentSelectedTopics = {};
    db.studentSelectedTopics[req.params.username] = req.body.topicIds || [];
    saveDB(db);
    res.json({ success: true });
  });

  web.post('/api/quiz-result', express.json({ limit: '10mb' }), (req, res) => {
    const db = loadDB();
    const resultData = req.body;
    resultData.id = db.nextResultId++;
    resultData.timestamp = new Date().toISOString();
    db.results.push(resultData);
    saveDB(db);
    res.json({ success: true, id: resultData.id });
  });

  // QR code endpoint — generates SVG dynamically
  web.get('/api/qrcode.svg', async (_req, res) => {
    if (!webServerUrl) return res.status(503).send('Server not ready');
    try {
      const svg = await QRCode.toString(webServerUrl, { type: 'svg', margin: 1 });
      res.type('image/svg+xml').send(svg);
    } catch (e) {
      res.status(500).send('QR generation failed');
    }
  });

  // Serve static assets (images in content use data: URLs, but we need CSS/JS/icons)
  web.use('/assets', express.static(assetsDir));
  web.use(express.static(rendererDir));

  // Fallback: serve index.html for SPA-style routing
  web.get('*', (_req, res) => {
    res.sendFile(path.join(rendererDir, 'index.html'));
  });

  const server = web.listen(WEB_PORT, '0.0.0.0', () => {
    const ip = getPreferredIP();
    const port = server.address().port;
    if (ip) {
      webServerUrl = `http://${ip}:${port}`;
      console.log(`Web-Server gestartet: ${webServerUrl}`);
    } else {
      webServerUrl = `http://localhost:${port}`;
      console.log(`Web-Server gestartet (nur lokal): ${webServerUrl}`);
    }
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${WEB_PORT} belegt, versuche alternativen Port...`);
      const altServer = web.listen(0, '0.0.0.0', () => {
        const ip = getPreferredIP();
        const port = altServer.address().port;
        if (ip) {
          webServerUrl = `http://${ip}:${port}`;
        } else {
          webServerUrl = `http://localhost:${port}`;
        }
        console.log(`Web-Server gestartet auf alternativem Port: ${webServerUrl}`);
      });
    } else {
      console.error('Web-Server Fehler:', err.message);
    }
  });
}

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

ipcMain.handle('toggle-module-selection', (_event, topicId, moduleId, selected) => {
  const db = loadDB();
  const topic = db.topics.find((t) => t.id === topicId);
  if (!topic) return { success: false };
  const mod = (topic.modules || []).find((m) => m.id === moduleId);
  if (!mod) return { success: false };
  mod.moduleSelected = selected;
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

  const allModules = topic.modules || [];
  const selectedModules = allModules.filter((m) => m.moduleSelected !== false);
  const exportData = {
    exportVersion: '2.0',
    exportDate: new Date().toISOString(),
    topic: {
      title: topic.title,
      description: topic.description,
      modules: selectedModules,
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

ipcMain.handle('import-modules-to-topic', async (_event, topicId) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Module importieren',
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

  let importModules = [];
  if (importData.topic && importData.topic.modules) {
    importModules = importData.topic.modules;
  } else if (importData.modules && Array.isArray(importData.modules)) {
    importModules = importData.modules;
  }
  if (importModules.length === 0) {
    return { success: false, error: 'Keine Module in der Datei gefunden' };
  }

  return {
    success: true,
    modules: importModules.map((m) => ({
      id: m.id,
      title: m.title,
      type: m.type,
      description: m.description || '',
    })),
    _fullModules: importModules,
  };
});

ipcMain.handle('confirm-import-modules', (_event, topicId, modules) => {
  const db = loadDB();
  const topic = db.topics.find((t) => t.id === topicId);
  if (!topic) return { success: false, error: 'Thema nicht gefunden' };
  if (!topic.modules) topic.modules = [];

  for (const mod of modules) {
    mod.id = 'mod_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    mod.moduleSelected = true;
    topic.modules.push(mod);
  }
  saveDB(db);
  return { success: true, importedCount: modules.length };
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

ipcMain.handle('select-image', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Bild auswählen',
    filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'] }],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return { success: false };
  const filePath = filePaths[0];
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' };
  const mime = mimeMap[ext] || 'image/png';
  const data = fs.readFileSync(filePath);
  const base64 = data.toString('base64');
  return { success: true, dataUrl: `data:${mime};base64,${base64}` };
});

ipcMain.handle('select-audio', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Audio auswählen',
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'webm'] }],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return { success: false };
  const filePath = filePaths[0];
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac', m4a: 'audio/mp4', webm: 'audio/webm' };
  const mime = mimeMap[ext] || 'audio/mpeg';
  const data = fs.readFileSync(filePath);
  const base64 = data.toString('base64');
  return { success: true, dataUrl: `data:${mime};base64,${base64}` };
});

ipcMain.on('focus-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    mainWindow.webContents.focus();
  }
});

ipcMain.handle('get-web-server-url', () => {
  return webServerUrl;
});

// --- App lifecycle ---

app.whenReady().then(() => {
  createWindow();
  startWebServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
