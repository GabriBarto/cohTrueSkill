const express = require('express');
const db = require('./database');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Sostituisci questo URL con l'endpoint esatto indicato sul loro GitHub se differente
const API_URL = 'https://trueskill.atomflunder.de/api/calculate';

// API per ottenere la classifica del Roster
app.get('/api/roster', (req, res) => {
    db.all('SELECT * FROM quizzers ORDER BY elo DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Recupera giocatore o restituisce i valori di default di TrueSkill (25, 8.333)
const getPlayerFromDB = (username) => {
    return new Promise((resolve) => {
        db.get('SELECT mu, sigma FROM quizzers WHERE username = ?', [username], (err, row) => {
            if (row) resolve(row);
            else resolve({ mu: 25.0, sigma: 8.333 });
        });
    });
};

// API per inserire un Match manualmente sfruttando l'API esterna
app.post('/api/match', async (req, res) => {
    const { show_name, is_title, teams } = req.body;
    const moltiplicatore = is_title ? 2.0 : 1.0;

    try {
        const payloadPerAPI = [];
        const vecchiValori = {};

        // 1. Costruiamo il JSON nel formato esatto richiesto dall'API di atomflunder
        for (const team of teams) {
            const playersArray = [];
            for (const nome of team.giocatori) {
                const dbPlayer = await getPlayerFromDB(nome);
                vecchiValori[nome] = dbPlayer.mu;

                playersArray.push({
                    id: nome,
                    mu: dbPlayer.mu,
                    sigma: dbPlayer.sigma
                });
            }

            payloadPerAPI.push({
                players: playersArray,
                rank: team.rank
            });
        }

        // 2. Chiamata HTTP all'API di TrueSkill-Calculator
        const apiResponse = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payloadPerAPI)
        });

        if (!apiResponse.ok) {
            throw new Error(`L'API esterna ha risposto con status ${apiResponse.status}`);
        }

        const updatedTeams = await apiResponse.json();

        // 3. Applichiamo il moltiplicatore sul Delta e aggiorniamo SQLite
        db.serialize(() => {
            updatedTeams.forEach(team => {
                team.players.forEach(giocatore => {
                    const nome = giocatore.id;
                    const muIniziale = vecchiValori[nome];

                    // Calcolo del Delta (Nuovo MU - Vecchio MU)
                    const deltaMu = giocatore.mu - muIniziale;
                    const muFinale = muIniziale + (deltaMu * moltiplicatore);

                    // Calcolo dell'Elo visualizzato sul roster
                    const eloFinale = muFinale - 3 * giocatore.sigma;

                    db.run(`INSERT INTO quizzers (username, mu, sigma, elo) 
                            VALUES (?, ?, ?, ?)
                            ON CONFLICT(username) DO UPDATE SET 
                            mu = ?, sigma = ?, elo = ?`,
                        [nome, muFinale, giocatore.sigma, eloFinale, muFinale, giocatore.sigma, eloFinale]);
                });
            });

            // Salviamo il match nello storico locale
            db.run(`INSERT INTO match_history (data, show_name, match_json) VALUES (date('now'), ?, ?)`,
                [show_name, JSON.stringify(req.body)]);
        });

        res.json({ status: "success", message: "Match calcolato dall'API! Roster aggiornato con successo." });

    } catch (error) {
        console.error("Errore durante il calcolo:", error);
        res.status(500).json({ error: "Errore di comunicazione con l'API di TrueSkill o dati non validi." });
    }
});

app.listen(3000, () => console.log('Sito attivo su http://localhost:3000'));