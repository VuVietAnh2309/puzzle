const socket = io();
let currentQuestionIndex = -1;
let totalQuestions = 20;
let playerCount = 0;
let roomCode = null;
let adminToken = null;
let currentPhase = 'lobby';
let latestRanking = [];


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
const urlToken = urlParams.get('token');

// If token provided in URL, save to sessionStorage for this tab
if (urlToken) {
  sessionStorage.setItem('adminToken', urlToken);
}

// Try to restore token from sessionStorage (tab-specific or saved above)
adminToken = sessionStorage.getItem('adminToken');

if (!roomCode) {
  showRoomNotFound();
} else if (adminToken) {
  // Try reconnect with saved token
  socket.emit('admin:join', { roomCode, token: adminToken });
} else {
  // No token, redirect to home login
  window.location.href = '/';
}

// If server says auth required, redirect to login
socket.on('admin:auth:required', () => {
  // Token is invalid/expired — clear it and redirect to login
  sessionStorage.removeItem('adminToken');
  window.location.href = '/';
});

socket.on('error', (data) => {
  if (data.message === 'Phòng không tồn tại') {
    showRoomNotFound();
  } else {
    console.error('Socket error:', data.message);
  }
});

// Removed deprecated local login logic

function loadLobbyQR() {
  if (!roomCode) return;
  fetch(`/api/room/${roomCode}/qr`)
    .then(r => r.json())
    .then(data => {
      const qrEl = document.getElementById('lobbyQR');
      const domainEl = document.getElementById('lobbyDomain');
      if (domainEl) domainEl.textContent = window.location.host + '/player';
      
      if (!qrEl) return;
      if (data.qr) {
        qrEl.innerHTML = `<img src="${data.qr}" alt="QR Code">`;
      }
    })
    .catch(() => {});
}

// Logout
function adminLogout() {
  socket.emit('admin:logout', { token: adminToken, roomCode });
  // Keep adminToken in sessionStorage so setup page can reuse it for other rooms
  window.location.href = '/setup';
}

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

function showRoomNotFound() {
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--kahoot-purple);font-family:'Montserrat',sans-serif;color:white;">
      <div style="text-align:center;background:rgba(255,255,255,0.1);padding:3rem;border-radius:24px;backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.2);box-shadow:0 25px 50px rgba(0,0,0,0.3);max-width:400px;width:90%;">
        <div style="font-size:3rem;margin-bottom:1rem;">⏳</div>
        <h2 style="margin-bottom:0.5rem;font-weight:900;letter-spacing:1px;">Phòng đã hết hạn</h2>
        <p style="color:rgba(255,255,255,0.8);margin-bottom:1rem;font-weight:600;line-height:1.5;">Đang chuyển về trang quản lý...</p>
        <div style="width:60%;height:4px;background:rgba(255,255,255,0.15);border-radius:4px;margin:0 auto;overflow:hidden;">
          <div style="width:100%;height:100%;background:white;border-radius:4px;animation:redirectBar 2s linear forwards;"></div>
        </div>
      </div>
    </div>
    <style>@keyframes redirectBar{from{width:100%}to{width:0%}}</style>
  `;
  setTimeout(() => { window.location.href = '/setup'; }, 2000);
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

function renderStandingsBoard(ranking) {
  const board = document.getElementById('standingsBoard');
  if (!board) return;

  const tags = ['Top Scholar', 'Expert Analyst', 'Rising Star'];

  board.innerHTML = ranking.slice(0, 5).map((p, i) => {
    const tag = tags[i] || 'Steady Progress';
    const logoHtml = p.logo ? `<img src="${p.logo}" alt="">` : '';
    return `
      <div class="standings-row" style="animation-delay: ${i * 0.1}s">
        <div class="standings-rank">${p.rank}</div>
        <div class="standings-avatar">${logoHtml}</div>
        <div class="standings-info">
          <span class="standings-name">${p.name}</span>
          <span class="standings-tag">${tag}</span>
        </div>
        <div class="standings-score-box">
          <span class="standings-score">${p.score.toLocaleString()}</span>
          <span class="standings-score-label">POINTS</span>
        </div>
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

function renderSidebarRanking(ranking) {
  const containers = [
    document.getElementById('sidebarRanking'),
    document.getElementById('sidebarRankingPuzzle')
  ];

  containers.forEach(container => {
    if (!container) return;
    
    // Show top 8 teams in sidebar
    container.innerHTML = ranking.slice(0, 8).map((p, i) => {
      const logoHtml = p.logo ? `<img src="${p.logo}" alt="">` : `<div style="font-size:1.2rem;font-weight:900;color:rgba(255,255,255,0.2);">${p.name.charAt(0)}</div>`;
      return `
        <div class="sidebar-rank-item" style="animation-delay: ${i * 0.05}s">
          <div class="sidebar-rank-num">${p.rank}</div>
          <div class="sidebar-rank-logo">${logoHtml}</div>
          <div class="sidebar-rank-info">
            <span class="sidebar-rank-name">${p.name}</span>
            <span class="sidebar-rank-score">${p.score.toLocaleString()} PTS</span>
          </div>
        </div>
      `;
    }).join('');
  });
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
      const outerId = id === 'timerBig' ? 'timerBigOuter' : 'puzzleTimerOuter';
      const outer = document.getElementById(outerId);
      if (timeLeft <= 5) {
        timer.className = 'dash-timer-val danger';
        if (outer) outer.className = 'dash-timer-circle danger';
      } else if (timeLeft <= 10) {
        timer.className = 'dash-timer-val warning';
        if (outer) outer.className = 'dash-timer-circle warning';
      } else {
        timer.className = 'dash-timer-val';
        if (outer) outer.className = 'dash-timer-circle';
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
  currentPhase = data.phase;
  currentQuestionIndex = data.questionIndex || 0;
  
  if (data.phase === 'banner') {
    showScreen('bannerScreen');
    const bTitle = document.getElementById('bannerTitle');
    const dTitle = document.getElementById('dashEventTitle');
    const rName = document.getElementById('dashRoundName');
    if (data.roomName) {
      if (bTitle) bTitle.textContent = data.roomName;
      if (dTitle) dTitle.textContent = data.roomName;
    } else if (data.quizData && data.quizData.title) {
      if (bTitle) bTitle.textContent = data.quizData.title;
      if (dTitle) dTitle.textContent = data.quizData.title;
    }
    if (rName) {
      if (data.phase === 'question') rName.textContent = 'VÒNG THI KIẾN THỨC';
      else if (data.phase === 'puzzle') rName.textContent = 'VÒNG THI XẾP HÌNH';
      else if (data.phase === 'result') rName.textContent = 'PHẢN HỒI ĐÁP ÁN';
      else if (data.phase === 'ranking') rName.textContent = 'BẢNG XẾP HẠNG';
    }
  } else if (data.phase === 'lobby') {
    showScreen('lobbyScreen');
    loadLobbyQR();
  } else if (data.phase === 'question') {
    showScreen('questionScreen');
    if (data.ranking) {
      latestRanking = data.ranking;
      renderSidebarRanking(latestRanking);
    }
    const q = data.quizData.questions[currentQuestionIndex];
    if (q) {
      document.getElementById('qCounter').innerHTML = `CÂU <span>${currentQuestionIndex + 1}</span> / ${totalQuestions}`;
      document.getElementById('qTextDisplay').textContent = q.question;
      const imgCont = document.getElementById('dashQImgContainer');
      if (q.image) {
        if (imgCont) imgCont.innerHTML = `<img src="${q.image}" class="dash-q-img">`;
      } else {
        if (imgCont) imgCont.innerHTML = '';
      }
      
      if (q.type === 'text') {
        document.getElementById('answersGrid').innerHTML = '<div class="dash-answer-card answer-0" style="grid-column: 1 / -1; justify-content:center;"><span>Thí sinh ghi đáp án</span></div>';
      } else {
        document.getElementById('answersGrid').innerHTML = q.options.map((opt, i) => `
          <div class="dash-answer-card ${colorClasses[i]}">
            <div class="shape">${shapes[i] || ''}</div>
            <span>${opt}</span>
          </div>
        `).join('');
      }
    }
    const aCounter = document.getElementById('answersCounter');
    if (aCounter) aCounter.innerHTML = `${data.answeredCount || 0} / ${playerCount} <span>ĐÃ TRẢ LỜI</span>`;

    // Toggle dashboard content
    document.getElementById('dashQuestionContent').style.display = 'block';
    document.getElementById('dashResultContent').style.display = 'none';
    const timerOut = document.getElementById('timerBigOuter');
    if (timerOut) timerOut.style.display = 'flex';

    if (data.questionEndTime) startLocalTimer(data.questionEndTime);
  } else if (data.phase === 'result' || data.phase === 'ranking') {
    if (data.ranking) latestRanking = data.ranking;
    if (data.phase === 'result') {
      showScreen('questionScreen');
      if (rName) rName.textContent = 'PHẢN HỒI ĐÁP ÁN';
      document.getElementById('dashQuestionContent').style.display = 'none';
      document.getElementById('dashResultContent').style.display = 'block';
      const timerOut = document.getElementById('timerBigOuter');
      if (timerOut) timerOut.style.display = 'none';
      // Ideally trigger populating results here if quizData/history available
    } else {
      showScreen('rankingScreen');
    }
  } else if (data.phase === 'puzzle') {
    if (data.ranking) {
      latestRanking = data.ranking;
      renderSidebarRanking(latestRanking);
    }
    showScreen('puzzleScreen');
    if (data.questionEndTime) startLocalTimer(data.questionEndTime);
  } else if (data.phase === 'final') {
    showScreen('finalScreen');
  }
  updateNextStepButton();
});

socket.on('players:update', (data) => {
  playerCount = data.count;
  const countBig = document.getElementById('playerCountBig');
  if (countBig) countBig.textContent = data.count;
  renderPlayersCloud(data.list);
});

function renderPlayersCloud(list) {
  const cloud = document.getElementById('playersCloud');
  const waitingText = document.getElementById('lobbyWaitingText');

  if (waitingText) {
    if (list && list.length > 0) {
      waitingText.classList.add('hidden');
    } else {
      waitingText.classList.remove('hidden');
    }
  }

  if (cloud) {
    cloud.innerHTML = list.map((p, i) => {
      const name = typeof p === 'string' ? p : p.name;
      const logo = typeof p === 'object' && p.logo ? p.logo : null;
      const avatarHtml = logo
        ? `<img src="${logo}" alt="">`
        : `<div class="player-avatar-placeholder">${name.charAt(0).toUpperCase()}</div>`;
      return `<div class="player-bubble" style="animation-delay: ${i * 0.05}s">${avatarHtml}${name}</div>`;
    }).join('');
  }
  // Update operatives count text
  const countEl = document.getElementById('playerCountBig');
  if (countEl) countEl.textContent = list.length;
}

socket.on('game:countdown', (data) => {
  currentPhase = 'countdown';
  totalQuestions = data.total;
  currentQuestionIndex = data.questionIndex;
  stopLocalTimer();
  showScreen('questionScreen');
  updateNextStepButton();

  // Integrated dashboard toggle
  const qCont = document.getElementById('dashQuestionContent');
  const rCont = document.getElementById('dashResultContent');
  if (qCont) qCont.style.display = 'block';
  if (rCont) rCont.style.display = 'none';
  const timerOut = document.getElementById('timerBigOuter');
  if (timerOut) timerOut.style.display = 'flex';

  document.getElementById('qCounter').innerHTML = `CÂU <span>${data.questionIndex + 1}</span> / ${data.total}`;
  document.getElementById('answersCounter').innerHTML = `0 / ${playerCount} <span>ĐÃ TRẢ LỜI</span>`;
  document.getElementById('timerBig').textContent = data.duration;
  document.getElementById('timerBig').className = 'dash-timer-val';
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
  currentPhase = 'question';
  currentQuestionIndex = data.index;
  showScreen('questionScreen');
  updateNextStepButton();

  // Integrated dashboard toggle
  const qCont = document.getElementById('dashQuestionContent');
  const rCont = document.getElementById('dashResultContent');
  if (qCont) qCont.style.display = 'block';
  if (rCont) rCont.style.display = 'none';
  const timerOut = document.getElementById('timerBigOuter');
  if (timerOut) timerOut.style.display = 'flex';

  const rName = document.getElementById('dashRoundName');
  if (rName) rName.textContent = 'VÒNG THI KIẾN THỨC';

  // Reset side ranking if data provided
  if (data.ranking) {
    latestRanking = data.ranking;
    renderSidebarRanking(latestRanking);
  } else if (latestRanking.length > 0) {
    renderSidebarRanking(latestRanking);
  }

  document.getElementById('qCounter').innerHTML = `CÂU <span>${data.index + 1}</span> / ${data.total}`;
  document.getElementById('answersCounter').innerHTML = `0 / ${playerCount} <span>ĐÃ TRẢ LỜI</span>`;
  document.getElementById('qTextDisplay').textContent = data.question;

  // Start server-authoritative local timer
  if (data.questionEndTime) {
    startLocalTimer(data.questionEndTime);
  } else {
    document.getElementById('timerBig').textContent = data.timeLimit;
    document.getElementById('timerBig').className = 'dash-timer-val';
    const outer = document.getElementById('timerBigOuter');
    if (outer) outer.className = 'dash-timer-circle';
  }

  // Show question image if available
  const imgCont = document.getElementById('dashQImgContainer');
  if (data.image) {
    if (imgCont) imgCont.innerHTML = `<img src="${data.image}" class="dash-q-img">`;
  } else {
    if (imgCont) imgCont.innerHTML = '';
  }

  if (data.type === 'text') {
    document.getElementById('answersGrid').innerHTML = `
      <div class="dash-answer-card answer-0" style="grid-column: 1 / -1; justify-content:center;">
        <span>Thí sinh ghi đáp án</span>
      </div>
    `;
  } else {
    document.getElementById('answersGrid').innerHTML = data.options.map((opt, i) => `
      <div class="dash-answer-card ${colorClasses[i]}" style="animation-delay: ${i * 0.1}s">
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
});

socket.on('answers:update', (data) => {
  const aCounter = document.getElementById('answersCounter');
  if (aCounter) aCounter.innerHTML = `${data.answered} / ${data.total} <span>ĐÃ TRẢ LỜI</span>`;
});

socket.on('question:result', (data) => {
  sfxResult();
  currentPhase = 'result';
  stopLocalTimer();
  showScreen('questionScreen');
  updateNextStepButton();

  const rName = document.getElementById('dashRoundName');
  if (rName) rName.textContent = 'PHẢN HỒI ĐÁP ÁN';

  // Integrated dashboard toggle
  document.getElementById('dashQuestionContent').style.display = 'none';
  document.getElementById('dashResultContent').style.display = 'block';
  const timerOut = document.getElementById('timerBigOuter');
  if (timerOut) timerOut.style.display = 'none';

  const qBar = document.getElementById('qCounter');
  if (qBar) qBar.innerHTML = `CÂU <span>${currentQuestionIndex + 1}</span> / ${totalQuestions}`;

  const options = data.options || [];
  if (data.type === 'text' || options.length === 0) {
    const correctAns = Array.isArray(data.correct) ? data.correct[0] : data.correct;
    document.getElementById('resultCorrectText').textContent = `Đáp án: ${correctAns}`;
    document.getElementById('resultBars').innerHTML = `
      <div style="text-align:center;padding:1rem;color:rgba(255,255,255,0.7);font-weight:600;">
        ${data.correctCount} / ${data.totalPlayers} trả lời đúng
      </div>
    `;
  } else {
    const correctIdx = Array.isArray(data.correct) ? data.correct[0] : data.correct;
    const correctOpt = options[correctIdx] || '?';
    document.getElementById('resultCorrectText').textContent = `${shapes[correctIdx] || '✓'} ${correctOpt}`;

    const optionCounts = data.optionCounts || [];
    const maxCount = Math.max(...optionCounts, 1);
    document.getElementById('resultBars').innerHTML = options.map((opt, i) => {
      const count = optionCounts[i] || 0;
      const width = count > 0 ? Math.max((count / maxCount) * 100, 8) : 0;
      const isCorrect = Array.isArray(data.correct) ? data.correct.includes(i) : i === data.correct;
      return `
        <div class="result-bar-item ${isCorrect ? 'correct-answer' : 'wrong-answer'}">
          <div class="result-bar-color ${colorClasses[i]}">${shapes[i] || ''}</div>
          <div class="result-bar-track">
            <div class="result-bar-fill ${colorClasses[i]} ${isCorrect ? 'is-correct' : ''}"
                 style="width: ${width}%">${count}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  document.getElementById('resultStats').textContent =
    `${data.correctCount} / ${data.totalPlayers} trả lời đúng — ${data.totalAnswered} / ${data.totalPlayers} đã trả lời`;
});

socket.on('game:ranking', (data) => {
  currentPhase = 'ranking';
  if (data.ranking) latestRanking = data.ranking;
  stopLocalTimer();
  showScreen('rankingScreen');
  updateNextStepButton();
  
  const isLastQuestion = data.questionIndex >= data.total - 1;
  const board = document.getElementById('standingsBoard');
  const podium = document.getElementById('podium');
  const rankingList = document.getElementById('rankingList');
  const title = document.getElementById('rankingTitle');
  const sub = document.getElementById('rankingSub');

  sub.textContent = `Sau câu ${data.questionIndex + 1} / ${data.total}`;

  if (isLastQuestion) {
    title.textContent = 'BẢNG XẾP HẠNG CHUNG CUỘC';
    if (board) board.style.display = 'none';
    if (podium) podium.style.display = 'flex';
    if (rankingList) rankingList.style.display = 'block';
    renderPodium(data.ranking, 'podium');
    renderRankingList(data.ranking, 'rankingList');
  } else {
    title.textContent = 'BẢNG ĐIỂM TẠM THỜI';
    if (podium) podium.style.display = 'none';
    if (rankingList) rankingList.style.display = 'none';
    if (board) {
      board.style.display = 'flex';
      renderStandingsBoard(data.ranking);
    }
  }
});


socket.on('game:puzzle', (data) => {
  currentPhase = 'puzzle';
  showScreen('puzzleScreen');
  updateNextStepButton();
  document.getElementById('puzzleProgress').textContent = `0 / ${playerCount} hoàn thành`;
  document.getElementById('puzzleResultsList').innerHTML = '';

  if (data.questionEndTime) {
    startLocalTimer(data.questionEndTime);
  } else {
    document.getElementById('puzzleTimer').textContent = data.timeLimit;
  }
});

socket.on('puzzle:progress', (data) => {
  const progressEl = document.getElementById('puzzleProgress');
  if (progressEl) progressEl.innerHTML = `${data.completed} / ${data.total} <span>HOÀN THÀNH</span>`;

  const sorted = [...data.results].sort((a, b) => a.time - b.time);
  const list = document.getElementById('puzzleResultsList');
  if (list) {
    list.innerHTML = sorted.map((r, i) => `
      <div class="sidebar-rank-item" style="animation-delay: ${i * 0.05}s">
        <div class="sidebar-rank-num" style="color:#10b981;">✓</div>
        <div class="sidebar-rank-info">
          <span class="sidebar-rank-name">${r.name}</span>
          <span class="sidebar-rank-score">${r.moves} lượt - ${Math.floor(r.time / 60)}:${(r.time % 60).toString().padStart(2, '0')}</span>
        </div>
        <div style="font-weight:900; font-size: 1.2rem; color: #4dc9f6;">#${i + 1}</div>
      </div>
    `).join('');
  }
});

socket.on('game:final', (data) => {
  sfxFinal();
  currentPhase = 'final';
  stopLocalTimer();
  showScreen('finalScreen');
  updateNextStepButton();
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
  currentPhase = 'lobby';
  stopLocalTimer();
  showScreen('lobbyScreen');
  updateNextStepButton();
});



// ==================== ACTIONS ====================

// --- UPDATED NAVIGATION ---

function handleNextStep() {
  if (currentPhase === 'banner') {
    socket.emit('admin:startLobby');
  } else if (currentPhase === 'lobby') {
    startQuiz();
  } else if (currentPhase === 'question') {
    endQuestion();
  } else if (currentPhase === 'result') {
    showRanking();
  } else if (currentPhase === 'ranking') {
    // If it's the last question of quiz round, go to Puzzle
    if (currentQuestionIndex >= totalQuestions - 1) {
      startPuzzleBtn();
    } else {
      nextQuestion();
    }
  } else if (currentPhase === 'puzzle') {
    // End of puzzle -> Finish
    socket.emit('admin:endPuzzle');
  } else if (currentPhase === 'final') {
    resetGame();
  }
}

function updateNextStepButton() {
  const buttons = [
    document.getElementById('btnNextStep'),
    document.getElementById('btnNext'),
    document.getElementById('btnNextRank')
  ];
  
  buttons.forEach(btn => {
    if (!btn) return;
    
    if (currentPhase === 'lobby') {
      btn.innerHTML = 'ENTER <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>';
      btn.style.background = 'linear-gradient(135deg, #00b8d4, #00e5ff)';
    } else if (currentPhase === 'question') {
      btn.textContent = 'DỪNG CÂU HỎI';
      btn.style.background = '#ef4444';
    } else if (currentPhase === 'result') {
      btn.textContent = 'XEM BẢNG XẾP HẠNG';
      btn.style.background = '#1e90ff';
    } else if (currentPhase === 'ranking') {
      if (currentQuestionIndex >= totalQuestions - 1) {
        btn.textContent = 'VÀO VÒNG XẾP HÌNH';
        btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      } else {
        btn.textContent = 'CÂU TIẾP THEO';
        btn.style.background = '#10b981';
      }
    } else if (currentPhase === 'puzzle') {
      btn.textContent = 'XEM KẾT QUẢ CHUNG CUỘC';
      btn.style.background = 'linear-gradient(135deg, #ec4899, #be185d)';
    } else if (currentPhase === 'final') {
      btn.textContent = 'LÀM MỚI CUỘC THI';
      btn.style.background = 'rgba(255,255,255,0.1)';
    }
  });
}

function startQuiz() { socket.emit('admin:startQuiz'); }
function startPuzzleBtn() { socket.emit('admin:startPuzzleOnly'); }
function nextQuestion() { socket.emit('admin:nextQuestion'); }
function endQuestion() { socket.emit('admin:endQuestion'); }
function showRanking() { socket.emit('admin:showRanking'); }
function endPuzzle() { socket.emit('admin:endPuzzle'); }

function resetGame() {
  if (confirm('Reset cuộc thi?')) socket.emit('admin:reset');
}

// ==================== PLAYER MONITOR ====================


// ==================== CONFETTI ====================

function launchConfetti() {
  const colors = ['#00bfff', '#1368CE', '#4dc9f6', '#1e90ff', '#0d3b8f', '#3a7bd5'];
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
