import type { Insight } from '../types'

const TRUST_WEIGHT: Record<string, number> = {
  bbc: 1.0,
  sky: 0.95,
  official: 0.9,
  other: 0.6,
}

const ONE_HOUR = 3600 * 1000

// src/lib/score.ts（抜粋）
export function scoreItem(it: Insight, now = Date.now()): number {
  const rec = Math.max(0, 1 - (now - it.ts) / (72 * ONE_HOUR)); // 新しさ
  const tw  = TRUST_WEIGHT[it.trust] ?? 0.5;                     // 信頼
  const rel = Math.min(it.players?.length ?? 0, 3) / 3;          // 関連（簡易）
  const s   = 0.5 * rec + 0.3 * tw + 0.2 * rel;                  // ←ここを調整
  return Number(s.toFixed(3));
}
