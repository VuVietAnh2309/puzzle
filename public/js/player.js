const socket = io();
let myName = '';
let currentQuestion = null;
let hasAnswered = false;
let lastPoints = 0;
let hasJoined = false;
let roomCode = null;

const shapes = ['▲', '◆', '●', '■'];
const colorClasses = ['ans-0', 'ans-1', 'ans-2', 'ans-3'];

// ==================== TIME SYNC (NTP-style Bayeux/CometD) ====================
let serverTimeOffset = 0;
let syncSamples = [];
const SYNC_SAMPLE_COUNT = 5;
let currentQuestionEndTime = 0;
let localTimerRAF = null;

function startTimeSync() {
  syncSamples = [];
  sendSyncPing();
}

function sendSyncPing() {
  socket.emit('time:sync', { t0: Date.now() });
}

socket.on('time:sync:reply', (data) => {
  const t2 = Date.now();
  const rtt = t2 - data.t0;
  const serverTime = data.t1;
  const offset = serverTime - (data.t0 + rtt / 2);

  syncSamples.push({ rtt, offset });

  if (syncSamples.length < SYNC_SAMPLE_COUNT) {
    setTimeout(sendSyncPing, 100);
  } else {
    // Pick sample with lowest RTT for best accuracy
    syncSamples.sort((a, b) => a.rtt - b.rtt);
    serverTimeOffset = syncSamples[0].offset;
    console.log(`[TimeSync] offset=${serverTimeOffset}ms, bestRTT=${syncSamples[0].rtt}ms`);
  }
});

function getServerTime() {
  return Date.now() + serverTimeOffset;
}

// Re-sync every 30 seconds
setInterval(startTimeSync, 30000);

// ==================== LOCAL AUTHORITATIVE TIMER ====================
function startLocalTimer() {
  stopLocalTimer();
  tickLocalTimer();
}

function stopLocalTimer() {
  if (localTimerRAF) {
    cancelAnimationFrame(localTimerRAF);
    localTimerRAF = null;
  }
}

function tickLocalTimer() {
  const serverNow = getServerTime();
  const remaining = Math.ceil((currentQuestionEndTime - serverNow) / 1000);
  const clamped = Math.max(0, remaining);

  const timer = document.getElementById('pTimer');
  if (timer) {
    timer.textContent = clamped;
    if (clamped <= 5) timer.className = 'player-timer danger';
    else if (clamped <= 10) timer.className = 'player-timer warning';
    else timer.className = 'player-timer';
  }

  // Also update obstacle timer
  const obsTimer = document.getElementById('pObstacleTimer');
  if (obsTimer) obsTimer.textContent = clamped;

  if (clamped > 0) {
    localTimerRAF = requestAnimationFrame(() => {
      setTimeout(tickLocalTimer, 200);
    });
  }
}

// ==================== SOUND EFFECTS ====================
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
function getAudioCtx() { if (!audioCtx) audioCtx = new AudioCtx(); return audioCtx; }
function playTone(freq, dur, type = 'sine', vol = 0.25) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.value = vol;
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + dur);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + dur);
  } catch (e) {}
}
function sfxCorrect() { playTone(523, 0.1); setTimeout(() => playTone(784, 0.2), 100); }
function sfxWrong() { playTone(200, 0.3, 'sawtooth', 0.15); }
function sfxClick() { playTone(660, 0.08, 'square', 0.1); }

// Get room code from URL if provided
const urlParams = new URLSearchParams(window.location.search);
roomCode = urlParams.get('room');

// ==================== HELPERS ====================

function showScreen(id) {
  document.querySelectorAll('.screen, .screen-flex').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function renderPodium(ranking, podiumId) {
  const podium = document.getElementById(podiumId);
  if (ranking.length === 0) { podium.innerHTML = ''; return; }

  const spots = [
    ranking[1] || null,
    ranking[0],
    ranking[2] || null
  ];

  podium.innerHTML = spots.map(p => {
    if (!p) return `<div class="podium-item podium-empty"></div>`;
    return `
      <div class="podium-item">
        <div class="podium-name">${p.name}${p.name === myName ? ' (Bạn)' : ''}</div>
        <div class="podium-score">${p.score.toLocaleString()}</div>
        <div class="podium-bar">${p.rank}</div>
      </div>
    `;
  }).join('');
}

function renderRankingList(ranking, listId) {
  const container = document.getElementById(listId);
  const rest = ranking.length > 3 ? ranking.slice(3) : [];
  container.innerHTML = rest.map((p, i) => `
    <div class="ranking-row ${p.name === myName ? 'is-me' : ''}" style="animation-delay: ${i * 0.05}s">
      <div class="rank-num">${p.rank}</div>
      <div class="rank-name">${p.name}${p.name === myName ? ' (Bạn)' : ''}</div>
      <div class="rank-score">${p.score.toLocaleString()}</div>
    </div>
  `).join('');
}

// ==================== JOIN ====================

function joinGame() {
  if (hasJoined) return;
  const nameInput = document.getElementById('playerName');
  const name = nameInput.value.trim();

  if (!name) {
    nameInput.style.borderColor = '#E21B3C';
    nameInput.focus();
    return;
  }

  // Get room code from input or URL
  const codeInput = document.getElementById('roomCode');
  const code = codeInput ? codeInput.value.trim().toUpperCase() : roomCode;

  if (!code) {
    if (codeInput) {
      codeInput.style.borderColor = '#E21B3C';
      codeInput.focus();
    }
    return;
  }

  hasJoined = true;
  myName = name;
  roomCode = code;
  socket.emit('player:join', { roomCode: code, name });
  document.getElementById('waitingName').textContent = name;
  showScreen('waitingScreen');
}

document.getElementById('playerName').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinGame();
});

// Room code input enter handler
const roomCodeInput = document.getElementById('roomCode');
if (roomCodeInput) {
  roomCodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinGame();
  });
  // Pre-fill from URL
  if (roomCode) {
    roomCodeInput.value = roomCode;
  }
}

// ==================== SOCKET EVENTS ====================

socket.on('game:state', (data) => {
  if (myName && data.phase === 'lobby') {
    showScreen('waitingScreen');
  }
});

socket.on('connect', () => {
  console.log('Connected to server');
  startTimeSync();
  if (hasJoined && myName && roomCode) {
    socket.emit('player:join', { roomCode, name: myName });
  }
});

socket.on('connect_error', (err) => {
  console.error('Connection error:', err);
});

socket.on('error', (data) => {
  hasJoined = false;
  showScreen('joinScreen');
  const nameInput = document.getElementById('playerName');
  nameInput.style.borderColor = '#E21B3C';
  alert(data.message);
});

socket.on('game:countdown', (data) => {
  if (!myName) return;
  stopLocalTimer();
  showScreen('questionScreen');
  document.getElementById('pQNum').textContent = `Câu ${data.questionIndex + 1} / ${data.total}`;
  document.getElementById('pQText').textContent = 'Chuẩn bị...';
  document.getElementById('pTimer').textContent = data.duration;
  document.getElementById('pTimer').className = 'player-timer';
  document.getElementById('pAnswersGrid').innerHTML = '';

  // Use server-authoritative countdownEndTime if available
  if (data.countdownEndTime) {
    currentQuestionEndTime = data.countdownEndTime;
    startLocalTimer();
  } else {
    let count = data.duration;
    const countdownInterval = setInterval(() => {
      count--;
      document.getElementById('pTimer').textContent = count;
      if (count <= 0) clearInterval(countdownInterval);
    }, 1000);
  }
});

socket.on('question:show', (data) => {
  if (!myName) return;

  currentQuestion = data;
  hasAnswered = false;

  document.getElementById('pQNum').textContent = `Câu ${data.index + 1} / ${data.total}`;
  document.getElementById('pQText').textContent = data.question;

  // Show image if available
  if (data.image) {
    document.getElementById('pQText').innerHTML =
      `<img src="${data.image}" style="max-height:80px;border-radius:6px;margin-bottom:8px;"><br>${data.question}`;
  }

  const timer = document.getElementById('pTimer');
  timer.textContent = data.timeLimit;
  timer.className = 'player-timer';

  // Start local authoritative timer if questionEndTime provided
  if (data.questionEndTime) {
    currentQuestionEndTime = data.questionEndTime;
    startLocalTimer();
  }

  if (data.type === 'text') {
    // Text input answer
    document.getElementById('pAnswersGrid').innerHTML = `
      <div style="grid-column: 1 / -1; padding: 1rem;">
        <input type="text" id="textAnswerInput" class="join-input"
          placeholder="Nhập đáp án..." autocomplete="off"
          style="margin-bottom:12px; text-align:center; font-size:1.2rem;">
        <button class="join-btn" onclick="submitTextAnswer()" style="background:var(--kahoot-green);">
          Gửi đáp án
        </button>
      </div>
    `;
    document.getElementById('textAnswerInput').focus();
    document.getElementById('textAnswerInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') submitTextAnswer();
    });
  } else {
    document.getElementById('pAnswersGrid').innerHTML = data.options.map((opt, i) => `
      <button class="player-answer-btn ${colorClasses[i]}" onclick="selectOption(${i})" id="opt-${i}">
        <div class="shape-icon">${shapes[i] || ''}</div>
        ${opt}
      </button>
    `).join('');
  }

  showScreen('questionScreen');
});

socket.on('timer:update', (data) => {
  // Support both old (number) and new (object) format
  if (typeof data === 'object' && data.questionEndTime) {
    currentQuestionEndTime = data.questionEndTime;
    startLocalTimer();
  } else {
    const timeLeft = typeof data === 'number' ? data : data.timeLeft;
    const timer = document.getElementById('pTimer');
    if (timer) {
      timer.textContent = timeLeft;
      if (timeLeft <= 5) timer.className = 'player-timer danger';
      else if (timeLeft <= 10) timer.className = 'player-timer warning';
      else timer.className = 'player-timer';
    }
    const obsTimer = document.getElementById('pObstacleTimer');
    if (obsTimer) obsTimer.textContent = timeLeft;
  }
});

socket.on('answer:confirmed', (data) => {
  document.getElementById('answeredSub').textContent = `Trả lời trong ${data.timeTaken}s — Đang chờ kết quả...`;
  showScreen('answeredScreen');
});

socket.on('question:result', (data) => {
  stopLocalTimer();
  showScreen('resultScreen');

  const icon = document.getElementById('resultIcon');
  const title = document.getElementById('resultTitle');
  const points = document.getElementById('resultPoints');
  const sub = document.getElementById('resultSub');

  const myRank = data.ranking ? data.ranking.find(r => r.name === myName) : null;

  if (myRank) {
    const earned = myRank.score - lastPoints;
    lastPoints = myRank.score;

    if (earned > 0) {
      sfxCorrect();
      icon.className = 'answered-icon correct';
      icon.textContent = '✓';
      title.textContent = 'Chính xác!';
      points.textContent = `+${earned}`;
      points.style.color = '#26890C';
      points.style.fontSize = '';
    } else {
      sfxWrong();
      icon.className = 'answered-icon wrong';
      icon.textContent = '✗';
      title.textContent = 'Sai rồi!';

      // Show correct answer
      if (data.type === 'text') {
        const correctAns = Array.isArray(data.correct) ? data.correct[0] : data.correct;
        points.textContent = `Đáp án: ${correctAns}`;
      } else {
        const correctIdx = Array.isArray(data.correct) ? data.correct[0] : data.correct;
        points.textContent = `${shapes[correctIdx] || '✓'} ${data.options[correctIdx]}`;
      }
      points.style.color = 'rgba(255,255,255,0.7)';
      points.style.fontSize = '1.5rem';
    }
    sub.textContent = `Tổng điểm: ${myRank.score.toLocaleString()}`;
  } else {
    icon.className = 'answered-icon neutral';
    icon.textContent = '📊';
    title.textContent = 'Kết quả';
    points.textContent = '';
    sub.textContent = '';
  }
});

socket.on('game:ranking', (data) => {
  showScreen('rankingScreen');
  document.getElementById('pRankTitle').textContent = 'Bảng xếp hạng';
  document.getElementById('pRankSub').textContent = `Sau câu ${data.questionIndex + 1} / ${data.total}`;
  renderPodium(data.ranking, 'pPodium');
  renderRankingList(data.ranking, 'pRankingList');
});

socket.on('game:obstacle', (data) => {
  showScreen('obstacleScreen');
  document.getElementById('pObstacleQuestion').textContent = data.question;
  document.getElementById('pObstacleTimer').textContent = data.timeLimit;

  // Start local authoritative timer if questionEndTime provided
  if (data.questionEndTime) {
    currentQuestionEndTime = data.questionEndTime;
    startLocalTimer();
  }

  // Render hints
  const hintsEl = document.getElementById('pObstacleHints');
  hintsEl.innerHTML = data.hints.map(h => `
    <div class="obstacle-hint-tag">${h.hint}</div>
  `).join('');

  // Render answer input
  document.getElementById('pObstacleInput').value = '';
  document.getElementById('pObstacleInput').focus();
});

socket.on('obstacle:confirmed', (data) => {
  showScreen('answeredScreen');
  const icon = document.getElementById('answeredIcon');
  const sub = document.getElementById('answeredSub');
  if (data.correct) {
    icon.textContent = '✓';
    icon.className = 'answered-icon correct';
    sub.textContent = `+${data.points} điểm! Đang chờ kết quả cuối cùng...`;
  } else {
    icon.textContent = '✗';
    icon.className = 'answered-icon wrong';
    sub.textContent = 'Sai rồi! Đang chờ kết quả cuối cùng...';
  }
});

// ==================== PUZZLE GAME ====================
let puzzlePieces = [];
let puzzleSelectedPiece = null;
let puzzleMoves = 0;
let puzzleGridSize = 4;
let puzzleImageCanvas = null;
let puzzleComplete = false;
let puzzleStartTime = null;

socket.on('game:puzzle', (data) => {
  showScreen('puzzleScreen');
  puzzlePieces = [];
  puzzleSelectedPiece = null;
  puzzleMoves = 0;
  puzzleComplete = false;
  puzzleGridSize = data.gridSize || 4;
  puzzleStartTime = Date.now();

  document.getElementById('pPuzzleMoves').textContent = '0 lượt';

  // Start local timer
  if (data.questionEndTime) {
    currentQuestionEndTime = data.questionEndTime;
    startPuzzleLocalTimer();
  }

  // Load puzzle image
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const canvas = document.createElement('canvas');
    const size = 600;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const s = Math.min(img.width, img.height);
    const sx = (img.width - s) / 2;
    const sy = (img.height - s) / 2;
    ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
    puzzleImageCanvas = canvas;
    initPuzzleBoard();
  };
  img.onerror = () => {
    // Generate demo image if load fails
    puzzleImageCanvas = generatePuzzleDemoImage(600);
    initPuzzleBoard();
  };
  img.src = data.image;
});

function generatePuzzleDemoImage(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#1565C0');
  gradient.addColorStop(0.5, '#E53935');
  gradient.addColorStop(1, '#2E7D32');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'white';
  ctx.font = `bold ${size * 0.1}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('QUIZ GAME', size / 2, size / 2);
  return canvas;
}

function initPuzzleBoard() {
  puzzlePieces = [];
  for (let i = 0; i < puzzleGridSize * puzzleGridSize; i++) {
    puzzlePieces.push({ id: i, currentPos: i, correctPos: i });
  }
  // Shuffle
  for (let i = puzzlePieces.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = puzzlePieces[i].currentPos;
    puzzlePieces[i].currentPos = puzzlePieces[j].currentPos;
    puzzlePieces[j].currentPos = temp;
  }
  renderPuzzleBoard();
}

function renderPuzzleBoard() {
  const board = document.getElementById('pPuzzleBoard');
  board.style.gridTemplateColumns = `repeat(${puzzleGridSize}, 1fr)`;

  const sorted = [...puzzlePieces].sort((a, b) => a.currentPos - b.currentPos);
  const imgUrl = puzzleImageCanvas.toDataURL();

  board.innerHTML = sorted.map(piece => {
    const correctRow = Math.floor(piece.correctPos / puzzleGridSize);
    const correctCol = piece.correctPos % puzzleGridSize;
    const isCorrect = piece.currentPos === piece.correctPos;
    const isSelected = puzzleSelectedPiece === piece.id;

    return `
      <div class="puzzle-piece ${isCorrect ? 'correct' : ''} ${isSelected ? 'selected' : ''}"
           onclick="clickPuzzlePiece(${piece.id})"
           style="background-image: url(${imgUrl});
                  background-size: ${puzzleGridSize * 100}%;
                  background-position: ${correctCol * (100 / (puzzleGridSize - 1))}% ${correctRow * (100 / (puzzleGridSize - 1))}%;">
      </div>
    `;
  }).join('');
}

function clickPuzzlePiece(pieceId) {
  if (puzzleComplete) return;

  if (puzzleSelectedPiece === null) {
    puzzleSelectedPiece = pieceId;
    renderPuzzleBoard();
  } else if (puzzleSelectedPiece === pieceId) {
    puzzleSelectedPiece = null;
    renderPuzzleBoard();
  } else {
    const piece1 = puzzlePieces.find(p => p.id === puzzleSelectedPiece);
    const piece2 = puzzlePieces.find(p => p.id === pieceId);
    const tempPos = piece1.currentPos;
    piece1.currentPos = piece2.currentPos;
    piece2.currentPos = tempPos;
    puzzleMoves++;
    document.getElementById('pPuzzleMoves').textContent = `${puzzleMoves} lượt`;
    puzzleSelectedPiece = null;
    renderPuzzleBoard();
    sfxClick();

    // Check if complete
    if (puzzlePieces.every(p => p.currentPos === p.correctPos)) {
      puzzleComplete = true;
      const elapsed = Math.floor((Date.now() - puzzleStartTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;

      sfxCorrect();
      socket.emit('puzzle:complete', { moves: puzzleMoves, time: elapsed });

      document.getElementById('puzzleCompleteTime').textContent =
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      document.getElementById('puzzleCompleteMoves').textContent = `${puzzleMoves} lượt đổi`;
      showScreen('puzzleCompleteScreen');
    }
  }
}

function startPuzzleLocalTimer() {
  stopLocalTimer();
  tickPuzzleTimer();
}

function tickPuzzleTimer() {
  const serverNow = getServerTime();
  const remaining = Math.ceil((currentQuestionEndTime - serverNow) / 1000);
  const clamped = Math.max(0, remaining);

  const timer = document.getElementById('pPuzzleTimer');
  if (timer) {
    timer.textContent = clamped;
    if (clamped <= 10) timer.className = 'player-timer warning';
    if (clamped <= 5) timer.className = 'player-timer danger';
  }

  if (clamped > 0 && !puzzleComplete) {
    localTimerRAF = requestAnimationFrame(() => {
      setTimeout(tickPuzzleTimer, 200);
    });
  }
}

socket.on('puzzle:confirmed', (data) => {
  // Already showing puzzleCompleteScreen
});

socket.on('puzzle:progress', (data) => {
  // Could show progress, but player already on complete screen
});

socket.on('game:final', (data) => {
  showScreen('finalScreen');
  renderPodium(data.ranking, 'pFinalPodium');
  renderRankingList(data.ranking, 'pFinalList');
  launchConfetti();
});

socket.on('game:reset', () => {
  stopLocalTimer();
  showScreen('waitingScreen');
  hasAnswered = false;
  currentQuestion = null;
  lastPoints = 0;
});

// ==================== ACTIONS ====================

function selectOption(index) {
  if (hasAnswered) return;
  sfxClick();
  hasAnswered = true;

  document.querySelectorAll('.player-answer-btn').forEach(btn => btn.classList.add('disabled'));
  const selected = document.getElementById(`opt-${index}`);
  selected.classList.add('selected');
  selected.classList.remove('disabled');

  socket.emit('player:answer', { option: index });
}

function submitTextAnswer() {
  if (hasAnswered) return;
  const input = document.getElementById('textAnswerInput');
  const text = input.value.trim();
  if (!text) return;

  hasAnswered = true;
  input.disabled = true;

  socket.emit('player:answer', { text });
}

function submitObstacleAnswer() {
  const input = document.getElementById('pObstacleInput');
  const text = input.value.trim();
  if (!text) return;

  input.disabled = true;
  socket.emit('player:obstacleAnswer', { text });
}

// ==================== CONFETTI ====================

function launchConfetti() {
  const colors = ['#E21B3C', '#1368CE', '#D89E00', '#26890C', '#864CBF', '#FF9800'];
  for (let i = 0; i < 80; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'confetti';
      el.style.left = Math.random() * 100 + 'vw';
      el.style.background = colors[Math.floor(Math.random() * colors.length)];
      el.style.width = (Math.random() * 10 + 5) + 'px';
      el.style.height = (Math.random() * 10 + 5) + 'px';
      el.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
      el.style.animationDuration = (Math.random() * 3 + 2) + 's';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 5000);
    }, i * 30);
  }
}
