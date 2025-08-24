// /api/translate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from '@google/generative-ai';
const MODEL = 'gemini-1.5-flash';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).send('q required');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: MODEL });
    const prompt = `次の英文を自然な日本語に短く要約気味で訳してください（120字以内）:\n${q}`;
    const out = await model.generateContent(prompt);
    res.status(200).send(out.response.text().trim());
  } catch (e: any) {
    res.status(500).send(e?.message || 'translate failed');
  }
}
