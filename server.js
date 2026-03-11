const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const XLSX = require('xlsx');
const QRCode = require('qrcode');
const crypto = require('crypto');

const app = express();

// ==================== ADMIN AUTH ====================

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Generate session tokens for authenticated admins
const adminTokens = new Set();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function verifyAdminPassword(password) {
  return password === ADMIN_PASSWORD;
}

// HTTP Basic Auth middleware
const ADMIN_USER = process.env.ADMIN_USER || 'admin';

function basicAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Quiz Admin"');
    return res.status(401).send('Yêu cầu đăng nhập');
  }
  const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString();
  const [user, pass] = decoded.split(':');
  if (user === ADMIN_USER && pass === ADMIN_PASSWORD) {
    return next();
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Quiz Admin"');
  return res.status(401).send('Sai tài khoản hoặc mật khẩu');
}

const server = http.createServer(app);
const io = new Server(server);

// ==================== SETUP ====================

const publicDir = path.resolve('public');
const dataDir = path.resolve('data');
const uploadsDir = path.resolve('public/uploads');

// Ensure dirs exist
[dataDir, uploadsDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// File upload
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_'))
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  }
});

// Protect admin & setup pages with Basic Auth
app.use((req, res, next) => {
  const protectedPages = ['/admin', '/admin.html', '/setup', '/setup.html'];
  if (protectedPages.includes(req.path)) {
    return basicAuth(req, res, next);
  }
  next();
});

// Rewrite clean URLs
app.use((req, res, next) => {
  const routes = ['admin', 'player', 'puzzle', 'setup'];
  const clean = req.path.replace(/^\//, '');
  if (routes.includes(clean)) req.url = `/${clean}.html`;
  next();
});

app.use(express.static(publicDir));
app.use(express.json({ limit: '10mb' }));

// ==================== DATA PERSISTENCE ====================

const DATA_FILE = path.join(dataDir, 'quizdata.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) { console.error('Load data error:', e); }
  return null;
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Default quiz data
const defaultQuizData = {
  title: 'Quiz Game',
  questions: [
    { id: 1, type: 'multiple', question: "Quốc khánh nước CHXHCN Việt Nam là ngày nào?", options: ["1/5", "2/9", "30/4", "19/8"], correct: [1], timeLimit: 15, points: 1000, image: null, hint: "Mùa thu" },
    { id: 2, type: 'multiple', question: "Thủ đô của Việt Nam là thành phố nào?", options: ["Hồ Chí Minh", "Đà Nẵng", "Hà Nội", "Huế"], correct: [2], timeLimit: 15, points: 1000, image: null, hint: "Miền Bắc" },
    { id: 3, type: 'truefalse', question: "Sông Mê Kông là sông dài nhất Việt Nam?", options: ["Đúng", "Sai"], correct: [1], timeLimit: 10, points: 500, image: null, hint: null },
    { id: 4, type: 'multiple', question: "Việt Nam có bao nhiêu tỉnh thành?", options: ["61", "63", "64", "62"], correct: [1], timeLimit: 15, points: 1000, image: null, hint: "6_" },
    { id: 5, type: 'multiple', question: "Đỉnh núi cao nhất Việt Nam?", options: ["Pù Luông", "Fansipan", "Bà Đen", "Langbiang"], correct: [1], timeLimit: 15, points: 1000, image: null, hint: "Sa Pa" },
  ],
  obstacleQuestion: {
    enabled: true,
    question: "Đây là gì?",
    answer: "VIỆT NAM",
    hints: ["Mùa thu", "Miền Bắc", null, "6_", "Sa Pa"],
    timeLimit: 30,
    points: 3000
  },
  puzzle: {
    image: null,
    gridSize: 4,
    timeLimit: 120
  }
};

let quizData = loadData() || { ...defaultQuizData };

// ==================== GAME ROOMS ====================

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Active game rooms
const rooms = {};

function createRoom(quizDataOverride) {
  const code = generateRoomCode();
  rooms[code] = {
    code,
    phase: 'lobby', // lobby, countdown, question, result, ranking, obstacle, final
    quizData: quizDataOverride || quizData,
    currentQuestionIndex: -1,
    questionStartTime: null,
    players: {},
    answers: {},
    timerInterval: null,
    timeLeft: 0,
    revealedHints: [],
    gameHistory: [],
    createdAt: Date.now()
  };
  return rooms[code];
}

function getRoom(code) { return rooms[code]; }

function calculatePoints(timeTaken, timeLimit, maxPoints) {
  const ratio = 1 - (timeTaken / timeLimit);
  if (ratio <= 0) return Math.round(maxPoints * 0.1);
  return Math.round(maxPoints * (0.5 + 0.5 * ratio));
}

function getRanking(room) {
  const players = Object.values(room.players);
  players.sort((a, b) => b.score - a.score || a.lastAnswerTime - b.lastAnswerTime);
  return players.map((p, i) => ({
    rank: i + 1,
    name: p.name,
    score: p.score,
    streak: p.streak,
    correctCount: p.correctCount
  }));
}

function getQuestionResults(room) {
  const q = room.quizData.questions[room.currentQuestionIndex];
  const answers = room.answers;
  const total = Object.keys(room.players).length;
  const numOptions = q.options.length;
  const optionCounts = new Array(numOptions).fill(0);
  let correctCount = 0;

  Object.values(answers).forEach(a => {
    if (a.option >= 0 && a.option < numOptions) optionCounts[a.option]++;
    if (a.correct) correctCount++;
  });

  return {
    question: q.question,
    options: q.options,
    correct: q.correct,
    type: q.type,
    image: q.image,
    optionCounts,
    totalAnswered: Object.keys(answers).length,
    totalPlayers: total,
    correctCount
  };
}

// ==================== API ROUTES ====================

// Get quiz data for setup
app.get('/api/quiz', (req, res) => {
  res.json(quizData);
});

// Save quiz data
app.post('/api/quiz', basicAuth, (req, res) => {
  quizData = req.body;
  saveData(quizData);
  res.json({ success: true });
});

// Upload image
app.post('/api/upload', basicAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// Create room
app.post('/api/room', basicAuth, (req, res) => {
  const room = createRoom();
  res.json({ code: room.code });
});

// QR code for room
app.get('/api/room/:code/qr', async (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const host = req.headers.host || `localhost:${PORT}`;
  const protocol = req.secure ? 'https' : 'http';
  const url = `${protocol}://${host}/player?room=${room.code}`;

  try {
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      color: { dark: '#46178F', light: '#FFFFFF' }
    });
    res.json({ qr: qrDataUrl, url });
  } catch (e) {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

// Get room info
app.get('/api/room/:code', (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ code: room.code, phase: room.phase, playerCount: Object.keys(room.players).length });
});

// Export results to Excel
app.get('/api/room/:code/export', basicAuth, (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const wb = XLSX.utils.book_new();

  // Ranking sheet
  const ranking = getRanking(room);
  const rankData = ranking.map(p => ({
    'Hạng': p.rank,
    'Tên': p.name,
    'Điểm': p.score,
    'Số câu đúng': p.correctCount,
    'Streak cao nhất': p.streak
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rankData), 'Bảng xếp hạng');

  // Per question sheet
  if (room.gameHistory.length > 0) {
    const histData = [];
    room.gameHistory.forEach((h, qi) => {
      Object.entries(h.answers).forEach(([sid, ans]) => {
        const player = room.players[sid];
        histData.push({
          'Câu': qi + 1,
          'Câu hỏi': h.question,
          'Tên': player ? player.name : 'Unknown',
          'Đáp án chọn': ans.optionText || ans.option,
          'Đúng/Sai': ans.correct ? 'Đúng' : 'Sai',
          'Thời gian (s)': Math.round(ans.time * 10) / 10,
          'Điểm': ans.points
        });
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(histData), 'Chi tiết');
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=quiz-results-${room.code}.xlsx`);
  res.send(Buffer.from(buf));
});

// ==================== SOCKET.IO ====================

io.on('connection', (socket) => {
  let currentRoom = null;
  let isAdmin = false;
  let isAuthenticated = false;

  // --- TIME SYNC (NTP-style Bayeux/CometD inspired) ---
  // Client sends t0 (client timestamp), server responds with t0 + serverTime
  // Client calculates: offset = serverTime - ((t0 + t1) / 2) where t1 = client receive time
  socket.on('time:sync', (clientTimestamp) => {
    socket.emit('time:sync:reply', {
      clientTimestamp,       // Echo back client's t0
      serverTimestamp: Date.now()  // Server's time at processing
    });
  });

  // --- ADMIN AUTH ---
  socket.on('admin:auth', ({ password, roomCode }, callback) => {
    const cb = typeof callback === 'function' ? callback : () => {};

    if (!verifyAdminPassword(password)) {
      return cb({ success: false, message: 'Mật khẩu không đúng' });
    }

    const room = getRoom(roomCode);
    if (!room) {
      return cb({ success: false, message: 'Phòng không tồn tại' });
    }

    isAuthenticated = true;
    isAdmin = true;
    currentRoom = roomCode;
    const token = generateToken();
    adminTokens.add(token);

    socket.join(roomCode);
    socket.join(`${roomCode}:admins`);

    cb({ success: true, token });

    socket.emit('game:state', {
      phase: room.phase,
      roomCode,
      questionIndex: room.currentQuestionIndex,
      totalQuestions: room.quizData.questions.length,
      playerCount: Object.keys(room.players).length,
      players: Object.values(room.players).map(p => p.name),
      quizData: room.quizData,
      serverTimestamp: Date.now()
    });
  });

  // --- ADMIN JOIN (with token for reconnect) ---
  socket.on('admin:join', (data) => {
    // Support both old format (string roomCode) and new format ({roomCode, token})
    let roomCode, token;
    if (typeof data === 'string') {
      roomCode = data;
      token = null;
    } else {
      roomCode = data.roomCode;
      token = data.token;
    }

    const room = getRoom(roomCode);
    if (!room) return socket.emit('error', { message: 'Phòng không tồn tại' });

    // Must be authenticated or have valid token
    if (!token || !adminTokens.has(token)) {
      return socket.emit('admin:auth:required', { roomCode });
    }

    isAuthenticated = true;
    isAdmin = true;
    currentRoom = roomCode;
    socket.join(roomCode);
    socket.join(`${roomCode}:admins`);

    socket.emit('game:state', {
      phase: room.phase,
      roomCode,
      questionIndex: room.currentQuestionIndex,
      totalQuestions: room.quizData.questions.length,
      playerCount: Object.keys(room.players).length,
      players: Object.values(room.players).map(p => p.name),
      quizData: room.quizData,
      serverTimestamp: Date.now()
    });
  });

  // --- JOIN ROOM ---
  socket.on('player:join', ({ roomCode, name }) => {
    const room = getRoom(roomCode);
    if (!room) return socket.emit('error', { message: 'Phòng không tồn tại' });
    if (room.players[socket.id]) return;

    const safeName = String(name).slice(0, 30).replace(/[<>]/g, '');
    room.players[socket.id] = {
      name: safeName,
      score: 0,
      streak: 0,
      maxStreak: 0,
      correctCount: 0,
      answered: false,
      lastAnswerTime: 0
    };
    currentRoom = roomCode;
    socket.join(roomCode);
    socket.join(`${roomCode}:players`);

    socket.emit('game:state', {
      phase: room.phase,
      roomCode,
      timeLeft: room.timeLeft,
      questionIndex: room.currentQuestionIndex,
      totalQuestions: room.quizData.questions.length,
      serverTimestamp: Date.now(),
      questionEndTime: room.questionEndTime || null
    });

    // If question in progress, send it
    if (room.phase === 'question' && room.currentQuestionIndex >= 0) {
      const q = room.quizData.questions[room.currentQuestionIndex];
      socket.emit('question:show', buildQuestionPayload(room, q));
    }

    io.to(roomCode).emit('players:update', {
      count: Object.keys(room.players).length,
      list: Object.values(room.players).map(p => p.name)
    });

    console.log(`[${roomCode}] Player joined: ${safeName}`);
  });

  // --- PLAYER ANSWER ---
  socket.on('player:answer', (data) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    if (!room || room.phase !== 'question') return;
    if (!room.players[socket.id]) return;
    if (room.answers[socket.id]) return;

    const q = room.quizData.questions[room.currentQuestionIndex];
    const timeTaken = (Date.now() - room.questionStartTime) / 1000;
    if (timeTaken > q.timeLimit + 1) return;

    let isCorrect = false;
    const optionIndex = data.option;

    if (q.type === 'multiple' || q.type === 'truefalse') {
      isCorrect = q.correct.includes(optionIndex);
    } else if (q.type === 'multi_select') {
      const selected = Array.isArray(data.options) ? data.options.sort() : [];
      isCorrect = JSON.stringify(selected) === JSON.stringify([...q.correct].sort());
    } else if (q.type === 'text') {
      const ans = String(data.text || '').trim().toLowerCase();
      isCorrect = q.correct.some(c => String(c).toLowerCase() === ans);
    }

    const points = isCorrect ? calculatePoints(timeTaken, q.timeLimit, q.points) : 0;
    const player = room.players[socket.id];

    room.answers[socket.id] = {
      option: optionIndex,
      options: data.options,
      text: data.text,
      optionText: q.options ? q.options[optionIndex] : data.text,
      time: timeTaken,
      correct: isCorrect,
      points
    };

    player.score += points;
    player.answered = true;
    player.lastAnswerTime = timeTaken;

    if (isCorrect) {
      player.streak++;
      player.correctCount++;
      if (player.streak > player.maxStreak) player.maxStreak = player.streak;
    } else {
      player.streak = 0;
    }

    socket.emit('answer:confirmed', {
      selected: optionIndex,
      timeTaken: Math.round(timeTaken * 10) / 10,
      correct: isCorrect,
      points
    });

    // Send monitoring data with answered status
    const monitorData = Object.entries(room.players).map(([sid, p]) => ({
      name: p.name,
      score: p.score,
      answered: !!room.answers[sid]
    }));

    io.to(`${currentRoom}:admins`).emit('answers:update', {
      answered: Object.keys(room.answers).length,
      total: Object.keys(room.players).length,
      monitor: monitorData
    });
  });

  // --- OBSTACLE ANSWER ---
  socket.on('player:obstacleAnswer', (data) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    if (!room || room.phase !== 'obstacle') return;
    if (!room.players[socket.id]) return;
    if (room.answers[socket.id]) return;

    const obs = room.quizData.obstacleQuestion;
    const timeTaken = (Date.now() - room.questionStartTime) / 1000;
    const answer = String(data.text || '').trim().toUpperCase();
    const isCorrect = answer === obs.answer.toUpperCase();
    const points = isCorrect ? obs.points : 0;

    room.answers[socket.id] = {
      text: answer,
      time: timeTaken,
      correct: isCorrect,
      points
    };

    room.players[socket.id].score += points;

    socket.emit('obstacle:confirmed', { correct: isCorrect, points });

    io.to(`${currentRoom}:admins`).emit('answers:update', {
      answered: Object.keys(room.answers).length,
      total: Object.keys(room.players).length
    });
  });

  // --- ADMIN CONTROLS (require auth) ---

  socket.on('admin:nextQuestion', () => {
    if (!currentRoom || !isAdmin || !isAuthenticated) return;
    const room = getRoom(currentRoom);
    if (!room) return;

    room.currentQuestionIndex++;

    if (room.currentQuestionIndex >= room.quizData.questions.length) {
      // Check if obstacle question
      if (room.quizData.obstacleQuestion && room.quizData.obstacleQuestion.enabled) {
        startObstacle(room);
      } else {
        finishGame(room);
      }
      return;
    }

    startQuestion(room);
  });

  socket.on('admin:endQuestion', () => {
    if (!currentRoom || !isAdmin || !isAuthenticated) return;
    const room = getRoom(currentRoom);
    if (!room) return;
    endQuestion(room);
  });

  socket.on('admin:showRanking', () => {
    if (!currentRoom || !isAdmin || !isAuthenticated) return;
    const room = getRoom(currentRoom);
    if (!room) return;

    room.phase = 'ranking';
    const ranking = getRanking(room);
    const q = room.quizData.questions;
    io.to(currentRoom).emit('game:ranking', {
      ranking,
      questionIndex: room.currentQuestionIndex,
      total: q.length
    });
  });

  socket.on('admin:endObstacle', () => {
    if (!currentRoom || !isAdmin || !isAuthenticated) return;
    const room = getRoom(currentRoom);
    if (!room) return;
    clearInterval(room.timerInterval);
    finishGame(room);
  });

  socket.on('admin:reset', () => {
    if (!currentRoom || !isAdmin || !isAuthenticated) return;
    const room = getRoom(currentRoom);
    if (!room) return;

    clearInterval(room.timerInterval);
    room.phase = 'lobby';
    room.currentQuestionIndex = -1;
    room.answers = {};
    room.revealedHints = [];
    room.gameHistory = [];
    Object.values(room.players).forEach(p => {
      p.score = 0; p.streak = 0; p.maxStreak = 0;
      p.correctCount = 0; p.answered = false;
    });
    io.to(currentRoom).emit('game:reset');
  });

  // --- DISCONNECT ---
  socket.on('disconnect', () => {
    if (currentRoom) {
      const room = getRoom(currentRoom);
      if (room && room.players[socket.id]) {
        console.log(`[${currentRoom}] Player left: ${room.players[socket.id].name}`);
        delete room.players[socket.id];
        io.to(currentRoom).emit('players:update', {
          count: Object.keys(room.players).length,
          list: Object.values(room.players).map(p => p.name)
        });
      }
    }
  });
});

// ==================== GAME LOGIC ====================

function buildQuestionPayload(room, q) {
  return {
    id: q.id,
    type: q.type,
    question: q.question,
    options: q.options,
    image: q.image,
    index: room.currentQuestionIndex,
    total: room.quizData.questions.length,
    timeLimit: q.timeLimit,
    points: q.points
  };
}

function startQuestion(room) {
  const q = room.quizData.questions[room.currentQuestionIndex];

  // Countdown phase (server-side authoritative)
  room.phase = 'countdown';
  room.answers = {};
  room.questionEndTime = null;
  Object.values(room.players).forEach(p => p.answered = false);

  const countdownDuration = 3;
  const countdownEndTime = Date.now() + countdownDuration * 1000;

  io.to(room.code).emit('game:countdown', {
    questionIndex: room.currentQuestionIndex,
    total: room.quizData.questions.length,
    duration: countdownDuration,
    serverTimestamp: Date.now(),
    countdownEndTime
  });

  // After countdown, show question — server-side authoritative timing
  setTimeout(() => {
    room.phase = 'question';
    room.questionStartTime = Date.now();
    room.questionEndTime = room.questionStartTime + q.timeLimit * 1000;
    room.timeLeft = q.timeLimit;

    io.to(room.code).emit('question:show', {
      ...buildQuestionPayload(room, q),
      serverTimestamp: Date.now(),
      questionEndTime: room.questionEndTime
    });

    // Server-side authoritative timer: calculate remaining from timestamps, not counter
    clearInterval(room.timerInterval);
    room.timerInterval = setInterval(() => {
      const now = Date.now();
      const remaining = Math.ceil((room.questionEndTime - now) / 1000);
      room.timeLeft = Math.max(remaining, 0);

      io.to(room.code).emit('timer:update', {
        timeLeft: room.timeLeft,
        serverTimestamp: now,
        questionEndTime: room.questionEndTime
      });

      if (room.timeLeft <= 0) {
        endQuestion(room);
      }
    }, 1000);
  }, countdownDuration * 1000);
}

function endQuestion(room) {
  clearInterval(room.timerInterval);
  room.phase = 'result';

  const q = room.quizData.questions[room.currentQuestionIndex];
  const results = getQuestionResults(room);
  const ranking = getRanking(room);

  // Save to history
  room.gameHistory.push({
    questionIndex: room.currentQuestionIndex,
    question: q.question,
    answers: { ...room.answers }
  });

  // Check if this question reveals a hint for obstacle
  if (room.quizData.obstacleQuestion && room.quizData.obstacleQuestion.enabled) {
    const hints = room.quizData.obstacleQuestion.hints;
    if (hints && hints[room.currentQuestionIndex]) {
      room.revealedHints.push({
        index: room.currentQuestionIndex,
        hint: hints[room.currentQuestionIndex]
      });
    }
  }

  io.to(room.code).emit('question:result', {
    ...results,
    ranking: ranking.slice(0, 10),
    revealedHints: room.revealedHints
  });
}

function startObstacle(room) {
  const obs = room.quizData.obstacleQuestion;
  room.phase = 'obstacle';
  room.answers = {};
  room.questionStartTime = Date.now();
  room.questionEndTime = room.questionStartTime + obs.timeLimit * 1000;
  room.timeLeft = obs.timeLimit;

  io.to(room.code).emit('game:obstacle', {
    question: obs.question,
    hints: room.revealedHints,
    timeLimit: obs.timeLimit,
    points: obs.points,
    answerLength: obs.answer.length,
    serverTimestamp: Date.now(),
    questionEndTime: room.questionEndTime
  });

  clearInterval(room.timerInterval);
  room.timerInterval = setInterval(() => {
    const now = Date.now();
    const remaining = Math.ceil((room.questionEndTime - now) / 1000);
    room.timeLeft = Math.max(remaining, 0);

    io.to(room.code).emit('timer:update', {
      timeLeft: room.timeLeft,
      serverTimestamp: now,
      questionEndTime: room.questionEndTime
    });

    if (room.timeLeft <= 0) {
      clearInterval(room.timerInterval);
      finishGame(room);
    }
  }, 1000);
}

function finishGame(room) {
  clearInterval(room.timerInterval);
  room.phase = 'final';
  const ranking = getRanking(room);
  io.to(room.code).emit('game:final', { ranking, roomCode: room.code });
}

// ==================== START ====================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║      QUIZ GAME SERVER STARTED             ║
╠═══════════════════════════════════════════╣
║  Home:    http://localhost:${PORT}            ║
║  Setup:   http://localhost:${PORT}/setup      ║
║  Admin:   http://localhost:${PORT}/admin      ║
║  Player:  http://localhost:${PORT}/player     ║
╚═══════════════════════════════════════════╝
  `);
});
