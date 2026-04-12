const Room = require('../src/models/Room');
const Player = require('../src/models/Player');

function makeQuizData() {
  return {
    title: 'Test Quiz',
    questions: [
      {
        id: 'q1', type: 'multiple', question: 'What is 1+1?',
        options: ['1', '2', '3', '4'], correct: [1],
        timeLimit: 15, points: 1, image: null,
      },
      {
        id: 'q2', type: 'truefalse', question: 'Sky is blue?',
        options: ['True', 'False'], correct: [0],
        timeLimit: 10, points: 1, image: null,
      },
      {
        id: 'q3', type: 'text', question: 'Capital of France?',
        options: [], correct: ['Paris', 'paris'],
        timeLimit: 20, points: 1, image: null,
      },
    ],
    puzzle: { image: '/uploads/test.png', gridSize: 3, timeLimit: 120 },
  };
}

function addPlayers(room) {
  const p1 = new Player({ playerId: 'pid1', name: 'Alice', logo: null });
  const p2 = new Player({ playerId: 'pid2', name: 'Bob', logo: null });
  const p3 = new Player({ playerId: 'pid3', name: 'Charlie', logo: null });
  room.addPlayer('s1', p1);
  room.addPlayer('s2', p2);
  room.addPlayer('s3', p3);
  return { p1, p2, p3 };
}

describe('Room', () => {
  let room;

  beforeEach(() => {
    room = new Room('ABC123', makeQuizData(), 'Test Room');
  });

  describe('constructor', () => {
    test('initializes with correct defaults', () => {
      expect(room.code).toBe('ABC123');
      expect(room.name).toBe('Test Room');
      expect(room.phase).toBe('banner');
      expect(room.currentQuestionIndex).toBe(-1);
      expect(room.questionStartTime).toBeNull();
      expect(room.questionEndTime).toBeNull();
      expect(room.timeLeft).toBe(0);
      expect(Object.keys(room.players)).toHaveLength(0);
    });
  });

  describe('GamePhase constants', () => {
    test('has all expected phases', () => {
      expect(Room.GamePhase).toEqual({
        BANNER: 'banner',
        LOBBY: 'lobby',
        COUNTDOWN: 'countdown',
        QUESTION: 'question',
        RESULT: 'result',
        RANKING: 'ranking',
        PUZZLE: 'puzzle',
        FINAL: 'final',
      });
    });
  });

  describe('player management', () => {
    test('addPlayer and getPlayerBySocketId', () => {
      const p = new Player({ playerId: 'pid1', name: 'Alice', logo: null });
      room.addPlayer('s1', p);
      expect(room.getPlayerBySocketId('s1')).toBe(p);
      expect(room.getPlayerBySocketId('s999')).toBeUndefined();
    });

    test('removePlayer returns player and removes from room', () => {
      const p = new Player({ playerId: 'pid1', name: 'Alice', logo: null });
      room.addPlayer('s1', p);

      const removed = room.removePlayer('s1');
      expect(removed).toBe(p);
      expect(room.getPlayerBySocketId('s1')).toBeUndefined();
    });

    test('removePlayer returns null for unknown socket', () => {
      expect(room.removePlayer('s999')).toBeNull();
    });
  });

  describe('nextQuestion', () => {
    test('advances index and returns true when more questions', () => {
      room.currentQuestionIndex = -1;
      expect(room.nextQuestion()).toBe(true);
      expect(room.currentQuestionIndex).toBe(0);

      expect(room.nextQuestion()).toBe(true);
      expect(room.currentQuestionIndex).toBe(1);
    });

    test('returns false when no more questions', () => {
      room.currentQuestionIndex = 2; // last question (0-indexed, 3 total)
      expect(room.nextQuestion()).toBe(false);
      expect(room.currentQuestionIndex).toBe(3);
    });
  });

  describe('getCurrentQuestion', () => {
    test('returns correct question by index', () => {
      room.currentQuestionIndex = 0;
      expect(room.getCurrentQuestion().id).toBe('q1');

      room.currentQuestionIndex = 2;
      expect(room.getCurrentQuestion().id).toBe('q3');
    });

    test('returns null when index is out of range', () => {
      room.currentQuestionIndex = -1;
      expect(room.getCurrentQuestion()).toBeNull();

      room.currentQuestionIndex = 99;
      expect(room.getCurrentQuestion()).toBeNull();
    });
  });

  describe('getRanking', () => {
    test('sorts by score descending', () => {
      const { p1, p2, p3 } = addPlayers(room);
      p1.score = 5;
      p2.score = 10;
      p3.score = 3;

      const ranking = room.getRanking();
      expect(ranking[0].name).toBe('Bob');
      expect(ranking[0].rank).toBe(1);
      expect(ranking[1].name).toBe('Alice');
      expect(ranking[2].name).toBe('Charlie');
    });

    test('breaks ties by lastAnswerTime (faster first)', () => {
      const { p1, p2 } = addPlayers(room);
      p1.score = 5;
      p1.lastAnswerTime = 8;
      p2.score = 5;
      p2.lastAnswerTime = 3;

      const ranking = room.getRanking();
      expect(ranking[0].name).toBe('Bob');   // faster
      expect(ranking[1].name).toBe('Alice');
    });

    test('returns empty array when no players', () => {
      expect(room.getRanking()).toEqual([]);
    });
  });

  describe('getQuestionResults', () => {
    test('counts option selections correctly', () => {
      addPlayers(room);
      room.currentQuestionIndex = 0; // multiple choice with 4 options

      room.answers = {
        s1: { option: 1, correct: true, points: 2 },
        s2: { option: 0, correct: false, points: 0 },
        s3: { option: 1, correct: true, points: 1.75 },
      };

      const result = room.getQuestionResults();
      expect(result.optionCounts).toEqual([1, 2, 0, 0]);
      expect(result.correctCount).toBe(2);
      expect(result.totalAnswered).toBe(3);
      expect(result.totalPlayers).toBe(3);
      expect(result.correct).toEqual([1]);
    });

    test('returns null when no current question', () => {
      room.currentQuestionIndex = -1;
      expect(room.getQuestionResults()).toBeNull();
    });

    test('excludes puzzle-only players from totalPlayers', () => {
      const p1 = new Player({ playerId: 'pid1', name: 'Alice', logo: null });
      const p2 = new Player({ playerId: 'pid2', name: 'Bob', logo: null, gameType: 'puzzle' });
      room.addPlayer('s1', p1);
      room.addPlayer('s2', p2);
      room.currentQuestionIndex = 0;
      room.answers = {};

      const result = room.getQuestionResults();
      expect(result.totalPlayers).toBe(1); // only Alice counts
    });
  });

  describe('getStateSnapshot', () => {
    test('includes all expected fields', () => {
      addPlayers(room);
      room.phase = 'question';
      room.currentQuestionIndex = 1;
      room.questionEndTime = Date.now() + 10000;
      room.timeLeft = 10;

      const snap = room.getStateSnapshot();
      expect(snap.phase).toBe('question');
      expect(snap.roomCode).toBe('ABC123');
      expect(snap.roomName).toBe('Test Room');
      expect(snap.questionIndex).toBe(1);
      expect(snap.totalQuestions).toBe(3);
      expect(snap.playerCount).toBe(3);
      expect(snap.players).toHaveLength(3);
      expect(snap.questionEndTime).toBeDefined();
      expect(snap.timeLeft).toBe(10);
      expect(snap.serverTimestamp).toBeDefined();
    });
  });

  describe('reset', () => {
    test('resets room state to lobby', () => {
      const { p1 } = addPlayers(room);
      room.phase = 'final';
      room.currentQuestionIndex = 2;
      room.answers = { s1: { option: 0 } };
      room.gameHistory = [{ q: 1 }];
      room.puzzleResults = { s1: { completed: true } };
      p1.score = 10;

      room.reset();

      expect(room.phase).toBe('lobby');
      expect(room.currentQuestionIndex).toBe(-1);
      expect(room.answers).toEqual({});
      expect(room.gameHistory).toEqual([]);
      expect(room.puzzleResults).toEqual({});
      expect(room.questionStartTime).toBeNull();
      expect(room.questionEndTime).toBeNull();
      expect(p1.score).toBe(0); // player also reset
    });
  });

  describe('setPhase', () => {
    test('changes the phase', () => {
      room.setPhase(Room.GamePhase.LOBBY);
      expect(room.phase).toBe('lobby');
      room.setPhase(Room.GamePhase.PUZZLE);
      expect(room.phase).toBe('puzzle');
    });
  });

  describe('stopTimer', () => {
    test('clears interval and sets to null', () => {
      room.timerInterval = setInterval(() => {}, 1000);
      room.stopTimer();
      expect(room.timerInterval).toBeNull();
    });

    test('handles null timerInterval gracefully', () => {
      room.timerInterval = null;
      expect(() => room.stopTimer()).not.toThrow();
    });
  });
});
