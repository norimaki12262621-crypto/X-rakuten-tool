const Groq = require('groq-sdk');
const FAST_MODEL  = process.env.GROQ_FAST_MODEL  || 'llama-3.1-8b-instant';
const SMART_MODEL = process.env.GROQ_SMART_MODEL || 'llama-3.3-70b-versatile';
const { pick, inferMacroCategory, normalizeMacroCategory, selectCopy, selectNudge, buildPost } = require('./_categories');

function cleanProductName(name = '') {
  return name
    .replace(/送料無料|公式|ランキング|SALE|ポイント\d*倍?|レビュー[^\s　]*/g, '')
    .replace(/限定|メール便|正規品|最強|人気|【[^】]*】|\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
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

function createGroqClient(apiKey) {
  return new Groq({ apiKey, timeout: 15000 });
}

async function analyzeCategory(name, price, catchcopy, groqClient) {
  const prompt = `楽天商品を次の大カテゴリのどれか1つに分類し、JSONのみ返してください。説明文不要。
カテゴリ: beauty / rainy / gift / home / gadget / pet / food / kids / fashion / other
beauty=美容・スキンケア・ヘアケア / rainy=傘・防水・梅雨 / gift=ギフト・プレゼント・記念日
home=収納・掃除・キッチン / gadget=家電・充電・イヤホン / pet=ペット用品
food=食品・グルメ / kids=子ども・ベビー / fashion=服・バッグ
商品名:${name}
価格:¥${Number(price).toLocaleString()}
キャッチコピー:${catchcopy || ''}
{"category":"beauty/rainy/gift/home/gadget/pet/food/kids/fashion/other"}`;

  const completion = await groqClient.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: FAST_MODEL,
    temperature: 0.2,
    max_tokens: 80,
  });

  const raw = (completion.choices[0]?.message?.content || '').trim();
  if (!raw) throw new Error('カテゴリ分析応答が空');
  console.log('[generate-post] category raw:', raw);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('カテゴリJSONパース失敗');
  return normalizeMacroCategory(JSON.parse(jsonMatch[0]).category);
}

async function smartAnalyze(name, price, catchcopy, description, groqClient) {
  const src = `${(name || '').slice(0, 40)} ${(catchcopy || '').slice(0, 30)}`.trim();
  const desc = (description || '').slice(0, 80);

  const prompt = `楽天商品のX投稿向け感情分析。JSONのみ返せ。説明文不要。
商品:${src}
説明:${desc}
¥${Number(price).toLocaleString()}

禁止:楽天で人気/高評価/今話題/購入はこちら/説明口調/綺麗すぎる文章
重視:本音/あるある/悩み/共感/人間っぽさ/少し雑なリアル感

出力:
- hooks:Xで流れてくる独り言風HOOK×5案(商品名コピペ禁止/\\n改行OK/各30字以内)
- emotion:感情タグ(10字以内)
- pain:悩みタグ(10字以内)
- season:季節タグ(8字以内)
- angle:投稿切り口(10字以内)
- xScore:Xバズ適性0-100

{"hooks":["...\\n...","...","...","...","..."],"emotion":"...","pain":"...","season":"...","angle":"...","xScore":78}`;

  const completion = await groqClient.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: SMART_MODEL,
    temperature: 0.85,
    max_tokens: 450,
  });

  const raw = (completion.choices[0]?.message?.content || '').trim();
  console.log('[generate-post] smartAnalyze raw:', raw.slice(0, 300));
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('smartAnalyze JSONパース失敗');
  return JSON.parse(jsonMatch[0]);
}

function savePostLog(entry) {
  try {
    const fs = require('fs');
    const path = require('path');
    const logPath = path.join(__dirname, '../logs/posts.json');
    let logs = [];
    try { logs = JSON.parse(fs.readFileSync(logPath, 'utf8')); } catch {}
    logs.push(entry);
    fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
  } catch {
    console.log('[generate-post] log:', JSON.stringify(entry));
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name: rawName, price, catchcopy: rawCatchcopy, description: rawDescription, url } = req.body;
  const name        = cleanProductName(rawName || '');
  const catchcopy   = cleanProductName(rawCatchcopy || '');
  const description = (rawDescription || '').replace(/\s+/g, ' ').slice(0, 300);
  console.log('[generate-post] processed:', JSON.stringify({ name, price, catchcopy, url }));

  const groqKey = process.env.GROQ_API_KEY?.replace(/^﻿/, '').trim();
  const sourceText = `${name} ${catchcopy} ${description}`;
  let category = inferMacroCategory(sourceText);
  let hookAnalysis = null;

  try {
    if (groqKey) {
      const groqClient = createGroqClient(groqKey);
      category = await analyzeCategory(name, price, catchcopy, groqClient);
      hookAnalysis = await smartAnalyze(name, price, catchcopy, description, groqClient);
      console.log('[generate-post] xScore:', hookAnalysis?.xScore, 'category:', category);
    }
  } catch (err) {
    console.log('[generate-post] AI fallback:', err.message);
  }

  let body;
  let usedSmartHook = false;

  if (hookAnalysis && hookAnalysis.xScore >= 70 && hookAnalysis.hooks?.length) {
    const mainHook = hookAnalysis.hooks[0];
    const nudge = selectNudge(sourceText);
    const benefit = pick(selectCopy(sourceText).benefits);
    body = `${mainHook}\n\n${nudge}\n\n¥${Number(price).toLocaleString()}／${benefit}`;
    usedSmartHook = true;
  } else {
    body = buildPost(price, sourceText);
  }

  const postText = trimTo140(body, url);
  savePostLog({
    ts: new Date().toISOString(),
    name: name.slice(0, 30),
    xScore: hookAnalysis?.xScore ?? null,
    category,
    usedSmartHook,
    chars: twitterCount(postText),
  });

  return res.status(200).json({
    success: true,
    postText,
    charCount: twitterCount(postText),
    category,
    xScore: hookAnalysis?.xScore ?? null,
    hooks: Array.isArray(hookAnalysis?.hooks) ? hookAnalysis.hooks : [],
    emotion: hookAnalysis?.emotion || '',
    pain: hookAnalysis?.pain || '',
    season: hookAnalysis?.season || '',
    angle: hookAnalysis?.angle || '',
  });
};
