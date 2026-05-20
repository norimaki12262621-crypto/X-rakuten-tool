// api/shorten-url.js  —  URL 短縮プロキシ
// RAKUTEN_APP_ID が設定されていれば Rakuten ShortURL API (a.r10.to) を使用。
// 未設定の場合は TinyURL にフォールバック。
//
// RAKUTEN_APP_ID の取得:
//   https://webservice.rakuten.co.jp/ でアプリ登録 → applicationId (数値) を取得
//   Vercel 環境変数 RAKUTEN_APP_ID にセット

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url パラメータが必要です' });

  // 1. Rakuten ShortURL API (a.r10.to)
  const rakutenAppId = process.env.RAKUTEN_APP_ID;
  if (rakutenAppId) {
    try {
      const r = await fetch(
        `https://app.rakuten.co.jp/services/api/ShortUrl/Create/20200122?applicationId=${rakutenAppId}&url=${encodeURIComponent(url)}`
      );
      if (r.ok) {
        const data = await r.json();
        const shortUrl = data?.shortUrl;
        if (shortUrl) return res.status(200).json({ shortUrl, provider: 'rakuten' });
      }
    } catch {}
  }

  // 2. TinyURL fallback
  try {
    const r = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
    if (r.ok) {
      const shortUrl = (await r.text()).trim();
      if (shortUrl.startsWith('https://')) {
        return res.status(200).json({ shortUrl, provider: 'tinyurl' });
      }
    }
  } catch {}

  // 3. 元 URL をそのまま返す
  return res.status(200).json({ shortUrl: url, provider: 'original' });
};
