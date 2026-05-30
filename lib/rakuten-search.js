function resolveApplicationId({ preferLegacy = false } = {}) {
  if (preferLegacy) {
    return process.env.RAKUTEN_APP_ID || process.env.RAKUTEN_APPLICATION_ID || '9a9bb16b-a393-414a-ad63-ea58ecf01daa';
  }
  return process.env.RAKUTEN_APPLICATION_ID || process.env.RAKUTEN_APP_ID || '9a9bb16b-a393-414a-ad63-ea58ecf01daa';
}

function hasOpenApiCredentials() {
  const appId = process.env.RAKUTEN_APPLICATION_ID;
  const accessKey = process.env.RAKUTEN_ACCESS_KEY;
  return Boolean(appId && accessKey);
}

function hasLegacyApiCredentials() {
  const appId = process.env.RAKUTEN_APP_ID;
  return Boolean(appId && !appId.includes('-'));
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

function stripTags(html = '') {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(text = '') {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/\\u002F/g, '/')
    .replace(/\\u0026/g, '&')
    .replace(/\\u003D/g, '=');
}

function parseRakutenSearchHtml(html, { keyword, maxPrice, hits }) {
  const items = [];
  const seen = new Set();
  const decoded = decodeHtml(html);
  const linkPattern = /https?:\/\/item\.rakuten\.co\.jp\/[^"'\\<\s]+/g;
  const links = decoded.match(linkPattern) || [];

  for (const rawLink of links) {
    if (items.length >= hits) break;
    const url = rawLink.split('?')[0];
    if (seen.has(url)) continue;
    seen.add(url);

    const idx = decoded.indexOf(rawLink);
    const slice = decoded.slice(Math.max(0, idx - 2500), Math.min(decoded.length, idx + 3500));
    const titleMatch =
      slice.match(/(?:aria-label|alt|title)="([^"]{8,180})"/i) ||
      slice.match(/<h[23][^>]*>([\s\S]{8,260}?)<\/h[23]>/i);
    const imageMatch = slice.match(/https?:\/\/thumbnail\.image\.rakuten\.co\.jp\/[^"'\\<\s]+/i);
    const priceMatches = [...slice.matchAll(/[￥¥]\s*([0-9,]{2,8})/g)]
      .map(m => Number(m[1].replace(/,/g, '')))
      .filter(n => Number.isFinite(n) && n > 0 && n <= Number(maxPrice || 999999));
    const price = priceMatches[0] || '';
    const name = stripTags(decodeHtml(titleMatch?.[1] || `${keyword} 楽天商品`)).slice(0, 120);

    items.push({
      Item: {
        itemName: name,
        catchcopy: '',
        itemPrice: price || Number(maxPrice || 0) || '',
        reviewCount: 0,
        reviewAverage: 0,
        shopName: '楽天市場',
        itemUrl: url,
        affiliateUrl: url,
        mediumImageUrls: imageMatch ? [{ imageUrl: decodeHtml(imageMatch[0]) }] : [],
      },
    });
  }

  return { Items: items, source: 'rakuten-search-html' };
}

async function requestRakuten(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
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

async function searchRakutenHtmlFallback(options = {}) {
  const { keyword = '', maxPrice = 999999, hits = 30, page = 1 } = options;
  const params = new URLSearchParams({
    s: '5',
    p: String(page),
    min: String(options.minPrice || 1),
    max: String(maxPrice || 999999),
  });
  const url = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(keyword)}/?${params}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8500);
  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; X-Rakuten-Tool/1.0)',
        'Accept-Language': 'ja,en-US;q=0.8,en;q=0.6',
      },
    });
  } finally {
    clearTimeout(timeout);
  }
  const html = await response.text();
  if (!response.ok) {
    throw new Error(`rakuten html search failed (${response.status})`);
  }
  return parseRakutenSearchHtml(html, { keyword, maxPrice, hits });
}

async function searchRakuten(options = {}) {
  if (!hasOpenApiCredentials() && !hasLegacyApiCredentials()) {
    return searchRakutenHtmlFallback(options);
  }

  const openApiParams = buildSearchParams(options, { includeAccessKey: true });
  const openApiUrl = `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601?${openApiParams}`;

  try {
    if (hasOpenApiCredentials()) {
      return await requestRakuten(openApiUrl);
    }
    throw Object.assign(new Error('openapi credentials missing'), { status: 400 });
  } catch (err) {
    if (![400, 403].includes(err.status)) {
      throw err;
    }

    if (!hasLegacyApiCredentials()) {
      try {
        const htmlData = await searchRakutenHtmlFallback(options);
        if (htmlData.Items?.length) return htmlData;
      } catch (htmlErr) {
        throw new Error(`openapi: ${err.message} / html: ${htmlErr.message}`);
      }
      throw new Error(`openapi: ${err.message} / html: no items`);
    }

    const legacyParams = buildSearchParams(options, { includeAccessKey: false, preferLegacy: true });
    const legacyUrl = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706?${legacyParams}`;
    try {
      return await requestRakuten(legacyUrl);
    } catch (legacyErr) {
      try {
        const htmlData = await searchRakutenHtmlFallback(options);
        if (htmlData.Items?.length) return htmlData;
      } catch (htmlErr) {
        throw new Error(`openapi: ${err.message} / legacy: ${legacyErr.message} / html: ${htmlErr.message}`);
      }
      throw new Error(`openapi: ${err.message} / legacy: ${legacyErr.message} / html: no items`);
    }
  }
}

module.exports = {
  buildSearchParams,
  searchRakuten,
  searchRakutenHtmlFallback,
};
