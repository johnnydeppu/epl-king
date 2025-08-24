// scripts/collect.mjs — Minimal RSS collector (Node 20 ESM)

import fs from 'node:fs/promises';
import path from 'node:path';
import Parser from 'rss-parser';

// --- paths ---
const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const repoRoot  = path.resolve(scriptDir, '..');
const publicDir = path.join(repoRoot, 'public');
const dataDir   = path.join(publicDir, 'data');
const configDir = path.join(publicDir, 'config');
const outPath   = path.join(dataDir, 'latest.json');

// --- args ---
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v = ''] = a.replace(/^--/, '').split('=');
    return [k, v];
  })
);
const teams       = (args.teams || '').split(',').filter(Boolean);
const maxAgeHours = Number(args.maxAgeHours || 72);

// --- config ---
const teamSources = JSON.parse(await fs.readFile(path.join(configDir, 'team_sources.json'), 'utf-8')
  .catch(() => '{}'));
const fixtures = JSON.parse(await fs.readFile(path.join(configDir, 'fixtures.json'), 'utf-8')
  .catch(() => '[]'));

const match = fixtures[0] || {
  id: 'EPL-UNKNOWN',
  kickoff_jst: '',
  home: teams[0] || 'HOME',
  away: teams[1] || 'AWAY'
};

// --- helpers ---
const parser = new Parser();
const now = Date.now();
const isFresh = (d) => now - new Date(d || now).getTime() <= maxAgeHours * 3600 * 1000;
const domain = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

// --- collect ---
const rows = [];
for (const t of teams) {
  const sources = teamSources[t] || [];
  for (const url of sources) {
    try {
      const feed = await parser.parseURL(url);
      for (const it of feed.items || []) {
        const ts = new Date(it.isoDate || it.pubDate || Date.now()).getTime();
        if (!isFresh(ts)) continue;
        const link = it.link || it.guid || url;
        const host = domain(link);
        rows.push({
          id: link,
          ts,
          url: link,
          domain: host,
          trust:
            ['bbc.com', 'bbc.co.uk'].includes(host) ? 'bbc' :
            host.includes('skysports.com') ? 'sky' :
            host.includes('arsenal.com') || host.includes('mancity.com') ? 'official' : 'other',
          tags: [],
          players: [],
          ja: it.title || '',
          en: it.title || ''
        });
      }
    } catch {
      // RSSじゃないURLはスキップ（後で拡張）
      console.log('skip (not RSS):', url);
    }
  }
}

// --- write ---
await fs.mkdir(dataDir, { recursive: true });
const out = {
  generated_at: Date.now(),   // ← これでOK（+ は付けない）
  match: {
    id: match.id,
    kickoff_jst: match.kickoff_jst || '',
    home: { id: match.home, name: match.home },
    away: { id: match.away, name: match.away },
    hashtag: `#${(match.home || '').toUpperCase()}${(match.away || '').toUpperCase()}`
  },
  items: rows.sort((a, b) => b.ts - a.ts)
};

await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf-8');
console.log('Wrote', outPath, 'items:', out.items.length);
