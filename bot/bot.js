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

// 6. Comando /record Username - Mostra solo le statistiche W-D-L
bot.command('record', async (ctx) => {
    const msgText = ctx.message.text.trim();
    const args = msgText.split(/\s+/);

    if (args.length < 2) {
        return ctx.reply("⚠️ <b>Specifica il nome del giocatore!</b>\nEsempio: <code>/record WillYouPray</code>", { parse_mode: 'HTML' });
    }

    const usernameCercato = args.slice(1).join(' ').trim();

    try {
        // Query avanzata per estrarre e conteggiare i match dal JSON in match_history
        const queryText = `
            WITH match_flat AS (
                SELECT 
                    m.id AS match_id,
                    jsonb_array_elements(m.match_json->'teams') AS team_data
                FROM match_history m
            ),
            player_matches AS (
                SELECT 
                    match_id,
                    (team_data->>'rank')::int AS p_rank,
                    jsonb_array_elements_text(team_data->'giocatori') AS player_name
                FROM match_flat
            ),
            match_counts AS (
                SELECT 
                    r.match_id,
                    r.rank AS r_rank,
                    COUNT(*) AS r_count
                FROM (
                    SELECT match_id, (team_data->>'rank')::int AS rank 
                    FROM match_flat
                ) r
                GROUP BY match_id, r.rank
            ),
            stats AS (
                SELECT 
                    pm.player_name,
                    COUNT(CASE WHEN pm.p_rank = 1 AND mc.r_count = 1 THEN 1 END) AS wins,
                    COUNT(CASE WHEN mc.r_count > 1 THEN 1 END) AS draws,
                    COUNT(CASE WHEN pm.p_rank > 1 AND mc.r_count = 1 THEN 1 END) AS losses
                FROM player_matches pm
                JOIN match_counts mc ON pm.match_id = mc.match_id AND pm.p_rank = mc.r_rank
                GROUP BY pm.player_name
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
        console.error("Errore durante la query delle statistiche:", err);
        ctx.reply("🤖 <b>Errore interno:</b> Impossibile elaborare il record del giocatore.", { parse_mode: 'HTML' });
    }
});

// 7. Avvio ufficiale del Bot in polling costante
bot.launch()
    .then(() => console.log('🤖 Telegram Bot online con comandi /elo e /record separati!'))
    .catch((err) => console.error('Errore critico durante il lancio del Bot:', err));

// Gestione della terminazione pulita del processo su Render
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));