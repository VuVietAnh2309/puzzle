/**
 * src/services/resultsService.js
 * Persist finished game results to disk and provide CRUD helpers.
 * Stores everything in a single JSON file: data/results.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('../config');

const resultsFile = path.join(config.dataDir, 'results.json');

function loadAll() {
  try {
    if (fs.existsSync(resultsFile)) {
      const raw = fs.readFileSync(resultsFile, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) {
    console.error('[resultsService] Load error:', e);
  }
  return [];
}

function saveAll(results) {
  try {
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2), 'utf8');
  } catch (e) {
    console.error('[resultsService] Save error:', e);
  }
}

/**
 * Persist a finished game result.
 * @param {object} room
 * @returns {object} saved result entry
 */
function saveResult(room) {
  const ranking = typeof room.getRanking === 'function' ? room.getRanking() : [];
  const entry = {
    id: crypto.randomBytes(8).toString('hex'),
    roomCode: room.code,
    roomName: room.name || '',
    quizTitle: room.quizData && room.quizData.title ? room.quizData.title : '',
    finishedAt: Date.now(),
    playerCount: ranking.length,
    ranking,
    gameHistory: room.gameHistory || [],
    puzzleResults: room.puzzleResults
      ? Object.values(room.puzzleResults).sort((a, b) => (a.time || 0) - (b.time || 0))
      : [],
    players: Object.values(room.players || {}).map((p) => ({
      playerId: p.playerId,
      name: p.name,
      logo: p.logo,
      score: p.score,
      correctCount: p.correctCount,
      maxStreak: p.maxStreak,
    })),
  };

  const all = loadAll();
  all.push(entry);
  saveAll(all);
  console.log(`[resultsService] Saved result for room ${room.code} (id=${entry.id})`);
  return entry;
}

/**
 * List all saved results (newest first), without heavy payload.
 */
function listResults() {
  return loadAll()
    .slice()
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .map((r) => ({
      id: r.id,
      roomCode: r.roomCode,
      roomName: r.roomName,
      quizTitle: r.quizTitle,
      finishedAt: r.finishedAt,
      playerCount: r.playerCount,
      topPlayer: r.ranking && r.ranking[0] ? r.ranking[0].name : null,
      topScore: r.ranking && r.ranking[0] ? r.ranking[0].score : null,
    }));
}

/**
 * Get a full result by id.
 */
function getResult(id) {
  return loadAll().find((r) => r.id === id) || null;
}

/**
 * Delete a result by id. Returns true if deleted.
 */
function deleteResult(id) {
  const all = loadAll();
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  all.splice(idx, 1);
  saveAll(all);
  return true;
}

module.exports = { saveResult, listResults, getResult, deleteResult };
