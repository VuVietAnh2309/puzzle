const socket = io();
let myName = '';
let currentQuestion = null;
let hasAnswered = false;
let lastPoints = 0;
let hasJoined = false;

const shapes = ['▲', '◆', '●', '■'];
const colorClasses = ['ans-0', 'ans-1', 'ans-2', 'ans-3'];

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
  const input = document.getElementById('playerName');
  const name = input.value.trim();
  if (!name) {
    input.style.borderColor = '#E21B3C';
    input.focus();
    return;
  }
  hasJoined = true;
  myName = name;
  socket.emit('player:join', name);
  document.getElementById('waitingName').textContent = name;
  showScreen('waitingScreen');
}

document.getElementById('playerName').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinGame();
});

// ==================== SOCKET EVENTS ====================

socket.on('game:state', (data) => {
  if (myName && data.phase === 'standby') {
    showScreen('waitingScreen');
  }
});

socket.on('connect', () => {
  console.log('Connected to server');
  // Re-join on reconnect
  if (hasJoined && myName) {
    socket.emit('player:join', myName);
  }
});

socket.on('connect_error', (err) => {
  console.error('Connection error:', err);
});

socket.on('question:show', (data) => {
  if (!myName) return;

  currentQuestion = data;
  hasAnswered = false;

  document.getElementById('pQNum').textContent = `Câu ${data.index + 1} / ${data.total}`;
  document.getElementById('pQText').textContent = data.question;

  const timer = document.getElementById('pTimer');
  timer.textContent = data.timeLeft;
  timer.className = 'player-timer';

  document.getElementById('pAnswersGrid').innerHTML = data.options.map((opt, i) => `
    <button class="player-answer-btn ${colorClasses[i]}" onclick="selectOption(${i})" id="opt-${i}">
      <div class="shape-icon">${shapes[i]}</div>
      ${opt}
    </button>
  `).join('');

  showScreen('questionScreen');
});

socket.on('timer:update', (timeLeft) => {
  const timer = document.getElementById('pTimer');
  timer.textContent = timeLeft;
  if (timeLeft <= 5) timer.className = 'player-timer danger';
  else if (timeLeft <= 10) timer.className = 'player-timer warning';
  else timer.className = 'player-timer';
});

socket.on('answer:confirmed', (data) => {
  document.getElementById('answeredSub').textContent = `Trả lời trong ${data.timeTaken}s — Đang chờ kết quả...`;
  showScreen('answeredScreen');
});

socket.on('question:result', (data) => {
  showScreen('resultScreen');

  const icon = document.getElementById('resultIcon');
  const title = document.getElementById('resultTitle');
  const points = document.getElementById('resultPoints');
  const sub = document.getElementById('resultSub');

  const correctOption = data.options[data.correct];
  const myRank = data.ranking ? data.ranking.find(r => r.name === myName) : null;
  const prevScore = myRank ? myRank.score - lastPoints : 0;

  // Determine if player got it right by checking score change
  if (myRank) {
    const earned = myRank.score - prevScore;
    lastPoints = myRank.score;

    if (earned > 0) {
      icon.className = 'answered-icon correct';
      icon.textContent = '✓';
      title.textContent = 'Chính xác!';
      points.textContent = `+${earned}`;
      points.style.color = '#26890C';
    } else {
      icon.className = 'answered-icon wrong';
      icon.textContent = '✗';
      title.textContent = 'Sai rồi!';
      points.textContent = `${shapes[data.correct]} ${correctOption}`;
      points.style.color = 'rgba(255,255,255,0.7)';
      points.style.fontSize = '1.5rem';
    }
    sub.textContent = `Tổng điểm: ${myRank.score.toLocaleString()}`;
  } else {
    icon.className = 'answered-icon neutral';
    icon.textContent = '📊';
    title.textContent = `Đáp án: ${shapes[data.correct]} ${correctOption}`;
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

socket.on('game:final', (data) => {
  showScreen('finalScreen');
  renderPodium(data.ranking, 'pFinalPodium');
  renderRankingList(data.ranking, 'pFinalList');
  launchConfetti();
});

socket.on('game:reset', () => {
  showScreen('waitingScreen');
  hasAnswered = false;
  currentQuestion = null;
  lastPoints = 0;
});

// ==================== ACTIONS ====================

function selectOption(index) {
  if (hasAnswered) return;
  hasAnswered = true;

  document.querySelectorAll('.player-answer-btn').forEach(btn => btn.classList.add('disabled'));
  const selected = document.getElementById(`opt-${index}`);
  selected.classList.add('selected');
  selected.classList.remove('disabled');

  socket.emit('player:answer', index);
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
