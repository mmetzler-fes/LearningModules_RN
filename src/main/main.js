const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');

const express = require('express');
const QRCode = require('qrcode');
const multer = require('multer');

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');
const { parseUserImportFile } = require('./user-import');

// ============================================================
// === AUTH UTILITIES (crypto, tokens) — no external deps ===
// ============================================================

// Derive a stable secret from DATA_DIR so tokens are session-persistent but not guessable
function getTokenSecret() {
  const secretFile = path.join(DATA_DIR, '.token_secret');
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf-8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  ensureDataDir();
  fs.writeFileSync(secretFile, secret, 'utf-8');
  return secret;
}
let _tokenSecret = null;
function tokenSecret() { if (!_tokenSecret) _tokenSecret = getTokenSecret(); return _tokenSecret; }

function hashPassword(password) {
  if (!password) return ''; // empty password stored as empty string
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return !password; // empty stored hash: match only if empty password provided
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const attempt = crypto.scryptSync(password || '', salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(attempt, 'hex'));
}

function signToken(payload) {
  const data = JSON.stringify(payload);
  const b64 = Buffer.from(data).toString('base64url');
  const sig = crypto.createHmac('sha256', tokenSecret()).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  const expected = crypto.createHmac('sha256', tokenSecret()).update(b64).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

function makeToken(user) {
  return signToken({
    id: user.id,
    username: user.username,
    role: user.role,
    exp: Date.now() + 24 * 60 * 60 * 1000, // 24h
  });
}

function requireAuth(roles) {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'] || '';
    let token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token && req.query.token) token = req.query.token; // Support token in query for downloads

    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: 'Nicht authentifiziert' });
    if (roles && !roles.includes(payload.role)) return res.status(403).json({ error: 'Keine Berechtigung' });
    req.authUser = payload;
    next();
  };
}

// ============================================================
// === DATABASE ===============================================
// ============================================================

function makeUserId() { return 'usr_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex'); }
function makeClassId() { return 'cls_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex'); }

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDB() {
  ensureDataDir();
  if (!fs.existsSync(DB_FILE)) {
    const initial = buildInitialDB();
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  let db;
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); }
  catch { db = {}; }
  return migrateDB(db);
}

function buildInitialDB() {
  const adminId = makeUserId();
  return {
    users: [{
      id: adminId,
      username: 'admin',
      passwordHash: hashPassword('lehrer1'),
      role: 'admin',
      displayName: 'Administrator',
      accessFilters: { ips: [], browserUsers: [], browserDomains: [] },
    }],
    settings: { allowEmptyStudentPassword: true },
    classes: [],
    topics: [],
    examMode: false,
    results: [],
    studentSelectedTopics: {},
    nextResultId: 1,
  };
}

function migrateDB(db) {
  let changed = false;

  // v1→v2: migrate old single-admin format to users array
  if (!db.users && db.admin) {
    const adminId = makeUserId();
    const pw = db.admin.password || 'lehrer1';
    db.users = [{
      id: adminId,
      username: db.admin.username || 'admin',
      passwordHash: hashPassword(pw),
      role: 'admin',
      displayName: 'Administrator',
      accessFilters: { ips: [], browserUsers: [], browserDomains: [] },
    }];
    delete db.admin;
    changed = true;
  }
  if (!db.users) { db.users = []; changed = true; }
  if (!db.settings) { db.settings = { allowEmptyStudentPassword: true }; changed = true; }
  if (typeof db.settings.allowEmptyStudentPassword !== 'boolean') {
    db.settings.allowEmptyStudentPassword = true; changed = true;
  }
  if (!db.classes) { db.classes = []; changed = true; }
  if (!db.topics) { db.topics = []; changed = true; }
  if (typeof db.examMode !== 'boolean') { db.examMode = false; changed = true; }
  if (!db.results) { db.results = []; changed = true; }
  if (!db.studentSelectedTopics) { db.studentSelectedTopics = {}; changed = true; }
  if (!db.nextResultId) { db.nextResultId = 1; changed = true; }

  // Migrate old flat modules list to first topic
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
    changed = true;
  }

  // Ensure topics have ownerId/permissions
  const firstAdmin = db.users.find(u => u.role === 'admin');
  for (const t of db.topics) {
    if (!t.ownerId && firstAdmin) { t.ownerId = firstAdmin.id; changed = true; }
    if (!t.permissions) { t.permissions = { visibleTo: 'all' }; changed = true; }
  }

  if (changed) saveDB(db);
  return db;
}

function saveDB(db) {
  ensureDataDir();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

// Helper: get user by username
function findUser(db, username) {
  return db.users.find(u => u.username === username) || null;
}

// Helper: check if a student can see a topic
function studentCanSeeTopic(topic, user, db) {
  if (!topic.permissions) return true;
  const v = topic.permissions.visibleTo;
  if (!v || v === 'all') return true;
  if (v === 'none') return false;
  if (v === 'classes' && Array.isArray(topic.permissions.classIds)) {
    return (user.classIds || []).some(cid => topic.permissions.classIds.includes(cid));
  }
  return true;
}

// Helper: topics visible to a teacher (own or explicitly shared via sharedWith array)
function topicsForTeacher(db, userId) {
  return db.topics.filter(t =>
    t.ownerId === userId ||
    (Array.isArray(t.sharedWith) && t.sharedWith.includes(userId)) ||
    t.permissions?.teacherShared === true // legacy flag
  );
}

/**
 * Global Helper for administrative topic and module access.
 * Returns true if the user is an admin OR the owner OR it is shared with them.
 */
function canEditTopic(topic, user) {
  if (!topic || !user) return false;
  if (user.role === 'admin') return true;
  if (topic.ownerId === user.id) return true;
  if (Array.isArray(topic.sharedWith) && topic.sharedWith.includes(user.id)) return true;
  return false;
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

      const mappedDropZones = dropZones.map((dz, i) => {
        const correctIndices = Array.isArray(dz.correctElements) ? dz.correctElements : [];
        let correctDraggable = '';
        if (correctIndices.length > 0) {
          const firstIdx = parseInt(correctIndices[0], 10);
          if (!isNaN(firstIdx) && elements[firstIdx]) {
            const el = elements[firstIdx];
            const rawText = el.type && el.type.params
              ? el.type.params.text || (el.type.params.file && el.type.params.file.path) || ''
              : '';
            correctDraggable = stripHtml(rawText) || `Element ${firstIdx + 1}`;
          }
        }
        return {
          label: stripHtml(dz.label || '') || `Zone ${i + 1}`,
          x: Math.round(dz.x || 0),
          y: Math.round(dz.y || 0),
          width: Math.round(dz.width || 20),
          height: Math.round(dz.height || 20),
          correctDraggable, // Set this side of the mapping too
        };
      });

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
// --- Global state ---
const PORT = process.env.PORT || 3000;
const WEB_PORT = PORT;
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

// --- Embedded Web Server for WLAN/browser access ---
function startWebServer() {
  const web = express();
  const rendererDir = path.join(__dirname, '../renderer');
  const assetsDir = path.join(__dirname, '../../assets');

  // ---- AUTH API ----

  web.post('/api/auth/login', express.json({ limit: '1mb' }), (req, res) => {
    const { username, password } = req.body || {};
    if (!username) return res.status(400).json({ error: 'Benutzername fehlt' });
    const db = loadDB();
    const user = findUser(db, username);
    if (!user) return res.status(401).json({ error: 'Unbekannter Benutzer' });

    // Student with empty password + setting allowEmptyStudentPassword
    if (user.role === 'student' && !user.passwordHash && db.settings.allowEmptyStudentPassword) {
      const token = makeToken(user);
      return res.json({ token, role: user.role, username: user.username, displayName: user.displayName, id: user.id });
    }

    if (!verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Falsches Passwort' });
    }

    // Check IP access filters for teacher/admin
    if (user.role !== 'student' && user.accessFilters) {
      const af = user.accessFilters;
      const clientIp = req.ip || req.connection?.remoteAddress || '';
      if (af.ips && af.ips.length > 0 && !af.ips.some(ip => clientIp.includes(ip))) {
        return res.status(403).json({ error: 'IP nicht zugelassen', filterFailed: 'ip' });
      }
    }

    const token = makeToken(user);
    res.json({ token, role: user.role, username: user.username, displayName: user.displayName, id: user.id });
  });

  web.get('/api/auth/me', requireAuth(null), (req, res) => {
    res.json(req.authUser);
  });

  // Public: client needs to know if empty student passwords are allowed and if teacher login should be shown
  web.get('/api/auth/settings', (req, res) => {
    const db = loadDB();
    const clientIp = req.ip || req.connection?.remoteAddress || '';
    
    // Check if teacher login should be shown based on IP filters
    // Requirement from design doc: If filters are active and fail, don't show teacher login.
    // Logic: If there is at least one teacher/admin with NO IP restriction, OR if the client matches at least one, show it.
    const teachers = db.users.filter(u => u.role === 'admin' || u.role === 'teacher');
    let showTeacherLogin = false;

    if (teachers.length === 0) {
      showTeacherLogin = true; // Still show if no users yet (for setup)
    } else {
      for (const t of teachers) {
        const af = t.accessFilters || { ips: [] };
        // If user has no IP filter, they can login from anywhere -> show login
        if (!af.ips || af.ips.length === 0) {
          showTeacherLogin = true;
          break;
        }
        // If client IP matches their filter -> show login
        if (af.ips.some(ip => clientIp.includes(ip))) {
          showTeacherLogin = true;
          break;
        }
      }
    }

    res.json({ 
      allowEmptyStudentPassword: !!db.settings.allowEmptyStudentPassword,
      showTeacherLogin 
    });
  });

  // ---- ADMIN: SETTINGS ----

  web.get('/api/admin/settings', requireAuth(['admin']), (_req, res) => {
    const db = loadDB();
    res.json(db.settings);
  });

  web.post('/api/admin/settings', requireAuth(['admin']), express.json({ limit: '1mb' }), (req, res) => {
    const db = loadDB();
    Object.assign(db.settings, req.body);
    saveDB(db);
    res.json({ success: true, settings: db.settings });
  });

  web.get('/api/admin/topics/:id/export-h5p', requireAuth(['admin', 'teacher', 'student']), (req, res) => {
    const topicId = req.params.id;
    const result = generateH5pBuffer(topicId);
    if (!result.success) {
      return res.status(result.error === 'Thema nicht gefunden' ? 404 : 500).json({ error: result.error });
    }
    const safeName = (result.topicTitle || 'export').replace(/[^\w\säöüÄÖÜß-]/g, '_');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.h5p"`);
    res.send(result.buffer);
  });

  // --- ADMIN: USER MANAGEMENT ----

  web.get('/api/admin/users', requireAuth(['admin', 'teacher']), (req, res) => {
    const db = loadDB();
    const users = req.authUser.role === 'admin'
      ? db.users
      : db.users.filter(u => u.role === 'student');
    res.json(users.map(u => ({ id: u.id, username: u.username, displayName: u.displayName, role: u.role, classIds: u.classIds, accessFilters: u.accessFilters })));
  });

  // === USER IMPORT (Excel/CSV) ===
  const upload = multer({ dest: os.tmpdir() });

  /**
   * POST /api/admin/module-import
   * Admin/Lehrer können eine JSON-Datei hochladen, um Module (oder ein ganzes Thema) zu importieren.
   * Erwartet: multipart/form-data mit 'file' (.json) und optional 'topicId'.
   * Falls 'topicId' fehlt, wird ein neues Thema angelegt.
   */
  web.post('/api/admin/module-import', requireAuth(['admin', 'teacher']), upload.single('file'), (req, res) => {
    let topicId = req.body.topicId;
    if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });

    let importData;
    try {
      importData = JSON.parse(fs.readFileSync(req.file.path, 'utf-8'));
    } catch (e) {
      return res.status(400).json({ error: 'Ungültiges JSON-Format: ' + e.message });
    }

    let importModules = [];
    let topicTitle = 'Importiertes Thema';
    let topicDesc = '';

    if (importData.topic) {
      importModules = importData.topic.modules || [];
      topicTitle = importData.topic.title || topicTitle;
      topicDesc = importData.topic.description || '';
    } else if (importData.modules && Array.isArray(importData.modules)) {
      importModules = importData.modules;
    }

    if (importModules.length === 0) {
      return res.status(400).json({ error: 'Keine Module in der Datei gefunden' });
    }

    const db = loadDB();
    let topic;

    if (!topicId) {
      // Neues Thema anlegen
      topic = {
        id: 'topic_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
        title: topicTitle,
        description: topicDesc,
        ownerId: req.authUser.id,
        selected: false,
        createdAt: new Date().toISOString(),
        modules: []
      };
      db.topics.push(topic);
    } else {
      topic = db.topics.find(t => t.id === topicId);
      if (!topic) return res.status(404).json({ error: 'Thema nicht gefunden' });
      if (!topic.modules) topic.modules = [];
    }

    // IDs für neue Module generieren
    const newModules = importModules.map((m) => {
      const mod = {
        ...m,
        id: 'mod_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
        moduleSelected: true,
        createdAt: m.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Normalize Drag and Drop bidirectional mapping
      if (mod.type === 'dragAndDrop' && mod.content) {
        const c = mod.content;
        const zones = Array.isArray(c.dropZones) ? c.dropZones : [];
        const drags = Array.isArray(c.draggables) ? c.draggables : [];

        // 1. Sync from draggable to zone
        drags.forEach(d => {
          if (d.correctZone && d.text) {
            const z = zones.find(zz => zz.label === d.correctZone);
            if (z && !z.correctDraggable) z.correctDraggable = d.text;
          }
        });

        // 2. Sync from zone to draggable
        zones.forEach(z => {
          if (z.correctDraggable && z.label) {
            const d = drags.find(dd => dd.text === z.correctDraggable);
            if (d && !d.correctZone) d.correctZone = z.label;
          }
        });
      }
      return mod;
    });

    topic.modules.push(...newModules);
    saveDB(db);

    // Return format matching the Electron IPC for consistency in app.js
    res.json({
      success: true,
      importedCount: newModules.length,
      topicTitle: topic.title,
      modules: newModules.map(m => ({ id: m.id, title: m.title, type: m.type, description: m.description || '' })),
      _fullModules: newModules
    });
  });


  /**
   * POST /api/admin/user-import
   * Admin/Lehrer können eine Excel- oder CSV-Datei hochladen, um Nutzer zu importieren.
   * Erwartete Spalten: login, password, class, role, firstname, lastname, email
   */
  web.post('/api/admin/user-import', requireAuth(['admin', 'teacher']), upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });
    let users;
    try {
      users = parseUserImportFile(req.file.path);
    } catch (e) {
      return res.status(400).json({ error: 'Datei konnte nicht gelesen werden: ' + e.message });
    }
    const db = loadDB();
    const created = [];
    const skipped = [];
    for (const row of users) {
      const username = (row.login || '').trim();
      const password = (row.password || '').trim();
      const role = (row.role || '').trim().toLowerCase();
      let className = (row.class || '').trim();
      let classId = null;
      if (!username || !role || (req.authUser.role === 'teacher' && role !== 'student')) {
        skipped.push({ username, reason: 'Pflichtfelder fehlen oder Rolle nicht erlaubt' });
        continue;
      }
      if (findUser(db, username)) {
        skipped.push({ username, reason: 'Benutzername bereits vergeben' });
        continue;
      }
      // Klasse ggf. anlegen
      if (className) {
        if (!db.classes) db.classes = [];
        let cls = db.classes.find(c => c.name === className);
        if (!cls) {
          cls = { id: makeClassId(), name: className, createdBy: req.authUser.id, createdAt: new Date().toISOString() };
          db.classes.push(cls);
        }
        classId = cls.id;
      }
      const newUser = {
        id: makeUserId(),
        username,
        passwordHash: hashPassword(password),
        role,
        displayName: (row.firstname || '') + (row.lastname ? ' ' + row.lastname : '') || username,
        classIds: classId ? [classId] : [],
        accessFilters: { ips: [], browserUsers: [], browserDomains: [] },
        email: row.email || '',
      };
      db.users.push(newUser);
      created.push(username);
    }
    saveDB(db);
    // Datei löschen
    fs.unlink(req.file.path, () => {});
    res.json({ success: true, created, skipped, total: users.length });
  });

  web.post('/api/admin/users', requireAuth(['admin', 'teacher']), express.json({ limit: '1mb' }), (req, res) => {
    const db = loadDB();
    const { username, password, role, displayName, classIds, accessFilters } = req.body;
    if (!username || !role) return res.status(400).json({ error: 'username und role sind Pflichtfelder' });
    if (req.authUser.role === 'teacher' && role !== 'student') {
      return res.status(403).json({ error: 'Lehrer dürfen nur Schüler erstellen' });
    }
    if (findUser(db, username)) return res.status(409).json({ error: 'Benutzername bereits vergeben' });
    const newUser = {
      id: makeUserId(),
      username,
      passwordHash: hashPassword(password || ''),
      role,
      displayName: displayName || username,
      classIds: classIds || [],
      accessFilters: accessFilters || { ips: [], browserUsers: [], browserDomains: [] },
    };
    db.users.push(newUser);
    saveDB(db);
    const { passwordHash: _, ...safe } = newUser;
    res.json({ success: true, user: safe });
  });

  web.put('/api/admin/users/:id', requireAuth(['admin', 'teacher']), express.json({ limit: '1mb' }), (req, res) => {
    const db = loadDB();
    const idx = db.users.findIndex(u => u.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    const target = db.users[idx];
    if (req.authUser.role === 'teacher' && target.role !== 'student') {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }
    const { password, displayName, classIds, accessFilters, role } = req.body;
    if (displayName !== undefined) target.displayName = displayName;
    if (classIds !== undefined) target.classIds = classIds;
    if (accessFilters !== undefined && req.authUser.role === 'admin') target.accessFilters = accessFilters;
    if (role !== undefined && req.authUser.role === 'admin') target.role = role;
    if (password !== undefined) target.passwordHash = hashPassword(password);
    saveDB(db);
    const { passwordHash: _, ...safe } = target;
    res.json({ success: true, user: safe });
  });

  web.delete('/api/admin/users/:id', requireAuth(['admin', 'teacher']), (req, res) => {
    const db = loadDB();
    const idx = db.users.findIndex(u => u.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    const target = db.users[idx];
    if (req.authUser.role === 'teacher' && target.role !== 'student') {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }
    if (target.id === req.authUser.id) return res.status(400).json({ error: 'Eigenes Konto kann nicht gelöscht werden' });

    if (target.role === 'admin') {
      const adminCount = db.users.filter(u => u.role === 'admin').length;
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Der letzte Administrator kann nicht gelöscht werden' });
      }
    }

    db.users.splice(idx, 1);
    saveDB(db);
    res.json({ success: true });
  });

  // ---- ADMIN: CLASS MANAGEMENT ----

  web.get('/api/admin/classes', requireAuth(['admin', 'teacher']), (_req, res) => {
    const db = loadDB();
    res.json(db.classes || []);
  });

  web.post('/api/admin/classes', requireAuth(['admin', 'teacher']), express.json({ limit: '1mb' }), (req, res) => {
    const db = loadDB();
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name ist Pflichtfeld' });
    const newClass = { id: makeClassId(), name, createdBy: req.authUser.id, createdAt: new Date().toISOString() };
    if (!db.classes) db.classes = [];
    db.classes.push(newClass);
    saveDB(db);
    res.json({ success: true, class: newClass });
  });

  web.put('/api/admin/classes/:id', requireAuth(['admin', 'teacher']), express.json({ limit: '1mb' }), (req, res) => {
    const db = loadDB();
    const cls = (db.classes || []).find(c => c.id === req.params.id);
    if (!cls) return res.status(404).json({ error: 'Klasse nicht gefunden' });
    if (req.body.name !== undefined) cls.name = req.body.name;
    saveDB(db);
    res.json({ success: true, class: cls });
  });

  web.delete('/api/admin/classes/:id', requireAuth(['admin', 'teacher']), (req, res) => {
    const db = loadDB();
    if (!db.classes) return res.status(404).json({ error: 'Klasse nicht gefunden' });
    const idx = db.classes.findIndex(c => c.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Klasse nicht gefunden' });
    db.classes.splice(idx, 1);
    for (const u of db.users) {
      if (Array.isArray(u.classIds)) u.classIds = u.classIds.filter(cid => cid !== req.params.id);
    }
    saveDB(db);
    res.json({ success: true });
  });

  // ---- TOPIC PERMISSIONS ----

  web.post('/api/admin/topic-permissions', requireAuth(['admin', 'teacher']), express.json({ limit: '1mb' }), (req, res) => {
    const db = loadDB();
    const { topicId, visibleTo, classIds, teacherShared } = req.body;
    const topic = db.topics.find(t => t.id === topicId);
    if (!topic) return res.status(404).json({ error: 'Thema nicht gefunden' });
    if (req.authUser.role !== 'admin' && topic.ownerId !== req.authUser.id) {
      return res.status(403).json({ error: 'Nur Owner oder Admin dürfen Berechtigungen ändern' });
    }
    if (!topic.permissions) topic.permissions = {};
    if (visibleTo !== undefined) topic.permissions.visibleTo = visibleTo;
    if (classIds !== undefined) topic.permissions.classIds = classIds;
    if (teacherShared !== undefined) topic.permissions.teacherShared = !!teacherShared;
    saveDB(db);
    res.json({ success: true, permissions: topic.permissions });
  });

  // ---- SECURED STUDENT API ----

  web.get('/api/selected-topics', requireAuth(null), (req, res) => {
    const db = loadDB();
    const user = db.users.find(u => u.id === req.authUser.id) || {};
    const selected = (db.topics || []).filter(t => t.selected !== false && studentCanSeeTopic(t, user, db));
    res.json(selected.map(topic => ({
      ...topic,
      modules: (topic.modules || []).filter(m => m.moduleSelected !== false),
    })));
  });

  web.get('/api/topics/:topicId/modules', requireAuth(null), (req, res) => {
    const db = loadDB();
    const topic = (db.topics || []).find(t => t.id === req.params.topicId);
    if (!topic) return res.json([]);
    
    // Admins and teachers see all modules; students only see selected ones
    const canSeeAll = req.authUser && (req.authUser.role === 'admin' || req.authUser.role === 'teacher');
    if (canSeeAll) {
      res.json(topic.modules || []);
    } else {
      res.json((topic.modules || []).filter(m => m.moduleSelected !== false));
    }
  });

  web.get('/api/student-selections/:username', requireAuth(null), (req, res) => {
    const db = loadDB();
    res.json(db.studentSelectedTopics[req.params.username] || []);
  });

  web.post('/api/student-selections/:username', requireAuth(null), express.json({ limit: '1mb' }), (req, res) => {
    const db = loadDB();
    if (!db.studentSelectedTopics) db.studentSelectedTopics = {};
    db.studentSelectedTopics[req.params.username] = req.body.topicIds || [];
    saveDB(db);
    res.json({ success: true });
  });

  web.post('/api/quiz-result', requireAuth(null), express.json({ limit: '10mb' }), (req, res) => {
    const db = loadDB();
    const resultData = req.body;
    resultData.id = db.nextResultId++;
    resultData.timestamp = new Date().toISOString();
    resultData.ipAddress = req.ip || req.connection?.remoteAddress || '';
    resultData.systemUsername = req.authUser?.username || 'Browser-Gerät';
    db.results.push(resultData);
    saveDB(db);
    res.json({ success: true, id: resultData.id });
  });

  web.get('/api/quiz-results', requireAuth(['admin', 'teacher']), (_req, res) => {
    const db = loadDB();
    res.json((db.results || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
  });

  web.delete('/api/quiz-results/:id', requireAuth(['admin', 'teacher']), (req, res) => {
    const db = loadDB();
    db.results = db.results.filter(r => String(r.id) !== String(req.params.id));
    saveDB(db);
    res.json({ success: true });
  });

  web.delete('/api/quiz-results', requireAuth(['admin', 'teacher']), (_req, res) => {
    const db = loadDB();
    db.results = [];
    saveDB(db);
    res.json({ success: true });
  });

  web.get('/api/exam-mode', (_req, res) => {
    const db = loadDB();
    res.json({ enabled: !!db.examMode });
  });

  web.post('/api/exam-mode', requireAuth(['admin', 'teacher']), express.json({ limit: '1mb' }), (req, res) => {
    const db = loadDB();
    db.examMode = !!req.body.enabled;
    saveDB(db);
    res.json({ success: true, enabled: db.examMode });
  });

  // ---- TEACHER/ADMIN: FULL TOPIC CRUD ----

  web.get('/api/admin/topics', requireAuth(['admin', 'teacher']), (req, res) => {
    const db = loadDB();
    const topics = req.authUser.role === 'admin' ? db.topics : topicsForTeacher(db, req.authUser.id);
    res.json(topics);
  });

  web.post('/api/admin/topics', requireAuth(['admin', 'teacher']), express.json({ limit: '10mb' }), (req, res) => {
    const db = loadDB();
    const topicData = req.body;
    if (!topicData.id) topicData.id = 'topic_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    topicData.ownerId = topicData.ownerId || req.authUser.id;
    topicData.permissions = topicData.permissions || { visibleTo: 'all' };
    topicData.modules = topicData.modules || [];
    const idx = db.topics.findIndex(t => t.id === topicData.id);
    if (idx >= 0) {
      if (req.authUser.role !== 'admin' && db.topics[idx].ownerId !== req.authUser.id) {
        return res.status(403).json({ error: 'Keine Berechtigung' });
      }
      // Preserve modules if not provided, and preserve sharedWith if not provided
      topicData.modules = topicData.modules.length ? topicData.modules : (db.topics[idx].modules || []);
      topicData.sharedWith = topicData.sharedWith !== undefined ? topicData.sharedWith : (db.topics[idx].sharedWith || []);
      db.topics[idx] = topicData;
    } else {
      db.topics.push(topicData);
    }
    saveDB(db);
    res.json({ success: true });
  });

  // PATCH: partial update — for toggling selected, updating sharedWith, permissions etc.
  web.patch('/api/admin/topics/:id', requireAuth(['admin', 'teacher']), express.json({ limit: '1mb' }), (req, res) => {
    const db = loadDB();
    const idx = db.topics.findIndex(t => t.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Thema nicht gefunden' });
    const topic = db.topics[idx];
    const isOwner = topic.ownerId === req.authUser.id;
    const isShared = Array.isArray(topic.sharedWith) && topic.sharedWith.includes(req.authUser.id);
    if (req.authUser.role !== 'admin' && !isOwner && !isShared) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }
    // Only allow patching safe fields
    const allowed = ['selected', 'permissions', 'sharedWith', 'title', 'description'];
    // sharedWith can only be changed by owner or admin
    if ('sharedWith' in req.body && req.authUser.role !== 'admin' && !isOwner) {
      return res.status(403).json({ error: 'Nur der Eigentümer kann Freigaben ändern' });
    }
    for (const key of allowed) {
      if (key in req.body) topic[key] = req.body[key];
    }
    saveDB(db);
    res.json({ success: true });
  });

  // ---- MODULE MANAGEMENT ----

  web.post('/api/admin/topics/:topicId/modules', requireAuth(['admin', 'teacher']), express.json({ limit: '1mb' }), (req, res) => {
    const { topicId } = req.params;
    const moduleData = req.body;
    if (!moduleData || !moduleData.id) return res.status(400).json({ error: 'Ungültige Moduldaten' });

    const db = loadDB();
    const topic = (db.topics || []).find(t => t.id === topicId);
    if (!topic) return res.status(404).json({ error: 'Thema nicht gefunden' });

    if (!canEditTopic(topic, req.authUser)) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    if (!topic.modules) topic.modules = [];
    const index = topic.modules.findIndex(m => m.id === moduleData.id);

    if (index !== -1) {
      // Update existing module
      topic.modules[index] = {
        ...topic.modules[index],
        ...moduleData,
        updatedAt: new Date().toISOString()
      };
    } else {
      // Add new module
      topic.modules.push({
        ...moduleData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    saveDB(db);
    res.json({ success: true, moduleId: moduleData.id });
  });

  web.patch('/api/admin/topics/:topicId/modules/:moduleId/toggle', requireAuth(['admin', 'teacher']), express.json(), (req, res) => {
    const db = loadDB();
    const topic = db.topics.find(t => t.id === req.params.topicId);
    if (!topic) return res.status(404).json({ error: 'Thema nicht gefunden' });
    
    if (!canEditTopic(topic, req.authUser)) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    const mod = (topic.modules || []).find(m => m.id === req.params.moduleId);
    if (!mod) return res.status(404).json({ error: 'Modul nicht gefunden' });

    mod.moduleSelected = !!req.body.selected;
    saveDB(db);
    res.json({ success: true });
  });

  web.patch('/api/admin/topics/:topicId/modules/bulk-toggle', requireAuth(['admin', 'teacher']), express.json(), (req, res) => {
    const db = loadDB();
    const topic = db.topics.find(t => t.id === req.params.topicId);
    if (!topic) return res.status(404).json({ error: 'Thema nicht gefunden' });
    
    if (!canEditTopic(topic, req.authUser)) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    const { moduleIds, selected } = req.body;
    if (!Array.isArray(moduleIds)) return res.status(400).json({ error: 'moduleIds fehlt' });

    (topic.modules || []).forEach(m => {
      if (moduleIds.includes(m.id)) {
        m.moduleSelected = !!selected;
      }
    });

    saveDB(db);
    res.json({ success: true });
  });

  web.post('/api/admin/topics/:topicId/modules/reorder', requireAuth(['admin', 'teacher']), express.json(), (req, res) => {
    const db = loadDB();
    const topic = db.topics.find(t => t.id === req.params.topicId);
    if (!topic) return res.status(404).json({ error: 'Thema nicht gefunden' });

    if (!canEditTopic(topic, req.authUser)) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    const { moduleIds } = req.body;
    if (!Array.isArray(moduleIds)) return res.status(400).json({ error: 'moduleIds Array fehlt' });

    const oldModules = topic.modules || [];
    const byId = Object.fromEntries(oldModules.map(m => [m.id, m]));
    topic.modules = moduleIds.map(id => byId[id]).filter(Boolean);

    // Append any modules not in the new order (safety net)
    const idSet = new Set(moduleIds);
    oldModules.filter(m => !idSet.has(m.id)).forEach(m => topic.modules.push(m));

    saveDB(db);
    res.json({ success: true });
  });

  web.delete('/api/admin/topics/:topicId/modules/:moduleId', requireAuth(['admin', 'teacher']), (req, res) => {
    const db = loadDB();
    const topic = db.topics.find(t => t.id === req.params.topicId);
    if (!topic) return res.status(404).json({ error: 'Thema nicht gefunden' });

    if (!canEditTopic(topic, req.authUser)) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    topic.modules = (topic.modules || []).filter(m => m.id !== req.params.moduleId);
    saveDB(db);
    res.json({ success: true });
  });

  web.delete('/api/admin/topics/:id', requireAuth(['admin', 'teacher']), (req, res) => {
    const db = loadDB();
    const idx = db.topics.findIndex(t => t.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Thema nicht gefunden' });
    if (req.authUser.role !== 'admin' && db.topics[idx].ownerId !== req.authUser.id) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }
    db.topics.splice(idx, 1);
    saveDB(db);
    res.json({ success: true });
  });

  // ---- H5P UPLOAD (browser multipart — fallback for non-Electron) ----
  web.post('/api/h5p/upload', requireAuth(['admin', 'teacher']), (req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks);
        const contentType = req.headers['content-type'] || '';
        const boundaryMatch = contentType.match(/boundary=([^\s;]+)/i);
        if (!boundaryMatch) return res.status(400).json({ error: 'Kein Multipart-Boundary gefunden' });
        const boundary = Buffer.from('--' + boundaryMatch[1]);
        // Parse multipart manually
        let fileBuffer = null;
        let fileName = 'upload.h5p';
        let importMode = req.headers['x-import-mode'] || 'native';
        let start = 0;
        while (start < body.length) {
          const bIdx = body.indexOf(boundary, start);
          if (bIdx < 0) break;
          const partStart = bIdx + boundary.length + 2; // skip \r\n
          const nextBIdx = body.indexOf(boundary, partStart);
          if (nextBIdx < 0) break;
          const partEnd = nextBIdx - 2; // trim \r\n before next boundary
          const part = body.slice(partStart, partEnd);
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd < 0) { start = nextBIdx; continue; }
          const headerStr = part.slice(0, headerEnd).toString('utf8');
          const fnMatch = headerStr.match(/filename="([^"]+)"/i);
          if (fnMatch) {
            fileName = fnMatch[1];
            fileBuffer = part.slice(headerEnd + 4);
          }
          start = nextBIdx;
        }
        if (!fileBuffer || fileBuffer.length < 10) return res.status(400).json({ error: 'Keine H5P-Datei gefunden' });
        const result = processH5pBuffer(fileBuffer, fileName, importMode);
        if (!result.success) return res.status(400).json(result);
        const db = loadDB();
        result.topic.ownerId = req.authUser.id;
        db.topics.push(result.topic);
        saveDB(db);
        res.json({ success: true, topicTitle: result.topic.title, importedCount: result.topic.modules.length, importMode: result.importMode });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    req.on('error', (e) => res.status(500).json({ error: e.message }));
  });

  // QR code endpoint
  web.get('/api/qrcode.svg', async (_req, res) => {
    if (!webServerUrl) return res.status(503).send('Server not ready');
    try {
      const svg = await QRCode.toString(webServerUrl, { type: 'svg', margin: 1 });
      res.type('image/svg+xml').send(svg);
    } catch (e) {
      res.status(500).send('QR generation failed');
    }
  });

  // Static files
  web.use('/assets', express.static(assetsDir));
  web.use(express.static(rendererDir));

  // SPA fallback
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
        webServerUrl = ip ? `http://${ip}:${port}` : `http://localhost:${port}`;
        console.log(`Web-Server gestartet auf alternativem Port: ${webServerUrl}`);
      });
    } else {
      console.error('Web-Server Fehler:', err.message);
    }
  });
}

// --- Start Server ---
console.log('--- LearningModules Web Server ---');
console.log(`Data directory: ${DATA_DIR}`);
startWebServer();

// ============================================================
// === H5P PROCESSING LOGIC (Restored) ========================
// ============================================================

function processH5pBuffer(buffer, fileName, importMode = 'native') {
  let entries;
  try { entries = readZip(buffer); }
  catch (e) { return { success: false, error: 'Ungültige H5P-Datei: ' + e.message }; }

  if (!entries['h5p.json']) return { success: false, error: 'h5p.json fehlt in der H5P-Datei' };
  let h5pMeta;
  try { h5pMeta = JSON.parse(entries['h5p.json'].toString('utf8')); }
  catch { return { success: false, error: 'Fehler beim Lesen von h5p.json' }; }

  if (!entries['content/content.json']) return { success: false, error: 'content/content.json fehlt in der H5P-Datei' };
  let contentData;
  try { contentData = JSON.parse(entries['content/content.json'].toString('utf8')); }
  catch { return { success: false, error: 'Fehler beim Lesen von content/content.json' }; }

  const mimeByExt = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp' };
  const h5pImages = {};
  for (const [entryName, entryData] of Object.entries(entries)) {
    if (entryName.startsWith('content/images/')) {
      const imgName = path.basename(entryName);
      const ext = path.extname(imgName).toLowerCase().slice(1);
      h5pImages[imgName] = `data:${mimeByExt[ext] || 'image/png'};base64,${entryData.toString('base64')}`;
    }
  }

  const mainLibrary = h5pMeta.mainLibrary || '';
  const baseName = path.basename(fileName, '.h5p');
  const topicTitle = h5pMeta.title || h5pMeta.extraTitle || baseName;
  const rawItems = mainLibrary === 'H5P.QuestionSet'
    ? (Array.isArray(contentData.questions) ? contentData.questions : []).map((q, idx) => ({
        title: (q.metadata && q.metadata.title) || `Aufgabe ${idx + 1}`,
        library: q.library || '',
      }))
    : [{ title: topicTitle, library: mainLibrary }];
  const h5pRawSummary = { mainLibrary, itemCount: rawItems.length, items: rawItems };

  if (importMode === 'raw') {
    const topic = {
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
      h5pRawPackage: { fileName, dataBase64: buffer.toString('base64'), importedAt: new Date().toISOString() },
      permissions: { visibleTo: 'all' },
    };
    return { success: true, topic, importMode: 'raw' };
  }

  const modules = [];
  if (mainLibrary === 'H5P.QuestionSet') {
    for (const q of (Array.isArray(contentData.questions) ? contentData.questions : [])) {
      const machineName = (q.library || '').split(' ')[0];
      const converted = convertH5pToNative(machineName, q.params || {}, h5pImages);
      const sourceSubContentId = q.subContentId || h5pUuid();
      modules.push({
        id: 'mod_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
        title: (q.metadata && q.metadata.title) || 'Aufgabe',
        type: converted ? converted.type : 'h5p_native',
        description: (q.metadata && q.metadata.contentType) || machineName.replace('H5P.', ''),
        content: converted ? converted.content : { library: q.library || '', machineName, params: q.params || {}, subContentId: sourceSubContentId },
        h5pSource: { library: q.library || '', machineName, params: q.params || {}, metadata: q.metadata || {}, subContentId: sourceSubContentId },
        moduleSelected: true, createdAt: new Date().toISOString(),
      });
    }
  } else {
    const converted = convertH5pToNative(mainLibrary, contentData, h5pImages);
    const sourceSubContentId = h5pUuid();
    modules.push({
      id: 'mod_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      title: h5pMeta.title || h5pMeta.extraTitle || baseName,
      type: converted ? converted.type : 'h5p_native',
      description: mainLibrary.replace('H5P.', ''),
      content: converted ? converted.content : { library: mainLibrary, machineName: mainLibrary, params: contentData, subContentId: sourceSubContentId },
      h5pSource: { library: mainLibrary, machineName: mainLibrary, params: contentData,
        metadata: { contentType: mainLibrary.replace('H5P.', ''), title: topicTitle, extraTitle: topicTitle, license: 'U', authors: [], changes: [] },
        subContentId: sourceSubContentId },
      moduleSelected: true, createdAt: new Date().toISOString(),
    });
  }

  const topic = {
    id: 'topic_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    title: topicTitle,
    description: `Importiert aus H5P (${mainLibrary})`,
    selected: false,
    createdAt: new Date().toISOString(),
    modules,
    h5pImages,
    h5pMeta: { mainLibrary, title: topicTitle },
    h5pImportMode: 'native',
    permissions: { visibleTo: 'all' },
  };
  return { success: true, topic, importMode: 'native' };
}

function generateH5pBuffer(topicId) {
  const db = loadDB();
  const topic = db.topics.find((t) => t.id === topicId);
  if (!topic) return { success: false, error: 'Thema nicht gefunden' };

  // Raw import mode: export original package unchanged
  if (topic.h5pImportMode === 'raw' && topic.h5pRawPackage && topic.h5pRawPackage.dataBase64) {
    try {
      return {
        success: true,
        buffer: Buffer.from(topic.h5pRawPackage.dataBase64, 'base64'),
        topicTitle: topic.title,
        exportedMode: 'raw'
      };
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
    'h5p.json':              Buffer.from(JSON.stringify(h5pJson,    null, 2), 'utf8'),
    'content/content.json': Buffer.from(JSON.stringify(contentJson, null, 2), 'utf8'),
  };
  for (const [imgName, dataUrl] of Object.entries(exportImages)) {
    const b64 = dataUrl.split(',')[1];
    if (b64) zipFiles[`content/images/${imgName}`] = Buffer.from(b64, 'base64');
  }

  try {
    return {
      success: true,
      buffer: createZip(zipFiles),
      topicTitle: topic.title,
      exportedMode: 'native'
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
