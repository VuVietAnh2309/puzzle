const Player = require('../src/models/Player');

describe('Player', () => {
  let player;

  beforeEach(() => {
    player = new Player({ playerId: 'p1', name: 'Alice', logo: '/logos/cat.png', gameType: null });
  });

  describe('constructor', () => {
    test('initializes with correct defaults', () => {
      expect(player.playerId).toBe('p1');
      expect(player.name).toBe('Alice');
      expect(player.logo).toBe('/logos/cat.png');
      expect(player.gameType).toBeNull();
      expect(player.score).toBe(0);
      expect(player.streak).toBe(0);
      expect(player.maxStreak).toBe(0);
      expect(player.correctCount).toBe(0);
      expect(player.answered).toBe(false);
      expect(player.lastAnswerTime).toBe(0);
    });

    test('accepts gameType', () => {
      const p = new Player({ playerId: 'p2', name: 'Bob', logo: null, gameType: 'puzzle' });
      expect(p.gameType).toBe('puzzle');
    });
  });

  describe('updateScore', () => {
    test('adds points on correct answer', () => {
      player.updateScore(2, true, 3.5);
      expect(player.score).toBe(2);
      expect(player.streak).toBe(1);
      expect(player.correctCount).toBe(1);
      expect(player.answered).toBe(true);
      expect(player.lastAnswerTime).toBe(3.5);
    });

    test('resets streak on wrong answer', () => {
      player.updateScore(2, true, 3);
      player.updateScore(1.75, true, 7);
      expect(player.streak).toBe(2);

      player.updateScore(0, false, 12);
      expect(player.streak).toBe(0);
      expect(player.correctCount).toBe(2); // unchanged
      expect(player.score).toBe(3.75);
    });

    test('tracks maxStreak correctly', () => {
      // Build streak of 3
      player.updateScore(2, true, 1);
      player.updateScore(2, true, 2);
      player.updateScore(2, true, 3);
      expect(player.maxStreak).toBe(3);

      // Break streak
      player.updateScore(0, false, 4);
      expect(player.maxStreak).toBe(3); // preserved

      // New streak of 2 (less than max)
      player.updateScore(2, true, 5);
      player.updateScore(2, true, 6);
      expect(player.maxStreak).toBe(3); // still 3
    });

    test('accumulates score across multiple answers', () => {
      player.updateScore(2, true, 3);     // +2
      player.updateScore(1.75, true, 8);  // +1.75
      player.updateScore(0, false, 20);   // +0
      player.updateScore(1.5, true, 14);  // +1.5
      expect(player.score).toBe(5.25);
      expect(player.correctCount).toBe(3);
    });
  });

  describe('reset', () => {
    test('resets all game stats to zero', () => {
      player.updateScore(2, true, 3);
      player.updateScore(1.75, true, 7);
      player.reset();

      expect(player.score).toBe(0);
      expect(player.streak).toBe(0);
      expect(player.maxStreak).toBe(0);
      expect(player.correctCount).toBe(0);
      expect(player.answered).toBe(false);
      expect(player.lastAnswerTime).toBe(0);
    });

    test('preserves identity fields after reset', () => {
      player.updateScore(2, true, 3);
      player.reset();

      expect(player.playerId).toBe('p1');
      expect(player.name).toBe('Alice');
      expect(player.logo).toBe('/logos/cat.png');
    });
  });

  describe('toJSON', () => {
    test('returns plain object with all relevant fields', () => {
      player.updateScore(2, true, 3.5);
      const json = player.toJSON();

      expect(json).toEqual({
        playerId: 'p1',
        name: 'Alice',
        logo: '/logos/cat.png',
        gameType: null,
        score: 2,
        streak: 1,
        maxStreak: 1,
        correctCount: 1,
        answered: true,
        lastAnswerTime: 3.5,
      });
    });

    test('does not include internal fields like cleanupTimer', () => {
      const json = player.toJSON();
      expect(json).not.toHaveProperty('cleanupTimer');
      expect(json).not.toHaveProperty('testQIndex');
      expect(json).not.toHaveProperty('sendTestQ');
    });
  });
});
