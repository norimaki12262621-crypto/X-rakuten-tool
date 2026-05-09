module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!url) return res.status(400).json({ success: false, error: 'URLを指定してください' });

  // 楽天URLからshopCode・itemCodeを抽出
  let shopCode, itemCode;
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (u.hostname.includes('item.rakuten.co.jp') && parts.length >= 2) {
      shopCode = parts[0];
      itemCode = parts[1];
    } else {
      return res.status(400).json({ success: false, error: '楽天商品ページのURLを入力してください（例: https://item.rakuten.co.jp/shop/item/）' });
    }
  } catch(e) {
    return res.status(400).json({ success: false, error: '無効なURLです' });
  }

  try {
    // rakuten-gift-tool プロキシ経由で商品を検索
    const keyword = itemCode.replace(/-/g, ' ').substring(0, 30);
    const proxyParams = new URLSearchParams({ keyword, hits: 20, sort: '-reviewCount' });
    const proxyRes = await fetch(`https://rakuten-gift-tool.vercel.app/api/rakuten?${proxyParams}`);
    const rakutenData = await proxyRes.json();

    const rawItems = (rakutenData.Items || []).map(i => i.Item || i);
    if (!rawItems.length) return res.status(404).json({ success: false, error: '商品が見つかりませんでした' });

    // shopCode一致で絞り込み、なければ先頭
    const matched = rawItems.find(i => i.shopCode === shopCode) || rawItems[0];

    const affiliateId = '534cdfaf.e35a1702.534cdfb0.c0ce9a58';
    const affUrl = `https://hb.afl.rakuten.co.jp/hgc/${affiliateId}/?pc=${encodeURIComponent(matched.itemUrl)}&m=${encodeURIComponent(matched.itemUrl)}`;

    const item = {
      name: matched.itemName,
      price: matched.itemPrice,
      reviewCount: matched.reviewCount || 0,
      reviewAverage: matched.reviewAverage || 0,
      shop: matched.shopName,
      url: affUrl,
      image: matched.mediumImageUrls?.[0]?.imageUrl || '',
    };

    // Gemini で投稿文生成（responseMimeType で JSON を強制）
    const prompt = `あなたは楽天市場のアフィリエイターです。以下の商品情報を元に、Xに投稿するバズる文章を生成してください。

商品名: ${item.name}
価格: ¥${Number(item.price).toLocaleString()}
レビュー評価: ${item.reviewAverage}（${item.reviewCount}件）
ショップ: ${item.shop}
URL: ${item.url}

以下のJSON形式で回答してください:
{
  "postText": "Xに投稿する文章（280字以内、絵文字あり、商品名・価格・魅力・URLを含む、ハッシュタグ2〜3個）",
  "reason": "この商品を選んだ理由（50字以内）"
}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1000,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    const geminiData = await geminiRes.json();
    if (geminiData.error) throw new Error(`Gemini: ${geminiData.error.message}`);

    const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch(e) {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Gemini応答のパースに失敗しました');
      parsed = JSON.parse(m[0]);
    }

    return res.status(200).json({
      success: true,
      product: item,
      reason: parsed.reason || '',
      postText: parsed.postText || '',
    });

  } catch(err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
