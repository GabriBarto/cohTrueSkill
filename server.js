const express = require('express');
const pool = require('./database');
const { rating, rate } = require('openskill');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Credenziali Admin Hardcoded (Sicure lato server)
const ADMIN_USER = 'cohadmin';
const ADMIN_PASS = 'COH2026';
// Token temporaneo generato all'avvio del server per validare le richieste di inserimento
const ADMIN_TOKEN = 'SECRET_TOKEN_COH_2026_' + Math.random().toString(36).substring(2);

// API per il Login dell'Admin
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    // .toLowerCase() e .trim() prevengono errori di battitura (es. maiuscole automatiche da smartphone)
    if (username && password && username.toLowerCase().trim() === ADMIN_USER && password.trim() === ADMIN_PASS) {
        return res.json({ success: true, token: ADMIN_TOKEN });
    }
    res.status(401).json({ success: false, error: "Credenziali errate!" });
});

// API per ottenere la classifica del Roster (Pubblica)
app.get('/api/roster', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM quizzers ORDER BY elo DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Recupera giocatore o assegna i valori di default per partire da 900 Elo
// Formula standard: Elo = mu - 3 * sigma -> 925.0 - (3 * 8.333) = ~900
const getPlayerFromDB = async (username) => {
    const result = await pool.query('SELECT mu, sigma FROM quizzers WHERE username = $1', [username]);
    if (result.rows.length > 0) {
        return result.rows[0];
    } else {
        return { mu: 925.0, sigma: 8.333 };
    }
};

// API per inserire un Match (PROTETTA)
app.post('/api/match', async (req, res) => {
    // Controlla se chi invia il match ha il token corretto nell'header Authorization
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== `Bearer ${ADMIN_TOKEN}`) {
        return res.status(403).json({ error: "Accesso negato. Solo gli amministratori possono inserire i match." });
    }

    const { show_name, is_title, teams } = req.body;
    const moltiplicatore = is_title ? 2.0 : 1.0;

    try {
        const teamsFormattoOpenskill = [];
        const ranksFormattoOpenskill = [];
        const vecchiValoriMu = {};

        // 1. Mappiamo le squadre nel formato accettato dall'algoritmo locale
        for (const team of teams) {
            const giocatoriDelTeam = [];
            for (const nome of team.giocatori) {
                const dbPlayer = await getPlayerFromDB(nome);
                vecchiValoriMu[nome] = dbPlayer.mu;

                // Crea l'oggetto rating per la libreria openskill
                giocatoriDelTeam.push(rating({ mu: dbPlayer.mu, sigma: dbPlayer.sigma }));
            }
            teamsFormattoOpenskill.push(giocatoriDelTeam);
            ranksFormattoOpenskill.push(team.rank); // Inserisce la posizione (1°, 2°, ecc)
        }

        // 2. Eseguiamo il calcolo matematico LOCALE (Zero chiamate esterne, istantaneo)
        const updatedTeams = rate(teamsFormattoOpenskill, { ranks: ranksFormattoOpenskill });

        // 3. Applichiamo il moltiplicatore sul Delta e aggiorniamo il database su Neon
        for (let tIndex = 0; tIndex < updatedTeams.length; tIndex++) {
            const team = updatedTeams[tIndex];
            for (let pIndex = 0; pIndex < team.length; pIndex++) {
                const giocatoreCalcolato = team[pIndex];

                // Recuperiamo il nome originale usando gli indici della struttura iniziale
                const nome = teams[tIndex].giocatori[pIndex];
                const muIniziale = vecchiValoriMu[nome];

                // Calcolo del Delta (Nuovo MU - Vecchio MU) amplificato se c'è il titolo in palio
                const deltaMu = giocatoreCalcolato.mu - muIniziale;
                const muFinale = muIniziale + (deltaMu * moltiplicatore);

                // Formula standard per l'Elo visualizzato nel tabellone
                const eloFinale = muFinale - 3 * giocatoreCalcolato.sigma;

                await pool.query(`
                    INSERT INTO quizzers (username, mu, sigma, elo) 
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT(username) DO UPDATE SET 
                    mu = EXCLUDED.mu, sigma = EXCLUDED.sigma, elo = EXCLUDED.elo`,
                    [nome, muFinale, giocatoreCalcolato.sigma, eloFinale]
                );
            }
        }

        // Salviamo l'intero match (compreso di punteggi/scores) nella cronologia storica
        await pool.query(`INSERT INTO match_history (show_name, match_json) VALUES ($1, $2)`, [show_name, JSON.stringify(req.body)]);

        res.json({ status: "success", message: "Match calcolato localmente! Roster aggiornato con successo." });

    } catch (error) {
        console.error("Errore nel calcolo del match:", error);
        res.status(500).json({ error: "Errore durante il calcolo interno delle classifiche." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sito attivo sulla porta ${PORT}`));