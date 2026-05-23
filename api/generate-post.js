// api/generate-post.js
// 投稿フォーマット:
//   1行目: 煽り系キャッチコピー + 絵文字（40字以内）
//   2行目: 価格 + 具体的メリット（65字以内）
//   3行目: 短縮URL（サーバー側で結合）
// Twitter 換算 140 字以内をサーバー側で保証

// Twitter 換算文字数（URL = 23 字換算）
function twitterCount(text) {
  const urls = text.match(/https?:\/\/\S+/g) || [];
  const urlActual = urls.reduce((s, u) => s + [...u].length, 0);
  return [...text].length - urlActual + urls.length * 23;
}

// 140 字超えなら2行目から削る → それでも超えなら1行目も削る
function trimTo140(body, url) {
  let postText = `${body}\n${url}`;
  for (const targetLine of [1, 0]) {
    while (twitterCount(postText) > 140) {
      const ls = body.split('\n');
      if (!ls[targetLine] || [...ls[targetLine]].length === 0) break;
      ls[targetLine] = [...ls[targetLine]].slice(0, -1).join('');
      body = ls.join('\n');
      postText = `${body}\n${url}`;
    }
  }
  return postText;
}

// Gemini が使えない場合のフォールバック投稿文生成
function fallbackPost(name, price, catchcopy) {
  const hooks = [
    'これ知らないと損すぎる😱',
    'え、まだ買ってないの？🔥',
    '買わなきゃ後悔する神アイテム✨',
    'スクロール止めて見て🙌',
    'コスパおかしすぎる件🫢',
  ];
  const line1 = hooks[Math.floor(Math.random() * hooks.length)];
  const priceStr = `¥${Number(price).toLocaleString()}`;
  const desc = catchcopy ? catchcopy.slice(0, 40) : name.slice(0, 30);
  const line2 = `${priceStr}／${desc}`;
  return `${line1}\n${line2}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, price, catchcopy, url } = req.body;
  console.log('[generate-post] req.body:', JSON.stringify({ name, price, catchcopy, url }));
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return res.status(500).json({ success: false, error: 'GEMINI_API_KEYが未設定' });

  const prompt = `楽天商品のXポスト文を【必ず2行だけ】生成してください。URLは含めない。

商品名: ${name}
価格: ¥${Number(price).toLocaleString()}
キャッチコピー: ${catchcopy || '（なし）'}

【出力フォーマット（厳守）】
1行目: スクロールが止まる煽り系の一言＋絵文字1〜2個（合計40文字以内）
  例: 「これ知らないと損すぎる😱」「え、まだ使ってないの？🔥」「買わなきゃ後悔する神アイテム✨」のようなトーンで
2行目: ¥価格＋この商品の具体的なメリットや特徴を1〜2個（合計65文字以内）
  例: 「¥2,980／毎日使えるのに洗えてケア簡単、レビュー4.7★で累計1万件超え」

【禁止事項】
- 3行以上にしない
- URLを含めない
- ハッシュタグを含めない
- 「1行目:」「2行目:」などのラベルを付けない
- 「〜です」「〜ます」などの丁寧語は使わない（体言止め・口語OK）

2行のみ出力してください。`;

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 150 },
        }),
      }
    );
    const data = await r.json();
    if (data.error) throw new Error(`Gemini APIエラー(${data.error.code})`);
    let raw = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    if (!raw) throw new Error('Gemini応答が空');

    // URLが混入していたら除去
    raw = raw.replace(/https?:\/\/\S+/g, '').trim();

    // 2行に正規化
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    let body = lines[1] ? `${lines[0]}\n${lines[1]}` : lines[0];

    const postText = trimTo140(body, url);
    return res.status(200).json({ success: true, postText, charCount: twitterCount(postText) });

  } catch (err) {
    // Gemini失敗時はフォールバックテキストで応答（ツールを止めない）
    console.log('[generate-post] Gemini failed, using fallback:', err.message);
    const body = fallbackPost(name, price, catchcopy);
    const postText = trimTo140(body, url);
    return res.status(200).json({ success: true, postText, charCount: twitterCount(postText), fallback: true });
  }
};
