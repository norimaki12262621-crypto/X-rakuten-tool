const https = require('https');
const http = require('http');

function followRedirects(startUrl, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(Object.assign(new Error('timeout'), { name: 'AbortError' })),
      timeoutMs
    );
    function hop(url, count) {
      if (count > 10) { clearTimeout(deadline); return resolve(url); }
      const lib = url.startsWith('https:') ? https : http;
      const req = lib.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
        },
      }, (res) => {
        res.resume();
        const { statusCode, headers } = res;
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          const loc = headers.location;
          const next = /^https?:\/\//.test(loc) ? loc : new URL(loc, url).href;
          hop(next, count + 1);
        } else {
          clearTimeout(deadline);
          resolve(url);
        }
      });
      req.on('error', (err) => { clearTimeout(deadline); reject(err); });
    }
    hop(startUrl, 0);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!url) return res.status(400).json({ success: false, error: 'URLを指定してください' });

  let shopCode, itemCode;
  try {
    const u = new URL(url);
    let itemUrl = url;

    // a.r10.to 短縮URLをhttpsモジュールでリダイレクト展開（fetch/undiciはVercelでブロックされるため）
    if (u.hostname === 'a.r10.to') {
      try {
        itemUrl = await followRedirects(url);
        if (new URL(itemUrl).hostname === 'a.r10.to') {
          return res.status(400).json({ success: false, error: 'a.r10.toのURLを展開できませんでした。URLを再確認してください' });
        }
      } catch(expandErr) {
        const msg = expandErr.name === 'AbortError'
          ? 'a.r10.toのURL展開がタイムアウトしました。しばらくしてから再度お試しください'
          : 'a.r10.toのURL展開に失敗しました: ' + expandErr.message;
        return res.status(400).json({ success: false, error: msg });
      }
    } else if (u.hostname.includes('hb.afl.rakuten.co.jp')) {
      const pc = u.searchParams.get('pc');
      if (!pc) return res.status(400).json({ success: false, error: 'アフィリエイトURLのpcパラメータが見つかりません' });
      itemUrl = decodeURIComponent(pc);
    }

    // 展開後もアフィリエイトURLの場合はpcパラメータを抽出
    const expandedU = new URL(itemUrl);
    if (expandedU.hostname.includes('hb.afl.rakuten.co.jp')) {
      const pc = expandedU.searchParams.get('pc');
      if (pc) itemUrl = decodeURIComponent(pc);
    }

    const itemU = new URL(itemUrl);
    const parts = itemU.pathname.split('/').filter(Boolean);
    if (itemU.hostname.includes('item.rakuten.co.jp') && parts.length >= 2) {
      shopCode = parts[0];
      itemCode = parts[1];
    } else {
      return res.status(400).json({ success: false, error: '楽天商品ページのURLを入力してください' });
    }
  } catch(e) {
    return res.status(400).json({ success: false, error: '無効なURLです' });
  }

  try {
    const keyword = itemCode.replace(/-/g, ' ').substring(0, 30);
    const proxyParams = new URLSearchParams({ keyword, hits: 20, sort: '-reviewCount' });
    const proxyRes = await fetch(`https://rakuten-gift-tool.vercel.app/api/rakuten?${proxyParams}`);
    const rakutenData = await proxyRes.json();

    const rawItems = (rakutenData.Items || []).map(i => i.Item || i);
    if (!rawItems.length) return res.status(404).json({ success: false, error: '商品が見つかりませんでした' });

    const matched = rawItems.find(i => i.shopCode === shopCode) || rawItems[0];

    const affiliateId = '534cdfaf.e35a1702.534cdfb0.c0ce9a58';
    const affUrl = `https://hb.afl.rakuten.co.jp/hgc/${affiliateId}/?pc=${encodeURIComponent(matched.itemUrl)}&m=${encodeURIComponent(matched.itemUrl)}`;

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
- postTextにはURLをそのまま含めること（プレースホルダー禁止）
- postText全体をURL込みで140文字以内に収めること
- ハッシュタグは1～2個まで
{
  "postText": "Xに投稿する文章（URL込み140文字以内、絵文字あり、商品名・価格・魅力・URL・ハッシュタグ1～2個）",
  "reason": "この商品を選んだ理由（50字以内）"
}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    );

    const geminiData = await geminiRes.json();
    if (geminiData.error) throw new Error(`Gemini: ${geminiData.error.message}`);

    const gparts = geminiData.candidates?.[0]?.content?.parts || [];
    const raw = gparts.find(p => !p.thought)?.text || gparts[gparts.length - 1]?.text || '';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch(e) {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Gemini応答のパースに失敗しました');
      parsed = JSON.parse(m[0]);
    }

    // 孤立サロゲートを除去: encodeURIComponentは孤立サロゲートでURIErrorを投げる
    // [...str]でコードポイント単位に分割することで有効な絵文字は保持される
    const sanitize = (str) => [...str].filter(c => {
      try { encodeURIComponent(c); return true; } catch(e) { return false; }
    }).join('');

    let postText = sanitize((parsed.postText || '').replace(/\\n/g, '\n'))
      .replace(/\[URL\]/g, item.url);

    // URLを末尾に付けた形式で常に140文字以内に収める
    const urlSuffix = '\n' + item.url;
    const maxBodyLen = 140 - [...urlSuffix].length;
    const urlIdx = postText.indexOf(item.url);
    let body = (urlIdx >= 0 ? postText.slice(0, urlIdx) : postText).trimEnd();
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
