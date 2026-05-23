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

  const prompt = `楽天商品のXポスト文を【必ず2行だけ】生成してください。
URL・ハッシュタグは禁止。

商品名: ${name}
価格: ¥${Number(price).toLocaleString()}
キャッチコピー: ${catchcopy || '（なし）'}

【目的】
Xで「広告っぽさ」を減らし、"共感・あるある"でスクロールを止める。商品を売り込むのではなく、「それ困ってた」を優先。

【出力フォーマット（厳守）】

1行目:
生活の困りごと・あるある・感情を短く書く。「買わなきゃ損」「神アイテム」「後悔」などの煽りは禁止。人間っぽいリアルな言い回し。40文字以内。

良い例:「雨の日の玄関、地獄☔️」「息子の靴、毎日終わってる👟」「部屋干し臭、ほんと無理😇」

2行目:
¥価格＋"どう助かったか"を自然に書く。広告感を減らし、「ちょっと気になる」を優先。65文字以内。

良い例:「¥3,980／普通のスニーカー見えなのに防水」「¥2,680／強風でもひっくり返らない傘」

【禁止事項】
3行以上・URL・ハッシュタグ・ラベル・丁寧語・「神」「最強」「買わなきゃ損」「バズ」・過剰な煽り・AIっぽい不自然な絶賛

【重要】"広告"ではなく「実際に困ってる人の独り言」みたいな自然さを優先する。`;

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
