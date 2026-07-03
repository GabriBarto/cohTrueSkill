const express = require('express');
const pool = require('./database');
const { rating, rate } = require('openskill');
// --- MODIFICA 1: IMPORTA IL BOT TELEGRAM ---
const { inviaReportMatch } = require('./telegramBot');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Credenziali Admin Hardcoded (Sicure lato server)
const ADMIN_USER = 'cohadmin';
const ADMIN_PASS = 'COH2026';
const ADMIN_TOKEN = 'SECRET_TOKEN_COH_2026_' + Math.random().toString(36).substring(2);

// [Le altre rotte /api/login, /api/roster e getPlayerFromDB rimangono identiche...]
app.post('/api/login', (req, res) => { /* tuo codice originale */ });
app.get('/api/roster', async (req, res) => { /* tuo codice originale */ });

// API per inserire un Match (PROTETTA)
app.post('/api/match', async (req, res) => {
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

        for (const team of teams) {
            const giocatoriDelTeam = [];
            for (const nome of team.giocatori) {
                const dbPlayer = await getPlayerFromDB(nome);
                vecchiValoriMu[nome] = dbPlayer.mu;
                giocatoriDelTeam.push(rating({ mu: dbPlayer.mu, sigma: dbPlayer.sigma }));
            }
            teamsFormattoOpenskill.push(giocatoriDelTeam);
            ranksFormattoOpenskill.push(team.rank);
        }

        const updatedTeams = rate(teamsFormattoOpenskill, { ranks: ranksFormattoOpenskill });

        const conteggioRank = {};
        ranksFormattoOpenskill.forEach(r => conteggioRank[r] = (conteggioRank[r] || 0) + 1);

        for (let tIndex = 0; tIndex < updatedTeams.length; tIndex++) {
            const team = updatedTeams[tIndex];
            const rankAttuale = teams[tIndex].rank;
            const isPareggio = conteggioRank[rankAttuale] > 1;

            for (let pIndex = 0; pIndex < team.length; pIndex++) {
                const giocatoreCalcolato = team[pIndex];
                const nome = teams[tIndex].giocatori[pIndex];
                const muIniziale = vecchiValoriMu[nome];
                const deltaMu = giocatoreCalcolato.mu - muIniziale;
                let puntiEloAssegnati = deltaMu * 20;

                if (isPareggio && puntiEloAssegnati < 0) {
                    puntiEloAssegnati = 0.0;
                }

                if (is_title) {
                    puntiEloAssegnati = puntiEloAssegnati * moltiplicatore;
                    if (puntiEloAssegnati > 0 && puntiEloAssegnati < 15) puntiEloAssegnati = 15.0;
                    if (puntiEloAssegnati < 0 && puntiEloAssegnati > -20) puntiEloAssegnati = -20.0;
                }

                const muFinale = muIniziale + deltaMu;

                await pool.query(`
                    INSERT INTO quizzers (username, mu, sigma, elo) 
                    VALUES ($1, $2, $3, 1200.0 + $4)
                    ON CONFLICT(username) DO UPDATE SET 
                    mu = EXCLUDED.mu, 
                    sigma = EXCLUDED.sigma, 
                    elo = quizzers.elo + $4`,
                    [nome, muFinale, giocatoreCalcolato.sigma, puntiEloAssegnati]
                );
            }
        }

        await pool.query(`INSERT INTO match_history (show_name, match_json) VALUES ($1, $2)`, [show_name, JSON.stringify(req.body)]);

        // --- MODIFICA 2: INVIA IL REPORT AUTOMATICO SU TELEGRAM ---
        // Avviene in background asincrono per non ritardare la risposta HTTP dell'admin
        inviaReportMatch(show_name, is_title, teams);

        res.json({ status: "success", message: "Match calcolato localmente! Roster aggiornato con successo." });

    } catch (error) {
        console.error("Errore nel calcolo del match:", error);
        res.status(500).json({ error: "Errore durante il calcolo interno delle classifiche." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sito attivo sulla porta ${PORT}`));