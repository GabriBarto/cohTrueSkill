const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Se siamo su Render useremo il disco fisso (/data), altrimenti usiamo la cartella locale
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'trueskill_2026.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("Errore apertura DB:", err.message);
    else console.log("Database collegato a:", dbPath);
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS quizzers (
        username TEXT PRIMARY KEY,
        mu REAL DEFAULT 25.0,
        sigma REAL DEFAULT 8.333,
        elo REAL DEFAULT 0.0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS match_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data TEXT,
        show_name TEXT,
        match_json TEXT
    )`);
});

module.exports = db;