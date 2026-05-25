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
//   1. analyzeProduct() → score / category / pain / benefit / hooks を取得
//   2. 70点未満 → スキップ
//   3. 70点以上 → 分析結果を丸ごと投稿プロンプトに渡す

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
  beauty:    ['朝の肌カサカサすぎて萎える\nスキンケアしても意味ない気がしてた😇', '乾燥ひどい日、\n化粧ノリ終わるのほんと萎える'],
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

// 商品分析（score + category + pain + benefit + hooks を返す）
async function analyzeProduct(name, price, catchcopy, groqClient) {
  const prompt = `楽天商品をX向けにスコアリングしてJSON1行のみ返してください。説明文不要。
商品:${name} ¥${Number(price).toLocaleString()} ${catchcopy || ''}
{"score":0-100,"category":"beauty/household/kids/food/fashion/other","pain":"悩み15字以内","benefit":"帰宅後〜など生活変化20字以内","hook1":"状況あるある20字以内","hook1b":"補足感情20字以内","hook2":"状況あるある20字以内","hook2b":"補足感情20字以内"}
高評価条件:ストレス解決/生活改善/子ども/ズボラ/季節感。70点未満=X向きでない。`;

  const completion = await groqClient.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.1-8b-instant',
    temperature: 0.4,
    max_tokens: 180,
  });

  const raw = (completion.choices[0]?.message?.content || '').trim();
  if (!raw) throw new Error('分析応答が空');
  console.log('[generate-post] 分析raw:', raw);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('分析JSONパース失敗');
  const parsed = JSON.parse(jsonMatch[0]);

  const score    = typeof parsed.score === 'number' ? parsed.score : null;
  const category = parsed.category || 'other';
  const pain     = parsed.pain    || '';
  const benefit  = parsed.benefit || '';
  // hook を「1行目\n2行目」形式で組み立て
  const hooks = [
    parsed.hook1 && parsed.hook1b ? `${parsed.hook1}\n${parsed.hook1b}` : parsed.hook1,
    parsed.hook2 && parsed.hook2b ? `${parsed.hook2}\n${parsed.hook2b}` : parsed.hook2,
  ].filter(Boolean);

  return { score, category, pain, benefit, hooks };
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
  let analysisScore    = null;
  let analysisCategory = 'other';
  let analysisPain     = '';
  let analysisBenefit  = '';
  let analysisHooks    = [];
  try {
    const result     = await analyzeProduct(name, price, catchcopy, groqClient);
    analysisScore    = result.score;
    analysisCategory = result.category;
    analysisPain     = result.pain;
    analysisBenefit  = result.benefit;
    analysisHooks    = result.hooks;
    console.log('[generate-post] 分析:', JSON.stringify({ analysisScore, analysisCategory, analysisPain, analysisBenefit }));
    console.log('[generate-post] HOOKs:', analysisHooks);
  } catch (err) {
    console.log('[generate-post] 分析スキップ（エラー）:', err.message);
  }

  // 70点未満はスキップ
  if (analysisScore !== null && analysisScore < 70) {
    console.log(`[generate-post] SKIP: ${analysisScore}点 < 70点`);
    return res.status(200).json({ success: false, skipped: true, score: analysisScore });
  }

  // フォールバックhookを準備（分析hookがない場合）
  const fallbackHooks = FALLBACK_HOOKS[analysisCategory] || FALLBACK_HOOKS.other;
  const hookExamples  = analysisHooks.length > 0 ? analysisHooks : fallbackHooks;

  const prompt = `Xの独り言投稿を生成してください。URL・ハッシュタグ禁止。
商品:${name} ¥${Number(price).toLocaleString()}
この商品で解決される悩み:${analysisPain || '日常ストレス'}
使った後の生活の変化:${analysisBenefit || '生活がラクになる'}

【出力フォーマット】改行を守ること：
（状況・あるある　20字以内）
（補足の感情　20字以内）

¥価格／（生活がどう変わるか　65字以内）

【参考HOOKパターン】
${hookExamples.join('\n---\n')}

【ルール】
・1〜2行目は「${analysisPain || '日常ストレス'}」を感じている人の本音。商品名コピペ禁止。
・¥の行:「${analysisBenefit || '生活の変化'}」がどう続くかを自然に書く。商品スペック禁止。
・良い¥行:「帰宅後すぐ乾かせるのかなりラク」「ベタつかんのに保湿感かなり残る」
・悪い¥行:「吸水性抜群」「高品質」「大人気」
禁止ワード:神・最強・買わなきゃ損・話題・人気・高評価・おすすめ・ランキング`;

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
