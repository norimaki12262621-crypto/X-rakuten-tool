const DAY_NAMES = ['月', '火', '水', '木', '金', '土', '日'];

function cleanText(text = '') {
  return String(text)
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function productCue(name = '', category = '') {
  const source = `${name} ${category}`;
  const words = [
    '入浴剤', '美容液', 'セラム', '化粧水', 'クリーム', 'シャンプー', 'ヘアオイル',
    'スイーツ', 'お菓子', 'ラーメン', 'ステーキ', '海鮮', 'だし',
    '収納', 'キッチン', 'ラック', 'ケース', '寝具', '枕',
    'イヤホン', 'モバイルバッテリー', 'ヒーター',
    '犬用', '猫用', 'ペット', 'ギフト', 'プレゼント'
  ];
  const hit = words.find(word => source.includes(word));
  if (hit) return hit;
  return cleanText(name).split(/[ 　/・,，、|｜]+/).filter(Boolean)[0] || 'これ';
}

function detectTheme(source = '') {
  if (/乾燥|保湿|美容|肌|髪|スキンケア|クリーム|美容液|セラム|ヘア/.test(source)) return 'care';
  if (/入浴|お風呂|温泉|疲れ|癒|リラックス/.test(source)) return 'relax';
  if (/収納|片付け|キッチン|玄関|部屋|ラック|ケース/.test(source)) return 'home';
  if (/スイーツ|お菓子|グルメ|食|肉|海鮮|ラーメン/.test(source)) return 'food';
  if (/ギフト|プレゼント|祝い|母の日|父の日/.test(source)) return 'gift';
  return 'daily';
}

function topicCopy(theme) {
  const map = {
    care: {
      label: '乾燥ケア週間',
      opener: '乾燥って、気づいた時にはもうだいぶしんどい。',
      worry: 'ちゃんとケアしなきゃと思うほど、手順が重くなる日がある。',
      question: '冬の保湿、顔より先に手とか髪が限界くる人いませんか。',
      summary: '今週思ったのは、ケアは気合いより置き場所と使いやすさで続くということ。'
    },
    relax: {
      label: '疲れリセット週間',
      opener: '疲れてる日って、お風呂に入るまでがいちばん遠い。',
      worry: '湯船に入れば少し戻れるのに、そこまでの数分が妙に重い。',
      question: 'みんなは疲れてる日に、これだけはやるって決めてることありますか。',
      summary: '今週は、回復って大げさなことじゃなくていいんだなと思った。'
    },
    home: {
      label: '部屋整え週間',
      opener: '部屋が散らかってるというより、頭の中が散らかってる感じの日がある。',
      worry: 'ものの置き場所が決まってないだけで、帰ってきた瞬間に少し疲れる。',
      question: '家の中でいちばん散らかりやすい場所、どこですか。',
      summary: '今週は、片付けって気合いじゃなくて迷う回数を減らすことだと思った。'
    },
    food: {
      label: 'ご褒美ごはん週間',
      opener: '家でおいしいものを食べたい日、ある。',
      worry: '外食まではしんどいけど、ちゃんと満足感はほしい。',
      question: '疲れた日のごはん、みんなは何に頼ってますか。',
      summary: '今週は、食べる楽しみがあるだけで一日が少し戻る感じがした。'
    },
    gift: {
      label: 'プレゼント迷子週間',
      opener: 'プレゼント選びって、相手の顔を思い浮かべるほど迷う。',
      worry: '外したくない時ほど、派手さより使いやすさを選びたくなる。',
      question: '贈り物って、実用的なものともらって嬉しいもののバランスが難しい。',
      summary: '今週は、贈り物はセンスより相手の負担にならないことが大事だと思った。'
    },
    daily: {
      label: '暮らし整え週間',
      opener: '生活って、小さな不便が積み重なると急に重くなる。',
      worry: '大きく変えたいわけじゃなくて、少しだけラクにしたい日がある。',
      question: '最近、これあると地味に助かるなと思ったものありますか。',
      summary: '今週は、小さく整えるだけでも気分はけっこう変わると思った。'
    }
  };
  return map[theme] || map.daily;
}

function productPost(product, theme, index) {
  const cue = productCue(product.name, product.category);
  const url = product.url ? `\n${product.url}` : '';
  const variants = [
    `${cue}って、何かを劇的に変えるものではないけど、日々の小さな面倒を減らしてくれる感じがある。\n\n使う場面がちゃんと想像できるものは、買ったあとも残りやすい。${url}`,
    `最近思うけど、続くものって「すごいもの」より「手に取りやすいもの」なんだよね。\n\n${cue}も、生活の中に置いておきやすいかどうかでかなり変わる。${url}`,
    `${cue}は、必要になった時に探すより、先に候補に入れておく方がラクなタイプかもしれない。\n\n忙しい時ほど、こういう小さな準備が効く。${url}`
  ];
  return variants[index % variants.length];
}

function appendUrl(text = '', url = '') {
  const cleanUrl = String(url || '').trim();
  if (!cleanUrl) return text;
  if (String(text).includes(cleanUrl)) return text;
  return `${String(text).trim()}\n${cleanUrl}`;
}

function buildWeeklyThreadsPlan(products = [], startDate = new Date()) {
  const usable = products.filter(p => p.name || p.url);
  const base = usable[0] || {};
  const theme = detectTheme(`${base.category || ''} ${base.name || ''} ${base.post || ''}`);
  const copy = topicCopy(theme);
  const weekLabel = copy.label || '暮らし整え週間';
  const rows = [];
  const types = ['導入', '商品あり', '悩み深掘り', '日常', '商品あり', 'まとめ', '次週への問い'];
  const productPosts = usable.filter(p => p.name || p.url);

  for (let i = 0; i < 7; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const isProductPost = i === 1 || i === 4;
    const productIndex = i === 1 ? 0 : 1;
    const product = isProductPost
      ? (productPosts[productIndex] || productPosts[0] || {})
      : {};
    let text;
    if (i === 0) text = `今週は「${weekLabel}」でいきます。\n\n${copy.opener}\n\n${copy.worry}\n\nがんばるより、少し軽くする方法を先に置いておきたい。`;
    else if (i === 1 || i === 4) text = productPost(product, theme, i === 1 ? 0 : 1);
    else if (i === 2) text = `「${weekLabel}」3日目。\n\n${copy.question}\n\n私は最近、気合いでどうにかするより、先にラクな形を作っておく方が合ってる気がしてる。`;
    else if (i === 3) text = `「${weekLabel}」4日目。\n\n${copy.worry}\n\nべつに大したことじゃないんだけど、そういう小さい重さって毎日だとちゃんと効いてくる。`;
    else if (i === 5) text = `「${weekLabel}」のまとめ。\n\n${copy.summary}\n\n全部をちゃんとするより、戻れる場所をひとつ作っておくくらいでいいのかもしれない。`;
    else text = `「${weekLabel}」最終日。\n\n来週の自分を少し助けるために、今日ひとつだけやるなら何にしますか。`;

    rows.push({
      date: date.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }),
      day: DAY_NAMES[i],
      type: types[i],
      theme: weekLabel,
      productName: product.name || '',
      url: product.url || '',
      text: isProductPost ? appendUrl(text, product.url) : text,
      status: '未投稿',
    });
  }

  return rows;
}

module.exports = {
  buildWeeklyThreadsPlan,
};
