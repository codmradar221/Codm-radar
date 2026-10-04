// CODM Radar — surveille les codes CODM 24h/24, notifie, archive. Node 18+ requis, aucune dépendance.
import http from 'node:http';
import fs from 'node:fs';

const CFG = {
  port: process.env.PORT || 3000,
  intervalSec: 120,
  maxAgeH: 24,
  requireGlobalWord: false,
  ntfyTopic: process.env.NTFY_TOPIC || '',
  tgToken: process.env.TG_TOKEN || '', tgChat: process.env.TG_CHAT || '',
  sources: [
    { name: 'Reddit r/CallOfDutyMobile', url: 'https://www.reddit.com/r/CallOfDutyMobile/search.rss?q=redeem+code&restrict_sr=1&sort=new' },
    { name: 'Reddit (old)', url: 'https://old.reddit.com/r/CallOfDutyMobile/search.rss?q=redeem+code&restrict_sr=1&sort=new' },

  ],
};

const DB = './codes.json';
let db = fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, 'utf8')) : [];
const status = { lastScan: null, errors: {} };
const CODE = /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{12,18}\b/g;
const KEYWORDS = /code|redeem|reward|promo|gift/i;
const OTHER_VERSIONS = /garena|tencent|china|chinese|使命召唤|vietnam|việt|korea|taiwan|indonesia|\bsea\b|\bcn\b|\bkr\b|\bvn\b|\btw\b/i;

const clean = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/<[^>]+>/g, ' ');
const tag = (s, t) => (s.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || '';

function parseFeed(xml) {
  return [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/g)].map(m => {
    const b = m[0], d = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated');
    return {
      text: clean(tag(b, 'title') + ' ' + (tag(b, 'content') || tag(b, 'description'))),
      link: (b.match(/<link[^>]*href="([^"]+)"/) || [])[1] || clean(tag(b, 'link')).trim(),
      date: d ? new Date(d.trim()) : null,
    };
  });
}

async function notify(e) {
  const when = e.publishedAt ? 'Publié : ' + new Date(e.publishedAt).toLocaleString('fr-FR') : 'Détecté : ' + new Date(e.detectedAt).toLocaleString('fr-FR');
  const msg = `${e.code}\n${e.source}\n${when}\nValable ~24h`;
  const jobs = [];
  if (CFG.ntfyTopic) jobs.push(fetch('https://ntfy.sh/' + CFG.ntfyTopic, { method: 'POST', body: msg,
    headers: { Title: 'Nouveau code CODM', Priority: 'high', Tags: 'video_game', ...(e.url ? { Click: e.url } : {}) } }));
  if (CFG.tgToken && CFG.tgChat) jobs.push(fetch(`https://api.telegram.org/bot${CFG.tgToken}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CFG.tgChat, text: 'Nouveau code CODM\n' + msg }) }));
  await Promise.allSettled(jobs);
}

async function scan() {
  for (const s of CFG.sources) {
    try {
      const r = await fetch(s.url, { headers: { 'User-Agent': 'Mozilla/5.0 (CODM-Radar)' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const body = await r.text();
      const items = s.type === 'html' ? [{ text: clean(body), link: s.url, date: null }] : parseFeed(body);
      for (const it of items) {
        const pub = it.date && !isNaN(it.date) ? it.date : null;
        if (pub && Date.now() - pub >= CFG.maxAgeH * 36e5) continue;
        if (!KEYWORDS.test(it.text)) continue;
        if (OTHER_VERSIONS.test(it.text)) continue;
        if (CFG.requireGlobalWord && !/global/i.test(it.text)) continue;
        for (const code of new Set(it.text.match(CODE) || [])) {
          if (db.some(x => x.code === code)) continue;
          const e = { code, source: s.name, url: it.link, publishedAt: pub && pub.toISOString(), detectedAt: new Date().toISOString() };
          db.unshift(e); fs.writeFileSync(DB, JSON.stringify(db, null, 2));
          console.log('NOUVEAU', code, s.name); notify(e);
        }
      }
      delete status.errors[s.name];
    } catch (err) { status.errors[s.name] = String(err.message || err); }
  }
  status.lastScan = new Date().toISOString();
}
scan(); setInterval(scan, CFG.intervalSec * 1000);

http.createServer((req, res) => {
  if (req.url.startsWith('/api/codes')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ codes: db, status, maxAgeH: CFG.maxAgeH, intervalSec: CFG.intervalSec }));
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(new URL('./index.html', import.meta.url)));
}).listen(CFG.port, () => console.log('CODM Radar en ligne sur le port ' + CFG.port));
