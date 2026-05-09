module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!url) return res.status(400).json({ success: false, error: 'URLを指定してください' });

  // アフィリエイトURL・直接URLの両方に対応してitem.rakuten.co.jpのURLを抽出
  let shopCode, itemCode;
  try {
    const u = new URL(url);
    let itemUrl = url;

    // hb.afl.rakuten.co.jp のアフィリエイトURLの場合、pcパラメータから実URLを取得
    if (u.hostname.includes('hb.afl.rakuten.co.jp')) {
      const pc = u.searchParams.get('pc');
      if (!pc) return res.status(400).json({ success: false, error: 'アフィリエイトURLのpcパラメータが見つかりません' });
      itemUrl = decodeURIComponent(pc);
    }

    const itemU = new URL(itemUrl);
    const parts = itemU.pathname.split('/').filter(Boolean);
    if (itemU.hostname.includes('item.rakuten.co.jp') && parts.length >= 2) {
      shopCode = parts[0];
      itemCode = parts[1];
    } else {
      return res.status(400).json({ success: false, error: '楽天商品ページのURLを入力してください（例: https://item.rakuten.co.jp/shop/item/ またはアフィリエイトURL）' });
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

    // TinyURL でアフィリエイトURLを短縮
    let shortUrl = affUrl;
    try {
      const tinyRes = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(affUrl)}`);
      const tinyText = await tinyRes.text();
      if (tinyText.trim().startsWith('http')) shortUrl = tinyText.trim();
    } catch(e) {
      console.error('URL shortening failed:', e.message);
    }

    const item = {
      name: matched.itemName,
      price: matched.itemPrice,
      reviewCount: matched.reviewCount || 0,
      reviewAverage: matched.reviewAverage || 0,
      shop: matched.shopName,
      url: shortUrl,
      image: matched.mediumImageUrls?.[0]?.imageUrl || '',
    };

    const prompt = `あなたは楽天市場のアフィリエイターです。以下の商品情報を元に、Xに投稿するバズる文章を生成してください。

商品名: ${item.name}
価格: ¥${Number(item.price).toLocaleString()}
レビュー評価: ${item.reviewAverage}（${item.reviewCount}件）
ショップ: ${item.shop}
URL: ${item.url}

以下のJSON形式のみで回答してください。
- postTextにはURLをそのまま含めること（[URL]などのプレースホルダー禁止）
- postText全体をURL込みで140文字以内に収めること
- ハッシュタグは1〜2個まで
{
  "postText": "Xに投稿する文章（URL込み140文字以内、絵文字あり、商品名・価格・魅力・URL・ハッシュタグ1〜2個）",
  "reason": "この商品を選んだ理由（50字以内）"
}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 512,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    );

    const geminiData = await geminiRes.json();
    if (geminiData.error) throw new Error(`Gemini: ${geminiData.error.message}`);

    const parts = geminiData.candidates?.[0]?.content?.parts || [];
    const raw = parts.find(p => !p.thought)?.text || parts[parts.length - 1]?.text || '';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch(e) {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Gemini応答のパースに失敗しました');
      parsed = JSON.parse(m[0]);
    }

    // Geminiがリテラル\nを返す場合があるので実際の改行に正規化してから処理
    let postText = (parsed.postText || '')
      .replace(/\\n/g, '\n')
      .replace(/\[URL\]/g, item.url);

    // URLを末尾に付けた形で常に140文字以内に収める
    const LIMIT = 140;
    const urlSuffix = '\n' + item.url;
    const urlSuffixLen = [...urlSuffix].length;
    const maxBodyLen = LIMIT - urlSuffixLen;

    // 本文からURLを除去（indexOf で位置を特定してslice）
    const urlIdx = postText.indexOf(item.url);
    let body = (urlIdx >= 0 ? postText.slice(0, urlIdx) : postText).trimEnd();

    // 本文が長い場合は切り詰め
    const bodyChars = [...body];
    if (bodyChars.length > maxBodyLen) {
      body = bodyChars.slice(0, maxBodyLen).join('').trimEnd();
    }

    postText = body + urlSuffix;

    return res.status(200).json({
      success: true,
      product: item,
      reason: parsed.reason || '',
      postText,
    });

  } catch(err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
