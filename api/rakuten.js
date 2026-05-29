const { searchRakuten } = require('../lib/rakuten-search');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { keyword, minPrice, maxPrice, sort, hits, itemCode } = req.query;

  try {
    const data = await searchRakuten({
      keyword: keyword || '',
      minPrice: minPrice || 1,
      maxPrice: maxPrice || 999999,
      sort: sort || '-reviewCount',
      hits: hits || 30,
      itemCode,
    });
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
