const socket = io();
let currentQuestionIndex = -1;
let totalQuestions = 20;
let playerCount = 0;

socket.emit('admin:join');

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

  // Build podium: always show [2nd, 1st, 3rd] layout
  const spots = [
    ranking[1] || null,  // 2nd place (left)
    ranking[0],          // 1st place (center)
    ranking[2] || null   // 3rd place (right)
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

function renderRankingList(ranking, listId, myName) {
  const container = document.getElementById(listId);
  // Show from rank 4 onward (top 3 in podium)
  const rest = ranking.length > 3 ? ranking.slice(3) : [];
  container.innerHTML = rest.map((p, i) => `
    <div class="ranking-row ${p.name === myName ? 'is-me' : ''}" style="animation-delay: ${i * 0.05}s">
      <div class="rank-num">${p.rank}</div>
      <div class="rank-name">${p.name}</div>
      <div class="rank-score">${p.score.toLocaleString()}</div>
    </div>
  `).join('');
}

// ==================== SOCKET EVENTS ====================

socket.on('game:state', (data) => {
  totalQuestions = data.totalQuestions;
  playerCount = data.playerCount || 0;
  document.getElementById('playerCountBig').textContent = playerCount;
  if (data.players) renderPlayersCloud(data.players);
});

socket.on('players:update', (data) => {
  playerCount = data.count;
  document.getElementById('playerCountBig').textContent = data.count;
  renderPlayersCloud(data.list);
});

function renderPlayersCloud(list) {
  document.getElementById('playersCloud').innerHTML = list.map((name, i) =>
    `<div class="player-tag" style="animation-delay: ${i * 0.05}s">${name}</div>`
  ).join('');
}

socket.on('question:show', (data) => {
  currentQuestionIndex = data.index;
  showScreen('questionScreen');

  document.getElementById('qCounter').textContent = `Câu ${data.index + 1} / ${data.total}`;
  document.getElementById('answersCounter').textContent = `0 / ${playerCount} đã trả lời`;
  document.getElementById('timerBig').textContent = data.timeLeft;
  document.getElementById('timerBig').className = 'question-timer-big';
  document.getElementById('qTextDisplay').textContent = data.question;

  document.getElementById('answersGrid').innerHTML = data.options.map((opt, i) => `
    <div class="answer-block ${colorClasses[i]}">
      <div class="shape">${shapes[i]}</div>
      <span>${opt}</span>
    </div>
  `).join('');
});

socket.on('timer:update', (timeLeft) => {
  const timer = document.getElementById('timerBig');
  timer.textContent = timeLeft;
  if (timeLeft <= 5) timer.className = 'question-timer-big danger';
  else if (timeLeft <= 10) timer.className = 'question-timer-big warning';
  else timer.className = 'question-timer-big';
});

socket.on('answers:update', (data) => {
  document.getElementById('answersCounter').textContent = `${data.answered} / ${data.total} đã trả lời`;
});

socket.on('question:result', (data) => {
  showScreen('resultScreen');

  document.getElementById('resultQuestionBar').textContent = `Câu ${currentQuestionIndex + 1} / ${totalQuestions}`;

  const correctOpt = data.options[data.correct];
  document.getElementById('resultCorrectText').textContent = `${shapes[data.correct]} ${correctOpt}`;

  // Result bars
  const maxCount = Math.max(...data.optionCounts, 1);
  document.getElementById('resultBars').innerHTML = data.options.map((opt, i) => {
    const width = data.optionCounts[i] > 0 ? Math.max((data.optionCounts[i] / maxCount) * 100, 8) : 0;
    const isCorrect = i === data.correct;
    return `
      <div class="result-bar-item">
        <div class="result-bar-color ${colorClasses[i]}">${shapes[i]}</div>
        <div class="result-bar-track">
          <div class="result-bar-fill ${colorClasses[i]} ${isCorrect ? 'is-correct' : ''}"
               style="width: ${width}%">${data.optionCounts[i]}</div>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('resultStats').textContent =
    `${data.correctCount} / ${data.totalPlayers} trả lời đúng — ${data.totalAnswered} / ${data.totalPlayers} đã trả lời`;
});

socket.on('game:ranking', (data) => {
  showScreen('rankingScreen');
  document.getElementById('rankingTitle').textContent = 'Bảng xếp hạng';
  document.getElementById('rankingSub').textContent = `Sau câu ${data.questionIndex + 1} / ${data.total}`;
  renderPodium(data.ranking, 'podium');
  renderRankingList(data.ranking, 'rankingList');
});

socket.on('game:final', (data) => {
  showScreen('finalScreen');
  renderPodium(data.ranking, 'finalPodium');
  renderRankingList(data.ranking, 'finalRankingList');
  launchConfetti();
});

socket.on('game:reset', () => {
  currentQuestionIndex = -1;
  showScreen('lobbyScreen');
});

// ==================== ACTIONS ====================

function startGame() { socket.emit('admin:startQuestion'); }
function nextQuestion() { socket.emit('admin:startQuestion'); }
function endQuestion() { socket.emit('admin:endQuestion'); }
function showRanking() { socket.emit('admin:showRanking'); }

function resetGame() {
  if (confirm('Reset cuộc thi?')) socket.emit('admin:reset');
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
