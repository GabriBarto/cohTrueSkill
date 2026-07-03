const { Telegraf } = require('telegraf');
const { Pool } = require('pg');
const express = require('express');
require('dotenv').config();

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.DATABASE_URL) {
    console.error("Errore: Mancano le variabili d'ambiente TELEGRAM_BOT_TOKEN o DATABASE_URL.");
    process.exit(1);
}

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const app = express();
app.get('/', (req, res) => res.send('Bot Telegram attivo! 🤖'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server attivo sulla porta ${PORT}`));

bot.start((ctx) => {
    ctx.reply(
        "🏆 <b>Benvenuto nel Bot della Chat of Honor!</b>\n\n" +
        "Comandi disponibili:\n" +
        "📊 <code>/elo NomeGiocatore</code> - Visualizza il punteggio ELO attuale.\n" +
        "📈 <code>/record NomeGiocatore</code> - Visualizza il record Win-Draw-Loss (W-D-L).\n\n" +
        "📌 <b>Esempio:</b> <code>/record RRT</code>",
        { parse_mode: 'HTML' }
    );
});

// Comando /elo
bot.command('elo', async (ctx) => {
    const msgText = ctx.message.text.trim();
    const args = msgText.split(/\s+/);
    if (args.length < 2) return ctx.reply("⚠️ <b>Specifica il nome del giocatore!</b>", { parse_mode: 'HTML' });

    const usernameCercato = args.slice(1).join(' ').trim();
    try {
        const res = await pool.query('SELECT username, elo FROM quizzers WHERE username ILIKE $1', [usernameCercato]);
        if (res.rows.length > 0) {
            ctx.reply(`👤 <b>Giocatore:</b> ${res.rows[0].username}\n🏆 <b>Punteggio ELO:</b> <code>${Number(res.rows[0].elo).toFixed(1)}</code>`, { parse_mode: 'HTML' });
        } else {
            ctx.reply(`❌ Il giocatore "<b>${usernameCercato}</b>" non è stato trovato.`, { parse_mode: 'HTML' });
        }
    } catch (err) {
        console.error(err);
        ctx.reply("🤖 Errore nel recupero dell'ELO.");
    }
});

// Comando /record (LOGICA REVISIONATA LATO JAVASCRIPT - INFALLIBILE)
bot.command('record', async (ctx) => {
    const msgText = ctx.message.text.trim();
    const args = msgText.split(/\s+/);
    if (args.length < 2) return ctx.reply("⚠️ <b>Specifica il nome del giocatore!</b>", { parse_mode: 'HTML' });

    const usernameCercato = args.slice(1).join(' ').trim().toLowerCase();

    try {
        // 1. Controlliamo prima se il giocatore esiste nel roster
        const checkUser = await pool.query('SELECT username FROM quizzers WHERE username ILIKE $1', [usernameCercato]);
        if (checkUser.rows.length === 0) {
            return ctx.reply(`❌ Il giocatore "<b>${args.slice(1).join(' ')}</b>" non è stato trovato nel database.`, { parse_mode: 'HTML' });
        }

        const nomeCorrettoUfficiale = checkUser.rows[0].username;

        // 2. Prendiamo tutta la cronologia dei match (Query semplicissima, non può fallire)
        const matchRes = await pool.query('SELECT match_json FROM match_history');

        let wins = 0;
        let draws = 0;
        let losses = 0;

        // 3. Spacchettiamo i JSON con JavaScript
        for (const row of matchRes.rows) {
            const match = row.match_json;
            if (!match || !match.teams) continue;

            // Troviamo il team in cui si trovava il giocatore cercato in questo match
            const teamDelGiocatore = match.teams.find(t =>
                t.giocatori && t.giocatori.some(g => g.toLowerCase().trim() === usernameCercato)
            );

            // Se il giocatore ha preso parte a questo match, calcoliamo il risultato
            if (teamDelGiocatore) {
                const rankDelGiocatore = parseInt(teamDelGiocatore.rank);

                // Contiamo quanti team hanno fatto lo stesso rank in questo match (per i pareggi)
                const teamConStessoRank = match.teams.filter(t => parseInt(t.rank) === rankDelGiocatore).length;

                if (teamConStessoRank > 1) {
                    draws++; // Più team hanno lo stesso posizionamento = Pareggio
                } else if (rankDelGiocatore === 1) {
                    wins++;  // Primo posto solitario = Vittoria
                } else {
                    losses++; // Posizionamento solitario superiore a 1 = Sconfitta
                }
            }
        }

        const totalMatch = wins + draws + losses;

        ctx.reply(
            `📈 <b>Record Storico Federazione</b>\n` +
            `👤 <b>Quizzer:</b> ${nomeCorrettoUfficiale}\n\n` +
            `... Vittorie (W): <code>${wins}</code>\n` +
            `... Pareggi (D): <code>${draws}</code>\n` +
            `... Sconfitte (L): <code>${losses}</code>\n\n` +
            `... Match Totali: <code>${totalMatch}</code>`,
            { parse_mode: 'HTML' }
        );

    } catch (err) {
        console.error("Errore JS nel calcolo dei record:", err);
        ctx.reply("🤖 <b>Errore interno:</b> Impossibile elaborare i dati storici.", { parse_mode: 'HTML' });
    }
});

bot.launch().then(() => console.log('🤖 Bot Telegram Online con calcolo JS integrato!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));