module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  const { keyword, minPrice, maxPrice, sort, hits, itemCode } = req.query;

  const params = new URLSearchParams({
    applicationId: '9a9bb16b-a393-414a-ad63-ea58ecf01daa',
    accessKey: 'pk_utmSC6YohMKR5EE6CDCiuC06NbdYwptCTfGFsk3LZhd',
    affiliateId: '534cdfaf.e35a1702.534cdfb0.c0ce9a58',
    ...(itemCode ? { itemCode } : { keyword: keyword || '' }),
    hits: hits || 30,
    minPrice: minPrice || 1,
    maxPrice: maxPrice || 999999,
    sort: sort || '-reviewCount',
    format: 'json',
    imageFlag: 1,
  });

  const url = `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601?${params}`;

  try {
    const r = await fetch(url, {
      headers: {
        'Origin': 'https://x-rakuten-tool.vercel.app',
        'Referer': 'https://x-rakuten-tool.vercel.app/',
      }
    });
    const data = await r.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
