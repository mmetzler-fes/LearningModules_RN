/**
 * LearningModules - Main Application Logic
 */

// --- State ---
let modules = [];
let editingModuleId = null;
let contentEditor = null;

// --- DOM Elements ---
const sidebar = document.getElementById('sidebar');
const navButtons = document.querySelectorAll('.nav-btn');
const views = document.querySelectorAll('.view');
const toastContainer = document.getElementById('toastContainer');

// Dashboard
const statTotal = document.getElementById('statTotal');
const statTypes = document.getElementById('statTypes');
const statRecent = document.getElementById('statRecent');
const typeGrid = document.getElementById('typeGrid');

// Modules List
const modulesList = document.getElementById('modulesList');
const emptyModules = document.getElementById('emptyModules');
const searchModules = document.getElementById('searchModules');
const filterType = document.getElementById('filterType');

// Create/Edit Form
const moduleForm = document.getElementById('moduleForm');
const moduleIdInput = document.getElementById('moduleId');
const moduleTitleInput = document.getElementById('moduleTitle');
const moduleTypeSelect = document.getElementById('moduleType');
const moduleDescInput = document.getElementById('moduleDescription');
const contentEditorEl = document.getElementById('contentEditor');
const createViewTitle = document.getElementById('createViewTitle');
const btnCancelModule = document.getElementById('btnCancelModule');

// Import/Export
const btnImport = document.getElementById('btnImport');
const btnExportAll = document.getElementById('btnExportAll');
const importResult = document.getElementById('importResult');

// Player
const btnBackFromPlayer = document.getElementById('btnBackFromPlayer');
const playerTitle = document.getElementById('playerTitle');
const h5pContainer = document.getElementById('h5pContainer');

// --- Navigation ---
function navigateToView(viewName) {
  views.forEach((v) => v.classList.remove('active'));
  navButtons.forEach((b) => b.classList.remove('active'));

  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) targetView.classList.add('active');

  const targetBtn = document.querySelector(`.nav-btn[data-view="${viewName}"]`);
  if (targetBtn) targetBtn.classList.add('active');

  // Refresh data for specific views
  if (viewName === 'dashboard') refreshDashboard();
  if (viewName === 'modules') refreshModulesList();
}

// Expose for inline onclick handlers
window.appNavigate = navigateToView;

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    navigateToView(btn.dataset.view);
  });
});

// --- Toast Notifications ---
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

// --- Data Loading ---
async function loadData() {
  const result = await window.api.getModules();
  modules = result.modules || [];
}

// --- Dashboard ---
function refreshDashboard() {
  statTotal.textContent = modules.length;
  const usedTypes = new Set(modules.map((m) => m.type));
  statTypes.textContent = usedTypes.size;
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  statRecent.textContent = modules.filter((m) => new Date(m.createdAt).getTime() > oneWeekAgo).length;

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
    card.addEventListener('click', () => {
      navigateToView('create');
      moduleTypeSelect.value = t.id;
      moduleTypeSelect.dispatchEvent(new Event('change'));
    });
    typeGrid.appendChild(card);
  }
}

// --- Modules List ---
function refreshModulesList() {
  const search = searchModules.value.toLowerCase().trim();
  const typeFilter = filterType.value;

  let filtered = modules;
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
    empty.innerHTML = modules.length === 0
      ? `<span class="empty-icon">📭</span><p>Noch keine Module erstellt.</p>
         <button class="btn btn-primary" onclick="window.appNavigate('create')">Erstes Modul erstellen</button>`
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
    card.querySelector('.btn-edit').addEventListener('click', () => openEditor(mod));
    card.querySelector('.btn-delete').addEventListener('click', () => deleteModule(mod));
    modulesList.appendChild(card);
  }
}

searchModules.addEventListener('input', refreshModulesList);
filterType.addEventListener('change', refreshModulesList);

// --- Module Form ---
function populateTypeSelects() {
  const types = getH5pTypesArray();

  // Module form type select
  moduleTypeSelect.innerHTML = '<option value="">— Modultyp wählen —</option>';
  for (const t of types) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.icon} ${t.name}`;
    moduleTypeSelect.appendChild(opt);
  }

  // Filter select
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
      ? (modules.find((m) => m.id === editingModuleId) || {}).content || {}
      : {};
    contentEditor.render(typeId, existingData);
  } else {
    contentEditor.clear();
  }
});

moduleForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const title = moduleTitleInput.value.trim();
  const type = moduleTypeSelect.value;
  const description = moduleDescInput.value.trim();

  if (!title || !type) {
    showToast('Bitte Titel und Modultyp angeben.', 'error');
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
      ? (modules.find((m) => m.id === editingModuleId) || {}).createdAt || new Date().toISOString()
      : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const result = await window.api.saveModule(moduleData);
  if (result.success) {
    showToast(editingModuleId ? 'Modul aktualisiert!' : 'Modul erstellt!', 'success');
    await loadData();
    resetForm();
    navigateToView('modules');
  } else {
    showToast('Fehler beim Speichern.', 'error');
  }
});

btnCancelModule.addEventListener('click', () => {
  resetForm();
  navigateToView('modules');
});

function resetForm() {
  editingModuleId = null;
  moduleIdInput.value = '';
  moduleTitleInput.value = '';
  moduleTypeSelect.value = '';
  moduleDescInput.value = '';
  contentEditor.clear();
  createViewTitle.textContent = 'Neues Modul erstellen';
}

function openEditor(mod) {
  editingModuleId = mod.id;
  createViewTitle.textContent = 'Modul bearbeiten';
  moduleIdInput.value = mod.id;
  moduleTitleInput.value = mod.title;
  moduleTypeSelect.value = mod.type;
  moduleDescInput.value = mod.description || '';
  navigateToView('create');
  contentEditor.render(mod.type, mod.content || {});
}

async function deleteModule(mod) {
  if (!confirm(`Modul "${mod.title}" wirklich löschen?`)) return;
  const result = await window.api.deleteModule(mod.id);
  if (result.success) {
    showToast('Modul gelöscht.', 'info');
    await loadData();
    refreshModulesList();
  }
}

// --- H5P Player ---
function openPlayer(mod) {
  const typeDef = H5P_TYPES[mod.type] || {};
  playerTitle.textContent = mod.title;
  navigateToView('player');

  // Render an interactive preview based on the content type
  h5pContainer.innerHTML = '';
  renderH5pPreview(mod, typeDef);
}

function renderH5pPreview(mod, typeDef) {
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

  // Type-specific preview rendering
  const previewEl = createTypePreview(mod.type, content);
  wrapper.appendChild(previewEl);

  h5pContainer.appendChild(wrapper);
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
      if (cards.length === 0) {
        div.textContent = 'Keine Karten definiert.';
        break;
      }
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
      const updateCard = () => {
        flipped = false;
        cardDisplay.textContent = cards[idx][frontKey] || '';
        cardDisplay.style.background = 'var(--accent-light)';
        cardCounter.textContent = `${idx + 1} / ${cards.length}`;
      };
      cardDisplay.addEventListener('click', () => {
        flipped = !flipped;
        cardDisplay.textContent = flipped ? (cards[idx][backKey] || '') : (cards[idx][frontKey] || '');
        cardDisplay.style.background = flipped ? '#dcfce7' : 'var(--accent-light)';
      });
      div.querySelector('#cardPrev').addEventListener('click', () => {
        if (idx > 0) { idx--; updateCard(); }
      });
      div.querySelector('#cardNext').addEventListener('click', () => {
        if (idx < cards.length - 1) { idx++; updateCard(); }
      });
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
      questions.forEach((q, qi) => {
        const p = document.createElement('p');
        p.style.marginBottom = '12px';
        // Replace *word* with input fields
        const parts = (q.text || '').split(/\*([^*]+)\*/g);
        let inputIdx = 0;
        parts.forEach((part, pi) => {
          if (pi % 2 === 0) {
            p.appendChild(document.createTextNode(part));
          } else {
            const input = document.createElement('input');
            input.type = 'text';
            input.style.cssText = 'width:120px; padding:4px 8px; border:1px solid var(--border); border-radius:4px; margin:0 4px;';
            input.dataset.answer = part;
            input.dataset.qIdx = qi;
            input.dataset.iIdx = inputIdx++;
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
        div.querySelector('#blanksFeedback').innerHTML =
          `<span style="font-weight:600;">${correct} von ${answerMap.length} richtig</span>`;
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
          // Regular words - make each word clickable
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
        div.querySelector('#wordsFeedback').innerHTML =
          `<span style="font-weight:600;">${correct} von ${total} korrekte Wörter markiert</span>`;
      });
      break;
    }
    case 'coursePresentation': {
      const slides = content.slides || [];
      if (slides.length === 0) {
        div.textContent = 'Keine Folien definiert.';
        break;
      }
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
        slideContent.innerHTML = `<h3 style="margin-bottom:12px;">${escapeHtml(slide.slideTitle || '')}</h3>
          <div>${slide.slideContent || ''}</div>`;
        slideCounter.textContent = `${sIdx + 1} / ${slides.length}`;
      };
      updateSlide();
      div.querySelector('#slidePrev').addEventListener('click', () => {
        if (sIdx > 0) { sIdx--; updateSlide(); }
      });
      div.querySelector('#slideNext').addEventListener('click', () => {
        if (sIdx < slides.length - 1) { sIdx++; updateSlide(); }
      });
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
        div.querySelector('#dictFeedback').innerHTML =
          `<span style="font-weight:600;">${correct} von ${inputs.length} richtig</span>`;
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
          // Cycle through zones on click
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
      } else {
        div.textContent = 'Keine URL definiert.';
      }
      break;
    }
    case 'imageHotspots': {
      const hotspots = content.hotspots || [];
      div.innerHTML = `<div style="padding:20px; background:var(--bg-primary); border-radius:var(--radius-md);">
        <p style="margin-bottom:12px; font-size:0.85rem; color:var(--text-secondary);">Bild: ${escapeHtml(content.imageUrl || 'Nicht definiert')}</p>
        <div style="position:relative; width:100%; height:300px; background:#e2e8f0; border-radius:var(--radius-sm); overflow:hidden;" id="hotspotArea">
          ${hotspots.map((h) => `
            <div style="position:absolute; left:${h.posX || 50}%; top:${h.posY || 50}%; transform:translate(-50%,-50%); width:30px; height:30px; background:var(--accent); border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; color:white; font-weight:bold; font-size:0.8rem;" title="${escapeAttr(h.title || '')}">
              📌
            </div>
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
              ${s.nextStepOptions ? `<p style="font-size:0.8rem; color:var(--text-secondary); margin-top:4px;">Optionen: ${escapeHtml(s.nextStepOptions)}</p>` : ''}
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
        ${content.startAt ? `<p style="font-size:0.85rem; color:var(--text-secondary);">Start bei: ${content.startAt}s</p>` : ''}
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

btnBackFromPlayer.addEventListener('click', () => {
  h5pContainer.innerHTML = '';
  navigateToView('modules');
});

// --- Import / Export ---
btnImport.addEventListener('click', async () => {
  const result = await window.api.importModules();
  importResult.style.display = 'block';
  if (result.success) {
    importResult.className = 'import-result success';
    importResult.innerHTML = `<strong>✓ Import erfolgreich!</strong><br>${result.importedCount} Module importiert.`;
    await loadData();
    showToast(`${result.importedCount} Module importiert!`, 'success');
  } else {
    if (result.error) {
      importResult.className = 'import-result error';
      importResult.innerHTML = `<strong>✗ Import fehlgeschlagen:</strong><br>${escapeHtml(result.error)}`;
      showToast('Import fehlgeschlagen.', 'error');
    } else {
      importResult.style.display = 'none';
    }
  }
});

btnExportAll.addEventListener('click', async () => {
  const result = await window.api.exportModules([]);
  if (result.success) {
    showToast('Module exportiert!', 'success');
  }
});

// --- Menu handlers ---
window.api.onMenuImport(() => {
  navigateToView('import-export');
  btnImport.click();
});

window.api.onMenuExport(() => {
  navigateToView('import-export');
  btnExportAll.click();
});

// --- Utilities ---
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

// --- Initialization ---
async function init() {
  contentEditor = new ContentEditorManager(contentEditorEl);
  populateTypeSelects();
  await loadData();
  refreshDashboard();
}

init();
