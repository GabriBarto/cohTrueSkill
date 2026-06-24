const express = require('express');
const pool = require('./database');
const { rating, rate } = require('openskill'); // Algoritmo matematico locale

const app = express();
app.use(express.json());
app.use(express.static('public'));

// API per ottenere la classifica del Roster
app.get('/api/roster', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM quizzers ORDER BY elo DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Recupera giocatore o assegna i valori di default di TrueSkill/Openskill (mu: 25, sigma: 8.333)
const getPlayerFromDB = async (username) => {
    const result = await pool.query('SELECT mu, sigma FROM quizzers WHERE username = $1', [username]);
    if (result.rows.length > 0) {
        return result.rows[0];
    } else {
        const d = rating(); // mu: 25, sigma: 8.333
        return { mu: d.mu, sigma: d.sigma };
    }
};

// API per inserire un Match con calcolo interno locale
app.post('/api/match', async (req, res) => {
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

                // Crea l'oggetto rating per la libreria
                giocatoriDelTeam.push(rating({ mu: dbPlayer.mu, sigma: dbPlayer.sigma }));
            }
            teamsFormattoOpenskill.push(giocatoriDelTeam);
            ranksFormattoOpenskill.push(team.rank); // Inserisce la posizione (1°, 2°, ecc)
        }

        // 2. Eseguiamo il calcolo TrueSkill LOCALE (Zero chiamate esterne, velocissimo)
        const updatedTeams = rate(teamsFormattoOpenskill, { ranks: ranksFormattoOpenskill });

        // 3. Applichiamo il moltiplicatore sul Delta e aggiorniamo Neon.tech
        for (let tIndex = 0; tIndex < updatedTeams.length; tIndex++) {
            const team = updatedTeams[tIndex];
            for (let pIndex = 0; pIndex < team.length; pIndex++) {
                const giocatoreCalcolato = team[pIndex];

                // Recuperiamo il nome originale usando gli indici della struttura iniziale
                const nome = teams[tIndex].giocatori[pIndex];
                const muIniziale = vecchiValoriMu[nome];

                // Calcolo del Delta (Nuovo MU - Vecchio MU) amplificato se c'è il titolo
                const deltaMu = giocatoreCalcolato.mu - muIniziale;
                const muFinale = muIniziale + (deltaMu * moltiplicatore);

                // Formula standard per l'Elo visualizzato: mu - 3 * sigma
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

        // Salviamo il match (compreso di punteggi/scores) nella cronologia
        await pool.query(`INSERT INTO match_history (show_name, match_json) VALUES ($1, $2)`, [show_name, JSON.stringify(req.body)]);

        res.json({ status: "success", message: "Match calcolato localmente con successo! Roster aggiornato." });

    } catch (error) {
        console.error("Errore calcolo interno:", error);
        res.status(500).json({ error: "Errore durante il calcolo interno delle classifiche." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sito attivo sulla porta ${PORT}`));