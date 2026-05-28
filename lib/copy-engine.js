const { buildStrongXPost } = require('./post-builder');

const TOPIC_RULES = [
  {
    id: 'gift',
    category: 'gift',
    pattern: /母の日|父の日|敬老|誕生日|クリスマス|結婚祝い|出産祝い|卒業|入学|就職|昇進|記念日|バレンタイン|ホワイトデー|お年賀|ギフト|プレゼント|祝い|カタログギフト/,
    productType: 'ギフト候補',
    target: '贈り物選びで外したくない人',
    pain: '相手に合うものが決めきれない',
    scene: 'プレゼントを探している時',
    angle: '無難すぎない贈り物',
    hooks: [
      'プレゼント選び、\n外したくない時ほど迷う',
      '贈り物って、\n実用的すぎても味気ない',
      'ギフト探し、\n相手の顔が浮かぶやつ選びたい',
    ],
    nudges: [
      'ちゃんと考えた感じが出るのも大事。',
      '無難すぎないけど使える、この塩梅がいい。',
    ],
    benefits: [
      '高すぎず安っぽくも見えないラインを狙える',
      '悩みがちな贈り物候補に入れておきたい',
    ],
    threads: [
      'プレゼント選びって、毎回ちょっと緊張する。\n\n好みを外したくないし、でも無難すぎるのも違う気がして。\n\nちゃんと考えた感じがあって、相手も使いやすい。\nそういう候補をひとつ持っておけると、だいぶ気が楽になる。',
    ],
  },
  {
    id: 'storage',
    category: 'household',
    pattern: /収納|ラック|ハンガー|ケース|小物置き|ポリ袋|押入れ|クローゼット|片付け|整理|入れ物|ボックス/,
    productType: '収納グッズ',
    target: '部屋を整えたい人',
    pain: '置き場所が決まらず散らかる',
    scene: '帰宅後や休日の片付け',
    angle: '部屋より先に気持ちが整う',
    hooks: [
      '小物って、\n雑に置くと一気に生活感出る',
      '片づけても、\n置き場所ないとすぐ戻る',
      '部屋の小さい不満、\n毎日見るからじわじわ効く',
    ],
    nudges: [
      '見える場所に置けるの、地味に大きい。',
      '家の中のストレス減ると、思ったより効く。',
    ],
    benefits: [
      '散らかりがちな場所を見た目よくまとめやすい',
      '帰ってきた時の小さいストレスを減らせる',
    ],
    threads: [
      '片づけって、大きく変えなくても効く時がある。\n\nとりあえず置いてたものに場所ができるだけで、部屋の見え方がちょっと変わる。\n\n散らかってるのは物だけじゃなくて、頭の中もだったのかもなって思う日がある。',
    ],
  },
  {
    id: 'kitchen',
    category: 'household',
    pattern: /キッチン|調理器具|食器|皿|器|カップ|グラス|フライパン|鍋|包丁|まな板|保存容器|米びつ|ストッカー/,
    productType: 'キッチン用品',
    target: '自炊や片づけを少しラクにしたい人',
    pain: '料理と片づけの小さい手間が重い',
    scene: '毎日のごはん作り',
    angle: '自炊のハードルを下げる',
    hooks: [
      'キッチン用品、\n使いにくいと毎日じわじわ疲れる',
      '料理のやる気、\n道具ひとつでけっこう変わる',
      '洗い物まで考えると、\n使いやすさほんと大事',
    ],
    nudges: [
      '自炊のハードル、少しでも下げたい。',
      '毎日使う場所ほど妥協したくない。',
    ],
    benefits: [
      '毎日の料理と片づけの小さい面倒を減らせる',
      '出しっぱなしでも見た目が荒れにくいのが助かる',
    ],
    threads: [
      'キッチンって、少し使いやすくなるだけで気分が変わる。\n\n料理が急に得意になるわけじゃないけど、手に取るたびに引っかかる感じが減る。\n\n毎日の場所だから、その小ささがちゃんと効いてくる。',
    ],
  },
  {
    id: 'gourmet',
    category: 'food',
    pattern: /お取り寄せ|スイーツ|お菓子|チョコ|ラーメン|麺|肉|ステーキ|海鮮|魚介|惣菜|だし|出汁|鰹|かつお|昆布|米|冷凍|もつ鍋|グルメ/,
    productType: 'お取り寄せグルメ',
    target: '家でおいしいものを楽しみたい人',
    pain: '外食は面倒だけど満足感はほしい',
    scene: '週末や忙しい日のごはん',
    angle: '家で楽しみを作る',
    hooks: [
      '家で食べる楽しみ、\nひとつあるだけで週末が違う',
      '外食までは面倒でも、\nおいしいものは食べたい',
      'ごはん作る日、\n味つけ考えるの地味に大変',
    ],
    nudges: [
      '外に出ずに楽しみ作れるの、かなり強い。',
      '冷蔵庫にあると未来の自分が助かる。',
    ],
    benefits: [
      '家にいながらちょっと特別感のあるごはんにできる',
      '忙しい日でも食卓の満足感を足しやすい',
    ],
    threads: [
      '外に出るほど元気はないけど、おいしいものは食べたい日がある。\n\nそういう時に家に楽しみがあると、夜の気分がけっこう変わる。\n\nちゃんとしたごほうびって、案外こういうのでいいのかもしれない。',
    ],
  },
  {
    id: 'skincare',
    category: 'beauty',
    pattern: /ラロッシュ|ポゼ|美容液|セラム|化粧水|乳液|クリーム|日焼け止め|uv|トーンアップ|下地|スキンケア|敏感肌|保湿|シートマスク|パック/,
    productType: 'スキンケア',
    target: '肌の乾燥や日中の崩れが気になる人',
    pain: '乾燥や肌のゆらぎが気になる',
    scene: '朝の支度やお風呂上がり',
    angle: '続けやすい肌ケア',
    hooks: [
      '肌の乾燥、\n夕方になると一気に気になる',
      '朝のスキンケア、\n重いと結局続かないんよね',
      '日中の肌、\nなんか守れてる感ほしい',
    ],
    nudges: [
      '毎朝使うものほど、軽さって大事。',
      '続けやすいケアが結局いちばん助かる。',
    ],
    benefits: [
      '乾燥対策をちゃんと毎日続けたい人にちょうどいい',
      '肌の調子が読めない日でも手に取りやすい',
    ],
    threads: [
      '肌の調子って、気分にけっこう出る。\n\n大きく変わったわけじゃなくても、朝ちゃんと整えた日は少し安心して出られる。\n\n続けやすいケアって、派手じゃないけど結局いちばん助かる。',
    ],
  },
  {
    id: 'haircare',
    category: 'beauty',
    pattern: /ヘア|髪|シャンプー|トリートメント|ヘアオイル|ドライヤー/,
    productType: 'ヘアケア',
    target: '髪のまとまりやパサつきが気になる人',
    pain: '朝の髪がまとまらない',
    scene: '朝の支度やお風呂上がり',
    angle: '朝の支度をラクにする',
    hooks: [
      '朝の髪、\nまとまらないだけで一日ひきずる',
      '髪のパサつき、\n地味にテンション下がる',
      'お風呂上がり、\n髪ケアまで手が回らん',
    ],
    nudges: [
      '朝の余裕、こういう所から作りたい。',
      '毎日のケアはがんばりすぎない方が続く。',
    ],
    benefits: [
      '朝の支度で髪にかける時間を少し減らせそう',
      'まとまり感がほしい日に手に取りやすい',
    ],
    threads: [
      '朝の髪が決まらないだけで、その日ずっと引きずることがある。\n\n大げさじゃなく、支度の最初でつまずく感じ。\n\nだから毎日がんばらなくても整えやすいものがあると、それだけで少し余裕が戻る。',
    ],
  },
  {
    id: 'gadget',
    category: 'gadget',
    pattern: /イヤホン|ヘッドフォン|ヘッドホン|ワイヤレス|モバイルバッテリー|充電|バッテリー|急速充電|充電器|ケーブル|家電|加湿器|扇風機|掃除機/,
    productType: 'ガジェット',
    target: '外出や毎日の小さい不便を減らしたい人',
    pain: '充電切れや使い勝手の悪さがストレス',
    scene: '通勤、移動、外出先',
    angle: '困る前に備える',
    hooks: [
      '外出中の充電切れ、\nあれ本当に焦る',
      '毎日使うガジェット、\n地味な不満ほど減らしたい',
      '移動時間、\nちょっと快適にするだけで違う',
    ],
    nudges: [
      'バッグに入れておく安心感、かなり大きい。',
      '毎日使うものほど不満を減らしたい。',
    ],
    benefits: [
      '出先で困る場面を減らせる安心感がある',
      '持っておくと小さいストレスを先回りできる',
    ],
    threads: [
      '外で困ることって、起きるまでは忘れてる。\n\n充電とか音まわりとか、毎日使うものの不満は小さいけど積み重なる。\n\n先にひとつ整えておくと、思ったより気が楽になる。',
    ],
  },
  {
    id: 'pet',
    category: 'pet',
    pattern: /犬|いぬ|ドッグ|猫|ねこ|キャット|ペット|おやつ|フード|餌|ごはん/,
    productType: 'ペット用品',
    target: '犬猫のごはんやおやつを切らしたくない人',
    pain: '気づいたらストックが減っている',
    scene: '毎日のごはん準備',
    angle: '買い忘れを減らす',
    hooks: [
      'ペットのごはん、\n切らすとほんと焦る',
      'いつものフード、\nストックあるだけで安心',
      'ペット用品、\n気づいたら減ってる',
    ],
    nudges: [
      'ストックあるだけで気持ちがラク。',
      '切らす前に置いておきたい枠。',
    ],
    benefits: [
      '毎日のごはん準備を慌てず回せるのが助かる',
      'まとめて置けるから買い足し忘れ対策になる',
    ],
    threads: [
      'ペットのごはんって、あるのが当たり前になりすぎて切れそうな時に焦る。\n\nストックがあるだけで、毎日の小さい不安がひとつ減る。\n\nこういう安心感、地味だけどかなり大事。',
    ],
  },
];

const FALLBACK_RULE = {
  id: 'daily',
  category: 'other',
  productType: '生活アイテム',
  target: '日常の小さい不便を減らしたい人',
  pain: 'なんとなく使いにくい状態が続く',
  scene: '毎日の生活の中',
  angle: '小さい快適さ',
  hooks: [
    '小さい不便、\n放置するとずっと気になる',
    'なんか使いにくいな、\nがずっと続いてた件。',
  ],
  nudges: [
    'こういう小さい快適さ、あとで効く。',
    '地味だけど、あると生活が少し整う。',
  ],
  benefits: [
    'いつもの不便が少しラクになる',
    '生活の引っかかりがひとつ減る',
  ],
  threads: [
    '毎日の小さい不便って、慣れてしまうとそのまま放置しがち。\n\nでもひとつ減るだけで、思ったより気分が軽くなることがある。\n\n派手じゃないけど、生活を少し整えるものってそういう良さがある。',
  ],
};

function pick(list, seed = '') {
  if (!list || list.length === 0) return '';
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return list[hash % list.length];
}

function truncate(text, limit) {
  const chars = [...(text || '')];
  return chars.length > limit ? chars.slice(0, limit - 1).join('') + '…' : text;
}

function selectRule(sourceText = '') {
  const source = sourceText.toLowerCase();
  return TOPIC_RULES.find(({ pattern }) => pattern.test(source)) || FALLBACK_RULE;
}

function scoreProduct({ name = '', catchcopy = '', description = '', price = 0, reviewCount = 0, reviewAverage = 0, genre = '' }) {
  const source = `${genre} ${name} ${catchcopy} ${description}`;
  const rule = selectRule(source);
  const priceNum = Number(price) || 0;
  let score = 45;
  score += Math.min(Number(reviewAverage || 0) * 8, 38);
  score += Math.min(Math.log10(Number(reviewCount || 0) + 1) * 8, 24);
  if (priceNum >= 1200 && priceNum <= 5000) score += 10;
  if (rule.id !== 'daily') score += 12;
  if (/悩|乾燥|収納|ギフト|充電|寒|おやつ|フード|日焼け|片付け|ストック/.test(source)) score += 8;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildCopyPackage({ name = '', price = 0, url = '', catchcopy = '', description = '', genre = '', category = '', reviewCount = 0, reviewAverage = 0 }) {
  const source = `${genre} ${name} ${catchcopy} ${description} ${category}`;
  const rule = selectRule(source);
  const seed = `${name}|${price}|${genre}`;
  const hook = pick(rule.hooks, seed);
  const nudge = pick(rule.nudges, `${seed}|nudge`);
  const benefit = pick(rule.benefits, `${seed}|benefit`);
  const priceLine = `¥${Number(price).toLocaleString()}／${benefit}`;
  const xPostBody = buildStrongXPost({ name, price, url, catchcopy, description, genre, category });
  const threadsPost = pick(rule.threads, seed);
  const hookCandidates = [...rule.hooks, ...rule.nudges].join(' / ');

  return {
    category: rule.category || category || 'other',
    topicId: rule.id,
    productType: rule.productType,
    target: rule.target,
    pain: rule.pain,
    scene: rule.scene,
    angle: rule.angle,
    benefit,
    hook,
    hookCandidates,
    xPostBody,
    threadsPost,
    score: scoreProduct({ name, catchcopy, description, price, reviewCount, reviewAverage, genre }),
    sheetDraft: {
      status: '候補',
      emotionCategory: rule.angle,
      searchWord: genre,
      productType: rule.productType,
      target: rule.target,
      pain: rule.pain,
      scene: rule.scene,
      angle: rule.angle,
      benefit,
      hookCandidates,
      xPostDraft: xPostBody,
      threadsPost,
      productMemo: truncate(`${rule.productType}。${rule.target}向け。${rule.pain}を、${rule.scene}で解決する文脈。`, 120),
    },
  };
}

module.exports = {
  buildCopyPackage,
  scoreProduct,
  selectRule,
};
