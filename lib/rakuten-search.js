function buildSearchParams({ keyword = '', minPrice = 1, maxPrice = 999999, sort = '-reviewCount', hits = 30, page = 1, itemCode = '' } = {}) {
  let searchKey;
  if (itemCode) {
    searchKey = { itemCode };
  } else {
    searchKey = { keyword };
  }

  const rawParams = {
    applicationId: process.env.RAKUTEN_APPLICATION_ID || '9a9bb16b-a393-414a-ad63-ea58ecf01daa',
    accessKey: process.env.RAKUTEN_ACCESS_KEY || 'pk_utmSC6YohMKR5EE6CDCiuC06NbdYwptCTfGFsk3LZhd',
    affiliateId: process.env.RAKUTEN_AFFILIATE_ID || '534cdfaf.e35a1702.534cdfb0.c0ce9a58',
    ...searchKey,
    hits,
    page,
    minPrice,
    maxPrice,
    sort,
    format: 'json',
    imageFlag: 1,
  };

  const params = new URLSearchParams();
  Object.entries(rawParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  });
  return params;
}

async function searchRakuten(options = {}) {
  const params = buildSearchParams(options);
  const url = `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601?${params}`;
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error_description || data?.error || `Rakuten API error ${response.status}`);
  }
  return data;
}

module.exports = {
  buildSearchParams,
  searchRakuten,
};
