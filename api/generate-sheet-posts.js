const Groq = require('groq-sdk');
const { google } = require('googleapis');

const SMART_MODEL = process.env.GROQ_SMART_MODEL || 'llama-3.3-70b-versatile';
const SHEET_RANGE = 'Sheet1';
const MAX_BATCH   = 5;

// Column indices (0-based)
const C = {
  STATUS: 1, EMOTION_CAT: 2, NAME: 4, PRICE: 5, URL: 6,
  EMOTION: 18, PAIN: 19, SEASON: 20, ANGLE: 21, SCENE: 22,
  HOOKS: 23, DRAFT: 24, FINAL: 25,
};

function getSheetsClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key   = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const id    = process.env.GOOGLE_SHEET_ID;
  if (!email || !key || !id) throw new Error('Google Sheets環境変数が未設定です');
  const auth = new google.auth.JWT(email, null, key, ['https://www.googleapis.com/auth/spreadsheets']);
  return { sheets: google.sheets({ version: 'v4', auth }), sheetId: id };
}

function twitterCount(text) {
  const urls = text.match(/https?:\/\/\S+/g) || [];
  const urlActual = urls.reduce((s, u) => s + [...u].length, 0);
  return [...text].length - urlActual + urls.length * 23;
}

function trimTo140(body, url) {
  let postText = `${body}\n${url}`;
  if (twitterCount(postText) <= 140) return postText;
  const lines = body.split('\n');
  for (let i = lines.length - 1; i >= 0 && twitterCount(postText) > 140; i--) {
    while (twitterCount(postText) > 140 && [...(lines[i] || '')].length > 0) {
      lines[i] = [...lines[i]].slice(0, -1).join('');
      body = lines.join('\n');
      postText = `${body}\n${url}`;
    }
  }
  return postText;
}

async function analyzeProduct(item, groqClient) {
  const src = `${(item.name || '').slice(0, 40)} ${(item.catchcopy || '').slice(0, 30)}`.trim();
  const prompt = `楽天商品のX投稿向け感情分析。JSONのみ返せ。説明文不要。
商品:${src}
¥${Number(item.price).toLocaleString()}
感情カテゴリ:${item.emotionCategory || ''}

禁止:楽天で人気/高評価/今話題/購入はこちら/説明口調/商品名コピペ/特別感がある/高級感がある/便利/使える/喜ばれる/おすすめ/幸せな気分/レビュー口調/〜が変わった/〜が正解/〜すぎる/〜してよかった/教える口調/まとめる/結論を書く
重視:一言感情/日常の一瞬/余韻/未完成感/あるある/生活ノイズ感/感情だけ置いて終わる

HOOKは短い独り言。感情だけ置いて終わる。140字ギリギリまで埋めなくていい。
HOOKの良い例:「今日なんか髪まとまる」「疲れてる時こういうのに弱い」「机だけちょっとかわいい」「朝ラクだと助かる」

sceneは1〜2行。未完成でいい。感情の切り抜きだけ。
sceneの良い例:「お風呂後\\nこれないと無理」「冷蔵庫開けるたびちょっと嬉しい」

出力:
- hooks:Xで流れてくる独り言風HOOK×5案(商品名コピペ禁止/\\n改行OK/各30字以内)
- emotion:感情タグ(10字以内)
- pain:悩みタグ(10字以内)
- season:季節タグ(8字以内)
- angle:投稿切り口(10字以内)
- scene:情景＋小さな感情(\\n改行/合計30字以内/説明なし/独り言)
- xScore:Xバズ適性0-100

{"hooks":["...\\n...","...","...","...","..."],"emotion":"...","pain":"...","season":"...","angle":"...","scene":"...\\n...","xScore":78}`;

  const completion = await groqClient.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: SMART_MODEL, temperature: 0.85, max_tokens: 500,
  });
  const raw = (completion.choices[0]?.message?.content || '').trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('JSONパース失敗: ' + raw.slice(0, 80));
  return JSON.parse(m[0]);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const groqKey = process.env.GROQ_API_KEY?.replace(/^﻿/, '').trim();
  if (!groqKey) return res.status(500).json({ success: false, error: 'GROQ_API_KEY未設定' });

  try {
    const client = getSheetsClient();

    // 1. 全行取得
    const r = await client.sheets.spreadsheets.values.get({
      spreadsheetId: client.sheetId, range: `${SHEET_RANGE}!A:AB`,
    });
    const rows = r.data.values || [];
    if (rows.length <= 1) return res.status(200).json({ success: true, count: 0, message: '対象行なし' });

    // 2. 未生成行を抽出 (状態=未確認 && 最終投稿文が空)
    const targets = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if ((row[C.STATUS] || '') === '未確認' && !(row[C.FINAL] || '')) {
        targets.push({ rowIndex: i + 1, row });
      }
      if (targets.length >= MAX_BATCH) break;
    }
    if (!targets.length) {
      return res.status(200).json({ success: true, count: 0, message: '未生成の行がありません' });
    }

    // 3. AI分析 & 投稿文生成
    const groq = new Groq({ apiKey: groqKey, timeout: 20000 });
    let count = 0;

    for (const { rowIndex, row } of targets) {
      try {
        const item = {
          name:            row[C.NAME] || '',
          price:           row[C.PRICE] || 0,
          emotionCategory: row[C.EMOTION_CAT] || '',
          url:             row[C.URL] || '',
        };
        const analysis = await analyzeProduct(item, groq);
        const mainHook  = analysis.hooks?.[0] || '';
        const scene     = analysis.scene || '';
        const priceStr  = `¥${Number(item.price).toLocaleString()}`;
        let body = mainHook;
        if (scene) body += `\n\n${scene}`;
        body += `\n\n${priceStr}`;
        const postText = item.url ? trimTo140(body, item.url) : body;

        // 4. 行を更新
        const updated = [...row];
        while (updated.length < 28) updated.push('');
        updated[C.STATUS]  = '投稿文生成済み';
        updated[C.EMOTION] = analysis.emotion || '';
        updated[C.PAIN]    = analysis.pain || '';
        updated[C.SEASON]  = analysis.season || '';
        updated[C.ANGLE]   = analysis.angle || '';
        updated[C.SCENE]   = analysis.scene || '';
        updated[C.HOOKS]   = (analysis.hooks || []).join(' / ');
        updated[C.DRAFT]   = postText;
        updated[C.FINAL]   = postText;

        await client.sheets.spreadsheets.values.update({
          spreadsheetId: client.sheetId,
          range: `${SHEET_RANGE}!A${rowIndex}:AB${rowIndex}`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [updated] },
        });
        count++;
        console.log(`[generate-sheet-posts] row ${rowIndex}: ${item.name.slice(0, 20)}`);
      } catch (e) {
        console.error(`[generate-sheet-posts] row ${rowIndex} error:`, e.message);
      }
    }

    const remaining = targets.length - count;
    return res.status(200).json({
      success: true, count,
      message: `${count}件の投稿文を生成しました`,
      remaining,
    });

  } catch (err) {
    console.error('[generate-sheet-posts]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
