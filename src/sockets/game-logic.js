/**
 * src/sockets/game-logic.js
 * Handles game flow: admin auth/join/control, player answers, puzzle events.
 */

const {
  getRoom,
  getRanking,
  getQuestionResults,
  buildQuestionPayload,
  calculatePoints,
  checkAnswer,
} = require('../services/roomService');

const {
  adminTokens,
  generateToken,
  verifyAdminPassword,
} = require('../config');

// ==================== GAME ENGINE FUNCTIONS ====================

/**
 * Build the full game state snapshot sent to admins.
 * @param {object} room
 * @returns {object}
 */
function buildGameState(room) {
  return {
    phase: room.phase,
    roomCode: room.code,
    roomName: room.name,
    questionIndex: room.currentQuestionIndex,
    totalQuestions: room.quizData.questions.length,
    playerCount: Object.keys(room.players).length,
    players: Object.values(room.players).map((p) => ({ name: p.name, logo: p.logo })),
    quizData: room.quizData,
    serverTimestamp: Date.now(),
    questionEndTime: room.questionEndTime,
  };
}

/**
 * Show a question countdown then the question itself.
 * @param {object} room
 * @param {import('socket.io').Server} io
 */
function startQuestion(room, io) {
  const q = room.quizData.questions[room.currentQuestionIndex];

  room.phase = 'countdown';
  room.answers = {};
  room.questionEndTime = null;
  room.autoEnding = false;
  Object.values(room.players).forEach((p) => { p.answered = false; });

  const countdownDuration = 3;
  const countdownEndTime = Date.now() + countdownDuration * 1000;

  io.to(room.code).emit('game:countdown', {
    questionIndex: room.currentQuestionIndex,
    total: room.quizData.questions.length,
    duration: countdownDuration,
    serverTimestamp: Date.now(),
    countdownEndTime,
  });

  setTimeout(() => {
    room.phase = 'question';
    room.questionStartTime = Date.now();
    room.questionEndTime = room.questionStartTime + q.timeLimit * 1000;
    room.timeLeft = q.timeLimit;

    io.to(room.code).emit('question:show', {
      ...buildQuestionPayload(room, q),
      serverTimestamp: Date.now(),
      questionEndTime: room.questionEndTime,
    });

    clearInterval(room.timerInterval);
    room.timerInterval = setInterval(() => {
      const now = Date.now();
      const remaining = Math.ceil((room.questionEndTime - now) / 1000);
      room.timeLeft = Math.max(remaining, 0);

      io.to(room.code).emit('timer:update', {
        timeLeft: room.timeLeft,
        serverTimestamp: now,
        questionEndTime: room.questionEndTime,
      });

      if (room.timeLeft <= 0) {
        endQuestion(room, io);
      }
    }, 1000);
  }, countdownDuration * 1000);
}

/**
 * End the current question, tally results and emit them.
 * @param {object} room
 * @param {import('socket.io').Server} io
 */
function endQuestion(room, io) {
  clearInterval(room.timerInterval);
  room.phase = 'result';

  const q = room.quizData.questions[room.currentQuestionIndex];
  const results = getQuestionResults(room);
  const ranking = getRanking(room);

  room.gameHistory.push({
    questionIndex: room.currentQuestionIndex,
    question: q.question,
    answers: { ...room.answers },
  });

  io.to(room.code).emit('question:result', {
    ...results,
    ranking: ranking.slice(0, 10),
  });
}

/**
 * Start the puzzle phase.
 * @param {object} room
 * @param {import('socket.io').Server} io
 */
function startPuzzlePhase(room, io) {
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
    questionEndTime: room.questionEndTime,
  });

  room.timerInterval = setInterval(() => {
    const now = Date.now();
    const remaining = Math.ceil((room.questionEndTime - now) / 1000);
    room.timeLeft = Math.max(remaining, 0);

    io.to(room.code).emit('timer:update', {
      timeLeft: room.timeLeft,
      serverTimestamp: now,
      questionEndTime: room.questionEndTime,
    });

    if (room.timeLeft <= 0) {
      clearInterval(room.timerInterval);
      finishGame(room, io);
    }
  }, 1000);
}

/**
 * End the game and broadcast final rankings.
 * @param {object} room
 * @param {import('socket.io').Server} io
 */
function finishGame(room, io) {
  clearInterval(room.timerInterval);
  room.phase = 'final';
  const ranking = getRanking(room);
  io.to(room.code).emit('game:final', { ranking, roomCode: room.code });
}

// ==================== SOCKET EVENT REGISTRATION ====================

/**
 * Register all game-flow socket event listeners.
 *
 * @param {import('socket.io').Socket} socket
 * @param {import('socket.io').Server}  io
 * @param {object} state  Shared per-socket mutable state { currentRoom, isAdmin, isAuthenticated }
 */
function registerGameHandlers(socket, io, state) {

  // ---- ADMIN AUTH ----
  socket.on('admin:auth', ({ password, roomCode: rawCode }, callback) => {
    const roomCode = String(rawCode || '').trim().toUpperCase();
    const cb = typeof callback === 'function' ? callback : () => {};

    if (!verifyAdminPassword(password)) {
      return cb({ success: false, message: 'Mật khẩu không đúng' });
    }

    const room = getRoom(roomCode);
    if (!room) return cb({ success: false, message: 'Phòng không tồn tại' });

    state.isAuthenticated = true;
    state.isAdmin = true;
    state.currentRoom = roomCode;

    const token = generateToken();
    adminTokens.set(token, { roomCode, loginTime: Date.now(), type: 'room' });

    socket.join(roomCode);
    socket.join(`${roomCode}:admins`);

    cb({ success: true, token });
    socket.emit('game:state', buildGameState(room));
  });

  // ---- ADMIN LOGOUT ----
  socket.on('admin:logout', ({ roomCode }) => {
    state.isAuthenticated = false;
    state.isAdmin = false;
    if (roomCode) {
      socket.leave(roomCode);
      socket.leave(`${roomCode}:admins`);
    }
    state.currentRoom = null;
  });

  // ---- ADMIN JOIN (token-based reconnect) ----
  socket.on('admin:join', (data) => {
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

    if (!token || !adminTokens.has(token)) {
      return socket.emit('admin:auth:required', { roomCode });
    }

    state.isAuthenticated = true;
    state.isAdmin = true;
    state.currentRoom = roomCode;
    socket.join(roomCode);
    socket.join(`${roomCode}:admins`);

    socket.emit('game:state', buildGameState(room));
  });

  // ---- LOBBY TRANSITION ----
  socket.on('admin:startLobby', () => {
    if (!state.currentRoom || !state.isAdmin || !state.isAuthenticated) return;
    const room = getRoom(state.currentRoom);
    if (!room) return;

    room.phase = 'lobby';
    io.to(state.currentRoom).emit('game:state', buildGameState(room));
  });

  // ---- START QUIZ ----
  socket.on('admin:startQuiz', () => {
    if (!state.currentRoom || !state.isAdmin || !state.isAuthenticated) return;
    const room = getRoom(state.currentRoom);
    if (!room) return;

    room.currentQuestionIndex = 0;
    if (room.currentQuestionIndex >= room.quizData.questions.length) {
      finishGame(room, io);
      return;
    }
    startQuestion(room, io);
  });

  // ---- NEXT QUESTION ----
  socket.on('admin:nextQuestion', () => {
    if (!state.currentRoom || !state.isAdmin || !state.isAuthenticated) return;
    const room = getRoom(state.currentRoom);
    if (!room) return;

    room.currentQuestionIndex++;
    if (room.currentQuestionIndex >= room.quizData.questions.length) {
      finishGame(room, io);
      return;
    }
    startQuestion(room, io);
  });

  // ---- END QUESTION EARLY ----
  socket.on('admin:endQuestion', () => {
    if (!state.currentRoom || !state.isAdmin || !state.isAuthenticated) return;
    const room = getRoom(state.currentRoom);
    if (!room) return;
    endQuestion(room, io);
  });

  // ---- SHOW RANKING ----
  socket.on('admin:showRanking', () => {
    if (!state.currentRoom || !state.isAdmin || !state.isAuthenticated) return;
    const room = getRoom(state.currentRoom);
    if (!room) return;

    room.phase = 'ranking';
    const ranking = getRanking(room);
    io.to(state.currentRoom).emit('game:ranking', {
      ranking,
      questionIndex: room.currentQuestionIndex,
      total: room.quizData.questions.length,
    });
  });

  // ---- START PUZZLE ONLY ----
  socket.on('admin:startPuzzleOnly', () => {
    if (!state.currentRoom || !state.isAdmin || !state.isAuthenticated) return;
    const room = getRoom(state.currentRoom);
    if (!room) return;
    startPuzzlePhase(room, io);
  });

  // ---- END PUZZLE EARLY ----
  socket.on('admin:endPuzzle', () => {
    if (!state.currentRoom || !state.isAdmin || !state.isAuthenticated) return;
    const room = getRoom(state.currentRoom);
    if (!room) return;
    clearInterval(room.timerInterval);
    finishGame(room, io);
  });

  // ---- RESET ROOM ----
  socket.on('admin:reset', () => {
    if (!state.currentRoom || !state.isAdmin || !state.isAuthenticated) return;
    const room = getRoom(state.currentRoom);
    if (!room) return;

    clearInterval(room.timerInterval);
    room.phase = 'lobby';
    room.currentQuestionIndex = -1;
    room.answers = {};
    room.gameHistory = [];
    room.autoEnding = false;
    room.puzzleResults = {};
    Object.values(room.players).forEach((p) => {
      p.score = 0; p.streak = 0; p.maxStreak = 0;
      p.correctCount = 0; p.answered = false;
    });
    io.to(state.currentRoom).emit('game:reset');
  });

  // ---- PLAYER ANSWER ----
  socket.on('player:answer', (data) => {
    if (!state.currentRoom) return;
    const room = getRoom(state.currentRoom);
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;

    // ---- Test / self-hosted quiz mode ----
    if (player.gameType === 'quiz') {
      const qIndex = player.testQIndex || 0;
      const q = room.quizData.questions[qIndex];
      const timeTaken = (Date.now() - player.testQStart) / 1000;
      const isCorrect = checkAnswer(q, data);
      const points = isCorrect ? calculatePoints(timeTaken, q.timeLimit, q.points) : 0;

      player.score += points;
      socket.emit('answer:confirmed', {
        selected: data.option,
        timeTaken: Math.round(timeTaken * 10) / 10,
        correct: isCorrect,
        points,
      });

      setTimeout(() => {
        if (!socket.connected || !room.players[socket.id]) return;
        socket.emit('question:result', {
          question: q.question,
          options: q.options,
          correct: q.correct,
          type: q.type,
          optionCounts: [],
          totalAnswered: 1,
          totalPlayers: 1,
          correctCount: isCorrect ? 1 : 0,
          ranking: [player],
        });
        setTimeout(() => {
          if (!socket.connected || !room.players[socket.id]) return;
          player.testQIndex++;
          player.sendTestQ(player.testQIndex);
        }, 3000);
      }, 1000);

      return;
    }

    // ---- Normal multiplayer ----
    if (room.phase !== 'question') return;
    if (room.answers[socket.id]) return; // already answered

    const q = room.quizData.questions[room.currentQuestionIndex];
    const timeTaken = (Date.now() - room.questionStartTime) / 1000;
    if (timeTaken > q.timeLimit + 1) return; // too late

    const isCorrect = checkAnswer(q, data);
    const points = isCorrect ? calculatePoints(timeTaken, q.timeLimit, q.points) : 0;

    room.answers[socket.id] = {
      option: data.option,
      options: data.options,
      text: data.text,
      optionText: q.options ? q.options[data.option] : data.text,
      time: timeTaken,
      correct: isCorrect,
      points,
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
      selected: data.option,
      timeTaken: Math.round(timeTaken * 10) / 10,
      correct: isCorrect,
      points,
    });

    // Push live monitor update to admins
    const monitorData = Object.entries(room.players).map(([sid, p]) => ({
      name: p.name,
      score: p.score,
      answered: !!room.answers[sid],
    }));
    io.to(`${state.currentRoom}:admins`).emit('answers:update', {
      answered: Object.keys(room.answers).length,
      total: Object.values(room.players).filter((p) => !p.gameType || p.gameType === 'quiz').length,
      monitor: monitorData,
    });

    // Auto-end if everyone answered
    const realPlayers = Object.values(room.players).filter((p) => !p.gameType);
    if (
      realPlayers.length > 0 &&
      Object.keys(room.answers).length >= realPlayers.length &&
      !room.autoEnding
    ) {
      room.autoEnding = true;
      console.log(`[${state.currentRoom}] All players answered. Auto-ending in 3s...`);
      setTimeout(() => {
        if (room.phase === 'question') endQuestion(room, io);
      }, 3000);
    }
  });

  // ---- PUZZLE COMPLETE ----
  socket.on('puzzle:complete', (data) => {
    if (!state.currentRoom) return;
    const room = getRoom(state.currentRoom);
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;

    // Self-hosted puzzle test mode
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
      name: player.name,
    };

    const totalPlayers = Object.values(room.players).filter(
      (p) => !p.gameType || p.gameType === 'puzzle',
    ).length;
    const completedCount = Object.values(room.puzzleResults).filter((r) => r.completed).length;

    io.to(room.code).emit('puzzle:progress', {
      completed: completedCount,
      total: totalPlayers,
      results: Object.values(room.puzzleResults),
    });

    socket.emit('puzzle:confirmed', { moves: data.moves, time: data.time });
  });
}

module.exports = { registerGameHandlers, buildGameState };
