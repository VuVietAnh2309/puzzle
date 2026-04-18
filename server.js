/**
 * server.js — Entry point
 * Sets up Express, Socket.IO, middleware, API routes, then delegates all
 * socket logic to src/sockets/ and all business logic to src/services/.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const QRCode = require('qrcode');
const nunjucks = require('nunjucks');

// ── Internal modules ──────────────────────────────────────────────────────────
const { config, adminTokens, generateToken, verifyToken } = require('./src/config');
const { loadData, saveData, loadOrDefault } = require('./src/services/dataService');
const { rooms, createRoom, getRoom, getRanking } = require('./src/services/roomService');
const { generateExcelBuffer } = require('./src/services/excelService');
const { listResults, getResult, deleteResult } = require('./src/services/resultsService');
const { registerConnectionHandlers } = require('./src/sockets/connection');
const { registerGameHandlers } = require('./src/sockets/game-logic');

// ==================== EXPRESS & SOCKET.IO SETUP ====================

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ==================== DIRECTORIES ====================

[config.dataDir, config.uploadsDir].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ==================== MIDDLEWARE ====================

app.use(express.json({ limit: '10mb' }));

// Nunjucks template engine
nunjucks.configure('views', {
  autoescape: true,
  express: app,
  noCache: config.nodeEnv !== 'production',
});
app.set('view engine', 'njk');

// LiveReload (dev only)
if (config.nodeEnv !== 'production') {
  try {
    const livereload = require('livereload');
    const connectLivereload = require('connect-livereload');
    const lrServer = livereload.createServer({ exts: ['html', 'css', 'js', 'png', 'jpg'] });
    lrServer.watch(config.publicDir);
    app.use(connectLivereload());
  } catch (e) { /* livereload not installed — skip */ }
}

// Clean URL rewrite (keep legacy static routes working)
app.use((req, res, next) => {
  const routes = ['admin', 'puzzle', 'setup'];
  const clean = req.path.replace(/^\//, '');
  if (routes.includes(clean)) req.url = `/${clean}.html`;
  next();
});

app.use(express.static(config.publicDir));
app.use('/logos', express.static(config.logoDir));

// File upload
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.uploadsDir),
    filename: (req, file, cb) =>
      cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  },
});

// ==================== AUTH HELPERS ====================

function verifyTokenMiddleware(req) {
  const token = req.headers['x-admin-token'] || req.query.token;
  return verifyToken(token);
}

function adminOnly(req, res, next) {
  if (verifyTokenMiddleware(req)) return next();
  res.status(401).json({ success: false, message: 'Unauthorized' });
}

// ==================== PAGE ROUTES ====================

app.get('/', (req, res) => res.render('index.njk', { is_player: false }));
app.get('/player', (req, res) => res.render('index.njk', { is_player: true }));

// ==================== AUTH API ====================

app.post('/api/admin/login', (req, res) => {
  const { user, password } = req.body;
  if (user === config.adminUser && password === config.adminPassword) {
    const token = generateToken();
    adminTokens.set(token, { user, loginTime: Date.now() });
    return res.json({ success: true, token });
  }
  res.status(401).json({ success: false, message: 'Sai tài khoản hoặc mật khẩu' });
});

app.get('/api/admin/verify', (req, res) => {
  if (verifyTokenMiddleware(req)) return res.json({ success: true });
  res.status(401).json({ success: false });
});

// ==================== QUIZ DATA API ====================

app.get('/api/quiz', adminOnly, (req, res) => {
  res.json(loadOrDefault());
});

app.post('/api/quiz', adminOnly, (req, res) => {
  saveData(req.body);
  res.json({ success: true });
});

// ==================== UPLOAD API ====================

app.post('/api/upload', adminOnly, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// ==================== LOGOS API ====================

app.get('/api/logos', (req, res) => {
  try {
    const files = fs.readdirSync(config.logoDir).filter((f) =>
      /\.(jpg|jpeg|png|gif|svg|webp)$/i.test(f),
    );
    res.json({ logos: files.map((f) => `/logos/${f}`) });
  } catch (e) {
    res.json({ logos: [] });
  }
});

// ==================== ROOM API ====================

app.get('/api/room-check/:code', (req, res) => {
  res.json({ exists: !!getRoom(req.params.code) });
});

app.get('/api/rooms', adminOnly, (req, res) => {
  const roomList = Object.values(rooms).map((r) => ({
    code: r.code,
    name: r.name,
    phase: r.phase,
    playerCount: Object.keys(r.players).length,
    createdAt: r.createdAt,
  }));
  res.json({ rooms: roomList });
});

app.post('/api/room', adminOnly, (req, res) => {
  const { name } = req.body;

  if (name) {
    const duplicate = Object.values(rooms).find(
      (r) => r.name && r.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (duplicate) {
      return res.status(409).json({ error: 'Phòng này đã tồn tại, vui lòng đặt tên khác' });
    }
  }

  const currentQuizData = loadOrDefault();
  const room = createRoom(null, currentQuizData);
  if (name) room.name = name;
  res.json({ code: room.code });
});

app.delete('/api/room/:code', adminOnly, (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  const room = rooms[code];
  if (room) {
    room.stopTimer();
    delete rooms[code];
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, message: 'Room not found' });
  }
});

app.get('/api/room/:code', (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ code: room.code, phase: room.phase, playerCount: Object.keys(room.players).length });
});

app.get('/api/room/:code/qr', async (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const host = req.headers.host || `localhost:${config.port}`;
  const protocol = req.secure ? 'https' : 'http';
  const url = `${protocol}://${host}/player?room=${room.code}`;

  try {
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      color: { dark: '#0d3b8f', light: '#FFFFFF' },
    });
    res.json({ qr: qrDataUrl, url });
  } catch (e) {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

app.get('/api/room/:code/export', adminOnly, (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const ranking = room.getRanking();
  const buffer = generateExcelBuffer({
    ranking,
    gameHistory: room.gameHistory,
    players: room.players,
    roomCode: room.code,
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=quiz-results-${room.code}.xlsx`);
  res.send(buffer);
});

// ==================== SAVED RESULTS API ====================

app.get('/api/results', adminOnly, (req, res) => {
  res.json({ results: listResults() });
});

app.get('/api/results/:id', adminOnly, (req, res) => {
  const result = getResult(req.params.id);
  if (!result) return res.status(404).json({ error: 'Result not found' });
  res.json(result);
});

app.delete('/api/results/:id', adminOnly, (req, res) => {
  const ok = deleteResult(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Result not found' });
  res.json({ success: true });
});

app.get('/api/results/:id/export', adminOnly, (req, res) => {
  const result = getResult(req.params.id);
  if (!result) return res.status(404).json({ error: 'Result not found' });

  // Build a players map shaped like room.players for the excel generator
  const playersMap = {};
  (result.players || []).forEach((p) => { playersMap[p.playerId || p.name] = p; });

  const buffer = generateExcelBuffer({
    ranking: result.ranking || [],
    gameHistory: result.gameHistory || [],
    players: playersMap,
    roomCode: result.roomCode,
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=quiz-results-${result.roomCode}.xlsx`);
  res.send(buffer);
});

// ==================== SOCKET.IO ====================

io.on('connection', (socket) => {
  // Per-socket mutable state — shared between handler modules via reference
  const state = {
    currentRoom: null,
    isAdmin: false,
    isAuthenticated: false,
  };

  registerConnectionHandlers(socket, io, state);
  registerGameHandlers(socket, io, state);
});

// ==================== START ====================

server.listen(config.port, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║      QUIZ GAME SERVER STARTED             ║
╠═══════════════════════════════════════════╣
║  Home:    http://localhost:${config.port}            ║
║  Setup:   http://localhost:${config.port}/setup      ║
║  Admin:   http://localhost:${config.port}/admin      ║
║  Player:  http://localhost:${config.port}/player     ║
╚═══════════════════════════════════════════╝
  `);
});
