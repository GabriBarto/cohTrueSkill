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

// Recupera giocatore o assegna i valori di default per partire da 900 Elo strutturale
const getPlayerFromDB = async (username) => {
    const result = await pool.query('SELECT mu, sigma FROM quizzers WHERE username = $1', [username]);
    if (result.rows.length > 0) {
        return result.rows[0];
    } else {
        // Nuovo giocatore: parte da 900 Elo, quindi mu = 925.0 e sigma = 8.333
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

        // 3. Applichiamo le variazioni e aggiorniamo il database su Neon senza distruggere lo storico dell'Elo passato
        for (let tIndex = 0; tIndex < updatedTeams.length; tIndex++) {
            const team = updatedTeams[tIndex];
            for (let pIndex = 0; pIndex < team.length; pIndex++) {
                const giocatoreCalcolato = team[pIndex];

                const nome = teams[tIndex].giocatori[pIndex];
                const muIniziale = vecchiValoriMu[nome];

                // Guadagno/perdita base dell'algoritmo
                const deltaMu = giocatoreCalcolato.mu - muIniziale;

                // Convertiamo la variazione di openskill in punti Elo reali (scala aumentata a 20x per più dinamismo)
                let puntiEloAssegnati = deltaMu * 20;

                // FIX LOGICA MATCH TITOLATI: Forziamo uno spostamento minimo se c'è una cintura in palio
                if (is_title) {
                    puntiEloAssegnati = puntiEloAssegnati * moltiplicatore; // Raddoppia l'efficacia (2x)

                    // Se vince il match titolato ma l'algoritmo dà pochi centesimi, garantiamo +15 punti minimi
                    if (puntiEloAssegnati > 0 && puntiEloAssegnati < 15) {
                        puntiEloAssegnati = 15.0;
                    }
                    // Se perde un match titolato, subisce un crollo minimo di -20 punti
                    if (puntiEloAssegnati < 0 && puntiEloAssegnati > -20) {
                        puntiEloAssegnati = -20.0;
                    }
                }

                // Il MU finale segue l'andamento reale dell'algoritmo openskill
                const muFinale = muIniziale + deltaMu;

                // Query avanzata: Se l'utente esiste prende il vecchio ELO e somma il delta. 
                // Se non esiste (nuovo utente), parte da 900.0 e applica la variazione del primo match.
                await pool.query(`
                    INSERT INTO quizzers (username, mu, sigma, elo) 
                    VALUES ($1, $2, $3, 900.0 + $4)
                    ON CONFLICT(username) DO UPDATE SET 
                    mu = EXCLUDED.mu, 
                    sigma = EXCLUDED.sigma, 
                    elo = quizzers.elo + $4`,
                    [nome, muFinale, giocatoreCalcolato.sigma, puntiEloAssegnati]
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