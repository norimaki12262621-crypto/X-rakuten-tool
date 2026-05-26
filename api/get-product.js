const Groq = require('groq-sdk');
const FAST_MODEL  = process.env.GROQ_FAST_MODEL  || 'llama-3.1-8b-instant';
const SMART_MODEL = process.env.GROQ_SMART_MODEL || 'llama-3.3-70b-versatile';
const { inferMacroCategory, normalizeMacroCategory, buildPost } = require('./_categories');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { genre = '人気 おすすめ', maxPrice = 10000 } = req.query;
  const groqKey = process.env.GROQ_API_KEY?.replace(/^﻿/, '').trim();

  function dedupeProductName(name) {
    let cleaned = (name || '')
      .replace(/【[^】]*】/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/ポイント\s*最大?\d+倍?/g, '')
      .replace(/お買い物マラソン\s*\d+\/\d+\s*\d+:\d+\s*[~～-]\s*\d+\/\d+\s*\d+:\d+/g, '')
      .replace(/楽天ランキング\d+位/g, '')
      .replace(/選べる！?|楽天限定|送料無料|公式|SALE|セール|超人気|最強|高評価/g, '')
      .replace(/[★☆]+/g, ' ');
    const tokens = cleaned.split(/[\s　]+/).filter(t => t.length > 0);
    const seen = new Set();
    const deduped = tokens.filter(t => {
      const key = t.toLowerCase();
      if (t.length >= 3 && seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return deduped.join(' ').replace(/^[\s・\/]+|[\s・\/]+$/g, '').slice(0, 50);
  }

  function twitterCount(text) {
    const urls = text.match(/https?:\/\/\S+/g) || [];
    const urlActual = urls.reduce((s, u) => s + [...u].length, 0);
    return [...text].length - urlActual + urls.length * 23;
  }

  function trimTo140(body, url) {
    let postText = `${body}\n${url}`;
    const lines = body.split('\n');
    for (let idx = lines.length - 1; idx >= 0; idx--) {
      while (twitterCount(postText) > 140) {
        if (!lines[idx] || [...lines[idx]].length === 0) break;
        lines[idx] = [...lines[idx]].slice(0, -1).join('');
        body = lines.join('\n');
        postText = `${body}\n${url}`;
      }
    }
    return postText;
  }

  function jsScore(item) {
    let score = 0;
    score += Math.min((item.reviewAverage / 5) * 25, 25);
    score += Math.min(item.reviewCount / 10, 20);
    const p = Number(item.price);
    if (p >= 500 && p <= 8000) score += 15;
    else if (p >= 300 && p <= 15000) score += 8;
    if (/嬉しい|感動|ときめく|最高|幸せ|楽しい|かわいい|可愛い|癒し|ほっこり|温かい|やさしい/.test(item.name + item.catchcopy)) score += 15;
    if (/バズ|話題|人気|おすすめ|注目|神|爆売|トレンド|定番|リピ|リピート/.test(item.name + item.catchcopy)) score += 15;
    if (/春|夏|秋|冬|梅雨|旬|限定|新生活|母の日|父の日|クリスマス|バレンタイン|お歳暮|お中元/.test(item.name + item.catchcopy)) score += 10;
    return Math.min(score, 100);
  }

  async function smartScore(items, groqClient) {
    const payload = items.map((it, i) => ({
      i,
      n: it.name.slice(0, 40),
      c: (it.catchcopy || '').slice(0, 30),
      p: it.price,
    }));
    const prompt = `楽天商品リストをXバズ適性でスコアリング。JSONのみ返せ。説明不要。
各商品を0-100でスコア。評価軸:スクロール止まり・共感・感情・悩み解決・衝動価格帯・独り言変換しやすさ
商品:${JSON.stringify(payload)}
返却形式:[{"i":0,"s":75},{"i":1,"s":82},...]`;

    const completion = await groqClient.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: SMART_MODEL,
      temperature: 0.3,
      max_tokens: 150,
    });

    const raw = (completion.choices[0]?.message?.content || '').trim();
    console.log('[get-product] smartScore raw:', raw);
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('smartScore JSONパース失敗');
    return JSON.parse(jsonMatch[0]);
  }

  async function analyzeCategory(item, groqClient) {
    const prompt = `楽天商品を次の大カテゴリのどれか1つに分類し、JSONのみ返してください。説明文不要。
カテゴリ: beauty / rainy / gift / home / gadget / pet / food / kids / fashion / other
beauty=美容・スキンケア・ヘアケア / rainy=傘・防水・梅雨 / gift=ギフト・プレゼント・記念日
home=収納・掃除・キッチン / gadget=家電・充電・イヤホン / pet=ペット用品
food=食品・グルメ / kids=子ども・ベビー / fashion=服・バッグ
商品名:${item.name}
キャッチコピー:${item.catchcopy || ''}
価格:¥${Number(item.price).toLocaleString()}
{"category":"beauty/rainy/gift/home/gadget/pet/food/kids/fashion/other"}`;

    const completion = await groqClient.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: FAST_MODEL,
      temperature: 0.2,
      max_tokens: 80,
    });

    const raw = (completion.choices[0]?.message?.content || '').trim();
    console.log('[get-product] category raw:', raw);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('カテゴリJSONパース失敗');
    return normalizeMacroCategory(JSON.parse(jsonMatch[0]).category);
  }

  async function shortenUrl(rawUrl) {
    try {
      const rakutenAppId = process.env.RAKUTEN_APP_ID;
      if (rakutenAppId) {
        const r = await fetch(
          `https://app.rakuten.co.jp/services/api/ShortUrl/Create/20200122?applicationId=${rakutenAppId}&url=${encodeURIComponent(rawUrl)}`
        );
        if (r.ok) { const s = (await r.json())?.shortUrl; if (s) return s; }
      }
      const r2 = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(rawUrl)}`);
      if (r2.ok) { const t = (await r2.text()).trim(); if (t.startsWith('https://')) return t; }
    } catch {}
    return rawUrl;
  }

  try {
    const proxyParams = new URLSearchParams({
      keyword: genre,
      maxPrice: maxPrice,
      hits: 20,
      sort: '-reviewCount',
    });
    const proxyRes = await fetch(`https://rakuten-gift-tool.vercel.app/api/rakuten?${proxyParams}`);
    const rakutenData = await proxyRes.json();

    if (!rakutenData.Items || rakutenData.Items.length === 0) {
      return res.status(404).json({ success: false, error: '商品が見つかりませんでした' });
    }

    const items = rakutenData.Items.slice(0, 20).map(({ Item }) => ({
      name: dedupeProductName(Item.itemName),
      catchcopy: dedupeProductName(Item.catchcopy || ''),
      price: Item.itemPrice,
      reviewCount: Item.reviewCount || 0,
      reviewAverage: Item.reviewAverage || 0,
      shop: Item.shopName,
      url: Item.affiliateUrl || Item.itemUrl,
      image: Item.mediumImageUrls?.[0]?.imageUrl || '',
    }));

    // JS一次スコアリング → 上位10件
    const jsSorted = items
      .map(it => ({ ...it, _jsScore: jsScore(it) }))
      .sort((a, b) => b._jsScore - a._jsScore)
      .slice(0, 10);

    let selected = jsSorted[0];
    let category = inferMacroCategory(`${genre} ${selected.name} ${selected.catchcopy}`);

    try {
      if (groqKey) {
        const groqClient = new Groq({ apiKey: groqKey, timeout: 15000 });
        // SMART_MODEL でXバズ適性スコアリング → 70pt以上でフィルタ
        const scores = await smartScore(jsSorted, groqClient);
        const passed = scores.filter(s => s.s >= 70).sort((a, b) => b.s - a.s);
        if (passed.length > 0) {
          selected = jsSorted[passed[0].i];
          console.log('[get-product] SMART_MODEL選択: index', passed[0].i, 'score', passed[0].s);
        } else {
          console.log('[get-product] 70pt以上なし、JS最上位を使用');
        }
        category = await analyzeCategory(selected, groqClient);
      }
    } catch (err) {
      console.log('[get-product] AI scoring fallback:', err.message);
    }

    const sourceText = `${genre} ${selected.name} ${selected.catchcopy}`;
    const reason = `JSスコア${selected._jsScore?.toFixed(0) ?? '?'}pt・レビュー${selected.reviewAverage}(${selected.reviewCount}件)で自動選択`;
    const postBody = buildPost(selected.price, sourceText);
    const shortUrl = await shortenUrl(selected.url);
    const postText = trimTo140(postBody, shortUrl);

    return res.status(200).json({
      success: true,
      product: { ...selected, url: shortUrl },
      reason,
      postText,
      category,
      jsScore: selected._jsScore ?? null,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
