import React, { useEffect, useMemo, useState } from 'react'
import type { Insight, LatestJson, Tag } from './types'
import { scoreItem } from './lib/score'
import TrustBadge from './components/TrustBadge'
import ScoreDot from './components/ScoreDot'
import TagPill from './components/TagPill'

function shareToX(text: string) {
  const intent = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`
  if (navigator.share) navigator.share({ text }).catch(() => window.open(intent, '_blank'))
  else window.open(intent, '_blank')
}

export default function App() {
  const [data, setData] = useState<LatestJson | null>(null)
  const [jpOnly, setJpOnly] = useState(true)
  const [query, setQuery] = useState('')
  const [note, setNote] = useState('')
  const [tagFilter, setTagFilter] = useState<Record<Tag, boolean>>({ '負傷': true, '復帰': true, '好調': true })

  useEffect(() => {
    fetch('/data/latest.json', { cache: 'no-store' })
      .then(r => r.json())
      .then((j: LatestJson) => setData(j))
      .catch(() => setData(null))
  }, [])

  const sorted: Insight[] = useMemo(() => {
    const items = data?.items ?? []
    const filtered = items
      .map(it => ({ ...it, _score: scoreItem(it) }))
      .filter(it => (tagFilter as any)[it.tags[0] as Tag])
      .filter(it => {
        if (!query) return true
        const blob = `${it.ja} ${it.en ?? ''} ${it.players?.join(' ')}`.toLowerCase()
        return blob.includes(query.toLowerCase())
      })
      .sort((a, b) => (b._score ?? 0) - (a._score ?? 0))
    return filtered
  }, [data, tagFilter, query])

  const hashtag = data?.match?.hashtag ? `${data.match.hashtag} #PL #EPLKing` : '#PL #EPLKing'

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur bg-white/90 border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <h1 className="text-lg font-semibold">プレミア王（EPL King）</h1>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={jpOnly} onChange={e => setJpOnly(e.target.checked)} /> 日本語だけ
            </label>
            {data?.match?.hashtag && (
              <span className="badge">{data.match.hashtag.replace('#','')}</span>
            )}
          </div>
        </div>
      </header>

      {/* Match Bar */}
      <div className="border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="text-sm opacity-80">
            {data ? (
              <>
                {data.match.home.name} vs {data.match.away.name}・KO {data.match.kickoff_jst} JST
              </>
            ) : 'loading…'}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {(['負傷','復帰','好調'] as Tag[]).map(t => (
              <button key={t} className={`px-3 py-1 rounded-lg border text-sm ${tagFilter[t] ? 'bg-gray-900 text-white' : 'bg-white'}`} onClick={() => setTagFilter(f => ({ ...f, [t]: !f[t] }))}>{t}</button>
            ))}
            <input className="px-3 py-1.5 w-48 rounded-lg border" placeholder="検索（選手/キーワード）" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 grid lg:grid-cols-3 gap-4 py-4">
        {/* Timeline */}
        <section className="lg:col-span-2">
          <div className="mb-2 text-sm font-medium opacity-80">タイムライン</div>
          <div className="space-y-3">
            {sorted.map(it => (
              <div key={it.id} className="timeline-item flex gap-3 items-start">
                <ScoreDot score={it._score ?? 0} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs opacity-70 mb-1">
                    <TrustBadge trust={it.trust} />
                    <span>{new Date(it.ts).toLocaleString()}</span>
                    <a className="underline truncate" href={it.url} target="_blank" rel="noreferrer">{it.domain}</a>
                  </div>
                  <div className="space-x-2 mb-1">
                    {it.tags.map(t => <TagPill key={t} t={t as any} />)}
                  </div>
                  <p className="text-sm leading-relaxed">
                    {jpOnly ? it.ja : (
                      <>
                        <span className="block">{it.ja}</span>
                        {it.en && <span className="block opacity-80 text-[13px] mt-1">EN: {it.en}</span>}
                      </>
                    )}
                  </p>
                  <div className="mt-2 flex items-center gap-2 text-xs opacity-80 flex-wrap">
                    {it.players?.map(p => <span key={p} className="badge">{p}</span>)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <button className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50" onClick={() => {
                    const txt = `${it.ja}\n${hashtag}\n${it.url}`
                    shareToX(txt)
                  }}>Xにポスト</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Player Summary */}
        <aside className="lg:col-span-1">
          <div className="mb-2 text-sm font-medium opacity-80">プレイヤー要約</div>
          <div className="space-y-4">
            {(['負傷','復帰','好調'] as Tag[]).map(cluster => {
              const group = sorted.filter(it => it.tags.includes(cluster))
              const players = Array.from(new Set(group.flatMap(g => g.players || [])))
              if (!players.length) return null
              return (
                <div key={cluster}>
                  <div className="text-xs font-medium mb-2 opacity-80">{cluster}</div>
                  <div className="flex flex-wrap gap-2">
                    {players.map(p => (
                      <div key={p} className="px-2 py-1 rounded-xl border text-xs flex items-center gap-2 bg-white">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-900" /> {p}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </aside>
      </main>

      {/* Sticky composer */}
      <div className="sticky bottom-0 z-40 border-t bg-white/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="text-sm opacity-80">クイックメモ → Xに即ポスト</div>
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="気づき・メモ（140–200字目安）" className="flex-1 px-3 py-2 rounded-lg border min-h-[72px]"></textarea>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 rounded-lg border" onClick={() => setNote('')}>クリア</button>
            <button className="px-3 py-1.5 rounded-lg border bg-gray-900 text-white disabled:opacity-50" onClick={() => shareToX(`${note}\n${hashtag}`)} disabled={!note.trim()}>Xへ</button>
          </div>
        </div>
      </div>

      <footer className="py-8 text-center text-xs opacity-60">v0.1 — JSON接続・採点調整は次ステップで。</footer>
    </div>
  )
}
