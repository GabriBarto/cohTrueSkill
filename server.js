const express = require('express');
const pool = require('./database');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const API_URL = 'https://trueskill.atomflunder.de/api/calculate';

app.get('/api/roster', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM quizzers ORDER BY elo DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const getPlayerFromDB = async (username) => {
    const result = await pool.query('SELECT mu, sigma FROM quizzers WHERE username = $1', [username]);
    if (result.rows.length > 0) {
        return result.rows[0];
    } else {
        return { mu: 25.0, sigma: 8.333 };
    }
};

app.post('/api/match', async (req, res) => {
    const { show_name, is_title, teams } = req.body;
    const moltiplicatore = is_title ? 2.0 : 1.0;

    try {
        const payloadPerAPI = [];
        const vecchiValori = {};

        for (const team of teams) {
            const playersArray = [];
            for (const nome of team.giocatori) {
                const dbPlayer = await getPlayerFromDB(nome);
                vecchiValori[nome] = dbPlayer.mu;
                playersArray.push({ id: nome, mu: dbPlayer.mu, sigma: dbPlayer.sigma });
            }
            payloadPerAPI.push({ players: playersArray, rank: team.rank });
        }

        const apiResponse = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payloadPerAPI)
        });

        if (!apiResponse.ok) throw new Error(`API TrueSkill errore: ${apiResponse.status}`);
        const updatedTeams = await apiResponse.json();

        // Salvataggio nel DB Cloud
        for (const team of updatedTeams) {
            for (const giocatore of team.players) {
                const nome = giocatore.id;
                const muIniziale = vecchiValori[nome];
                const deltaMu = giocatore.mu - muIniziale;
                const muFinale = muIniziale + (deltaMu * moltiplicatore);
                const eloFinale = muFinale - 3 * giocatore.sigma;

                await pool.query(`
                    INSERT INTO quizzers (username, mu, sigma, elo) 
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT(username) DO UPDATE SET 
                    mu = EXCLUDED.mu, sigma = EXCLUDED.sigma, elo = EXCLUDED.elo`,
                    [nome, muFinale, giocatore.sigma, eloFinale]
                );
            }
        }

        await pool.query(`INSERT INTO match_history (show_name, match_json) VALUES ($1, $2)`, [show_name, JSON.stringify(req.body)]);
        res.json({ status: "success", message: "Match calcolato! Roster salvato nel Cloud." });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sito attivo sulla porta ${PORT}`));