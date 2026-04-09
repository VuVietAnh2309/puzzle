/**
 * src/config/index.js
 * Central configuration: paths, environment settings, and default quiz data.
 */

const path = require('path');
const crypto = require('crypto');

// ==================== PATHS ====================

const rootDir = path.resolve(__dirname, '..', '..');

const config = {
  rootDir,
  publicDir: path.join(rootDir, 'public'),
  dataDir: path.join(rootDir, 'data'),
  uploadsDir: path.join(rootDir, 'public', 'uploads'),
  logoDir: path.join(rootDir, 'logo'),
  dataFile: path.join(rootDir, 'data', 'quizdata.json'),

  // ==================== SERVER ====================
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // ==================== ADMIN AUTH ====================
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
};

// ==================== TOKEN STORE ====================

/** In-memory token store: token -> { user, loginTime, roomCode? } */
const adminTokens = new Map();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function verifyToken(token) {
  if (!token) return false;
  return adminTokens.has(token);
}

function verifyAdminPassword(password) {
  return password === config.adminPassword;
}

// ==================== DEFAULT QUIZ DATA ====================

const defaultQuizData = {
  title: 'Quiz Game',
  questions: [
    { id: 1, type: 'multiple', question: 'Quốc khánh nước CHXHCN Việt Nam là ngày nào?', options: ['1/5', '2/9', '30/4', '19/8'], correct: [1], timeLimit: 15, points: 1000, image: null },
    { id: 2, type: 'multiple', question: 'Thủ đô của Việt Nam là thành phố nào?', options: ['Hồ Chí Minh', 'Đà Nẵng', 'Hà Nội', 'Huế'], correct: [2], timeLimit: 15, points: 1000, image: null },
    { id: 3, type: 'truefalse', question: 'Sông Mê Kông là sông dài nhất Việt Nam?', options: ['Đúng', 'Sai'], correct: [1], timeLimit: 10, points: 500, image: null },
    { id: 4, type: 'multiple', question: 'Việt Nam có bao nhiêu tỉnh thành?', options: ['61', '63', '64', '62'], correct: [1], timeLimit: 15, points: 1000, image: null },
    { id: 5, type: 'multiple', question: 'Đỉnh núi cao nhất Việt Nam?', options: ['Pù Luông', 'Fansipan', 'Bà Đen', 'Langbiang'], correct: [1], timeLimit: 15, points: 1000, image: null },
  ],
  puzzle: {
    enabled: true,
    image: null,
    gridSize: 3,
    timeLimit: 120,
  },
};

module.exports = {
  config,
  adminTokens,
  generateToken,
  verifyToken,
  verifyAdminPassword,
  defaultQuizData,
};
