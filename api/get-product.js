module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '人気 おすすめ', maxPrice = 10000 } = req.query;
  const groqKey = process.env.GROQ_API_KEY?.replace(/^﻿/, '').trim();

  function dedupeProductName(name) {
    let cleaned = (name || '')
      .replace(/【[^】]*】/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/ポイント\s*最大?\d+倍?/g, '')
      .replace(/お買い物マラソン\s*\d+\/\d+\s*\d+:\d+\s*[~～-]\s*\d+\/\d+\s*\d+:\d+/g, '')
      .replace(/楽天ランキング\d+位/g, '')
      .replace(/選べる！?|楽天限定|送料無料|公式|SALE|セール|超人気|最強|高評価/g, '')
      .replace(/[★☆]+/g, ' ');
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

  function twitterCount(text) {
    const urls = text.match(/https?:\/\/\S+/g) || [];
    const urlActual = urls.reduce((s, u) => s + [...u].length, 0);
    return [...text].length - urlActual + urls.length * 23;
  }

  function trimTo140(body, url) {
    let postText = `${body}\n${url}`;
    const lines = body.split('\n');
    for (let idx = lines.length - 1; idx >= 0; idx--) {
      while (twitterCount(postText) > 140) {
        if (!lines[idx] || [...lines[idx]].length === 0) break;
        lines[idx] = [...lines[idx]].slice(0, -1).join('');
        body = lines.join('\n');
        postText = `${body}\n${url}`;
      }
    }
    return postText;
  }

  function pickBest(items) {
    return items.slice().sort((a, b) => {
      const sa = b.reviewAverage * 18 + Math.min(b.reviewCount / 8, 22);
      const sb = a.reviewAverage * 18 + Math.min(a.reviewCount / 8, 22);
      return sa - sb;
    })[0] || items[0];
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

  const TOPIC_COPY = [
    {
      pattern: /ラロッシュ|ポゼ|美容液|化粧水|乳液|クリーム|日焼け止め|uv|トーンアップ|下地|スキンケア|敏感肌|保湿/,
      hooks: [
        '肌の乾燥、\n夕方になるとけっこう気になる',
        '朝のスキンケア、\n重いと続かないんよね',
        '日中の肌、\nなんか守れてる感ほしい',
      ],
      benefits: [
        '毎日の肌ケアに取り入れやすい',
        'ベタつきにくくて朝も使いやすい',
        '乾燥対策を続けやすい',
      ],
    },
    {
      pattern: /ヘア|髪|シャンプー|トリートメント|ヘアオイル|ドライヤー/,
      hooks: [
        '朝の髪、\nまとまらないだけで詰む',
        '髪のパサつき、\n地味にテンション下がる',
        'お風呂上がり、\n髪ケアまで手が回らん',
      ],
      benefits: [
        '朝の支度がちょっとラクになる',
        '髪のケアを続けやすい',
        'まとまり感を足しやすい',
      ],
    },
    {
      pattern: /猫|ねこ|キャット|犬|いぬ|ドッグ|ペット|おやつ|フード|餌|ごはん/,
      hooks: [
        'ペットのごはん、\n切らすとほんと焦る',
        'いつものフード、\nストックあるだけで安心',
        'ペット用品、\n気づいたら減ってる',
      ],
      benefits: [
        '毎日のごはん準備が少し安心',
        'まとめて置けて買い足しがラク',
        'いつものストック用にちょうどいい',
      ],
    },
    {
      pattern: /ヒーター|発熱|電熱|防寒|あったか|暖か|温熱|ベスト|毛布|カイロ/,
      hooks: [
        '寒い日の外出、\n着込んでもまだ寒い',
        '朝の冷え込み、\nほんと動きたくなくなる',
        '冬の作業、\n体が冷えるとしんどい',
      ],
      benefits: [
        '寒い日の外出が少しラクになる',
        '冷えやすい場面で使いやすい',
        '外でも暖かさを足しやすい',
      ],
    },
    {
      pattern: /モバイルバッテリー|充電|バッテリー|急速充電|充電器|ケーブル/,
      hooks: [
        '外出中の充電切れ、\nあれ本当に焦る',
        'スマホの残量、\n夕方に見るのこわい',
        '旅行の日、\n充電まわりが不安すぎる',
      ],
      benefits: [
        '外出先の電池切れ対策になる',
        'バッグに入れておくと安心',
        '移動中も充電しやすい',
      ],
    },
    {
      pattern: /だし|出汁|鰹|かつお|昆布|惣菜|肉|魚|米|スイーツ|お菓子|食品|冷凍|麺/,
      hooks: [
        'ごはん作る日、\n味つけ考えるの地味に大変',
        '料理めんどい日、\nちゃんとおいしくしたい',
        '毎日のごはん、\n手間は減らしたい',
      ],
      benefits: [
        'いつもの料理に使いやすい',
        '手間少なめで満足感を足せる',
        'ごはん作りの助けになる',
      ],
    },
  ];

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

  function selectCopy(sourceText, category = 'other') {
    const source = sourceText.toLowerCase();
    return TOPIC_COPY.find(({ pattern }) => pattern.test(source))
      || CATEGORY_COPY[normalizeCategory(category)];
  }

  function buildPost(item, category = 'other', sourceText = '') {
    const copy = selectCopy(sourceText, category);
    const hook = pick(copy.hooks);
    const benefit = pick(copy.benefits);
    return `${hook}\n\n¥${Number(item.price).toLocaleString()}／${benefit}`;
  }

  function createGroqClient(apiKey) {
    const Groq = require('groq-sdk');
    return new Groq({ apiKey, timeout: 15000 });
  }

  async function analyzeCategory(item, groqClient) {
    const prompt = `楽天商品を次のカテゴリのどれか1つに分類し、JSONのみ返してください。説明文不要。
カテゴリ: beauty / household / kids / food / fashion / other
商品名:${item.name}
キャッチコピー:${item.catchcopy || ''}
価格:¥${Number(item.price).toLocaleString()}
{"category":"beauty/household/kids/food/fashion/other"}`;

    const completion = await groqClient.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.1-8b-instant',
      temperature: 0.2,
      max_tokens: 80,
    });

    const raw = (completion.choices[0]?.message?.content || '').trim();
    console.log('[get-product] category raw:', raw);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('カテゴリJSONパース失敗');
    const parsed = JSON.parse(jsonMatch[0]);
    return normalizeCategory(parsed.category);
  }

  async function shortenUrl(rawUrl) {
    try {
      const rakutenAppId = process.env.RAKUTEN_APP_ID;
      if (rakutenAppId) {
        const r = await fetch(
          `https://app.rakuten.co.jp/services/api/ShortUrl/Create/20200122?applicationId=${rakutenAppId}&url=${encodeURIComponent(rawUrl)}`
        );
        if (r.ok) { const s = (await r.json())?.shortUrl; if (s) return s; }
      }
      const r2 = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(rawUrl)}`);
      if (r2.ok) { const t = (await r2.text()).trim(); if (t.startsWith('https://')) return t; }
    } catch {}
    return rawUrl;
  }

  try {
    const proxyParams = new URLSearchParams({
      keyword: genre,
      maxPrice: maxPrice,
      hits: 20,
      sort: '-reviewCount',
    });
    const proxyRes = await fetch(`https://rakuten-gift-tool.vercel.app/api/rakuten?${proxyParams}`);
    const rakutenData = await proxyRes.json();

    if (!rakutenData.Items || rakutenData.Items.length === 0) {
      return res.status(404).json({ success: false, error: '商品が見つかりませんでした' });
    }

    const items = rakutenData.Items.slice(0, 20).map(({ Item }) => ({
      name: dedupeProductName(Item.itemName),
      catchcopy: dedupeProductName(Item.catchcopy || ''),
      price: Item.itemPrice,
      reviewCount: Item.reviewCount || 0,
      reviewAverage: Item.reviewAverage || 0,
      shop: Item.shopName,
      url: Item.affiliateUrl || Item.itemUrl,
      image: Item.mediumImageUrls?.[0]?.imageUrl || '',
    }));

    const selected = pickBest(items);
    let category = inferCategoryFromText(`${genre} ${selected.name} ${selected.catchcopy}`);
    try {
      if (groqKey) {
        const groqClient = createGroqClient(groqKey);
        category = await analyzeCategory(selected, groqClient);
      }
    } catch (err) {
      console.log('[get-product] category fallback:', err.message);
    }

    const reason = `レビュー評価${selected.reviewAverage}・${selected.reviewCount}件で自動選択`;
    const postBody = buildPost(selected, category, `${genre} ${selected.name} ${selected.catchcopy}`);
    const shortUrl = await shortenUrl(selected.url);
    const postText = trimTo140(postBody, shortUrl);

    return res.status(200).json({
      success: true,
      product: { ...selected, url: shortUrl },
      reason,
      postText,
      category,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
