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
// स्ट्रक्चर: key (slug) -> value ({ targetUrl, owner, clicks, createdAt, slugId, password, seoTitle, seoDesc, mode })
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
                [{ text: '📋 Manage Links (Edit/Delete/Lock)', callback_data: 'MENU_MANAGE' }],
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
            "Create advanced links (.bike, .water), set Passwords, SEO, and let users choose between Redirect & Iframe. Choose an option below:", 
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

        // डेटाबेस में भारी डेटा सेव करना
        siteDatabase.set(slugId, {
            targetUrl: targetUrl,
            owner: chatId,
            type: 'path',
            clicks: 0,
            createdAt: new Date().toLocaleString(),
            slugId: slugId,
            password: null, // Default: No Password
            seoTitle: `S-Projects: ${slugId}`,
            seoDesc: 'Click to open this secured and custom generated link.',
            mode: 'choice' // Default Mode: Shows options on screen to user
        });

        userState.delete(chatId);

        const mainLink = `${BASE_URL}/${slugId}`;
        
        return bot.sendMessage(chatId, 
            `🎉 **Link Successfully Created!**\n\n` +
            `🎯 **Target:** ${targetUrl}\n\n` +
            `🌐 **Main Link:**\n${mainLink}\n\n` +
            `*(By default, visitors will see a screen asking them to choose between Redirect or Iframe. You can change this in Manage Links!)*\n\n` +
            `Use the 'Manage Links' menu to set Passwords, Edit SEO, or change Mode!`,
            getMainMenu()
        );
    }

    // --- STATE: EDITING EXISTING PATH SLUG ---
    if (currentState.step === 'WAITING_FOR_NEW_SLUG') {
        let newSlugInput = text.toLowerCase().replace(/[^a-z0-9.-]/g, '');
        const oldSlug = currentState.oldSlug;

        if (!newSlugInput || newSlugInput.includes('..')) {
            return bot.sendMessage(chatId, "❌ Invalid name! Try again:");
        }
        if (siteDatabase.has(newSlugInput)) {
            return bot.sendMessage(chatId, `❌ The path \`${newSlugInput}\` is already taken. Choose another one:`);
        }

        const existingData = siteDatabase.get(oldSlug);
        existingData.slugId = newSlugInput; 
        
        siteDatabase.set(newSlugInput, existingData);
        siteDatabase.delete(oldSlug);
        
        userState.delete(chatId);
        return bot.sendMessage(chatId, `✅ **Alias/Path Updated!**\n\n🔗 **New Path:** /${newSlugInput}\n👉 **Main Link:** ${BASE_URL}/${newSlugInput}`, getMainMenu());
    }

    // --- STATE: EDITING TARGET URL ---
    if (currentState.step === 'WAITING_FOR_NEW_TARGET') {
        let newTargetUrl = text.trim();
        if (!newTargetUrl.startsWith('http://') && !newTargetUrl.startsWith('https://')) newTargetUrl = 'https://' + newTargetUrl;

        const editSlug = currentState.slug;
        const existingData = siteDatabase.get(editSlug);
        existingData.targetUrl = newTargetUrl;
        siteDatabase.set(editSlug, existingData);
        
        userState.delete(chatId);
        return bot.sendMessage(chatId, `✅ **Target URL Updated!**\n🔗 **Path:** /${editSlug}\n🎯 **New Target:** ${newTargetUrl}`, getMainMenu());
    }

    // --- STATE: SETTING PASSWORD ---
    if (currentState.step === 'WAITING_FOR_PASSWORD') {
        const editSlug = currentState.slug;
        const existingData = siteDatabase.get(editSlug);
        
        if (text.toLowerCase() === 'remove') {
            existingData.password = null;
            bot.sendMessage(chatId, `🔓 **Password Removed!** Your link \`/${editSlug}\` is now public.`, getMainMenu());
        } else {
            existingData.password = text;
            bot.sendMessage(chatId, `🔒 **Password Set!**\nAnyone opening \`/${editSlug}\` will now need to enter: \`${text}\``, getMainMenu());
        }
        siteDatabase.set(editSlug, existingData);
        userState.delete(chatId);
        return;
    }

    // --- STATE: SETTING SEO DATA ---
    if (currentState.step === 'WAITING_FOR_SEO') {
        const editSlug = currentState.slug;
        const existingData = siteDatabase.get(editSlug);
        
        const parts = text.split('|');
        existingData.seoTitle = parts[0] ? parts[0].trim() : `S-Projects: ${editSlug}`;
        existingData.seoDesc = parts[1] ? parts[1].trim() : 'Click to open this secured link.';
        
        siteDatabase.set(editSlug, existingData);
        userState.delete(chatId);
        return bot.sendMessage(chatId, `🌐 **SEO Previews Updated!**\n\n**Title:** ${existingData.seoTitle}\n**Description:** ${existingData.seoDesc}`, getMainMenu());
    }
});

// --- BOT CALLBACK QUERIES ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const action = query.data;

    if (action === 'MENU_CREATE_PATH') {
        userState.set(chatId, { step: 'WAITING_FOR_SLUG' });
        bot.sendMessage(chatId, "🔗 Send me the custom path name (e.g., `portfolio.bike` or `my.app`):");
    } 
    else if (action === 'MENU_DASHBOARD') {
        let statsMsg = "📊 **Your Analytics Dashboard:**\n\n";
        let hasLinks = false;
        for (const [key, data] of siteDatabase.entries()) {
            if (data.owner === chatId) {
                hasLinks = true;
                const lockStatus = data.password ? "🔒 Yes" : "🔓 No";
                statsMsg += `🔗 **Path:** /${key}\n🎯 **Target:** ${data.targetUrl}\n👀 **Clicks:** ${data.clicks}\n🔑 **Locked:** ${lockStatus}\n⚙️ **Mode:** ${data.mode}\n📅 **Created:** ${data.createdAt}\n\n`;
            }
        }
        if (!hasLinks) statsMsg = "❌ You don't have any active links yet.";
        bot.sendMessage(chatId, statsMsg, getMainMenu());
    } 
    else if (action === 'MENU_MANAGE') {
        let hasLinks = false;
        for (const [key, data] of siteDatabase.entries()) {
            if (data.owner === chatId) {
                hasLinks = true;
                
                // Mode text logic
                let modeText = '⚙️ Mode: Choice Screen';
                if(data.mode === 'redirect') modeText = '⚙️ Mode: Auto-Redirect';
                if(data.mode === 'iframe') modeText = '⚙️ Mode: Auto-Iframe';

                const manageKeyboard = {
                    inline_keyboard: [
                        [
                            { text: '✏️ Edit Path', callback_data: `E_P_${key}` },
                            { text: '✏️ Edit Target', callback_data: `E_T_${key}` }
                        ],
                        [
                            { text: data.password ? '🔓 Change/Remove Password' : '🔒 Set Password', callback_data: `SET_PASS_${key}` },
                            { text: '🌐 Edit SEO', callback_data: `SET_SEO_${key}` }
                        ],
                        [
                            { text: modeText, callback_data: `TGL_MODE_${key}` }
                        ],
                        [
                            { text: '🗑️ Delete Link', callback_data: `DEL_${key}` }
                        ]
                    ]
                };

                bot.sendMessage(chatId, 
                    `📋 **Link:** /${key}\n🎯 **Target:** ${data.targetUrl}\n🔒 **Password:** ${data.password ? data.password : 'None'}\n⚙️ **Current Mode:** ${data.mode}`, 
                    { reply_markup: manageKeyboard }
                );
            }
        }
        if (!hasLinks) bot.sendMessage(chatId, "❌ You don't have any active links.", getMainMenu());
    }

    // --- DYNAMIC ACTIONS ---
    else if (action.startsWith('TGL_MODE_')) {
        const key = action.replace('TGL_MODE_', '');
        if (siteDatabase.has(key) && siteDatabase.get(key).owner === chatId) {
            const data = siteDatabase.get(key);
            // Cycle Mode: choice -> redirect -> iframe -> choice
            if (data.mode === 'choice') data.mode = 'redirect';
            else if (data.mode === 'redirect') data.mode = 'iframe';
            else data.mode = 'choice';
            
            siteDatabase.set(key, data);
            bot.sendMessage(chatId, `✅ **Behavior Mode Updated for /${key}**\nNew Mode is now: **${data.mode.toUpperCase()}**`, getMainMenu());
        }
    }
    else if (action.startsWith('E_P_')) {
        const key = action.replace('E_P_', '');
        userState.set(chatId, { step: 'WAITING_FOR_NEW_SLUG', oldSlug: key });
        bot.sendMessage(chatId, `✏️ Send NEW Alias to replace \`/${key}\`:`);
    }
    else if (action.startsWith('E_T_')) {
        const key = action.replace('E_T_', '');
        userState.set(chatId, { step: 'WAITING_FOR_NEW_TARGET', slug: key });
        bot.sendMessage(chatId, `✏️ Send NEW Target URL for \`/${key}\`:`);
    }
    else if (action.startsWith('SET_PASS_')) {
        const key = action.replace('SET_PASS_', '');
        userState.set(chatId, { step: 'WAITING_FOR_PASSWORD', slug: key });
        bot.sendMessage(chatId, `🔒 Enter the password you want to set for \`/${key}\`.\n*(Type 'remove' to disable)*`);
    }
    else if (action.startsWith('SET_SEO_')) {
        const key = action.replace('SET_SEO_', '');
        userState.set(chatId, { step: 'WAITING_FOR_SEO', slug: key });
        bot.sendMessage(chatId, `🌐 Send Title and Description separated by a pipe character (|).\nExample: \`Title | Description\``);
    }
    else if (action.startsWith('DEL_')) {
        const key = action.replace('DEL_', '');
        siteDatabase.delete(key);
        bot.sendMessage(chatId, `✅ Successfully deleted path: \`${key}\``, getMainMenu());
    }
    
    bot.answerCallbackQuery(query.id);
});

// --- EXPRESS WEB ROUTES & MIDDLEWARES ---

// 1. Home
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>S-Projects Advanced Network</title>
            <style>
                body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #f8fafc; text-align: center; padding: 10%; margin: 0; }
                .card { background: #1e293b; padding: 40px; border-radius: 16px; display: inline-block; box-shadow: 0 10px 25px rgba(0,0,0,0.5); max-width: 600px; width: 100%; border: 1px solid #334155; }
                h1 { color: #38bdf8; font-size: 2.5em; margin-bottom: 10px; }
                p { color: #94a3b8; font-size: 1.1em; line-height: 1.6; }
                .status-badge { display: inline-block; background: #059669; color: white; padding: 5px 15px; border-radius: 20px; font-weight: bold; margin-top: 20px; font-size: 14px;}
            </style>
        </head>
        <body>
            <div class="card">
                <h1>S-Projects Engine 🚀</h1>
                <p>Advanced Custom URLs, Password Protection, SEO Previews, Choice Screens, and Iframe Viewer are running perfectly.</p>
                <div class="status-badge">● Systems Operational</div>
            </div>
        </body>
        </html>
    `);
});

// 2. Auth Endpoint (For Checking Password on Any Route)
app.post('/auth/:slug', (req, res) => {
    const slug = req.params.slug;
    const { password, targetType } = req.body; 
    
    if (siteDatabase.has(slug)) {
        const linkData = siteDatabase.get(slug);
        if (linkData.password === password) {
            // Password Correct! Route based on Target Type
            if (targetType === 'view') {
                linkData.clicks += 1;
                return res.send(generateIframeHTML(linkData.targetUrl, slug, linkData.seoTitle));
            } 
            else if (targetType === 'redirect') {
                linkData.clicks += 1;
                return res.send(generateSEORedirectHTML(linkData));
            } 
            else if (targetType === 'main') {
                // If it's the main link, check the Mode setting
                if (linkData.mode === 'redirect') {
                    linkData.clicks += 1;
                    return res.send(generateSEORedirectHTML(linkData));
                } else if (linkData.mode === 'iframe') {
                    linkData.clicks += 1;
                    return res.send(generateIframeHTML(linkData.targetUrl, slug, linkData.seoTitle));
                } else {
                    return res.send(generateChoicePageHTML(linkData, slug)); // No click count here, user hasn't clicked yet
                }
            }
        } else {
            res.send(generatePasswordPageHTML(slug, targetType, true)); 
        }
    } else {
        res.status(404).send('<h2 style="color:#ef4444; text-align:center; margin-top:50px;">404 - Link Revoked!</h2>');
    }
});

// 3. Main Portal Link Handler (BASE_URL/:slug) - THE NEW FEATURE!
app.get('/:slug', (req, res) => {
    const slug = req.params.slug;
    if (siteDatabase.has(slug)) {
        const linkData = siteDatabase.get(slug);
        
        if (linkData.password) {
            return res.send(generatePasswordPageHTML(slug, 'main')); // Ask password first
        }
        
        // Behavior based on selected Mode
        if (linkData.mode === 'redirect') {
            linkData.clicks += 1;
            return res.send(generateSEORedirectHTML(linkData));
        } 
        else if (linkData.mode === 'iframe') {
            linkData.clicks += 1;
            return res.send(generateIframeHTML(linkData.targetUrl, slug, linkData.seoTitle));
        } 
        else {
            // mode === 'choice' -> Show the Choice Screen Landing Page
            return res.send(generateChoicePageHTML(linkData, slug));
        }
    } else {
        // Fallback for root or invalid paths
        if(slug !== 'favicon.ico') {
            res.status(404).send('<h2 style="color:#ef4444; text-align:center; margin-top:50px; font-family:sans-serif;">404 - Link Not Found or Revoked! ❌</h2>');
        }
    }
});

// 4. Force Direct Redirect Handler (/r/:slug) - Still works as a bypass
app.get('/r/:slug', (req, res) => {
    const slug = req.params.slug;
    if (siteDatabase.has(slug)) {
        const linkData = siteDatabase.get(slug);
        if (linkData.password) return res.send(generatePasswordPageHTML(slug, 'redirect'));
        linkData.clicks += 1;
        res.send(generateSEORedirectHTML(linkData));
    } else {
        res.status(404).send('<h2 style="color:#ef4444; text-align:center; margin-top:50px;">404 - Link Revoked!</h2>');
    }
});

// 5. Force Iframe Viewer Handler (/view/:slug) - Still works as a bypass
app.get('/view/:slug', (req, res) => {
    const slug = req.params.slug;
    if (siteDatabase.has(slug)) {
        const linkData = siteDatabase.get(slug);
        if (linkData.password) return res.send(generatePasswordPageHTML(slug, 'view'));
        linkData.clicks += 1;
        res.send(generateIframeHTML(linkData.targetUrl, slug, linkData.seoTitle));
    } else {
        res.status(404).send('<h2 style="color:#ef4444; text-align:center; margin-top:50px;">404 - Link Revoked!</h2>');
    }
});

// --- HELPER HTML GENERATORS (HEAVY) ---

// 🆕 NEW: User Choice Landing Page HTML 🆕
function generateChoicePageHTML(linkData, slug) {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${linkData.seoTitle} - Portal</title>
            <meta property="og:title" content="${linkData.seoTitle}" />
            <meta property="og:description" content="${linkData.seoDesc}" />
            <style>
                body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .box { background: #1e293b; padding: 40px; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.8); text-align: center; max-width: 450px; width: 90%; border: 1px solid #334155; }
                h2 { color: #38bdf8; margin-bottom: 10px; font-size: 24px; }
                p { color: #94a3b8; margin-bottom: 30px; font-size: 15px; line-height: 1.5; }
                .url-preview { background: #0f172a; padding: 12px; border-radius: 8px; font-family: monospace; color: #cbd5e1; margin-bottom: 30px; word-break: break-all; border: 1px solid #475569; }
                .btn { display: block; width: 100%; padding: 16px; margin-bottom: 15px; border-radius: 10px; text-decoration: none; font-size: 16px; font-weight: bold; transition: 0.3s; color: white; text-align: center; box-sizing: border-box;}
                .btn-redirect { background: #059669; border: 1px solid #047857; }
                .btn-redirect:hover { background: #047857; transform: translateY(-2px); box-shadow: 0 5px 15px rgba(5, 150, 105, 0.4); }
                .btn-iframe { background: #0ea5e9; border: 1px solid #0284c7; }
                .btn-iframe:hover { background: #0284c7; transform: translateY(-2px); box-shadow: 0 5px 15px rgba(14, 165, 233, 0.4); }
                .footer-text { margin-top: 20px; font-size: 12px; color: #64748b; }
            </style>
        </head>
        <body>
            <div class="box">
                <h2>⚡ Choose Viewing Mode</h2>
                <p>How would you like to open this secure link?</p>
                <div class="url-preview">Path: /${slug}</div>
                
                <a href="/r/${slug}" class="btn btn-redirect">🌐 Open Directly (Redirect)</a>
                <a href="/view/${slug}" class="btn btn-iframe">🖥️ View in Iframe Viewer</a>
                
                <div class="footer-text">Protected by S-Projects Network</div>
            </div>
        </body>
        </html>
    `;
}

// Password Screen
function generatePasswordPageHTML(slug, targetType, isError = false) {
    const errorMsg = isError ? `<div style="color: #ef4444; margin-bottom: 15px; font-weight: bold; background: #fee2e2; padding: 10px; border-radius: 6px;">❌ Incorrect Password. Try again.</div>` : '';
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Secured Link: ${slug}</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #0f172a; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .box { background: #1e293b; padding: 40px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.8); text-align: center; max-width: 400px; width: 90%; border: 1px solid #334155; }
                h2 { color: #f8fafc; margin-bottom: 5px; }
                p { color: #94a3b8; margin-bottom: 25px; font-size: 14px; }
                input[type="password"] { width: 100%; padding: 12px; margin-bottom: 20px; border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: white; font-size: 16px; box-sizing: border-box; }
                input[type="password"]:focus { outline: none; border-color: #38bdf8; box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2); }
                button { width: 100%; padding: 12px; background: #0ea5e9; color: white; border: none; border-radius: 6px; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.3s; }
                button:hover { background: #0284c7; }
                .lock-icon { font-size: 40px; margin-bottom: 10px; }
            </style>
        </head>
        <body>
            <div class="box">
                <div class="lock-icon">🔒</div>
                <h2>Secured Link</h2>
                <p>Path: /${slug}</p>
                ${errorMsg}
                <form action="/auth/${slug}" method="POST">
                    <input type="hidden" name="targetType" value="${targetType}">
                    <input type="password" name="password" placeholder="Enter Password" required autofocus>
                    <button type="submit">Unlock & Proceed</button>
                </form>
            </div>
        </body>
        </html>
    `;
}

// SEO Smart Redirect Screen (Shows Link Previews in WhatsApp, then redirects instantly)
function generateSEORedirectHTML(linkData) {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <!-- OPEN GRAPH / SEO TAGS -->
            <title>${linkData.seoTitle}</title>
            <meta property="og:title" content="${linkData.seoTitle}" />
            <meta property="og:description" content="${linkData.seoDesc}" />
            <meta name="description" content="${linkData.seoDesc}" />
            <meta property="og:type" content="website" />
            
            <style>
                body { background: #0f172a; color: #94a3b8; font-family: sans-serif; text-align: center; padding-top: 20%; }
                .loader { border: 4px solid #1e293b; border-top: 4px solid #38bdf8; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 20px; }
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            </style>
        </head>
        <body>
            <div class="loader"></div>
            <h3>Redirecting...</h3>
            <script>
                // Instant JS redirect for users, while crawlers stay and read SEO tags
                setTimeout(() => { window.location.href = "${linkData.targetUrl}"; }, 500);
            </script>
        </body>
        </html>
    `;
}

// Iframe HTML (Heavy)
function generateIframeHTML(targetUrl, titleText, seoTitle) {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${seoTitle} - Viewer</title>
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body, html { width: 100%; height: 100%; overflow: hidden; font-family: 'Segoe UI', sans-serif; background: #0f172a; }
                #top-bar {
                    height: 55px; background: #1e293b; color: #ffffff; display: flex; 
                    justify-content: space-between; align-items: center; padding: 0 20px;
                    border-bottom: 2px solid #334155; box-shadow: 0 2px 10px rgba(0,0,0,0.4);
                }
                .brand-section { display: flex; align-items: center; gap: 15px; }
                .brand-title { font-size: 16px; font-weight: bold; color: #38bdf8; letter-spacing: 0.5px; }
                .path-badge { background: #334155; padding: 4px 12px; border-radius: 6px; font-size: 13px; color: #cbd5e1; border: 1px solid #475569; }
                .actions { display: flex; gap: 12px; }
                .btn { background: #0ea5e9; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: bold; transition: all 0.2s ease; }
                .btn:hover { background: #0284c7; transform: translateY(-1px); }
                .btn-outline { background: transparent; border: 1px solid #64748b; color: #cbd5e1; }
                .btn-outline:hover { background: #334155; color: white; border-color: #94a3b8; }
                #frame-container { width: 100%; height: calc(100% - 55px); background: #0f172a; }
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
    console.log(`🚀 Advanced Server with Choice Screen & Link Modes running on port ${PORT}`);
});
