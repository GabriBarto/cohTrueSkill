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

// 3. Finto Server HTTP per ingannare il controllo di Render
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
        "🏆 <b>Benvenuto nel Bot ELO di Chat of Honor!</b>\n\n" +
        "Usa il comando <code>/elo NomeGiocatore</code> per conoscere in tempo reale il punteggio in classifica di un quizzer.\n\n" +
        "📌 <b>Esempio:</b> <code>/elo RRT</code> oppure <code>/elo The_Samoan_Ingobernable</code>",
        { parse_mode: 'HTML' }
    );
});

// 5. Logica del Bot Telegram - Comando /elo Username
bot.command('elo', async (ctx) => {
    const msgText = ctx.message.text.trim();
    const args = msgText.split(/\s+/);

    // Controllo se l'utente non ha specificato nessun nome
    if (args.length < 2) {
        return ctx.reply("⚠️ <b>Specifica il nome del giocatore!</b>\nEsempio: <code>/elo WillYouPray</code>", { parse_mode: 'HTML' });
    }

    // Ricostruisce il nome dell'utente tenendo conto di eventuali spazi
    const usernameCercato = args.slice(1).join(' ').trim();

    try {
        // ILIKE esegue una ricerca Case-Insensitive (ignora maiuscole e minuscole)
        const queryText = 'SELECT username, elo FROM quizzers WHERE username ILIKE $1';
        const res = await pool.query(queryText, [usernameCercato]);

        if (res.rows.length > 0) {
            const quizzer = res.rows[0];
            // Arrotonda l'Elo a una cifra decimale per pulizia visiva
            const eloFormattato = Number(quizzer.elo).toFixed(1);

            ctx.reply(
                `📊 <b>Scheda Federazione Quizzer</b>:\n\n` +
                `👤 <b>Giocatore:</b> ${quizzer.username}\n` +
                `🏆 <b>Punteggio ELO:</b> <code>${eloFormattato}</code>`,
                { parse_mode: 'HTML' }
            );
        } else {
            ctx.reply(`❌ Il giocatore "<b>${usernameCercato}</b>" non è stato trovato nel database del Roster.`, { parse_mode: 'HTML' });
        }
    } catch (err) {
        console.error("Errore durante la query al database:", err);
        ctx.reply("🤖 <b>Errore interno:</b> Impossibile comunicare con il database delle classifiche in questo momento.", { parse_mode: 'HTML' });
    }
});

// 6. Avvio ufficiale del Bot in polling costante
bot.launch()
    .then(() => console.log('🤖 Telegram Bot online e sincronizzato con il database!'))
    .catch((err) => console.error('Errore critico durante il lancio del Bot:', err));

// Gestione della terminazione pulita del processo su Render .
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));