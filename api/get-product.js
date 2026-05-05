// api/get-product.js
// 楽天APIで商品取得 → Geminiが最適商品を選定してXポスト文を生成

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { genre = "人気 おすすめ", maxPrice = 10000 } = req.query;

  const rakutenAppId = process.env.RAKUTEN_APP_ID;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!rakutenAppId) return res.status(500).json({ success: false, error: "RAKUTEN_APP_IDが未設定です" });
  if (!geminiKey) return res.status(500).json({ success: false, error: "GEMINI_API_KEYが未設定です" });

  try {
    // 楽天商品検索API
    const rakutenUrl = `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601?format=json&keyword=${encodeURIComponent(genre)}&applicationId=${rakutenAppId}&accessKey=${process.env.RAKUTEN_ACCESS_KEY}&affiliateId=534cdfaf.e35a1702.534cdfb0.c0ce9a58&hits=20&sort=-sold&maxPrice=${maxPrice}&imageFlag=1&availability=1`;

    const rakutenRes = await fetch(rakutenUrl, {
      headers: {
        Referer: "https://rakuten-gift-tool.vercel.app",
        Origin: "https://rakuten-gift-tool.vercel.app",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0"
      }
    });
    console.error("rakutenRes.status:", rakutenRes.status);
    const rakutenData = await rakutenRes.json();
    console.error("rakutenData:", JSON.stringify(rakutenData, null, 2));

    if (!rakutenData.Items || rakutenData.Items.length === 0) {
      return res.status(404).json({ success: false, error: "商品が見つかりませんでした" });
    }

    // 上位20件を整理
    const items = rakutenData.Items.slice(0, 20).map(({ Item }) => ({
      name: Item.itemName.slice(0, 60),
      price: Item.itemPrice,
      reviewCount: Item.reviewCount || 0,
      reviewAverage: Item.reviewAverage || 0,
      shop: Item.shopName,
      url: Item.itemUrl,
      image: Item.mediumImageUrls?.[0]?.imageUrl || "",
    }));

    // GeminiにJSON形式で最適商品を選ばせる
    const prompt = `あなたは楽天市場のアフィリエイターです。
以下の商品リストから、Xポストで最もバズりやすい商品を1つ選んでください。

選定基準：
- レビュー数が多い（人気の証拠）
- レビュー評価が高い（4.0以上優先）
- 価格がコスパ良さそう
- 商品名がわかりやすく魅力的

商品リスト：
${JSON.stringify(items, null, 2)}

以下のJSON形式のみで回答してください（他のテキスト不要）：
{
  "selectedIndex": 選んだ商品のインデックス番号(0始まり),
  "reason": "選んだ理由（日本語で50字以内）",
  "postText": "Xに投稿する文章（280字以内、絵文字あり、商品名・価格・魅力・URLを含む、ハッシュタグ2〜3個）"
}`;

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 1000 }
      }),
    });

    const geminiData = await geminiRes.json();
    const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // JSONパース
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Gemini応答のパースに失敗しました");

    const parsed = JSON.parse(jsonMatch[0]);
    const selected = items[parsed.selectedIndex] || items[0];

    return res.status(200).json({
      success: true,
      product: selected,
      reason: parsed.reason,
      postText: parsed.postText,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
