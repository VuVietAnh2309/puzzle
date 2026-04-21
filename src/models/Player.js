/**
 * src/models/Player.js
 * Encapsulates player state and basic scoring logic.
 */

class Player {
  constructor({ playerId, name, logo, gameType = null }) {
    this.playerId = playerId;
    this.name = name;
    this.logo = logo;
    this.gameType = gameType;
    this.score = 0;
    this.streak = 0;
    this.maxStreak = 0;
    this.correctCount = 0;
    this.answered = false;
    this.lastAnswerTime = 0;
    // Tracks whether the player has ever submitted a real answer in this
    // quiz session. Stays false for people who join the lobby then leave
    // before answering anything — so they don't pollute the ranking.
    this.hasEverAnswered = false;

    this.cleanupTimer = null;
    this.testQIndex = 0;
    this.testQStart = null;
    this.sendTestQ = null;
  }

  /**
   * Update player score and streaks based on answer correctness.
   */
  updateScore(points, isCorrect, timeTaken) {
    this.score += points;
    this.answered = true;
    this.lastAnswerTime = timeTaken;

    if (isCorrect) {
      this.streak++;
      this.correctCount++;
      if (this.streak > this.maxStreak) {
        this.maxStreak = this.streak;
      }
    } else {
      this.streak = 0;
    }
  }

  /**
   * Reset player stats for a new game.
   */
  reset() {
    this.score = 0;
    this.streak = 0;
    this.maxStreak = 0;
    this.correctCount = 0;
    this.answered = false;
    this.lastAnswerTime = 0;
    this.hasEverAnswered = false;
  }

  /**
   * Return a plain object suitable for socket emission.
   */
  toJSON() {
    return {
      playerId: this.playerId,
      name: this.name,
      logo: this.logo,
      gameType: this.gameType,
      score: this.score,
      streak: this.streak,
      maxStreak: this.maxStreak,
      correctCount: this.correctCount,
      answered: this.answered,
      lastAnswerTime: this.lastAnswerTime,
    };
  }
}

module.exports = Player;
