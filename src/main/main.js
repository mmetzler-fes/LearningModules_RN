const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');

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
  examMode: false,
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
  if (typeof db.examMode !== 'boolean') db.examMode = false;
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

// === ZIP utility functions for H5P import/export ===

function readZip(buffer) {
  const entries = {};
  // Find End of Central Directory record by scanning from end
  let eocdOffset = -1;
  const searchStart = Math.max(0, buffer.length - 22 - 65536);
  for (let i = buffer.length - 22; i >= searchStart; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) throw new Error('Keine gültige ZIP-Struktur gefunden');

  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  const cdSize   = buffer.readUInt32LE(eocdOffset + 12);

  let offset = cdOffset;
  while (offset < cdOffset + cdSize && offset + 46 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method          = buffer.readUInt16LE(offset + 10);
    const compressedSize  = buffer.readUInt32LE(offset + 20);
    const fileNameLen     = buffer.readUInt16LE(offset + 28);
    const extraLen        = buffer.readUInt16LE(offset + 30);
    const commentLen      = buffer.readUInt16LE(offset + 32);
    const localHdrOffset  = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLen).toString('utf8');

    if (!fileName.endsWith('/') && localHdrOffset + 30 <= buffer.length) {
      const localFileNameLen = buffer.readUInt16LE(localHdrOffset + 26);
      const localExtraLen    = buffer.readUInt16LE(localHdrOffset + 28);
      const dataOffset       = localHdrOffset + 30 + localFileNameLen + localExtraLen;
      if (dataOffset + compressedSize <= buffer.length) {
        const compData = buffer.slice(dataOffset, dataOffset + compressedSize);
        try {
          entries[fileName] = method === 0
            ? Buffer.from(compData)
            : zlib.inflateRawSync(compData);
        } catch { /* skip corrupted entry */ }
      }
    }
    offset += 46 + fileNameLen + extraLen + commentLen;
  }
  return entries;
}

let _crc32Table = null;
function getCrc32Table() {
  if (_crc32Table) return _crc32Table;
  _crc32Table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    _crc32Table[i] = c;
  }
  return _crc32Table;
}

function crc32(buf) {
  const t = getCrc32Table();
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ t[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZip(files) {
  const localParts = [];
  const cdParts    = [];
  let localOffset  = 0;

  for (const [name, data] of Object.entries(files)) {
    const nameBuf   = Buffer.from(name, 'utf8');
    const crcVal    = crc32(data);
    const deflated  = zlib.deflateRawSync(data, { level: 6 });
    const useDeflate = deflated.length < data.length;
    const compData  = useDeflate ? deflated : data;
    const method    = useDeflate ? 8 : 0;

    const localHdr = Buffer.alloc(30 + nameBuf.length);
    localHdr.writeUInt32LE(0x04034b50, 0);
    localHdr.writeUInt16LE(20, 4);
    localHdr.writeUInt16LE(0,  6);
    localHdr.writeUInt16LE(method, 8);
    localHdr.writeUInt16LE(0, 10); localHdr.writeUInt16LE(0, 12);
    localHdr.writeUInt32LE(crcVal, 14);
    localHdr.writeUInt32LE(compData.length, 18);
    localHdr.writeUInt32LE(data.length, 22);
    localHdr.writeUInt16LE(nameBuf.length, 26);
    localHdr.writeUInt16LE(0, 28);
    nameBuf.copy(localHdr, 30);

    const cdEntry = Buffer.alloc(46 + nameBuf.length);
    cdEntry.writeUInt32LE(0x02014b50, 0);
    cdEntry.writeUInt16LE(20, 4); cdEntry.writeUInt16LE(20, 6);
    cdEntry.writeUInt16LE(0, 8);
    cdEntry.writeUInt16LE(method, 10);
    cdEntry.writeUInt16LE(0, 12); cdEntry.writeUInt16LE(0, 14);
    cdEntry.writeUInt32LE(crcVal, 16);
    cdEntry.writeUInt32LE(compData.length, 20);
    cdEntry.writeUInt32LE(data.length, 24);
    cdEntry.writeUInt16LE(nameBuf.length, 28);
    cdEntry.writeUInt16LE(0, 30); cdEntry.writeUInt16LE(0, 32);
    cdEntry.writeUInt16LE(0, 34); cdEntry.writeUInt16LE(0, 36);
    cdEntry.writeUInt32LE(0, 38);
    cdEntry.writeUInt32LE(localOffset, 42);
    nameBuf.copy(cdEntry, 46);

    localParts.push(localHdr, compData);
    cdParts.push(cdEntry);
    localOffset += localHdr.length + compData.length;
  }

  const cdBuf = Buffer.concat(cdParts);
  const eocd  = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(cdParts.length, 8);
  eocd.writeUInt16LE(cdParts.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, cdBuf, eocd]);
}

function h5pUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Strip HTML tags and decode common HTML entities. */
function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function escapeHtmlForH5p(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inferImageExtFromDataUrl(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,/i.exec(dataUrl || '');
  const mime = match ? match[1].toLowerCase() : 'image/png';
  const byMime = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
  };
  return { mime, ext: byMime[mime] || 'png' };
}

function resolveTopicImage(imageUrl, topicImages, prefix) {
  if (!imageUrl) return { image: null, addedImages: {} };

  if (imageUrl.startsWith('data:image/')) {
    const { mime, ext } = inferImageExtFromDataUrl(imageUrl);
    const fileName = `${prefix}-${h5pUuid()}.${ext}`;
    return {
      image: {
        path: `images/${fileName}`,
        mime,
        copyright: { license: 'U' },
      },
      addedImages: { [fileName]: imageUrl },
    };
  }

  const fileName = path.basename(imageUrl);
  if (topicImages[fileName]) {
    const { mime } = inferImageExtFromDataUrl(topicImages[fileName]);
    return {
      image: {
        path: `images/${fileName}`,
        mime,
        copyright: { license: 'U' },
      },
      addedImages: {},
    };
  }

  return { image: null, addedImages: {} };
}

function extractMediaImage(media, h5pImages) {
  if (!media || typeof media !== 'object') return '';
  const imagePath = media.path || (media.params && media.params.file && media.params.file.path) || '';
  if (!imagePath) return '';
  const fileName = path.basename(imagePath);
  return h5pImages[fileName] || '';
}

function deepMergeObjects(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = (base && typeof base === 'object' && !Array.isArray(base)) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value)) {
      out[key] = value;
    } else if (value && typeof value === 'object') {
      out[key] = deepMergeObjects(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function buildQuestionWithSource(mod, expectedMachineName, defaultQuestion) {
  const source = mod && mod.h5pSource ? mod.h5pSource : null;
  const sourceLibrary = source && source.library ? source.library : '';
  const sourceMachineName = source && source.machineName
    ? source.machineName
    : (sourceLibrary ? sourceLibrary.split(' ')[0] : '');
  const sourceMatches = source && sourceMachineName === expectedMachineName;

  if (!sourceMatches) {
    return defaultQuestion;
  }

  const mergedParams = deepMergeObjects(source.params || {}, defaultQuestion.params || {});
  const mergedMetadata = {
    ...(source.metadata || {}),
    ...(defaultQuestion.metadata || {}),
    title: defaultQuestion.metadata && defaultQuestion.metadata.title
      ? defaultQuestion.metadata.title
      : ((source.metadata && source.metadata.title) || mod.title || ''),
    extraTitle: defaultQuestion.metadata && defaultQuestion.metadata.extraTitle
      ? defaultQuestion.metadata.extraTitle
      : ((source.metadata && source.metadata.extraTitle) || mod.title || ''),
  };

  return {
    ...defaultQuestion,
    library: source.library || defaultQuestion.library,
    params: mergedParams,
    metadata: mergedMetadata,
    subContentId: source.subContentId || defaultQuestion.subContentId || h5pUuid(),
  };
}

function convertNativeModuleToH5pQuestion(mod, topicImages = {}) {
  if (!mod) return null;

  if (mod.type === 'h5p_native' && mod.content) {
    return {
      question: {
        library: mod.content.library || 'H5P.AdvancedText 1.1',
        params: mod.content.params || {},
        metadata: {
          contentType: (mod.content.machineName || '').replace('H5P.', ''),
          license: 'U',
          title: mod.title,
          authors: [],
          changes: [],
          extraTitle: mod.title,
        },
        subContentId: mod.content.subContentId || h5pUuid(),
      },
      addedImages: {},
    };
  }

  if (mod.type === 'dragAndDrop') {
    const content = mod.content || {};
    const dropZones = Array.isArray(content.dropZones) ? content.dropZones : [];
    const draggables = Array.isArray(content.draggables) ? content.draggables : [];
    const addedImages = {};

    let background = null;
    const bg = content.backgroundImage || '';
    if (bg.startsWith('data:image/')) {
      const { mime, ext } = inferImageExtFromDataUrl(bg);
      const fileName = `dnd-bg-${mod.id || h5pUuid()}.${ext}`;
      addedImages[fileName] = bg;
      background = {
        path: `images/${fileName}`,
        mime,
        copyright: { license: 'U' },
      };
    } else if (bg) {
      const fileName = path.basename(bg);
      if (topicImages[fileName]) {
        const { mime } = inferImageExtFromDataUrl(topicImages[fileName]);
        background = {
          path: `images/${fileName}`,
          mime,
          copyright: { license: 'U' },
        };
      }
    }

    const h5pElements = draggables.map((drag) => ({
      x: 0,
      y: 0,
      width: 15,
      height: 5,
      multiple: !!drag.multiple,
      backgroundOpacity: 100,
      dropZones: dropZones
        .map((_, idx) => String(idx)),
      type: {
        library: 'H5P.AdvancedText 1.1',
        params: { text: `<p>${escapeHtmlForH5p(drag.text || '')}</p>` },
        subContentId: h5pUuid(),
        metadata: {
          contentType: 'Text',
          license: 'U',
          title: 'Untitled Text',
          authors: [],
          changes: [],
        },
      },
    }));

    const h5pDropZones = dropZones.map((zone, idx) => ({
      x: Number(zone.x) || 0,
      y: Number(zone.y) || 0,
      width: Number(zone.width) || 20,
      height: Number(zone.height) || 15,
      correctElements: draggables
        .map((drag, dragIdx) => ({ drag, dragIdx }))
        .filter(({ drag }) => {
          const matchA = (drag.correctZone || '') === (zone.label || '');
          const matchB = (zone.correctDraggable || '') === (drag.text || '');
          return matchA || matchB;
        })
        .map(({ dragIdx }) => String(dragIdx)),
      showLabel: true,
      backgroundOpacity: 100,
      tipsAndFeedback: { tip: '' },
      single: true,
      autoAlign: true,
      type: { library: 'H5P.DragQuestionDropzone 0.1' },
      label: `<div>${escapeHtmlForH5p(zone.label || `Zone ${idx + 1}`)}</div>`,
    }));

    return {
      question: buildQuestionWithSource(mod, 'H5P.DragQuestion', {
        library: 'H5P.DragQuestion 1.14',
        params: {
          question: {
            settings: {
              taskDescription: content.taskDescription || '',
              size: {
                width: 100,
                height: 70,
              },
              ...(background ? { background } : {}),
            },
            task: {
              elements: h5pElements,
              dropZones: h5pDropZones,
            },
          },
          behaviour: {
            enableRetry: true,
            enableSolutionsButton: true,
          },
        },
        metadata: {
          contentType: 'Drag Question',
          license: 'U',
          title: mod.title,
          authors: [],
          changes: [],
          extraTitle: mod.title,
        },
        subContentId: h5pUuid(),
      }),
      addedImages,
    };
  }

  if (mod.type === 'multipleChoice') {
    const content = mod.content || {};
    const answers = Array.isArray(content.answers) ? content.answers : [];
    const { image, addedImages } = resolveTopicImage(content.imageUrl || '', topicImages, `mc-${mod.id || 'module'}`);

    return {
      question: buildQuestionWithSource(mod, 'H5P.MultiChoice', {
        library: 'H5P.MultiChoice 1.16',
        params: {
          media: image
            ? { type: { library: 'H5P.Image 1.1', params: { file: image } }, disableImageZooming: false }
            : { disableImageZooming: false },
          question: `<p>${escapeHtmlForH5p(content.question || '')}</p>`,
          answers: answers.map((answer) => ({
            correct: !!answer.correct,
            text: `<div>${escapeHtmlForH5p(answer.text || '')}</div>`,
            tipsAndFeedback: {
              tip: answer.tip || '',
              chosenFeedback: '',
              notChosenFeedback: '',
            },
          })),
          overallFeedback: [{ from: 0, to: 100, feedback: '' }],
          behaviour: {
            enableRetry: content.enableRetry !== false,
            enableSolutionsButton: content.enableSolutionsButton !== false,
            singleAnswer: content.singleAnswer !== false,
            randomAnswers: !!content.randomAnswers,
            passPercentage: Number(content.passPercentage) || 100,
          },
          UI: {
            checkAnswerButton: 'Check',
            submitAnswerButton: 'Submit',
            showSolutionButton: 'Show solution',
            tryAgainButton: 'Retry',
          },
          confirmCheck: {
            header: 'Finish ?',
            body: 'Are you sure you wish to finish?',
            cancelLabel: 'Cancel',
            confirmLabel: 'Finish',
          },
          confirmRetry: {
            header: 'Retry?',
            body: 'Are you sure you wish to retry?',
            cancelLabel: 'Cancel',
            confirmLabel: 'Confirm',
          },
        },
        metadata: {
          contentType: 'Multiple Choice',
          license: 'U',
          title: mod.title,
          authors: [],
          changes: [],
          extraTitle: mod.title,
        },
        subContentId: h5pUuid(),
      }),
      addedImages,
    };
  }

  if (mod.type === 'trueFalse') {
    const content = mod.content || {};
    const tfQuestions = Array.isArray(content.questions) && content.questions.length > 0
      ? content.questions
      : [content];
    const { image, addedImages } = resolveTopicImage(content.imageUrl || '', topicImages, `tf-${mod.id || 'module'}`);
    const mediaObj = image
      ? { type: { library: 'H5P.Image 1.1', params: { file: image } }, disableImageZooming: false }
      : { disableImageZooming: false };

    const questions = tfQuestions.map((q, idx) => {
      return buildQuestionWithSource(mod, 'H5P.TrueFalse', {
        library: 'H5P.TrueFalse 1.8',
        params: {
          media: idx === 0 ? mediaObj : { disableImageZooming: false },
          question: `<p>${escapeHtmlForH5p(q.question || '')}</p>`,
          correct: (q.correctAnswer || 'false') === 'true',
          l10n: {
            trueText: 'True',
            falseText: 'False',
            score: 'You got @score of @total points',
            checkAnswer: 'Check',
            showSolutionButton: 'Show solution',
            tryAgain: 'Retry',
            wrongAnswerMessage: q.feedbackWrong || 'Wrong answer',
            correctAnswerMessage: q.feedbackCorrect || 'Correct answer',
          },
          behaviour: {
            enableRetry: content.enableRetry !== false,
            enableSolutionsButton: content.enableSolutionsButton !== false,
          },
          confirmCheck: {
            header: 'Finish ?',
            body: 'Are you sure you wish to finish?',
            cancelLabel: 'Cancel',
            confirmLabel: 'Finish',
          },
          confirmRetry: {
            header: 'Retry?',
            body: 'Are you sure you wish to retry?',
            cancelLabel: 'Cancel',
            confirmLabel: 'Confirm',
          },
        },
        metadata: {
          contentType: 'True/False Question',
          license: 'U',
          title: tfQuestions.length > 1 ? `${mod.title} (${idx + 1})` : mod.title,
          authors: [],
          changes: [],
          extraTitle: tfQuestions.length > 1 ? `${mod.title} (${idx + 1})` : mod.title,
        },
        subContentId: h5pUuid(),
      });
    });

    return {
      questions,
      addedImages,
    };
  }

  if (mod.type === 'fillInTheBlanks') {
    const content = mod.content || {};
    const questions = Array.isArray(content.questions) ? content.questions : [];
    const { image, addedImages } = resolveTopicImage(content.imageUrl || '', topicImages, `fib-${mod.id || 'module'}`);

    return {
      question: buildQuestionWithSource(mod, 'H5P.Blanks', {
        library: 'H5P.Blanks 1.14',
        params: {
          media: image
            ? { type: { library: 'H5P.Image 1.1', params: { file: image } }, disableImageZooming: false }
            : { disableImageZooming: false },
          text: content.taskDescription ? `<p>${escapeHtmlForH5p(content.taskDescription)}</p>` : '',
          questions: questions.map((q) => `<p>${escapeHtmlForH5p(q.text || '')}</p>`),
          behaviour: {
            caseSensitive: !!content.caseSensitive,
            enableRetry: content.enableRetry !== false,
            enableSolutionsButton: content.enableSolutionsButton !== false,
            showSolutionsRequiresInput: content.showSolutionsRequiresInput !== false,
          },
          overallFeedback: [{ from: 0, to: 100, feedback: '' }],
          showSolutions: 'Show solution',
          tryAgain: 'Retry',
          checkAnswer: 'Check',
          submitAnswer: 'Submit',
          notFilledOut: 'Please fill in all blanks to view solution',
          answerIsCorrect: "':ans' is correct",
          answerIsWrong: "':ans' is wrong",
          answeredCorrectly: 'Answered correctly',
          answeredIncorrectly: 'Answered incorrectly',
          solutionLabel: 'Correct answer:',
          inputLabel: 'Blank input @num of @total',
          inputHasTipLabel: 'Tip available',
          tipLabel: 'Tip',
          scoreBarLabel: 'You got :num out of :total points',
          a11yCheck: 'Check the answers. The responses will be marked as correct, incorrect, or unanswered.',
          a11yShowSolution: 'Show the solution. The task will be marked with its correct solution.',
          a11yRetry: 'Retry the task. Reset all responses and start the task over again.',
          a11yCheckingModeHeader: 'Checking mode',
          confirmCheck: {
            header: 'Finish ?',
            body: 'Are you sure you wish to finish?',
            cancelLabel: 'Cancel',
            confirmLabel: 'Finish',
          },
          confirmRetry: {
            header: 'Retry?',
            body: 'Are you sure you wish to retry?',
            cancelLabel: 'Cancel',
            confirmLabel: 'Confirm',
          },
        },
        metadata: {
          contentType: 'Fill in the Blanks',
          license: 'U',
          title: mod.title,
          authors: [],
          changes: [],
          extraTitle: mod.title,
        },
        subContentId: h5pUuid(),
      }),
      addedImages,
    };
  }

  if (mod.type === 'dragTheWords') {
    const content = mod.content || {};
    const { image, addedImages } = resolveTopicImage(content.imageUrl || '', topicImages, `dtw-${mod.id || 'module'}`);

    return {
      question: buildQuestionWithSource(mod, 'H5P.DragText', {
        library: 'H5P.DragText 1.10',
        params: {
          ...(image ? { media: { type: { library: 'H5P.Image 1.1', params: { file: image } }, disableImageZooming: false } } : {}),
          taskDescription: content.taskDescription ? `<p>${escapeHtmlForH5p(content.taskDescription)}</p>` : '',
          textField: content.textField || '',
          overallFeedback: [{ from: 0, to: 100, feedback: '' }],
          checkAnswer: 'Check',
          submitAnswer: 'Submit',
          tryAgain: 'Retry',
          showSolution: 'Show solution',
          behaviour: {
            enableRetry: content.enableRetry !== false,
            enableSolutionsButton: content.enableSolutionsButton !== false,
            instantFeedback: !!content.instantFeedback,
          },
        },
        metadata: {
          contentType: 'Drag the Words',
          license: 'U',
          title: mod.title,
          authors: [],
          changes: [],
          extraTitle: mod.title,
        },
        subContentId: h5pUuid(),
      }),
      addedImages,
    };
  }

  if (mod.type === 'markTheWords') {
    const content = mod.content || {};
    const { image, addedImages } = resolveTopicImage(content.imageUrl || '', topicImages, `mtw-${mod.id || 'module'}`);

    return {
      question: buildQuestionWithSource(mod, 'H5P.MarkTheWords', {
        library: 'H5P.MarkTheWords 1.11',
        params: {
          ...(image ? { media: { type: { library: 'H5P.Image 1.1', params: { file: image } }, disableImageZooming: false } } : {}),
          taskDescription: content.taskDescription ? `<p>${escapeHtmlForH5p(content.taskDescription)}</p>` : '',
          textField: content.textField || '',
          overallFeedback: [{ from: 0, to: 100, feedback: '' }],
          checkAnswer: 'Check',
          submitAnswer: 'Submit',
          tryAgain: 'Retry',
          showSolution: 'Show solution',
          behaviour: {
            enableRetry: content.enableRetry !== false,
            enableSolutionsButton: content.enableSolutionsButton !== false,
            "displaySolutionButtonWhenScoreIsPerfect": false,
          },
        },
        metadata: {
          contentType: 'Mark the Words',
          license: 'U',
          title: mod.title,
          authors: [],
          changes: [],
          extraTitle: mod.title,
        },
        subContentId: h5pUuid(),
      }),
      addedImages,
    };
  }

  if (mod.type === 'accordion') {
    const content = mod.content || {};
    const panels = Array.isArray(content.panels) ? content.panels : [];

    return {
      question: buildQuestionWithSource(mod, 'H5P.Accordion', {
        library: 'H5P.Accordion 1.0',
        params: {
          panels: panels.map((panel) => ({
            title: panel.title || '',
            content: {
              library: 'H5P.AdvancedText 1.1',
              params: {
                text: `<p>${escapeHtmlForH5p(panel.content || '')}</p>`,
              },
              subContentId: h5pUuid(),
              metadata: {
                contentType: 'Text',
                license: 'U',
                title: panel.title || 'Panel',
                authors: [],
                changes: [],
              },
            },
          })),
        },
        metadata: {
          contentType: 'Accordion',
          license: 'U',
          title: mod.title,
          authors: [],
          changes: [],
          extraTitle: mod.title,
        },
        subContentId: h5pUuid(),
      }),
      addedImages: {},
    };
  }

  if (mod.type === 'flashcards') {
    const content = mod.content || {};
    const cards = Array.isArray(content.cards) ? content.cards : [];
    const addedImages = {};

    const h5pCards = cards.map((card, idx) => {
      let image = null;
      const imgUrl = card.imageUrl || '';

      if (imgUrl.startsWith('data:image/')) {
        const { mime, ext } = inferImageExtFromDataUrl(imgUrl);
        const fileName = `flashcard-${mod.id || h5pUuid()}-${idx + 1}.${ext}`;
        addedImages[fileName] = imgUrl;
        image = {
          path: `images/${fileName}`,
          mime,
          copyright: { license: 'U' },
        };
      } else if (imgUrl) {
        const fileName = path.basename(imgUrl);
        if (topicImages[fileName]) {
          const { mime } = inferImageExtFromDataUrl(topicImages[fileName]);
          image = {
            path: `images/${fileName}`,
            mime,
            copyright: { license: 'U' },
          };
        }
      }

      return {
        text: card.question || '',
        answer: card.answer || '',
        ...(image ? { image } : {}),
      };
    });

    return {
      question: buildQuestionWithSource(mod, 'H5P.Flashcards', {
        library: 'H5P.Flashcards 1.6',
        params: {
          cards: h5pCards,
          behaviour: {
            randomCards: false,
            retry: true,
          },
        },
        metadata: {
          contentType: 'Flashcards',
          license: 'U',
          title: mod.title,
          authors: [],
          changes: [],
          extraTitle: mod.title,
        },
        subContentId: h5pUuid(),
      }),
      addedImages,
    };
  }

  if (mod.type === 'essay') {
    const content = mod.content || {};
    const { image, addedImages } = resolveTopicImage(content.imageUrl || '', topicImages, `essay-${mod.id || 'module'}`);

    return {
      question: buildQuestionWithSource(mod, 'H5P.Essay', {
        library: 'H5P.Essay 1.5',
        params: {
          media: image
            ? { type: { library: 'H5P.Image 1.1', params: { file: image } }, disableImageZooming: false }
            : { disableImageZooming: false },
          question: content.taskDescription ? `<p>${escapeHtmlForH5p(content.taskDescription)}</p>` : '',
          solution: {
            introduction: '',
            sample: content.sampleSolution || '',
          },
          overallFeedback: [{ from: 0, to: 100, feedback: '' }],
          behaviour: {
            inputFieldSize: String(content.inputFieldSize || 10),
            minimumLength: Number(content.minChars) || 0,
            enableRetry: content.enableRetry !== false,
            ignoreScoring: content.ignoreScoring !== false,
            pointsHost: Number(content.pointsHost) || 1,
            linebreakReplacement: ' ',
          },
          checkAnswer: 'Check',
          submitAnswer: 'Submit',
          tryAgain: 'Retry',
          showSolution: 'Show solution',
          feedbackHeader: 'Feedback',
          solutionTitle: 'Sample solution',
        },
        metadata: {
          contentType: 'Essay',
          license: 'U',
          title: mod.title,
          authors: [],
          changes: [],
          extraTitle: mod.title,
        },
        subContentId: h5pUuid(),
      }),
      addedImages,
    };
  }

  return null;
}

/**
 * Try to convert an H5P question's params into one of the app's native module types.
 * Returns { type, content } if a native mapping exists, or null to fall back to h5p_native.
 */
function convertH5pToNative(machineName, params, h5pImages = {}) {
  switch (machineName) {
    case 'H5P.MultiChoice': {
      const question = stripHtml(params.question || '');
      const answers = (params.answers || []).map((a) => ({
        text: stripHtml(a.text || ''),
        correct: !!a.correct,
        tip: a.tipsAndFeedback ? stripHtml(a.tipsAndFeedback.tip || '') : '',
      }));
      const behaviour = params.behaviour || {};
      const correctCount = answers.filter((a) => a.correct).length;
      const singleAnswer =
        behaviour.singleAnswer !== undefined
          ? !!behaviour.singleAnswer
          : correctCount <= 1;
      return {
        type: 'multipleChoice',
        content: {
          question,
          imageUrl: extractMediaImage(params.media, h5pImages),
          answers,
          singleAnswer,
          randomAnswers: !!behaviour.randomAnswers,
          enableRetry: behaviour.enableRetry !== false,
          enableSolutionsButton: behaviour.enableSolutionsButton !== false,
          passPercentage: Number(behaviour.passPercentage) || 100,
        },
      };
    }

    case 'H5P.Blanks': {
      // params.text = rich-text task description; params.questions = array of blank sentences
      const taskDescription = stripHtml(params.text || '');
      const rawQuestions = Array.isArray(params.questions) ? params.questions : [];
      const questions = rawQuestions.map((q) => ({ text: stripHtml(q) }));
      return {
        type: 'fillInTheBlanks',
        content: {
          taskDescription,
          imageUrl: extractMediaImage(params.media, h5pImages),
          questions: questions.length > 0 ? questions : [{ text: '' }],
          caseSensitive: !!(params.behaviour && params.behaviour.caseSensitive),
          enableRetry: !(params.behaviour && params.behaviour.enableRetry === false),
          enableSolutionsButton: !(params.behaviour && params.behaviour.enableSolutionsButton === false),
          showSolutionsRequiresInput: !(params.behaviour && params.behaviour.showSolutionsRequiresInput === false),
        },
      };
    }

    case 'H5P.TrueFalse': {
      const question = stripHtml(params.question || '');
      const correctAnswer = params.correct === true || params.correct === 'true' ? 'true' : 'false';
      const feedbackCorrect = stripHtml(params.feedbackOnCorrect || 'Richtig!');
      const feedbackWrong = stripHtml(params.feedbackOnWrong || 'Leider falsch.');
      return {
        type: 'trueFalse',
        content: {
          imageUrl: extractMediaImage(params.media, h5pImages),
          questions: [{ question, correctAnswer, feedbackCorrect, feedbackWrong }],
          enableRetry: !(params.behaviour && params.behaviour.enableRetry === false),
          enableSolutionsButton: !(params.behaviour && params.behaviour.enableSolutionsButton === false),
        },
      };
    }

    case 'H5P.Essay': {
      return {
        type: 'essay',
        content: {
          taskDescription: stripHtml(params.question || params.taskDescription || ''),
          imageUrl: extractMediaImage(params.media, h5pImages),
          sampleSolution: (params.solution && params.solution.sample) || '',
          minChars: Number(params.behaviour && params.behaviour.minimumLength) || 0,
          inputFieldSize: Number(params.behaviour && params.behaviour.inputFieldSize) || 10,
          enableRetry: !(params.behaviour && params.behaviour.enableRetry === false),
          ignoreScoring: !(params.behaviour && params.behaviour.ignoreScoring === false),
          pointsHost: Number(params.behaviour && params.behaviour.pointsHost) || 1,
        },
      };
    }

    case 'H5P.DragText': {
      return {
        type: 'dragTheWords',
        content: {
          taskDescription: stripHtml(params.taskDescription || ''),
          imageUrl: extractMediaImage(params.media, h5pImages),
          textField: params.textField || '',
          enableRetry: !(params.behaviour && params.behaviour.enableRetry === false),
          enableSolutionsButton: !(params.behaviour && params.behaviour.enableSolutionsButton === false),
          instantFeedback: !!(params.behaviour && params.behaviour.instantFeedback),
        },
      };
    }

    case 'H5P.MarkTheWords': {
      return {
        type: 'markTheWords',
        content: {
          taskDescription: stripHtml(params.taskDescription || ''),
          imageUrl: extractMediaImage(params.media, h5pImages),
          textField: params.textField || '',
          enableRetry: !(params.behaviour && params.behaviour.enableRetry === false),
          enableSolutionsButton: !(params.behaviour && params.behaviour.enableSolutionsButton === false),
        },
      };
    }

    case 'H5P.DragQuestion': {
      const taskDesc = stripHtml(
        (params.question && params.question.settings && params.question.settings.taskDescription) || ''
      );
      const settings = (params.question && params.question.settings) || {};
      const taskData = (params.question && params.question.task) || {};
      const elements = Array.isArray(taskData.elements) ? taskData.elements : [];
      const dropZones = Array.isArray(taskData.dropZones) ? taskData.dropZones : [];

      const backgroundPath =
        (settings.background && settings.background.path) ||
        (settings.background && settings.background.originalImage && settings.background.originalImage.path) ||
        '';
      const backgroundFile = backgroundPath ? path.basename(backgroundPath) : '';
      const backgroundImage = backgroundFile && h5pImages[backgroundFile] ? h5pImages[backgroundFile] : '';

      const mappedDropZones = dropZones.map((dz, i) => ({
        label: stripHtml(dz.label || '') || `Zone ${i + 1}`,
        x: Math.round(dz.x || 0),
        y: Math.round(dz.y || 0),
        width: Math.round(dz.width || 20),
        height: Math.round(dz.height || 20),
      }));

      const draggables = elements
        .map((el, i) => {
          const correctZoneIdx = dropZones.findIndex(
            (dz) => Array.isArray(dz.correctElements) && dz.correctElements.includes(String(i))
          );
          const rawText =
            el.type && el.type.params
              ? el.type.params.text || (el.type.params.file && el.type.params.file.path) || ''
              : '';
          const text = stripHtml(rawText) || `Element ${i + 1}`;
          return {
            text,
            correctZone:
              correctZoneIdx >= 0 && mappedDropZones[correctZoneIdx]
                ? mappedDropZones[correctZoneIdx].label
                : '',
          };
        })
        .filter((d) => d.text.trim());

      return {
        type: 'dragAndDrop',
        content: { taskDescription: taskDesc, backgroundImage, dropZones: mappedDropZones, draggables },
      };
    }

    default:
      return null; // No native mapping — keep as h5p_native
  }
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

  // Exam mode endpoint for browser students
  web.get('/api/exam-mode', (_req, res) => {
    const db = loadDB();
    res.json({ enabled: !!db.examMode });
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

ipcMain.handle('get-exam-mode', () => {
  const db = loadDB();
  return { enabled: !!db.examMode };
});

ipcMain.handle('set-exam-mode', (_event, enabled) => {
  const db = loadDB();
  db.examMode = !!enabled;
  saveDB(db);
  return { success: true, enabled: db.examMode };
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
    const existing = topic.modules[idx] || {};
    const merged = { ...existing, ...moduleData };
    if (existing.h5pSource && moduleData.type && moduleData.type !== existing.type && !moduleData.h5pSource) {
      delete merged.h5pSource;
    }
    topic.modules[idx] = merged;
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

ipcMain.handle('reorder-modules', (_event, topicId, moduleIds) => {
  const db = loadDB();
  const topic = db.topics.find((t) => t.id === topicId);
  if (!topic) return { success: false };
  const oldModules = topic.modules || [];
  const byId = Object.fromEntries(oldModules.map((m) => [m.id, m]));
  topic.modules = moduleIds.map((id) => byId[id]).filter(Boolean);
  // Append any modules not in the new order (safety net)
  const idSet = new Set(moduleIds);
  oldModules.filter((m) => !idSet.has(m.id)).forEach((m) => topic.modules.push(m));
  saveDB(db);
  return { success: true };
});

ipcMain.handle('transfer-modules', (_event, sourceTopicId, targetTopicId, moduleIds, mode) => {
  const db = loadDB();
  const sourceTopic = db.topics.find((t) => t.id === sourceTopicId);
  const targetTopic = db.topics.find((t) => t.id === targetTopicId);
  if (!sourceTopic || !targetTopic) return { success: false, error: 'Thema nicht gefunden' };

  if (!sourceTopic.modules) sourceTopic.modules = [];
  if (!targetTopic.modules) targetTopic.modules = [];

  const modulesToTransfer = sourceTopic.modules.filter((m) => moduleIds.includes(m.id));
  if (modulesToTransfer.length === 0) return { success: false, error: 'Keine Module ausgewählt' };

  if (mode === 'move') {
    for (const mod of modulesToTransfer) {
      targetTopic.modules.push(mod);
    }
    sourceTopic.modules = sourceTopic.modules.filter((m) => !moduleIds.includes(m.id));
  } else if (mode === 'copy') {
    for (const mod of modulesToTransfer) {
      const cloned = JSON.parse(JSON.stringify(mod));
      cloned.id = 'mod_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
      cloned.title = `${cloned.title} (Kopie)`;
      targetTopic.modules.push(cloned);
    }
  } else {
    return { success: false, error: 'Ungültiger Modus' };
  }

  saveDB(db);
  return { success: true, count: modulesToTransfer.length };
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

// --- IPC: H5P Import ---

ipcMain.handle('import-h5p', async (_event, options = {}) => {
  const importMode = options && options.importMode === 'raw' ? 'raw' : 'native';
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'H5P-Datei importieren',
    filters: [{ name: 'H5P-Dateien', extensions: ['h5p'] }],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return { success: false };

  let buffer;
  try {
    buffer = fs.readFileSync(filePaths[0]);
  } catch (e) {
    return { success: false, error: 'Datei konnte nicht gelesen werden: ' + e.message };
  }

  let entries;
  try {
    entries = readZip(buffer);
  } catch (e) {
    return { success: false, error: 'Ungültige H5P-Datei: ' + e.message };
  }

  if (!entries['h5p.json'])
    return { success: false, error: 'h5p.json fehlt in der H5P-Datei' };

  let h5pMeta;
  try {
    h5pMeta = JSON.parse(entries['h5p.json'].toString('utf8'));
  } catch {
    return { success: false, error: 'Fehler beim Lesen von h5p.json' };
  }

  if (!entries['content/content.json'])
    return { success: false, error: 'content/content.json fehlt in der H5P-Datei' };

  let contentData;
  try {
    contentData = JSON.parse(entries['content/content.json'].toString('utf8'));
  } catch {
    return { success: false, error: 'Fehler beim Lesen von content/content.json' };
  }

  // Collect embedded images as base64 data URLs
  const h5pImages = {};
  const mimeByExt = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp' };
  for (const [entryName, entryData] of Object.entries(entries)) {
    if (entryName.startsWith('content/images/')) {
      const imgName = path.basename(entryName);
      const ext = path.extname(imgName).toLowerCase().slice(1);
      const mime = mimeByExt[ext] || 'image/png';
      h5pImages[imgName] = `data:${mime};base64,${entryData.toString('base64')}`;
    }
  }

  const mainLibrary = h5pMeta.mainLibrary || '';
  const topicTitle = h5pMeta.title || h5pMeta.extraTitle || path.basename(filePaths[0], '.h5p');
  const rawItems = mainLibrary === 'H5P.QuestionSet'
    ? (Array.isArray(contentData.questions) ? contentData.questions : []).map((q, idx) => ({
        title: (q.metadata && q.metadata.title) || `Aufgabe ${idx + 1}`,
        library: q.library || '',
      }))
    : [{
        title: topicTitle,
        library: mainLibrary,
      }];
  const h5pRawSummary = {
    mainLibrary,
    itemCount: rawItems.length,
    items: rawItems,
  };

  // Raw mode: keep original package unchanged for true roundtrip export
  if (importMode === 'raw') {
    const db = loadDB();
    const newTopic = {
      id: 'topic_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      title: topicTitle,
      description: `Als H5P-Projekt importiert (${mainLibrary})`,
      selected: false,
      createdAt: new Date().toISOString(),
      modules: [],
      h5pImages,
      h5pMeta: { mainLibrary, title: topicTitle },
      h5pRawSummary,
      h5pImportMode: 'raw',
      h5pRawPackage: {
        fileName: path.basename(filePaths[0]),
        dataBase64: buffer.toString('base64'),
        importedAt: new Date().toISOString(),
      },
    };
    db.topics.push(newTopic);
    saveDB(db);
    return { success: true, topicTitle, importedCount: rawItems.length, importMode: 'raw' };
  }

  const modules = [];

  if (mainLibrary === 'H5P.QuestionSet') {
    const questions = Array.isArray(contentData.questions) ? contentData.questions : [];
    for (const q of questions) {
      const machineName = (q.library || '').split(' ')[0];
      const converted = convertH5pToNative(machineName, q.params || {}, h5pImages);
      const sourceSubContentId = q.subContentId || h5pUuid();
      modules.push({
        id: 'mod_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
        title: (q.metadata && q.metadata.title) || 'Aufgabe',
        type: converted ? converted.type : 'h5p_native',
        description: (q.metadata && q.metadata.contentType) || machineName.replace('H5P.', ''),
        content: converted
          ? converted.content
          : {
              library: q.library || '',
              machineName,
              params: q.params || {},
              subContentId: sourceSubContentId,
            },
        h5pSource: {
          library: q.library || '',
          machineName,
          params: q.params || {},
          metadata: q.metadata || {},
          subContentId: sourceSubContentId,
        },
        moduleSelected: true,
        createdAt: new Date().toISOString(),
      });
    }
  } else {
    const converted = convertH5pToNative(mainLibrary, contentData, h5pImages);
    const sourceSubContentId = h5pUuid();
    modules.push({
      id: 'mod_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      title: h5pMeta.title || h5pMeta.extraTitle || path.basename(filePaths[0], '.h5p'),
      type: converted ? converted.type : 'h5p_native',
      description: mainLibrary.replace('H5P.', ''),
      content: converted
        ? converted.content
        : {
            library: mainLibrary,
            machineName: mainLibrary,
            params: contentData,
            subContentId: sourceSubContentId,
          },
      h5pSource: {
        library: mainLibrary,
        machineName: mainLibrary,
        params: contentData,
        metadata: {
          contentType: mainLibrary.replace('H5P.', ''),
          title: topicTitle,
          extraTitle: topicTitle,
          license: 'U',
          authors: [],
          changes: [],
        },
        subContentId: sourceSubContentId,
      },
      moduleSelected: true,
      createdAt: new Date().toISOString(),
    });
  }

  const db = loadDB();
  const newTopic = {
    id: 'topic_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    title: topicTitle,
    description: `Importiert aus H5P (${mainLibrary})`,
    selected: false,
    createdAt: new Date().toISOString(),
    modules,
    h5pImages,
    h5pMeta: { mainLibrary, title: topicTitle },
    h5pImportMode: 'native',
  };
  db.topics.push(newTopic);
  saveDB(db);

  return { success: true, topicTitle, importedCount: modules.length, importMode: 'native' };
});

// --- IPC: H5P Export ---

ipcMain.handle('export-topic-as-h5p', async (_event, topicId) => {
  const db = loadDB();
  const topic = db.topics.find((t) => t.id === topicId);
  if (!topic) return { success: false, error: 'Thema nicht gefunden' };

  const safeName = (topic.title || 'export').replace(/[^\w\säöüÄÖÜß-]/g, '_');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Thema als H5P exportieren',
    defaultPath: `${safeName}.h5p`,
    filters: [{ name: 'H5P-Dateien', extensions: ['h5p'] }],
  });
  if (canceled || !filePath) return { success: false };

  // Raw import mode: export original package unchanged
  if (topic.h5pImportMode === 'raw' && topic.h5pRawPackage && topic.h5pRawPackage.dataBase64) {
    try {
      fs.writeFileSync(filePath, Buffer.from(topic.h5pRawPackage.dataBase64, 'base64'));
      return { success: true, filePath, exportedMode: 'raw' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  const selectedModules = (topic.modules || []).filter((m) => m.moduleSelected !== false);
  const exportImages = { ...(topic.h5pImages || {}) };
  const questions = selectedModules
    .map((mod) => {
      const converted = convertNativeModuleToH5pQuestion(mod, topic.h5pImages || {});
      if (!converted) return null;
      Object.assign(exportImages, converted.addedImages || {});
      // Some types (e.g. trueFalse) return multiple questions
      if (converted.questions) return converted.questions;
      return converted.question;
    })
    .filter(Boolean)
    .flat();

  const h5pJson = {
    embedTypes: ['iframe'],
    language: 'de',
    title: topic.title,
    mainLibrary: 'H5P.QuestionSet',
    license: 'U',
    defaultLanguage: 'de',
    preloadedDependencies: [{ machineName: 'H5P.QuestionSet', majorVersion: 1, minorVersion: 20 }],
    extraTitle: topic.title,
  };

  const contentJson = {
    introPage: { showIntroPage: false, startButtonText: 'Starten', introduction: '', title: topic.title },
    progressType: 'dots',
    passPercentage: 50,
    questions,
    texts: {
      prevButton: 'Zurück', nextButton: 'Weiter', finishButton: 'Fertig',
      submitButton: 'Abschicken', textualProgress: 'Aufgabe :num von :total',
    },
  };

  const zipFiles = {
    'h5p.json':                Buffer.from(JSON.stringify(h5pJson,    null, 2), 'utf8'),
    'content/content.json':   Buffer.from(JSON.stringify(contentJson, null, 2), 'utf8'),
  };
  for (const [imgName, dataUrl] of Object.entries(exportImages)) {
    const b64 = dataUrl.split(',')[1];
    if (b64) zipFiles[`content/images/${imgName}`] = Buffer.from(b64, 'base64');
  }

  try {
    fs.writeFileSync(filePath, createZip(zipFiles));
    return { success: true, filePath, exportedMode: 'native' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// --- IPC: Export selected modules individually as H5P ---

ipcMain.handle('export-selected-modules-as-h5p', async (_event, topicId) => {
  const db = loadDB();
  const topic = db.topics.find((t) => t.id === topicId);
  if (!topic) return { success: false, error: 'Thema nicht gefunden' };

  if (topic.h5pImportMode === 'raw') {
    return { success: false, error: 'RAW H5P-Projekte können nicht als einzelne Module exportiert werden.' };
  }

  const selectedModules = (topic.modules || []).filter((m) => m.moduleSelected !== false);
  if (selectedModules.length === 0) {
    return { success: false, error: 'Keine aktiven Module zum Exportieren vorhanden.' };
  }

  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: `H5P-Export: ${selectedModules.length} Modul(e) exportieren`,
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Ordner wählen',
  });
  if (canceled || !filePaths || !filePaths[0]) return { success: false };

  const exportDir = filePaths[0];
  let exported = 0;
  const errors = [];
  const usedNames = new Set();

  for (const mod of selectedModules) {
    try {
      const converted = convertNativeModuleToH5pQuestion(mod, topic.h5pImages || {});
      if (!converted) {
        errors.push(`"${mod.title}": Konvertierung fehlgeschlagen`);
        continue;
      }

      // Some types (e.g. trueFalse) return multiple questions
      const questionsToExport = converted.questions
        ? converted.questions
        : [converted.question];
      const { addedImages } = converted;

      for (const question of questionsToExport) {
        const libraryStr = question.library || 'H5P.AdvancedText 1.1';
        const parts = libraryStr.split(' ');
        const machineName = parts[0];
        const versionStr = parts[1] || '1.0';
        const [majorStr, minorStr] = versionStr.split('.');
        const majorVersion = parseInt(majorStr, 10) || 1;
        const minorVersion = parseInt(minorStr, 10) || 0;

        const exportTitle = (question.metadata && question.metadata.title) || mod.title;

        const h5pJson = {
          embedTypes: ['iframe'],
          language: 'de',
          title: exportTitle,
          mainLibrary: machineName,
          license: 'U',
          defaultLanguage: 'de',
          preloadedDependencies: [{ machineName, majorVersion, minorVersion }],
          extraTitle: exportTitle,
        };

        const contentJson = question.params || {};

        // Unique, safe file name
        let baseName = (exportTitle || 'modul').replace(/[^\w\säöüÄÖÜß-]/g, '_').trim() || 'modul';
        let fileName = `${baseName}.h5p`;
        let counter = 1;
        while (usedNames.has(fileName.toLowerCase())) {
          fileName = `${baseName}_${counter++}.h5p`;
        }
        usedNames.add(fileName.toLowerCase());

        const filePath = path.join(exportDir, fileName);
        const zipFiles = {
          'h5p.json':              Buffer.from(JSON.stringify(h5pJson,    null, 2), 'utf8'),
          'content/content.json':  Buffer.from(JSON.stringify(contentJson, null, 2), 'utf8'),
        };

        const allImages = { ...(topic.h5pImages || {}), ...(addedImages || {}) };
        for (const [imgName, dataUrl] of Object.entries(allImages)) {
          if (!dataUrl) continue;
          const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
          if (b64) zipFiles[`content/images/${imgName}`] = Buffer.from(b64, 'base64');
        }

        fs.writeFileSync(filePath, createZip(zipFiles));
        exported++;
      }
    } catch (e) {
      errors.push(`"${mod.title}": ${e.message}`);
    }
  }

  return {
    success: exported > 0,
    exported,
    total: selectedModules.length,
    exportDir,
    errors: errors.length > 0 ? errors : undefined,
    error: exported === 0 ? (errors[0] || 'Keine Module exportiert.') : undefined,
  };
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
