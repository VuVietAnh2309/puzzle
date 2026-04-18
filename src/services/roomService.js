/**
 * src/services/roomService.js
 * All room state management and pure game-logic helpers.
 * No socket.io / Express dependency — just plain data operations.
 */

const { defaultQuizData } = require('../config');
const { loadData } = require('./dataService');
const Room = require('../models/Room');

// ==================== ACTIVE ROOMS STORE ====================

/** @type {Object.<string, Room>} Global room map: roomCode -> Room instance */
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
 */
function createRoom(quizDataOverride, currentQuizData) {
  const code = generateRoomCode();
  const quizData = processQuizData(quizDataOverride || currentQuizData || { ...defaultQuizData });
  const room = new Room(code, quizData);
  rooms[code] = room;
  console.log(`[roomService] Room created: ${code}`);
  return room;
}

/**
 * Look up a room by code.
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
 */
function calculatePoints(timeTaken) {
  if (timeTaken < 5)   return 2;
  if (timeTaken < 10)  return 1.75;
  if (timeTaken <= 15) return 1.5;
  return 0;
}

/**
 * Return a sorted ranking array from room.players.
 * Delegated to Room.getRanking()
 */
function getRanking(room) {
  return room.getRanking();
}

/**
 * Aggregate per-question answer statistics.
 * Delegated to Room.getQuestionResults()
 */
function getQuestionResults(room) {
  return room.getQuestionResults();
}

/**
 * Build the base payload for a question:show event.
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
 */
function checkAnswer(q, data) {
  if (q.type === 'multiple' || q.type === 'truefalse') {
    // Robust comparison for single option selection
    if (data.option === undefined) return false;
    const correctArr = Array.isArray(q.correct) ? q.correct : [q.correct];
    return correctArr.some((c) => String(c) === String(data.option));
  }
  if (q.type === 'multi_select') {
    const selected = Array.isArray(data.options) ? [...data.options].map(String).sort() : [];
    const correct = Array.isArray(q.correct) ? [...q.correct].map(String).sort() : [];
    return JSON.stringify(selected) === JSON.stringify(correct);
  }
  if (q.type === 'text') {
    const ans = String(data.text || '').trim().toLowerCase();
    const correctArr = Array.isArray(q.correct) ? q.correct : [q.correct];
    return correctArr.some((c) => String(c).toLowerCase() === ans);
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

