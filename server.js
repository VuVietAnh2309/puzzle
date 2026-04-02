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

// Token-based Admin Auth
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const adminTokens = new Map(); // token -> { expiry, user }

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function verifyToken(req) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token) return false;
  const session = adminTokens.get(token);
  if (!session) return false;
  // Check expiry if needed (currently simple)
  return true;
}

function adminOnly(req, res, next) {
  if (verifyToken(req)) return next();
  res.status(401).json({ success: false, message: 'Unauthorized' });
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

app.use(express.json({ limit: '10mb' }));


// API Login
app.post('/api/admin/login', (req, res) => {
  const { user, password } = req.body;
  if (user === ADMIN_USER && password === ADMIN_PASSWORD) {
    const token = generateToken();
    adminTokens.set(token, { user, loginTime: Date.now() });
    return res.json({ success: true, token });
  }
  res.status(401).json({ success: false, message: 'Sai tài khoản hoặc mật khẩu' });
});

app.get('/api/admin/verify', (req, res) => {
  if (verifyToken(req)) return res.json({ success: true });
  res.status(401).json({ success: false });
});

// Rewrite clean URLs
app.use((req, res, next) => {
  const routes = ['admin', 'player', 'puzzle', 'setup'];
  const clean = req.path.replace(/^\//, '');
  if (routes.includes(clean)) req.url = `/${clean}.html`;
  next();
});

// LiveReload (dev only)
if (process.env.NODE_ENV !== 'production') {
  try {
    const livereload = require('livereload');
    const connectLivereload = require('connect-livereload');
    const lrServer = livereload.createServer({ exts: ['html', 'css', 'js', 'png', 'jpg'] });
    lrServer.watch(publicDir);
    app.use(connectLivereload());
  } catch (e) { /* livereload not installed, skip */ }
}

app.use(express.static(publicDir));
app.use('/logos', express.static(path.join(__dirname, 'logo')));

// API to list available logos
app.get('/api/logos', (req, res) => {
  const logoDir = path.join(__dirname, 'logo');
  try {
    const files = fs.readdirSync(logoDir).filter(f =>
      /\.(jpg|jpeg|png|gif|svg|webp)$/i.test(f)
    );
    res.json({ logos: files.map(f => `/logos/${f}`) });
  } catch (e) {
    res.json({ logos: [] });
  }
});

app.get('/api/room-check/:code', (req, res) => {
  const code = req.params.code;
  const room = getRoom(code);
  res.json({ exists: !!room });
});

// List all active rooms
app.get('/api/rooms', adminOnly, (req, res) => {
  const roomList = Object.values(rooms).map(r => ({
    code: r.code,
    phase: r.phase,
    playerCount: Object.keys(r.players).length,
    createdAt: r.createdAt
  }));
  res.json({ rooms: roomList });
});

// Delete a room
app.delete('/api/room/:code', adminOnly, (req, res) => {
  const code = req.params.code;
  if (rooms[code]) {
    if (rooms[code].timerInterval) clearInterval(rooms[code].timerInterval);
    delete rooms[code];
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, message: 'Room not found' });
  }
});

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
    { id: 1, type: 'multiple', question: "Quốc khánh nước CHXHCN Việt Nam là ngày nào?", options: ["1/5", "2/9", "30/4", "19/8"], correct: [1], timeLimit: 15, points: 1000, image: null },
    { id: 2, type: 'multiple', question: "Thủ đô của Việt Nam là thành phố nào?", options: ["Hồ Chí Minh", "Đà Nẵng", "Hà Nội", "Huế"], correct: [2], timeLimit: 15, points: 1000, image: null },
    { id: 3, type: 'truefalse', question: "Sông Mê Kông là sông dài nhất Việt Nam?", options: ["Đúng", "Sai"], correct: [1], timeLimit: 10, points: 500, image: null },
    { id: 4, type: 'multiple', question: "Việt Nam có bao nhiêu tỉnh thành?", options: ["61", "63", "64", "62"], correct: [1], timeLimit: 15, points: 1000, image: null },
    { id: 5, type: 'multiple', question: "Đỉnh núi cao nhất Việt Nam?", options: ["Pù Luông", "Fansipan", "Bà Đen", "Langbiang"], correct: [1], timeLimit: 15, points: 1000, image: null },
  ],
  puzzle: {
    enabled: false,
    image: null,
    gridSize: 3,
    timeLimit: 120
  }
};

let quizData = loadData() || { ...defaultQuizData };

// Fisher-Yates Shuffle
function shuffle(array) {
  let currentIndex = array.length, randomIndex;
  while (currentIndex > 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
}

function getRandomizedQuizData(isTest = false) {
  const data = loadData() || { ...defaultQuizData };

  if (data.questions && data.questions.length > 0) {
    if (isTest) {
      // Pick 4 random questions for Quiz test
      data.questions = shuffle([...data.questions]).slice(0, 4);
    } else {
      // Just shuffle all for normal flow
      data.questions = shuffle([...data.questions]);
    }
  }


  return data;
}

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
    phase: 'lobby', // lobby, countdown, question, result, ranking, puzzle, final
    quizData: processQuizData(quizDataOverride || quizData),
    currentQuestionIndex: -1,
    questionStartTime: null,
    players: {},
    inactivePlayers: {},
    answers: {},
    timerInterval: null,
    timeLeft: 0,
    gameHistory: [],
    autoEnding: false,
    puzzleResults: {},  // {socketId: {completed, moves, time}}
    createdAt: Date.now()
  };
  console.log(`[SERVER] Room created: ${code}`);
  return rooms[code];
}

function processQuizData(srcData) {
  let data = { ...srcData };
  if (data.questions && data.questions.length > 0) {
    // Always shuffle for variability
    data.questions = shuffle([...data.questions]);
    
    // Limit if maxQuestions is set
    if (data.maxQuestions && data.maxQuestions > 0) {
      data.questions = data.questions.slice(0, data.maxQuestions);
    }
  }
  return data;
}

function getRoom(code) {
  if (!code) return null;
  const cleanCode = String(code).trim().toUpperCase();
  const room = rooms[cleanCode];
  if (!room) {
    console.warn(`[SERVER] Room not found: ${cleanCode}`);
  }
  return room;
}

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
    logo: p.logo,
    score: p.score,
    streak: p.streak,
    correctCount: p.correctCount
  }));
}

function getQuestionResults(room) {
  const q = room.quizData.questions[room.currentQuestionIndex];
  const answers = room.answers;
  const total = Object.values(room.players).filter(p => !p.gameType || p.gameType === 'quiz').length;
  const options = q.options || [];
  const numOptions = options.length;
  const optionCounts = new Array(numOptions).fill(0);
  let correctCount = 0;

  Object.values(answers).forEach(a => {
    if (typeof a.option === 'number' && a.option >= 0 && a.option < numOptions) optionCounts[a.option]++;
    if (a.correct) correctCount++;
  });

  return {
    question: q.question,
    options: options,
    correct: q.correct,
    type: q.type || 'multiple',
    image: q.image,
    optionCounts,
    totalAnswered: Object.keys(answers).length,
    totalPlayers: total,
    correctCount
  };
}

// ==================== API ROUTES ====================

// Get quiz data for setup
app.get('/api/quiz', adminOnly, (req, res) => {
  const currentData = loadData() || { ...defaultQuizData };
  res.json(currentData);
});

// Save quiz data
app.post('/api/quiz', adminOnly, (req, res) => {
  quizData = req.body;
  saveData(quizData);
  res.json({ success: true });
});

// Upload image
app.post('/api/upload', adminOnly, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// Create room
app.post('/api/room', adminOnly, (req, res) => {
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
app.get('/api/room/:code/export', adminOnly, (req, res) => {
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
  socket.on('admin:auth', ({ password, roomCode: rawCode }, callback) => {
    const roomCode = String(rawCode || '').trim().toUpperCase();
    const cb = typeof callback === 'function' ? callback : () => { };

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
    adminTokens.set(token, { roomCode, loginTime: Date.now(), type: 'room' });

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

  // --- ADMIN LOGOUT ---
  socket.on('admin:logout', ({ token, roomCode }) => {
    // Don't delete the token - it's still valid for other rooms / reconnect
    // Only leave the current room
    isAuthenticated = false;
    isAdmin = false;
    if (roomCode) {
      socket.leave(roomCode);
      socket.leave(`${roomCode}:admins`);
    }
    currentRoom = null;
  });

  // --- ADMIN JOIN (with token for reconnect) ---
  socket.on('admin:join', (data) => {
    // Support both old format (string roomCode) and new format ({roomCode, token})
    let roomCode, token;
    if (typeof data === 'string') {
      roomCode = String(data).trim().toUpperCase();
      token = null;
    } else {
      roomCode = String(data.roomCode || '').trim().toUpperCase();
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
  socket.on('player:join', ({ roomCode: rawCode, name, logo, gameType, playerId }) => {
    const roomCode = String(rawCode || '').trim().toUpperCase();
    let room = getRoom(roomCode);

    if (!room && gameType && typeof roomCode === 'string' && roomCode.startsWith('TEST_')) {
      const isRandomized = gameType === 'quiz';
      rooms[roomCode] = {
        code: roomCode,
        phase: 'lobby',
        quizData: getRandomizedQuizData(isRandomized),
        currentQuestionIndex: -1,
        questionStartTime: null,
        players: {},
        inactivePlayers: {},
        answers: {},
        timerInterval: null,
        timeLeft: 0,
        gameHistory: [],
        puzzleResults: {},
        createdAt: Date.now()
      };
      room = rooms[roomCode];
    }

    if (!room) return socket.emit('error', { message: 'Phòng không tồn tại' });
    
    const persistentId = playerId || socket.id;
    let player = null;

    // Check if player is already active (different socket?) or inactive
    for (const sid in room.players) {
      if (room.players[sid].playerId === persistentId) {
        player = room.players[sid];
        delete room.players[sid];
        break;
      }
    }
    if (!player && room.inactivePlayers[persistentId]) {
      player = room.inactivePlayers[persistentId];
      if (player.cleanupTimer) clearTimeout(player.cleanupTimer);
      delete room.inactivePlayers[persistentId];
    }

    const safeName = String(name).slice(0, 30).replace(/[<>]/g, '');
    const safeLogo = logo && typeof logo === 'string' ? String(logo).slice(0, 200) : null;

    if (player) {
      // Restore player state
      room.players[socket.id] = player;
      console.log(`[${roomCode}] Player reconnected: ${player.name}`);
    } else {
      // New player
      room.players[socket.id] = {
        playerId: persistentId,
        name: safeName,
        logo: safeLogo,
        gameType: gameType || null,
        score: 0,
        streak: 0,
        maxStreak: 0,
        correctCount: 0,
        answered: false,
        lastAnswerTime: 0
      };
    }
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

    if (gameType === 'puzzle') {
      const pz = room.quizData.puzzle || {};
      socket.emit('game:puzzle', {
        image: pz.image, gridSize: pz.gridSize || 3, timeLimit: pz.timeLimit || 120,
        serverTimestamp: Date.now(), questionEndTime: Date.now() + (pz.timeLimit || 120) * 1000
      });
    } else if (gameType === 'quiz') {
      room.players[socket.id].testQIndex = 0;
      function sendTestQ(idx) {
        const q = room.quizData.questions[idx];
        if (!q) return socket.emit('game:final', { ranking: [room.players[socket.id]] });
        socket.emit('game:countdown', { questionIndex: idx, total: room.quizData.questions.length, duration: 3, serverTimestamp: Date.now(), countdownEndTime: Date.now() + 3000 });
        setTimeout(() => {
          if (!room.players[socket.id]) return;
          room.players[socket.id].testQStart = Date.now();
          socket.emit('question:show', { id: q.id, type: q.type, question: q.question, options: q.options, image: q.image, index: idx, total: room.quizData.questions.length, timeLimit: q.timeLimit, points: q.points, serverTimestamp: Date.now(), questionEndTime: Date.now() + q.timeLimit * 1000 });
        }, 3000);
      }
      room.players[socket.id].sendTestQ = sendTestQ;
      sendTestQ(0);
    } else {
      if (room.phase === 'question' && room.currentQuestionIndex >= 0) {
        const q = room.quizData.questions[room.currentQuestionIndex];
        socket.emit('question:show', buildQuestionPayload(room, q));
      }
    }

    io.to(roomCode).emit('players:update', {
      count: Object.keys(room.players).length,
      list: Object.values(room.players).map(p => ({ name: p.name, logo: p.logo }))
    });

    console.log(`[${roomCode}] Player joined: ${safeName}`);
  });

  // --- PLAYER ANSWER ---
  socket.on('player:answer', (data) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;

    if (player.gameType === 'quiz') {
      const qIndex = player.testQIndex || 0;
      const q = room.quizData.questions[qIndex];
      const timeTaken = (Date.now() - player.testQStart) / 1000;
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
      player.score += points;
      socket.emit('answer:confirmed', { selected: optionIndex, timeTaken: Math.round(timeTaken * 10) / 10, correct: isCorrect, points });
      setTimeout(() => {
        if (!socket.connected || !room.players[socket.id]) return;
        socket.emit('question:result', { question: q.question, options: q.options, correct: q.correct, type: q.type, optionCounts: [], totalAnswered: 1, totalPlayers: 1, correctCount: isCorrect ? 1 : 0, ranking: [player] });
        setTimeout(() => {
          if (!socket.connected || !room.players[socket.id]) return;
          player.testQIndex++; player.sendTestQ(player.testQIndex);
        }, 3000);
      }, 1000);
      return;
    }

    if (room.phase !== 'question') return;
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
      total: Object.values(room.players).filter(p => !p.gameType || p.gameType === 'quiz').length,
      monitor: monitorData
    });

    // AUTO-END: if all players answered, wait 2s
    const realPlayers = Object.values(room.players).filter(p => !p.gameType);
    if (realPlayers.length > 0 && Object.keys(room.answers).length >= realPlayers.length && !room.autoEnding) {
      room.autoEnding = true;
      console.log(`[${currentRoom}] All players answered. Auto-ending in 3s...`);
      setTimeout(() => {
        if (room.phase === 'question') {
          endQuestion(room);
        }
      }, 3000);
    }
  });


  // --- ADMIN CONTROLS (require auth) ---

  socket.on('admin:startQuiz', () => {
    if (!currentRoom || !isAdmin || !isAuthenticated) return;
    const room = getRoom(currentRoom);
    if (!room) return;
    room.currentQuestionIndex = -1;
    room.currentQuestionIndex++;
    if (room.currentQuestionIndex >= room.quizData.questions.length) {
      finishGame(room);
      return;
    }
    startQuestion(room);
  });


  socket.on('admin:startPuzzleOnly', () => {
    if (!currentRoom || !isAdmin || !isAuthenticated) return;
    const room = getRoom(currentRoom);
    if (!room) return;
    startPuzzlePhase(room);
  });

  socket.on('admin:nextQuestion', () => {
    if (!currentRoom || !isAdmin || !isAuthenticated) return;
    const room = getRoom(currentRoom);
    if (!room) return;

    room.currentQuestionIndex++;

    if (room.currentQuestionIndex >= room.quizData.questions.length) {
      finishGame(room);
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


  socket.on('admin:endPuzzle', () => {
    if (!currentRoom || !isAdmin || !isAuthenticated) return;
    const room = getRoom(currentRoom);
    if (!room) return;
    clearInterval(room.timerInterval);
    finishGame(room);
  });

  socket.on('puzzle:complete', (data) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;

    if (player.gameType === 'puzzle') {
      socket.emit('puzzle:confirmed', { moves: data.moves, time: data.time });
      setTimeout(() => {
        if (!socket.connected || !room.players[socket.id]) return;
        socket.emit('game:final', { ranking: [player] });
      }, 2000);
      return;
    }

    if (room.phase !== 'puzzle') return;
    room.puzzleResults[socket.id] = {
      completed: true,
      moves: data.moves || 0,
      time: data.time || 0,
      name: room.players[socket.id] ? room.players[socket.id].name : 'Unknown'
    };
    // Notify admin about puzzle progress
    const totalPlayers = Object.values(room.players).filter(p => !p.gameType || p.gameType === 'puzzle').length;
    const completedCount = Object.values(room.puzzleResults).filter(r => r.completed).length;
    io.to(room.code).emit('puzzle:progress', {
      completed: completedCount,
      total: totalPlayers,
      results: Object.values(room.puzzleResults)
    });
    // Confirm to player
    socket.emit('puzzle:confirmed', { moves: data.moves, time: data.time });
  });

  socket.on('admin:reset', () => {
    if (!currentRoom || !isAdmin || !isAuthenticated) return;
    const room = getRoom(currentRoom);
    if (!room) return;

    clearInterval(room.timerInterval);
    room.phase = 'lobby';
    room.currentQuestionIndex = -1;
    room.answers = {};
    room.gameHistory = [];
    room.autoEnding = false;
    room.puzzleResults = {};
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
        const player = room.players[socket.id];
        console.log(`[${currentRoom}] Player disconnected (temporary): ${player.name}`);
        
        // Move to inactive state
        const pid = player.playerId;
        room.inactivePlayers[pid] = player;
        delete room.players[socket.id];

        // Schedule cleanup after 60 seconds
        player.cleanupTimer = setTimeout(() => {
          if (room.inactivePlayers[pid]) {
            console.log(`[${currentRoom}] Player session expired: ${player.name}`);
            delete room.inactivePlayers[pid];
            io.to(currentRoom).emit('players:update', {
              count: Object.keys(room.players).length,
              list: Object.values(room.players).map(p => ({ name: p.name, logo: p.logo }))
            });
          }
        }, 60000);

        io.to(currentRoom).emit('players:update', {
          count: Object.keys(room.players).length,
          list: Object.values(room.players).map(p => ({ name: p.name, logo: p.logo }))
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
  room.autoEnding = false;
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


  // Emit to everyone (global view)
  io.to(room.code).emit('question:result', {
    ...results,
    ranking: ranking.slice(0, 10)
  });
}


function startPuzzlePhase(room) {
  clearInterval(room.timerInterval);
  room.phase = 'puzzle';
  room.puzzleResults = {};
  room.questionStartTime = Date.now();
  const puzzleConfig = room.quizData.puzzle;
  room.questionEndTime = room.questionStartTime + puzzleConfig.timeLimit * 1000;
  room.timeLeft = puzzleConfig.timeLimit;

  io.to(room.code).emit('game:puzzle', {
    image: puzzleConfig.image,
    gridSize: puzzleConfig.gridSize || 3,
    timeLimit: puzzleConfig.timeLimit || 120,
    serverTimestamp: Date.now(),
    questionEndTime: room.questionEndTime
  });

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
