const Groq = require('groq-sdk');
const SMART_MODEL = process.env.GROQ_SMART_MODEL || 'llama-3.3-70b-versatile';
const { inferMacroCategory, CAT_LABEL } = require('./_categories');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name = '', price = 0, catchcopy = '', description = '' } = req.body;
  const groqKey = process.env.GROQ_API_KEY?.replace(/^﻿/, '').trim();
  if (!groqKey) return res.status(500).json({ success: false, error: 'GROQ_API_KEY未設定' });

  try {
    const groq = new Groq({ apiKey: groqKey, timeout: 20000 });
    const src = `${(name || '').slice(0, 40)} ${(catchcopy || '').slice(0, 30)}`.trim();
    const desc = (description || '').slice(0, 80);

    // カテゴリを推定してSMART_MODELに渡す（gift_luxury等で方向性を固定）
    const macroCategory = inferMacroCategory(`${name} ${catchcopy} ${description}`);
    const catLabel = CAT_LABEL[macroCategory] || macroCategory;

    // gift_* ごとのHOOK方向性ガイド
    const giftGuide = {
      gift_luxury:    '方向性: 贅沢感・自分では買わない感・特別感を訴求。価格への驚きや憧れを出す。',
      gift_safe:      '方向性: 外したくない不安・無難だけど可愛いという矛盾を出す。',
      gift_fun:       '方向性: 「え何これ」「ネタになる」「場が盛り上がる」笑い要素を出す。',
      gift_emotional: '方向性: 「選んでくれた気持ちが伝わる」想いや感謝の気持ちを軸にする。',
      gift_practical: '方向性: 「使えるが一番」「消耗品ギフト最強説」実用性への共感を出す。',
    }[macroCategory] || '';

    const prompt = `楽天商品のX投稿向け感情分析。JSONのみ返せ。説明文不要。
商品:${src}
説明:${desc}
¥${Number(price).toLocaleString()}
カテゴリ:${catLabel}
${giftGuide}

禁止:楽天で人気/高評価/今話題/購入はこちら/説明口調/綺麗すぎる文章/商品名コピペ
重視:本音/あるある/悩み/共感/人間っぽさ/少し雑なリアル感

出力:
- hooks:Xで流れてくる独り言風HOOK×5案(\\n改行OK/各30字以内)
- emotion:感情タグ(10字以内)
- pain:悩みタグ(10字以内)
- season:季節タグ(8字以内)
- angle:投稿切り口(10字以内)
- xScore:Xバズ適性0-100

{"hooks":["...\\n...","...","...","...","..."],"emotion":"...","pain":"...","season":"...","angle":"...","xScore":78}`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: SMART_MODEL,
      temperature: 0.85,
      max_tokens: 450,
    });

    const raw = (completion.choices[0]?.message?.content || '').trim();
    console.log('[hook-generator] cat:', macroCategory, 'raw:', raw.slice(0, 300));
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSONパース失敗: ' + raw.slice(0, 100));
    const parsed = JSON.parse(jsonMatch[0]);

    return res.status(200).json({
      success: true,
      category: macroCategory,
      hooks: Array.isArray(parsed.hooks) ? parsed.hooks.slice(0, 8) : [],
      emotion: parsed.emotion || '',
      pain: parsed.pain || '',
      season: parsed.season || '',
      angle: parsed.angle || '',
      xScore: typeof parsed.xScore === 'number' ? parsed.xScore : null,
    });
  } catch (err) {
    console.error('[hook-generator] error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
