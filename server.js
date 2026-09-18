const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');

// --- CONFIGURATION ---
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8712248611:AAHjNNE6Jspd05iSiy8ML5NivXd_-IleGxM';
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

const app = express();
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// --- HEAVY IN-MEMORY DATABASE ---
// स्ट्रक्चर: key (slug) -> value ({ targetUrl, owner, type, clicks, createdAt, slugId })
const siteDatabase = new Map();
const userState = new Map();

// Telegram Bot Setup
const bot = new TelegramBot(TOKEN, { polling: true });

// --- BOT MENUS & KEYBOARDS ---
const getMainMenu = () => {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔗 Create Custom Link', callback_data: 'MENU_CREATE_PATH' }],
                [{ text: '📋 Manage Links (Edit/Delete)', callback_data: 'MENU_MANAGE' }],
                [{ text: '📊 Dashboard (Stats Only)', callback_data: 'MENU_DASHBOARD' }]
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
            "🚀 **Welcome to S-Projects Premium Link Manager!**\n\n" +
            "Create custom path links with Iframe viewers, edit your links, and track analytics. Choose an option below:", 
            getMainMenu()
        );
    }

    const currentState = userState.get(chatId);
    if (!currentState) return;

    // --- STATE: WAITING FOR PATH SLUG (NEW LINK) ---
    if (currentState.step === 'WAITING_FOR_SLUG') {
        let slugInput = text.toLowerCase().replace(/[^a-z0-9.-]/g, '');

        if (!slugInput || slugInput.includes('..')) {
            return bot.sendMessage(chatId, "❌ Invalid name! Only letters, numbers, hyphens, and dots (.) are allowed. Try again:");
        }
        if (siteDatabase.has(slugInput)) {
            return bot.sendMessage(chatId, `❌ The path \`${slugInput}\` is already taken. Choose another one:`);
        }

        userState.set(chatId, { step: 'WAITING_FOR_TARGET_URL', type: 'path', slug: slugInput });
        return bot.sendMessage(chatId, `✅ Path reserved: \`${slugInput}\`\n\n🔗 Now, send me the **Target Website URL** (e.g., https://google.com) that should open when someone visits this link:`);
    }

    // --- STATE: WAITING FOR TARGET URL (NEW LINK) ---
    if (currentState.step === 'WAITING_FOR_TARGET_URL') {
        let targetUrl = text.trim();
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            targetUrl = 'https://' + targetUrl;
        }

        const slugId = currentState.slug;

        // डेटाबेस में सेव करना
        siteDatabase.set(slugId, {
            targetUrl: targetUrl,
            owner: chatId,
            type: 'path',
            clicks: 0,
            createdAt: new Date().toLocaleString(),
            slugId: slugId
        });

        userState.delete(chatId);

        const redirectLink = `${BASE_URL}/r/${slugId}`;
        const iframeLink = `${BASE_URL}/view/${slugId}`;
        
        return bot.sendMessage(chatId, 
            `🎉 **Link Successfully Created!**\n\n` +
            `🎯 **Target:** ${targetUrl}\n\n` +
            `👉 **Direct Redirect Link:**\n${redirectLink}\n\n` +
            `🖥️ **Iframe Viewer Link:**\n${iframeLink}\n\n` +
            `Use the 'Manage Links' menu to edit or track your link!`,
            getMainMenu()
        );
    }

    // --- STATE: EDITING EXISTING PATH SLUG ---
    if (currentState.step === 'WAITING_FOR_NEW_SLUG') {
        let newSlugInput = text.toLowerCase().replace(/[^a-z0-9.-]/g, '');
        const oldSlug = currentState.oldSlug;

        if (!newSlugInput || newSlugInput.includes('..')) {
            return bot.sendMessage(chatId, "❌ Invalid name! Only letters, numbers, hyphens, and dots (.) are allowed. Try again:");
        }
        if (siteDatabase.has(newSlugInput)) {
            return bot.sendMessage(chatId, `❌ The path \`${newSlugInput}\` is already taken. Choose another one:`);
        }

        // पुराना डेटा निकालें, नए में डालें और पुराना डिलीट करें
        const existingData = siteDatabase.get(oldSlug);
        existingData.slugId = newSlugInput; // अपडेट आईडी
        
        siteDatabase.set(newSlugInput, existingData);
        siteDatabase.delete(oldSlug);
        
        userState.delete(chatId);

        return bot.sendMessage(chatId, 
            `✅ **Alias/Path Successfully Updated!**\n\n` +
            `🔗 **Old Path:** /${oldSlug}\n` +
            `🔗 **New Path:** /${newSlugInput}\n\n` +
            `👉 **New Redirect:** ${BASE_URL}/r/${newSlugInput}\n` +
            `🖥️ **New Iframe:** ${BASE_URL}/view/${newSlugInput}`,
            getMainMenu()
        );
    }

    // --- STATE: EDITING EXISTING TARGET URL ---
    if (currentState.step === 'WAITING_FOR_NEW_TARGET') {
        let newTargetUrl = text.trim();
        if (!newTargetUrl.startsWith('http://') && !newTargetUrl.startsWith('https://')) {
            newTargetUrl = 'https://' + newTargetUrl;
        }

        const editSlug = currentState.slug;
        const existingData = siteDatabase.get(editSlug);
        
        existingData.targetUrl = newTargetUrl;
        siteDatabase.set(editSlug, existingData);
        
        userState.delete(chatId);

        return bot.sendMessage(chatId, 
            `✅ **Target URL Successfully Updated!**\n\n` +
            `🔗 **Path:** /${editSlug}\n` +
            `🎯 **New Target:** ${newTargetUrl}`,
            getMainMenu()
        );
    }
});

// --- BOT CALLBACK QUERIES (BUTTON CLICKS) ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const action = query.data;

    // 1. Create New Link
    if (action === 'MENU_CREATE_PATH') {
        userState.set(chatId, { step: 'WAITING_FOR_SLUG' });
        bot.sendMessage(chatId, "🔗 Send me the custom path name (e.g., `portfolio` or `my.app`):");
    } 
    
    // 2. Dashboard (View Only)
    else if (action === 'MENU_DASHBOARD') {
        let statsMsg = "📊 **Your Analytics Dashboard:**\n\n";
        let hasLinks = false;
        
        for (const [key, data] of siteDatabase.entries()) {
            if (data.owner === chatId) {
                hasLinks = true;
                statsMsg += `🔗 **Path:** /${key}\n🎯 **Target:** ${data.targetUrl}\n👀 **Clicks:** ${data.clicks}\n📅 **Created:** ${data.createdAt}\n\n`;
            }
        }
        if (!hasLinks) statsMsg = "❌ You don't have any active links yet.";
        bot.sendMessage(chatId, statsMsg, getMainMenu());
    } 
    
    // 3. Manage Links (Edit & Delete Engine)
    else if (action === 'MENU_MANAGE') {
        let hasLinks = false;
        
        for (const [key, data] of siteDatabase.entries()) {
            if (data.owner === chatId) {
                hasLinks = true;
                
                // हर लिंक के लिए एक अलग मैसेज और बटन्स भेजेंगे ताकि एडिट करना आसान हो
                const manageKeyboard = {
                    inline_keyboard: [
                        [
                            { text: '✏️ Edit Alias (Path)', callback_data: `E_P_${key}` },
                            { text: '✏️ Edit Target URL', callback_data: `E_T_${key}` }
                        ],
                        [
                            { text: '🗑️ Delete Link', callback_data: `DEL_${key}` }
                        ]
                    ]
                };

                bot.sendMessage(chatId, 
                    `📋 **Link Details:**\n\n` +
                    `🔗 **Alias/Path:** /${key}\n` +
                    `🎯 **Target:** ${data.targetUrl}\n` +
                    `👀 **Clicks:** ${data.clicks}`, 
                    { reply_markup: manageKeyboard }
                );
            }
        }
        
        if (!hasLinks) {
            bot.sendMessage(chatId, "❌ You don't have any active links to manage.", getMainMenu());
        } else {
            bot.sendMessage(chatId, "👆 Select an action from the links above.");
        }
    }

    // --- HANDLING DYNAMIC ACTIONS FOR EDIT AND DELETE ---
    
    // Edit Path (Alias)
    else if (action.startsWith('E_P_')) {
        const keyToEdit = action.replace('E_P_', '');
        if (siteDatabase.has(keyToEdit) && siteDatabase.get(keyToEdit).owner === chatId) {
            userState.set(chatId, { step: 'WAITING_FOR_NEW_SLUG', oldSlug: keyToEdit });
            bot.sendMessage(chatId, `✏️ Send the **NEW Alias/Path** to replace \`/${keyToEdit}\` (e.g., \`new.name\`):`);
        } else {
            bot.sendMessage(chatId, "❌ Link not found or unauthorized.", getMainMenu());
        }
    }

    // Edit Target URL
    else if (action.startsWith('E_T_')) {
        const keyToEdit = action.replace('E_T_', '');
        if (siteDatabase.has(keyToEdit) && siteDatabase.get(keyToEdit).owner === chatId) {
            userState.set(chatId, { step: 'WAITING_FOR_NEW_TARGET', slug: keyToEdit });
            bot.sendMessage(chatId, `✏️ Send the **NEW Target URL** for \`/${keyToEdit}\` (e.g., https://new-website.com):`);
        } else {
            bot.sendMessage(chatId, "❌ Link not found or unauthorized.", getMainMenu());
        }
    }

    // Handle Deletion
    else if (action.startsWith('DEL_')) {
        const keyToDelete = action.replace('DEL_', '');
        if (siteDatabase.has(keyToDelete) && siteDatabase.get(keyToDelete).owner === chatId) {
            siteDatabase.delete(keyToDelete);
            bot.sendMessage(chatId, `✅ Successfully revoked and deleted path: \`${keyToDelete}\``, getMainMenu());
        } else {
            bot.sendMessage(chatId, "❌ Link not found or you are not authorized to delete it.", getMainMenu());
        }
    }

    bot.answerCallbackQuery(query.id);
});

// --- EXPRESS WEB ROUTES & MIDDLEWARES ---

// 1. होमपेज रूट
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
                <p>Advanced URL Shortener, Analytics, and Iframe Viewer Server is active and processing requests.</p>
                <div class="status-badge">● Systems Operational</div>
            </div>
        </body>
        </html>
    `);
});

// 2. डायरेक्ट रीडायरेक्ट हैंडलर
app.get('/r/:slug', (req, res) => {
    const slug = req.params.slug;
    if (siteDatabase.has(slug)) {
        const linkData = siteDatabase.get(slug);
        linkData.clicks += 1; // एनालिटिक्स बढ़ाएं
        res.redirect(linkData.targetUrl);
    } else {
        res.status(404).send('<h2 style="text-align:center; margin-top:50px; color:#ef4444; font-family:sans-serif;">404 - Link Not Found or Revoked! ❌</h2>');
    }
});

// 3. आईफ्रेम व्यूअर हैंडलर
app.get('/view/:slug', (req, res) => {
    const slug = req.params.slug;
    if (siteDatabase.has(slug)) {
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
                    <div class="path-badge">Path: /${titleText}</div>
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
