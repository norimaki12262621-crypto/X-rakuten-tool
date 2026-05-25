// api/generate-post.js
// 投稿フォーマット:
//   1行目: 共感・あるある系（独り言っぽく、40字以内）
//   2行目: 価格 + どう助かったか（65字以内）
//   3行目: 短縮URL（サーバー側で結合）
// Twitter 換算 140 字以内をサーバー側で保証
//
// 処理フロー:
//   1. analyzeProduct() で商品をスコアリング（0-100点）
//   2. 70点未満 → スキップ（{ success: false, skipped: true, score, analysis }）
//   3. 70点以上 → 分析で得たHOOKを活用して投稿文生成

const Groq = require('groq-sdk');

// 楽天商品名の重複ワード・SEOノイズを除去して整形
function dedupeProductName(name) {
  let cleaned = name.replace(/[【【][^】】]*[】】]/g, '').replace(/\[[^\]]*\]/g, '');
  const tokens = cleaned.split(/[\s　]+/).filter(t => t.length > 0);
  const seen = new Set();
  const deduped = tokens.filter(t => {
    const key = t.toLowerCase();
    if (t.length >= 3 && seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

// Groq が使えない場合のフォールバック投稿文生成
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
  let desc = catchcopy || '';
  if ([...desc].length > 64) desc = [...desc].slice(0, 63).join('') + '…';
  let line2 = desc ? `${priceStr}／${desc}` : priceStr;
  if (line2.length > 60) line2 = line2.slice(0, 59) + '…';
  return `${line1}\n${line2}`;
}

// 商品分析スコアリング（X向け感情評価）
async function analyzeProduct(name, price, catchcopy, description, groqClient) {
  const analysisPrompt = `あなたは「X×楽天アフィリエイト分析AI」です。
目的は「Xで伸びる商品」「クリックされる商品」「楽天ROOMで売れやすい商品」を見極めること。
単なる楽天人気商品ではなく、"Xで感情が動くか"を最優先で分析してください。

【商品情報】
商品名: ${name}
価格: ¥${Number(price).toLocaleString()}
キャッチコピー: ${catchcopy || '（なし）'}
商品説明: ${description || '（なし）'}

【分析項目】以下を100点満点で分析：
① Xで止まりやすいか → スクロール停止力
② 共感されやすいか → 「わかる」が起きるか
③ 季節性があるか → 梅雨・夏・父の日など
④ 感情が動くか → ストレス解決・便利・悩み
⑤ ROOMクリックされやすいか → 「気になる」が起きるか
⑥ 実際に売れやすそうか → 衝動買い・価格帯・実用性

【重要】
Xでは以下の感情が強い商品を高評価：
困ってた・めんどい・臭い・暑い・乾かない・父の日迷う・子ども関連・ズボラ救済・生活改善・地味ストレス

【分析結果フォーマット】
■ 総合評価 ○○点
■ この商品が強い理由
■ 弱い理由
■ X向きか？ S/A/B/C
■ TikTok向きか？ S/A/B/C
■ おすすめ投稿方向
■ おすすめHOOK例（3つ）

HOOKルール：
広告っぽくしない。
悪い例：「神アイテム」「買わなきゃ損」
良い例：「部屋干し、全然乾かない😇」「息子の靴、毎日終わってる👟」「父の日、毎年ネタ切れ。」`;

  const completion = await groqClient.chat.completions.create({
    messages: [{ role: 'user', content: analysisPrompt }],
    model: 'llama-3.1-8b-instant',
    temperature: 0.5,
    max_tokens: 600,
  });

  const analysisText = (completion.choices[0]?.message?.content || '').trim();
  if (!analysisText) throw new Error('分析応答が空');

  const scoreMatch = analysisText.match(/■\s*総合評価\s*(\d+)\s*点/);
  const score = scoreMatch ? parseInt(scoreMatch[1], 10) : null;

  const hookSectionMatch = analysisText.split(/おすすめHOOK例[^\n]*/);
  const hookRaw = hookSectionMatch.length > 1 ? hookSectionMatch[hookSectionMatch.length - 1] : '';
  const hooks = hookRaw
    .split('\n')
    .map(l => l.replace(/^[\s・\-\d.「*#①②③]+/, '').replace(/」\s*$/, '').trim())
    .filter(l => l.length > 3 && [...l].length <= 40);

  return { score, analysisText, hooks };
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
  const name = dedupeProductName(rawName || '');
  const catchcopy = dedupeProductName(rawCatchcopy || '');
  const description = (rawDescription || '').replace(/[\r\n]+/g, ' ').slice(0, 100);
  console.log('[generate-post] processed:', JSON.stringify({ name, price, catchcopy, description, url }));

  const groqKey = process.env.GROQ_API_KEY?.replace(/^﻿/, '').trim();
  if (!groqKey) return res.status(500).json({ success: false, error: 'GROQ_API_KEYが未設定' });

  const groqClient = new Groq({ apiKey: groqKey, timeout: 15000 });

  // ── 商品分析スコアリング ──
  let analysisScore = null;
  let analysisText = '';
  let analysisHooks = [];
  try {
    const result = await analyzeProduct(name, price, catchcopy, description, groqClient);
    analysisScore = result.score;
    analysisText = result.analysisText;
    analysisHooks = result.hooks;
    console.log('[generate-post] 分析スコア:', analysisScore);
    console.log('[generate-post] 分析HOOK候補:', analysisHooks);
    console.log('[generate-post] 分析全文:', analysisText);
  } catch (err) {
    console.log('[generate-post] 分析スキップ（エラー）:', err.message);
  }

  // 70点未満はスキップ
  if (analysisScore !== null && analysisScore < 70) {
    console.log(`[generate-post] SKIP: スコア${analysisScore}点 < 70点 → 投稿文生成をスキップ`);
    return res.status(200).json({
      success: false,
      skipped: true,
      score: analysisScore,
      analysis: analysisText,
    });
  }

  // HOOKがあれば1行目候補として投稿プロンプトに渡す
  const hookHint = analysisHooks.length > 0
    ? `\n\n【AI分析で選ばれたHOOK候補（1行目に活用してください）】\n${analysisHooks.map((h, i) => `${i + 1}. ${h}`).join('\n')}`
    : '';

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

例（商品カテゴリに合わせること）：
「子どもへのプレゼント、毎年悩む😅」
「ぬいぐるみって洗えないやつ多い」
「誕生日プレゼント、何あげればいいかわからん」
「子ども、同じおもちゃばかり欲しがる」
「台拭き、すぐびちゃびちゃになる😇」
「夏の日差し、顔焼けてくの嫌すぎ」

商品の種類に応じて適切な例を参考にすること。

2行目:
¥価格＋どう快適になったかを自然に書く。広告っぽく褒めすぎない。65文字以内（厳守）。商品名をそのままコピーしない。

例:「¥1,870／吸水かなり良くて乾くの早い」「¥1,870／北欧っぽくて出しっぱでもラク」

【禁止】
神・最強・バズ・買わなきゃ損・後悔・過剰な煽り・AIっぽい絶賛・レビュー件数アピール・「え、まだ買ってないの」系・商品名そのままのコピペ${hookHint}`;

  console.log('[generate-post] prompt:', prompt);

  try {
    const completion = await groqClient.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.1-8b-instant',
      temperature: 0.8,
      max_tokens: 150,
    });

    let raw = (completion.choices[0]?.message?.content || '').trim();
    if (!raw) throw new Error('Groq応答が空');

    console.log('[generate-post] Groq raw:', raw);

    raw = raw.replace(/https?:\/\/\S+/g, '').trim();

    const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    console.log('[generate-post] lines[0]:', lines[0]);
    console.log('[generate-post] lines[1]:', lines[1]);

    let line2 = lines[1] || '';
    if (line2.length > 60) line2 = line2.slice(0, 59) + '…';
    let body = line2 ? `${lines[0]}\n${line2}` : lines[0];

    const postText = trimTo140(body, url);
    return res.status(200).json({
      success: true,
      postText,
      charCount: twitterCount(postText),
      score: analysisScore,
      analysis: analysisText || undefined,
    });

  } catch (err) {
    console.log('[generate-post] Groq failed:', err.message);
    const body = fallbackPost(name, price, catchcopy);
    const postText = trimTo140(body, url);
    return res.status(200).json({
      success: true,
      postText,
      charCount: twitterCount(postText),
      fallback: true,
      score: analysisScore,
    });
  }
};
