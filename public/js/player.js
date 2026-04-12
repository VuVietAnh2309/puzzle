const socket = io();
let myName = '';
let myLogo = null;
let currentQuestion = null;
let hasAnswered = false;
let lastPoints = parseInt(sessionStorage.getItem('lastPoints')) || 0;
let answerStreak = parseInt(sessionStorage.getItem('answerStreak')) || 0;
let lastRankPos = parseInt(sessionStorage.getItem('lastRankPos')) || 0;
let hasJoined = false;
let roomCode = null;
let playerId = sessionStorage.getItem('playerId') || ('p' + Date.now() + Math.random().toString(36).substr(2, 5));
sessionStorage.setItem('playerId', playerId);

const shapes = ['▲', '◆', '●', '■'];
const colorClasses = ['answer-0', 'answer-1', 'answer-2', 'answer-3'];

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
  socket.emit('time:sync', Date.now());
}

socket.on('time:sync:reply', (data) => {
  const t2 = Date.now();
  const rtt = t2 - data.clientTimestamp;
  const serverTime = data.serverTimestamp;
  const offset = serverTime - (data.clientTimestamp + rtt / 2);

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
    if (clamped <= 5) timer.className = 'question-timer-big danger';
    else if (clamped <= 10) timer.className = 'question-timer-big warning';
    else timer.className = 'question-timer-big';
  }

  // Also update puzzle timer
  const puzzTimer = document.getElementById('pPuzzleTimer');
  if (puzzTimer) {
    puzzTimer.textContent = clamped;
    if (clamped <= 10) puzzTimer.style.borderColor = 'rgba(255,60,60,0.7)';
    else if (clamped <= 30) puzzTimer.style.borderColor = 'rgba(255,200,0,0.7)';
    else puzzTimer.style.borderColor = '';
  }


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
const assignedGame = urlParams.get('game');

if (assignedGame && !roomCode) {
  roomCode = 'TEST_' + Math.floor(100000 + Math.random() * 900000);
  myName = 'Người chơi thử';
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('waitingName').textContent = 'Chế độ Thử nghiệm: ' + 
      (assignedGame === 'quiz' ? 'Vòng Quiz' : 'Xếp hình');
    document.querySelectorAll('.waiting-text, .waiting-spinner').forEach(el => el.style.display = 'none');
    document.getElementById('testStartContainer').style.display = 'block';
    showScreen('waitingScreen');
  });
}

function startTestNow() {
  if (hasJoined) return;
  hasJoined = true;
  socket.emit('player:join', { roomCode, name: myName, logo: myLogo, gameType: assignedGame, playerId });
  document.getElementById('testStartContainer').style.display = 'none';
  document.querySelector('.waiting-spinner').style.display = 'block';
}

// Auto-rejoin logic
window.addEventListener('DOMContentLoaded', () => {
  const lastJoin = sessionStorage.getItem('lastJoin');
  if (lastJoin && !assignedGame) {
    const data = JSON.parse(lastJoin);
    console.log('[Rejoin] Found existing session, attempting auto-rejoin...');
    roomCode = data.roomCode;
    myName = data.name;
    myLogo = data.logo;
    hasJoined = true;
    socket.emit('player:join', { roomCode, name: myName, logo: myLogo, playerId });
  }
});

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

let isCheckingRoom = false; // Flag to prevent multiple checks

async function joinGame() {
  if (hasJoined || isCheckingRoom) return;
  const nameInput = document.getElementById('playerName');
  const name = nameInput.value.trim();
  const btn = document.querySelector('.join-btn');

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

  // Check room existence BEFORE proceeding
  console.log(`Checking room: ${code}`);
  isCheckingRoom = true;
  if (btn) btn.disabled = true;

  try {
    const rRes = await fetch(`/api/room-check/${code}`);
    if (!rRes.ok) throw new Error('Network response was not ok');
    const rData = await rRes.json();
    console.log('Room check response:', rData);
    if (!rData.exists) {
      if (codeInput) {
        codeInput.style.borderColor = '#E21B3C';
        codeInput.focus();
      }
      showNotif('Phòng thi này không tồn tại hoặc đã bị đóng!');
      isCheckingRoom = false;
      if (btn) btn.disabled = false;
      return;
    }
  } catch (e) {
    console.error('Room check failed:', e);
    showNotif('Không thể kết nối với máy chủ để kiểm tra phòng!', 'Lỗi kết nối');
    isCheckingRoom = false;
    if (btn) btn.disabled = false;
    return; // Don't proceed on error
  }

  isCheckingRoom = false;
  if (btn) btn.disabled = false;
  myName = name;
  roomCode = code;

  // Load logos and show selection screen
  loadLogos();
}

function loadLogos() {
  fetch('/api/logos')
    .then(r => r.json())
    .then(data => {
      const logos = data.logos || [];
      if (logos.length === 0) {
        // No logos available, join directly
        finishJoin();
        return;
      }
      renderLogoGrid(logos);
      showScreen('logoScreen');
    })
    .catch(() => {
      // On error, join directly
      finishJoin();
    });
}

function renderLogoGrid(logos) {
  const grid = document.getElementById('logoGrid');
  grid.innerHTML = logos.map((src, i) =>
    `<div class="logo-item" data-logo="${src}" onclick="selectLogo(this)" style="animation: fadeIn 0.3s ease ${i * 0.05}s both;">
      <img src="${src}" alt="Logo ${i + 1}">
    </div>`
  ).join('');
}

function selectLogo(el) {
  document.querySelectorAll('.logo-item').forEach(item => item.classList.remove('selected'));
  el.classList.add('selected');
  myLogo = el.dataset.logo;
  const btn = document.getElementById('btnConfirmLogo');
  btn.disabled = false;
  btn.style.opacity = '1';
}

function confirmLogo() {
  if (!myLogo) return;
  finishJoin();
}

function finishJoin() {
  if (hasJoined) return;
  hasJoined = true;
  
  // Store join data for persistence
  sessionStorage.setItem('lastJoin', JSON.stringify({ roomCode, name: myName, logo: myLogo }));
  
  socket.emit('player:join', { roomCode, name: myName, logo: myLogo, gameType: assignedGame, playerId });
  
  let waitingText = myName;
  if (assignedGame === 'quiz') waitingText += ' (Vòng Quiz)';
  else if (assignedGame === 'puzzle') waitingText += ' (Xếp hình)';
  
  document.getElementById('waitingName').textContent = waitingText;
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
  if (!myName) return;
  if (data.phase === 'lobby' || data.phase === 'banner') {
    showScreen('waitingScreen');
  } else if (data.phase === 'result') {
    // Server will re-send question:result separately for reconnect
    showScreen('resultScreen');
  } else if (data.phase === 'ranking') {
    showScreen('rankingScreen');
  } else if (data.phase === 'final') {
    showScreen('finalScreen');
  }
});

socket.on('connect', () => {
  console.log('Connected to server');
  startTimeSync();
  if (hasJoined && myName && roomCode) {
    sessionStorage.setItem('lastJoin', JSON.stringify({ roomCode, name: myName, logo: myLogo }));
    socket.emit('player:join', { roomCode, name: myName, logo: myLogo, playerId });
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
  showNotif(data.message);
});

socket.on('game:countdown', (data) => {
  if (!myName) return;
  if (assignedGame && assignedGame !== 'quiz') return;
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
  if (assignedGame && assignedGame !== 'quiz') return;

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
  timer.className = 'question-timer-big';

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
      <div class="answer-block ${colorClasses[i]}" onclick="selectOption(${i})" id="opt-${i}" style="cursor:pointer;">
        <div class="shape">${shapes[i] || ''}</div>
        <span>${opt}</span>
      </div>
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
      if (timeLeft <= 5) timer.className = 'question-timer-big danger';
      else if (timeLeft <= 10) timer.className = 'question-timer-big warning';
      else timer.className = 'question-timer-big';
    }
  }
});

socket.on('answer:confirmed', (data) => {
  document.getElementById('answeredSub').textContent = `Trả lời trong ${data.timeTaken}s — Đang chờ kết quả...`;
  // Save server-authoritative correct/incorrect for this question
  sessionStorage.setItem('lastResultCorrect', data.correct ? '1' : '0');
  sessionStorage.setItem('lastResultEarned', String(data.points || 0));
  showScreen('answeredScreen');
});

socket.on('question:result', (data) => {
  if (assignedGame && assignedGame !== 'quiz') return;
  stopLocalTimer();
  showScreen('resultScreen');

  const icon = document.getElementById('resultIcon');
  const title = document.getElementById('resultTitle');
  const pointsNum = document.getElementById('resultPointsNum');
  const sub = document.getElementById('resultSub');
  const streakEl = document.getElementById('resultStreak');
  const streakText = document.getElementById('resultStreakText');
  const rankOld = document.getElementById('resultRankOld');
  const rankNew = document.getElementById('resultRankNew');
  const rankChange = document.getElementById('resultRankChange');
  const rankBar = document.getElementById('resultRankBar');

  const myRank = data.ranking ? data.ranking.find(r => r.name === myName) : null;
  const myRankIdx = data.ranking ? data.ranking.findIndex(r => r.name === myName) : -1;
  const currentPos = myRankIdx >= 0 ? myRankIdx + 1 : 0;
  const totalPlayers = data.ranking ? data.ranking.length : 1;

  if (myRank) {
    const earned = myRank.score - lastPoints;
    const prevPos = lastRankPos || currentPos;

    // Read correct/incorrect from sessionStorage (set by answer:confirmed with server-authoritative data)
    const saved = sessionStorage.getItem('lastResultCorrect');
    const isCorrect = saved === '1';

    lastPoints = myRank.score;
    lastRankPos = currentPos;
    sessionStorage.setItem('lastPoints', lastPoints);
    sessionStorage.setItem('lastRankPos', lastRankPos);

    const pointsLabel = document.getElementById('resultPointsLabel');
    const savedEarned = parseInt(sessionStorage.getItem('lastResultEarned')) || 0;
    const displayEarned = earned !== 0 ? earned : savedEarned;

    if (isCorrect) {
      // CORRECT
      sfxCorrect();
      answerStreak = myRank.streak || 0;
      sessionStorage.setItem('answerStreak', answerStreak);
      icon.className = 'result-player-icon correct';
      icon.innerHTML = '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      title.className = 'result-player-title correct';
      title.textContent = 'CORRECT';
      pointsLabel.textContent = 'POINTS EARNED';
      pointsNum.textContent = Math.abs(displayEarned).toLocaleString();

      // Streak
      if (answerStreak >= 2) {
        streakEl.style.display = '';
        streakText.textContent = `${answerStreak} ANSWER STREAK!`;
      } else {
        streakEl.style.display = 'none';
      }
    } else {
      // WRONG
      sfxWrong();
      answerStreak = myRank.streak || 0;
      sessionStorage.setItem('answerStreak', answerStreak);
      icon.className = 'result-player-icon wrong';
      icon.innerHTML = '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      title.className = 'result-player-title wrong';
      title.textContent = 'INCORRECT';
      streakEl.style.display = 'none';
      pointsLabel.textContent = 'CORRECT ANSWER';

      if (data.type === 'text') {
        const correctAns = Array.isArray(data.correct) ? data.correct[0] : data.correct;
        pointsNum.textContent = String(correctAns);
      } else {
        const correctIdx = Array.isArray(data.correct) ? data.correct[0] : data.correct;
        const ansText = data.options && data.options[correctIdx] != null ? String(data.options[correctIdx]) : '—';
        pointsNum.textContent = ansText;
      }
    }

    // Rank progress
    rankOld.textContent = `#${prevPos}`;
    rankNew.textContent = `#${currentPos}`;
    const posDiff = prevPos - currentPos;
    if (posDiff > 0) {
      rankChange.textContent = `+${posDiff} POS`;
      rankChange.className = 'result-rank-change';
    } else if (posDiff < 0) {
      rankChange.textContent = `${posDiff} POS`;
      rankChange.className = 'result-rank-change down';
    } else {
      rankChange.textContent = '— SAME';
      rankChange.className = 'result-rank-change';
    }

    // Rank bar
    const pct = totalPlayers > 1 ? Math.round(((totalPlayers - currentPos) / (totalPlayers - 1)) * 100) : 50;
    setTimeout(() => { rankBar.style.width = pct + '%'; }, 100);

    sub.textContent = `Tổng điểm: ${myRank.score.toLocaleString()}`;
  } else {
    icon.className = 'result-player-icon neutral';
    icon.innerHTML = '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    title.className = 'result-player-title neutral';
    title.textContent = 'KẾT QUẢ';
    pointsNum.textContent = '—';
    streakEl.style.display = 'none';
    sub.textContent = '';
  }
});

socket.on('game:ranking', (data) => {
  if (assignedGame && assignedGame !== 'quiz') return;
  
  const isLastQuestion = data.questionIndex >= data.total - 1;
  // If not the last question, stay on the current screen (don't show ranking on player device)
  if (!isLastQuestion) return;

  showScreen('rankingScreen');
  document.getElementById('pRankTitle').textContent = 'BẢNG XẾP HẠNG';
  document.getElementById('pRankSub').textContent = `Kết quả sau câu ${data.questionIndex + 1}`;
  renderPodium(data.ranking, 'pPodium');
  renderRankingList(data.ranking, 'pRankingList');
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
  if (assignedGame && assignedGame !== 'puzzle') return;
  showScreen('puzzleScreen');
  puzzlePieces = [];
  puzzleSelectedPiece = null;
  puzzleMoves = 0;
  puzzleComplete = false;
  puzzleGridSize = data.gridSize || 3;
  puzzleStartTime = Date.now();
  puzzleImgDataUrl = null;

  document.getElementById('pPuzzleMoves').textContent = '0';

  // Start local timer
  if (data.questionEndTime) {
    currentQuestionEndTime = data.questionEndTime;
    startLocalTimer();
  }

  // Use player's own logo as puzzle image, fallback to server image
  const puzzleImgSrc = myLogo || data.image;
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
    puzzleImageCanvas = generatePuzzleDemoImage(600);
    initPuzzleBoard();
  };
  img.src = puzzleImgSrc;
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

let puzzleImgDataUrl = null;
let dragState = null;

function renderPuzzleBoard() {
  const board = document.getElementById('pPuzzleBoard');
  board.style.gridTemplateColumns = `repeat(${puzzleGridSize}, 1fr)`;

  const sorted = [...puzzlePieces].sort((a, b) => a.currentPos - b.currentPos);
  if (!puzzleImgDataUrl) puzzleImgDataUrl = puzzleImageCanvas.toDataURL();

  // Set preview thumbnail
  const previewImg = document.getElementById('puzzlePreviewImg');
  if (previewImg && !previewImg.src.startsWith('data:')) previewImg.src = puzzleImgDataUrl;

  board.innerHTML = sorted.map(piece => {
    const isCorrect = piece.currentPos === piece.correctPos;
    const isSelected = puzzleSelectedPiece === piece.id;
    const row = Math.floor(piece.id / puzzleGridSize);
    const col = piece.id % puzzleGridSize;

    return `
      <div class="puzzle-piece ${isCorrect ? 'correct' : ''} ${isSelected ? 'selected' : ''}"
           data-piece-id="${piece.id}"
           style="background-image:url('${puzzleImgDataUrl}');
                  background-size: ${puzzleGridSize * 100}% ${puzzleGridSize * 100}%;
                  background-position: ${puzzleGridSize > 1 ? (col / (puzzleGridSize - 1)) * 100 : 0}% ${puzzleGridSize > 1 ? (row / (puzzleGridSize - 1)) * 100 : 0}%;">
      </div>
    `;
  }).join('');

  // Attach drag events to each piece
  board.querySelectorAll('.puzzle-piece').forEach(el => {
    el.addEventListener('mousedown', onPieceDragStart);
    el.addEventListener('touchstart', onPieceDragStart, { passive: false });
  });
}

function getEventPos(e) {
  if (e.touches && e.touches.length > 0) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function onPieceDragStart(e) {
  if (puzzleComplete) return;
  e.preventDefault();
  const el = e.currentTarget;
  const pieceId = parseInt(el.dataset.pieceId);
  const pos = getEventPos(e);
  const rect = el.getBoundingClientRect();

  // Create drag clone
  const clone = el.cloneNode(true);
  clone.style.position = 'fixed';
  clone.style.width = rect.width + 'px';
  clone.style.height = rect.height + 'px';
  clone.style.left = rect.left + 'px';
  clone.style.top = rect.top + 'px';
  clone.style.zIndex = '1000';
  clone.style.pointerEvents = 'none';
  clone.style.transition = 'none';
  clone.style.filter = 'brightness(1.3) drop-shadow(0 8px 20px rgba(0,0,0,0.5))';
  clone.className = 'puzzle-piece dragging';
  document.body.appendChild(clone);

  el.style.opacity = '0.3';

  dragState = {
    pieceId,
    startX: pos.x,
    startY: pos.y,
    offsetX: pos.x - rect.left,
    offsetY: pos.y - rect.top,
    el,
    clone,
    originRect: rect
  };

  document.addEventListener('mousemove', onPieceDragMove);
  document.addEventListener('mouseup', onPieceDragEnd);
  document.addEventListener('touchmove', onPieceDragMove, { passive: false });
  document.addEventListener('touchend', onPieceDragEnd);
}

function onPieceDragMove(e) {
  if (!dragState) return;
  e.preventDefault();
  const pos = getEventPos(e);
  dragState.clone.style.left = (pos.x - dragState.offsetX) + 'px';
  dragState.clone.style.top = (pos.y - dragState.offsetY) + 'px';

  // Highlight drop target
  const board = document.getElementById('pPuzzleBoard');
  board.querySelectorAll('.puzzle-piece').forEach(p => p.classList.remove('drag-over'));
  const target = getPieceAtPoint(pos.x, pos.y);
  if (target && parseInt(target.dataset.pieceId) !== dragState.pieceId) {
    target.classList.add('drag-over');
  }
}

function onPieceDragEnd(e) {
  if (!dragState) return;
  document.removeEventListener('mousemove', onPieceDragMove);
  document.removeEventListener('mouseup', onPieceDragEnd);
  document.removeEventListener('touchmove', onPieceDragMove);
  document.removeEventListener('touchend', onPieceDragEnd);

  const pos = e.changedTouches ? { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY } : { x: e.clientX, y: e.clientY };
  const target = getPieceAtPoint(pos.x, pos.y);
  const draggedId = dragState.pieceId;

  // Clean up clone
  dragState.clone.remove();
  dragState.el.style.opacity = '';

  // Remove drag-over from all
  document.querySelectorAll('.puzzle-piece').forEach(p => p.classList.remove('drag-over'));

  const movedDistance = Math.abs(pos.x - dragState.startX) + Math.abs(pos.y - dragState.startY);

  if (target && parseInt(target.dataset.pieceId) !== draggedId && movedDistance > 10) {
    // Swap pieces via drag
    const targetId = parseInt(target.dataset.pieceId);
    swapPieces(draggedId, targetId);
  } else if (movedDistance < 10) {
    // Click behavior (tap) — select/deselect
    clickPuzzlePiece(draggedId);
  }

  dragState = null;
}

function getPieceAtPoint(x, y) {
  const board = document.getElementById('pPuzzleBoard');
  const pieces = board.querySelectorAll('.puzzle-piece');
  for (const p of pieces) {
    const r = p.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return p;
  }
  return null;
}

function swapPieces(id1, id2) {
  const piece1 = puzzlePieces.find(p => p.id === id1);
  const piece2 = puzzlePieces.find(p => p.id === id2);
  if (!piece1 || !piece2) return;

  const tempPos = piece1.currentPos;
  piece1.currentPos = piece2.currentPos;
  piece2.currentPos = tempPos;
  puzzleMoves++;
  document.getElementById('pPuzzleMoves').textContent = puzzleMoves;
  puzzleSelectedPiece = null;
  sfxClick();

  renderPuzzleBoard();

  // Swap animation on swapped elements
  const board = document.getElementById('pPuzzleBoard');
  board.querySelectorAll('.puzzle-piece').forEach(el => {
    const pid = parseInt(el.dataset.pieceId);
    if (pid === id1 || pid === id2) {
      el.classList.add('swap-anim');
      el.addEventListener('animationend', () => el.classList.remove('swap-anim'), { once: true });
    }
  });

  checkPuzzleComplete();
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
    swapPieces(puzzleSelectedPiece, pieceId);
  }
}

function checkPuzzleComplete() {
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
    if (clamped <= 10) timer.className = 'question-timer-big warning';
    if (clamped <= 5) timer.className = 'question-timer-big danger';
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
  
  if (assignedGame) {
    const replayBtn = document.getElementById('testReplayContainer');
    if (replayBtn) replayBtn.style.display = 'block';
  }
});

socket.on('game:reset', () => {
  stopLocalTimer();
  showScreen('waitingScreen');
  hasAnswered = false;
  currentQuestion = null;
  lastPoints = 0;
  answerStreak = 0;
  lastRankPos = 0;
  sessionStorage.removeItem('lastPoints');
  sessionStorage.removeItem('answerStreak');
  sessionStorage.removeItem('lastRankPos');
  sessionStorage.removeItem('lastResultCorrect');
  sessionStorage.removeItem('lastResultEarned');
});

// ==================== ACTIONS ====================

function selectOption(index) {
  if (hasAnswered) return;
  sfxClick();
  hasAnswered = true;

  document.querySelectorAll('#pAnswersGrid .answer-block').forEach(btn => {
    btn.classList.add('faded');
    btn.style.pointerEvents = 'none';
  });
  const selected = document.getElementById(`opt-${index}`);
  selected.classList.remove('faded');
  selected.classList.add('selected');

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

function showNotif(message, title = 'Thông báo') {
  const titleEl = document.getElementById('notifTitle');
  const msgEl = document.getElementById('notifMessage');
  const modal = document.getElementById('pNotification');
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (modal) modal.style.display = 'block';
}

function closeNotif() {
  const modal = document.getElementById('pNotification');
  if (modal) modal.style.display = 'none';
}
