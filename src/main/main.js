const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(app.getPath('userData'), 'learning-modules');
const MODULES_FILE = path.join(DATA_DIR, 'modules.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(MODULES_FILE)) {
    fs.writeFileSync(MODULES_FILE, JSON.stringify({ modules: [] }, null, 2), 'utf-8');
  }
}

function loadModules() {
  ensureDataDir();
  const raw = fs.readFileSync(MODULES_FILE, 'utf-8');
  return JSON.parse(raw);
}

function saveModules(data) {
  ensureDataDir();
  fs.writeFileSync(MODULES_FILE, JSON.stringify(data, null, 2), 'utf-8');
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
              message: 'LearningModules v1.0.0',
              detail: 'Interaktive Lernmodule mit H5P.\nErstellt mit Electron.',
            });
          },
        },
      ],
    },
  ];
}

// --- IPC Handlers ---

ipcMain.handle('get-modules', () => {
  return loadModules();
});

ipcMain.handle('save-module', (_event, moduleData) => {
  const data = loadModules();
  const existingIdx = data.modules.findIndex((m) => m.id === moduleData.id);
  if (existingIdx >= 0) {
    data.modules[existingIdx] = moduleData;
  } else {
    data.modules.push(moduleData);
  }
  saveModules(data);
  return { success: true };
});

ipcMain.handle('delete-module', (_event, moduleId) => {
  const data = loadModules();
  data.modules = data.modules.filter((m) => m.id !== moduleId);
  saveModules(data);
  return { success: true };
});

ipcMain.handle('export-modules', async (_event, moduleIds) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Module exportieren',
    defaultPath: 'lernmodule-export.json',
    filters: [{ name: 'JSON-Dateien', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { success: false };

  const data = loadModules();
  let exportData;
  if (moduleIds && moduleIds.length > 0) {
    exportData = {
      exportVersion: '1.0',
      exportDate: new Date().toISOString(),
      modules: data.modules.filter((m) => moduleIds.includes(m.id)),
    };
  } else {
    exportData = {
      exportVersion: '1.0',
      exportDate: new Date().toISOString(),
      modules: data.modules,
    };
  }

  fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf-8');
  return { success: true, filePath };
});

ipcMain.handle('import-modules', async () => {
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

  if (!importData.modules || !Array.isArray(importData.modules)) {
    return { success: false, error: 'Ungültiges Export-Format: "modules" Array fehlt' };
  }

  const data = loadModules();
  let importedCount = 0;
  for (const mod of importData.modules) {
    if (!mod.id || !mod.title || !mod.type) continue;
    const existingIdx = data.modules.findIndex((m) => m.id === mod.id);
    if (existingIdx >= 0) {
      data.modules[existingIdx] = mod;
    } else {
      data.modules.push(mod);
    }
    importedCount++;
  }
  saveModules(data);
  return { success: true, importedCount };
});

ipcMain.handle('get-h5p-content-path', () => {
  return path.join(__dirname, '../../h5p-content');
});

// --- App lifecycle ---

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
