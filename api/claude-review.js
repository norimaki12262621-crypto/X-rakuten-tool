const Anthropic = require('@anthropic-ai/sdk');
const { google }  = require('googleapis');

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const MAX_BATCH    = 5;

const C = {
  STATUS:      1,
  EMOTION_CAT: 2,
  NAME:        4,
  PRICE:       5,
  URL:         6,
  EMOTION:    18,
  PAIN:       19,
  SEASON:     20,
  ANGLE:      21,
  SCENE:      22,
  HOOKS:      23,
  DRAFT:      24,
  FINAL:      25,
  THREADS:    28,  // 新列 AC
};

async function getSheetsClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key   = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const id    = process.env.GOOGLE_SHEET_ID;
  if (!email || !key || !id) throw new Error('Google Sheets環境変数が未設定です');
  const auth   = new google.auth.JWT(email, null, key, ['https://www.googleapis.com/auth/spreadsheets']);
  const sheets = google.sheets({ version: 'v4', auth });
  const meta   = await sheets.spreadsheets.get({ spreadsheetId: id });
  const sheetMeta = meta.data.sheets[0];
  const sheetName = sheetMeta.properties.title;
  const sheetGid  = sheetMeta.properties.sheetId;
  const colCount  = sheetMeta.properties.gridProperties.columnCount;
  return { sheets, sheetId: id, sheetName, sheetGid, colCount };
}

async function ensureThreadsHeader({ sheets, sheetId, sheetName, sheetGid, colCount }) {
  // threadsPost は 29列目(AC)が必要。列が足りなければ追加する
  if (colCount < 29) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      resource: {
        requests: [{
          appendDimension: {
            sheetId:   sheetGid,
            dimension: 'COLUMNS',
            length:    29 - colCount,
          },
        }],
      },
    });
    console.log(`[claude-review] ${29 - colCount}列追加しました`);
  }

  // ヘッダーがなければ書き込む
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: `${sheetName}!AC1`,
  });
  if (!r.data.values?.[0]?.[0]) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${sheetName}!AC1`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [['threadsPost']] },
    });
  }
}

function twitterCount(text) {
  const urls = text.match(/https?:\/\/\S+/g) || [];
  const urlActual = urls.reduce((s, u) => s + [...u].length, 0);
  return [...text].length - urlActual + urls.length * 23;
}

function buildPrompt(item) {
  return `あなたは、
「楽天アフィ投稿を作るAI」
ではありません。

あなたは、
XとThreadsで自然に流れてくる
"人間の独り言"
を書くライターです。

--------------------------------------------------
■ 最重要
--------------------------------------------------

商品を説明しないでください。

「おすすめ」
を作らないでください。

作りたいのは：

『感情だけ置いてある投稿』

です。

--------------------------------------------------
■ 投稿の理想
--------------------------------------------------

読んだ人が：

「わかる…」
「なんか気になる」
「これ好き」

と思う空気感。

--------------------------------------------------
■ 超重要
--------------------------------------------------

XのBOT判定っぽく見えないように、
「人間らしさ」を最優先してください。

綺麗すぎる文章は禁止です。

AIが書いたような
「整いすぎた文章」
にしないでください。

--------------------------------------------------
■ 人間らしさの特徴
--------------------------------------------------

- 少し雑
- 少し曖昧
- 言い切らない
- 余白がある
- 感情だけ置いて終わる
- 生活感
- ノイズ感
- 「なんか」「ちょっと」OK
- 文章量バラつきOK
- 毎回同じ構成にしない
- 毎回同じ温度感にしない

--------------------------------------------------
■ 禁止
--------------------------------------------------

- おすすめ
- 人気
- 高評価
- 今話題
- 購入はこちら
- 商品説明
- レビュー口調
- 比較
- スペック説明
- アフィリエイト感
- 綺麗にまとめる
- 教える口調
- 毎回同じ構文
- 毎回3行固定
- 毎回同じ終わり方
- 毎回「〜だけで嬉しい」
- 毎回「〜に弱い」

--------------------------------------------------
■ 超重要
--------------------------------------------------

AIは「結論」を書きたがります。

でもXやThreadsで強い投稿は、
結論ではなく
"感情の切り抜き"
です。

説明しすぎないでください。

--------------------------------------------------
■ 出力形式
--------------------------------------------------

{
  "xPost": "",
  "threadsPost": ""
}

--------------------------------------------------
■ xPost
--------------------------------------------------

X向け。

条件：

- 必ず140文字以内
- 理想は80〜120文字
- 独り言感
- 一瞬で止まる
- 情景の切り抜き
- 短文
- 余韻
- 説明しすぎない
- 商品説明禁止
- 売り込み禁止

理想：

「なんか気になる」

--------------------------------------------------
■ threadsPost
--------------------------------------------------

Threads向け。

条件：

- 少し長めOK
- 感情深め
- 会話っぽい
- 共感重視
- 日常感
- 空気感
- 商品説明禁止
- 売り込み禁止

理想：

「わかる…」
「なんか好き」

--------------------------------------------------
■ 良い投稿例
--------------------------------------------------

今日なんか髪まとまる

--------------------------------------------------

お風呂後、
こういう匂いに助けられてる

--------------------------------------------------

机だけちょっとかわいい

--------------------------------------------------

床見えるだけで
今日はちょっとマシ

--------------------------------------------------

なんか今日、
ちゃんとしてる感ある

--------------------------------------------------

疲れてる時、
こういうのに弱い

--------------------------------------------------

箱開けた瞬間、
空気変わるやつだった

--------------------------------------------------
■ 商品情報
--------------------------------------------------

商品名：
${item.name}

カテゴリ：
${item.emotionCategory}

価格：
¥${Number(item.price).toLocaleString()}

emotion：
${item.emotion}

pain：
${item.pain}

season：
${item.season}

angle：
${item.angle}

scene：
${item.scene}

HOOK候補：
${item.hooks}

--------------------------------------------------
■ やること
--------------------------------------------------

xPost と threadsPost を
同時生成してください。

重要：

商品を売ろうとしないでください。

「人がふと呟いた感じ」
を最優先してください。

"感情だけ置く"
イメージで書いてください。`;
}

async function generatePosts(item, anthropic) {
  const message = await anthropic.messages.create({
    model:      CLAUDE_MODEL,
    max_tokens: 600,
    messages:   [{ role: 'user', content: buildPrompt(item) }],
  });

  const raw = (message.content[0]?.text || '').trim();
  console.log('[claude-review] raw:', raw.slice(0, 200));
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSONパース失敗: ' + raw.slice(0, 80));
  const parsed = JSON.parse(jsonMatch[0]);

  const xPost      = (parsed.xPost      || '').trim();
  const threadsPost = (parsed.threadsPost || '').trim();

  if (twitterCount(xPost) > 140) {
    console.warn('[claude-review] xPost超過:', twitterCount(xPost), '文字');
  }

  return { xPost, threadsPost };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY?.replace(/^﻿/, '').trim();
  if (!apiKey) return res.status(500).json({ success: false, error: 'ANTHROPIC_API_KEY未設定' });

  try {
    const client = await getSheetsClient();
    await ensureThreadsHeader(client);

    const r = await client.sheets.spreadsheets.values.get({
      spreadsheetId: client.sheetId,
      range: `${client.sheetName}!A:AC`,
    });
    const rows = r.data.values || [];
    if (rows.length <= 1) {
      return res.status(200).json({ success: true, count: 0, message: '対象行なし' });
    }

    const targets = [];
    const foundStatuses = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const status = (row[C.STATUS] || '').trim();
      if (i <= 10) foundStatuses.push(`row${i + 1}:"${status}"`);
      if (status === '投稿文生成済み') {
        targets.push({ rowIndex: i + 1, row });
      }
      if (targets.length >= MAX_BATCH) break;
    }
    if (!targets.length) {
      return res.status(200).json({
        success: false,
        count: 0,
        message: '「投稿文生成済み」の行が見つかりませんでした',
        debug_statuses: foundStatuses,
      });
    }

    const anthropic = new Anthropic({ apiKey });
    let count = 0;
    const errors = [];

    for (const { rowIndex, row } of targets) {
      try {
        const item = {
          name:           row[C.NAME]        || '',
          price:          row[C.PRICE]       || 0,
          emotionCategory: row[C.EMOTION_CAT] || '',
          url:            row[C.URL]         || '',
          emotion:        row[C.EMOTION]     || '',
          pain:           row[C.PAIN]        || '',
          season:         row[C.SEASON]      || '',
          angle:          row[C.ANGLE]       || '',
          scene:          row[C.SCENE]       || '',
          hooks:          row[C.HOOKS]       || '',
        };

        const { xPost, threadsPost } = await generatePosts(item, anthropic);

        const updated = [...row];
        while (updated.length < 29) updated.push('');
        updated[C.STATUS]  = '監修済み';
        updated[C.FINAL]   = item.url ? `${xPost}\n${item.url}` : xPost;
        updated[C.THREADS] = threadsPost;

        await client.sheets.spreadsheets.values.update({
          spreadsheetId: client.sheetId,
          range: `${client.sheetName}!A${rowIndex}:AC${rowIndex}`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [updated] },
        });
        count++;
        console.log(`[claude-review] row ${rowIndex}: ${item.name.slice(0, 20)}`);
      } catch (e) {
        const msg = `row${rowIndex}: ${e.message}`;
        console.error('[claude-review]', msg);
        errors.push(msg);
      }
    }

    if (count === 0 && errors.length > 0) {
      return res.status(500).json({
        success: false,
        error: errors[0],
        allErrors: errors,
      });
    }

    return res.status(200).json({
      success: true,
      count,
      message: `${count}件をClaude監修しました`,
      ...(errors.length > 0 && { warnings: errors }),
    });

  } catch (err) {
    console.error('[claude-review]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
