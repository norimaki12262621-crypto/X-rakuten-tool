function resolveApplicationId({ preferLegacy = false } = {}) {
  if (preferLegacy) {
    return process.env.RAKUTEN_APP_ID || process.env.RAKUTEN_APPLICATION_ID || '9a9bb16b-a393-414a-ad63-ea58ecf01daa';
  }
  return process.env.RAKUTEN_APPLICATION_ID || process.env.RAKUTEN_APP_ID || '9a9bb16b-a393-414a-ad63-ea58ecf01daa';
}

function buildSearchParams({ keyword = '', minPrice = 1, maxPrice = 999999, sort = '-reviewCount', hits = 30, page = 1, itemCode = '' } = {}, { includeAccessKey = true, preferLegacy = false } = {}) {
  let searchKey;
  if (itemCode) {
    searchKey = { itemCode };
  } else {
    searchKey = { keyword };
  }

  const rawParams = {
    applicationId: resolveApplicationId({ preferLegacy }),
    accessKey: includeAccessKey ? (process.env.RAKUTEN_ACCESS_KEY || 'pk_utmSC6YohMKR5EE6CDCiuC06NbdYwptCTfGFsk3LZhd') : '',
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

async function requestRakuten(url) {
  const response = await fetch(url);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error_description: text.slice(0, 200) };
  }

  if (!response.ok) {
    const detail = data?.error_description || data?.error || text.slice(0, 200) || `Rakuten API error ${response.status}`;
    const err = new Error(`${detail} (${response.status})`);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

async function searchRakuten(options = {}) {
  const openApiParams = buildSearchParams(options, { includeAccessKey: true });
  const openApiUrl = `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601?${openApiParams}`;

  try {
    return await requestRakuten(openApiUrl);
  } catch (err) {
    if (![400, 403].includes(err.status)) {
      throw err;
    }

    const legacyParams = buildSearchParams(options, { includeAccessKey: false, preferLegacy: true });
    const legacyUrl = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706?${legacyParams}`;
    try {
      return await requestRakuten(legacyUrl);
    } catch (legacyErr) {
      throw new Error(`openapi: ${err.message} / legacy: ${legacyErr.message}`);
    }
  }
}

module.exports = {
  buildSearchParams,
  searchRakuten,
};
