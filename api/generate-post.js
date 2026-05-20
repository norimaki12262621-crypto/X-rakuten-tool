// api/generate-post.js  —  Gemini で投稿本文を生成し、サーバー側で 140 字以内に保証する
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, price, catchcopy, url } = req.body;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return res.status(500).json({ success: false, error: 'GEMINI_API_KEYが未設定' });

  // Gemini には本文のみ生成させる（URL は含めない）
  // URL は後でサーバー側で結合し、140 字を保証する
  const prompt = `楽天商品のX投稿本文を作成してください（URLは含めない）。

商品名: ${name}
価格: ¥${Number(price).toLocaleString()}
キャッチコピー: ${catchcopy || '（なし）'}

条件:
- 100文字以内で収める
- 商品名（大幅に短縮可）・価格・おすすめポイントを含める
- 絵文字を適度に使う
- ハッシュタグ1〜2個を末尾に入れる
- URLは絶対に含めない

本文のみ回答。余計な説明不要。`;

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 200 },
        }),
      }
    );
    const data = await r.json();
    let body = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    if (!body) throw new Error('Gemini応答が空です');

    // Gemini が URL を含んでしまった場合は除去
    body = body.replace(/https?:\/\/\S+/g, '').replace(/\n{3,}/g, '\n\n').trim();

    // URL を末尾に結合
    let postText = `${body}\n${url}`;

    // Twitter 換算文字数カウント（URL = 23 字）
    const twitterCount = (text) => {
      const urls = text.match(/https?:\/\/\S+/g) || [];
      const urlActual = urls.reduce((s, u) => s + [...u].length, 0);
      return [...text].length - urlActual + urls.length * 23;
    };

    // 140 字超えなら本文を 1 字ずつ削って調整
    while (twitterCount(postText) > 140 && [...body].length > 0) {
      body = [...body].slice(0, -1).join('');
      postText = `${body.trimEnd()}\n${url}`;
    }

    return res.status(200).json({ success: true, postText, charCount: twitterCount(postText) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
