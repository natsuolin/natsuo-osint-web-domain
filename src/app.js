import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { scanDomain } from './services/subfinderService.js';
import { initDatabase, saveScanResult } from './services/dbService.js';
import sqlite3 from 'sqlite3'; // Import required to read history here

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

initDatabase();

/**
 * NEW ENDPOINT: Fetch all historical scans from SQLite for the sidebar layout
 * GET /api/history
 */
app.get('/api/history', (req, res) => {
    const dbPath = path.resolve(__dirname, './osint_history.db');
    const db = new sqlite3.Database(dbPath);

    db.all(`SELECT id, domain, scanned_at, total_found, results_json FROM scan_history ORDER BY scanned_at DESC`, [], (err, rows) => {
        db.close();
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        return res.json({ success: true, history: rows });
    });
});

/**
 * API Endpoint to trigger the subdomain reconnaissance scan
 * POST /api/scan
 */
app.post('/api/scan', async (req, res) => {
    const { domain } = req.body;

    if (!domain) {
        return res.status(400).json({ error: 'Domain parameter is required.' });
    }

    try {
        const results = await scanDomain(domain);
        
        if (results && results.length > 0) {
            saveScanResult(domain, results.length, results);
        }

        return res.json({ success: true, target: domain, total: results.length, results });
    } catch (error) {
        console.error(`[API Error] ${error.message}`);
        return res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log("🚀 Security Panel running smoothly at: http://localhost:" + PORT);
});