// api/generate-post.js
// 投稿フォーマット:
//   1行目: 共感・あるある系（独り言っぽく、40字以内）
//   2行目: 価格 + どう助かったか（65字以内）
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

// 2行目の「／」以降を最大60文字に強制カット（超えたら59文字+「…」）
function trimLine2(line) {
  const sep = line.indexOf('／');
  if (sep === -1) return line;
  const prefix = line.slice(0, sep + 1);
  const suffixChars = [...line.slice(sep + 1)];
  if (suffixChars.length > 60) {
    return prefix + suffixChars.slice(0, 59).join('') + '…';
  }
  return line;
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
    '台拭き、すぐびちゃびちゃなる😇',
    '梅雨の部屋干し、地味にだるい☔️',
    'キッチン、なんか生活感出すぎてちょい嫌。',
    '洗い物のあとの水はね、毎回ちょっとイラつく。',
    '収納、なんとかしたいなとずっと思ってる。',
    '掃除のたびに「これじゃないな」ってなる。',
    '細かいとこの汚れ、見て見ぬふりしてた。',
    'なんか使いにくいな、がずっと続いてた件。',
  ];
  const line1 = hooks[Math.floor(Math.random() * hooks.length)];
  const priceStr = `¥${Number(price).toLocaleString()}`;

  // catchcopyを使う（商品名はそのまま使わない）。64文字超なら63文字+「…」
  let desc = catchcopy || '';
  if ([...desc].length > 64) {
    desc = [...desc].slice(0, 63).join('') + '…';
  }

  let line2 = desc ? `${priceStr}／${desc}` : priceStr;
  if (line2.length > 60) {
    line2 = line2.slice(0, 59) + '…';
  }
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

  const { name: rawName, price, catchcopy: rawCatchcopy, description: rawDescription, url } = req.body;
  // 【】内のSEOワード・重複ワードを除去して自然な商品名・キャッチコピーに整形
  const name = dedupeProductName(rawName || '');
  const catchcopy = dedupeProductName(rawCatchcopy || '');
  const description = (rawDescription || '').replace(/[\r\n]+/g, ' ').slice(0, 100);
  console.log('[generate-post] processed:', JSON.stringify({ name, price, catchcopy, description, url }));
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
家事・梅雨・暑さ・ズボラ・生活感など、リアルな小さなストレスを書く。人間の独り言っぽく。40文字以内。商品名をそのまま入れない。

例:「台拭き、すぐびちゃびちゃなる😇」「梅雨の洗い物、地味にだるい☔️」「生活感出るキッチン、ちょい嫌。」

2行目:
¥価格＋どう快適になったかを自然に書く。広告っぽく褒めすぎない。65文字以内（厳守）。商品名をそのままコピーしない。

例:「¥1,870／吸水かなり良くて乾くの早い」「¥1,870／北欧っぽくて出しっぱでもラク」

【禁止】
神・最強・バズ・買わなきゃ損・後悔・過剰な煽り・AIっぽい絶賛・レビュー件数アピール・「え、まだ買ってないの」系・商品名そのままのコピペ`;

  console.log('[generate-post] description:', description);
  console.log('[generate-post] prompt:', prompt);

  try {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 10000);
    let r;
    try {
      r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.8, maxOutputTokens: 150 },
          }),
          signal: ac.signal,
        }
      );
    } finally {
      clearTimeout(timeout);
    }
    console.log('[generate-post] Gemini HTTP status:', r.status);
    const rawText = await r.text();
    if (!r.ok) {
      console.log('[generate-post] Gemini error body:', rawText);
    }
    let data;
    try { data = JSON.parse(rawText); } catch { throw new Error(`Gemini JSONパース失敗: ${rawText.slice(0, 200)}`); }
    if (data.error) {
      console.log('[generate-post] Gemini error code:', data.error.code);
      console.log('[generate-post] Gemini error status:', data.error.status);
      console.log('[generate-post] Gemini error message:', data.error.message);
      throw new Error(`Gemini APIエラー(${data.error.code} ${data.error.status}: ${data.error.message})`);
    }
    let raw = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    if (!raw) {
      console.log('[generate-post] Gemini empty response, full data:', JSON.stringify(data));
      throw new Error('Gemini応答が空');
    }

    console.log('[generate-post] Gemini raw:', raw);

    // URLが混入していたら除去
    raw = raw.replace(/https?:\/\/\S+/g, '').trim();

    // 2行に正規化
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    console.log('[generate-post] lines[0]:', lines[0]);
    console.log('[generate-post] lines[1]:', lines[1]);
    console.log('[generate-post] lines[1] length:', (lines[1] || '').length);
    let line2 = lines[1] || '';
    if (line2.length > 60) {
      line2 = line2.slice(0, 59) + '…';
    }
    let body = line2 ? `${lines[0]}\n${line2}` : lines[0];

    const postText = trimTo140(body, url);
    return res.status(200).json({ success: true, postText, charCount: twitterCount(postText) });

  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    console.log('[generate-post] Gemini failed:', isTimeout ? 'TIMEOUT(10s)' : err.message);
    const body = fallbackPost(name, price, catchcopy);
    const postText = trimTo140(body, url);
    return res.status(200).json({ success: true, postText, charCount: twitterCount(postText), fallback: true });
  }
};
