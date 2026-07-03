// telegramBot.js
const { Telegraf } = require('telegraf');

// Inizializzazione protetta del bot tramite variabile d'ambiente su Render
const botToken = process.env.TELEGRAM_TOKEN;
const bot = botToken ? new Telegraf(botToken) : null;

if (!bot) {
    console.warn("⚠️ TELEGRAM_TOKEN non configurato nelle variabili d'ambiente. Il bot sarà disattivato.");
} else {
    // Comando base /start
    bot.command('start', (ctx) => {
        ctx.reply('📊 Bot CoH TrueSkill Attivo! Riceverai qui i report dei match inseriti dal pannello admin.');
    });

    bot.launch()
        .then(() => console.log('🚀 Bot Telegram avviato con successo!'))
        .catch((err) => console.error('❌ Errore avvio Bot Telegram:', err));
}

/**
 * Invia un report formattato su Telegram dopo l'inserimento di un match
 * @param {string} showName - Nome dello show/evento
 * @param {boolean} isTitle - Se il match era titolato
 * @param {Array} teams - Array di team e giocatori modificati
 */
async function inviaReportMatch(showName, isTitle, teams) {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!bot || !chatId) return;

    try {
        let text = `🎬 *NUOVO MATCH REGISTRATO*\n`;
        text += `🏟️ *Show:* ${showName}\n`;
        text += `👑 *Match Titolato:* ${isTitle ? 'SÌ (Variazioni Raddoppiate 2x)' : 'NO'}\n\n`;
        text += `📊 *Risultati & Classifica Transitoria:*\n`;

        // Ordina i team per rank (dal 1° classificato in poi)
        const sortedTeams = [...teams].sort((a, b) => a.rank - b.rank);

        sortedTeams.forEach((team) => {
            const medaglia = team.rank === 1 ? '🥇' : team.rank === 2 ? '🥈' : team.rank === 3 ? '🥉' : '🔹';
            text += `${medaglia} *Posizione ${team.rank}:*\n`;

            team.giocatori.forEach((giocatore) => {
                text += `  • _${giocatore}_\n`;
            });
        });

        text += `\n📅 _Aggiornato automaticamente dal server CoH_`;

        await bot.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        console.log('✅ Report del match inviato su Telegram.');
    } catch (error) {
        console.error('❌ Impossibile inviare il report del match su Telegram:', error.message);
    }
}

module.exports = { inviaReportMatch };