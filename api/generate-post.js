const Groq = require('groq-sdk');
const FAST_MODEL  = process.env.GROQ_FAST_MODEL  || 'llama-3.1-8b-instant';
const SMART_MODEL = process.env.GROQ_SMART_MODEL || 'llama-3.3-70b-versatile';
const { pick, inferMacroCategory, normalizeMacroCategory, selectCopy, selectScene, buildPost } = require('./_categories');

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
カテゴリ: beauty/rainy/gift_safe/gift_luxury/gift_fun/gift_emotional/gift_practical/home/gadget/pet/food/kids/fashion/other
gift_safe=無難定番ギフト / gift_luxury=高級贅沢ギフト(高級フルーツ・ワイン・和牛・カニ等) / gift_fun=面白ネタギフト
gift_emotional=気持ち伝わる(名入れ・花束等) / gift_practical=実用消耗品ギフト(タオル・コーヒー・入浴剤等)
beauty=美容ヘアケア / rainy=傘防水梅雨 / home=収納掃除キッチン / gadget=家電充電イヤホン
pet=ペット / food=食品グルメ / kids=子どもベビー / fashion=服バッグ
商品名:${name}
価格:¥${Number(price).toLocaleString()}
キャッチコピー:${catchcopy || ''}
{"category":"gift_safe/gift_luxury/gift_fun/gift_emotional/gift_practical/beauty/rainy/home/gadget/pet/food/kids/fashion/other"}`;

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

禁止:楽天で人気/高評価/今話題/購入はこちら/説明口調/商品名コピペ/特別感がある/高級感がある/便利/使える/喜ばれる/おすすめ/幸せな気分/レビュー口調/〜が変わった/〜が正解/〜すぎる/〜してよかった/教える口調/まとめる/結論を書く
重視:一言感情/日常の一瞬/余韻/未完成感/あるある/生活ノイズ感/感情だけ置いて終わる

HOOKは短い独り言。感情だけ置いて終わる。140字ギリギリまで埋めなくていい。説明不足でいい。
HOOKの良い例:「今日なんか髪まとまる」「疲れてる時こういうのに弱い」「机だけちょっとかわいい」「朝ラクだと助かる」「気づいたら毎日使ってる」

sceneは1〜2行。未完成でいい。感情の切り抜きだけ。
sceneの良い例:「お風呂後\\nこれないと無理」「冷蔵庫開けるたびちょっと嬉しい」「渡した時の顔、よかった」

出力:
- hooks:Xで流れてくる独り言風HOOK×5案(商品名コピペ禁止/\\n改行OK/各30字以内)
- emotion:感情タグ(10字以内)
- pain:悩みタグ(10字以内)
- season:季節タグ(8字以内)
- angle:投稿切り口(10字以内)
- scene:情景＋小さな感情の2行(\\n改行/合計30字以内/説明なし/独り言)
- xScore:Xバズ適性0-100

{"hooks":["...\\n...","...","...","...","..."],"emotion":"...","pain":"...","season":"...","angle":"...","scene":"...\\n...","xScore":78}`;

  const completion = await groqClient.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: SMART_MODEL,
    temperature: 0.85,
    max_tokens: 500,
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
    const scene = hookAnalysis.scene || selectScene(sourceText);
    const echo  = pick(selectCopy(sourceText).echoes);
    body = `${mainHook}\n\n${scene}\n\n¥${Number(price).toLocaleString()}／${echo}`;
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
    scene: hookAnalysis?.scene || '',
  });
};
