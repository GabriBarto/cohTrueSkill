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
    ssl: { rejectUnauthorized: false }
});

// 3. Finto Server HTTP per il controllo di Render
const app = express();
app.get('/', (req, res) => res.send('Bot Telegram di Chat of Honor attivo! 🤖'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[Render Fix] Server HTTP attivo sulla porta ${PORT}`));

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

// 5. Comando /elo Username
bot.command('elo', async (ctx) => {
    const msgText = ctx.message.text.trim();
    const args = msgText.split(/\s+/);
    if (args.length < 2) return ctx.reply("⚠️ <b>Specifica il nome del giocatore!</b>\nEsempio: <code>/elo RRT</code>", { parse_mode: 'HTML' });

    const usernameCercato = args.slice(1).join(' ').trim();

    try {
        const res = await pool.query('SELECT username, elo FROM quizzers WHERE username ILIKE $1', [usernameCercato]);
        if (res.rows.length > 0) {
            const quizzer = res.rows[0];
            ctx.reply(
                `👤 <b>Giocatore:</b> ${quizzer.username}\n` +
                `🏆 <b>Punteggio ELO:</b> <code>${Number(quizzer.elo).toFixed(1)}</code>`,
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

// 6. Comando /record Username (Risolto per colonne TEXT/JSON)
bot.command('record', async (ctx) => {
    const msgText = ctx.message.text.trim();
    const args = msgText.split(/\s+/);
    if (args.length < 2) return ctx.reply("⚠️ <b>Specifica il nome del giocatore!</b>\nEsempio: <code>/record WillYouPray</code>", { parse_mode: 'HTML' });

    const usernameCercato = args.slice(1).join(' ').trim().toLowerCase();

    try {
        // 1. Verifica esistenza giocatore nel Roster
        const checkUser = await pool.query('SELECT username FROM quizzers WHERE username ILIKE $1', [usernameCercato]);
        if (checkUser.rows.length === 0) {
            return ctx.reply(`❌ Il giocatore "<b>${args.slice(1).join(' ')}</b>" non è presente nel database.`, { parse_mode: 'HTML' });
        }

        const nomeUfficiale = checkUser.rows[0].username;

        // 2. Scarichiamo tutti i match dalla tabella
        const matchRes = await pool.query('SELECT match_json FROM match_history');

        let wins = 0;
        let draws = 0;
        let losses = 0;

        // 3. Analisi iterativa dei match
        for (const row of matchRes.rows) {
            let match = row.match_json;

            // Poiché la colonna nel DB è di tipo TEXT, forziamo la stringa a diventare un oggetto JSON leggibile
            if (typeof match === 'string') {
                try {
                    match = JSON.parse(match);
                } catch (e) {
                    console.error("Errore nel parsing del testo match_json:", e);
                    continue;
                }
            }

            if (!match || !match.teams || !Array.isArray(match.teams)) continue;

            // Cerchiamo il team all'interno del quale ha giocato il quizzer cercato
            const teamDelGiocatore = match.teams.find(t =>
                t.giocatori && Array.isArray(t.giocatori) && t.giocatori.some(g =>
                    g && g.toString().trim().toLowerCase() === usernameCercato
                )
            );

            // Se il giocatore ha partecipato a questo specifico match
            if (teamDelGiocatore) {
                const rankDelGiocatore = parseInt(teamDelGiocatore.rank);

                // Contiamo quanti team hanno fatto lo stesso identico rank in questo match
                const teamConStessoRank = match.teams.filter(t => parseInt(t.rank) === rankDelGiocatore).length;

                if (teamConStessoRank > 1) {
                    draws++; // Se più di un team condivide lo stesso rank, si tratta di un pareggio
                } else if (rankDelGiocatore === 1) {
                    wins++;  // Primo posto in solitaria = Vittoria
                } else {
                    losses++; // Posizionamento in solitaria peggiore del primo = Sconfitta
                }
            }
        }

        const totalMatch = wins + draws + losses;

        ctx.reply(
            `📈 <b>Record Storico Federazione</b>\n` +
            `👤 <b>Quizzer:</b> ${nomeUfficiale}\n\n` +
            `🟢 Vittorie (W): <code>${wins}</code>\n` +
            `🟡 Pareggi (D): <code>${draws}</code>\n` +
            `🔴 Sconfitte (L): <code>${losses}</code>\n\n` +
            `🔢 Match Totali: <code>${totalMatch}</code>`,
            { parse_mode: 'HTML' }
        );

    } catch (err) {
        console.error("Errore nel calcolo del record:", err);
        ctx.reply("🤖 <b>Errore interno:</b> Impossibile elaborare i dati storici.", { parse_mode: 'HTML' });
    }
});

// 7. Avvio ufficiale del Bot in polling costante
bot.launch()
    .then(() => console.log('🤖 Bot Telegram Online e configurato con fix TEXT!'))
    .catch((err) => console.error('Errore critico durante il lancio del Bot:', err));

// Gestione dello spegnimento pulito su Render
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));