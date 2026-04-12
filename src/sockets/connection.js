/**
 * src/sockets/connection.js
 * Handles socket lifecycle events: join room, disconnect, time sync.
 */

const {
  rooms,
  getRoom,
  getRanking,
  getQuestionResults,
  buildQuestionPayload,
  getRandomizedQuizData,
} = require('../services/roomService');

const Player = require('../models/Player');
const Room = require('../models/Room');

/**
 * Register connection-lifecycle socket event listeners.
 *
 * @param {import('socket.io').Socket} socket
 * @param {import('socket.io').Server}  io
 * @param {object} state  Shared per-socket mutable state { currentRoom, isAdmin, isAuthenticated }
 */
function registerConnectionHandlers(socket, io, state) {
  // --- NTP-style time sync ---
  socket.on('time:sync', (clientTimestamp) => {
    socket.emit('time:sync:reply', {
      clientTimestamp,
      serverTimestamp: Date.now(),
    });
  });

  // --- Player join ---
  socket.on('player:join', ({ roomCode: rawCode, name, logo, gameType, playerId }) => {
    const roomCode = String(rawCode || '').trim().toUpperCase();
    let room = getRoom(roomCode);

    // Allow self-hosted test rooms (TEST_xxx)
    if (!room && gameType && typeof roomCode === 'string' && roomCode.startsWith('TEST_')) {
      const isRandomized = gameType === 'quiz';
      rooms[roomCode] = {
        code: roomCode,
        phase: Room.GamePhase.LOBBY,
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
        createdAt: Date.now(),
      };
      room = rooms[roomCode];
    }

    if (!room) return socket.emit('error', { message: 'Phòng không tồn tại' });

    const persistentId = playerId || socket.id;
    let player = null;

    // Check active players first (reconnect from different socket)
    for (const sid in room.players) {
      if (room.players[sid].playerId === persistentId) {
        player = room.players[sid];
        delete room.players[sid];
        break;
      }
    }

    // Then check inactive players
    if (!player && room.inactivePlayers[persistentId]) {
      player = room.inactivePlayers[persistentId];
      if (player.cleanupTimer) clearTimeout(player.cleanupTimer);
      delete room.inactivePlayers[persistentId];
    }

    const safeName = String(name).slice(0, 30).replace(/[<>]/g, '');
    const safeLogo = logo && typeof logo === 'string' ? String(logo).slice(0, 200) : null;

    if (player) {
      room.addPlayer(socket.id, player);
      console.log(`[${roomCode}] Player reconnected: ${player.name}`);
    } else {
      room.addPlayer(socket.id, new Player({
        playerId: persistentId,
        name: safeName,
        logo: safeLogo,
        gameType: gameType || null,
      }));
    }

    state.currentRoom = roomCode;
    socket.join(roomCode);
    socket.join(`${roomCode}:players`);

    // Send current game state snapshot
    socket.emit('game:state', room.getStateSnapshot());

    // Handle specialised game-type join responses
    if (gameType === 'puzzle') {
      const pz = room.quizData.puzzle || {};
      socket.emit('game:puzzle', {
        image: pz.image,
        gridSize: pz.gridSize || 3,
        timeLimit: pz.timeLimit || 120,
        serverTimestamp: Date.now(),
        questionEndTime: Date.now() + (pz.timeLimit || 120) * 1000,
      });
    } else if (gameType === 'quiz') {
      room.players[socket.id].testQIndex = 0;

      function sendTestQ(idx) {
        const q = room.quizData.questions[idx];
        if (!q) return socket.emit('game:final', { ranking: [room.players[socket.id]] });
        socket.emit('game:countdown', {
          questionIndex: idx,
          total: room.quizData.questions.length,
          duration: 3,
          serverTimestamp: Date.now(),
          countdownEndTime: Date.now() + 3000,
        });
        setTimeout(() => {
          if (!room.players[socket.id]) return;
          room.players[socket.id].testQStart = Date.now();
          socket.emit('question:show', {
            id: q.id,
            type: q.type,
            question: q.question,
            options: q.options,
            image: q.image,
            index: idx,
            total: room.quizData.questions.length,
            timeLimit: q.timeLimit,
            points: q.points,
            serverTimestamp: Date.now(),
            questionEndTime: Date.now() + q.timeLimit * 1000,
          });
        }, 3000);
      }

      room.players[socket.id].sendTestQ = sendTestQ;
      sendTestQ(0);
    } else {
      // Regular player — restore state mid-game
      if (room.phase === Room.GamePhase.QUESTION && room.currentQuestionIndex >= 0) {
        const q = room.quizData.questions[room.currentQuestionIndex];
        socket.emit('question:show', buildQuestionPayload(room, q));
      } else if ((room.phase === Room.GamePhase.RESULT || room.phase === Room.GamePhase.RANKING) && room.currentQuestionIndex >= 0) {
        const results = getQuestionResults(room);
        const ranking = getRanking(room);
        socket.emit('question:result', { ...results, ranking });
        if (room.phase === Room.GamePhase.RANKING) {
          socket.emit('game:ranking', {
            ranking,
            questionIndex: room.currentQuestionIndex,
            total: room.quizData.questions.length,
          });
        }
      } else if (room.phase === Room.GamePhase.FINAL) {
        socket.emit('game:final', { ranking: getRanking(room) });
      }
    }

    io.to(roomCode).emit('players:update', {
      count: Object.keys(room.players).length,
      list: Object.values(room.players).map((p) => ({ name: p.name, logo: p.logo })),
    });

    console.log(`[${roomCode}] Player joined: ${safeName}`);
  });

  // --- Disconnect ---
  socket.on('disconnect', () => {
    const roomCode = state.currentRoom;
    if (!roomCode) return;

    const room = getRoom(roomCode);
    if (!room || !room.players[socket.id]) return;

    const player = room.removePlayer(socket.id);
    if (!player) return;

    console.log(`[${roomCode}] Player disconnected (temporary): ${player.name}`);

    const pid = player.playerId;
    room.inactivePlayers[pid] = player;

    // Expire inactive player after 60 s
    player.cleanupTimer = setTimeout(() => {
      if (room.inactivePlayers[pid]) {
        console.log(`[${roomCode}] Player session expired: ${player.name}`);
        delete room.inactivePlayers[pid];
        io.to(roomCode).emit('players:update', {
          count: Object.keys(room.players).length,
          list: Object.values(room.players).map((p) => ({ name: p.name, logo: p.logo })),
        });
      }
    }, 60000);

    io.to(roomCode).emit('players:update', {
      count: Object.keys(room.players).length,
      list: Object.values(room.players).map((p) => ({ name: p.name, logo: p.logo })),
    });
  });
}

module.exports = { registerConnectionHandlers };
