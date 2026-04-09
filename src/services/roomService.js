/**
 * src/services/roomService.js
 * All room state management and pure game-logic helpers.
 * No socket.io / Express dependency — just plain data operations.
 */

const { defaultQuizData } = require('../config');
const { loadData } = require('./dataService');

// ==================== ACTIVE ROOMS STORE ====================

/** @type {Object.<string, object>} Global room map: roomCode -> room */
const rooms = {};

// ==================== HELPERS ====================

/** Fisher-Yates shuffle (in-place, returns array) */
function shuffle(array) {
  let currentIndex = array.length;
  while (currentIndex > 0) {
    const randomIndex = Math.floor(Math.random() * currentIndex--);
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
}

/** Generate a 6-character alphanumeric room code */
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/**
 * Process raw quiz data: shuffle questions and apply maxQuestions limit.
 * @param {object} srcData
 * @returns {object} A new object with processed questions
 */
function processQuizData(srcData) {
  const data = { ...srcData };
  if (data.questions && data.questions.length > 0) {
    data.questions = shuffle([...data.questions]);
    if (data.maxQuestions && data.maxQuestions > 0) {
      data.questions = data.questions.slice(0, data.maxQuestions);
    }
  }
  return data;
}

/**
 * Load quiz data from disk and optionally slim it for a test run.
 * @param {boolean} isTest  If true, pick 4 random questions
 * @returns {object}
 */
function getRandomizedQuizData(isTest = false) {
  const data = loadData() || { ...defaultQuizData };
  if (data.questions && data.questions.length > 0) {
    if (isTest) {
      data.questions = shuffle([...data.questions]).slice(0, 4);
    } else {
      data.questions = shuffle([...data.questions]);
    }
  }
  return data;
}

// ==================== ROOM CRUD ====================

/**
 * Create a new room and add it to the rooms store.
 * @param {object} [quizDataOverride]
 * @param {object} [currentQuizData]  Fallback quiz data (from server)
 * @returns {object} The new room object
 */
function createRoom(quizDataOverride, currentQuizData) {
  const code = generateRoomCode();
  rooms[code] = {
    code,
    phase: 'banner', // banner | lobby | countdown | question | result | ranking | puzzle | final
    quizData: processQuizData(quizDataOverride || currentQuizData || { ...defaultQuizData }),
    currentQuestionIndex: -1,
    questionStartTime: null,
    questionEndTime: null,
    players: {},
    inactivePlayers: {},
    answers: {},
    timerInterval: null,
    timeLeft: 0,
    gameHistory: [],
    autoEnding: false,
    name: '',
    puzzleResults: {},
    createdAt: Date.now(),
  };
  console.log(`[roomService] Room created: ${code}`);
  return rooms[code];
}

/**
 * Look up a room by code (case-insensitive, trimmed).
 * @param {string} code
 * @returns {object|null}
 */
function getRoom(code) {
  if (!code) return null;
  const cleanCode = String(code).trim().toUpperCase();
  const room = rooms[cleanCode];
  if (!room) console.warn(`[roomService] Room not found: ${cleanCode}`);
  return room || null;
}

// ==================== GAME LOGIC HELPERS ====================

/**
 * Calculate points earned based on how quickly the player answered.
 *
 * Fixed scoring tiers (independent of timeLimit / basePoints):
 *   < 5s          → 2 điểm
 *   5s ≤ t < 10s  → 1.75 điểm
 *   10s ≤ t ≤ 15s → 1.5 điểm
 *   > 15s         → 0 điểm
 *
 * @param {number} timeTaken   Seconds elapsed since question was shown
 * @param {number} timeLimit   (unused — kept for call-site compatibility)
 * @param {number} basePoints  (unused — kept for call-site compatibility)
 * @returns {number}
 */
function calculatePoints(timeTaken, timeLimit, basePoints) { // eslint-disable-line no-unused-vars
  if (timeTaken < 5)   return 2;
  if (timeTaken < 10)  return 1.75;
  if (timeTaken <= 15) return 1.5;
  return 0;
}

/**
 * Return a sorted ranking array from room.players.
 * @param {object} room
 * @returns {Array<object>}
 */
function getRanking(room) {
  const players = Object.values(room.players);
  players.sort((a, b) => b.score - a.score || a.lastAnswerTime - b.lastAnswerTime);
  return players.map((p, i) => ({
    rank: i + 1,
    name: p.name,
    logo: p.logo,
    score: p.score,
    streak: p.streak,
    correctCount: p.correctCount,
  }));
}

/**
 * Aggregate per-question answer statistics.
 * @param {object} room
 * @returns {object}
 */
function getQuestionResults(room) {
  const q = room.quizData.questions[room.currentQuestionIndex];
  const answers = room.answers;
  const total = Object.values(room.players).filter((p) => !p.gameType || p.gameType === 'quiz').length;
  const options = q.options || [];
  const optionCounts = new Array(options.length).fill(0);
  let correctCount = 0;

  Object.values(answers).forEach((a) => {
    if (typeof a.option === 'number' && a.option >= 0 && a.option < options.length) {
      optionCounts[a.option]++;
    }
    if (a.correct) correctCount++;
  });

  return {
    question: q.question,
    options,
    correct: q.correct,
    type: q.type || 'multiple',
    image: q.image,
    optionCounts,
    totalAnswered: Object.keys(answers).length,
    totalPlayers: total,
    correctCount,
  };
}

/**
 * Build the base payload for a question:show event.
 * @param {object} room
 * @param {object} q  Question object
 * @returns {object}
 */
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
    points: q.points,
  };
}

/**
 * Determine correctness of a submitted answer against a question.
 * @param {object} q     Question object
 * @param {object} data  Raw answer data from client
 * @returns {boolean}
 */
function checkAnswer(q, data) {
  if (q.type === 'multiple' || q.type === 'truefalse') {
    return q.correct.includes(data.option);
  }
  if (q.type === 'multi_select') {
    const selected = Array.isArray(data.options) ? [...data.options].sort() : [];
    return JSON.stringify(selected) === JSON.stringify([...q.correct].sort());
  }
  if (q.type === 'text') {
    const ans = String(data.text || '').trim().toLowerCase();
    return q.correct.some((c) => String(c).toLowerCase() === ans);
  }
  return false;
}

module.exports = {
  rooms,
  shuffle,
  createRoom,
  getRoom,
  processQuizData,
  getRandomizedQuizData,
  calculatePoints,
  getRanking,
  getQuestionResults,
  buildQuestionPayload,
  checkAnswer,
};
