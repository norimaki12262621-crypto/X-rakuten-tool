module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '人気 おすすめ', maxPrice = 10000 } = req.query;
  const geminiKey = process.env.GEMINI_API_KEY;

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
    if (geminiData.error) throw new Error(`Gemini APIエラー(${geminiData.error.code}): ${geminiData.error.message?.slice(0, 100)}`);
    const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Gemini応答のパースに失敗しました');
    const parsed = JSON.parse(jsonMatch[0]);
    const selected = items[parsed.selectedIndex] || items[0];

    // URL 短縮（RAKUTEN_APP_ID あれば a.r10.to、なければ TinyURL）
    let shortUrl = selected.url;
    try {
      const rakutenAppId = process.env.RAKUTEN_APP_ID;
      if (rakutenAppId) {
        const r = await fetch(
          `https://app.rakuten.co.jp/services/api/ShortUrl/Create/20200122?applicationId=${rakutenAppId}&url=${encodeURIComponent(selected.url)}`
        );
        if (r.ok) shortUrl = (await r.json())?.shortUrl || shortUrl;
      } else {
        const r = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(selected.url)}`);
        if (r.ok) { const t = (await r.text()).trim(); if (t.startsWith('https://')) shortUrl = t; }
      }
    } catch {}

    // postText を2行に正規化してURLを3行目に結合
    let body = (parsed.postText || '').replace(/https?:\/\/\S+/g, '').trim();
    const ls = body.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    body = ls.slice(0, 2).join('\n');
    let postText = `${body}\n${shortUrl}`;

    // Twitter 換算 140 字保証（URL = 23 字換算）
    const twitterCount = (text) => {
      const urls = text.match(/https?:\/\/\S+/g) || [];
      const urlActual = urls.reduce((s, u) => s + [...u].length, 0);
      return [...text].length - urlActual + urls.length * 23;
    };
    for (const idx of [1, 0]) {
      while (twitterCount(postText) > 140) {
        const parts = body.split('\n');
        if (!parts[idx] || [...parts[idx]].length === 0) break;
        parts[idx] = [...parts[idx]].slice(0, -1).join('');
        body = parts.join('\n');
        postText = `${body}\n${shortUrl}`;
      }
    }

    return res.status(200).json({
      success: true,
      product: { ...selected, url: shortUrl },
      reason: parsed.reason,
      postText,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
