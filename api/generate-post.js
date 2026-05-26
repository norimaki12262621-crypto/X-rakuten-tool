const Groq = require('groq-sdk');
const FAST_MODEL  = process.env.GROQ_FAST_MODEL  || 'llama-3.1-8b-instant';
const SMART_MODEL = process.env.GROQ_SMART_MODEL || 'llama-3.3-70b-versatile';

// SEOノイズ除去
function cleanProductName(name = '') {
  return name
    .replace(/送料無料|公式|ランキング|SALE|ポイント\d*倍?|レビュー[^\s　]*/g, '')
    .replace(/限定|メール便|正規品|最強|人気|【[^】]*】|\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

// Twitter 換算文字数（URL = 23 字換算）
function twitterCount(text) {
  const urls = text.match(/https?:\/\/\S+/g) || [];
  const urlActual = urls.reduce((s, u) => s + [...u].length, 0);
  return [...text].length - urlActual + urls.length * 23;
}

// 140字超えなら末尾行から1文字ずつ削る
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

const CATEGORY_COPY = {
  beauty: {
    hooks: [
      '朝の支度、\n髪まとまらないだけで詰む',
      '乾燥ひどい日、\n化粧ノリ終わるの萎える',
      'お風呂上がり、\nちゃんとケアする余力ほしい',
    ],
    benefits: [
      '朝の支度がちょっとラクになる',
      'ベタつきにくくて気分よく整う',
      '毎日のケアを続けやすい',
    ],
  },
  household: {
    hooks: [
      '部屋干し、\n乾いたと思ったらまだ湿ってる',
      '家の小さいストレス、\n積み重なると地味にしんどい',
      '片づけたはずなのに、\n生活感が残るのつらい',
    ],
    benefits: [
      '家事のひっかかりがひとつ減る',
      '置くだけでいつもの面倒が軽くなる',
      '毎日使う場所が少し整う',
    ],
  },
  kids: {
    hooks: [
      '子ども用品、\n必要になるタイミング急すぎ',
      '子どもへのプレゼント、\n毎回けっこう悩む',
      '朝のバタバタ、\n子ども関連でだいたい増える',
    ],
    benefits: [
      '親の準備ストレスが少し減る',
      '子どもも使いやすくて出番が増える',
      '毎日の支度がちょっと回しやすい',
    ],
  },
  food: {
    hooks: [
      '料理めんどい日、\n正直かなりある',
      'ごはんの準備、\n考えるだけで疲れる日ある',
      '洗い物多いの、\n地味にしんどい',
    ],
    benefits: [
      '食卓の準備がかなりラクになる',
      '忙しい日のごはん問題を助けてくれる',
      '手間少なめでちゃんと満足感ある',
    ],
  },
  fashion: {
    hooks: [
      'コーデ決まらない朝、\nちょい萎える',
      '出かける前、\nなんか物足りない日ある',
      '季節の服選び、\n毎年ちょっと迷う',
    ],
    benefits: [
      'いつもの服に合わせやすい',
      '出かける前の迷いが少し減る',
      '季節感を足しやすい',
    ],
  },
  other: {
    hooks: [
      'なんか使いにくいな、\nがずっと続いてた件。',
      '小さい不便、\n放置するとずっと気になる',
      'これ地味に困る、\nって場面けっこうある',
    ],
    benefits: [
      'いつもの不便が少しラクになる',
      '使うたびに小さく助かる',
      '生活の引っかかりがひとつ減る',
    ],
  },
};

const TOPIC_COPY = [
  {
    pattern: /ラロッシュ|ポゼ|美容液|化粧水|乳液|クリーム|日焼け止め|uv|トーンアップ|下地|スキンケア|敏感肌|保湿/,
    hooks: [
      '肌の乾燥、\n夕方になるとけっこう気になる',
      '朝のスキンケア、\n重いと続かないんよね',
      '日中の肌、\nなんか守れてる感ほしい',
    ],
    benefits: [
      '毎日の肌ケアに取り入れやすい',
      'ベタつきにくくて朝も使いやすい',
      '乾燥対策を続けやすい',
    ],
  },
  {
    pattern: /ヘア|髪|シャンプー|トリートメント|ヘアオイル|ドライヤー/,
    hooks: [
      '朝の髪、\nまとまらないだけで詰む',
      '髪のパサつき、\n地味にテンション下がる',
      'お風呂上がり、\n髪ケアまで手が回らん',
    ],
    benefits: [
      '朝の支度がちょっとラクになる',
      '髪のケアを続けやすい',
      'まとまり感を足しやすい',
    ],
  },
  {
    pattern: /猫|ねこ|キャット|犬|いぬ|ドッグ|ペット|おやつ|フード|餌|ごはん/,
    hooks: [
      'ペットのごはん、\n切らすとほんと焦る',
      'いつものフード、\nストックあるだけで安心',
      'ペット用品、\n気づいたら減ってる',
    ],
    benefits: [
      '毎日のごはん準備が少し安心',
      'まとめて置けて買い足しがラク',
      'いつものストック用にちょうどいい',
    ],
  },
  {
    pattern: /ヒーター|発熱|電熱|防寒|あったか|暖か|温熱|ベスト|毛布|カイロ/,
    hooks: [
      '寒い日の外出、\n着込んでもまだ寒い',
      '朝の冷え込み、\nほんと動きたくなくなる',
      '冬の作業、\n体が冷えるとしんどい',
    ],
    benefits: [
      '寒い日の外出が少しラクになる',
      '冷えやすい場面で使いやすい',
      '外でも暖かさを足しやすい',
    ],
  },
  {
    pattern: /モバイルバッテリー|充電|バッテリー|急速充電|充電器|ケーブル/,
    hooks: [
      '外出中の充電切れ、\nあれ本当に焦る',
      'スマホの残量、\n夕方に見るのこわい',
      '旅行の日、\n充電まわりが不安すぎる',
    ],
    benefits: [
      '外出先の電池切れ対策になる',
      'バッグに入れておくと安心',
      '移動中も充電しやすい',
    ],
  },
  {
    pattern: /だし|出汁|鰹|かつお|昆布|惣菜|肉|魚|米|スイーツ|お菓子|食品|冷凍|麺/,
    hooks: [
      'ごはん作る日、\n味つけ考えるの地味に大変',
      '料理めんどい日、\nちゃんとおいしくしたい',
      '毎日のごはん、\n手間は減らしたい',
    ],
    benefits: [
      'いつもの料理に使いやすい',
      '手間少なめで満足感を足せる',
      'ごはん作りの助けになる',
    ],
  },
];

const EXTRA_TOPIC_COPY = [
  {
    pattern: /母の日|父の日|敬老|誕生日|クリスマス|結婚祝い|出産祝い|卒業|入学|就職|昇進|記念日|バレンタイン|ホワイトデー|お年賀|ギフト|プレゼント|祝い/,
    hooks: [
      'プレゼント選び、\n外したくない時ほど迷う',
      '贈り物って、\n実用的すぎても味気ない',
      'ギフト探し、\n相手の顔が浮かぶやつ選びたい',
    ],
    benefits: [
      'ちゃんと使えて気持ちも伝わる感じがちょうどいい',
      '高すぎず安っぽくも見えないラインを狙える',
      '悩みがちな贈り物候補に入れておきたい',
    ],
  },
  {
    pattern: /可愛い|かわいい|韓国|推し活|ぬいぐるみ|おもちゃ|フォトフレーム|アルバム|ポーチ|バッグ|アクセサリーケース|文房具|ステーショナリー|スマホケース|収納|ケース|入れ物/,
    hooks: [
      '机まわり、\n可愛いだけでちょっと機嫌戻る',
      '小物って、\n雑に置くと一気に生活感出る',
      '持ち歩くもの、\n見るたび少し気分上げたい',
    ],
    benefits: [
      '散らかりがちな小物も見た目よくまとめやすい',
      '実用感だけじゃなく気分までちゃんと上がる',
      '普段使いしながら可愛さも足せるのがいい',
    ],
  },
  {
    pattern: /食器|皿|器|カップ|グラス|キッチン雑貨|調理器具|フライパン|鍋|包丁|まな板|保存容器/,
    hooks: [
      'キッチン用品、\n使いにくいと毎日じわじわ疲れる',
      '料理のやる気、\n道具ひとつでけっこう変わる',
      '洗い物まで考えると、\n使いやすさほんと大事',
    ],
    benefits: [
      '毎日の料理と片づけの小さい面倒を減らせる',
      '出しっぱなしでも見た目が荒れにくいのが助かる',
      '自炊のハードルを少し下げてくれる',
    ],
  },
  {
    pattern: /お取り寄せ|スイーツ|お菓子|チョコ|ラーメン|麺|肉|ステーキ|海鮮|魚介|惣菜|だし|出汁|鰹|かつお|昆布|米|冷凍/,
    hooks: [
      '家で食べる楽しみ、\nひとつあるだけで週末が違う',
      '外食までは面倒でも、\nおいしいものは食べたい',
      'ごはん作る日、\n味つけ考えるの地味に大変',
    ],
    benefits: [
      '家にいながらちょっと特別感のあるごはんにできる',
      '忙しい日でも食卓の満足感を足しやすい',
      '手間を増やさずちゃんとおいしい方向に寄せられる',
    ],
  },
  {
    pattern: /ラロッシュ|ポゼ|美容液|セラム|化粧水|乳液|クリーム|日焼け止め|uv|トーンアップ|下地|スキンケア|敏感肌|保湿/,
    hooks: [
      '肌の乾燥、\n夕方になると一気に気になる',
      '朝のスキンケア、\n重いと結局続かないんよね',
      '日中の肌、\nなんか守れてる感ほしい',
    ],
    benefits: [
      '朝の支度に足しても重くなりにくいのが使いやすい',
      '乾燥対策をちゃんと毎日続けたい人にちょうどいい',
      '肌の調子が読めない日でも手に取りやすい',
    ],
  },
  {
    pattern: /ヘア|髪|シャンプー|トリートメント|ヘアオイル|ドライヤー/,
    hooks: [
      '朝の髪、\nまとまらないだけで一日ひきずる',
      '髪のパサつき、\n地味にテンション下がる',
      'お風呂上がり、\n髪ケアまで手が回らん',
    ],
    benefits: [
      '朝の支度で髪にかける時間を少し減らせそう',
      '毎日のヘアケアをがんばりすぎず続けやすい',
      'まとまり感がほしい日に手に取りやすい',
    ],
  },
  {
    pattern: /インテリア|寝具|枕|布団|マットレス|照明|ラグ|カーテン|収納|掃除|洗濯|除湿|部屋干し/,
    hooks: [
      '部屋の小さい不満、\n毎日見るからじわじわ効く',
      '寝る時間くらい、\nちゃんと気持ちよくしたい',
      '片づけても、\n生活感が残るのちょっと嫌',
    ],
    benefits: [
      '毎日いる場所のストレスをちゃんと減らせる',
      '見た目と使いやすさをまとめて整えやすい',
      '家で過ごす時間の満足感が少し上がる',
    ],
  },
  {
    pattern: /イヤホン|ヘッドフォン|ヘッドホン|ワイヤレス|モバイルバッテリー|充電|バッテリー|急速充電|充電器|ケーブル|家電|加湿器|扇風機|掃除機/,
    hooks: [
      '外出中の充電切れ、\nあれ本当に焦る',
      '毎日使うガジェット、\n地味な不満ほど減らしたい',
      '移動時間、\nちょっと快適にするだけで違う',
    ],
    benefits: [
      '出先で困る場面を減らせる安心感がある',
      '毎日使うものだから使い勝手の差がちゃんと出る',
      '持っておくと小さいストレスを先回りできる',
    ],
  },
  {
    pattern: /ヒーター|発熱|電熱|防寒|あったか|暖か|温熱|ベスト|毛布|カイロ/,
    hooks: [
      '寒い日の外出、\n着込んでもまだ寒い',
      '朝の冷え込み、\nほんと動きたくなくなる',
      '冬の作業、\n体が冷えるとしんどい',
    ],
    benefits: [
      '外でも暖かさを足せるから冬のしんどさが減りそう',
      '冷えやすい場面で一枚あるとかなり安心できる',
      '通勤や屋外作業の寒さ対策に使いやすい',
    ],
  },
  {
    pattern: /犬|いぬ|ドッグ|猫|ねこ|キャット|ペット|おやつ|フード|餌|ごはん/,
    hooks: [
      'ペットのごはん、\n切らすとほんと焦る',
      'いつものフード、\nストックあるだけで安心',
      'ペット用品、\n気づいたら減ってる',
    ],
    benefits: [
      '毎日のごはん準備を慌てず回せるのが助かる',
      'まとめて置けるから買い足し忘れ対策になる',
      'いつものストック用にちょうどよくて安心感ある',
    ],
  },
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function normalizeCategory(category) {
  return CATEGORY_COPY[category] ? category : 'other';
}

function inferCategoryFromText(text) {
  const source = text.toLowerCase();
  if (/美容|コスメ|化粧|髪|ヘア|肌|保湿|メイク|シャンプー|オイル|ネイル/.test(source)) return 'beauty';
  if (/掃除|収納|洗濯|乾燥|除湿|キッチン|台所|風呂|トイレ|部屋干し|家事/.test(source)) return 'household';
  if (/子ども|子供|キッズ|ベビー|赤ちゃん|入園|入学|靴|おもちゃ|知育/.test(source)) return 'kids';
  if (/食品|惣菜|肉|魚|米|スイーツ|お菓子|料理|ごはん|冷凍|麺|珈琲|コーヒー/.test(source)) return 'food';
  if (/服|バッグ|財布|靴|帽子|ワンピ|トップス|パンツ|コーデ|ファッション|アクセ/.test(source)) return 'fashion';
  return 'other';
}

function selectCopy(sourceText, category = 'other') {
  const source = sourceText.toLowerCase();
  return EXTRA_TOPIC_COPY.find(({ pattern }) => pattern.test(source))
    || TOPIC_COPY.find(({ pattern }) => pattern.test(source))
    || CATEGORY_COPY[normalizeCategory(category)];
}

function selectNudge(sourceText, category = 'other') {
  const source = sourceText.toLowerCase();
  const rules = [
    [/母の日|父の日|敬老|誕生日|クリスマス|結婚祝い|出産祝い|卒業|入学|就職|昇進|記念日|ギフト|プレゼント|祝い/, ['ちゃんと考えた感じが出るのも大事。', '無難すぎないけど使える、この塩梅がいい。']],
    [/可愛い|かわいい|韓国|推し活|ぬいぐるみ|ポーチ|文房具|スマホケース|収納|ケース/, ['見える場所に置けるの、地味に大きい。', '毎日目に入るものほど気分で選びたい。']],
    [/お取り寄せ|スイーツ|お菓子|ラーメン|肉|ステーキ|海鮮|魚介|惣菜|だし|出汁|米|冷凍/, ['冷蔵庫にあると未来の自分が助かる。', '外に出ずに楽しみ作れるの、かなり強い。']],
    [/美容液|化粧水|日焼け止め|スキンケア|保湿|ヘア|髪|シャンプー|トリートメント/, ['毎朝使うものほど、軽さって大事。', '続けやすいケアが結局いちばん助かる。']],
    [/インテリア|寝具|枕|布団|収納|掃除|洗濯|部屋干し|キッチン|調理器具/, ['毎日目に入る場所だから妥協したくない。', '家の中のストレス減ると、思ったより効く。']],
    [/イヤホン|ヘッドフォン|モバイルバッテリー|充電|家電|ヒーター|発熱|防寒/, ['バッグに入れておく安心感、かなり大きい。', '毎日使うものほど不満を減らしたい。']],
    [/犬|猫|ペット|おやつ|フード|餌|ごはん/, ['ストックあるだけで気持ちがラク。', '切らす前に置いておきたい枠。']],
  ];
  const match = rules.find(([pattern]) => pattern.test(source));
  if (match) return pick(match[1]);
  if (category === 'beauty') return pick(['続けやすいケアが結局いちばん助かる。', '毎朝使うものほど、軽さって大事。']);
  if (category === 'food') return pick(['外に出ずに楽しみ作れるの、かなり強い。', '忙しい日の逃げ道になるのがいい。']);
  return pick(['こういう小さい快適さ、あとで効く。', '地味だけど、あると生活が少し整う。']);
}

function buildPost(price, category = 'other', sourceText = '') {
  const copy = selectCopy(sourceText, category);
  const hook = pick(copy.hooks);
  const nudge = selectNudge(sourceText, category);
  const benefit = pick(copy.benefits);
  const priceStr = `¥${Number(price).toLocaleString()}`;
  return `${hook}\n\n${nudge}\n\n${priceStr}／${benefit}`;
}

function createGroqClient(apiKey) {
  return new Groq({ apiKey, timeout: 15000 });
}

async function analyzeCategory(name, price, catchcopy, description, groqClient) {
  const prompt = `楽天商品を次のカテゴリのどれか1つに分類し、JSONのみ返してください。説明文不要。
カテゴリ: beauty / household / kids / food / fashion / other
商品名:${name}
価格:¥${Number(price).toLocaleString()}
キャッチコピー:${catchcopy || ''}
説明:${description || ''}
{"category":"beauty/household/kids/food/fashion/other"}`;

  const completion = await groqClient.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: FAST_MODEL,
    temperature: 0.4,
    max_tokens: 80,
  });

  const raw = (completion.choices[0]?.message?.content || '').trim();
  if (!raw) throw new Error('カテゴリ分析応答が空');
  console.log('[generate-post] category raw:', raw);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('カテゴリJSONパース失敗');
  const parsed = JSON.parse(jsonMatch[0]);
  return normalizeCategory(parsed.category);
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
  let category = inferCategoryFromText(`${name} ${catchcopy} ${description}`);
  let hookAnalysis = null;

  try {
    if (groqKey) {
      const groqClient = createGroqClient(groqKey);
      category = await analyzeCategory(name, price, catchcopy, description, groqClient);
      hookAnalysis = await smartAnalyze(name, price, catchcopy, description, groqClient);
      console.log('[generate-post] xScore:', hookAnalysis?.xScore);
    }
  } catch (err) {
    console.log('[generate-post] AI fallback:', err.message);
  }

  let body;
  let usedSmartHook = false;
  const sourceText = `${name} ${catchcopy} ${description}`;

  if (hookAnalysis && hookAnalysis.xScore >= 70 && hookAnalysis.hooks?.length) {
    const mainHook = hookAnalysis.hooks[0];
    const nudge = selectNudge(sourceText, category);
    const benefit = pick(selectCopy(sourceText, category).benefits);
    body = `${mainHook}\n\n${nudge}\n\n¥${Number(price).toLocaleString()}／${benefit}`;
    usedSmartHook = true;
  } else {
    body = buildPost(price, category, sourceText);
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
