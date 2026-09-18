const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');

// --- CONFIGURATION ---
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8712248611:AAHjNNE6Jspd05iSiy8ML5NivXd_-IleGxM';
const PORT = process.env.PORT || 3000;
// Render का अपना खुद का URL स्वतः ले लेगा या लोकल होस्ट
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

const app = express();
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// इन-मेमोरी डेटाबेस (पाथ और उसकी टारगेट वेबसाइट को स्टोर करने के लिए)
const siteDatabase = new Map();

// Telegram Bot Setup
const bot = new TelegramBot(TOKEN, { polling: true });

// यूजर स्टेट ट्रैक करने के लिए
const userState = new Map();

// --- TELEGRAM BOT LOGIC ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text ? msg.text.trim() : '';

    if (text === '/start') {
        userState.set(chatId, 'WAITING_FOR_SLUG');
        return bot.sendMessage(chatId, 
            "🚀 **Welcome to S-Projects Custom Path Creator!**\n\n" +
            "Send me the name/slug you want for your link (Dots and hyphens are allowed, e.g., `my.site` or `portfolio`):"
        );
    }

    // स्टेप 1: यूजर ने पाथ/नाम भेजा, अब उसकी टारगेट URL मांगेंगे
    if (userState.get(chatId) === 'WAITING_FOR_SLUG') {
        let slugInput = text.toLowerCase().replace(/[^a-z0-9.-]/g, '');

        if (!slugInput || slugInput.includes('..')) {
            return bot.sendMessage(chatId, "❌ Invalid name! Only letters, numbers, hyphens, and dots (.) are allowed. Try again:");
        }

        if (siteDatabase.has(slugInput)) {
            return bot.sendMessage(chatId, `❌ The name \`${slugInput}\` is already taken by someone else. Choose a different name:`);
        }

        userState.set(chatId, { state: 'WAITING_FOR_TARGET_URL', slug: slugInput });
        return bot.sendMessage(chatId, `✅ Great choice: \`${slugInput}\`\n\nNow, send me the **Target Website URL** (e.g., https://google.com or your project link) that should open when someone visits this link:`);
    }

    // स्टेप 2: यूजर ने टारगेट URL भेजा, अब दोनों को लिंक कर देंगे
    const currentState = userState.get(chatId);
    if (currentState && currentState.state === 'WAITING_FOR_TARGET_URL') {
        let targetUrl = text.trim();
        
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            targetUrl = 'https://' + targetUrl;
        }

        const slug = currentState.slug;
        siteDatabase.set(slug, targetUrl);
        userState.delete(chatId);

        const customLink = `${BASE_URL}/${slug}`;

        return bot.sendMessage(chatId, 
            `🎉 **Successfully Created!**\n\n` +
            `🔗 **Your Custom Link:** ${customLink}\n` +
            `🎯 **Points To:** ${targetUrl}\n\n` +
            `Whenever anyone opens your link, your Render server will serve it instantly!`
        );
    } else if (text !== '/start') {
        return bot.sendMessage(chatId, "Type /start to create a new custom path link.");
    }
});

// --- EXPRESS WEB ROUTES ---

// 1. होमपेज रूट
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>S-Projects Path Server</title>
            <style>
                body { font-family: Arial, sans-serif; background: #0f172a; color: #f8fafc; text-align: center; padding: 50px; }
                .card { background: #1e293b; padding: 30px; border-radius: 12px; display: inline-block; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
                h1 { color: #38bdf8; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>S-Projects Server Active 🚀</h1>
                <p>Path-based URL redirect & viewer system is running on Render!</p>
            </div>
        </body>
        </html>
    `);
});

// 2. डायनेमिक पाथ हैंडलर (जैसे /my.site)
app.get('/:slug', (req, res) => {
    const slug = req.params.slug;
    const targetUrl = siteDatabase.get(slug);

    if (!targetUrl) {
        return res.status(404).send(`
            <h2 style="font-family:sans-serif; text-align:center; margin-top:50px; color:red;">
                404 - Link Not Found or Expired! ❌
            </h2>
        `);
    }

    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>S-Projects Viewer - ${slug}</title>
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body, html { width: 100%; height: 100%; overflow: hidden; font-family: sans-serif; background: #0f172a; }
                #top-bar {
                    height: 50px; background: #1e293b; color: #fff; display: flex; 
                    justify-content: space-between; align-items: center; padding: 0 20px;
                    border-bottom: 2px solid #334155;
                }
                .btn { background: #0284c7; color: white; padding: 5px 12px; border-radius: 5px; text-decoration: none; font-size: 13px; }
                #frame-container { width: 100%; height: calc(100% - 50px); }
                iframe { width: 100%; height: 100%; border: none; background: #fff; }
            </style>
        </head>
        <body>
            <div id="top-bar">
                <div>⚡ S-Projects | Path: <b>/${slug}</b></div>
                <div>
                    <a href="${targetUrl}" target="_blank" class="btn">Open Original ↗</a>
                </div>
            </div>
            <div id="frame-container">
                <iframe src="${targetUrl}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
            </div>
        </body>
        </html>
    `);
});

// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`🚀 S-Projects Server running on port ${PORT}`);
});