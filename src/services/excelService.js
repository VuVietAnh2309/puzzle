/**
 * src/services/excelService.js
 * Generates Excel reports from game room data.
 * Pure function — no server or socket dependency, fully unit-testable.
 */

const XLSX = require('xlsx');

/**
 * Build the ranking sheet data array.
 * @param {Array} ranking - Ordered array of player ranking objects.
 * @returns {Array<object>}
 */
function buildRankingSheet(ranking) {
  return ranking.map((p) => ({
    'Hạng': p.rank,
    'Tên': p.name,
    'Điểm': p.score,
    'Số câu đúng': p.correctCount,
    'Streak cao nhất': p.streak,
  }));
}

/**
 * Build the per-question detail sheet data array.
 * @param {Array} gameHistory - Array of { questionIndex, question, answers } objects.
 * @param {object} players - Map of socketId -> player object.
 * @returns {Array<object>}
 */
function buildDetailSheet(gameHistory, players) {
  const rows = [];
  gameHistory.forEach((h, qi) => {
    Object.entries(h.answers).forEach(([sid, ans]) => {
      const player = players[sid];
      rows.push({
        'Câu': qi + 1,
        'Câu hỏi': h.question,
        'Tên': player ? player.name : 'Unknown',
        'Đáp án chọn': ans.optionText != null ? ans.optionText : ans.option,
        'Đúng/Sai': ans.correct ? 'Đúng' : 'Sai',
        'Thời gian (s)': Math.round(ans.time * 10) / 10,
        'Điểm': ans.points,
      });
    });
  });
  return rows;
}

/**
 * Generate an Excel workbook buffer from room result data.
 *
 * @param {object} params
 * @param {Array}  params.ranking       - Output of getRanking(room)
 * @param {Array}  params.gameHistory   - room.gameHistory
 * @param {object} params.players       - room.players map (socketId -> player)
 * @param {string} params.roomCode      - Used for metadata / logging
 * @returns {Buffer} Excel file as a Node.js Buffer
 */
function generateExcelBuffer({ ranking, gameHistory, players, roomCode }) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Rankings
  const rankData = buildRankingSheet(ranking);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rankData), 'Bảng xếp hạng');

  // Sheet 2: Per-question details (only when there's history)
  if (gameHistory && gameHistory.length > 0) {
    const histData = buildDetailSheet(gameHistory, players);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(histData), 'Chi tiết');
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return Buffer.from(buf);
}

module.exports = { generateExcelBuffer, buildRankingSheet, buildDetailSheet };
