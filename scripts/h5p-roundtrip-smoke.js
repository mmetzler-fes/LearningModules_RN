const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
const functionsStart = source.indexOf('function readZip(');
const functionsEnd = source.indexOf('let mainWindow;');
if (functionsStart < 0 || functionsEnd < 0 || functionsEnd <= functionsStart) {
  throw new Error('Could not locate helper-function block in main.js');
}
const extractedCode = source.slice(functionsStart, functionsEnd);
const sandbox = {
  require,
  path,
  zlib: require('zlib'),
  Buffer,
  Math,
  Date,
  console,
};
vm.createContext(sandbox);
vm.runInContext(extractedCode, sandbox);

const readZip = sandbox.readZip;
const convertH5pToNative = sandbox.convertH5pToNative;
const convertNativeModuleToH5pQuestion = sandbox.convertNativeModuleToH5pQuestion;

const h5pPath = path.join(__dirname, '..', 'examples', 'Kurztest_BFK.h5p');
const buf = fs.readFileSync(h5pPath);
const entries = readZip(buf);

const h5pMeta = JSON.parse(entries['h5p.json'].toString('utf8'));
const content = JSON.parse(entries['content/content.json'].toString('utf8'));

const h5pImages = {};
for (const [entryName, entryData] of Object.entries(entries)) {
  if (entryName.startsWith('content/images/')) {
    const fileName = path.basename(entryName);
    const ext = path.extname(fileName).toLowerCase().slice(1);
    const mimeByExt = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      webp: 'image/webp',
      bmp: 'image/bmp',
    };
    const mime = mimeByExt[ext] || 'image/png';
    h5pImages[fileName] = `data:${mime};base64,${entryData.toString('base64')}`;
  }
}

const questionSet = Array.isArray(content.questions) ? content.questions : [];
const importedModules = questionSet.map((q, idx) => {
  const machineName = (q.library || '').split(' ')[0];
  const converted = convertH5pToNative(machineName, q.params || {}, h5pImages);
  return {
    id: `smoke_${idx + 1}`,
    title: (q.metadata && q.metadata.title) || `Q${idx + 1}`,
    type: converted ? converted.type : 'h5p_native',
    content: converted
      ? converted.content
      : {
          library: q.library || '',
          machineName,
          params: q.params || {},
          subContentId: (q.subContentId || `fallback_${idx + 1}`),
        },
  };
});

const nativeCount = importedModules.filter((m) => m.type !== 'h5p_native').length;
const fallbackCount = importedModules.length - nativeCount;

const dragModules = importedModules.filter((m) => m.type === 'dragAndDrop');
const sourceDragQuestions = questionSet.filter((q) => (q.library || '').startsWith('H5P.DragQuestion'));
const sourceDragWithImage = sourceDragQuestions.filter((q) => {
  const bg = q.params && q.params.question && q.params.question.settings && q.params.question.settings.background;
  return !!(bg && (bg.path || (bg.originalImage && bg.originalImage.path)));
}).length;
const importedDragWithImage = dragModules.filter((m) => !!m.content.backgroundImage).length;
const dragWithoutZones = dragModules.filter((m) => !Array.isArray(m.content.dropZones) || m.content.dropZones.length === 0).length;

let exportedImages = { ...h5pImages };
const exportedQuestions = importedModules
  .map((mod) => {
    const converted = convertNativeModuleToH5pQuestion(mod, h5pImages);
    if (!converted) return null;
    exportedImages = { ...exportedImages, ...(converted.addedImages || {}) };
    return converted.question;
  })
  .filter(Boolean);

const exportedLibraries = {};
for (const q of exportedQuestions) {
  exportedLibraries[q.library] = (exportedLibraries[q.library] || 0) + 1;
}

console.log('=== H5P Roundtrip Smoke Test ===');
console.log('Source title:', h5pMeta.title);
console.log('Imported modules total:', importedModules.length);
console.log('Native converted:', nativeCount);
console.log('Fallback h5p_native:', fallbackCount);
console.log('Drag modules:', dragModules.length);
console.log('Source drag questions with image:', sourceDragWithImage);
console.log('Imported drag modules with image:', importedDragWithImage);
console.log('Drag modules without zones:', dragWithoutZones);
console.log('Exported questions total:', exportedQuestions.length);
console.log('Exported libraries:', exportedLibraries);
console.log('Export image pool size:', Object.keys(exportedImages).length);

if (importedDragWithImage < sourceDragWithImage || dragWithoutZones > 0) {
  process.exitCode = 2;
  console.error('Drag-and-drop smoke check failed');
} else {
  console.log('Drag-and-drop smoke check passed');
}
