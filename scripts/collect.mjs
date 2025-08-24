js
if (feedUrl) {
const items = await readRss(feedUrl)
for (const it of items) {
const d = it.isoDate ? new Date(it.isoDate) : new Date()
if (!isFresh(d)) continue
out.push(it)
}
} else {
// simple scrape: just use link list as headlines
for (const link of links) {
out.push({ title: link.split('/').slice(-1)[0].replace(/[-_]/g,' '), link, isoDate: null, summary: '' })
}
}
}
await sleep(500) // polite delay
} catch (e) {
console.error('source error', teamId, src, e.message)
}
}
return out
}


// ---- main ----
async function main() {
if (!TEAMS.length) {
console.log('No --teams specified. Example: --teams ARS,MCI')
}
const homeName = Object.keys(playersDict)[0] || 'Arsenal'
const awayName = Object.keys(playersDict)[1] || 'Man City'


const items = []
for (const t of TEAMS) {
const part = await collectForTeam(t)
items.push(...part)
}


// normalize, dedupe by URL hash, sort by ts desc
const map = new Map()
for (const r of items) {
const n = normalizeItem(r, homeName, awayName)
map.set(n.id, n)
}
const list = Array.from(map.values()).sort((a,b) => b.ts - a.ts)


// ensure dirs
await fs.mkdir(DATA_DIR, { recursive: true })


const out = {
match: {
id: MATCH.id,
kickoff_jst: MATCH.kickoff_jst || '',
home: { id: MATCH.home, name: homeName },
away: { id: MATCH.away, name: awayName },
hashtag: `#${(MATCH.home||'').toUpperCase()}${(MATCH.away||'').toUpperCase()}`
},
items: list
}


await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2), 'utf-8')
console.log('Wrote', OUT_PATH, 'items:', list.length)
}


main().catch(e => { console.error(e); process.exit(1) })
```
