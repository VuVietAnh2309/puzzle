// ==================== STATE ====================
let quizData = {
  title: 'Quiz Game',
  questions: [],
  obstacleQuestion: {
    enabled: false,
    question: '',
    answer: '',
    hints: [],
    timeLimit: 30,
    points: 3000
  },
  puzzle: {
    image: null,
    gridSize: 4,
    timeLimit: 120
  }
};

let editingIndex = -1; // -1 = adding new, >= 0 = editing existing
let currentQuestionImage = null;

// ==================== INIT ====================

document.addEventListener('DOMContentLoaded', () => {
  loadQuizData();
  setupTabs();
});

function setupTabs() {
  document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = item.dataset.tab;
      document.querySelectorAll('.nav-item[data-tab]').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.getElementById(`tab-${tab}`).classList.add('active');
    });
  });
}

// ==================== API ====================

async function loadQuizData() {
  try {
    const res = await fetch('/api/quiz');
    const data = await res.json();
    if (data && data.questions) {
      quizData = data;
    }
  } catch (e) {
    console.error('Failed to load quiz data:', e);
  }
  renderAll();
}

async function saveAll() {
  // Collect obstacle settings
  updateObstacleData();
  // Collect puzzle settings
  updatePuzzleData();
  // Collect general settings
  quizData.title = document.getElementById('quizTitle').value || 'Quiz Game';

  try {
    const res = await fetch('/api/quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(quizData)
    });
    const result = await res.json();
    if (result.success) {
      showToast('Đã lưu thành công!', 'success');
    } else {
      showToast('Lỗi khi lưu', 'error');
    }
  } catch (e) {
    showToast('Lỗi kết nối server', 'error');
  }
}

async function createRoom() {
  // Save first
  updateObstacleData();
  updatePuzzleData();
  quizData.title = document.getElementById('quizTitle').value || 'Quiz Game';

  try {
    await fetch('/api/quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(quizData)
    });

    const res = await fetch('/api/room', { method: 'POST' });
    const data = await res.json();

    if (data.code) {
      document.getElementById('roomCodeDisplay').textContent = data.code;
      document.getElementById('adminLink').href = `/admin?room=${data.code}`;
      document.getElementById('playerLink').href = `/player?room=${data.code}`;
      document.getElementById('roomModal').style.display = 'flex';
    }
  } catch (e) {
    showToast('Lỗi tạo phòng thi', 'error');
  }
}

// ==================== RENDER ====================

function renderAll() {
  renderQuestionsList();
  renderObstacle();
  renderPuzzle();
  renderSettings();
}

function renderQuestionsList() {
  const container = document.getElementById('questionsList');
  const count = quizData.questions.length;

  // Update counters
  const countEl = document.getElementById('questionCount');
  if (countEl) countEl.textContent = `${count} câu hỏi`;
  const infoEl = document.getElementById('tableInfo');
  if (infoEl) infoEl.textContent = `Hiển thị ${count} câu hỏi`;

  if (count === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:3rem; color:#94a3b8;">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5" style="margin-bottom:1rem"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <p style="font-size:1rem; font-weight:700; margin-bottom:0.3rem; color:#64748b;">Chưa có câu hỏi nào</p>
        <p style="font-size:0.85rem;">Nhấn "+ Thêm câu hỏi" để bắt đầu</p>
      </div>
    `;
    return;
  }

  const typeLabels = {
    multiple: 'Trắc nghiệm',
    truefalse: 'Đúng/Sai',
    text: 'Ghi đáp án',
    multi_select: 'Chọn nhiều'
  };

  container.innerHTML = quizData.questions.map((q, i) => `
    <div class="question-card" onclick="editQuestion(${i})">
      <div class="q-card-num">${i + 1}</div>
      <div class="q-card-body">
        <div class="q-card-text">${escapeHtml(q.question)}</div>
        <div class="q-card-meta">
          <span>${q.timeLimit}s</span>
          <span>${q.points} điểm</span>
          ${q.image ? '<span>Có ảnh</span>' : ''}
          ${q.hint ? '<span>Có gợi ý</span>' : ''}
        </div>
      </div>
      <span class="q-card-type-badge type-${q.type}">${typeLabels[q.type] || q.type}</span>
      <div class="q-card-actions" onclick="event.stopPropagation()">
        <button class="btn-edit" onclick="editQuestion(${i})" title="Sửa">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-delete" onclick="deleteQuestion(${i})" title="Xoá">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </div>
    </div>
  `).join('');
}

function renderObstacle() {
  const obs = quizData.obstacleQuestion;
  document.getElementById('obstacleEnabled').checked = obs.enabled;
  document.getElementById('obstacleQuestion').value = obs.question || '';
  document.getElementById('obstacleAnswer').value = obs.answer || '';
  document.getElementById('obstacleTime').value = obs.timeLimit || 30;
  document.getElementById('obstaclePoints').value = obs.points || 3000;

  renderHintsList();
}

function renderHintsList() {
  const container = document.getElementById('hintsList');
  if (quizData.questions.length === 0) {
    container.innerHTML = '<p style="color:#999; font-size:0.85rem;">Thêm câu hỏi trước để thiết lập gợi ý</p>';
    return;
  }

  const hints = quizData.obstacleQuestion.hints || [];
  container.innerHTML = quizData.questions.map((q, i) => {
    const hint = hints[i] || '';
    return `
      <div class="hint-item">
        <div class="hint-num">${i + 1}</div>
        <div class="hint-text ${hint ? '' : 'empty'}">${hint || '(trống)'}</div>
      </div>
    `;
  }).join('');
}

function renderPuzzle() {
  const puzzle = quizData.puzzle;
  document.getElementById('puzzleGrid').value = puzzle.gridSize || 4;
  document.getElementById('puzzleTime').value = puzzle.timeLimit || 120;

  const preview = document.getElementById('puzzlePreview');
  if (puzzle.image) {
    preview.innerHTML = `<img src="${puzzle.image}" alt="Puzzle image">`;
  } else {
    preview.textContent = 'Click để chọn ảnh';
  }
}

function renderSettings() {
  document.getElementById('quizTitle').value = quizData.title || 'Quiz Game';
}

// ==================== QUESTION CRUD ====================

function addQuestion() {
  editingIndex = -1;
  currentQuestionImage = null;
  document.getElementById('modalTitle').textContent = 'Thêm câu hỏi';
  document.getElementById('qType').value = 'multiple';
  document.getElementById('qText').value = '';
  document.getElementById('qTimeLimit').value = 15;
  document.getElementById('qPoints').value = 1000;
  document.getElementById('qHint').value = '';
  document.getElementById('qImagePreview').innerHTML = '+ Ảnh';
  onTypeChange();
  document.getElementById('questionModal').style.display = 'flex';
}

function editQuestion(index) {
  editingIndex = index;
  const q = quizData.questions[index];
  document.getElementById('modalTitle').textContent = `Sửa câu ${index + 1}`;
  document.getElementById('qType').value = q.type;
  document.getElementById('qText').value = q.question;
  document.getElementById('qTimeLimit').value = q.timeLimit;
  document.getElementById('qPoints').value = q.points;
  document.getElementById('qHint').value = q.hint || '';
  currentQuestionImage = q.image;

  if (q.image) {
    document.getElementById('qImagePreview').innerHTML = `<img src="${q.image}" alt="Question image">`;
  } else {
    document.getElementById('qImagePreview').innerHTML = '+ Ảnh';
  }

  onTypeChange();

  // Fill in answers
  if (q.type === 'text') {
    document.getElementById('qTextAnswer').value = Array.isArray(q.correct) ? q.correct[0] : (q.correct || '');
  } else {
    renderOptionsEditor(q.options, q.correct);
  }

  document.getElementById('questionModal').style.display = 'flex';
}

function deleteQuestion(index) {
  if (!confirm(`Xoá câu hỏi ${index + 1}?`)) return;
  quizData.questions.splice(index, 1);
  // Update hints array
  if (quizData.obstacleQuestion.hints) {
    quizData.obstacleQuestion.hints.splice(index, 1);
  }
  // Re-assign IDs
  quizData.questions.forEach((q, i) => q.id = i + 1);
  renderQuestionsList();
  renderHintsList();
}

function closeModal() {
  document.getElementById('questionModal').style.display = 'none';
}

function onTypeChange() {
  const type = document.getElementById('qType').value;
  const optionsSection = document.getElementById('optionsSection');
  const textSection = document.getElementById('textAnswerSection');

  if (type === 'text') {
    optionsSection.style.display = 'none';
    textSection.style.display = 'block';
  } else {
    optionsSection.style.display = 'block';
    textSection.style.display = 'none';

    if (type === 'truefalse') {
      renderOptionsEditor(['Đúng', 'Sai'], [0]);
    } else {
      // If editing, keep existing; otherwise default 4 options
      if (editingIndex >= 0) {
        const q = quizData.questions[editingIndex];
        if (q.type === type) {
          renderOptionsEditor(q.options, q.correct);
        } else {
          renderOptionsEditor(['', '', '', ''], [0]);
        }
      } else {
        renderOptionsEditor(['', '', '', ''], [0]);
      }
    }
  }
}

function renderOptionsEditor(options, correct) {
  const type = document.getElementById('qType').value;
  const container = document.getElementById('optionsList');
  const isReadonly = type === 'truefalse';

  container.innerHTML = options.map((opt, i) => {
    const isCorrect = correct.includes(i);
    return `
      <div class="option-edit-row option-color-${i}">
        <input type="text" value="${escapeHtml(opt)}" placeholder="Đáp án ${i + 1}"
          id="opt-input-${i}" ${isReadonly ? 'readonly' : ''}>
        <button class="option-correct-btn ${isCorrect ? 'is-correct' : ''}"
          onclick="toggleCorrect(${i})" title="Đánh dấu đáp án đúng" id="opt-correct-${i}">
          ${isCorrect ? '✓' : ''}
        </button>
      </div>
    `;
  }).join('');
}

function toggleCorrect(index) {
  const type = document.getElementById('qType').value;
  const buttons = document.querySelectorAll('.option-correct-btn');

  if (type === 'multi_select') {
    // Toggle individual
    const btn = document.getElementById(`opt-correct-${index}`);
    btn.classList.toggle('is-correct');
    btn.textContent = btn.classList.contains('is-correct') ? '✓' : '';
  } else {
    // Single select - uncheck all others
    buttons.forEach((btn, i) => {
      if (i === index) {
        btn.classList.add('is-correct');
        btn.textContent = '✓';
      } else {
        btn.classList.remove('is-correct');
        btn.textContent = '';
      }
    });
  }
}

function saveQuestion() {
  const type = document.getElementById('qType').value;
  const question = document.getElementById('qText').value.trim();
  const timeLimit = parseInt(document.getElementById('qTimeLimit').value) || 15;
  const points = parseInt(document.getElementById('qPoints').value) || 1000;
  const hint = document.getElementById('qHint').value.trim() || null;

  if (!question) {
    showToast('Vui lòng nhập câu hỏi', 'error');
    return;
  }

  let options = [];
  let correct = [];

  if (type === 'text') {
    const textAnswer = document.getElementById('qTextAnswer').value.trim();
    if (!textAnswer) {
      showToast('Vui lòng nhập đáp án', 'error');
      return;
    }
    correct = [textAnswer];
    options = [];
  } else {
    const optionInputs = document.querySelectorAll('#optionsList input[type="text"]');
    const correctBtns = document.querySelectorAll('.option-correct-btn');

    optionInputs.forEach((input, i) => {
      options.push(input.value.trim());
    });

    correctBtns.forEach((btn, i) => {
      if (btn.classList.contains('is-correct')) correct.push(i);
    });

    if (type !== 'truefalse' && options.some(o => !o)) {
      showToast('Vui lòng nhập đầy đủ đáp án', 'error');
      return;
    }

    if (correct.length === 0) {
      showToast('Vui lòng chọn đáp án đúng', 'error');
      return;
    }
  }

  const qData = {
    id: editingIndex >= 0 ? quizData.questions[editingIndex].id : (quizData.questions.length + 1),
    type,
    question,
    options,
    correct,
    timeLimit,
    points,
    image: currentQuestionImage,
    hint
  };

  if (editingIndex >= 0) {
    quizData.questions[editingIndex] = qData;
  } else {
    quizData.questions.push(qData);
  }

  // Update hints array
  syncHints();

  closeModal();
  renderQuestionsList();
  renderHintsList();
  showToast(editingIndex >= 0 ? 'Đã cập nhật câu hỏi' : 'Đã thêm câu hỏi', 'success');
}

function syncHints() {
  const hints = quizData.obstacleQuestion.hints || [];
  // Ensure hints array matches questions length
  while (hints.length < quizData.questions.length) hints.push(null);
  if (hints.length > quizData.questions.length) hints.length = quizData.questions.length;

  // Update hint values from questions
  quizData.questions.forEach((q, i) => {
    hints[i] = q.hint || null;
  });

  quizData.obstacleQuestion.hints = hints;
}

// ==================== IMAGE UPLOAD ====================

async function uploadQuestionImage(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  const formData = new FormData();
  formData.append('image', file);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.url) {
      currentQuestionImage = data.url;
      document.getElementById('qImagePreview').innerHTML = `<img src="${data.url}" alt="Preview">`;
    }
  } catch (e) {
    showToast('Lỗi upload ảnh', 'error');
  }
}

async function uploadPuzzleImage(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  const formData = new FormData();
  formData.append('image', file);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.url) {
      quizData.puzzle.image = data.url;
      document.getElementById('puzzlePreview').innerHTML = `<img src="${data.url}" alt="Puzzle">`;
    }
  } catch (e) {
    showToast('Lỗi upload ảnh', 'error');
  }
}

// ==================== OBSTACLE ====================

function updateObstacle() {
  // Just UI toggle, actual save happens on saveAll
}

function updateObstacleData() {
  quizData.obstacleQuestion.enabled = document.getElementById('obstacleEnabled').checked;
  quizData.obstacleQuestion.question = document.getElementById('obstacleQuestion').value.trim();
  quizData.obstacleQuestion.answer = document.getElementById('obstacleAnswer').value.trim();
  quizData.obstacleQuestion.timeLimit = parseInt(document.getElementById('obstacleTime').value) || 30;
  quizData.obstacleQuestion.points = parseInt(document.getElementById('obstaclePoints').value) || 3000;
  syncHints();
}

// ==================== PUZZLE ====================

function updatePuzzleData() {
  quizData.puzzle.gridSize = parseInt(document.getElementById('puzzleGrid').value) || 4;
  quizData.puzzle.timeLimit = parseInt(document.getElementById('puzzleTime').value) || 120;
}

// ==================== UTILS ====================

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
