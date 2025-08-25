// scripts/collect.mjs — RSS collector (BBC fallback, verbose logs)
import fs from 'node:fs/promises';
import path from 'node:path';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const repoRoot  = path.resolve(scriptDir, '..');
const publicDir = path.join(repoRoot, 'public');
const dataDir   = path.join(publicDir, 'data');
const configDir = path.join(publicDir, 'config');
const outPath   = path.join(dataDir, 'latest.json');

// ---- args (both "--k=v" and "--k v" supported) ----
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const eq = a.indexOf('=');
  if (eq !== -1) { args[a.slice(2, eq)] = a.slice(eq + 1); }
  else { const k = a.slice(2); const v = argv[i+1] && !argv[i+1].startsWith('--') ? argv[++i] : 'true'; args[k] = v; }
}
let teams = (args.teams || '').split(',').map(s=>s.trim()).filter(Boolean);
const maxAgeHours = Number(args.maxAgeHours || 72);

// ---- safe JSON read ----
async function safeReadJSON(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, 'utf-8')); } catch { return fallback; }
}
const teamSources = await safeReadJSON(path.join(configDir, 'team_sources.json'), {});
const fixtures    = await safeReadJSON(path.join(configDir, 'fixtures.json'), []);

// ---- BBC fallback & helpers ----
const BBC_FEEDS = {
  ARS:'https://feeds.bbci.co.uk/sport/football/teams/arsenal/rss.xml',
  MCI:'https://feeds.bbci.co.uk/sport/football/teams/manchester-city/rss.xml',
  LIV:'https://feeds.bbci.co.uk/sport/football/teams/liverpool/rss.xml',
  MUN:'https://feeds.bbci.co.uk/sport/football/teams/manchester-united/rss.xml',
  CHE:'https://feeds.bbci.co.uk/sport/football/teams/chelsea/rss.xml',
  TOT:'https://feeds.bbci.co.uk/sport/football/teams/tottenham-hotspur/rss.xml'
};
if (teams.length === 0) teams = Object.keys(teamSources).length ? Object.keys(teamSources) : Object.keys(BBC_FEEDS);
console.log('teams:', teams);

const isLikelyRSS = (u) => {
  try {
    const host = new URL(u).hostname;
    return host.includes('feeds.') || u.endsWith('.xml') || u.includes('/rss');
  } catch { return false; }
};

// 汎用HTMLスクレイパ（Sky/公式で通る簡易版）
async function parseHTMLList(url, limit = 15) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (EPL-King Collector)' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  // ゆるい抽出: 記事カード/リスト内の <a> と <time> を拾う
  const seen = new Set();
  const items = [];
  $('article a[href], .news, .article, .teaser, li a[href]').each((_, el) => {
    if (items.length >= limit) return false;
    const a = $(el);
    const href = a.attr('href') || '';
    const title = a.text().trim();
    if (!href || !title) return;
    let link = href.startsWith('http') ? href : new URL(href, url).toString();
    if (seen.has(link)) return;
    seen.add(link);
    // 時刻: 近くの <time> / data-iso / datetime を拾う（無ければ現在時刻）
    const tEl = a.closest('article').find('time').first();
    const iso = tEl.attr('datetime') || tEl.attr('data-iso') || '';
    const ts = iso ? new Date(iso).getTime() : Date.now();
    items.push({ title, link, ts });
  });

  return items;
}

function toRssIfKnown(u) {
  try {
    const url = new URL(u);
    const host = url.hostname.replace(/^www\./,'');
    if ((host === 'bbc.com' || host === 'bbc.co.uk') && url.pathname.startsWith('/sport/football/teams/')) {
      const slug = url.pathname.split('/')[4];
      if (slug) return `https://feeds.bbci.co.uk/sport/football/teams/${slug}/rss.xml`;
    }
    return u;
  } catch { return u; }
}

const parser = new Parser({
  requestOptions: { headers: { 'User-Agent': 'Mozilla/5.0 (EPL-King Collector)' }, redirect: 'follow' }
});
const now = Date.now();
const isFresh = (ts) => now - (typeof ts === 'number' ? ts : new Date(ts).getTime()) <= maxAgeHours*3600*1000;
const domain = (u) => { try { return new URL(u).hostname.replace(/^www\./,''); } catch { return ''; } };

const match = fixtures[0] || { id: 'EPL-UNKNOWN', kickoff_jst: '', home: teams[0] || 'HOME', away: teams[1] || 'AWAY' };

// ---- collect ----
const rows = [];
for (const t of teams) {
  const configured = Array.isArray(teamSources[t]) ? teamSources[t] : [];
  const sources = configured.length ? configured : (BBC_FEEDS[t] ? [BBC_FEEDS[t]] : []);
  console.log('team', t, 'sources:', sources);

  for (const url0 of sources) {
const url = toRssIfKnown(url0);
try {
  if (isLikelyRSS(url)) {
    const feed = await parser.parseURL(url);
    console.log('  feed ok:', url, 'items:', (feed.items || []).length);
    for (const it of feed.items || []) {
      const ts = new Date(it.isoDate || it.pubDate || Date.now()).getTime();
      if (!isFresh(ts)) continue;
      const link = normalizeUrl(it.link || it.guid || url);
      const host = domain(link);
      rows.push({ id: link, ts, url: link, domain: host,
        trust: ['bbc.com','bbc.co.uk'].includes(host) ? 'bbc'
             : host.includes('skysports.com') ? 'sky'
             : (host.includes('arsenal.com')||host.includes('mancity.com')||host.includes('liverpoolfc.com')||host.includes('tottenhamhotspur.com')||host.includes('chelseafc.com')||host.includes('manutd.com')) ? 'official' : 'other',
        tags: [], players: [], ja: it.title || '', en: it.title || '' });
    }
  } else {
    const list = await parseHTMLList(url);
    console.log('  html ok:', url, 'items:', list.length);
    for (const it of list) {
      if (!isFresh(it.ts)) continue;
      const link = normalizeUrl(it.link);
      const host = domain(link);
      rows.push({ id: link, ts: it.ts, url: link, domain: host,
        trust: host.includes('skysports.com') ? 'sky'
             : /arsenal\.com|mancity\.com|liverpoolfc\.com|tottenhamhotspur\.com|chelseafc\.com|manutd\.com/.test(host) ? 'official' : 'other',
        tags: [], players: [], ja: it.title, en: it.title });
    }
  }
} catch (e) {
  console.log('  source error:', url, e.message);
}
}

// ---- dedupe & write ----
const seen = new Set(); const items = [];
for (const it of rows.sort((a,b)=>b.ts-a.ts)) { if (!seen.has(it.id)) { seen.add(it.id); items.push(it); } }

await fs.mkdir(dataDir, { recursive: true });
await fs.writeFile(path.join(dataDir,'latest.json'), JSON.stringify({
  generated_at: Date.now(),
  match: { id: match.id, kickoff_jst: match.kickoff_jst || '', home: { id: match.home, name: match.home }, away: { id: match.away, name: match.away },
           hashtag: `#${(match.home||'').toUpperCase()}${(match.away||'').toUpperCase()}` },
  items
}, null, 2), 'utf-8');
console.log('Wrote', outPath, 'items:', items.length);
