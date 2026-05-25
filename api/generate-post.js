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
//   1. Groq でカテゴリだけ判定
//   2. カテゴリ別 hook/benefit 辞書から投稿本文を生成

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

const CATEGORY_COPY = {
  beauty: {
    hooks: [
      '朝の支度、\n髪まとまらないだけで詰む',
      '乾燥ひどい日、\n化粧ノリ終わるの萎える',
      'お風呂上がり、\nちゃんとケアする余力ほしい',
    ],
    benefits: [
      '朝の支度がちょっとラクになる',
      'ベタつきにくくて気分よく整う',
      '毎日のケアを続けやすい',
    ],
  },
  household: {
    hooks: [
      '部屋干し、\n乾いたと思ったらまだ湿ってる',
      '家の小さいストレス、\n積み重なると地味にしんどい',
      '片づけたはずなのに、\n生活感が残るのつらい',
    ],
    benefits: [
      '家事のひっかかりがひとつ減る',
      '置くだけでいつもの面倒が軽くなる',
      '毎日使う場所が少し整う',
    ],
  },
  kids: {
    hooks: [
      '子ども用品、\n必要になるタイミング急すぎ',
      '子どもへのプレゼント、\n毎回けっこう悩む',
      '朝のバタバタ、\n子ども関連でだいたい増える',
    ],
    benefits: [
      '親の準備ストレスが少し減る',
      '子どもも使いやすくて出番が増える',
      '毎日の支度がちょっと回しやすい',
    ],
  },
  food: {
    hooks: [
      '料理めんどい日、\n正直かなりある',
      'ごはんの準備、\n考えるだけで疲れる日ある',
      '洗い物多いの、\n地味にしんどい',
    ],
    benefits: [
      '食卓の準備がかなりラクになる',
      '忙しい日のごはん問題を助けてくれる',
      '手間少なめでちゃんと満足感ある',
    ],
  },
  fashion: {
    hooks: [
      'コーデ決まらない朝、\nちょい萎える',
      '出かける前、\nなんか物足りない日ある',
      '季節の服選び、\n毎年ちょっと迷う',
    ],
    benefits: [
      'いつもの服に合わせやすい',
      '出かける前の迷いが少し減る',
      '季節感を足しやすい',
    ],
  },
  other: {
    hooks: [
      'なんか使いにくいな、\nがずっと続いてた件。',
      '小さい不便、\n放置するとずっと気になる',
      'これ地味に困る、\nって場面けっこうある',
    ],
    benefits: [
      'いつもの不便が少しラクになる',
      '使うたびに小さく助かる',
      '生活の引っかかりがひとつ減る',
    ],
  },
};

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function normalizeCategory(category) {
  return CATEGORY_COPY[category] ? category : 'other';
}

function inferCategoryFromText(text) {
  const source = text.toLowerCase();
  if (/美容|コスメ|化粧|髪|ヘア|肌|保湿|メイク|シャンプー|オイル|ネイル/.test(source)) return 'beauty';
  if (/掃除|収納|洗濯|乾燥|除湿|キッチン|台所|風呂|トイレ|部屋干し|家事/.test(source)) return 'household';
  if (/子ども|子供|キッズ|ベビー|赤ちゃん|入園|入学|靴|おもちゃ|知育/.test(source)) return 'kids';
  if (/食品|惣菜|肉|魚|米|スイーツ|お菓子|料理|ごはん|冷凍|麺|珈琲|コーヒー/.test(source)) return 'food';
  if (/服|バッグ|財布|靴|帽子|ワンピ|トップス|パンツ|コーデ|ファッション|アクセ/.test(source)) return 'fashion';
  return 'other';
}

function buildPost(price, category = 'other') {
  const copy = CATEGORY_COPY[normalizeCategory(category)];
  const hook = pick(copy.hooks);
  const benefit = pick(copy.benefits);
  const priceStr = `¥${Number(price).toLocaleString()}`;
  return `${hook}\n\n${priceStr}／${benefit}`;
}

function createGroqClient(apiKey) {
  const Groq = require('groq-sdk');
  return new Groq({ apiKey, timeout: 15000 });
}

async function analyzeCategory(name, price, catchcopy, description, groqClient) {
  const prompt = `楽天商品を次のカテゴリのどれか1つに分類し、JSONのみ返してください。説明文不要。
カテゴリ: beauty / household / kids / food / fashion / other
商品名:${name}
価格:¥${Number(price).toLocaleString()}
キャッチコピー:${catchcopy || ''}
説明:${description || ''}
{"category":"beauty/household/kids/food/fashion/other"}`;

  const completion = await groqClient.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.1-8b-instant',
    temperature: 0.4,
    max_tokens: 200,
  });

  const raw = (completion.choices[0]?.message?.content || '').trim();
  if (!raw) throw new Error('カテゴリ分析応答が空');
  console.log('[generate-post] category raw:', raw);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('カテゴリJSONパース失敗');
  const parsed = JSON.parse(jsonMatch[0]);
  return normalizeCategory(parsed.category);
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
  let category = inferCategoryFromText(`${name} ${catchcopy} ${description}`);
  try {
    if (groqKey) {
      const groqClient = createGroqClient(groqKey);
      category = await analyzeCategory(name, price, catchcopy, description, groqClient);
    }
  } catch (err) {
    console.log('[generate-post] category fallback:', err.message);
  }

  const body = buildPost(price, category);
  const postText = trimTo140(body, url);
  return res.status(200).json({
    success: true,
    postText,
    charCount: twitterCount(postText),
    category,
  });
};
