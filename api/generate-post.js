// api/generate-post.js
// 投稿フォーマット:
//   1行目: 煽り系キャッチコピー + 絵文字（40字以内）
//   2行目: 価格 + 具体的メリット（65字以内）
//   3行目: 短縮URL（サーバー側で結合）
// Twitter 換算 140 字以内をサーバー側で保証

// 楽天商品名の重複ワード・SEOノイズを除去して整形
function dedupeProductName(name) {
  // 1. 【】や[]で囲まれたSEOブロックを除去（例: 【楽天1位】【送料無料】）
  let cleaned = name.replace(/[【【][^】】]*[】】]/g, '').replace(/\[[^\]]*\]/g, '');

  // 2. スペース区切りで分割し、出現済みの単語（3文字以上）を2回目以降削除
  const tokens = cleaned.split(/[\s　]+/).filter(t => t.length > 0);
  const seen = new Set();
  const deduped = tokens.filter(t => {
    const key = t.toLowerCase();
    if (t.length >= 3 && seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 3. 先頭・末尾の空白や記号を整理して最大50文字に収める
  return deduped.join(' ').replace(/^[\s・\/]+|[\s・\/]+$/g, '').slice(0, 50);
}

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

  console.log('[generate-post] req.body RAW:', JSON.stringify(req.body));

  const { name: rawName, price, catchcopy, description: rawDescription, url } = req.body;
  // 【】内のSEOワード・重複ワードを除去して自然な商品名に整形
  const name = dedupeProductName(rawName || '');
  const description = (rawDescription || '').replace(/[\r\n]+/g, ' ').slice(0, 100);
  console.log('[generate-post] req.body:', JSON.stringify({ name, price, catchcopy, description, url }));
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return res.status(500).json({ success: false, error: 'GEMINI_API_KEYが未設定' });

  const prompt = `楽天商品のXポスト文を【必ず2行だけ】生成してください。
URL・ハッシュタグは禁止。

【商品情報】
商品名: ${name}
価格: ¥${Number(price).toLocaleString()}
キャッチコピー: ${catchcopy || '（なし）'}
商品説明: ${description || '（なし）'}

【目的】
広告っぽい商品紹介ではなく、「日常の小さなストレス」に共感するX投稿を作る。

【重要】
商品を褒めるのではなく、「こういう時ちょっと嫌なんだよね」を先に書く。

【出力ルール】

1行目:
家事・梅雨・暑さ・ズボラ・生活感など、リアルな小さなストレスを書く。人間の独り言っぽく。40文字以内。

例:「台拭き、すぐびちゃびちゃなる😇」「梅雨の洗い物、地味にだるい☔️」「生活感出るキッチン、ちょい嫌。」

2行目:
¥価格＋どう快適になったかを自然に書く。広告っぽく褒めすぎない。65文字以内。

例:「¥1,870／吸水かなり良くて乾くの早い」「¥1,870／北欧っぽくて出しっぱでもラク」

【禁止】
神・最強・バズ・買わなきゃ損・後悔・過剰な煽り・AIっぽい絶賛・レビュー件数アピール`;

  console.log('[generate-post] description:', description);
  console.log('[generate-post] prompt:', prompt);

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${geminiKey}`,
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
