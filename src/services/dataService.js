/**
 * src/services/dataService.js
 * Handles reading and writing the quiz JSON data file.
 */

const fs = require('fs');
const { config, defaultQuizData } = require('../config');

/**
 * Load quiz data from disk. Returns null on failure.
 * @returns {object|null}
 */
function loadData() {
  try {
    if (fs.existsSync(config.dataFile)) {
      return JSON.parse(fs.readFileSync(config.dataFile, 'utf8'));
    }
  } catch (e) {
    console.error('[dataService] Load data error:', e);
  }
  return null;
}

/**
 * Save quiz data to disk.
 * @param {object} data
 */
function saveData(data) {
  fs.writeFileSync(config.dataFile, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Load data or fall back to defaults.
 * @returns {object}
 */
function loadOrDefault() {
  return loadData() || { ...defaultQuizData };
}

module.exports = { loadData, saveData, loadOrDefault };
