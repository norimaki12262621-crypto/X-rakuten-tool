const Groq = require('groq-sdk');
const { google } = require('googleapis');
const { EMOTION_SEARCH_MAP, inferMacroCategory, CAT_LABEL } = require('./_categories');

const SMART_MODEL = process.env.GROQ_SMART_MODEL || 'llama-3.3-70b-versatile';

const HEADERS = [
  '保存日時','状態','感情カテゴリ','検索ワード','商品名','商品価格','商品URL',
  '商品画像URL','JSスコア','X適性スコア','emotionScore','impulseScore',
  'visualScore','relatabilityScore','seasonScore','xPotentialScore',
  'giftabilityScore','xProductScore','emotion','pain','season','angle',
  'scene','HOOK候補','投稿文たたき台','最終投稿文','投稿日','反応メモ',
];
const COL_URL = 6;
const SHEET_RANGE = 'Sheet1';

function getSheetsClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key   = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const id    = process.env.GOOGLE_SHEET_ID;
  if (!email || !key || !id) throw new Error('Google Sheets環境変数が未設定です (GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY)');
  const auth = new google.auth.JWT(email, null, key, ['https://www.googleapis.com/auth/spreadsheets']);
  return { sheets: google.sheets({ version: 'v4', auth }), sheetId: id };
}

async function ensureHeader({ sheets, sheetId }) {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${SHEET_RANGE}!1:1` });
  if (r.data.values?.[0]?.[0] !== '保存日時') {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId, range: `${SHEET_RANGE}!A1`,
      valueInputOption: 'USER_ENTERED', resource: { values: [HEADERS] },
    });
  }
}

async function getExistingUrls({ sheets, sheetId }) {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${SHEET_RANGE}!G:G` });
  const rows = r.data.values || [];
  return new Set(rows.slice(1).map(r => r[0]).filter(Boolean));
}

function dedupeProductName(name) {
  let cleaned = (name || '')
    .replace(/【[^】]*】/g, '').replace(/\[[^\]]*\]/g, '')
    .replace(/ポイント\s*最大?\d+倍?/g, '')
    .replace(/楽天ランキング\d+位/g, '')
    .replace(/選べる！?|楽天限定|送料無料|公式|SALE|セール|超人気|最強|高評価/g, '')
    .replace(/[★☆]+/g, ' ');
  const tokens = cleaned.split(/[\s　]+/).filter(t => t.length > 0);
  const seen = new Set();
  return tokens.filter(t => {
    const key = t.toLowerCase();
    if (t.length >= 3 && seen.has(key)) return false;
    seen.add(key); return true;
  }).join(' ').replace(/^[\s・\/]+|[\s・\/]+$/g, '').slice(0, 50);
}

function jsScore(item) {
  let score = 0;
  score += Math.min((item.reviewAverage / 5) * 25, 25);
  score += Math.min(item.reviewCount / 10, 20);
  const p = Number(item.price);
  if (p >= 500 && p <= 8000) score += 15; else if (p >= 300 && p <= 15000) score += 8;
  if (/嬉しい|感動|ときめく|最高|幸せ|楽しい|かわいい|可愛い|癒し|ほっこり|温かい|やさしい/.test(item.name + item.catchcopy)) score += 15;
  if (/バズ|話題|人気|おすすめ|注目|神|爆売|トレンド|定番|リピ|リピート/.test(item.name + item.catchcopy)) score += 15;
  if (/春|夏|秋|冬|梅雨|旬|限定|新生活|母の日|父の日|クリスマス|バレンタイン|お歳暮|お中元/.test(item.name + item.catchcopy)) score += 10;
  return Math.min(score, 100);
}

async function smartScoreBatch(items, groqClient) {
  const payload = items.map((it, i) => ({ i, n: it.name.slice(0, 40), c: (it.catchcopy || '').slice(0, 30), p: it.price }));
  const prompt = `楽天商品リストをXバズ適性でスコアリング。JSONのみ返せ。
各商品を0-100でスコア。評価軸:スクロール止まり・共感・感情・悩み解決・衝動価格帯
商品:${JSON.stringify(payload)}
返却形式:[{"i":0,"s":75},{"i":1,"s":82},...]`;
  const completion = await groqClient.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: SMART_MODEL, temperature: 0.3, max_tokens: 200,
  });
  const raw = (completion.choices[0]?.message?.content || '').trim();
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('smartScore JSONパース失敗');
  return JSON.parse(m[0]);
}

async function searchWithFallback(searches, maxPrice) {
  for (const keyword of searches) {
    try {
      const params = new URLSearchParams({ keyword, maxPrice, hits: 20, sort: '-reviewCount' });
      const r = await fetch(`https://rakuten-gift-tool.vercel.app/api/rakuten?${params}`);
      const d = await r.json();
      if (d.Items?.length > 0) {
        console.log(`[save-to-sheet] hit: "${keyword}" (${d.Items.length}件)`);
        return { rawItems: d.Items, usedKeyword: keyword };
      }
      console.log(`[save-to-sheet] miss: "${keyword}"`);
    } catch (e) {
      console.log(`[save-to-sheet] error "${keyword}":`, e.message);
    }
  }
  return { rawItems: [], usedKeyword: null };
}

async function shortenUrl(rawUrl) {
  try {
    const rakutenAppId = process.env.RAKUTEN_APP_ID;
    if (rakutenAppId) {
      const r = await fetch(`https://app.rakuten.co.jp/services/api/ShortUrl/Create/20200122?applicationId=${rakutenAppId}&url=${encodeURIComponent(rawUrl)}`);
      if (r.ok) { const s = (await r.json())?.shortUrl; if (s) return s; }
    }
    const r2 = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(rawUrl)}`);
    if (r2.ok) { const t = (await r2.text()).trim(); if (t.startsWith('https://')) return t; }
  } catch {}
  return rawUrl;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { emotionId, maxPrice = 10000 } = req.body;
  const groqKey = process.env.GROQ_API_KEY?.replace(/^﻿/, '').trim();
  const emotion = emotionId && EMOTION_SEARCH_MAP[emotionId];
  if (!emotion) return res.status(400).json({ success: false, error: '不正なemotionIdです' });

  try {
    // 1. 楽天API検索
    const { rawItems, usedKeyword } = await searchWithFallback(emotion.searches, maxPrice);
    if (!rawItems.length) {
      return res.status(404).json({ success: false, error: `「${emotion.label}」で商品が見つかりませんでした` });
    }

    // 2. JS一次スコアリング → 上位10件
    const items = rawItems.slice(0, 20).map(({ Item }) => ({
      name: dedupeProductName(Item.itemName),
      catchcopy: dedupeProductName(Item.catchcopy || ''),
      price: Item.itemPrice,
      reviewCount: Item.reviewCount || 0,
      reviewAverage: Item.reviewAverage || 0,
      shop: Item.shopName || '',
      url: Item.affiliateUrl || Item.itemUrl,
      image: Item.mediumImageUrls?.[0]?.imageUrl || '',
    }));
    const jsSorted = items.map(it => ({ ...it, _js: jsScore(it) })).sort((a, b) => b._js - a._js).slice(0, 10);

    // 3. AIバッチスコアリング → 上位5件
    let top5 = jsSorted.slice(0, 5);
    const aiScoreMap = new Map();
    if (groqKey) {
      try {
        const groq = new Groq({ apiKey: groqKey, timeout: 15000 });
        const aiScores = await smartScoreBatch(jsSorted, groq);
        aiScores.forEach(s => aiScoreMap.set(jsSorted[s.i], s.s));
        const sorted = [...aiScores].sort((a, b) => b.s - a.s);
        top5 = sorted.slice(0, 5).map(s => jsSorted[s.i]);
      } catch (e) {
        console.log('[save-to-sheet] AI score fallback:', e.message);
      }
    }

    // 4. URL短縮 (並列)
    const shortUrls = await Promise.all(top5.map(p => shortenUrl(p.url)));
    top5 = top5.map((p, i) => ({ ...p, shortUrl: shortUrls[i] }));

    // 5. シート操作
    const client = getSheetsClient();
    await ensureHeader(client);
    const existingUrls = await getExistingUrls(client);

    const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    let saved = 0, skipped = 0;
    const savedProducts = [];

    for (const p of top5) {
      if (existingUrls.has(p.shortUrl) || existingUrls.has(p.url)) {
        skipped++;
        console.log(`[save-to-sheet] skip duplicate: ${p.name.slice(0, 20)}`);
        continue;
      }
      const row = Array(HEADERS.length).fill('');
      row[0]  = now;
      row[1]  = '未確認';
      row[2]  = emotion.label;
      row[3]  = usedKeyword;
      row[4]  = p.name;
      row[5]  = p.price;
      row[6]  = p.shortUrl;
      row[7]  = p.image;
      row[8]  = p._js?.toFixed(0) ?? '';
      row[9]  = aiScoreMap.get(p) ?? '';

      await client.sheets.spreadsheets.values.append({
        spreadsheetId: client.sheetId,
        range: `${SHEET_RANGE}!A:A`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: [row] },
      });
      existingUrls.add(p.shortUrl);
      saved++;
      savedProducts.push({ name: p.name, url: p.shortUrl });
    }

    return res.status(200).json({ success: true, saved, skipped, usedKeyword, products: savedProducts });

  } catch (err) {
    console.error('[save-to-sheet]', err.message);
    let hint = err.message;
    if (err.message.includes('not found') || err.message.includes('NOT_FOUND')) {
      hint = `シートが見つかりません。原因は①か②です。①GOOGLE_SHEET_IDが間違っている（URLの /d/ と /edit の間の文字列だけを設定してください）②スプレッドシートをサービスアカウントのメールアドレス（GOOGLE_SERVICE_ACCOUNT_EMAIL）に「編集者」で共有していない。診断: https://x-rakuten-tool.vercel.app/api/debug-sheet`;
    } else if (err.message.includes('permission') || err.message.includes('PERMISSION_DENIED')) {
      hint = `権限エラー。スプレッドシートをサービスアカウントのメールアドレスに「編集者」で共有してください。診断: https://x-rakuten-tool.vercel.app/api/debug-sheet`;
    } else if (err.message.includes('invalid_grant') || err.message.includes('DECODER')) {
      hint = `private_keyが壊れています。JSONファイルから"private_key"の値を再コピーしてVercelに設定し直してください。診断: https://x-rakuten-tool.vercel.app/api/debug-sheet`;
    } else if (err.message.includes('環境変数')) {
      hint = `${err.message} 診断: https://x-rakuten-tool.vercel.app/api/debug-sheet`;
    }
    return res.status(500).json({ success: false, error: hint });
  }
};
