// api/generate-post.js  —  Gemini で 140 字以内の投稿文を生成
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, price, catchcopy, url } = req.body;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return res.status(500).json({ success: false, error: 'GEMINI_API_KEYが未設定' });

  // Twitter は URL を 23 文字換算 → 本文は 140-23-1(改行) = 116 文字以内
  const prompt = `楽天商品のX投稿文を作成してください。

商品名: ${name}
価格: ¥${Number(price).toLocaleString()}
キャッチコピー: ${catchcopy || '（なし）'}

ルール:
- URLより前の本文は116文字以内（Twitter はURL=23文字換算のため合計140字）
- 商品名（短縮可）・価格・おすすめポイントを含める
- 末尾に改行してURLを1行で入れる: ${url}
- 絵文字を適度に使う
- ハッシュタグは1〜2個

文章のみ回答。JSON・コードブロック不要。`;

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 300 },
        }),
      }
    );
    const data = await r.json();
    const postText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    if (!postText) throw new Error('Gemini応答が空です');
    return res.status(200).json({ success: true, postText });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
