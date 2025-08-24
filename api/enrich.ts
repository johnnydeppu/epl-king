// /api/enrich.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from '@google/generative-ai';

const MODEL = 'gemini-1.5-flash'; // 速さ優先。質重視は 'gemini-1.5-pro'

const system = `
あなたはサッカー記事の要点抽出ボットです。必ず与えられた本文の範囲だけから結論を出し、
事実以外は「不明」とします。出力は必ずJSON。日本語は簡潔でテレビ視聴者向け。
タグは ["負傷","復帰","好調"] から本文に該当するものだけ。
players は与えられた候補と本文から正規化して列挙。根拠は本文の原文抜粋を短く。
`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { text, home, away, players } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text is required' });

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: MODEL, generationConfig: {
      responseMimeType: 'application/json',
    }});

    const prompt = `
コンテキスト:
- 対象試合: ${home} vs ${away}
- 選手候補: ${players?.join(', ') || 'なし'}

本文:
"""${text}"""

要件:
- JSON形式: {"ja":string,"tags":string[],"players":string[],"evidence":string,"relevance":number}
- ja: 80〜140字/体言止め中心
- tags: ["負傷","復帰","好調"] のサブセット
- players: 本文と候補から実名を正規化（最大3名）
- evidence: 根拠となる英文/和文を短く1つ抜粋
- relevance: 0〜1（HOME/AWAYにどれだけ関連するか）
`;

    const result = await model.generateContent([{ role: 'user', parts: [{ text: system + prompt }] }]);
    const json = JSON.parse(result.response.text());

    // サニタイズ/安全弁
    json.tags = (json.tags || []).filter((t: string) => ['負傷','復帰','好調'].includes(t));
    json.relevance = Math.max(0, Math.min(1, Number(json.relevance ?? 0)));

    res.status(200).json(json);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'enrich failed' });
  }
}
