// api/generate-post.js
// 投稿フォーマット:
//   1行目: 共感・あるある系（独り言っぽく、40字以内）
//   2行目: 価格 + どう助かったか（65字以内）
//   3行目: 短縮URL（サーバー側で結合）
// Twitter 換算 140 字以内をサーバー側で保証
//
// 処理フロー:
//   1. analyzeProduct() で商品をスコアリング（JSON軽量版）
//   2. 70点未満 → スキップ（{ success: false, skipped: true, score }）
//   3. 70点以上 → 分析で得たHOOKを活用して投稿文生成

const Groq = require('groq-sdk');

// SEOノイズ除去 + 重複削除
function cleanProductName(name = '') {
  return name
    .replace(/送料無料|公式|ランキング|SALE|ポイント\d*倍?|レビュー[^\s　]*/g, '')
    .replace(/限定|メール便|正規品|最強|人気|【[^】]*】|\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
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

// Groq が使えない場合のフォールバック
function fallbackPost(price, catchcopy) {
  const hooks = [
    '台拭き、すぐびちゃびちゃになる😇',
    '梅雨の部屋干し、地味にだるい☔️',
    'キッチン、なんか生活感出すぎてちょい嫌。',
    '洗い物のあとの水はね、毎回ちょっとイラつく。',
    '収納、なんとかしたいなとずっと思ってる。',
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

// 商品分析スコアリング（軽量JSON版）
async function analyzeProduct(name, price, catchcopy, groqClient) {
  const prompt = `楽天商品をX向けにスコアリングしてJSON1行のみで返してください。説明文不要。
商品名:${name} 価格:¥${Number(price).toLocaleString()} キャッチ:${catchcopy || 'なし'}
高評価条件:ストレス解決/生活改善/子ども/ズボラ/季節感。70点未満=X向きでない。
{"score":整数,"emotion":"感情ワード","hook1":"独り言40字以内","hook2":"独り言40字以内","hook3":"独り言40字以内"}`;

  const completion = await groqClient.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.1-8b-instant',
    temperature: 0.4,
    max_tokens: 120,
  });

  const raw = (completion.choices[0]?.message?.content || '').trim();
  if (!raw) throw new Error('分析応答が空');
  console.log('[generate-post] 分析raw:', raw);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('分析JSONパース失敗');
  const parsed = JSON.parse(jsonMatch[0]);

  const score = typeof parsed.score === 'number' ? parsed.score : null;
  const hooks = [parsed.hook1, parsed.hook2, parsed.hook3]
    .filter(h => h && [...h].length <= 40);

  return { score, hooks };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name: rawName, price, catchcopy: rawCatchcopy, description: rawDescription, url } = req.body;
  const name = cleanProductName(rawName || '');
  const catchcopy = cleanProductName(rawCatchcopy || '');
  const description = (rawDescription || '').replace(/\s+/g, ' ').slice(0, 300);
  console.log('[generate-post] processed:', JSON.stringify({ name, price, catchcopy, url }));

  const groqKey = process.env.GROQ_API_KEY?.replace(/^﻿/, '').trim();
  if (!groqKey) return res.status(500).json({ success: false, error: 'GROQ_API_KEYが未設定' });

  const groqClient = new Groq({ apiKey: groqKey, timeout: 15000 });

  // ── 商品分析スコアリング ──
  let analysisScore = null;
  let analysisHooks = [];
  try {
    const result = await analyzeProduct(name, price, catchcopy, groqClient);
    analysisScore = result.score;
    analysisHooks = result.hooks;
    console.log('[generate-post] 分析スコア:', analysisScore, 'HOOKs:', analysisHooks);
  } catch (err) {
    console.log('[generate-post] 分析スキップ（エラー）:', err.message);
  }

  // 70点未満はスキップ
  if (analysisScore !== null && analysisScore < 70) {
    console.log(`[generate-post] SKIP: ${analysisScore}点 < 70点`);
    return res.status(200).json({ success: false, skipped: true, score: analysisScore });
  }

  // HOOKがあれば1行目候補として渡す
  const hookHint = analysisHooks.length > 0
    ? `\nHOOK候補:${analysisHooks.join('/')}`
    : '';

  const prompt = `楽天商品のXポスト文を2行だけ生成。URL・ハッシュタグ禁止。
商品:${name} ¥${Number(price).toLocaleString()} ${catchcopy}
説明:${description}

1行目(40字以内):日常ストレスの独り言。商品名使わない。
例:「子どもへのプレゼント、毎年悩む😅」「台拭き、すぐびちゃびちゃになる😇」「夏の日差し、顔焼けてくの嫌すぎ」
2行目(65字以内):¥価格／どう解決したか。褒めすぎない。
例:「¥1,870／吸水良くて乾くの早い」
禁止:神・最強・買わなきゃ損・商品名コピペ${hookHint}`;

  console.log('[generate-post] prompt length:', prompt.length);

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

    let line2 = lines[1] || '';
    if (line2.length > 60) line2 = line2.slice(0, 59) + '…';
    const body = line2 ? `${lines[0]}\n${line2}` : lines[0];

    const postText = trimTo140(body, url);
    return res.status(200).json({
      success: true,
      postText,
      charCount: twitterCount(postText),
      score: analysisScore,
    });

  } catch (err) {
    console.log('[generate-post] Groq failed:', err.message);
    const body = fallbackPost(price, catchcopy);
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
