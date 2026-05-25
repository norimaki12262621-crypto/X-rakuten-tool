// api/generate-post.js
// 投稿フォーマット（3〜4行）:
//   1行目: 状況・あるある
//   2行目: 補足の感情
//   (空行)
//   4行目: ¥価格／生活の変化
//   5行目: 短縮URL
// Twitter 換算 140 字以内をサーバー側で保証
//
// 処理フロー:
//   1. analyzeProduct() → productType / scene / pain / benefit / hooks を取得
//   2. 70点未満 → スキップ
//   3. 投稿プロンプトには商品名を渡さず productType+scene で書かせる

const Groq = require('groq-sdk');

// SEOノイズ除去
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

// 140字超えなら末尾行から1文字ずつ削る
function trimTo140(body, url) {
  let postText = `${body}\n${url}`;
  if (twitterCount(postText) <= 140) return postText;
  const lines = body.split('\n');
  for (let i = lines.length - 1; i >= 0 && twitterCount(postText) > 140; i--) {
    while (twitterCount(postText) > 140 && [...(lines[i] || '')].length > 0) {
      lines[i] = [...lines[i]].slice(0, -1).join('');
      body = lines.join('\n');
      postText = `${body}\n${url}`;
    }
  }
  return postText;
}

// カテゴリ別フォールバックhook（2行スタイル）
const FALLBACK_HOOKS = {
  beauty:    ['朝の髪、\n湿気で広がるのほんと無理😇', '乾燥ひどい日、\n化粧ノリ終わるのほんと萎える'],
  household: ['部屋干し、\n乾いたと思ったらまだ湿ってる☔️', '台拭き、\nすぐびちゃびちゃになるの地味にしんどい'],
  kids:      ['子どもの靴、\n翌朝まだ湿ってる絶望👟', '子どもへのプレゼント、\n毎年何あげればいいかわからん😅'],
  food:      ['料理めんどい日、\n正直かなりある', '洗い物多いの、\n地味にしんどい'],
  fashion:   ['夏の日差し、\n顔焼けてくの嫌すぎ', 'コーデ決まらない朝、\nちょい萎える'],
  other:     ['なんか使いにくいな、\nがずっと続いてた件。', '収納、\nなんとかしたいなとずっと思ってる。'],
};

// Groq が使えない場合のフォールバック
function fallbackPost(price, catchcopy, category = 'other') {
  const hooks = FALLBACK_HOOKS[category] || FALLBACK_HOOKS.other;
  const hook = hooks[Math.floor(Math.random() * hooks.length)];
  const priceStr = `¥${Number(price).toLocaleString()}`;
  let desc = catchcopy || '';
  if ([...desc].length > 40) desc = [...desc].slice(0, 39).join('') + '…';
  const priceLine = desc ? `${priceStr}／${desc}` : priceStr;
  return `${hook}\n\n${priceLine}`;
}

// 商品分析（score + productType + scene + pain + benefit + hooks を返す）
async function analyzeProduct(name, price, catchcopy, groqClient) {
  const prompt = `楽天商品をX向けにスコアリングしてJSON1行のみ返してください。説明文不要。
商品名:${name} ¥${Number(price).toLocaleString()} ${catchcopy || ''}
{"score":0-100,"category":"beauty/household/kids/food/fashion/other","productType":"商品の一般名称（例:ヘアオイル・除湿機・靴乾燥機）","scene":"この商品が必要な生活シーン20字以内","pain":"悩み15字以内","benefit":"使った後の生活変化20字以内","hook1":"状況あるある20字以内","hook1b":"補足感情20字以内","hook2":"状況あるある20字以内","hook2b":"補足感情20字以内"}
高評価条件:ストレス解決/生活改善/子ども/ズボラ/季節感。70点未満=X向きでない。`;

  const completion = await groqClient.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.1-8b-instant',
    temperature: 0.4,
    max_tokens: 200,
  });

  const raw = (completion.choices[0]?.message?.content || '').trim();
  if (!raw) throw new Error('分析応答が空');
  console.log('[generate-post] 分析raw:', raw);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('分析JSONパース失敗');
  const parsed = JSON.parse(jsonMatch[0]);

  const score       = typeof parsed.score === 'number' ? parsed.score : null;
  const category    = parsed.category    || 'other';
  const productType = parsed.productType || '';
  const scene       = parsed.scene       || '';
  const pain        = parsed.pain        || '';
  const benefit     = parsed.benefit     || '';
  const hooks = [
    parsed.hook1 && parsed.hook1b ? `${parsed.hook1}\n${parsed.hook1b}` : parsed.hook1,
    parsed.hook2 && parsed.hook2b ? `${parsed.hook2}\n${parsed.hook2b}` : parsed.hook2,
  ].filter(Boolean);

  return { score, category, productType, scene, pain, benefit, hooks };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name: rawName, price, catchcopy: rawCatchcopy, description: rawDescription, url } = req.body;
  const name        = cleanProductName(rawName || '');
  const catchcopy   = cleanProductName(rawCatchcopy || '');
  const description = (rawDescription || '').replace(/\s+/g, ' ').slice(0, 300);
  console.log('[generate-post] processed:', JSON.stringify({ name, price, catchcopy, url }));

  const groqKey = process.env.GROQ_API_KEY?.replace(/^﻿/, '').trim();
  if (!groqKey) return res.status(500).json({ success: false, error: 'GROQ_API_KEYが未設定' });

  const groqClient = new Groq({ apiKey: groqKey, timeout: 15000 });

  // ── 商品分析 ──
  let analysisScore       = null;
  let analysisCategory    = 'other';
  let analysisProductType = '';
  let analysisScene       = '';
  let analysisPain        = '';
  let analysisBenefit     = '';
  let analysisHooks       = [];
  try {
    const result        = await analyzeProduct(name, price, catchcopy, groqClient);
    analysisScore       = result.score;
    analysisCategory    = result.category;
    analysisProductType = result.productType;
    analysisScene       = result.scene;
    analysisPain        = result.pain;
    analysisBenefit     = result.benefit;
    analysisHooks       = result.hooks;
    console.log('[generate-post] 分析:', JSON.stringify({ analysisScore, analysisProductType, analysisScene, analysisPain, analysisBenefit }));
  } catch (err) {
    console.log('[generate-post] 分析スキップ（エラー）:', err.message);
  }

  // 70点未満はスキップ
  if (analysisScore !== null && analysisScore < 70) {
    console.log(`[generate-post] SKIP: ${analysisScore}点 < 70点`);
    return res.status(200).json({ success: false, skipped: true, score: analysisScore });
  }

  const hookExamples = analysisHooks.length > 0
    ? analysisHooks
    : (FALLBACK_HOOKS[analysisCategory] || FALLBACK_HOOKS.other);

  // 投稿プロンプト：商品名を渡さず productType+scene+pain+benefit のみで書かせる
  const prompt = `Xの独り言投稿を生成してください。URL・ハッシュタグ禁止。

【STEP1】この商品は「${analysisProductType || '生活雑貨'}」です。
【STEP2】生活シーン:「${analysisScene || analysisPain || '日常のストレス'}」を想像してください。
【STEP3】その人の本音の独り言として投稿文を書いてください。

【絶対禁止】商品名・型番・ブランド名を文章に入れない。
【絶対禁止】ECサイト説明・スペック読み上げ・レビュー口調。

【出力フォーマット】
（状況・あるある　20字以内）
（補足の感情　20字以内）

¥${Number(price).toLocaleString()}／（「${analysisBenefit || '生活の変化'}」をどう表現するか　65字以内）

【参考HOOKパターン】
${hookExamples.join('\n---\n')}

【¥行ルール】
良い:「帰宅後すぐ乾かせるのかなりラク」「ベタつかんのに保湿感かなり残る」「朝の支度が5分ラクになった」
悪い:「吸水性抜群」「高品質」「大人気」「商品名がすごい」
禁止:神・最強・買わなきゃ損・話題・人気・高評価・おすすめ・ランキング`;

  console.log('[generate-post] prompt length:', prompt.length);

  try {
    const completion = await groqClient.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.1-8b-instant',
      temperature: 0.85,
      max_tokens: 180,
    });

    let raw = (completion.choices[0]?.message?.content || '').trim();
    if (!raw) throw new Error('Groq応答が空');
    console.log('[generate-post] Groq raw:', raw);

    // URL除去・連続空行を1つに正規化
    raw = raw.replace(/https?:\/\/\S+/g, '').replace(/\n{3,}/g, '\n\n').trim();

    const postText = trimTo140(raw, url);
    return res.status(200).json({
      success: true,
      postText,
      charCount: twitterCount(postText),
      score: analysisScore,
    });

  } catch (err) {
    console.log('[generate-post] Groq failed:', err.message);
    const body = fallbackPost(price, catchcopy, analysisCategory);
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
