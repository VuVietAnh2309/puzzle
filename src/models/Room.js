class Room {
  static GamePhase = {
    BANNER: 'banner',
    LOBBY: 'lobby',
    COUNTDOWN: 'countdown',
    QUESTION: 'question',
    RESULT: 'result',
    RANKING: 'ranking',
    PUZZLE: 'puzzle',
    FINAL: 'final',
  };

  constructor(code, quizData, name = '') {
    this.code = code;
    this.name = name;
    this.phase = Room.GamePhase.BANNER; // initial phase
    this.quizData = quizData;
    this.currentQuestionIndex = -1;
    this.questionStartTime = null;
    this.questionEndTime = null;
    this.timeLeft = 0;

    this.players = {}; // sid -> Player
    this.inactivePlayers = {}; // pid -> Player
    this.answers = {}; // sid -> Answer
    this.puzzleResults = {}; // sid -> Result

    this.timerInterval = null;
    this.gameHistory = [];
    this.autoEnding = false;
    this.createdAt = Date.now();
  }

  /**
   * Get a player by their socket ID.
   */
  getPlayerBySocketId(socketId) {
    return this.players[socketId];
  }

  /**
   * Add a player to the room.
   */
  addPlayer(socketId, player) {
    this.players[socketId] = player;
  }

  /**
   * Remove a player from the room and return them.
   */
  removePlayer(socketId) {
    const player = this.players[socketId];
    if (player) {
      delete this.players[socketId];
      return player;
    }
    return null;
  }

  /**
   * Set the game phase.
   */
  setPhase(phase) {
    this.phase = phase;
  }

  /**
   * Move to the next question index.
   * Returns true if there is a next question, false otherwise.
   */
  nextQuestion() {
    this.currentQuestionIndex++;
    return this.currentQuestionIndex < this.quizData.questions.length;
  }

  /**
   * Stop any active timer interval.
   */
  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  /**
   * Reset the room state for a fresh start.
   */
  reset() {
    this.stopTimer();
    this.phase = Room.GamePhase.LOBBY;
    this.currentQuestionIndex = -1;
    this.answers = {};
    this.gameHistory = [];
    this.autoEnding = false;
    this.puzzleResults = {};
    this.questionStartTime = null;
    this.questionEndTime = null;
    this.timeLeft = 0;

    Object.values(this.players).forEach((p) => p.reset());
  }

  /**
   * Get the current question object from quizData.
   */
  getCurrentQuestion() {
    if (this.currentQuestionIndex >= 0 && this.currentQuestionIndex < this.quizData.questions.length) {
      return this.quizData.questions[this.currentQuestionIndex];
    }
    return null;
  }

  /**
   * Calculate and return sorted rankings.
   */
  getRanking() {
    const players = Object.values(this.players);
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
   * Aggregate results for the current question.
   */
  getQuestionResults() {
    const q = this.getCurrentQuestion();
    if (!q) return null;

    const answers = this.answers;
    const total = Object.values(this.players).filter((p) => !p.gameType || p.gameType === 'quiz').length;
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
   * Build a snapshot of the room state for admins or players.
   */
  getStateSnapshot() {
    return {
      phase: this.phase,
      roomCode: this.code,
      roomName: this.name,
      questionIndex: this.currentQuestionIndex,
      totalQuestions: this.quizData.questions.length,
      playerCount: Object.keys(this.players).length,
      players: Object.values(this.players).map((p) => ({ name: p.name, logo: p.logo })),
      quizData: this.quizData,
      serverTimestamp: Date.now(),
      questionEndTime: this.questionEndTime,
      timeLeft: this.timeLeft,
      ranking: this.getRanking(),
    };
  }
}

module.exports = Room;
