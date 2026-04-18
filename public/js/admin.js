const socket = io();
let currentQuestionIndex = -1;
let totalQuestions = 20;
let playerCount = 0;
let roomCode = null;
let adminToken = null;
let currentPhase = 'lobby';
let latestRanking = [];
let isTransitioningToRanking = false;
let answeredPlayers = new Set();
let previousRankingPositions = new Map();
let previousRankingScores = new Map();


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
    .catch(() => { });
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
  } catch (e) { }
}

function sfxCountdown() { playTone(880, 0.15, 'sine', 0.2); }
function sfxQuestionShow() {
  playTone(523, 0.1, 'square', 0.15);
  setTimeout(() => playTone(659, 0.1, 'square', 0.15), 100);
  setTimeout(() => playTone(784, 0.15, 'square', 0.15), 200);
}
function sfxTimeWarning() { playTone(440, 0.2, 'sawtooth', 0.1); }
function sfxWhoosh() { playTone(150, 0.4, 'brown', 0.1); }
function sfxTing() { playTone(1200, 0.1, 'sine', 0.15); }

function sfxBuzz() { playTone(220, 0.5, 'sawtooth', 0.2); }
function sfxDrumroll() {
  for (let i = 0; i < 20; i++) {
    setTimeout(() => playTone(150 + Math.random() * 50, 0.05, 'triangle', 0.1), i * 50);
  }
}
function sfxSuccess() {
  [523, 659, 784, 1047].forEach((f, i) =>
    setTimeout(() => playTone(f, 0.3, 'sine', 0.2), i * 100)
  );
}
function sfxFinal() {
  launchConfetti();
  sfxSuccess();
  setTimeout(sfxSuccess, 500);
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
  // Hide ALL screens first
  document.querySelectorAll('.screen, .screen-flex').forEach(s => {
    s.classList.remove('active');
    s.style.setProperty('display', 'none', 'important');
  });

  const target = document.getElementById(id);
  if (target) {
    target.classList.add('active');
    target.dataset.phase = currentPhase;
    // Ensure correct display type
    if (target.classList.contains('screen-flex')) {
      target.style.setProperty('display', 'flex', 'important');
    } else {
      target.style.setProperty('display', 'block', 'important');
    }
  }

  // Reset dashboard focus state
  const dash = document.querySelector('.dashboard-layout');
  if (dash) dash.classList.remove('focus-ranking');
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

function renderSidebarRanking(rankingData, forceReorder = false) {
  const containers = [
    document.getElementById('sidebarRanking'),
    document.getElementById('sidebarRankingPuzzle')
  ];

  let ranking = [];
  if (Array.isArray(rankingData)) {
    ranking = rankingData;
  } else if (rankingData && Array.isArray(rankingData.ranking)) {
    ranking = rankingData.ranking;
  }

  containers.forEach(container => {
    if (!container) return;

    if (ranking.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:2rem;color:rgba(255,255,255,0.3);font-size:1.2rem;font-weight:600;">Đang cập nhật dữ liệu...</div>`;
      return;
    }

    // Stage 1/2/3 logic: Show current answering status
    // If NOT forceReorder (Vinh danh Phase), we keep the list stable but update status
    const top8 = ranking.slice(0, 8);

    // FLIP Preparation: Record current positions if we are about to reorder
    if (forceReorder) {
      container.querySelectorAll('.sidebar-rank-item').forEach(el => {
        const id = el.dataset.playerId;
        const score = el.dataset.score;
        if (id) {
          previousRankingPositions.set(id, el.getBoundingClientRect());
          if (score) previousRankingScores.set(id, parseFloat(score));
        }
      });
    }

    container.innerHTML = top8.map((p, i) => {
      const isAnswered = answeredPlayers.has(p.id) || p.answered;
      const logoHtml = p.logo ? `<img src="${p.logo}" alt="">` : `<div style="font-size:1.2rem;font-weight:900;color:rgba(255,255,255,0.2);">${(p.name || '?').charAt(0)}</div>`;
      const score = p.score || 0;
      const streak = p.streak || 0;
      const streakHtml = streak > 2 ? `<div class="rank-streak">${streak} 🔥</div>` : '';

      return `
        <div class="sidebar-rank-item ${isAnswered ? 'is-answered' : ''}" 
             data-player-id="${p.id}" 
             data-score="${score}"
             id="rank-item-${p.id}">
          <div class="status-check">✓</div>
          <div class="sidebar-rank-num">${p.rank || (i + 1)}</div>
          <div class="sidebar-rank-logo">${logoHtml}</div>
          <div class="sidebar-rank-info">
            <span class="sidebar-rank-name">${p.name || 'Thí sinh'}</span>
            <span class="sidebar-rank-score" id="score-val-${p.id}">${(forceReorder && previousRankingScores.has(p.id) ? previousRankingScores.get(p.id) : score).toLocaleString()} PTS</span>
          </div>
          ${streakHtml}
        </div>
      `;
    }).join('');

    // FLIP Execution: Animate if positions changed
    if (forceReorder && !isTransitioningToRanking) {
      sfxWhoosh();
      requestAnimationFrame(() => {
        container.querySelectorAll('.sidebar-rank-item').forEach(el => {
          const id = el.dataset.playerId;
          const oldPos = previousRankingPositions.get(id);
          if (oldPos) {
            const newPos = el.getBoundingClientRect();
            const dy = oldPos.top - newPos.top;
            if (Math.abs(dy) > 0.5) {
              el.style.transition = 'none';
              el.style.transform = `translateY(${dy}px)`;
              // Force reflow
              el.offsetHeight;
              requestAnimationFrame(() => {
                el.style.transition = '';
                el.style.transform = '';
              });
            }
          }
        });

        // Count up scores for newly updated items
        top8.forEach(p => {
          const scoreEl = document.getElementById(`score-val-${p.id}`);
          if (scoreEl) animateScoreCount(scoreEl, p.score);
        });
      });
    }

    // Reset transition flag
    if (isTransitioningToRanking) {
      isTransitioningToRanking = false;
    }
  });
}

function animateScoreCount(el, targetScore) {
  const currentVal = parseFloat(el.textContent.replace(/[^\d.-]/g, '')) || 0;
  if (Math.abs(currentVal - targetScore) < 0.01) return;

  el.classList.add('ticking');
  const duration = 3000;
  const start = performance.now();

  function update(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 5); // easeOutQuint (fast start, very slow finish)
    const val = currentVal + (targetScore - currentVal) * eased;

    // Use toLocaleString for consistent formatting with decimals
    el.textContent = `${val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} PTS`;

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      el.textContent = `${targetScore.toLocaleString()} PTS`;
      el.classList.remove('ticking');
    }
  }
  requestAnimationFrame(update);
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
        if (outer) outer.className = 'dash-timer-box danger';
      } else if (timeLeft <= 10) {
        timer.className = 'dash-timer-val warning';
        if (outer) outer.className = 'dash-timer-box warning';
      } else {
        timer.className = 'dash-timer-val';
        if (outer) outer.className = 'dash-timer-box';
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

  // 1. Always update internal ranking state if provided in the snapshot
  if (data.ranking) {
    latestRanking = data.ranking;
  }

  // Update header titles globally
  const bTitle = document.getElementById('bannerTitle');
  const dTitle = document.getElementById('dashEventTitle');
  const rName = document.getElementById('dashRoundName');

  const eventName = data.roomName || 'CHUYỂN ĐỔI SỐ NGÀNH NGÂN HÀNG 2026';
  if (bTitle) bTitle.textContent = eventName;
  if (dTitle) dTitle.textContent = eventName;

  if (rName) {
    if (data.phase === 'puzzle') {
      rName.textContent = 'VÒNG THI XẾP HÌNH';
    } else if (data.quizData && data.quizData.title) {
      rName.textContent = data.quizData.title;
    } else {
      rName.textContent = 'VÒNG THI KIẾN THỨC';
    }
  }

  // 2. Restore to correct screen based on phase
  currentPhase = data.phase;
  currentQuestionIndex = (typeof data.questionIndex === 'number') ? data.questionIndex : 0;

  // 3. For reloads, we ALWAYS want to show the current ranking standings on the sidebar immediately
  if (latestRanking && latestRanking.length > 0) {
    renderSidebarRanking(latestRanking);
  }

  const q = data.quizData ? data.quizData.questions[currentQuestionIndex] : null;
  if (q) {
    const qCounter = document.getElementById('qCounter');
    if (qCounter) qCounter.innerHTML = `CÂU <span>${currentQuestionIndex + 1}</span> / ${totalQuestions}`;
    const qText = document.getElementById('qTextDisplay');
    if (qText) qText.textContent = q.question;

    const imgCont = document.getElementById('dashQImgContainer');
    if (imgCont) {
      if (q.image) imgCont.innerHTML = `<img src="${q.image}" class="dash-q-img">`;
      else imgCont.innerHTML = '';
    }

    const colors = ['answer-0', 'answer-1', 'answer-2', 'answer-3'];
    const shapes = ['▲', '◆', '●', '■'];
    const grid = document.getElementById('answersGrid');
    if (grid) {
      if (q.type === 'text') {
        grid.innerHTML = '<div class="dash-answer-card answer-0" style="grid-column: 1 / -1; justify-content:center;"><span>Thí sinh ghi đáp án</span></div>';
      } else {
        grid.innerHTML = q.options.map((opt, i) => `
          <div class="dash-answer-card ${colors[i]}">
            <div class="shape">${shapes[i] || ''}</div>
            <span>${opt}</span>
          </div>
        `).join('');
      }
    }
  }

  const aCounter = document.getElementById('answersCounter');
  if (aCounter) aCounter.innerHTML = `${data.answeredCount || 0} / ${playerCount} <span>ĐÃ TRẢ LỜI</span>`;

  if (data.phase === 'banner') {
    showScreen('bannerScreen');
  } else if (data.phase === 'lobby') {
    showScreen('lobbyScreen');
    loadLobbyQR();
  } else if (data.phase === 'question') {
    showScreen('questionScreen');
    // Toggle dashboard content
    document.getElementById('dashQuestionContent').style.display = 'block';
    document.getElementById('dashResultContent').style.display = 'none';
    const timerOut = document.getElementById('timerBigOuter');
    if (timerOut) timerOut.style.display = 'flex';

    if (data.questionEndTime) startLocalTimer(data.questionEndTime);
    const screen = document.getElementById('questionScreen');
    if (screen) screen.dataset.phase = 'question';
  } else if (data.phase === 'result' || data.phase === 'ranking') {
    if (data.phase === 'result') {
      showScreen('questionScreen');
      const screen = document.getElementById('questionScreen');
      if (screen) screen.dataset.phase = 'result';
      document.getElementById('dashQuestionContent').style.display = 'none';
      document.getElementById('dashResultContent').style.display = 'block';
      const timerOut = document.getElementById('timerBigOuter');
      if (timerOut) timerOut.style.display = 'none';
    } else if (data.phase === 'ranking') {
      const isLastQuestion = currentQuestionIndex >= (totalQuestions - 1);
      if (!isLastQuestion) {
        // Stay on dashboard with sidebar ranking
        showScreen('questionScreen');
        document.getElementById('dashQuestionContent').style.display = 'none';
        document.getElementById('dashResultContent').style.display = 'block';
        const dashLayout = document.querySelector('.dashboard-layout');
        if (dashLayout) {
          dashLayout.classList.add('focus-ranking');
          dashLayout.dataset.viewingRanking = "true";
          const screen = document.getElementById('questionScreen');
          if (screen) screen.dataset.phase = 'ranking';
        }
      } else {
        showScreen('rankingScreen');
      }
    }
  }

  updateNextStepButton();

  if (data.phase === 'puzzle') {
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

  // Update local ranking data if provided, but DO NOT re-render visuals here to prevent flickering
  if (data.ranking) {
    latestRanking = data.ranking;
  }

  document.getElementById('qCounter').innerHTML = `CÂU <span>${data.index + 1}</span> / ${data.total}`;
  document.getElementById('answersCounter').innerHTML = `0 / ${playerCount} <span>ĐÃ TRẢ LỜI</span>`;
  document.getElementById('qTextDisplay').textContent = data.question;

  // Start server-authoritative local timer
  answeredPlayers.clear();
  renderSidebarRanking(latestRanking, false);

  if (data.questionEndTime) {
    startLocalTimer(data.questionEndTime);
  } else {
    document.getElementById('timerBig').textContent = data.timeLimit;
    document.getElementById('timerBig').className = 'dash-timer-val';
    const outer = document.getElementById('timerBigOuter');
    if (outer) outer.className = 'dash-timer-box';
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

  // Real-time sidebar update if specific player ID is provided
  if (data.playerId) {
    answeredPlayers.add(data.playerId);
    const item = document.getElementById(`rank-item-${data.playerId}`);
    if (item) item.classList.add('is-answered');
  }
});

socket.on('player:answered', (data) => {
  if (data.id) {
    answeredPlayers.add(data.id);
    const item = document.getElementById(`rank-item-${data.id}`);
    if (item) item.classList.add('is-answered');
  }
});

socket.on('question:result', (data) => {
  sfxBuzz();
  setTimeout(sfxTing, 600); // Ting when bars start filling
  currentPhase = 'result';
  stopLocalTimer();
  showScreen('questionScreen');
  updateNextStepButton();

  const qCont = document.getElementById('dashQuestionContent');
  const rCont = document.getElementById('dashResultContent');
  if (qCont) qCont.style.display = 'none';
  if (rCont) rCont.style.display = 'block';

  const timerOut = document.getElementById('timerBigOuter');
  if (timerOut) timerOut.style.display = 'none';

  const qBar = document.getElementById('qCounter');
  const displayIdx = (typeof data.index !== 'undefined' ? data.index : currentQuestionIndex) + 1;
  if (qBar) qBar.innerHTML = `CÂU <span>${displayIdx}</span> / ${totalQuestions}`;

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
    const totalAnswered = data.totalAnswered || 1;

    document.getElementById('resultBars').innerHTML = options.map((opt, i) => {
      const count = optionCounts[i] || 0;
      const percentage = Math.round((count / totalAnswered) * 100);
      const width = count > 0 ? Math.max((count / maxCount) * 100, 8) : 0;
      const isCorrect = Array.isArray(data.correct) ? data.correct.includes(i) : i === data.correct;

      const isVertical = document.querySelector('.dashboard-layout.focus-ranking');
      const barStyle = isVertical
        ? `height: ${width || 0}%; width: 100%;`
        : `width: ${width || 0}%; height: 100%;`;

      return `
        <div class="result-bar-item ${isCorrect ? 'correct-answer' : 'wrong-answer'}">
          <div class="result-bar-color ${colorClasses[i]}">${shapes[i] || ''}</div>
          <div class="result-bar-track">
            <div class="result-bar-fill ${colorClasses[i]} ${isCorrect ? 'is-correct' : ''}"
                 style="${barStyle}">
              <span class="result-bar-count">${count}</span>
            </div>
          </div>
          <div class="result-bar-percentage">${percentage}%</div>
        </div>
      `;
    }).join('');
  }

  document.getElementById('resultStats').textContent =
    `${data.correctCount} / ${data.totalPlayers} trả lời đúng — ${data.totalAnswered} / ${data.totalPlayers} đã trả lời`;

  // Do NOT render here; wait for explicit "View Ranking" click to avoid flickering
});

socket.on('game:ranking', (data) => {
  if (data.ranking) {
    sfxDrumroll();
    latestRanking = data.ranking;
    // Perform FLIP animation and score count-up
    renderSidebarRanking(latestRanking, true);
  }

  currentPhase = 'ranking';
  const dashLayout = document.querySelector('.dashboard-layout');
  const qIdx = (typeof data.questionIndex === 'number') ? data.questionIndex : 0;
  const qTotal = (typeof data.total === 'number') ? data.total : (totalQuestions || 20);
  const isIntermediate = qIdx < qTotal - 1;

  // If we are on dashboard, ALWAYS use sidebar focus mode for intermediate
  if (isIntermediate && dashLayout) {
    dashLayout.classList.add('focus-ranking');
    dashLayout.dataset.viewingRanking = "true";
    updateNextStepButton();
    return;
  }

  // Final fallback (should only hit if isIntermediate is false)
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
    renderPodium(latestRanking, 'podium');
    renderRankingList(latestRanking, 'rankingList');
  } else {
    title.textContent = 'BẢNG ĐIỂM TẠM THỜI';
    if (podium) podium.style.display = 'none';
    if (rankingList) rankingList.style.display = 'none';
    if (board) {
      board.style.display = 'flex';
      renderStandingsBoard(latestRanking);
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
  currentPhase = 'final';
  stopLocalTimer();
  showScreen('finalScreen');

  if (data.ranking) {
    renderPodium(data.ranking, 'finalPodium');
    renderRankingList(data.ranking, 'finalRankingList');
  }

  // Add export buttons to final ranking
  const exportBtn = document.createElement('a');
  exportBtn.href = `/api/room/${roomCode}/export`;
  exportBtn.className = 'btn btn-primary';
  exportBtn.textContent = 'XUẤT BẢNG ĐIỂM (EXCEL)';
  exportBtn.style.marginTop = '20px';
  exportBtn.style.padding = '12px 30px';
  exportBtn.style.display = 'inline-block';

  const bar = document.querySelector('#finalScreen .admin-bottom-bar');
  if (bar) {
    if (!bar.querySelector('a[href*="/export"]')) {
      exportBtn.style.marginRight = '12px';
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
  const dashLayout = document.querySelector('.dashboard-layout');

  if (currentPhase === 'banner') {
    socket.emit('admin:startLobby');
  } else if (currentPhase === 'lobby') {
    startQuiz();
  } else if (currentPhase === 'question') {
    endQuestion();
  } else if (currentPhase === 'result') {
    // 1. Handle last question
    if (currentQuestionIndex >= totalQuestions - 1) {
      if (dashLayout) dashLayout.classList.remove('focus-ranking');
      showRanking();
      return;
    }

    // 2. Handle intermediate question (Toggle Sidebar)
    if (dashLayout && !dashLayout.classList.contains('focus-ranking')) {
      isTransitioningToRanking = true;
      showRanking();
      dashLayout.classList.add('focus-ranking');
      updateNextStepButton();
      return;
    }

    // 3. Second click (Continue to next question)
    if (dashLayout) dashLayout.classList.remove('focus-ranking');
    nextQuestion();
  } else if (currentPhase === 'ranking') {
    if (dashLayout) dashLayout.classList.remove('focus-ranking');
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
    document.getElementById('btnNextRank'),
    document.getElementById('btnFocusContinue')
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
      const dashLayout = document.querySelector('.dashboard-layout');
      const isFocused = dashLayout && dashLayout.classList.contains('focus-ranking');
      const isLast = currentQuestionIndex >= totalQuestions - 1;

      if (isFocused) {
        btn.textContent = '[ TIẾP TỤC ]';
        btn.style.background = 'rgba(0, 191, 255, 0.05)';
        btn.style.color = '#00bfff';
        btn.style.borderColor = '#00bfff';
      } else if (isLast) {
        btn.textContent = '[ BẢNG XẾP HẠNG CHUNG CUỘC ]';
        btn.style.background = 'rgba(0, 191, 255, 0.05)';
        btn.style.color = '#00bfff';
        btn.style.borderColor = '#00bfff';
      } else {
        btn.textContent = '[ XEM BẢNG XẾP HẠNG ]';
        btn.style.background = 'rgba(0, 191, 255, 0.05)';
        btn.style.color = '#00bfff';
        btn.style.borderColor = '#00bfff';
      }
    } else if (currentPhase === 'ranking') {
      const dashLayout = document.querySelector('.dashboard-layout');
      if (dashLayout && dashLayout.classList.contains('focus-ranking')) {
        btn.textContent = '[ TIẾP TỤC ]';
        btn.style.background = 'rgba(0, 191, 255, 0.05)';
        btn.style.color = '#00bfff';
        btn.style.borderColor = '#00bfff';
      } else if (currentQuestionIndex >= totalQuestions - 1) {
        btn.textContent = '[ VÀO VÒNG XẾP HÌNH ]';
        btn.style.background = 'rgba(0, 191, 255, 0.05)';
        btn.style.color = '#00bfff';
        btn.style.borderColor = '#00bfff';
      } else {
        btn.textContent = '[ CÂU TIẾP THEO ]';
        btn.style.background = 'rgba(0, 191, 255, 0.05)';
        btn.style.color = '#00bfff';
        btn.style.borderColor = '#00bfff';
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
