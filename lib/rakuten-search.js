function buildSearchParams({ keyword = '', minPrice = 1, maxPrice = 999999, sort = '-reviewCount', hits = 30, page = 1, itemCode = '' } = {}) {
  let searchKey;
  if (itemCode) {
    const slug = itemCode.includes(':') ? itemCode.split(':')[1] : itemCode;
    searchKey = { keyword: slug };
  } else {
    searchKey = { keyword };
  }

  return new URLSearchParams({
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
  });
}

async function searchRakuten(options = {}) {
  const params = buildSearchParams(options);
  const url = `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601?${params}`;
  const response = await fetch(url, {
    headers: {
      Origin: 'https://x-rakuten-tool.vercel.app',
      Referer: 'https://x-rakuten-tool.vercel.app/',
    },
  });
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
