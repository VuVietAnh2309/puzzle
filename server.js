const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Rewrite clean URLs to .html files
app.use((req, res, next) => {
  const routes = ['admin', 'player', 'puzzle'];
  const clean = req.path.replace(/^\//, '');
  if (routes.includes(clean)) {
    req.url = `/${clean}.html`;
  }
  next();
});

app.use(express.static(path.resolve('public')));
app.use(express.json());

// ==================== DATA ====================

const questions = [
  { id: 1, question: "Quốc khánh nước Cộng hòa Xã hội Chủ nghĩa Việt Nam là ngày nào?", options: ["1/5", "2/9", "30/4", "19/8"], correct: 1 },
  { id: 2, question: "Thủ đô của Việt Nam là thành phố nào?", options: ["Hồ Chí Minh", "Đà Nẵng", "Hà Nội", "Huế"], correct: 2 },
  { id: 3, question: "Sông nào dài nhất Việt Nam?", options: ["Sông Hồng", "Sông Mê Kông", "Sông Đồng Nai", "Sông Đà"], correct: 1 },
  { id: 4, question: "Việt Nam có bao nhiêu tỉnh thành?", options: ["61", "63", "64", "62"], correct: 1 },
  { id: 5, question: "Đỉnh núi cao nhất Việt Nam là gì?", options: ["Pù Luông", "Fansipan", "Bà Đen", "Langbiang"], correct: 1 },
  { id: 6, question: "Vịnh Hạ Long thuộc tỉnh nào?", options: ["Hải Phòng", "Quảng Ninh", "Thanh Hóa", "Nghệ An"], correct: 1 },
  { id: 7, question: "Chủ tịch Hồ Chí Minh đọc Tuyên ngôn Độc lập năm nào?", options: ["1944", "1945", "1946", "1954"], correct: 1 },
  { id: 8, question: "Quốc hoa của Việt Nam là hoa gì?", options: ["Hoa Mai", "Hoa Đào", "Hoa Sen", "Hoa Lan"], correct: 2 },
  { id: 9, question: "Đồng tiền Việt Nam có đơn vị là gì?", options: ["Đô la", "Yên", "Đồng", "Won"], correct: 2 },
  { id: 10, question: "Biển Đông nằm ở phía nào của Việt Nam?", options: ["Bắc", "Nam", "Đông", "Tây"], correct: 2 },
  { id: 11, question: "Áo dài là trang phục truyền thống của nước nào?", options: ["Trung Quốc", "Nhật Bản", "Việt Nam", "Hàn Quốc"], correct: 2 },
  { id: 12, question: "Phở là món ăn truyền thống xuất phát từ miền nào?", options: ["Miền Trung", "Miền Bắc", "Miền Nam", "Tây Nguyên"], correct: 1 },
  { id: 13, question: "Hồ Gươm nằm ở thành phố nào?", options: ["Huế", "Đà Nẵng", "Hà Nội", "Hải Phòng"], correct: 2 },
  { id: 14, question: "Năm nào Việt Nam gia nhập ASEAN?", options: ["1993", "1995", "1997", "1999"], correct: 1 },
  { id: 15, question: "Đại tướng Võ Nguyên Giáp chỉ huy trận chiến nào nổi tiếng nhất?", options: ["Điện Biên Phủ", "Mậu Thân", "Hồ Chí Minh", "Đường 9"], correct: 0 },
  { id: 16, question: "Cố đô Huế thuộc tỉnh nào?", options: ["Quảng Trị", "Thừa Thiên Huế", "Quảng Nam", "Đà Nẵng"], correct: 1 },
  { id: 17, question: "Sông Hương chảy qua thành phố nào?", options: ["Hà Nội", "Đà Nẵng", "Huế", "Hội An"], correct: 2 },
  { id: 18, question: "Ngày Nhà giáo Việt Nam là ngày nào?", options: ["20/10", "20/11", "8/3", "1/6"], correct: 1 },
  { id: 19, question: "Múa rối nước là nghệ thuật truyền thống của vùng nào?", options: ["Miền Nam", "Miền Trung", "Tây Nguyên", "Miền Bắc"], correct: 3 },
  { id: 20, question: "Hang Sơn Đoòng thuộc tỉnh nào?", options: ["Quảng Bình", "Quảng Trị", "Nghệ An", "Hà Tĩnh"], correct: 0 }
];

// ==================== GAME STATE ====================

let gameState = {
  phase: 'standby', // standby, question, result, ranking, final
  currentQuestionIndex: -1,
  questionStartTime: null,
  players: {},       // { socketId: { name, score, answered, answers: [] } }
  answers: {},       // answers for current question { socketId: { option, time, correct, points } }
  timerInterval: null,
  timeLeft: 15
};

function resetGame() {
  clearInterval(gameState.timerInterval);
  gameState = {
    phase: 'standby',
    currentQuestionIndex: -1,
    questionStartTime: null,
    players: {},
    answers: {},
    timerInterval: null,
    timeLeft: 15
  };
}

function calculatePoints(timeTaken) {
  if (timeTaken <= 5) return 1000;
  if (timeTaken <= 10) return 500;
  if (timeTaken <= 15) return 200;
  return 0;
}

function getRanking() {
  return Object.values(gameState.players)
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ rank: i + 1, name: p.name, score: p.score }));
}

function getQuestionResults() {
  const answers = gameState.answers;
  const total = Object.keys(gameState.players).length;
  const question = questions[gameState.currentQuestionIndex];

  // Count per option
  const optionCounts = [0, 0, 0, 0];
  let correctCount = 0;

  Object.values(answers).forEach(a => {
    if (a.option >= 0 && a.option <= 3) optionCounts[a.option]++;
    if (a.correct) correctCount++;
  });

  return {
    question: question.question,
    options: question.options,
    correct: question.correct,
    optionCounts,
    totalAnswered: Object.keys(answers).length,
    totalPlayers: total,
    correctCount
  };
}

// ==================== SOCKET.IO ====================

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  // --- PLAYER EVENTS ---

  socket.on('player:join', (name) => {
    if (gameState.players[socket.id]) return; // already joined
    const safeName = String(name).slice(0, 30).replace(/[<>]/g, '');
    gameState.players[socket.id] = {
      name: safeName,
      score: 0,
      answered: false,
      answers: []
    };
    socket.join('players');

    // Send current state to player
    socket.emit('game:state', {
      phase: gameState.phase,
      timeLeft: gameState.timeLeft,
      questionIndex: gameState.currentQuestionIndex,
      totalQuestions: questions.length
    });

    if (gameState.phase === 'question') {
      const q = questions[gameState.currentQuestionIndex];
      socket.emit('question:show', {
        id: q.id,
        question: q.question,
        options: q.options,
        index: gameState.currentQuestionIndex,
        total: questions.length,
        timeLeft: gameState.timeLeft
      });
    }

    // Notify admin
    io.to('admins').emit('players:update', {
      count: Object.keys(gameState.players).length,
      list: Object.values(gameState.players).map(p => p.name)
    });

    console.log(`Player joined: ${safeName}`);
  });

  socket.on('player:answer', (optionIndex) => {
    if (gameState.phase !== 'question') return;
    if (!gameState.players[socket.id]) return;
    if (gameState.answers[socket.id]) return; // already answered

    const timeTaken = (Date.now() - gameState.questionStartTime) / 1000;
    if (timeTaken > 15) return; // too late

    const question = questions[gameState.currentQuestionIndex];
    const isCorrect = optionIndex === question.correct;
    const points = isCorrect ? calculatePoints(timeTaken) : 0;

    gameState.answers[socket.id] = {
      option: optionIndex,
      time: timeTaken,
      correct: isCorrect,
      points: points
    };

    gameState.players[socket.id].score += points;
    gameState.players[socket.id].answered = true;

    // Confirm to player
    socket.emit('answer:confirmed', {
      selected: optionIndex,
      timeTaken: Math.round(timeTaken * 10) / 10
    });

    // Update admin with answer count
    io.to('admins').emit('answers:update', {
      answered: Object.keys(gameState.answers).length,
      total: Object.keys(gameState.players).length
    });
  });

  // --- ADMIN EVENTS ---

  socket.on('admin:join', () => {
    socket.join('admins');
    socket.emit('game:state', {
      phase: gameState.phase,
      questionIndex: gameState.currentQuestionIndex,
      totalQuestions: questions.length,
      playerCount: Object.keys(gameState.players).length,
      players: Object.values(gameState.players).map(p => p.name)
    });
  });

  socket.on('admin:startQuestion', () => {
    gameState.currentQuestionIndex++;
    if (gameState.currentQuestionIndex >= questions.length) {
      // Final ranking
      gameState.phase = 'final';
      const ranking = getRanking();
      io.emit('game:final', { ranking });
      return;
    }

    gameState.phase = 'question';
    gameState.questionStartTime = Date.now();
    gameState.answers = {};
    gameState.timeLeft = 15;

    // Reset answered status
    Object.values(gameState.players).forEach(p => p.answered = false);

    const q = questions[gameState.currentQuestionIndex];
    const questionData = {
      id: q.id,
      question: q.question,
      options: q.options,
      index: gameState.currentQuestionIndex,
      total: questions.length,
      timeLeft: 15
    };

    io.emit('question:show', questionData);

    // Start timer
    clearInterval(gameState.timerInterval);
    gameState.timerInterval = setInterval(() => {
      gameState.timeLeft--;
      io.emit('timer:update', gameState.timeLeft);

      if (gameState.timeLeft <= 0) {
        clearInterval(gameState.timerInterval);
        // Show results
        gameState.phase = 'result';
        const results = getQuestionResults();
        const ranking = getRanking();
        io.emit('question:result', { ...results, ranking: ranking.slice(0, 10) });
      }
    }, 1000);
  });

  socket.on('admin:showRanking', () => {
    gameState.phase = 'ranking';
    const ranking = getRanking();
    io.emit('game:ranking', { ranking, questionIndex: gameState.currentQuestionIndex, total: questions.length });
  });

  socket.on('admin:reset', () => {
    resetGame();
    io.emit('game:reset');
  });

  socket.on('admin:endQuestion', () => {
    clearInterval(gameState.timerInterval);
    gameState.phase = 'result';
    const results = getQuestionResults();
    const ranking = getRanking();
    io.emit('question:result', { ...results, ranking: ranking.slice(0, 10) });
  });

  // --- DISCONNECT ---
  socket.on('disconnect', () => {
    if (gameState.players[socket.id]) {
      console.log(`Player left: ${gameState.players[socket.id].name}`);
      delete gameState.players[socket.id];
      io.to('admins').emit('players:update', {
        count: Object.keys(gameState.players).length,
        list: Object.values(gameState.players).map(p => p.name)
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║     🏆 QUIZ GAME SERVER STARTED 🏆      ║
╠══════════════════════════════════════════╣
║  Home:    http://localhost:${PORT}           ║
║  Admin:   http://localhost:${PORT}/admin     ║
║  Player:  http://localhost:${PORT}/player    ║
║  Puzzle:  http://localhost:${PORT}/puzzle    ║
╚══════════════════════════════════════════╝
  `);
});
