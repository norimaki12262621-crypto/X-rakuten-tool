async function followRedirects(startUrl, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = startUrl;
    for (let hop = 0; hop < 10; hop++) {
      const resp = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
        },
        signal: controller.signal,
      });
      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get('location');
        if (!loc) break;
        current = /^https?:\/\//.test(loc) ? loc : new URL(loc, current).href;
      } else {
        break;
      }
    }
    return current;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  const json = (data, status = 200) => res.status(status).json(data);

  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = req.query.url;
  if (!url) return json({ success: false, error: 'URLを指定してください' }, 400);

  let shopCode, itemCode;
  try {
    const u = new URL(url);
    let itemUrl = url;

    if (u.hostname === 'a.r10.to') {
      try {
        itemUrl = await followRedirects(url);
        if (new URL(itemUrl).hostname === 'a.r10.to') {
          return json({ success: false, error: 'a.r10.toのURLを展開できませんでした。URLを再確認してください' }, 400);
        }
      } catch (expandErr) {
        const msg = expandErr.name === 'AbortError'
          ? 'a.r10.toのURL展開がタイムアウトしました。しばらくしてから再度お試しください'
          : 'a.r10.toのURL展開に失敗しました: ' + expandErr.message;
        return json({ success: false, error: msg }, 400);
      }
    } else if (u.hostname.includes('hb.afl.rakuten.co.jp')) {
      const pc = u.searchParams.get('pc');
      if (!pc) return json({ success: false, error: 'アフィリエイトURLのpcパラメータが見つかりません' }, 400);
      itemUrl = decodeURIComponent(pc);
    }

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
      console.log('[get-product-url] shopCode:', shopCode);
      console.log('[get-product-url] itemCode:', itemCode);
    } else {
      return json({ success: false, error: '楽天商品ページのURLを入力してください' }, 400);
    }
  } catch (e) {
    return json({ success: false, error: '無効なURLです' }, 400);
  }

  return json({ success: true, shopCode, itemCode });
};
