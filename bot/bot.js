const { Telegraf } = require('telegraf');
const { Pool } = require('pg');
require('dotenv').config();

// Controllo delle variabili d'ambiente
if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.DATABASE_URL) {
    console.error("Errore: Mancano le variabili d'ambiente TELEGRAM_BOT_TOKEN o DATABASE_URL nel file .env");
    process.exit(1);
}

// Inizializzazione del Bot e del Database
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Richiesto per Neon.tech
});

// Comando di benvenuto /start
bot.start((ctx) => {
    ctx.reply(
        "🏆 Benvenuto nel Bot Ufficiale di Chat of Honor!\n\n" +
        "Usa il comando `/elo NomeGiocatore` per conoscere il punteggio attuale di un quizzer.\n" +
        "Esempio: `/elo RRT`",
        { parse_mode: 'Markdown' }
    );
});

// Comando principale /elo
bot.command('elo', async (ctx) => {
    // Recupera il testo dopo il comando /elo
    const msgText = ctx.message.text.trim();
    const args = msgText.split(/\s+/);

    // Se l'utente ha scritto solo "/elo" senza specificare il nome
    if (args.length < 2) {
        return ctx.reply("⚠️ Specifica il nome del giocatore!\nEsempio: `/elo WillYouPray`", { parse_mode: 'Markdown' });
    }

    // Ricostruisce il nome nel caso ci siano spazi (es. "The All-Father Lore")
    const usernameCercato = args.slice(1).join(' ').trim();

    try {
        // ILIKE rende la ricerca case-insensitive (ignora maiuscole/minuscole)
        const queryText = 'SELECT username, elo FROM quizzers WHERE username ILIKE $1';
        const res = await pool.query(queryText, [usernameCercato]);

        if (res.rows.length > 0) {
            const quizzer = res.rows[0];
            // Arrotonda l'Elo a 1 cifra decimale per estetica
            const eloFormattato = Number(quizzer.elo).toFixed(1);

            ctx.reply(
                `📊 *Scheda Quizzer*:\n\n` +
                `👤 *Giocatore:* ${quizzer.username}\n` +
                `🏆 *Punteggio ELO:* \`${eloFormattato}\``,
                { parse_mode: 'Markdown' }
            );
        } else {
            ctx.reply(`❌ Giocatore *"${usernameCercato}"* non trovato nel database della federazione.`, { parse_mode: 'Markdown' });
        }
    } catch (err) {
        console.error("Errore database:", err);
        ctx.reply("🤖 Errore interno del bot durante la lettura del database.");
    }
});

// Avvio del Bot
bot.launch()
    .then(() => console.log('🤖 Telegram Bot online e pronto a ricevere comandi!'))
    .catch((err) => console.error('Errore durante l'avvio del bot: ', err));

// Gestione della chiusura sicura
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));