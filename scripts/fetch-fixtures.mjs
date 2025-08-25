/* scripts/fetch-fixtures.mjs — PL 2025/26 fixtures → public/config/fixtures.json
   Usage:
     node scripts/fetch-fixtures.mjs --season=2025
   Env:
     FOOTBALL_DATA_API_KEY  (football-data.org v4)
*/

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const repoRoot   = path.resolve(__dirname, '..');
const outPath    = path.join(repoRoot, 'public', 'config', 'fixtures.json');

const API = 'https://api.football-data.org/v4';
const TOKEN = process.env.FOOTBALL_DATA_API_KEY;

if (!TOKEN) {
  console.error('Missing FOOTBALL_DATA_API_KEY env.');
  process.exit(1);
}

// ---- parse args
const args = Object.fromEntries(
  process.argv.slice(2).map(s => {
    const m = s.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [s.replace(/^--/, ''), true];
  })
);

// ---- season year (auto)
function guessSeasonYearJST(now = new Date()) {
  // JST基準で、6月〜翌年5月が同一シーズン
  const jst = new Date(now.getTime() + 9*3600*1000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth() + 1; // 1-12
  return (m >= 6) ? y : (y - 1);
}
const season = Number(args.season || guessSeasonYearJST());

// ---- helper
const pad = n => String(n).padStart(2, '0');
function toJstIso(utcIso) {
  const d = new Date(utcIso);
  const t = new Date(d.getTime() + 9*3600*1000); // JSTは固定+9h（夏時間なし）
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth()+1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}+09:00`;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'X-Auth-Token': TOKEN }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt.slice(0,300)}`);
  }
  return res.json();
}

(async () => {
  console.log(`Fetching PL fixtures for season ${season}...`);
  // Competition "PL" の Matches サブリソース（シーズン指定）
  // 例: GET /v4/competitions/PL/matches?season=2025
  const url = `${API}/competitions/PL/matches?season=${season}`;
  const data = await fetchJson(url);

  const items = (data.matches || []).map(m => {
    const home = m.homeTeam || {};
    const away = m.awayTeam || {};
    const homeId = home.tla || home.shortName || home.name || '';
    const awayId = away.tla || away.shortName || away.name || '';
    const kickoffUtc = m.utcDate; // e.g. 2025-08-15T19:00:00Z
    return {
      id: String(m.id),
      matchday: m.matchday ?? null,
      status: m.status,           // SCHEDULED / FINISHED など
      kickoff_utc: kickoffUtc,
      kickoff_jst: toJstIso(kickoffUtc),
      home: { id: homeId, name: home.name || homeId },
      away: { id: awayId, name: away.name || awayId },
      venue: m.venue || null,
      lastUpdated: m.lastUpdated || null
    };
  });

  // ソート：日時→matchdayの順
  items.sort((a,b) => (a.kickoff_utc < b.kickoff_utc ? -1 : a.kickoff_utc > b.kickoff_utc ? 1 : (a.matchday ?? 0) - (b.matchday ?? 0)));

  const out = {
    season, competition: 'PL', timezone: 'Asia/Tokyo',
    generated_at: Date.now(),
    fixtures: items
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf-8');
  console.log('Wrote', outPath, 'fixtures:', items.length);
})().catch(err => {
  console.error(err);
  process.exit(1);
});