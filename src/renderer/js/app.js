/**
 * LearningModules v2.0 - Main Application Logic
 * Features: Teacher/Student Login, Topic Management, Quiz Mode with Results
 */

// --- State ---
let currentUser = null; // { name, role: 'teacher'|'student' }
let topics = [];
let currentTopicId = null;
let currentTopicModules = [];
let editingModuleId = null;
let editingTopicId = null;
let contentEditor = null;

// Quiz state
let quizState = null; // { topicId, modules, currentIndex, answers, startTime }

// --- DOM Elements ---

// Login
const loginScreen = document.getElementById('loginScreen');
const appContainer = document.getElementById('appContainer');
const loginForm = document.getElementById('loginForm');
const loginName = document.getElementById('loginName');
const btnShowAdminLogin = document.getElementById('btnShowAdminLogin');
const adminLoginSection = document.getElementById('adminLoginSection');
const adminLoginForm = document.getElementById('adminLoginForm');
const adminUsername = document.getElementById('adminUsername');
const adminPassword = document.getElementById('adminPassword');
const adminLoginError = document.getElementById('adminLoginError');

// App shell
const sidebar = document.getElementById('sidebar');
const userInfo = document.getElementById('userInfo');
const teacherNav = document.getElementById('teacherNav');
const studentNav = document.getElementById('studentNav');
const btnLogout = document.getElementById('btnLogout');
const toastContainer = document.getElementById('toastContainer');
const views = document.querySelectorAll('.view');

// Teacher Dashboard
const statTopics = document.getElementById('statTopics');
const statModules = document.getElementById('statModules');
const statActive = document.getElementById('statActive');
const statResults = document.getElementById('statResults');
const typeGrid = document.getElementById('typeGrid');

// Teacher Topics
const topicsList = document.getElementById('topicsList');
const btnNewTopic = document.getElementById('btnNewTopic');
const btnImportTopic = document.getElementById('btnImportTopic');
const topicFormContainer = document.getElementById('topicFormContainer');
const topicForm = document.getElementById('topicForm');
const topicFormTitle = document.getElementById('topicFormTitle');
const topicTitleInput = document.getElementById('topicTitle');
const topicDescInput = document.getElementById('topicDescription');
const btnCancelTopic = document.getElementById('btnCancelTopic');

// Teacher Modules
const modulesBreadcrumb = document.getElementById('modulesBreadcrumb');
const backToTopics = document.getElementById('backToTopics');
const currentTopicName = document.getElementById('currentTopicName');
const modulesViewTitle = document.getElementById('modulesViewTitle');
const searchModules = document.getElementById('searchModules');
const filterType = document.getElementById('filterType');
const btnCreateModule = document.getElementById('btnCreateModule');
const btnExportCurrentTopic = document.getElementById('btnExportCurrentTopic');
const modulesList = document.getElementById('modulesList');

// Create/Edit Module
const moduleForm = document.getElementById('moduleForm');
const moduleIdInput = document.getElementById('moduleId');
const moduleTitleInput = document.getElementById('moduleTitle');
const moduleTypeSelect = document.getElementById('moduleType');
const moduleDescInput = document.getElementById('moduleDescription');
const contentEditorEl = document.getElementById('contentEditor');
const createViewTitle = document.getElementById('createViewTitle');
const btnCancelModule = document.getElementById('btnCancelModule');

// Teacher Results
const searchResults = document.getElementById('searchResults');
const btnDeleteAllResults = document.getElementById('btnDeleteAllResults');
const resultsStats = document.getElementById('resultsStats');
const resultsList = document.getElementById('resultsList');

// Student Topics
const studentTopicsList = document.getElementById('studentTopicsList');

// Student Quiz
const quizSubtitle = document.getElementById('quizSubtitle');
const quizTopicSelect = document.getElementById('quizTopicSelect');
const quizPlayerArea = document.getElementById('quizPlayerArea');
const quizProgressFill = document.getElementById('quizProgressFill');
const quizInfo = document.getElementById('quizInfo');
const quizModuleContainer = document.getElementById('quizModuleContainer');
const quizActions = document.getElementById('quizActions');
const btnQuizNext = document.getElementById('btnQuizNext');
const btnQuizCancel = document.getElementById('btnQuizCancel');
const quizResultArea = document.getElementById('quizResultArea');

// Player
const btnBackFromPlayer = document.getElementById('btnBackFromPlayer');
const playerTitle = document.getElementById('playerTitle');
const h5pContainer = document.getElementById('h5pContainer');

// Custom confirm dialog
const confirmOverlay = document.getElementById('confirmOverlay');
const confirmMessage = document.getElementById('confirmMessage');
const confirmBtnYes = document.getElementById('confirmBtnYes');
const confirmBtnNo = document.getElementById('confirmBtnNo');

// ==================== CUSTOM CONFIRM ====================

function appConfirm(message) {
  return new Promise((resolve) => {
    confirmMessage.textContent = message;
    confirmOverlay.classList.remove('hidden');
    confirmBtnYes.focus();

    function cleanup(result) {
      confirmBtnYes.removeEventListener('click', onYes);
      confirmBtnNo.removeEventListener('click', onNo);
      confirmOverlay.classList.add('hidden');
      resolve(result);
    }

    function onYes() { cleanup(true); }
    function onNo() { cleanup(false); }

    confirmBtnYes.addEventListener('click', onYes);
    confirmBtnNo.addEventListener('click', onNo);
  });
}

// ==================== LOGIN ====================

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = loginName.value.trim();
  if (!name) return;
  currentUser = { name, role: 'student' };
  enterApp();
});

btnShowAdminLogin.addEventListener('click', () => {
  adminLoginSection.classList.toggle('hidden');
  adminLoginError.classList.add('hidden');
});

adminLoginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = adminUsername.value.trim();
  const pass = adminPassword.value;
  if (!user || !pass) return;
  const valid = await window.api.verifyAdmin(user, pass);
  if (valid) {
    currentUser = { name: user, role: 'teacher' };
    adminLoginError.classList.add('hidden');
    enterApp();
  } else {
    adminLoginError.classList.remove('hidden');
  }
});

btnLogout.addEventListener('click', () => {
  currentUser = null;
  quizState = null;
  currentTopicId = null;

  // Blur any active element to break stale focus chains
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }

  // Reset all active views
  views.forEach((v) => v.classList.remove('active'));

  // Reset quiz UI state and clear all dynamic content
  quizPlayerArea.classList.add('hidden');
  quizResultArea.classList.add('hidden');
  quizTopicSelect.classList.remove('hidden');
  quizModuleContainer.innerHTML = '';
  h5pContainer.innerHTML = '';
  quizSubtitle.textContent = t('quiz.subtitle');

  // Hide app, show login via class toggle
  appContainer.classList.add('hidden');
  teacherNav.classList.add('hidden');
  studentNav.classList.add('hidden');
  loginScreen.classList.remove('hidden');

  // Clear form fields
  loginName.value = '';
  adminUsername.value = '';
  adminPassword.value = '';
  adminLoginSection.classList.add('hidden');
  adminLoginError.classList.add('hidden');

  loginName.focus();
});

async function enterApp() {
  loginScreen.classList.add('hidden');
  appContainer.classList.remove('hidden');

  // Show role-specific nav
  if (currentUser.role === 'teacher') {
    teacherNav.classList.remove('hidden');
    studentNav.classList.add('hidden');
    userInfo.innerHTML = `<span class="user-role-badge teacher">${t('role.teacher')}</span> ${escapeHtml(currentUser.name)}`;
  } else {
    teacherNav.classList.add('hidden');
    studentNav.classList.remove('hidden');
    userInfo.innerHTML = `<span class="user-role-badge student">${t('role.student')}</span> ${escapeHtml(currentUser.name)}`;
  }

  // Setup nav buttons for current role
  setupNavigation();
  await loadTopics();

  // Navigate to default view
  if (currentUser.role === 'teacher') {
    navigateToView('teacher-dashboard');
  } else {
    navigateToView('student-topics');
  }
}

// ==================== NAVIGATION ====================

function setupNavigation() {
  const navContainer = currentUser.role === 'teacher' ? teacherNav : studentNav;
  const navButtons = navContainer.querySelectorAll('.nav-btn');
  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      navigateToView(btn.dataset.view);
    });
  });
}

function navigateToView(viewName) {
  views.forEach((v) => v.classList.remove('active'));
  const navContainer = currentUser.role === 'teacher' ? teacherNav : studentNav;
  navContainer.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));

  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) targetView.classList.add('active');

  const targetBtn = navContainer.querySelector(`.nav-btn[data-view="${viewName}"]`);
  if (targetBtn) targetBtn.classList.add('active');

  // Refresh data for views
  if (viewName === 'teacher-dashboard') refreshTeacherDashboard();
  if (viewName === 'teacher-topics') refreshTopicsList();
  if (viewName === 'teacher-modules') refreshModulesList();
  if (viewName === 'teacher-results') refreshResults();
  if (viewName === 'student-topics') refreshStudentTopics();
  if (viewName === 'student-quiz') refreshQuizTopicSelect();
}

window.appNavigate = navigateToView;

// ==================== TOAST ====================

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(60px)';
    toast.style.transition = '0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ==================== DATA LOADING ====================

async function loadTopics() {
  topics = await window.api.getTopics();
}

// ==================== TEACHER: DASHBOARD ====================

async function refreshTeacherDashboard() {
  await loadTopics();
  statTopics.textContent = topics.length;
  const totalModules = topics.reduce((sum, t) => sum + (t.modules || []).length, 0);
  statModules.textContent = totalModules;
  statActive.textContent = topics.filter((t) => t.selected).length;
  const results = await window.api.getQuizResults();
  statResults.textContent = results.length;
  renderTypeGrid();
}

function renderTypeGrid() {
  typeGrid.innerHTML = '';
  const types = getH5pTypesArray();
  for (const t of types) {
    const card = document.createElement('div');
    card.className = 'type-card';
    card.innerHTML = `
      <div class="type-card-icon">${t.icon}</div>
      <div class="type-card-name">${t.name}</div>
      <div class="type-card-desc">${t.description}</div>
    `;
    typeGrid.appendChild(card);
  }
}

// ==================== TEACHER: TOPICS ====================

async function refreshTopicsList() {
  await loadTopics();
  topicsList.innerHTML = '';
  topicFormContainer.classList.add('hidden');

  if (topics.length === 0) {
    topicsList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📂</span>
        <p>Noch keine Lernthemen erstellt.</p>
      </div>`;
    return;
  }

  for (const topic of topics) {
    const moduleCount = (topic.modules || []).length;
    const card = document.createElement('div');
    card.className = `topic-card ${topic.selected ? 'topic-active' : 'topic-inactive'}`;
    card.innerHTML = `
      <div class="topic-card-header">
        <div class="topic-card-info">
          <h3 class="topic-card-title">${escapeHtml(topic.title)}</h3>
          <p class="topic-card-desc">${escapeHtml(topic.description || '')}</p>
          <div class="topic-card-meta">
            <span class="topic-module-count">${moduleCount} Module</span>
            <span class="topic-status ${topic.selected ? 'active' : 'inactive'}">${topic.selected ? '✅ Aktiv' : '❌ Inaktiv'}</span>
          </div>
        </div>
        <div class="topic-card-actions">
          <label class="toggle-switch" title="Für Schüler freigeben">
            <input type="checkbox" class="topic-toggle" data-topic-id="${topic.id}" ${topic.selected ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
          <button class="btn btn-primary btn-sm btn-open-topic" data-topic-id="${topic.id}" title="Module verwalten">📦 Module</button>
          <button class="btn btn-secondary btn-sm btn-edit-topic" data-topic-id="${topic.id}" title="Bearbeiten">✏️</button>
          <button class="btn btn-secondary btn-sm btn-export-topic" data-topic-id="${topic.id}" title="Exportieren">📤</button>
          <button class="btn btn-danger btn-sm btn-delete-topic" data-topic-id="${topic.id}" title="Löschen">🗑</button>
        </div>
      </div>
    `;

    // Toggle activation
    card.querySelector('.topic-toggle').addEventListener('change', async (e) => {
      await window.api.toggleTopicSelection(topic.id, e.target.checked);
      showToast(e.target.checked ? t('topics.activated') : t('topics.deactivated'), 'info');
      refreshTopicsList();
    });

    // Open modules
    card.querySelector('.btn-open-topic').addEventListener('click', () => {
      openTopicModules(topic.id);
    });

    // Edit topic
    card.querySelector('.btn-edit-topic').addEventListener('click', () => {
      openTopicEditor(topic);
    });

    // Export topic
    card.querySelector('.btn-export-topic').addEventListener('click', async () => {
      const result = await window.api.exportTopic(topic.id);
      if (result.success) showToast(t('topics.exported'), 'success');
    });

    // Delete topic
    card.querySelector('.btn-delete-topic').addEventListener('click', async () => {
      if (!(await appConfirm(t('topics.delete.confirm', { title: topic.title })))) return;
      await window.api.deleteTopic(topic.id);
      showToast(t('topics.deleted'), 'info');
      refreshTopicsList();
    });

    topicsList.appendChild(card);
  }
}

btnNewTopic.addEventListener('click', () => {
  editingTopicId = null;
  topicFormTitle.textContent = t('topics.form.new');
  topicTitleInput.value = '';
  topicDescInput.value = '';
  topicFormContainer.classList.remove('hidden');
});

btnImportTopic.addEventListener('click', async () => {
  const result = await window.api.importTopic();
  if (result.success) {
    showToast(t('topics.import.success', { title: result.topicTitle, count: result.importedCount }), 'success');
    refreshTopicsList();
  } else if (result.error) {
    showToast(t('topics.import.error') + result.error, 'error');
  }
});

btnCancelTopic.addEventListener('click', () => {
  topicFormContainer.classList.add('hidden');
  editingTopicId = null;
});

topicForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = topicTitleInput.value.trim();
  if (!title) return;

  const topicData = {
    id: editingTopicId || ('topic_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6)),
    title,
    description: topicDescInput.value.trim(),
    selected: editingTopicId ? (topics.find((t) => t.id === editingTopicId) || {}).selected || false : false,
    createdAt: editingTopicId ? (topics.find((t) => t.id === editingTopicId) || {}).createdAt || new Date().toISOString() : new Date().toISOString(),
  };

  await window.api.saveTopic(topicData);
  showToast(editingTopicId ? t('topics.updated') : t('topics.created'), 'success');
  topicFormContainer.classList.add('hidden');
  editingTopicId = null;
  refreshTopicsList();
});

function openTopicEditor(topic) {
  editingTopicId = topic.id;
  topicFormTitle.textContent = t('topics.form.edit');
  topicTitleInput.value = topic.title;
  topicDescInput.value = topic.description || '';
  topicFormContainer.classList.remove('hidden');
}

// ==================== TEACHER: MODULES ====================

function openTopicModules(topicId) {
  currentTopicId = topicId;
  const topic = topics.find((t) => t.id === topicId);
  if (!topic) return;
  currentTopicName.textContent = topic.title;
  modulesViewTitle.textContent = t('modules.in', { title: topic.title });
  navigateToView('teacher-modules');
}

backToTopics.addEventListener('click', () => {
  currentTopicId = null;
  navigateToView('teacher-topics');
});

async function refreshModulesList() {
  if (!currentTopicId) {
    modulesList.innerHTML = '<div class="empty-state"><span class="empty-icon">📂</span><p>Bitte wählen Sie zuerst ein Lernthema.</p></div>';
    return;
  }

  currentTopicModules = await window.api.getTopicModules(currentTopicId);

  const search = searchModules.value.toLowerCase().trim();
  const typeFilter = filterType.value;

  let filtered = currentTopicModules;
  if (search) {
    filtered = filtered.filter(
      (m) =>
        m.title.toLowerCase().includes(search) ||
        (m.description && m.description.toLowerCase().includes(search))
    );
  }
  if (typeFilter) {
    filtered = filtered.filter((m) => m.type === typeFilter);
  }

  modulesList.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = currentTopicModules.length === 0
      ? `<span class="empty-icon">📭</span><p>Noch keine Module in diesem Thema.</p>`
      : `<span class="empty-icon">🔍</span><p>Keine Module gefunden.</p>`;
    modulesList.appendChild(empty);
    return;
  }

  for (const mod of filtered) {
    const typeDef = H5P_TYPES[mod.type] || {};
    const card = document.createElement('div');
    card.className = 'module-card';
    card.innerHTML = `
      <div class="module-card-icon">${typeDef.icon || '📦'}</div>
      <div class="module-card-info">
        <div class="module-card-title">${escapeHtml(mod.title)}</div>
        <div class="module-card-meta">
          <span class="module-card-type">${typeDef.name || mod.type}</span>
          ${mod.createdAt ? new Date(mod.createdAt).toLocaleDateString('de-DE') : ''}
        </div>
      </div>
      <div class="module-card-actions">
        <button class="btn btn-secondary btn-sm btn-preview" title="Vorschau">▶ Vorschau</button>
        <button class="btn btn-secondary btn-sm btn-edit" title="Bearbeiten">✏️ Bearbeiten</button>
        <button class="btn btn-danger btn-sm btn-delete" title="Löschen">🗑</button>
      </div>
    `;

    card.querySelector('.btn-preview').addEventListener('click', () => openPlayer(mod));
    card.querySelector('.btn-edit').addEventListener('click', () => openModuleEditor(mod));
    card.querySelector('.btn-delete').addEventListener('click', () => deleteModule(mod));
    modulesList.appendChild(card);
  }
}

searchModules.addEventListener('input', refreshModulesList);
filterType.addEventListener('change', refreshModulesList);

btnCreateModule.addEventListener('click', () => {
  resetModuleForm();
  navigateToView('create-module');
});

btnExportCurrentTopic.addEventListener('click', async () => {
  if (!currentTopicId) return;
  const result = await window.api.exportTopic(currentTopicId);
  if (result.success) showToast(t('topics.exported'), 'success');
});

// ==================== MODULE FORM ====================

function populateTypeSelects() {
  const types = getH5pTypesArray();

  moduleTypeSelect.innerHTML = '<option value="">— Modultyp wählen —</option>';
  for (const t of types) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.icon} ${t.name}`;
    moduleTypeSelect.appendChild(opt);
  }

  filterType.innerHTML = '<option value="">Alle Typen</option>';
  for (const t of types) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.icon} ${t.name}`;
    filterType.appendChild(opt);
  }
}

moduleTypeSelect.addEventListener('change', () => {
  const typeId = moduleTypeSelect.value;
  if (typeId && H5P_TYPES[typeId]) {
    const existingData = editingModuleId
      ? (currentTopicModules.find((m) => m.id === editingModuleId) || {}).content || {}
      : {};
    contentEditor.render(typeId, existingData);
  } else {
    contentEditor.clear();
  }
});

moduleForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentTopicId) {
    showToast(t('module.missing.topic'), 'error');
    return;
  }

  const title = moduleTitleInput.value.trim();
  const type = moduleTypeSelect.value;
  const description = moduleDescInput.value.trim();

  if (!title || !type) {
    showToast(t('module.missing.fields'), 'error');
    return;
  }

  const content = contentEditor.collectData();

  const moduleData = {
    id: editingModuleId || generateId(),
    title,
    type,
    description,
    content,
    createdAt: editingModuleId
      ? (currentTopicModules.find((m) => m.id === editingModuleId) || {}).createdAt || new Date().toISOString()
      : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const result = await window.api.saveModule(currentTopicId, moduleData);
  if (result.success) {
    showToast(editingModuleId ? t('module.updated') : t('module.saved'), 'success');
    currentTopicModules = await window.api.getTopicModules(currentTopicId);
    resetModuleForm();
    navigateToView('teacher-modules');
  } else {
    showToast(t('module.save.error'), 'error');
  }
});

btnCancelModule.addEventListener('click', () => {
  resetModuleForm();
  navigateToView('teacher-modules');
});

function resetModuleForm() {
  editingModuleId = null;
  moduleIdInput.value = '';
  moduleTitleInput.value = '';
  moduleTypeSelect.value = '';
  moduleDescInput.value = '';
  contentEditor.clear();
  createViewTitle.textContent = t('module.create.title');
}

function openModuleEditor(mod) {
  editingModuleId = mod.id;
  createViewTitle.textContent = t('module.edit.title');
  moduleIdInput.value = mod.id;
  moduleTitleInput.value = mod.title;
  moduleTypeSelect.value = mod.type;
  moduleDescInput.value = mod.description || '';
  navigateToView('create-module');
  contentEditor.render(mod.type, mod.content || {});
}

async function deleteModule(mod) {
  if (!(await appConfirm(t('modules.delete.confirm', { title: mod.title })))) return;
  const result = await window.api.deleteModule(currentTopicId, mod.id);
  if (result.success) {
    showToast(t('modules.deleted'), 'info');
    currentTopicModules = await window.api.getTopicModules(currentTopicId);
    refreshModulesList();
  }
}

// ==================== H5P PLAYER (Preview) ====================

function openPlayer(mod) {
  const typeDef = H5P_TYPES[mod.type] || {};
  playerTitle.textContent = mod.title;
  navigateToView('player');
  h5pContainer.innerHTML = '';
  renderH5pPreview(mod, typeDef, h5pContainer);
}

btnBackFromPlayer.addEventListener('click', () => {
  h5pContainer.innerHTML = '';
  if (currentUser.role === 'teacher') {
    navigateToView('teacher-modules');
  } else {
    navigateToView('student-quiz');
  }
});

// ==================== TEACHER: RESULTS ====================

async function refreshResults() {
  const results = await window.api.getQuizResults();
  const search = searchResults.value.toLowerCase().trim();

  let filtered = results;
  if (search) {
    filtered = filtered.filter((r) => r.username.toLowerCase().includes(search));
  }

  // Stats
  const uniqueStudents = new Set(results.map((r) => r.username)).size;
  const avgScore = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + (r.percentage || 0), 0) / results.length)
    : 0;

  resultsStats.innerHTML = `
    <div class="stats-grid" style="margin-bottom:20px;">
      <div class="stat-card">
        <div class="stat-number">${results.length}</div>
        <div class="stat-label">Quiz-Durchläufe</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${uniqueStudents}</div>
        <div class="stat-label">Verschiedene Schüler</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${avgScore}%</div>
        <div class="stat-label">Ø Erfolgsquote</div>
      </div>
    </div>
  `;

  resultsList.innerHTML = '';
  if (filtered.length === 0) {
    resultsList.innerHTML = '<div class="empty-state"><span class="empty-icon">📊</span><p>Noch keine Ergebnisse vorhanden.</p></div>';
    return;
  }

  for (const r of filtered) {
    const card = document.createElement('div');
    card.className = 'result-card';
    const pctClass = r.percentage >= 70 ? 'good' : r.percentage >= 40 ? 'medium' : 'poor';
    card.innerHTML = `
      <div class="result-card-header">
        <div class="result-card-info">
          <strong>${escapeHtml(r.username)}</strong>
          <span class="result-topic-name">${escapeHtml(r.topicTitle || '—')}</span>
          <span class="result-date">${new Date(r.timestamp).toLocaleString('de-DE')}</span>
        </div>
        <div class="result-score ${pctClass}">
          ${r.score}/${r.totalQuestions} (${r.percentage}%)
        </div>
        <button class="btn btn-danger btn-sm btn-delete-result" data-result-id="${r.id}">🗑</button>
      </div>
      ${r.details && r.details.length > 0 ? `
        <details class="result-details">
          <summary>Details anzeigen</summary>
          <div class="result-detail-list">
            ${r.details.map((d) => `
              <div class="result-detail-item ${d.isCorrect ? 'correct' : 'wrong'}">
                <span class="result-detail-icon">${d.isCorrect ? '✅' : '❌'}</span>
                <div>
                  <strong>${escapeHtml(d.moduleName || d.moduleTitle || '')}</strong>
                  ${d.userAnswer !== undefined ? `<br>Antwort: ${escapeHtml(String(d.userAnswer))}` : ''}
                  ${d.correctAnswer !== undefined ? `<br>Korrekt: ${escapeHtml(String(d.correctAnswer))}` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </details>` : ''}
    `;

    card.querySelector('.btn-delete-result').addEventListener('click', async () => {
      await window.api.deleteQuizResult(r.id);
      showToast(t('results.deleted'), 'info');
      refreshResults();
    });

    resultsList.appendChild(card);
  }
}

searchResults.addEventListener('input', refreshResults);

btnDeleteAllResults.addEventListener('click', async () => {
  if (!(await appConfirm(t('results.delete.all.confirm')))) return;
  await window.api.deleteAllQuizResults();
  showToast(t('results.all.deleted'), 'info');
  refreshResults();
});

// ==================== STUDENT: TOPIC SELECTION ====================

async function refreshStudentTopics() {
  const availableTopics = await window.api.getSelectedTopics();
  const mySelections = await window.api.getStudentSelections(currentUser.name);

  studentTopicsList.innerHTML = '';

  if (availableTopics.length === 0) {
    studentTopicsList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📂</span>
        <p>Noch keine Lernthemen vom Lehrer freigegeben.</p>
      </div>`;
    return;
  }

  for (const topic of availableTopics) {
    const isSelected = mySelections.includes(topic.id);
    const moduleCount = (topic.modules || []).length;
    const card = document.createElement('div');
    card.className = `topic-card student-topic-card ${isSelected ? 'topic-selected' : ''}`;
    card.innerHTML = `
      <div class="topic-card-header">
        <div class="topic-card-info">
          <h3 class="topic-card-title">${escapeHtml(topic.title)}</h3>
          <p class="topic-card-desc">${escapeHtml(topic.description || '')}</p>
          <div class="topic-card-meta">
            <span class="topic-module-count">${moduleCount} Module</span>
          </div>
        </div>
        <div class="topic-card-actions">
          <label class="toggle-switch" title="Thema auswählen">
            <input type="checkbox" class="student-topic-toggle" data-topic-id="${topic.id}" ${isSelected ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    `;

    card.querySelector('.student-topic-toggle').addEventListener('change', async (e) => {
      let selections = await window.api.getStudentSelections(currentUser.name);
      if (e.target.checked) {
        if (!selections.includes(topic.id)) selections.push(topic.id);
      } else {
        selections = selections.filter((id) => id !== topic.id);
      }
      await window.api.saveStudentSelections(currentUser.name, selections);
      showToast(e.target.checked ? t('student.topics.selected') : t('student.topics.deselected'), 'info');
      refreshStudentTopics();
    });

    studentTopicsList.appendChild(card);
  }
}

// ==================== STUDENT: QUIZ MODE ====================

async function refreshQuizTopicSelect() {
  const mySelections = await window.api.getStudentSelections(currentUser.name);
  const availableTopics = await window.api.getSelectedTopics();
  const myTopics = availableTopics.filter((t) => mySelections.includes(t.id));

  quizTopicSelect.innerHTML = '';
  quizTopicSelect.classList.remove('hidden');
  quizPlayerArea.classList.add('hidden');
  quizResultArea.classList.add('hidden');

  if (myTopics.length === 0) {
    quizTopicSelect.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🧠</span>
        <p>Du hast noch keine Themen ausgewählt. Gehe zu "Lernthemen" und wähle Themen aus.</p>
      </div>`;
    return;
  }

  for (const topic of myTopics) {
    const moduleCount = (topic.modules || []).length;
    if (moduleCount === 0) continue;

    const card = document.createElement('div');
    card.className = 'quiz-topic-card';
    card.innerHTML = `
      <div class="quiz-topic-card-info">
        <h3>${escapeHtml(topic.title)}</h3>
        <p>${moduleCount} Module</p>
      </div>
      <button class="btn btn-primary">🧠 Quiz starten</button>
    `;

    card.querySelector('.btn').addEventListener('click', () => {
      startQuiz(topic);
    });

    quizTopicSelect.appendChild(card);
  }
}

async function startQuiz(topic) {
  const modules = topic.modules || [];
  if (modules.length === 0) {
    showToast(t('quiz.no.modules'), 'error');
    return;
  }

  quizState = {
    topicId: topic.id,
    topicTitle: topic.title,
    modules: modules,
    currentIndex: 0,
    answers: [],
    startTime: Date.now(),
  };

  quizTopicSelect.classList.add('hidden');
  quizPlayerArea.classList.remove('hidden');
  quizResultArea.classList.add('hidden');
  quizSubtitle.textContent = `${t('quiz.title')}: ${topic.title}`;

  renderQuizModule();
}

function renderQuizModule() {
  if (!quizState) return;

  const { modules, currentIndex } = quizState;
  const mod = modules[currentIndex];
  const typeDef = H5P_TYPES[mod.type] || {};

  // Progress
  const progress = ((currentIndex) / modules.length) * 100;
  quizProgressFill.style.width = `${progress}%`;
  quizInfo.innerHTML = `<strong>${t('quiz.module.of', { current: currentIndex + 1, total: modules.length })}</strong> ${escapeHtml(mod.title)} <span class="quiz-type-badge">${typeDef.icon || ''} ${typeDef.name || mod.type}</span>`;

  // Render module in quiz container
  quizModuleContainer.innerHTML = '';
  renderH5pPreview(mod, typeDef, quizModuleContainer);

  // Button text
  btnQuizNext.textContent = currentIndex < modules.length - 1 ? t('quiz.next') : t('quiz.finish');
}

btnQuizNext.addEventListener('click', () => {
  if (!quizState) return;

  // Collect answer for current module
  const mod = quizState.modules[quizState.currentIndex];
  const answer = collectQuizAnswer(mod);
  quizState.answers.push(answer);

  quizState.currentIndex++;

  if (quizState.currentIndex >= quizState.modules.length) {
    finishQuiz();
  } else {
    renderQuizModule();
  }
});

btnQuizCancel.addEventListener('click', async () => {
  if (!(await appConfirm(t('quiz.cancel.confirm')))) return;
  quizState = null;
  quizPlayerArea.classList.add('hidden');
  quizModuleContainer.innerHTML = '';
  quizTopicSelect.classList.remove('hidden');
  quizSubtitle.textContent = t('quiz.subtitle');
});

function collectQuizAnswer(mod) {
  const content = mod.content || {};
  const result = {
    moduleId: mod.id,
    moduleTitle: mod.title,
    moduleType: mod.type,
    isCorrect: false,
    userAnswer: '',
    correctAnswer: '',
  };

  switch (mod.type) {
    case 'multipleChoice': {
      const inputs = quizModuleContainer.querySelectorAll('input[name="mc-answer"]');
      const selected = [];
      const correctList = [];
      inputs.forEach((inp, i) => {
        if (inp.checked) selected.push(i);
        if (inp.dataset.correct === 'true') correctList.push(i);
      });
      result.userAnswer = selected.map((i) => (content.answers || [])[i]?.text || i).join(', ');
      result.correctAnswer = correctList.map((i) => (content.answers || [])[i]?.text || i).join(', ');
      result.isCorrect = selected.length === correctList.length && selected.every((s) => correctList.includes(s));
      break;
    }
    case 'trueFalse': {
      const feedback = quizModuleContainer.querySelector('#tfFeedback');
      if (feedback && feedback.innerHTML.includes('✓')) {
        result.isCorrect = true;
        result.userAnswer = content.correctAnswer === 'true' ? 'Wahr' : 'Falsch';
      } else {
        result.userAnswer = content.correctAnswer === 'true' ? 'Falsch' : 'Wahr';
      }
      result.correctAnswer = content.correctAnswer === 'true' ? 'Wahr' : 'Falsch';
      break;
    }
    case 'fillInTheBlanks': {
      const inputs = quizModuleContainer.querySelectorAll('input[data-answer]');
      let correct = 0;
      const answers = [];
      inputs.forEach((inp) => {
        const expected = inp.dataset.answer;
        const given = inp.value.trim();
        const caseSensitive = content.caseSensitive;
        const match = caseSensitive ? given === expected : given.toLowerCase() === expected.toLowerCase();
        if (match) correct++;
        answers.push(given);
      });
      result.userAnswer = answers.join(', ');
      result.correctAnswer = Array.from(inputs).map((i) => i.dataset.answer).join(', ');
      result.isCorrect = correct === inputs.length && inputs.length > 0;
      break;
    }
    case 'arithmeticQuiz': {
      const resultEl = quizModuleContainer.querySelector('.quiz-area h3');
      if (resultEl) {
        const match = resultEl.textContent.match(/(\d+)\s*\/\s*(\d+)/);
        if (match) {
          result.userAnswer = `${match[1]}/${match[2]}`;
          result.correctAnswer = `${match[2]}/${match[2]}`;
          result.isCorrect = match[1] === match[2];
        }
      }
      break;
    }
    case 'markTheWords':
    case 'dragTheWords': {
      const spans = quizModuleContainer.querySelectorAll('#wordsArea span');
      let correct = 0;
      let total = 0;
      spans.forEach((s) => {
        if (s.dataset.correct === 'true') total++;
        if (s.classList.contains('selected') && s.dataset.correct === 'true') correct++;
      });
      result.userAnswer = `${correct}/${total} markiert`;
      result.correctAnswer = `${total}/${total}`;
      result.isCorrect = correct === total && total > 0;
      break;
    }
    case 'dictation': {
      const inputs = quizModuleContainer.querySelectorAll('.dict-input');
      let correct = 0;
      inputs.forEach((inp) => {
        if (inp.value.trim().toLowerCase() === inp.dataset.answer.toLowerCase()) correct++;
      });
      result.userAnswer = `${correct}/${inputs.length}`;
      result.correctAnswer = `${inputs.length}/${inputs.length}`;
      result.isCorrect = correct === inputs.length && inputs.length > 0;
      break;
    }
    default: {
      // Non-gradeable types: consider them "viewed"
      result.isCorrect = true;
      result.userAnswer = 'Angesehen';
      result.correctAnswer = '—';
      break;
    }
  }

  return result;
}

async function finishQuiz() {
  const score = quizState.answers.filter((a) => a.isCorrect).length;
  const total = quizState.answers.length;
  const percentage = total > 0 ? Math.round((score / total) * 100) : 0;

  const resultData = {
    username: currentUser.name,
    topicId: quizState.topicId,
    topicTitle: quizState.topicTitle,
    score,
    totalQuestions: total,
    percentage,
    details: quizState.answers,
  };

  await window.api.saveQuizResult(resultData);

  // Show result screen
  quizPlayerArea.classList.add('hidden');
  quizResultArea.classList.remove('hidden');

  const pctClass = percentage >= 70 ? 'good' : percentage >= 40 ? 'medium' : 'poor';
  quizResultArea.innerHTML = `
    <div class="quiz-final-result">
      <div class="quiz-result-icon">${percentage >= 70 ? '🎉' : percentage >= 40 ? '👍' : '💪'}</div>
      <h2>${t('quiz.complete')}</h2>
      <div class="quiz-result-score ${pctClass}">
        <span class="quiz-result-number">${score} / ${total}</span>
        <span class="quiz-result-pct">${percentage}%</span>
      </div>
      <p>${t('quiz.topic')}: <strong>${escapeHtml(quizState.topicTitle)}</strong></p>
      <div class="quiz-result-details">
        ${quizState.answers.map((a, i) => `
          <div class="result-detail-item ${a.isCorrect ? 'correct' : 'wrong'}">
            <span class="result-detail-icon">${a.isCorrect ? '✅' : '❌'}</span>
            <div>
              <strong>${i + 1}. ${escapeHtml(a.moduleTitle)}</strong>
              ${a.userAnswer ? `<br>${t('common.your.answer')}: ${escapeHtml(String(a.userAnswer))}` : ''}
              ${!a.isCorrect && a.correctAnswer ? `<br>${t('results.correct')}: ${escapeHtml(String(a.correctAnswer))}` : ''}
            </div>
          </div>
        `).join('')}
      </div>
      <div class="form-actions" style="justify-content:center; margin-top:24px;">
        <button class="btn btn-primary" id="btnQuizRestart">${t('quiz.restart')}</button>
      </div>
    </div>
  `;

  quizResultArea.querySelector('#btnQuizRestart').addEventListener('click', () => {
    quizState = null;
    quizResultArea.classList.add('hidden');
    quizTopicSelect.classList.remove('hidden');
    quizSubtitle.textContent = t('quiz.subtitle');
    refreshQuizTopicSelect();
  });

  quizState = null;
}

// ==================== H5P PREVIEW RENDER ====================

function renderH5pPreview(mod, typeDef, container) {
  const content = mod.content || {};
  const wrapper = document.createElement('div');
  wrapper.style.maxWidth = '800px';
  wrapper.style.margin = '0 auto';

  const header = document.createElement('div');
  header.innerHTML = `
    <div style="text-align:center; margin-bottom: 24px;">
      <span style="font-size: 3rem;">${typeDef.icon || '📦'}</span>
      <h3 style="margin-top: 8px;">${escapeHtml(mod.title)}</h3>
      <p style="color: var(--text-secondary); font-size: 0.9rem;">${typeDef.name} — ${typeDef.category || ''}</p>
    </div>
  `;
  wrapper.appendChild(header);

  if (mod.description) {
    const desc = document.createElement('p');
    desc.style.marginBottom = '20px';
    desc.style.color = 'var(--text-secondary)';
    desc.textContent = mod.description;
    wrapper.appendChild(desc);
  }

  const previewEl = createTypePreview(mod.type, content);
  wrapper.appendChild(previewEl);

  container.appendChild(wrapper);
}

function createTypePreview(type, content) {
  const div = document.createElement('div');

  switch (type) {
    case 'accordion': {
      const panels = content.panels || [];
      for (const panel of panels) {
        const details = document.createElement('details');
        details.style.cssText = 'margin-bottom:8px; border:1px solid var(--border); border-radius:var(--radius-sm); overflow:hidden;';
        const summary = document.createElement('summary');
        summary.style.cssText = 'padding:12px 16px; cursor:pointer; font-weight:600; background:var(--bg-primary);';
        summary.textContent = panel.title || '';
        const body = document.createElement('div');
        body.style.cssText = 'padding:12px 16px;';
        body.textContent = panel.content || '';
        details.appendChild(summary);
        details.appendChild(body);
        div.appendChild(details);
      }
      break;
    }
    case 'arithmeticQuiz': {
      div.innerHTML = `
        <div style="text-align:center; padding: 30px; background: var(--accent-light); border-radius: var(--radius-md);">
          <p><strong>Rechenart:</strong> ${content.arithmeticType || 'Addition'}</p>
          <p><strong>Max. Zahl:</strong> ${content.maxNumber || 10}</p>
          <p><strong>Fragen:</strong> ${content.numQuestions || 10}</p>
          ${content.timeLimit ? `<p><strong>Zeitlimit:</strong> ${content.timeLimit}s</p>` : ''}
          <button class="btn btn-primary" style="margin-top:16px;" onclick="this.parentElement.querySelector('.quiz-area').style.display='block'; this.style.display='none';">Quiz starten</button>
          <div class="quiz-area" style="display:none; margin-top:20px;"></div>
        </div>
      `;
      startArithmeticQuiz(div.querySelector('.quiz-area'), content);
      break;
    }
    case 'multipleChoice': {
      const q = content.question || 'Keine Frage definiert';
      const answers = content.answers || [];
      div.innerHTML = `<div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
        <p style="font-weight:600; margin-bottom:16px;">${escapeHtml(q)}</p>
        <div class="mc-answers"></div>
        <button class="btn btn-primary btn-sm" style="margin-top:16px;" id="mcCheck">Überprüfen</button>
        <div id="mcFeedback" style="margin-top:12px;"></div>
      </div>`;
      const answersEl = div.querySelector('.mc-answers');
      const isSingle = content.singleAnswer;
      answers.forEach((a, i) => {
        const row = document.createElement('div');
        row.style.cssText = 'margin-bottom:8px; display:flex; align-items:center; gap:8px;';
        const input = document.createElement('input');
        input.type = isSingle ? 'radio' : 'checkbox';
        input.name = 'mc-answer';
        input.value = i;
        input.dataset.correct = a.correct ? 'true' : 'false';
        const label = document.createElement('label');
        label.textContent = a.text;
        row.appendChild(input);
        row.appendChild(label);
        answersEl.appendChild(row);
      });
      div.querySelector('#mcCheck').addEventListener('click', () => {
        const inputs = answersEl.querySelectorAll('input');
        let allCorrect = true;
        inputs.forEach((inp) => {
          const isCorrect = inp.dataset.correct === 'true';
          if (inp.checked !== isCorrect) allCorrect = false;
          inp.parentElement.style.color = inp.checked
            ? (isCorrect ? 'green' : 'red')
            : (isCorrect ? 'orange' : '');
        });
        div.querySelector('#mcFeedback').innerHTML = allCorrect
          ? '<span style="color:green; font-weight:600;">✓ Richtig!</span>'
          : '<span style="color:red; font-weight:600;">✗ Nicht ganz richtig. Versuchen Sie es nochmal.</span>';
      });
      break;
    }
    case 'trueFalse': {
      div.innerHTML = `<div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
        <p style="font-weight:600; margin-bottom:16px;">${escapeHtml(content.question || '')}</p>
        <div style="display:flex; gap:12px;">
          <button class="btn btn-secondary tf-btn" data-val="true">Wahr</button>
          <button class="btn btn-secondary tf-btn" data-val="false">Falsch</button>
        </div>
        <div id="tfFeedback" style="margin-top:12px;"></div>
      </div>`;
      div.querySelectorAll('.tf-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const correct = content.correctAnswer === btn.dataset.val;
          div.querySelector('#tfFeedback').innerHTML = correct
            ? `<span style="color:green; font-weight:600;">✓ ${escapeHtml(content.feedbackCorrect || 'Richtig!')}</span>`
            : `<span style="color:red; font-weight:600;">✗ ${escapeHtml(content.feedbackWrong || 'Leider falsch.')}</span>`;
        });
      });
      break;
    }
    case 'dialogCards':
    case 'flashcards': {
      const cards = content.cards || [];
      if (cards.length === 0) { div.textContent = 'Keine Karten definiert.'; break; }
      let idx = 0;
      let flipped = false;
      const frontKey = type === 'dialogCards' ? 'front' : 'question';
      const backKey = type === 'dialogCards' ? 'back' : 'answer';
      div.innerHTML = `
        <div style="text-align:center;">
          <div id="cardDisplay" style="padding:40px; min-height:150px; background:var(--accent-light); border-radius:var(--radius-md); cursor:pointer; font-size:1.2rem; display:flex; align-items:center; justify-content:center;">
            ${escapeHtml(cards[0][frontKey] || '')}
          </div>
          <p style="margin-top:8px; color:var(--text-secondary); font-size:0.85rem;">Klicken zum Umdrehen</p>
          <div style="margin-top:16px; display:flex; justify-content:center; gap:12px;">
            <button class="btn btn-secondary btn-sm" id="cardPrev">← Zurück</button>
            <span id="cardCounter" style="line-height:36px;">1 / ${cards.length}</span>
            <button class="btn btn-secondary btn-sm" id="cardNext">Weiter →</button>
          </div>
        </div>
      `;
      const cardDisplay = div.querySelector('#cardDisplay');
      const cardCounter = div.querySelector('#cardCounter');
      const updateCard = () => { flipped = false; cardDisplay.textContent = cards[idx][frontKey] || ''; cardDisplay.style.background = 'var(--accent-light)'; cardCounter.textContent = `${idx + 1} / ${cards.length}`; };
      cardDisplay.addEventListener('click', () => { flipped = !flipped; cardDisplay.textContent = flipped ? (cards[idx][backKey] || '') : (cards[idx][frontKey] || ''); cardDisplay.style.background = flipped ? '#dcfce7' : 'var(--accent-light)'; });
      div.querySelector('#cardPrev').addEventListener('click', () => { if (idx > 0) { idx--; updateCard(); } });
      div.querySelector('#cardNext').addEventListener('click', () => { if (idx < cards.length - 1) { idx++; updateCard(); } });
      break;
    }
    case 'fillInTheBlanks': {
      const questions = content.questions || [];
      div.innerHTML = `<div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
        ${content.taskDescription ? `<p style="margin-bottom:16px;">${escapeHtml(content.taskDescription)}</p>` : ''}
        <div id="blanksArea"></div>
        <button class="btn btn-primary btn-sm" style="margin-top:16px;" id="blanksCheck">Überprüfen</button>
        <div id="blanksFeedback" style="margin-top:12px;"></div>
      </div>`;
      const blanksArea = div.querySelector('#blanksArea');
      const answerMap = [];
      questions.forEach((q) => {
        const p = document.createElement('p');
        p.style.marginBottom = '12px';
        const parts = (q.text || '').split(/\*([^*]+)\*/g);
        parts.forEach((part, pi) => {
          if (pi % 2 === 0) {
            p.appendChild(document.createTextNode(part));
          } else {
            const input = document.createElement('input');
            input.type = 'text';
            input.style.cssText = 'width:120px; padding:4px 8px; border:1px solid var(--border); border-radius:4px; margin:0 4px;';
            input.dataset.answer = part;
            p.appendChild(input);
            answerMap.push({ answer: part, inputEl: input });
          }
        });
        blanksArea.appendChild(p);
      });
      div.querySelector('#blanksCheck').addEventListener('click', () => {
        let correct = 0;
        const caseSensitive = content.caseSensitive;
        answerMap.forEach(({ answer, inputEl }) => {
          const userVal = inputEl.value.trim();
          const match = caseSensitive ? userVal === answer : userVal.toLowerCase() === answer.toLowerCase();
          inputEl.style.borderColor = match ? 'green' : 'red';
          if (match) correct++;
        });
        div.querySelector('#blanksFeedback').innerHTML = `<span style="font-weight:600;">${correct} von ${answerMap.length} richtig</span>`;
      });
      break;
    }
    case 'dragTheWords':
    case 'markTheWords': {
      div.innerHTML = `<div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
        ${content.taskDescription ? `<p style="margin-bottom:16px;">${escapeHtml(content.taskDescription)}</p>` : ''}
        <div id="wordsArea" style="line-height:2.2;"></div>
        <button class="btn btn-primary btn-sm" style="margin-top:16px;" id="wordsCheck">Überprüfen</button>
        <div id="wordsFeedback" style="margin-top:12px;"></div>
      </div>`;
      const text = content.textField || '';
      const wordsArea = div.querySelector('#wordsArea');
      const parts = text.split(/\*([^*]+)\*/g);
      const correctWords = [];
      parts.forEach((part, pi) => {
        if (pi % 2 === 0) {
          part.split(/\s+/).filter(Boolean).forEach((word) => {
            const span = document.createElement('span');
            span.style.cssText = 'display:inline-block; padding:4px 8px; margin:2px; border-radius:4px; cursor:pointer; border: 1px solid transparent;';
            span.textContent = word;
            span.dataset.correct = 'false';
            span.addEventListener('click', () => {
              span.classList.toggle('selected');
              span.style.background = span.classList.contains('selected') ? 'var(--accent-light)' : '';
              span.style.borderColor = span.classList.contains('selected') ? 'var(--accent)' : 'transparent';
            });
            wordsArea.appendChild(span);
          });
        } else {
          const span = document.createElement('span');
          span.style.cssText = 'display:inline-block; padding:4px 8px; margin:2px; border-radius:4px; cursor:pointer; border: 1px solid transparent;';
          span.textContent = part;
          span.dataset.correct = 'true';
          correctWords.push(span);
          span.addEventListener('click', () => {
            span.classList.toggle('selected');
            span.style.background = span.classList.contains('selected') ? 'var(--accent-light)' : '';
            span.style.borderColor = span.classList.contains('selected') ? 'var(--accent)' : 'transparent';
          });
          wordsArea.appendChild(span);
        }
      });
      div.querySelector('#wordsCheck').addEventListener('click', () => {
        const allSpans = wordsArea.querySelectorAll('span');
        let correct = 0;
        let total = correctWords.length;
        allSpans.forEach((s) => {
          const isCorrect = s.dataset.correct === 'true';
          const isSelected = s.classList.contains('selected');
          if (isSelected && isCorrect) { s.style.background = '#dcfce7'; correct++; }
          else if (isSelected && !isCorrect) { s.style.background = '#fef2f2'; }
          else if (!isSelected && isCorrect) { s.style.background = '#fef9c3'; }
          s.style.borderColor = 'transparent';
        });
        div.querySelector('#wordsFeedback').innerHTML = `<span style="font-weight:600;">${correct} von ${total} korrekte Wörter markiert</span>`;
      });
      break;
    }
    case 'coursePresentation': {
      const slides = content.slides || [];
      if (slides.length === 0) { div.textContent = 'Keine Folien definiert.'; break; }
      let sIdx = 0;
      div.innerHTML = `
        <div style="background: var(--bg-primary); border-radius: var(--radius-md); padding:24px; min-height:300px;">
          <div id="slideContent" style="min-height:200px;"></div>
          <div style="margin-top:20px; display:flex; justify-content:center; gap:12px; align-items:center;">
            <button class="btn btn-secondary btn-sm" id="slidePrev">← Zurück</button>
            <span id="slideCounter">1 / ${slides.length}</span>
            <button class="btn btn-secondary btn-sm" id="slideNext">Weiter →</button>
          </div>
        </div>
      `;
      const slideContent = div.querySelector('#slideContent');
      const slideCounter = div.querySelector('#slideCounter');
      const updateSlide = () => {
        const slide = slides[sIdx];
        slideContent.innerHTML = `<h3 style="margin-bottom:12px;">${escapeHtml(slide.slideTitle || '')}</h3><div>${slide.slideContent || ''}</div>`;
        slideCounter.textContent = `${sIdx + 1} / ${slides.length}`;
      };
      updateSlide();
      div.querySelector('#slidePrev').addEventListener('click', () => { if (sIdx > 0) { sIdx--; updateSlide(); } });
      div.querySelector('#slideNext').addEventListener('click', () => { if (sIdx < slides.length - 1) { sIdx++; updateSlide(); } });
      break;
    }
    case 'dictation': {
      const sentences = content.sentences || [];
      div.innerHTML = `<div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
        <p style="margin-bottom:16px; font-weight:600;">Diktat — Schreiben Sie die gehörten Sätze:</p>
        <div id="dictArea"></div>
        <button class="btn btn-primary btn-sm" style="margin-top:16px;" id="dictCheck">Überprüfen</button>
        <div id="dictFeedback" style="margin-top:12px;"></div>
      </div>`;
      const dictArea = div.querySelector('#dictArea');
      sentences.forEach((s, i) => {
        const row = document.createElement('div');
        row.style.marginBottom = '12px';
        row.innerHTML = `
          <label style="font-size:0.85rem; color:var(--text-secondary);">Satz ${i + 1}:</label>
          <input type="text" class="dict-input" data-answer="${escapeAttr(s.text || '')}" style="width:100%; padding:8px 12px; border:1px solid var(--border); border-radius:4px; margin-top:4px;">
        `;
        dictArea.appendChild(row);
      });
      div.querySelector('#dictCheck').addEventListener('click', () => {
        const inputs = dictArea.querySelectorAll('.dict-input');
        let correct = 0;
        inputs.forEach((inp) => {
          const match = inp.value.trim().toLowerCase() === inp.dataset.answer.toLowerCase();
          inp.style.borderColor = match ? 'green' : 'red';
          if (match) correct++;
        });
        div.querySelector('#dictFeedback').innerHTML = `<span style="font-weight:600;">${correct} von ${inputs.length} richtig</span>`;
      });
      break;
    }
    case 'dragAndDrop': {
      div.innerHTML = `<div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
        ${content.taskDescription ? `<p style="margin-bottom:16px;">${escapeHtml(content.taskDescription)}</p>` : ''}
        <div style="display:flex; gap:24px; flex-wrap:wrap;">
          <div style="flex:1; min-width:200px;">
            <h4 style="margin-bottom:8px;">Elemente:</h4>
            <div id="dndDraggables" style="display:flex; flex-wrap:wrap; gap:8px;"></div>
          </div>
          <div style="flex:1; min-width:200px;">
            <h4 style="margin-bottom:8px;">Zielzonen:</h4>
            <div id="dndZones"></div>
          </div>
        </div>
        <div id="dndFeedback" style="margin-top:16px;"></div>
      </div>`;
      const zonesEl = div.querySelector('#dndZones');
      const dragsEl = div.querySelector('#dndDraggables');
      const zones = content.dropZones || [];
      const drags = content.draggables || [];
      zones.forEach((z) => {
        const zone = document.createElement('div');
        zone.style.cssText = 'padding:16px; border:2px dashed var(--border); border-radius:var(--radius-sm); margin-bottom:8px; min-height:50px;';
        zone.innerHTML = `<strong>${escapeHtml(z.label)}</strong><div class="zone-items" data-zone="${escapeAttr(z.label)}" style="margin-top:8px;"></div>`;
        zonesEl.appendChild(zone);
      });
      drags.forEach((d) => {
        const drag = document.createElement('button');
        drag.className = 'btn btn-secondary btn-sm';
        drag.textContent = d.text;
        drag.dataset.correctZone = d.correctZone || '';
        drag.addEventListener('click', () => {
          const currentZone = drag.dataset.currentZone || '';
          const zoneNames = zones.map((z) => z.label);
          const nextIdx = currentZone ? (zoneNames.indexOf(currentZone) + 1) % (zoneNames.length + 1) : 0;
          if (nextIdx >= zoneNames.length) {
            drag.dataset.currentZone = '';
            drag.style.opacity = '1';
            dragsEl.appendChild(drag);
          } else {
            drag.dataset.currentZone = zoneNames[nextIdx];
            drag.style.opacity = '0.7';
            const zoneEl = zonesEl.querySelector(`[data-zone="${escapeAttr(zoneNames[nextIdx])}"]`);
            if (zoneEl) zoneEl.appendChild(drag);
          }
        });
        dragsEl.appendChild(drag);
      });
      break;
    }
    case 'iframeEmbedder': {
      const url = content.url || '';
      if (url) {
        div.innerHTML = `<p style="margin-bottom:8px; font-size:0.85rem; color:var(--text-secondary);">Eingebettete Seite: ${escapeHtml(url)}</p>
          <div style="border:1px solid var(--border); border-radius:var(--radius-sm); overflow:hidden; background:#fff; text-align:center; padding:40px;">
            <p>IFrame-Vorschau ist in der Desktop-App aus Sicherheitsgründen eingeschränkt.</p>
            <p style="margin-top:8px;"><strong>URL:</strong> ${escapeHtml(url)}</p>
            <p style="margin-top:4px;"><strong>Größe:</strong> ${content.width || 800}×${content.height || 600}px</p>
          </div>`;
      } else { div.textContent = 'Keine URL definiert.'; }
      break;
    }
    case 'imageHotspots': {
      const hotspots = content.hotspots || [];
      div.innerHTML = `<div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
        <div style="position:relative; width:100%; height:300px; background:#e2e8f0; border-radius:var(--radius-sm); overflow:hidden;">
          ${hotspots.map((h) => `
            <div style="position:absolute; left:${h.posX || 50}%; top:${h.posY || 50}%; transform:translate(-50%,-50%); width:30px; height:30px; background:var(--accent); border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; color:white; font-weight:bold; font-size:0.8rem;" title="${escapeAttr(h.title || '')}">📌</div>
          `).join('')}
        </div>
        <div style="margin-top:16px;">
          ${hotspots.map((h) => `<div style="margin-bottom:8px; padding:8px 12px; background:var(--bg-secondary); border-radius:var(--radius-sm); border:1px solid var(--border);"><strong>${escapeHtml(h.title || '')}</strong><br/><span style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(h.content || '')}</span></div>`).join('')}
        </div>
      </div>`;
      break;
    }
    case 'collage': {
      const images = content.images || [];
      div.innerHTML = `<div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
        <p style="margin-bottom:12px;"><strong>Layout:</strong> ${content.layout || 'Standard'}</p>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:12px;">
          ${images.map((img) => `
            <div style="background:var(--bg-secondary); border:1px solid var(--border); border-radius:var(--radius-sm); padding:16px; text-align:center;">
              <div style="font-size:2rem; margin-bottom:8px;">🖼️</div>
              <p style="font-size:0.85rem;">${escapeHtml(img.imageUrl || 'Kein Bild')}</p>
              <p style="font-size:0.8rem; color:var(--text-secondary);">${escapeHtml(img.alt || '')}</p>
            </div>
          `).join('')}
        </div>
      </div>`;
      break;
    }
    case 'audioRecorder': {
      div.innerHTML = `<div style="padding:30px; text-align:center; background:var(--bg-primary); border-radius:var(--radius-md);">
        ${content.instruction ? `<p style="margin-bottom:20px;">${escapeHtml(content.instruction)}</p>` : ''}
        <div style="font-size:4rem; margin-bottom:16px;">🎙️</div>
        <p style="color:var(--text-secondary);">Audio Recorder Vorschau</p>
        <p style="font-size:0.85rem; color:var(--text-secondary); margin-top:8px;">Max. Aufnahmedauer: ${content.maxDuration || 60}s</p>
      </div>`;
      break;
    }
    case 'branchingScenario': {
      const startScreen = content.startScreen || {};
      const steps = content.steps || [];
      div.innerHTML = `<div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
        <div style="text-align:center; margin-bottom:24px;">
          <h3>${escapeHtml(startScreen.title || 'Branching Scenario')}</h3>
          ${startScreen.subtitle ? `<p style="color:var(--text-secondary);">${escapeHtml(startScreen.subtitle)}</p>` : ''}
        </div>
        <div>
          ${steps.map((s, i) => `
            <div style="padding:12px 16px; background:var(--bg-secondary); border:1px solid var(--border); border-radius:var(--radius-sm); margin-bottom:8px;">
              <strong>Schritt ${i + 1}: ${escapeHtml(s.stepTitle || '')}</strong>
              ${s.stepContent ? `<p style="font-size:0.85rem; margin-top:4px;">${escapeHtml(s.stepContent)}</p>` : ''}
            </div>
          `).join('')}
        </div>
      </div>`;
      break;
    }
    case 'video': {
      div.innerHTML = `<div style="padding:30px; text-align:center; background:var(--bg-primary); border-radius:var(--radius-md);">
        <div style="font-size:4rem; margin-bottom:16px;">🎬</div>
        <h3>${escapeHtml(content.title || 'Video')}</h3>
        <p style="margin-top:8px; color:var(--text-secondary);">Quelle: ${escapeHtml(content.videoUrl || 'Nicht definiert')}</p>
      </div>`;
      break;
    }
    default: {
      div.innerHTML = `<div style="padding:30px; text-align:center; color:var(--text-secondary);">
        <p>Vorschau für diesen Modultyp wird noch entwickelt.</p>
        <pre style="text-align:left; margin-top:16px; padding:12px; background:var(--bg-primary); border-radius:var(--radius-sm); font-size:0.8rem; overflow:auto;">${escapeHtml(JSON.stringify(content, null, 2))}</pre>
      </div>`;
    }
  }

  return div;
}

function startArithmeticQuiz(container, content) {
  if (!container) return;
  const type = content.arithmeticType || 'addition';
  const max = content.maxNumber || 10;
  const num = content.numQuestions || 10;

  const questions = [];
  for (let i = 0; i < num; i++) {
    const a = Math.floor(Math.random() * max) + 1;
    const b = Math.floor(Math.random() * max) + 1;
    let op, answer;
    switch (type) {
      case 'subtraction': op = '−'; answer = a - b; break;
      case 'multiplication': op = '×'; answer = a * b; break;
      case 'division': op = '÷'; answer = Math.round((a * b) / b * 100) / 100; break;
      default: op = '+'; answer = a + b;
    }
    const displayA = type === 'division' ? a * b : a;
    questions.push({ display: `${displayA} ${op} ${b} = ?`, answer: type === 'division' ? a : answer });
  }

  let qIdx = 0;
  let score = 0;

  const render = () => {
    if (qIdx >= questions.length) {
      container.innerHTML = `<h3>Ergebnis: ${score} / ${questions.length}</h3>`;
      return;
    }
    container.innerHTML = `
      <p style="font-size:1.3rem; font-weight:600; margin-bottom:12px;">${questions[qIdx].display}</p>
      <input type="number" id="quizAnswer" style="padding:8px 12px; border:1px solid var(--border); border-radius:4px; width:120px; text-align:center; font-size:1.1rem;" autofocus>
      <button class="btn btn-primary btn-sm" style="margin-left:8px;" id="quizSubmit">→</button>
      <p style="margin-top:8px; font-size:0.85rem; color:var(--text-secondary);">Frage ${qIdx + 1} von ${questions.length} — Punkte: ${score}</p>
    `;
    container.querySelector('#quizSubmit').addEventListener('click', () => {
      const val = parseFloat(container.querySelector('#quizAnswer').value);
      if (val === questions[qIdx].answer) score++;
      qIdx++;
      render();
    });
    container.querySelector('#quizAnswer').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') container.querySelector('#quizSubmit').click();
    });
  };
  render();
}

// ==================== MENU HANDLERS ====================

window.api.onMenuImport(async () => {
  if (currentUser && currentUser.role === 'teacher') {
    const result = await window.api.importTopic();
    if (result.success) {
      showToast(t('topics.import.success', { title: result.topicTitle, count: result.importedCount || 0 }), 'success');
      await loadTopics();
      navigateToView('teacher-topics');
    }
  }
});

window.api.onMenuExport(async () => {
  if (currentUser && currentUser.role === 'teacher' && currentTopicId) {
    const result = await window.api.exportTopic(currentTopicId);
    if (result.success) showToast(t('topics.exported'), 'success');
  }
});

// ==================== UTILITIES ====================

function generateId() {
  return 'mod_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ==================== INITIALIZATION ====================

const btnThemeToggle = document.getElementById('btnThemeToggle');
const langSelect = document.getElementById('langSelect');

function initTheme() {
  const saved = localStorage.getItem('app-theme') || 'light';
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    btnThemeToggle.textContent = '☀️';
  }
}

btnThemeToggle.addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('app-theme', 'light');
    btnThemeToggle.textContent = '🌙';
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('app-theme', 'dark');
    btnThemeToggle.textContent = '☀️';
  }
});

langSelect.value = getLanguage();
langSelect.addEventListener('change', () => {
  setLanguage(langSelect.value);
});

async function init() {
  initTheme();
  applyTranslations();
  contentEditor = new ContentEditorManager(contentEditorEl);
  populateTypeSelects();
}

init();
