import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Creates or opens the local database file inside the src folder
const dbPath = path.resolve(__dirname, '../osint_history.db');
const db = new sqlite3.Database(dbPath);

/**
 * Initializes the SQLite Database structure if it does not exist
 */
export function initDatabase() {
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS scan_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                domain TEXT NOT NULL,
                scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                total_found INTEGER NOT NULL,
                results_json TEXT NOT NULL
            )
        `, (err) => {
            if (err) console.error('❌ Failed to initialize SQLite structure:', err.message);
            else console.log('🗃️  SQLite database layer operational.');
        });
    });
}

/**
 * Persists a new scan report into the local history
 * @param {string} domain - Target domain scanned
 * @param {number} totalFound - Number of subdomains extracted
 * @param {Array} resultsArray - Complete array of checked hosts
 */
export function saveScanResult(domain, totalFound, resultsArray) {
    const query = `
        INSERT INTO scan_history (domain, total_found, results_json)
        VALUES (?, ?, ?)
    `;
    const serializedData = JSON.stringify(resultsArray);

    db.run(query, [domain, totalFound, serializedData], function(err) {
        if (err) {
            console.error('❌ Failed to persist scan history:', err.message);
        } else {
            console.log(`💾 Scan report for [${domain}] successfully indexed into SQLite (ID: ${this.lastID}).`);
        }
    });
}