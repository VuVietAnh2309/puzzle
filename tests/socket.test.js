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
