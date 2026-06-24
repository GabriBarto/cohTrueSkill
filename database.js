const { Pool } = require('pg');

// Si collega a Neon usando la stringa di connessione sicura
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Inizializzazione tabelle (Sintassi Postgres)
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS quizzers (
                username TEXT PRIMARY KEY,
                mu REAL DEFAULT 25.0,
                sigma REAL DEFAULT 8.333,
                elo REAL DEFAULT 0.0
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS match_history (
                id SERIAL PRIMARY KEY,
                data TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                show_name TEXT,
                match_json TEXT
            )
        `);
        console.log("Database Postgres pronto e connesso.");
    } catch (err) {
        console.error("Errore inizializzazione Postgres:", err.message);
    }
};

initDB();

module.exports = pool;