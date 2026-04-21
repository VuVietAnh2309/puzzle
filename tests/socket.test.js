/**
 * Socket integration tests
 * Tests player join/reconnect, admin auth/reconnect, and puzzle reconnect flow.
 */

const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const ClientIO = require('socket.io-client');
const { registerConnectionHandlers } = require('../src/sockets/connection');
const { registerGameHandlers } = require('../src/sockets/game-logic');
const { rooms, createRoom } = require('../src/services/roomService');
const { adminTokens, generateToken } = require('../src/config');
const Room = require('../src/models/Room');

let httpServer, io, port;

function connectClient(opts = {}) {
  return ClientIO(`http://localhost:${port}`, {
    transports: ['websocket'],
    forceNew: true,
    ...opts,
  });
}

function waitForEvent(socket, event, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for '${event}'`)), timeout);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

beforeAll((done) => {
  const app = express();
  httpServer = http.createServer(app);
  io = new Server(httpServer);

  io.on('connection', (socket) => {
    const state = { currentRoom: null, isAdmin: false, isAuthenticated: false };
    registerConnectionHandlers(socket, io, state);
    registerGameHandlers(socket, io, state);
  });

  httpServer.listen(0, () => {
    port = httpServer.address().port;
    done();
  });
});

afterAll((done) => {
  io.close();
  httpServer.close(done);
});

// Clean up rooms between tests
afterEach(() => {
  for (const code of Object.keys(rooms)) {
    if (rooms[code].timerInterval) clearInterval(rooms[code].timerInterval);
    delete rooms[code];
  }
  adminTokens.clear();
});

describe('Player join and reconnect', () => {
  test('player can join a room and receive game:state', async () => {
    const room = createRoom();
    const client = connectClient();

    try {
      const statePromise = waitForEvent(client, 'game:state');
      client.emit('player:join', { roomCode: room.code, name: 'Alice', logo: null, playerId: 'p1' });
      const state = await statePromise;

      expect(state.phase).toBe('banner');
      expect(state.roomCode).toBe(room.code);
      expect(state.playerCount).toBe(1);
    } finally {
      client.close();
    }
  });

  test('error when joining non-existent room', async () => {
    const client = connectClient();

    try {
      const errPromise = waitForEvent(client, 'error');
      client.emit('player:join', { roomCode: 'INVALID', name: 'Bob', playerId: 'p2' });
      const err = await errPromise;
      expect(err.message).toContain('không tồn tại');
    } finally {
      client.close();
    }
  });

  test('player reconnects with same playerId and keeps score', async () => {
    const room = createRoom();
    room.setPhase(Room.GamePhase.LOBBY);

    // First connection
    const client1 = connectClient();
    const statePromise1 = waitForEvent(client1, 'game:state');
    client1.emit('player:join', { roomCode: room.code, name: 'Alice', logo: null, playerId: 'reconnect-1' });
    await statePromise1;

    // Give the player some score
    const sid1 = Object.keys(room.players).find(sid => room.players[sid].playerId === 'reconnect-1');
    room.players[sid1].score = 42;

    // Disconnect first client
    client1.close();

    // Wait a bit for server to process disconnect
    await new Promise(r => setTimeout(r, 200));

    // Reconnect with same playerId
    const client2 = connectClient();
    try {
      const statePromise2 = waitForEvent(client2, 'game:state');
      client2.emit('player:join', { roomCode: room.code, name: 'Alice', logo: null, playerId: 'reconnect-1' });
      const state2 = await statePromise2;

      expect(state2.playerCount).toBe(1);

      // Verify the player's score was preserved
      const sid2 = Object.keys(room.players).find(sid => room.players[sid].playerId === 'reconnect-1');
      expect(room.players[sid2].score).toBe(42);
    } finally {
      client2.close();
    }
  });
});

describe('Admin auth and reconnect', () => {
  test('admin:auth with correct password returns token', async () => {
    const room = createRoom();
    const client = connectClient();

    try {
      const result = await new Promise((resolve) => {
        client.emit('admin:auth', { password: 'admin123', roomCode: room.code }, resolve);
      });

      expect(result.success).toBe(true);
      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe('string');
    } finally {
      client.close();
    }
  });

  test('admin:auth with wrong password fails', async () => {
    const room = createRoom();
    const client = connectClient();

    try {
      const result = await new Promise((resolve) => {
        client.emit('admin:auth', { password: 'wrong', roomCode: room.code }, resolve);
      });

      expect(result.success).toBe(false);
    } finally {
      client.close();
    }
  });

  test('admin:join with valid token reconnects', async () => {
    const room = createRoom();

    // Get a token via auth
    const client1 = connectClient();
    const authResult = await new Promise((resolve) => {
      client1.emit('admin:auth', { password: 'admin123', roomCode: room.code }, resolve);
    });
    client1.close();
    await new Promise(r => setTimeout(r, 100));

    // Reconnect with token
    const client2 = connectClient();
    try {
      const statePromise = waitForEvent(client2, 'game:state');
      client2.emit('admin:join', { roomCode: room.code, token: authResult.token });
      const state = await statePromise;

      expect(state.phase).toBeDefined();
      expect(state.roomCode).toBe(room.code);
    } finally {
      client2.close();
    }
  });

  test('admin:join with invalid token requires auth', async () => {
    const room = createRoom();
    const client = connectClient();

    try {
      const authReqPromise = waitForEvent(client, 'admin:auth:required');
      client.emit('admin:join', { roomCode: room.code, token: 'fake-token' });
      const data = await authReqPromise;
      expect(data.roomCode).toBe(room.code);
    } finally {
      client.close();
    }
  });
});

describe('Game flow', () => {
  test('admin starts quiz → countdown → question:show flow', async () => {
    const room = createRoom();
    room.setPhase(Room.GamePhase.LOBBY);

    const admin = connectClient();
    const player = connectClient();

    try {
      // Auth admin
      const authResult = await new Promise((resolve) => {
        admin.emit('admin:auth', { password: 'admin123', roomCode: room.code }, resolve);
      });
      expect(authResult.success).toBe(true);

      // Join player
      const playerStatePromise = waitForEvent(player, 'game:state');
      player.emit('player:join', { roomCode: room.code, name: 'Alice', playerId: 'flow-p1' });
      await playerStatePromise;

      // Start quiz
      const countdownPromise = waitForEvent(player, 'game:countdown');
      admin.emit('admin:startQuiz');
      const countdown = await countdownPromise;

      expect(countdown.questionIndex).toBe(0);
      expect(countdown.duration).toBe(3);
      expect(countdown.countdownEndTime).toBeDefined();

      // Wait for question:show (after 3s countdown)
      const questionPromise = waitForEvent(player, 'question:show', 5000);
      const question = await questionPromise;

      expect(question.index).toBe(0);
      expect(question.question).toBeDefined();
      expect(question.questionEndTime).toBeDefined();
    } finally {
      admin.close();
      player.close();
    }
  }, 10000);

  test('player answers → receives confirmation', async () => {
    const room = createRoom();
    room.setPhase(Room.GamePhase.LOBBY);

    const admin = connectClient();
    const player = connectClient();

    try {
      await new Promise((resolve) => {
        admin.emit('admin:auth', { password: 'admin123', roomCode: room.code }, resolve);
      });

      const playerStatePromise = waitForEvent(player, 'game:state');
      player.emit('player:join', { roomCode: room.code, name: 'Bob', playerId: 'flow-p2' });
      await playerStatePromise;

      // Start quiz and wait for question
      admin.emit('admin:startQuiz');
      const question = await waitForEvent(player, 'question:show', 5000);

      // Answer the question
      const confirmPromise = waitForEvent(player, 'answer:confirmed');
      player.emit('player:answer', { option: question.options ? 0 : undefined, text: 'test' });
      const confirm = await confirmPromise;

      expect(confirm.timeTaken).toBeDefined();
      expect(typeof confirm.correct).toBe('boolean');
    } finally {
      admin.close();
      player.close();
    }
  }, 10000);
});

describe('Puzzle reconnect (bug fix)', () => {
  test('player reconnects during puzzle phase and receives game:puzzle', async () => {
    const room = createRoom();

    // Add a player and start puzzle
    const client1 = connectClient();
    const statePromise1 = waitForEvent(client1, 'game:state');
    client1.emit('player:join', { roomCode: room.code, name: 'Alice', playerId: 'puzzle-p1' });
    await statePromise1;

    // Start puzzle phase via admin
    const admin = connectClient();
    await new Promise((resolve) => {
      admin.emit('admin:auth', { password: 'admin123', roomCode: room.code }, resolve);
    });

    const puzzlePromise1 = waitForEvent(client1, 'game:puzzle');
    admin.emit('admin:startPuzzleOnly');
    const puzzleData = await puzzlePromise1;

    expect(puzzleData.questionEndTime).toBeDefined();
    expect(puzzleData.gridSize).toBeDefined();

    // Disconnect player
    client1.close();
    await new Promise(r => setTimeout(r, 200));

    // Reconnect player
    const client2 = connectClient();
    try {
      const puzzlePromise2 = waitForEvent(client2, 'game:puzzle');
      client2.emit('player:join', { roomCode: room.code, name: 'Alice', playerId: 'puzzle-p1' });
      const puzzleReconnect = await puzzlePromise2;

      // Should receive puzzle config with remaining time (not reset to full)
      expect(puzzleReconnect.questionEndTime).toBeDefined();
      expect(puzzleReconnect.gridSize).toBeDefined();
      // The questionEndTime should be the same as the original (server's stored value)
      expect(puzzleReconnect.questionEndTime).toBe(room.questionEndTime);
    } finally {
      client2.close();
      admin.close();
    }
  });

  test('admin reconnects during puzzle phase and receives game:puzzle with correct timer', async () => {
    const room = createRoom();
    room.setPhase(Room.GamePhase.LOBBY);

    // Auth admin and start puzzle
    const admin1 = connectClient();
    const authResult = await new Promise((resolve) => {
      admin1.emit('admin:auth', { password: 'admin123', roomCode: room.code }, resolve);
    });

    const puzzlePromise = waitForEvent(admin1, 'game:puzzle');
    admin1.emit('admin:startPuzzleOnly');
    await puzzlePromise;

    const savedEndTime = room.questionEndTime;

    // Disconnect admin
    admin1.close();
    await new Promise(r => setTimeout(r, 200));

    // Reconnect admin with token
    const admin2 = connectClient();
    try {
      const statePromise = waitForEvent(admin2, 'game:state');
      const puzzlePromise2 = waitForEvent(admin2, 'game:puzzle');

      admin2.emit('admin:join', { roomCode: room.code, token: authResult.token });

      const state = await statePromise;
      expect(state.phase).toBe('puzzle');
      expect(state.questionEndTime).toBe(savedEndTime);

      const puzzleData = await puzzlePromise2;
      expect(puzzleData.questionEndTime).toBe(savedEndTime);
      expect(puzzleData.gridSize).toBeDefined();
    } finally {
      admin2.close();
    }
  });
});

describe('Disconnect and inactive player cleanup', () => {
  test('disconnected player moves to inactivePlayers', async () => {
    const room = createRoom();
    const client = connectClient();

    const statePromise = waitForEvent(client, 'game:state');
    client.emit('player:join', { roomCode: room.code, name: 'Alice', playerId: 'dc-p1' });
    await statePromise;

    expect(Object.keys(room.players)).toHaveLength(1);

    client.close();
    await new Promise(r => setTimeout(r, 200));

    expect(Object.keys(room.players)).toHaveLength(0);
    expect(room.inactivePlayers['dc-p1']).toBeDefined();
    expect(room.inactivePlayers['dc-p1'].name).toBe('Alice');

    // Clean up the cleanup timer to prevent Jest open handle warning
    if (room.inactivePlayers['dc-p1']?.cleanupTimer) {
      clearTimeout(room.inactivePlayers['dc-p1'].cleanupTimer);
    }
  });
});

describe('Ghost player filtering (6 users scenario)', () => {
  /**
   * Scenario:
   *   - 6 players join the lobby.
   *   - Player #3 disconnects BEFORE any question is asked (a "ghost" — they
   *     joined and left without ever playing).
   *   - Admin starts the quiz.
   *   - All remaining 5 active players answer Q1.
   *   - Player #5 disconnects AFTER answering Q1 (a legit player who leaves
   *     mid-game — should still count in the ranking).
   *   - Admin ends Q1 and we verify the final ranking.
   *
   * Expectation after fix:
   *   - Ranking contains exactly 5 players (4 still connected + Player #5).
   *   - Player #3 (the ghost) is NOT in the ranking.
   *   - Player #5 is still in the ranking with their earned score.
   *   - Final ranking does not include anyone with score 0 who never answered.
   */
  test('ghost players (joined-then-left without answering) are excluded from ranking', async () => {
    const room = createRoom();
    room.setPhase(Room.GamePhase.LOBBY);

    // --- Admin auth ---
    const admin = connectClient();
    const authResult = await new Promise((resolve) => {
      admin.emit('admin:auth', { password: 'admin123', roomCode: room.code }, resolve);
    });
    expect(authResult.success).toBe(true);

    // --- 6 players join ---
    const playerNames = ['Alice', 'Bob', 'Charlie', 'Dave', 'Eve', 'Frank'];
    const clients = [];
    for (let i = 0; i < 6; i++) {
      const c = connectClient();
      const statePromise = waitForEvent(c, 'game:state');
      c.emit('player:join', {
        roomCode: room.code,
        name: playerNames[i],
        playerId: `ghost-test-p${i + 1}`,
      });
      await statePromise;
      clients.push(c);
    }
    expect(Object.keys(room.players)).toHaveLength(6);

    // --- Player #3 (Charlie) disconnects BEFORE quiz starts — pure ghost ---
    clients[2].close();
    await new Promise(r => setTimeout(r, 200));
    expect(room.inactivePlayers['ghost-test-p3']).toBeDefined();
    expect(room.inactivePlayers['ghost-test-p3'].hasEverAnswered).toBe(false);

    // --- Admin starts quiz ---
    const countdownPromises = [0, 1, 3, 4, 5].map(i => waitForEvent(clients[i], 'game:countdown', 5000));
    admin.emit('admin:startQuiz');
    await Promise.all(countdownPromises);

    // Wait for question:show
    const questionPromises = [0, 1, 3, 4, 5].map(i => waitForEvent(clients[i], 'question:show', 5000));
    await Promise.all(questionPromises);

    // `q.correct` is intentionally stripped from the payload sent to players
    // (players shouldn't know the answer). Read it from the server's own
    // room data instead.
    const serverQ = room.quizData.questions[0];
    const correctIdx = Array.isArray(serverQ.correct) ? serverQ.correct[0] : serverQ.correct;
    const wrongIdx = correctIdx === 0 ? 1 : 0;

    // --- All 5 remaining players answer ---
    // Alice, Bob, Dave, Eve, Frank — first three correct, last two wrong.
    const answerPlan = [
      { clientIdx: 0, option: correctIdx },  // Alice correct
      { clientIdx: 1, option: correctIdx },  // Bob correct
      { clientIdx: 3, option: correctIdx },  // Dave correct
      { clientIdx: 4, option: wrongIdx },    // Eve wrong
      { clientIdx: 5, option: correctIdx },  // Frank correct
    ];

    for (const a of answerPlan) {
      const confirmP = waitForEvent(clients[a.clientIdx], 'answer:confirmed', 3000);
      clients[a.clientIdx].emit('player:answer', { option: a.option });
      await confirmP;
    }

    // Every real quiz player now has hasEverAnswered=true
    Object.values(room.players).forEach((p) => {
      expect(p.hasEverAnswered).toBe(true);
    });

    // --- Player #5 (Frank) disconnects AFTER answering — legit mid-game leaver ---
    clients[5].close();
    await new Promise(r => setTimeout(r, 200));
    expect(room.inactivePlayers['ghost-test-p6']).toBeDefined();
    expect(room.inactivePlayers['ghost-test-p6'].hasEverAnswered).toBe(true);

    // --- Admin ends the question, capture result ---
    const resultPromise = waitForEvent(clients[0], 'question:result', 5000);
    admin.emit('admin:endQuestion');
    const result = await resultPromise;

    const ranking = result.ranking || [];
    const names = ranking.map(r => r.name);

    // Assertions — ghost filtering
    expect(ranking).toHaveLength(5);
    expect(names).toContain('Alice');
    expect(names).toContain('Bob');
    expect(names).toContain('Dave');
    expect(names).toContain('Eve');
    expect(names).toContain('Frank');      // Legit leaver still present
    expect(names).not.toContain('Charlie'); // Ghost excluded

    // Eve (the only wrong answerer) must have a lower score than any correct
    // answerer. Every correct answerer should rank above her.
    const eve = ranking.find(r => r.name === 'Eve');
    const correctAnswerers = ['Alice', 'Bob', 'Dave', 'Frank'].map(n => ranking.find(r => r.name === n));
    for (const p of correctAnswerers) {
      expect(p.score).toBeGreaterThan(eve.score);
      expect(p.rank).toBeLessThan(eve.rank);
    }

    // Cleanup
    clients.forEach(c => c.connected && c.close());
    admin.close();
    Object.values(room.inactivePlayers).forEach((p) => {
      if (p.cleanupTimer) clearTimeout(p.cleanupTimer);
    });
  }, 20000);

  /**
   * Directly exercises Room.getRanking() without socket plumbing:
   * confirms that an inactive player flagged as `hasEverAnswered: false`
   * is dropped while an inactive player with `hasEverAnswered: true` stays.
   */
  test('Room.getRanking filters inactive players without hasEverAnswered', () => {
    const Player = require('../src/models/Player');
    const room = new Room('UNIT_TEST', {
      title: 'Unit',
      questions: [{ id: 1, type: 'multiple', question: 'q', options: ['a','b'], correct: [0], timeLimit: 15, points: 1, image: null }],
      puzzle: { image: null, gridSize: 3, timeLimit: 60 },
    }, 'Unit');

    // Active player (included unconditionally)
    const active = new Player({ playerId: 'a1', name: 'ActiveNoAnswer', logo: null });
    room.players['sid-a1'] = active;

    // Inactive player who answered at least once (legit)
    const legit = new Player({ playerId: 'i1', name: 'LegitLeaver', logo: null });
    legit.hasEverAnswered = true;
    legit.score = 2;
    room.inactivePlayers['i1'] = legit;

    // Inactive player who never answered (ghost)
    const ghost = new Player({ playerId: 'i2', name: 'GhostPlayer', logo: null });
    ghost.hasEverAnswered = false;
    room.inactivePlayers['i2'] = ghost;

    const ranking = room.getRanking();
    const names = ranking.map(r => r.name);
    expect(names).toContain('ActiveNoAnswer');
    expect(names).toContain('LegitLeaver');
    expect(names).not.toContain('GhostPlayer');
    expect(ranking).toHaveLength(2);
  });
});
