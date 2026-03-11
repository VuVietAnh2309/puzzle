const socket = io();
let currentQuestionIndex = -1;
let totalQuestions = 20;
let playerCount = 0;
let roomCode = null;
let adminToken = null;

// ==================== TIME SYNC (Bayeux/CometD-style) ====================
// NTP-like protocol: measure round-trip, calculate clock offset
let serverTimeOffset = 0; // serverTime = clientTime + offset
let syncSamples = [];
const SYNC_SAMPLE_COUNT = 5;

function performTimeSync() {
  syncSamples = [];
  doSyncPing();
}

function doSyncPing() {
  const t0 = Date.now();
  socket.emit('time:sync', t0);
}

socket.on('time:sync:reply', (data) => {
  const t1 = Date.now();
  const t0 = data.clientTimestamp;
  const serverTime = data.serverTimestamp;

  // Round-trip time
  const rtt = t1 - t0;
  // Estimated one-way latency
  const oneWay = rtt / 2;
  // Clock offset: server's time at midpoint vs our midpoint
  const offset = serverTime - (t0 + oneWay);

  syncSamples.push({ offset, rtt });

  if (syncSamples.length < SYNC_SAMPLE_COUNT) {
    // Collect more samples
    setTimeout(doSyncPing, 100);
  } else {
    // Use median offset (most robust against outliers)
    syncSamples.sort((a, b) => a.rtt - b.rtt);
    // Take the sample with lowest RTT (most accurate)
    serverTimeOffset = syncSamples[0].offset;
    console.log(`[TimeSync] offset=${serverTimeOffset}ms, bestRTT=${syncSamples[0].rtt}ms`);
  }
});

// Get estimated server time
function getServerTime() {
  return Date.now() + serverTimeOffset;
}

// ==================== AUTH ====================

// Get room code from URL
const urlParams = new URLSearchParams(window.location.search);
roomCode = urlParams.get('room');

// Try to restore token from sessionStorage
adminToken = sessionStorage.getItem(`admin_token_${roomCode}`);

if (!roomCode) {
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--kahoot-purple);">
      <div style="text-align:center;">
        <h2 style="margin-bottom:1rem;">Không tìm thấy phòng thi</h2>
        <p style="color:rgba(255,255,255,0.7);margin-bottom:2rem;">Vui lòng tạo phòng từ trang Setup</p>
        <a href="/setup" class="btn btn-white">Đi đến Setup</a>
      </div>
    </div>
  `;
} else if (adminToken) {
  // Try reconnect with saved token
  socket.emit('admin:join', { roomCode, token: adminToken });
}

// If server says auth required, show login screen
socket.on('admin:auth:required', () => {
  adminToken = null;
  sessionStorage.removeItem(`admin_token_${roomCode}`);
  showScreen('loginScreen');
});

function adminLogin() {
  const password = document.getElementById('adminPassword').value;
  if (!password) {
    document.getElementById('adminPassword').style.borderColor = '#E21B3C';
    return;
  }

  const errorEl = document.getElementById('loginError');
  errorEl.style.display = 'none';

  socket.emit('admin:auth', { password, roomCode }, (response) => {
    if (response.success) {
      adminToken = response.token;
      sessionStorage.setItem(`admin_token_${roomCode}`, adminToken);
      showScreen('lobbyScreen');

      // Start time sync after auth
      performTimeSync();

      // Load QR code
      fetch(`/api/room/${roomCode}/qr`)
        .then(r => r.json())
        .then(data => {
          if (data.qr) {
            document.getElementById('lobbyQR').innerHTML =
              `<img src="${data.qr}" alt="QR Code" style="width:150px;height:150px;border-radius:8px;">`;
          }
        })
        .catch(() => {});
    } else {
      errorEl.textContent = response.message;
      errorEl.style.display = 'block';
      document.getElementById('adminPassword').style.borderColor = '#E21B3C';
    }
  });
}

// Password enter key
document.getElementById('adminPassword').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') adminLogin();
});

// ==================== SOUND EFFECTS ====================
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioCtx();
  return audioCtx;
}

function playTone(freq, duration, type = 'sine', vol = 0.3) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = vol;
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {}
}

function sfxCountdown() { playTone(880, 0.15, 'sine', 0.2); }
function sfxQuestionShow() {
  playTone(523, 0.1, 'square', 0.15);
  setTimeout(() => playTone(659, 0.1, 'square', 0.15), 100);
  setTimeout(() => playTone(784, 0.15, 'square', 0.15), 200);
}
function sfxTimeWarning() { playTone(440, 0.2, 'sawtooth', 0.1); }
function sfxResult() { playTone(660, 0.3, 'sine', 0.2); }
function sfxFinal() {
  [523, 659, 784, 1047].forEach((f, i) =>
    setTimeout(() => playTone(f, 0.3, 'sine', 0.2), i * 150)
  );
}

// Kahoot shapes
const shapes = ['▲', '◆', '●', '■'];
const shapeNames = ['triangle', 'diamond', 'circle', 'square'];
const colorClasses = ['answer-0', 'answer-1', 'answer-2', 'answer-3'];

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

  podium.innerHTML = spots.map((p, i) => {
    if (!p) return `<div class="podium-item podium-empty"></div>`;
    return `
      <div class="podium-item">
        <div class="podium-name">${p.name}</div>
        <div class="podium-score">${p.score.toLocaleString()} điểm</div>
        <div class="podium-bar">${p.rank}</div>
      </div>
    `;
  }).join('');
}

function renderRankingList(ranking, listId) {
  const container = document.getElementById(listId);
  const rest = ranking.length > 3 ? ranking.slice(3) : [];
  container.innerHTML = rest.map((p, i) => `
    <div class="ranking-row" style="animation-delay: ${i * 0.05}s">
      <div class="rank-num">${p.rank}</div>
      <div class="rank-name">${p.name}</div>
      <div class="rank-score">${p.score.toLocaleString()}</div>
    </div>
  `).join('');
}

// ==================== SERVER-SIDE TIMER ====================
// Use server's questionEndTime + offset to calculate remaining locally
let currentQuestionEndTime = null;
let localTimerRAF = null;

function startLocalTimer(endTime) {
  currentQuestionEndTime = endTime;
  cancelAnimationFrame(localTimerRAF);
  tickLocalTimer();
}

function stopLocalTimer() {
  currentQuestionEndTime = null;
  cancelAnimationFrame(localTimerRAF);
}

function tickLocalTimer() {
  if (!currentQuestionEndTime) return;

  const serverNow = getServerTime();
  const remaining = Math.ceil((currentQuestionEndTime - serverNow) / 1000);
  const timeLeft = Math.max(remaining, 0);

  // Update all visible timer elements
  const timerIds = ['timerBig', 'puzzleTimer'];
  for (const id of timerIds) {
    const timer = document.getElementById(id);
    if (timer) {
      timer.textContent = timeLeft;
      if (timeLeft <= 5) {
        timer.className = 'question-timer-big danger';
      } else if (timeLeft <= 10) {
        timer.className = 'question-timer-big warning';
      } else {
        timer.className = 'question-timer-big';
      }
    }
  }

  if (timeLeft > 0) {
    localTimerRAF = requestAnimationFrame(() => {
      setTimeout(tickLocalTimer, 200); // Update 5x/sec for smooth display
    });
  }
}

// ==================== SOCKET EVENTS ====================

socket.on('connect', () => {
  // Perform time sync on every connect/reconnect
  performTimeSync();

  // Re-auth on reconnect
  if (adminToken && roomCode) {
    socket.emit('admin:join', { roomCode, token: adminToken });
  }
});

socket.on('game:state', (data) => {
  totalQuestions = data.totalQuestions;
  playerCount = data.playerCount || 0;

  const countBig = document.getElementById('playerCountBig');
  if (countBig) countBig.textContent = playerCount;
  if (data.players) renderPlayersCloud(data.players);

  // Update lobby pin
  if (roomCode) {
    const pin = document.getElementById('lobbyPin');
    if (pin) pin.textContent = roomCode;
  }

  // Restore to correct screen based on phase
  if (data.phase === 'lobby') showScreen('lobbyScreen');

  // If question in progress, start local timer
  if (data.questionEndTime && (data.phase === 'question' || data.phase === 'obstacle')) {
    startLocalTimer(data.questionEndTime);
  }
});

socket.on('players:update', (data) => {
  playerCount = data.count;
  const countBig = document.getElementById('playerCountBig');
  if (countBig) countBig.textContent = data.count;
  renderPlayersCloud(data.list);
});

function renderPlayersCloud(list) {
  const cloud = document.getElementById('playersCloud');
  if (cloud) {
    cloud.innerHTML = list.map((name, i) =>
      `<div class="player-tag" style="animation-delay: ${i * 0.05}s">${name}</div>`
    ).join('');
  }
}

socket.on('game:countdown', (data) => {
  totalQuestions = data.total;
  currentQuestionIndex = data.questionIndex;
  stopLocalTimer();
  showScreen('questionScreen');

  document.getElementById('qCounter').textContent = `Câu ${data.questionIndex + 1} / ${data.total}`;
  document.getElementById('answersCounter').textContent = `0 / ${playerCount} đã trả lời`;
  document.getElementById('timerBig').textContent = data.duration;
  document.getElementById('timerBig').className = 'question-timer-big';
  document.getElementById('qTextDisplay').textContent = 'Chuẩn bị...';
  document.getElementById('answersGrid').innerHTML = '';

  // Server-authoritative countdown using countdownEndTime
  sfxCountdown();
  const countdownTick = setInterval(() => {
    const serverNow = getServerTime();
    const remaining = Math.ceil((data.countdownEndTime - serverNow) / 1000);
    const display = Math.max(remaining, 0);
    sfxCountdown();
    document.getElementById('timerBig').textContent = display;
    if (display <= 0) clearInterval(countdownTick);
  }, 1000);
});

socket.on('question:show', (data) => {
  sfxQuestionShow();
  currentQuestionIndex = data.index;
  showScreen('questionScreen');

  document.getElementById('qCounter').textContent = `Câu ${data.index + 1} / ${data.total}`;
  document.getElementById('answersCounter').textContent = `0 / ${playerCount} đã trả lời`;
  document.getElementById('qTextDisplay').textContent = data.question;

  // Start server-authoritative local timer
  if (data.questionEndTime) {
    startLocalTimer(data.questionEndTime);
  } else {
    document.getElementById('timerBig').textContent = data.timeLimit;
    document.getElementById('timerBig').className = 'question-timer-big';
  }

  // Show question image if available
  if (data.image) {
    document.getElementById('qTextDisplay').innerHTML =
      `<img src="${data.image}" style="max-height:120px;border-radius:8px;margin-bottom:12px;display:block;margin:0 auto 12px;"><span>${data.question}</span>`;
  }

  if (data.type === 'text') {
    document.getElementById('answersGrid').innerHTML = `
      <div class="answer-block answer-0" style="grid-column: 1 / -1; text-align:center; justify-content:center;">
        <span>Thí sinh ghi đáp án</span>
      </div>
    `;
  } else {
    document.getElementById('answersGrid').innerHTML = data.options.map((opt, i) => `
      <div class="answer-block ${colorClasses[i]}">
        <div class="shape">${shapes[i] || ''}</div>
        <span>${opt}</span>
      </div>
    `).join('');
  }
});

// Server-side timer correction: update local endTime if server says different
socket.on('timer:update', (data) => {
  // data is now {timeLeft, serverTimestamp, questionEndTime}
  const timeLeft = typeof data === 'number' ? data : data.timeLeft;

  if (data.questionEndTime) {
    currentQuestionEndTime = data.questionEndTime;
  }

  // Sound effects based on server time
  if (timeLeft <= 5) sfxTimeWarning();

  // Also update obstacle timer
  const obsTimer = document.getElementById('obstacleTimer');
  if (obsTimer && document.getElementById('obstacleScreen').classList.contains('active')) {
    obsTimer.textContent = timeLeft;
    if (timeLeft <= 5) obsTimer.className = 'question-timer-big danger';
    else if (timeLeft <= 10) obsTimer.className = 'question-timer-big warning';
    else obsTimer.className = 'question-timer-big';
  }
});

socket.on('answers:update', (data) => {
  document.getElementById('answersCounter').textContent = `${data.answered} / ${data.total} đã trả lời`;
  if (data.monitor) renderMonitor(data.monitor);
});

socket.on('question:result', (data) => {
  sfxResult();
  stopLocalTimer();
  showScreen('resultScreen');

  document.getElementById('resultQuestionBar').textContent = `Câu ${currentQuestionIndex + 1} / ${totalQuestions}`;

  if (data.type === 'text') {
    const correctAns = Array.isArray(data.correct) ? data.correct[0] : data.correct;
    document.getElementById('resultCorrectText').textContent = `Đáp án: ${correctAns}`;
    document.getElementById('resultBars').innerHTML = `
      <div style="text-align:center;padding:1rem;color:rgba(255,255,255,0.7);font-weight:600;">
        ${data.correctCount} / ${data.totalPlayers} trả lời đúng
      </div>
    `;
  } else {
    const correctIdx = Array.isArray(data.correct) ? data.correct[0] : data.correct;
    const correctOpt = data.options[correctIdx];
    document.getElementById('resultCorrectText').textContent = `${shapes[correctIdx] || '✓'} ${correctOpt}`;

    const maxCount = Math.max(...data.optionCounts, 1);
    document.getElementById('resultBars').innerHTML = data.options.map((opt, i) => {
      const width = data.optionCounts[i] > 0 ? Math.max((data.optionCounts[i] / maxCount) * 100, 8) : 0;
      const isCorrect = Array.isArray(data.correct) ? data.correct.includes(i) : i === data.correct;
      return `
        <div class="result-bar-item">
          <div class="result-bar-color ${colorClasses[i]}">${shapes[i] || ''}</div>
          <div class="result-bar-track">
            <div class="result-bar-fill ${colorClasses[i]} ${isCorrect ? 'is-correct' : ''}"
                 style="width: ${width}%">${data.optionCounts[i]}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  document.getElementById('resultStats').textContent =
    `${data.correctCount} / ${data.totalPlayers} trả lời đúng — ${data.totalAnswered} / ${data.totalPlayers} đã trả lời`;
});

socket.on('game:ranking', (data) => {
  stopLocalTimer();
  showScreen('rankingScreen');
  document.getElementById('rankingTitle').textContent = 'Bảng xếp hạng';
  document.getElementById('rankingSub').textContent = `Sau câu ${data.questionIndex + 1} / ${data.total}`;
  renderPodium(data.ranking, 'podium');
  renderRankingList(data.ranking, 'rankingList');
});

socket.on('game:obstacle', (data) => {
  showScreen('obstacleScreen');
  document.getElementById('obstacleQuestion').textContent = data.question;
  document.getElementById('obstacleTimer').textContent = data.timeLimit;
  document.getElementById('obstaclePoints').textContent = `${data.points} điểm`;

  // Start authoritative timer for obstacle
  if (data.questionEndTime) {
    startLocalTimer(data.questionEndTime);
  }

  const hintsContainer = document.getElementById('obstacleHints');
  hintsContainer.innerHTML = data.hints.map(h => `
    <div class="obstacle-hint-card">${h.hint}</div>
  `).join('');

  const blanks = document.getElementById('obstacleBlanks');
  blanks.innerHTML = Array.from({ length: data.answerLength }, () =>
    '<div class="obstacle-blank">_</div>'
  ).join('');

  document.getElementById('obstacleAnswerCount').textContent = `0 / ${playerCount} đã trả lời`;
});

socket.on('game:puzzle', (data) => {
  showScreen('puzzleScreen');
  document.getElementById('puzzleProgress').textContent = `0 / ${playerCount} hoàn thành`;
  document.getElementById('puzzleResultsList').innerHTML = '';

  if (data.questionEndTime) {
    startLocalTimer(data.questionEndTime);
  } else {
    document.getElementById('puzzleTimer').textContent = data.timeLimit;
  }
});

socket.on('puzzle:progress', (data) => {
  document.getElementById('puzzleProgress').textContent = `${data.completed} / ${data.total} hoàn thành`;

  const sorted = [...data.results].sort((a, b) => a.time - b.time);
  document.getElementById('puzzleResultsList').innerHTML = sorted.map((r, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 14px;background:rgba(255,255,255,0.1);border-radius:6px;">
      <span style="font-weight:900;width:28px;text-align:center;">${i + 1}</span>
      <span style="flex:1;font-weight:700;">${r.name}</span>
      <span style="font-weight:600;color:rgba(255,255,255,0.7);">${r.moves} lượt</span>
      <span style="font-weight:700;">${Math.floor(r.time / 60)}:${(r.time % 60).toString().padStart(2, '0')}</span>
    </div>
  `).join('');
});

socket.on('game:final', (data) => {
  sfxFinal();
  stopLocalTimer();
  showScreen('finalScreen');
  renderPodium(data.ranking, 'finalPodium');
  renderRankingList(data.ranking, 'finalRankingList');

  if (data.roomCode) {
    const bar = document.querySelector('#finalScreen .admin-bottom-bar');
    if (!document.getElementById('exportBtn')) {
      const exportBtn = document.createElement('a');
      exportBtn.id = 'exportBtn';
      exportBtn.href = `/api/room/${data.roomCode}/export`;
      exportBtn.className = 'btn btn-primary';
      exportBtn.textContent = 'Xuất Excel';
      exportBtn.style.textDecoration = 'none';
      bar.insertBefore(exportBtn, bar.firstChild);
    }
  }

  launchConfetti();
});

socket.on('game:reset', () => {
  currentQuestionIndex = -1;
  stopLocalTimer();
  showScreen('lobbyScreen');
});

socket.on('error', (data) => {
  alert(data.message);
});

// ==================== ACTIONS ====================

function startGame() { socket.emit('admin:nextQuestion'); }
function nextQuestion() { socket.emit('admin:nextQuestion'); }
function endQuestion() { socket.emit('admin:endQuestion'); }
function showRanking() { socket.emit('admin:showRanking'); }
function endObstacle() { socket.emit('admin:endObstacle'); }
function endPuzzle() { socket.emit('admin:endPuzzle'); }

function resetGame() {
  if (confirm('Reset cuộc thi?')) socket.emit('admin:reset');
}

// ==================== PLAYER MONITOR ====================

function toggleMonitor() {
  const panel = document.getElementById('monitorPanel');
  panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
}

function renderMonitor(players) {
  const list = document.getElementById('monitorList');
  if (!list) return;
  const sorted = [...players].sort((a, b) => {
    if (a.answered !== b.answered) return a.answered ? 1 : -1;
    return b.score - a.score;
  });
  list.innerHTML = sorted.map(p => `
    <div class="monitor-item ${p.answered ? 'answered' : ''}">
      <div class="monitor-dot"></div>
      <div class="monitor-name">${p.name}</div>
      <div class="monitor-score">${p.score.toLocaleString()}</div>
    </div>
  `).join('');
}

// ==================== CONFETTI ====================

function launchConfetti() {
  const colors = ['#E21B3C', '#1368CE', '#D89E00', '#26890C', '#864CBF', '#FF9800'];
  for (let i = 0; i < 120; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'confetti';
      el.style.left = Math.random() * 100 + 'vw';
      el.style.background = colors[Math.floor(Math.random() * colors.length)];
      el.style.width = (Math.random() * 10 + 6) + 'px';
      el.style.height = (Math.random() * 10 + 6) + 'px';
      el.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
      el.style.animationDuration = (Math.random() * 3 + 2) + 's';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 5000);
    }, i * 25);
  }
}

// Periodic time re-sync every 30s
setInterval(performTimeSync, 30000);
