/* scripts/collect.mjs — v1.5
   - RSS収集（BBCチームRSS + BBCグローバルRSS）
   - URL正規化＆重複排除
   - キーワードで「負傷/復帰/好調」を自動タグ付け（/public/config/keywords.json）
   - スコア付け：score = 0.6*fresh + 0.3*trust + 0.1*relevance（0〜1）
   Node 20 / ESM 対応（package.json に "type":"module" 必須） */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Parser from 'rss-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const repoRoot   = path.resolve(__dirname, '..');
const publicDir  = path.join(repoRoot, 'public');
const dataDir    = path.join(publicDir, 'data');
const configDir  = path.join(publicDir, 'config');
const outPath    = path.join(dataDir, 'latest.json');

// ---- args (both "--k=v" and "--k v") ----
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const eq = a.indexOf('=');
  if (eq !== -1) args[a.slice(2, eq)] = a.slice(eq + 1);
  else {
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    args[k] = v;
  }
}
let teams = (args.teams || '').split(',').map(s => s.trim()).filter(Boolean);
const maxAgeHours = Number(args.maxAgeHours || 72);
const MAX_ITEMS = Number(args.maxItems || process.env.MAX_ITEMS || 200); // JSONを軽く保つ上限

// ---- safe JSON read ----
async function safeReadJSON(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, 'utf-8')); } catch { return fallback; }
}
const teamSources = await safeReadJSON(path.join(configDir, 'team_sources.json'), {});
const fixtures    = await safeReadJSON(path.join(configDir, 'fixtures.json'), []);
const kwConfig    = await safeReadJSON(path.join(configDir, 'keywords.json'), {
  injury:    ["injury","injured","injuries","out","knock","hamstring","groin","calf","ankle","knee","fracture","broken","rupture","layoff","ruled out","doubtful","setback","scan","medical","out for","out of action"],
  returning: ["return","returned","returns","back","fit","in contention","available","recovered","back in training","full training","ready to play","cleared to play","makes squad","included in squad","back from injury","returning from"],
  form:      ["in-form","on form","scored","scores","goal","brace","hat-trick","assist","assists","clean sheet","streak","run of","unbeaten","winless","hot streak","purple patch","impressive","outstanding","dominant","thrashing"]
});

// ---- BBC team feeds & global feeds ----
const BBC_FEEDS = {
  ARS:'https://feeds.bbci.co.uk/sport/football/teams/arsenal/rss.xml',
  MCI:'https://feeds.bbci.co.uk/sport/football/teams/manchester-city/rss.xml',
  LIV:'https://feeds.bbci.co.uk/sport/football/teams/liverpool/rss.xml',
  MUN:'https://feeds.bbci.co.uk/sport/football/teams/manchester-united/rss.xml',
  CHE:'https://feeds.bbci.co.uk/sport/football/teams/chelsea/rss.xml',
  TOT:'https://feeds.bbci.co.uk/sport/football/teams/tottenham-hotspur/rss.xml'
};
const GLOBAL_SOURCES = [
  'https://feeds.bbci.co.uk/sport/football/premier-league/rss.xml',
  'https://feeds.bbci.co.uk/sport/football/rss.xml'
];

if (teams.length === 0) {
  teams = Object.keys(teamSources).length ? Object.keys(teamSources) : Object.keys(BBC_FEEDS);
}
console.log('teams:', teams);

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
const isLikelyRSS = (u) => {
  try {
    const host = new URL(u).hostname;
    return host.includes('feeds.') || u.endsWith('.xml') || u.includes('/rss');
  } catch { return false; }
};

// URL 正規化（重複防止）
function normalizeUrl(link) {
  try {
    const u = new URL(link);
    u.hostname = u.hostname.replace(/^www\./,'').replace(/^m\./,'');
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid','ref']
      .forEach(k => u.searchParams.delete(k));
    u.hash = '';
    return u.toString();
  } catch { return link; }
}
const domain = (u) => { try { return new URL(u).hostname.replace(/^www\./,''); } catch { return ''; } };

// ---- scoring helpers ----
const TRUST_CLASS = (host) =>
  (['bbc.com','bbc.co.uk'].includes(host)) ? 'bbc' :
  host.includes('skysports.com') ? 'sky' :
  /arsenal\.com|mancity\.com|liverpoolfc\.com|tottenhamhotspur\.com|chelseafc\.com|manutd\.com/.test(host) ? 'official' :
  'other';

const TRUST_WEIGHT = { bbc: 1.0, official: 0.95, sky: 0.9, other: 0.6 };
const HALF_LIFE_HOURS = 72; // 鮮度の“半減期”

const parser = new Parser({
  requestOptions: {
    headers: { 'User-Agent': 'Mozilla/5.0 (EPL-King Collector)' },
    redirect: 'follow'
  }
});
const now = Date.now();
const isFresh = (ts) => now - (typeof ts === 'number' ? ts : new Date(ts).getTime()) <= maxAgeHours * 3600 * 1000;

// テキスト→タグ&関連度抽出
function escapeRegExp(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function detectTagsAndRelevance(text) {
  const t = (text || '').toLowerCase();
  const counts = {
    injury: (kwConfig.injury||[]).reduce((n, w)=> n + (new RegExp(`\\b${escapeRegExp(w.toLowerCase())}\\b`).test(t)?1:0), 0),
    returning: (kwConfig.returning||[]).reduce((n, w)=> n + (new RegExp(`\\b${escapeRegExp(w.toLowerCase())}\\b`).test(t)?1:0), 0),
    form: (kwConfig.form||[]).reduce((n, w)=> n + (new RegExp(`\\b${escapeRegExp(w.toLowerCase())}\\b`).test(t)?1:0), 0)
  };
  const tags = [];
  if (counts.injury    > 0) tags.push('負傷');
  if (counts.returning > 0) tags.push('復帰');
  if (counts.form      > 0) tags.push('好調');
  const total = counts.injury + counts.returning + counts.form;
  const relevance = Math.min(1, total / 3); // マッチ数を0〜1にクリップ
  return { tags, relevance, counts };
}

// ---- collect (per team) ----
const rows = [];
for (const t of teams) {
  const configured = Array.isArray(teamSources[t]) ? teamSources[t] : [];
  const sources = configured.length ? configured : (BBC_FEEDS[t] ? [BBC_FEEDS[t]] : []);
  console.log('team', t, 'sources:', sources);

  for (const url0 of sources) {
    const url = toRssIfKnown(url0);
    try {
      if (!isLikelyRSS(url)) { console.log('  skip (not RSS):', url); continue; }
      const feed = await parser.parseURL(url);
      console.log('  feed ok:', url, 'items:', (feed.items || []).length);
      for (const it of feed.items || []) {
        const ts = new Date(it.isoDate || it.pubDate || Date.now()).getTime();
        if (!isFresh(ts)) continue;
        const link = normalizeUrl(it.link || it.guid || url);
        const host = domain(link);
        const baseTitle = it.title || '';
        rows.push({
          id: link,
          ts,
          url: link,
          domain: host,
          trust: TRUST_CLASS(host),
          tags: [],
          players: [],
          ja: baseTitle, // 翻訳未使用：必要なら /api/translate で後段付与
          en: baseTitle,
          text_for_match: [it.title, it.contentSnippet, it.content].filter(Boolean).join(' ')
        });
      }
    } catch (e) {
      console.log('  feed error:', url, e.message);
    }
  }
}

// ---- also collect global feeds ----
for (const url of GLOBAL_SOURCES) {
  try {
    const feed = await parser.parseURL(url);
    console.log('global feed ok:', url, 'items:', (feed.items || []).length);
    for (const it of feed.items || []) {
      const ts = new Date(it.isoDate || it.pubDate || Date.now()).getTime();
      if (!isFresh(ts)) continue;
      const link = normalizeUrl(it.link || it.guid || url);
      const host = domain(link);
      const baseTitle = it.title || '';
      rows.push({
        id: link,
        ts,
        url: link,
        domain: host,
        trust: TRUST_CLASS(host),
        tags: [],
        players: [],
        ja: baseTitle,
        en: baseTitle,
        text_for_match: [it.title, it.contentSnippet, it.content].filter(Boolean).join(' ')
      });
    }
  } catch (e) {
    console.log('global feed error:', url, e.message);
  }
}

// ---- dedupe, tag, score, limit, write ----
const seen = new Set();
let items = [];
for (const it of rows.sort((a,b)=>b.ts - a.ts)) {
  if (seen.has(it.id)) continue;
  seen.add(it.id);
  // タグ＆関連度
  const { tags, relevance } = detectTagsAndRelevance(it.text_for_match);
  it.tags = tags;
  // スコア
  const ageHours = (now - it.ts) / 3600000;
  const fresh = Math.pow(0.5, ageHours / HALF_LIFE_HOURS); // 0〜1
  const trustW = TRUST_WEIGHT[it.trust] ?? 0.6;
  it.score_detail = { fresh, trust: trustW, relevance };
  it.score = +(0.6 * fresh + 0.3 * trustW + 0.1 * relevance).toFixed(3);
  items.push(it);
}
// スコア優先で並べ替え
items.sort((a,b)=> (b.score - a.score) || (b.ts - a.ts));
// 上限
if (Number.isFinite(MAX_ITEMS) && items.length > MAX_ITEMS) items = items.slice(0, MAX_ITEMS);

// JSON書き出し
await fs.mkdir(dataDir, { recursive: true });
const firstTeams = teams.slice(0,2);
const match = fixtures[0] || {
  id: 'EPL-UNKNOWN',
  kickoff_jst: '',
  home: firstTeams[0] || 'HOME',
  away: firstTeams[1] || 'AWAY'
};
const out = {
  generated_at: Date.now(),
  match: {
    id: match.id,
    kickoff_jst: match.kickoff_jst || '',
    home: { id: match.home, name: match.home },
    away: { id: match.away, name: match.away },
    hashtag: `#${(match.home || '').toUpperCase()}${(match.away || '').toUpperCase()}`
  },
  items
};
await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf-8');
console.log('Wrote', outPath, 'items:', items.length);