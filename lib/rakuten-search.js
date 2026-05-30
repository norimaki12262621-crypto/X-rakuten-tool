const RAKUTEN_PROXY_BASE = process.env.RAKUTEN_PROXY_BASE || 'https://rakuten-gift-tool.vercel.app/api/rakuten';

function buildSearchParams({ keyword = '', minPrice = 1, maxPrice = 999999, sort = '-reviewCount', hits = 30, page = 1, itemCode = '' } = {}) {
  const searchKey = itemCode
    ? { itemCode }
    : { keyword };

  const params = new URLSearchParams({
    ...searchKey,
    hits: String(hits),
    maxPrice: String(maxPrice),
    sort,
  });

  return params;
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text.replace(/\s+/g, ' ').trim().slice(0, 180) || `Rakuten proxy error ${response.status}`);
  }
}

async function searchRakuten(options = {}) {
  const params = buildSearchParams(options);
  const url = `${RAKUTEN_PROXY_BASE}?${params}`;
  const response = await fetch(url);
  const data = await readJson(response);

  if (!response.ok || data.error || data.errors) {
    const message = data.error || data.error_description || data.errors?.errorMessage || JSON.stringify(data.errors || data).slice(0, 180);
    throw new Error(message || `Rakuten proxy error ${response.status}`);
  }

  return data;
}

module.exports = {
  buildSearchParams,
  searchRakuten,
};
