// api/generate-post.js
// 投稿フォーマット:
//   1行目: 共感・あるある系（独り言っぽく、40字以内）
//   2行目: 価格 + 生活の変化（65字以内）
//   3行目: 短縮URL（サーバー側で結合）
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

// カテゴリ別フォールバックhook
const FALLBACK_HOOKS = {
  beauty:    ['朝の肌カサカサすぎて萎える', '乾燥ひどい日、化粧ノリ終わる', 'スキンケアめんどい日ある😇'],
  household: ['台拭き、すぐびちゃびちゃになる😇', '洗濯物の臭い、地味にきつい', '部屋の散らかり、見て見ぬふり'],
  kids:      ['子どもへのプレゼント、毎年悩む😅', 'ぬいぐるみって洗えないやつ多い', '子ども、騒ぎすぎてちょい疲れた'],
  food:      ['料理めんどい日、正直ある', '洗い物多いの地味にしんどい', '夜ご飯、何にすればいいかわからん'],
  fashion:   ['夏の日差し、顔焼けてくの嫌すぎ', 'コーデ決まらない朝、ちょい萎える', '毎朝同じ服になりがち'],
  other:     ['なんか使いにくいな、がずっと続いてた件。', '収納、なんとかしたいなとずっと思ってる。', 'キッチン、なんか生活感出すぎてちょい嫌。'],
};

// Groq が使えない場合のフォールバック
function fallbackPost(price, catchcopy, category = 'other') {
  const hooks = FALLBACK_HOOKS[category] || FALLBACK_HOOKS.other;
  const line1 = hooks[Math.floor(Math.random() * hooks.length)];
  const priceStr = `¥${Number(price).toLocaleString()}`;
  let desc = catchcopy || '';
  if ([...desc].length > 64) desc = [...desc].slice(0, 63).join('') + '…';
  let line2 = desc ? `${priceStr}／${desc}` : priceStr;
  if (line2.length > 60) line2 = line2.slice(0, 59) + '…';
  return `${line1}\n${line2}`;
}

// 商品分析（score + category + pain + benefit + hooks を返す）
async function analyzeProduct(name, price, catchcopy, groqClient) {
  const prompt = `楽天商品をX向けにスコアリングしてJSON1行のみ返してください。説明文不要。
商品:${name} ¥${Number(price).toLocaleString()} ${catchcopy || ''}
{"score":0-100,"category":"beauty/household/kids/food/fashion/other","pain":"悩み10字以内","benefit":"生活変化10字以内","hook1":"独り言40字以内","hook2":"独り言40字以内","hook3":"独り言40字以内"}
高評価条件:ストレス解決/生活改善/子ども/ズボラ/季節感。70点未満=X向きでない。`;

  const completion = await groqClient.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.1-8b-instant',
    temperature: 0.4,
    max_tokens: 160,
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
  const hooks    = [parsed.hook1, parsed.hook2, parsed.hook3].filter(h => h && [...h].length <= 40);

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

  // 分析結果をプロンプトに組み込む
  const painLine    = analysisPain    ? `この商品で解決される悩み:${analysisPain}` : '';
  const benefitLine = analysisBenefit ? `その後の生活の変化:${analysisBenefit}` : '';
  const hookLine    = analysisHooks.length > 0
    ? `参考HOOK(1行目に使う):${analysisHooks.join('/')}`
    : `参考HOOK:${(FALLBACK_HOOKS[analysisCategory] || FALLBACK_HOOKS.other).join('/')}`;

  const prompt = `Xポスト文を2行のみ生成。URL・ハッシュタグ禁止。
商品:${name} ¥${Number(price).toLocaleString()}
${painLine}
${benefitLine}
${hookLine}

1行目(40字以内):「${analysisPain || '日常ストレス'}」を感じている人の本音の独り言。商品名コピペ禁止。広告っぽくしない。
2行目(65字以内):¥価格／${analysisBenefit || '使ってどう変わったか'}。商品スペック禁止。生活の変化だけ書く。
悪い2行目:吸水性抜群・高品質・人気
良い2行目:朝ラク・乾くの早い・ベタつき減った・肌かなりラク
禁止:神・最強・買わなきゃ損・商品名コピペ`;

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
