const { Telegraf } = require('telegraf');
const { Pool } = require('pg');
const express = require('express');
require('dotenv').config();

// Controllo delle variabili d'ambiente fondamentali
if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.DATABASE_URL) {
    console.error("Errore: Mancano le variabili d'ambiente TELEGRAM_BOT_TOKEN o DATABASE_URL.");
    process.exit(1);
}

// 1. Inizializzazione del Bot Telegram
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// 2. Inizializzazione del Database (Neon.tech)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Richiesto obbligatoriamente da Neon
});

// 3. Finto Server HTTP per il controllo di Render
const app = express();
app.get('/', (req, res) => {
    res.send('Bot Telegram di Chat of Honor attivo ed in ascolto! 🤖');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[Render Fix] Finto server HTTP attivo sulla porta ${PORT}`);
});

// 4. Logica del Bot Telegram - Comando /start
bot.start((ctx) => {
    ctx.reply(
        "🏆 <b>Benvenuto nel Bot di Chat of Honor!</b>\n\n" +
        "Ecco i comandi disponibili:\n" +
        "📊 <code>/elo NomeGiocatore</code> - Visualizza il punteggio ELO attuale.\n" +
        "📈 <code>/record NomeGiocatore</code> - Visualizza il record Win-Draw-Loss (W-D-L).\n\n" +
        "📌 <b>Esempio:</b> <code>/record RRT</code>",
        { parse_mode: 'HTML' }
    );
});

// 5. Comando /elo Username - Mostra solo l'ELO
bot.command('elo', async (ctx) => {
    const msgText = ctx.message.text.trim();
    const args = msgText.split(/\s+/);

    if (args.length < 2) {
        return ctx.reply("⚠️ <b>Specifica il nome del giocatore!</b>\nEsempio: <code>/elo RRT</code>", { parse_mode: 'HTML' });
    }

    const usernameCercato = args.slice(1).join(' ').trim();

    try {
        const queryText = 'SELECT username, elo FROM quizzers WHERE username ILIKE $1';
        const res = await pool.query(queryText, [usernameCercato]);

        if (res.rows.length > 0) {
            const quizzer = res.rows[0];
            const eloFormattato = Number(quizzer.elo).toFixed(1);

            ctx.reply(
                `👤 <b>Giocatore:</b> ${quizzer.username}\n` +
                `🏆 <b>Punteggio ELO:</b> <code>${eloFormattato}</code>`,
                { parse_mode: 'HTML' }
            );
        } else {
            ctx.reply(`❌ Il giocatore "<b>${usernameCercato}</b>" non è stato trovato nel database.`, { parse_mode: 'HTML' });
        }
    } catch (err) {
        console.error(err);
        ctx.reply("🤖 <b>Errore interno:</b> Impossibile recuperare l'ELO.");
    }
});

// 6. Comando /record Username - Mostra solo le statistiche W-D-L (QUERY DEFINITIVA)
bot.command('record', async (ctx) => {
    const msgText = ctx.message.text.trim();
    const args = msgText.split(/\s+/);

    if (args.length < 2) {
        return ctx.reply("⚠️ <b>Specifica il nome del giocatore!</b>\nEsempio: <code>/record WillYouPray</code>", { parse_mode: 'HTML' });
    }

    const usernameCercato = args.slice(1).join(' ').trim();

    try {
        // Query blindata: estrae in modo sequenziale l'array dei team e l'array dei giocatori evitando duplicazioni
        const queryText = `
            WITH match_teams AS (
                SELECT 
                    m.id AS match_id,
                    (team.value->>'rank')::int AS team_rank,
                    team.value->'giocatori' AS giocatori_array
                FROM match_history m,
                LATERAL jsonb_array_elements(m.match_json->'teams') AS team
            ),
            match_flat AS (
                SELECT 
                    mt.match_id,
                    mt.team_rank,
                    giocatore.value::text AS player_name_raw,
                    REPLACE(giocatore.value::text, '"', '') AS player_name
                FROM match_teams mt,
                LATERAL jsonb_array_elements_text(mt.giocatori_array) AS giocatore
            ),
            match_ties AS (
                SELECT 
                    match_id,
                    team_rank,
                    COUNT(*) AS teams_at_rank
                FROM match_teams
                GROUP BY match_id, team_rank
            ),
            calculated_matches AS (
                SELECT 
                    f.player_name,
                    CASE 
                        WHEN f.team_rank = 1 AND t.teams_at_rank = 1 THEN 'win'
                        WHEN t.teams_at_rank > 1 THEN 'draw'
                        ELSE 'loss'
                    END AS outcome
                FROM match_flat f
                JOIN match_ties t ON f.match_id = t.match_id AND f.team_rank = t.team_rank
            ),
            stats AS (
                SELECT 
                    player_name,
                    COUNT(CASE WHEN outcome = 'win' THEN 1 END) AS wins,
                    COUNT(CASE WHEN outcome = 'draw' THEN 1 END) AS draws,
                    COUNT(CASE WHEN outcome = 'loss' THEN 1 END) AS losses
                FROM calculated_matches
                GROUP BY player_name
            )
            SELECT 
                q.username, 
                COALESCE(s.wins, 0) AS wins,
                COALESCE(s.draws, 0) AS draws,
                COALESCE(s.losses, 0) AS losses
            FROM quizzers q
            LEFT JOIN stats s ON q.username ILIKE s.player_name
            WHERE q.username ILIKE $1;
        `;

        const res = await pool.query(queryText, [usernameCercato]);

        if (res.rows.length > 0) {
            const quizzer = res.rows[0];
            const totalMatch = Number(quizzer.wins) + Number(quizzer.draws) + Number(quizzer.losses);

            ctx.reply(
                `📈 <b>Record Storico Federazione</b>\n` +
                `👤 <b>Quizzer:</b> ${quizzer.username}\n\n` +
                `🟢 Vittorie (W): <code>${quizzer.wins}</code>\n` +
                `🟡 Pareggi (D): <code>${quizzer.draws}</code>\n` +
                `🔴 Sconfitte (L): <code>${quizzer.losses}</code>\n\n` +
                `🔢 Match Totali: <code>${totalMatch}</code>`,
                { parse_mode: 'HTML' }
            );
        } else {
            ctx.reply(`❌ Il giocatore "<b>${usernameCercato}</b>" non è stato trovato nel database del Roster.`, { parse_mode: 'HTML' });
        }
    } catch (err) {
        console.error("Errore SQL dettagliato:", err);
        ctx.reply("🤖 <b>Errore interno:</b> Errore nell'elaborazione dei dati storici.", { parse_mode: 'HTML' });
    }
});

// 7. Avvio ufficiale del Bot in polling costante
bot.launch()
    .then(() => console.log('🤖 Telegram Bot online con comandi /elo e /record separati!'))
    .catch((err) => console.error('Errore critico durante il lancio del Bot:', err));

// Gestione della terminazione pulita del processo su Render
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));