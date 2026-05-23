module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '人気 おすすめ', maxPrice = 10000 } = req.query;
  const geminiKey = process.env.GEMINI_API_KEY;

  // Twitter 換算文字数（URL = 23 字換算）
  function twitterCount(text) {
    const urls = text.match(/https?:\/\/\S+/g) || [];
    const urlActual = urls.reduce((s, u) => s + [...u].length, 0);
    return [...text].length - urlActual + urls.length * 23;
  }

  function trimTo140(body, url) {
    let postText = `${body}\n${url}`;
    for (const idx of [1, 0]) {
      while (twitterCount(postText) > 140) {
        const parts = body.split('\n');
        if (!parts[idx] || [...parts[idx]].length === 0) break;
        parts[idx] = [...parts[idx]].slice(0, -1).join('');
        body = parts.join('\n');
        postText = `${body}\n${url}`;
      }
    }
    return postText;
  }

  // スコアで最良商品を選ぶ（Geminiフォールバック用）
  function pickBest(items) {
    return items.slice().sort((a, b) => {
      const sa = (b.reviewAverage * 18) + Math.min(b.reviewCount / 8, 22);
      const sb = (a.reviewAverage * 18) + Math.min(a.reviewCount / 8, 22);
      return sa - sb;
    })[0] || items[0];
  }

  function fallbackPost(item) {
    const hooks = [
      'これ知らないと損すぎる😱', 'え、まだ買ってないの？🔥',
      '買わなきゃ後悔する神アイテム✨', 'コスパおかしすぎる件🫢',
    ];
    const line1 = hooks[Math.floor(Math.random() * hooks.length)];
    const priceStr = `¥${Number(item.price).toLocaleString()}`;
    const line2 = `${priceStr}／${item.name.slice(0, 30)}`;
    return `${line1}\n${line2}`;
  }

  try {
    // rakuten-gift-tool をプロキシとして楽天APIデータを取得
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
      name: Item.itemName.slice(0, 60),
      price: Item.itemPrice,
      reviewCount: Item.reviewCount || 0,
      reviewAverage: Item.reviewAverage || 0,
      shop: Item.shopName,
      url: Item.affiliateUrl || Item.itemUrl,
      image: Item.mediumImageUrls?.[0]?.imageUrl || '',
    }));

    // URL 短縮ヘルパー（Gemini処理前後どちらからも呼ぶ）
    async function shortenUrl(rawUrl) {
      try {
        const rakutenAppId = process.env.RAKUTEN_APP_ID;
        if (rakutenAppId) {
          const r = await fetch(
            `https://app.rakuten.co.jp/services/api/ShortUrl/Create/20200122?applicationId=${rakutenAppId}&url=${encodeURIComponent(rawUrl)}`
          );
          if (r.ok) { const s = (await r.json())?.shortUrl; if (s) return s; }
        } else {
          const r = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(rawUrl)}`);
          if (r.ok) { const t = (await r.text()).trim(); if (t.startsWith('https://')) return t; }
        }
      } catch {}
      return rawUrl;
    }

    let selected, reason, postBody;

    try {
      if (!geminiKey) throw new Error('GEMINI_API_KEY未設定');

      const prompt = `あなたは楽天市場のアフィリエイターです。
以下の商品リストから、Xポストで最もバズりやすい商品を1つ選んでください。
選定基準：レビュー数が多い、レビュー評価が高い(4.0以上優先)、価格がコスパ良さそう
商品リスト：
${JSON.stringify(items, null, 2)}
以下のJSON形式のみで回答してください：
{
  "selectedIndex": 選んだ商品のインデックス番号(0始まり),
  "reason": "選んだ理由（日本語で50字以内）",
  "postText": "【必ず2行のみ】1行目:絵文字1〜2個＋思わず目が止まるキャッチコピー(40字以内)／2行目:商品の魅力と価格を自然な文章で(65字以内)。URLもハッシュタグも含めない。"
}`;

      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 1000 }
        }),
      });

      const geminiData = await geminiRes.json();
      if (geminiData.error) throw new Error(`Gemini APIエラー(${geminiData.error.code})`);
      const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Gemini応答のパースに失敗');
      const parsed = JSON.parse(jsonMatch[0]);
      selected = items[parsed.selectedIndex] || items[0];
      reason = parsed.reason || '';
      postBody = (parsed.postText || '').replace(/https?:\/\/\S+/g, '').trim();
      const ls = postBody.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      postBody = ls.slice(0, 2).join('\n');

    } catch (geminiErr) {
      // Gemini失敗 → スコアで最良商品を自動選択してフォールバックテキスト生成
      console.log('[get-product] Gemini failed, using fallback:', geminiErr.message);
      selected = pickBest(items);
      reason = `レビュー評価${selected.reviewAverage}・${selected.reviewCount}件で自動選択`;
      postBody = fallbackPost(selected);
    }

    const shortUrl = await shortenUrl(selected.url);
    const postText = trimTo140(postBody, shortUrl);

    return res.status(200).json({
      success: true,
      product: { ...selected, url: shortUrl },
      reason,
      postText,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
