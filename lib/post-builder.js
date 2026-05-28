function twitterCount(text) {
  const urls = String(text || '').match(/https?:\/\/\S+/g) || [];
  const urlActual = urls.reduce((sum, url) => sum + [...url].length, 0);
  return [...String(text || '')].length - urlActual + urls.length * 23;
}

function seededPick(list, seed = '') {
  if (!list.length) return '';
  let hash = 0;
  for (const char of String(seed)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return list[hash % list.length];
}

function cleanText(text = '') {
  return String(text)
    .replace(/【[^】]*】|\[[^\]]*\]|送料無料|ランキング|第\d+位|ポイント\d+倍|SALE|セール|楽天限定|公式|正規品/g, ' ')
    .replace(/[★☆◆◇■□◎○●♪！!]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractProductCue(name = '', catchcopy = '', genre = '') {
  const source = cleanText(`${name} ${catchcopy} ${genre}`);
  const dictionary = [
    '入浴剤', 'バスソルト', '温泉', '美容液', 'セラム', '化粧水', 'スキンケア',
    'シャンプー', 'トリートメント', 'ヘアオイル', '日焼け止め', 'クリーム',
    'お菓子', 'スイーツ', 'ラーメン', '肉', 'ステーキ', '海鮮', '魚介', 'だし',
    'イヤホン', 'ヘッドホン', 'モバイルバッテリー', '充電器', 'ヒーター', '小型家電',
    '収納', 'ケース', 'キッチン', '調理器具', '寝具', '枕', '布団',
    '犬用', '猫用', 'ペット', 'おやつ', 'フード',
    'ギフト', 'プレゼント', '花', 'タオル', '雑貨'
  ];
  const hit = dictionary.find(word => source.includes(word));
  if (hit) return hit;

  const compact = source
    .split(/[ 　/・,，、|｜]+/)
    .filter(Boolean)
    .filter(part => !/^\d|円|ml|g|kg|個|枚|本|セット|選べる|最大|限定/.test(part))
    .sort((a, b) => b.length - a.length)[0];
  return compact ? [...compact].slice(0, 12).join('') : 'これ';
}

function detectTopic(source = '') {
  const s = String(source);
  if (/入浴剤|バスソルト|温泉|マッサージ|リラックス|疲れ|癒/.test(s)) return 'relax';
  if (/美容|化粧|スキンケア|美容液|セラム|日焼け止め|クリーム|ヘア|髪|シャンプー|トリートメント/.test(s)) return 'beauty';
  if (/スイーツ|お菓子|グルメ|ラーメン|肉|ステーキ|海鮮|魚介|だし|惣菜|食/.test(s)) return 'food';
  if (/収納|キッチン|調理|寝具|枕|布団|インテリア|雑貨|掃除|生活/.test(s)) return 'home';
  if (/イヤホン|ヘッドホン|バッテリー|充電|家電|ヒーター|ガジェット/.test(s)) return 'gadget';
  if (/犬|猫|ペット|おやつ|フード/.test(s)) return 'pet';
  if (/母の日|父の日|誕生日|クリスマス|結婚|出産|祝い|ギフト|プレゼント/.test(s)) return 'gift';
  return 'daily';
}

const TOPIC_COPY = {
  relax: {
    hooks: ['疲れてる日ほど、こういうの助かる', '今日はもう頑張れない日に置いておきたい', 'お風呂の時間だけでも回復したい'],
    scenes: ['湯船に入れるだけで気持ちの切り替えがしやすい', '家で温泉気分を作れるのがかなり強い', '寝る前のだるさをほどきたい日にちょうどいい'],
    benefits: ['自分用にも、疲れてる人への小さなギフトにも使いやすい']
  },
  beauty: {
    hooks: ['毎日のケア、重いと続かないんだよね', '肌や髪の調子が気になる日に頼りたい', 'きれいでいたいけど、手間は増やしたくない'],
    scenes: ['朝やお風呂上がりにサッと使いやすいのがいい', 'いつものケアに足しやすくて、続けやすいところが現実的', '乾燥やまとまりにくさが気になる時の候補に入る'],
    benefits: ['価格も試しやすく、毎日使うものとして選びやすい']
  },
  food: {
    hooks: ['家でおいしいもの食べたい日、ある', '外食まではしんどいけど満足感はほしい', '冷蔵庫にあると未来の自分が助かる'],
    scenes: ['週末や疲れた日のごはんにそのまま楽しめる', '家にいながら少し特別感を作れるのがいい', '忙しい日でも食卓の満足感を上げやすい'],
    benefits: ['贈り物にも自分用にも使えて、ハズしにくい']
  },
  home: {
    hooks: ['生活の小さなストレス、放置すると地味に効く', '家の中って少し整うだけで気分が変わる', '毎日見る場所ほど、ラクにしたい'],
    scenes: ['置き場所や使い勝手が整うと、日々の負担が少し軽くなる', '出しっぱなしでも使いやすいものは結局続く', '片付けや家事の流れを邪魔しにくいのがいい'],
    benefits: ['価格も現実的で、生活改善の一歩として選びやすい']
  },
  gadget: {
    hooks: ['外で困る前に用意しておきたい', '毎日使うものの不便って、地味に削られる', 'こういう安心感、持ってるだけで違う'],
    scenes: ['通勤や外出先での小さな不安を減らしやすい', 'バッグに入れておくと、いざという時かなり助かる', '普段使いのストレスをちゃんと減らしてくれる'],
    benefits: ['価格も手を出しやすく、買い替え候補にも入れやすい']
  },
  pet: {
    hooks: ['うちの子用、切らすとほんと焦る', 'ペット用品はストックがあるだけで安心', '毎日のごはんやおやつ、ちゃんと選びたい'],
    scenes: ['いつもの時間にすぐ出せる安心感がある', 'ストックしておくと買い忘れ対策にもなる', '食いつきや使いやすさ重視で探してる人に合いそう'],
    benefits: ['日用品だからこそ、価格と量のバランスで選びやすい']
  },
  gift: {
    hooks: ['プレゼント選び、迷ったら実用寄りが強い', '外したくない贈り物って結局こういうの', '相手の負担にならないギフトを選びたい'],
    scenes: ['使いやすさがあるから、気軽に渡しやすい', '高すぎず安っぽく見えにくいラインを狙える', '誕生日や季節の贈り物にも合わせやすい'],
    benefits: ['自分では買わないけど、もらうと嬉しい枠に入りやすい']
  },
  daily: {
    hooks: ['これ、地味だけどあると助かるやつ', '小さな不便を減らすものって大事', '買ってから使う場面がちゃんと想像できる'],
    scenes: ['毎日の中で自然に使えるところがいい', '派手さより、ちゃんと役に立つ感じで選びやすい', '生活の中に置いておきやすい実用枠'],
    benefits: ['価格も試しやすく、必要になった時に買いやすい']
  }
};

function trimBodyForUrl(body, url = '', limit = 138) {
  let text = url ? `${body}\n${url}` : body;
  if (twitterCount(text) <= limit) return body;
  const lines = body.split('\n');
  for (let i = lines.length - 1; i >= 0 && twitterCount(text) > limit; i--) {
    while (lines[i] && twitterCount(text) > limit) {
      lines[i] = [...lines[i]].slice(0, -1).join('');
      text = url ? `${lines.join('\n')}\n${url}` : lines.join('\n');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildStrongXPost({ name = '', price = 0, url = '', catchcopy = '', description = '', genre = '', category = '' }) {
  const source = cleanText(`${genre} ${category} ${name} ${catchcopy} ${description}`);
  const topic = detectTopic(source);
  const copy = TOPIC_COPY[topic] || TOPIC_COPY.daily;
  const seed = `${name}|${price}|${genre}|${category}`;
  const cue = extractProductCue(name, catchcopy, genre);
  const hook = seededPick(copy.hooks, seed);
  const scene = seededPick(copy.scenes, `${seed}|scene`);
  const benefit = seededPick(copy.benefits, `${seed}|benefit`);
  const priceText = Number(price) ? `¥${Number(price).toLocaleString()}。${benefit}` : benefit;

  const body = `${hook}\n${cue}は、${scene}。\n${priceText}。\n迷った時の候補に入れておきたい`;
  return trimBodyForUrl(body, url, 138);
}

module.exports = {
  buildStrongXPost,
  twitterCount,
};
