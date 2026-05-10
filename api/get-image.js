export const config = { runtime: 'edge' };

async function followRedirects(startUrl, timeoutMs = 12000) {
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

export default async function handler(request) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: corsHeaders });

  if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  if (!url) return json({ success: false, error: 'URL required' }, 400);

  try {
    let itemUrl = url;
    const u = new URL(url);

    if (u.hostname === 'a.r10.to') {
      itemUrl = await followRedirects(url);
    }

    const itemU = new URL(itemUrl);
    if (itemU.hostname.includes('hb.afl.rakuten.co.jp')) {
      const pc = itemU.searchParams.get('pc');
      if (pc) itemUrl = decodeURIComponent(pc);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let html = '';
    try {
      const resp = await fetch(itemUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
          'Referer': 'https://www.rakuten.co.jp/',
        },
        signal: controller.signal,
      });
      html = await resp.text();
    } finally {
      clearTimeout(timer);
    }

    // me_img_src JS variable (e.g. me_img_src: "..." or me_img_src = "...")
    const meMatch = html.match(/["']?me_img_src["']?\s*[=:]\s*["']([^"']+)["']/);
    // og:image fallback
    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);

    const imageUrl = meMatch?.[1] || ogMatch?.[1] || '';

    return json({ success: true, imageUrl, finalUrl: itemUrl });
  } catch (err) {
    return json({ success: false, error: err.message }, 500);
  }
}
