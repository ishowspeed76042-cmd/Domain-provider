const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');

// --- CONFIGURATION ---
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8712248611:AAHjNNE6Jspd05iSiy8ML5NivXd_-IleGxM';
const PORT = process.env.PORT || 3000;
// Render CNAME (DNS सेटिंग्स के लिए यूजर को दिखाने के काम आएगा)
const RENDER_CNAME = process.env.RENDER_CNAME || 's-projects.onrender.com';
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

const app = express();
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// --- HEAVY IN-MEMORY DATABASE ---
// स्ट्रक्चर: key (slug या customDomain) -> value ({ targetUrl, owner, type, clicks, createdAt, slugId })
const siteDatabase = new Map();
const userState = new Map();

// Telegram Bot Setup
const bot = new TelegramBot(TOKEN, { polling: true });

// --- BOT MENUS & KEYBOARDS ---
const getMainMenu = () => {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔗 Create Path Link (/s/name)', callback_data: 'MENU_CREATE_PATH' }],
                [{ text: '🌐 Connect Custom Domain (DNS)', callback_data: 'MENU_CREATE_DNS' }],
                [{ text: '📊 My Dashboard (Analytics)', callback_data: 'MENU_DASHBOARD' }],
                [{ text: '🗑️ Revoke/Delete Links', callback_data: 'MENU_REVOKE' }]
            ]
        }
    };
};

// --- TELEGRAM BOT LOGIC ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text ? msg.text.trim() : '';

    if (text === '/start') {
        userState.delete(chatId); // पुराना स्टेट क्लियर करें
        return bot.sendMessage(chatId, 
            "🚀 **Welcome to S-Projects Premium Link & DNS Manager!**\n\n" +
            "Choose a powerful feature from the menu below to get started:", 
            getMainMenu()
        );
    }

    const currentState = userState.get(chatId);
    if (!currentState) return;

    // --- STATE: WAITING FOR PATH SLUG ---
    if (currentState.step === 'WAITING_FOR_SLUG') {
        let slugInput = text.toLowerCase().replace(/[^a-z0-9.-]/g, '');

        if (!slugInput || slugInput.includes('..')) {
            return bot.sendMessage(chatId, "❌ Invalid name! Only letters, numbers, hyphens, and dots (.) are allowed. Try again:");
        }
        if (siteDatabase.has(slugInput)) {
            return bot.sendMessage(chatId, `❌ The path \`${slugInput}\` is already taken. Choose another one:`);
        }

        userState.set(chatId, { step: 'WAITING_FOR_TARGET_URL', type: 'path', slug: slugInput });
        return bot.sendMessage(chatId, `✅ Path reserved: \`${slugInput}\`\n\n🔗 Now, send me the **Target Website URL** (e.g., https://google.com):`);
    }

    // --- STATE: WAITING FOR CUSTOM DOMAIN ---
    if (currentState.step === 'WAITING_FOR_DOMAIN') {
        let domainInput = text.toLowerCase().replace(/[^a-z0-9.-]/g, '');

        if (!domainInput || domainInput.includes('..') || !domainInput.includes('.')) {
            return bot.sendMessage(chatId, "❌ Invalid domain format! It should look like `app.mywebsite.com`. Try again:");
        }
        if (siteDatabase.has(domainInput)) {
            return bot.sendMessage(chatId, `❌ The domain \`${domainInput}\` is already registered in our system.`);
        }

        userState.set(chatId, { step: 'WAITING_FOR_TARGET_URL', type: 'dns', slug: domainInput });
        return bot.sendMessage(chatId, `✅ Domain noted: \`${domainInput}\`\n\n🔗 Now, send me the **Target Website URL** where this domain should point:`);
    }

    // --- STATE: WAITING FOR TARGET URL (Shared for both Path and DNS) ---
    if (currentState.step === 'WAITING_FOR_TARGET_URL') {
        let targetUrl = text.trim();
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            targetUrl = 'https://' + targetUrl;
        }

        const idKey = currentState.slug; // slug या domain
        const linkType = currentState.type;

        siteDatabase.set(idKey, {
            targetUrl: targetUrl,
            owner: chatId,
            type: linkType,
            clicks: 0,
            createdAt: new Date().toLocaleString(),
            slugId: idKey
        });

        userState.delete(chatId);

        if (linkType === 'path') {
            const redirectLink = `${BASE_URL}/r/${idKey}`;
            const iframeLink = `${BASE_URL}/view/${idKey}`;
            return bot.sendMessage(chatId, 
                `🎉 **Path Link Successfully Created!**\n\n` +
                `🎯 **Target:** ${targetUrl}\n\n` +
                `👉 **Direct Redirect Link:**\n${redirectLink}\n\n` +
                `🖥️ **Iframe Viewer Link:**\n${iframeLink}\n\n` +
                `Use the dashboard to track clicks!`,
                getMainMenu()
            );
        } else if (linkType === 'dns') {
            return bot.sendMessage(chatId, 
                `🎉 **Custom Domain Setup Initiated!**\n\n` +
                `🌐 **Your Domain:** ${idKey}\n` +
                `🎯 **Target:** ${targetUrl}\n\n` +
                `⚠️ **ACTION REQUIRED (DNS Setup):**\n` +
                `Go to your domain registrar (e.g., GoDaddy, Cloudflare) and create a **CNAME Record**:\n` +
                `• **Name/Host:** \`${idKey.split('.')[0]}\` (or full domain based on provider)\n` +
                `• **Value/Target:** \`${RENDER_CNAME}\`\n\n` +
                `Once DNS propagates, anyone visiting http://${idKey} will see your site!`,
                getMainMenu()
            );
        }
    }
});

// --- BOT CALLBACK QUERIES (BUTTON CLICKS) ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const action = query.data;

    if (action === 'MENU_CREATE_PATH') {
        userState.set(chatId, { step: 'WAITING_FOR_SLUG' });
        bot.sendMessage(chatId, "🔗 Send me the custom path name (e.g., `portfolio` or `my.app`):");
    } 
    
    else if (action === 'MENU_CREATE_DNS') {
        userState.set(chatId, { step: 'WAITING_FOR_DOMAIN' });
        bot.sendMessage(chatId, "🌐 Send me your full custom domain (e.g., `app.yourdomain.com`):");
    } 
    
    else if (action === 'MENU_DASHBOARD') {
        let statsMsg = "📊 **Your Dashboard & Analytics:**\n\n";
        let hasLinks = false;
        
        for (const [key, data] of siteDatabase.entries()) {
            if (data.owner === chatId) {
                hasLinks = true;
                const typeIcon = data.type === 'dns' ? '🌐' : '🔗';
                statsMsg += `${typeIcon} **ID:** ${key}\n   🎯 Target: ${data.targetUrl}\n   👀 Clicks: **${data.clicks}**\n\n`;
            }
        }
        if (!hasLinks) statsMsg = "❌ You don't have any active links or domains yet.";
        bot.sendMessage(chatId, statsMsg, getMainMenu());
    } 
    
    else if (action === 'MENU_REVOKE') {
        const revokeButtons = [];
        for (const [key, data] of siteDatabase.entries()) {
            if (data.owner === chatId) {
                revokeButtons.push([{ text: `❌ Delete: ${key} (${data.type})`, callback_data: `DELETE_${key}` }]);
            }
        }
        
        if (revokeButtons.length === 0) {
            bot.sendMessage(chatId, "❌ You have no links to revoke.", getMainMenu());
        } else {
            bot.sendMessage(chatId, "⚠️ Click a link below to permanently delete/revoke it:", {
                reply_markup: { inline_keyboard: revokeButtons }
            });
        }
    }

    // Handle Deletion
    else if (action.startsWith('DELETE_')) {
        const keyToDelete = action.replace('DELETE_', '');
        if (siteDatabase.has(keyToDelete) && siteDatabase.get(keyToDelete).owner === chatId) {
            siteDatabase.delete(keyToDelete);
            bot.sendMessage(chatId, `✅ Successfully revoked and deleted: \`${keyToDelete}\``, getMainMenu());
        } else {
            bot.sendMessage(chatId, "❌ Link not found or unauthorized.", getMainMenu());
        }
    }

    bot.answerCallbackQuery(query.id);
});

// --- EXPRESS WEB ROUTES & MIDDLEWARES ---

// 1. DNS / CUSTOM DOMAIN MIDDLEWARE (Heavy interceptor)
app.use((req, res, next) => {
    const host = req.hostname; // e.g., app.userdomain.com
    
    // अगर रिक्वेस्ट हमारे मेन सर्वर के अलावा किसी कस्टम डोमेन से आ रही है और डेटाबेस में है
    if (siteDatabase.has(host) && siteDatabase.get(host).type === 'dns') {
        const domainData = siteDatabase.get(host);
        domainData.clicks += 1; // एनालिटिक्स बढ़ाएं
        
        // DNS वालों को एक प्रोफेशनल आईफ्रेम में वेबसाइट सर्व करें 
        return res.send(generateIframeHTML(domainData.targetUrl, host));
    }
    
    next(); // अगर कस्टम डोमेन नहीं है, तो नॉर्मल राउट्स पर जाने दें
});

// 2. होमपेज रूट
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>S-Projects Network</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; color: #f8fafc; text-align: center; padding: 10%; margin: 0; }
                .card { background: #1e293b; padding: 40px; border-radius: 16px; display: inline-block; box-shadow: 0 10px 25px rgba(0,0,0,0.5); max-width: 600px; width: 100%; }
                h1 { color: #38bdf8; font-size: 2.5em; margin-bottom: 10px; }
                p { color: #94a3b8; font-size: 1.1em; line-height: 1.6; }
                .status-badge { display: inline-block; background: #059669; color: white; padding: 5px 15px; border-radius: 20px; font-weight: bold; margin-top: 20px; font-size: 14px;}
            </style>
        </head>
        <body>
            <div class="card">
                <h1>S-Projects Engine 🚀</h1>
                <p>Advanced URL Shortener, DNS Router, and Analytics Server is active and processing requests on Render.</p>
                <div class="status-badge">● Systems Operational</div>
            </div>
        </body>
        </html>
    `);
});

// 3. डायरेक्ट रीडायरेक्ट हैंडलर
app.get('/r/:slug', (req, res) => {
    const slug = req.params.slug;
    if (siteDatabase.has(slug) && siteDatabase.get(slug).type === 'path') {
        const linkData = siteDatabase.get(slug);
        linkData.clicks += 1; // एनालिटिक्स बढ़ाएं
        res.redirect(linkData.targetUrl);
    } else {
        res.status(404).send('<h2 style="text-align:center; margin-top:50px; color:#ef4444; font-family:sans-serif;">404 - Link Not Found or Revoked! ❌</h2>');
    }
});

// 4. आईफ्रेम व्यूअर हैंडलर
app.get('/view/:slug', (req, res) => {
    const slug = req.params.slug;
    if (siteDatabase.has(slug) && siteDatabase.get(slug).type === 'path') {
        const linkData = siteDatabase.get(slug);
        linkData.clicks += 1; // एनालिटिक्स बढ़ाएं
        res.send(generateIframeHTML(linkData.targetUrl, slug));
    } else {
        res.status(404).send('<h2 style="text-align:center; margin-top:50px; color:#ef4444; font-family:sans-serif;">404 - Link Not Found or Revoked! ❌</h2>');
    }
});

// --- HELPER FUNCTION: HEAVY IFRAME HTML GENERATOR ---
function generateIframeHTML(targetUrl, titleText) {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${titleText} - S-Projects Viewer</title>
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body, html { width: 100%; height: 100%; overflow: hidden; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; }
                #top-bar {
                    height: 55px; background: #1e293b; color: #ffffff; display: flex; 
                    justify-content: space-between; align-items: center; padding: 0 20px;
                    border-bottom: 2px solid #334155; box-shadow: 0 2px 10px rgba(0,0,0,0.4);
                }
                .brand-section { display: flex; align-items: center; gap: 15px; }
                .brand-title { font-size: 16px; font-weight: bold; color: #38bdf8; letter-spacing: 0.5px; }
                .path-badge { background: #334155; padding: 4px 12px; border-radius: 6px; font-size: 13px; color: #cbd5e1; border: 1px solid #475569; }
                .actions { display: flex; gap: 12px; }
                .btn { 
                    background: #0ea5e9; color: white; padding: 8px 16px; border-radius: 6px; 
                    text-decoration: none; font-size: 13px; font-weight: bold; transition: all 0.2s ease;
                }
                .btn:hover { background: #0284c7; transform: translateY(-1px); }
                .btn-outline { background: transparent; border: 1px solid #64748b; color: #cbd5e1; }
                .btn-outline:hover { background: #334155; color: white; border-color: #94a3b8; }
                #frame-container { width: 100%; height: calc(100% - 55px); background: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><text x="50%" y="50%" font-family="sans-serif" font-size="10" fill="%23334155" text-anchor="middle" dominant-baseline="middle">Loading...</text></svg>') center center no-repeat; }
                iframe { width: 100%; height: 100%; border: none; background: #ffffff; }
            </style>
        </head>
        <body>
            <div id="top-bar">
                <div class="brand-section">
                    <div class="brand-title">⚡ S-PROJECTS NETWORK</div>
                    <div class="path-badge">ID: ${titleText}</div>
                </div>
                <div class="actions">
                    <button class="btn btn-outline" onclick="location.reload()">🔄 Refresh</button>
                    <a href="${targetUrl}" target="_blank" class="btn">Open Original ↗</a>
                </div>
            </div>
            <div id="frame-container">
                <iframe src="${targetUrl}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" allowfullscreen></iframe>
            </div>
        </body>
        </html>
    `;
}

// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`🚀 Advanced S-Projects Server running on port ${PORT}`);
});
