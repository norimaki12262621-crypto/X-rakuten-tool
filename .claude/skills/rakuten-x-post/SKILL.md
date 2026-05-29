---
name: rakuten-x-post
description: Use this skill when working on this Rakuten affiliate X posting tool, especially when generating, reviewing, saving, or refining X posts, Threads posts, product selection logic, Google Sheets rows, Rakuten affiliate URLs, or Claude review behavior.
---

# Rakuten X Post Skill

This project is a Rakuten affiliate product selection and social post tool.
The main goal is to create X posts that feel like natural Japanese daily-life observations while still matching the selected product.

Use this skill whenever editing or reviewing:

- `api/generate-post.js`
- `api/get-product.js`
- `api/generate-sheet-posts.js`
- `api/claude-review.js`
- `api/save-to-sheet.js`
- `api/shorten-url.js`
- `lib/post-builder.js`
- `lib/copy-engine.js`
- `index.html`
- Google Sheets output columns for posts, products, URLs, or status

## Non-Negotiable Rules

- Do not use TinyURL.
- Product URLs must be either Rakuten affiliate URLs, `a.r10.to` URLs, or original Rakuten affiliate URLs returned by the app.
- Never route users through `tinyurl.com/preview`, deprecated TinyURL preview pages, or any unrelated redirect service.
- Keep X posts within 140 X-count characters including the URL, treating URLs as 23 characters.
- Target X post length is 100-130 X-count characters including the URL.
- If a generated or reviewed X post is under 95 X-count characters before URL, strengthen it instead of accepting it.
- Do not let Claude review shorten a good draft into a tiny emotional one-liner.
- The final X post must match the actual product.
- The product type or concrete cue must appear in the post, such as `美容液`, `入浴剤`, `スイーツ`, `キッチン`, `収納`, `イヤホン`, `犬用`, or `ギフト`.
- Do not write generic copy that could fit any product.
- Do not use hard-sell language.
- Avoid `おすすめ`, `買うべき`, `人気`, `高評価`, `レビュー多数`, `売れてます`, `今すぐ`, and similar salesy phrasing.
- Do not claim effects that are not safely supported by the product information.
- Do not break existing spreadsheet columns or status values.
- Do not overwrite user-edited sheet content unless the target workflow explicitly updates that row.

## X Post Shape

Use this structure:

```text
悩み・場面の一言
商品ジャンル/具体要素は、使う場面でどう助かるか。
¥価格。ベネフィット。
候補に入れておきたい一言
URL
```

Good examples:

```text
毎日のケア、重いと続かないんだよね
美容液は、いつものケアに足しやすくて、続けやすいところが現実的。
¥3,960。価格も試しやすく、毎日使うものとして選びやすい。
迷った時の候補に入れておきたい
```

```text
今日はもう頑張れない日に置いておきたい
入浴剤は、家で温泉気分を作れるのがかなり強い。
¥3,630。自分用にも、疲れてる人への小さなギフトにも使いやすい。
迷った時の候補に入れておきたい
```

```text
家の中って少し整うだけで気分が変わる
キッチンは、置き場所や使い勝手が整うと日々の負担が少し軽くなる。
¥3,960。価格も現実的で、生活改善の一歩として選びやすい。
迷った時の候補に入れておきたい
```

Bad examples:

```text
玄関だけ、なんか整ってる
URL
```

Too short and too vague.

```text
これは絶対おすすめ！人気で高評価の収納グッズです！
URL
```

Too salesy.

```text
疲れてる日に助かる
URL
```

Too generic and does not mention the product.

## Category Cues

When product names are noisy, extract one concrete cue and use it in the post.

- Beauty: `美容液`, `セラム`, `化粧水`, `スキンケア`, `日焼け止め`, `シャンプー`, `ヘアオイル`
- Relaxation: `入浴剤`, `バスソルト`, `温泉`, `マッサージ`
- Food: `スイーツ`, `お菓子`, `ラーメン`, `肉`, `ステーキ`, `海鮮`, `だし`
- Home: `収納`, `キッチン`, `調理器具`, `寝具`, `枕`, `布団`, `インテリア`
- Gadget: `イヤホン`, `ヘッドホン`, `モバイルバッテリー`, `充電器`, `ヒーター`, `小型家電`
- Pet: `犬用`, `猫用`, `ペット`, `おやつ`, `フード`
- Gift: `ギフト`, `プレゼント`, `花`, `タオル`, `雑貨`

If the cue is unclear, use a shorter concrete noun from the product name, not the full SEO-stuffed name.

## Product Matching

Before accepting a post, check:

- Does the text mention a product cue from the actual product?
- Does the use scene make sense for that product?
- Does the price line match the product price?
- Does the URL belong to the product row?
- Is the copy specific enough that it would not fit every product?

If any answer is no, rewrite the post.

## Claude Review Behavior

Claude review is for polishing, not shrinking.

When editing `api/claude-review.js`:

- Preserve or improve a strong draft.
- Do not reduce a draft to a one-line emotional hook.
- If Claude returns a weak short `xPost`, fall back to deterministic strengthening logic.
- Keep short-post detection around 95 X-count characters before URL.
- Review existing `監修済み` rows if their final post is too short.
- Process newest rows first when fixing short reviewed posts.

## Google Sheets Workflow

The sheet is a production queue.

Typical statuses:

- `未確認`: product saved, post not ready
- `投稿文生成済み`: draft generated
- `監修済み`: final post reviewed

Important columns:

- Product name: column E
- Price: column F
- Product URL: column G
- Draft X post: column Y
- Final X post: column Z
- Threads post: column AC

Do not change the sheet structure without checking dependent code.

## URL Rules

When editing URL behavior:

- `api/shorten-url.js` must not fall back to TinyURL.
- If Rakuten ShortUrl succeeds, `provider` may be `rakuten`.
- If Rakuten ShortUrl is unavailable, return the original URL with `provider: "original"`.
- Existing old TinyURL rows may remain in the sheet, but new rows must not create TinyURL links.

Expected test:

```text
/api/shorten-url?url=https%3A%2F%2Fhb.afl.rakuten.co.jp%2Fhgc%2Ftest
```

Good result:

```json
{"shortUrl":"https://hb.afl.rakuten.co.jp/hgc/test","provider":"original"}
```

or:

```json
{"shortUrl":"https://a.r10.to/...","provider":"rakuten"}
```

Bad result:

```json
{"shortUrl":"https://tinyurl.com/...","provider":"tinyurl"}
```

## Verification Checklist

After changes, verify:

- `api` folder has no more than 12 serverless function files for Vercel Hobby.
- `node --check` passes for changed JS files.
- New generated X posts are usually 100-130 X-count characters including URL.
- Posts include a product cue.
- Product text and product name match.
- URLs are not TinyURL.
- Vercel deployment reaches `Ready`.
- A fresh Google Sheets row shows improved final copy.

## Tone

The best copy feels like a person quietly noticing a useful thing in daily life.
Use natural Japanese.
Use empathy and specificity.
Avoid influencer hype.
Avoid sterile product descriptions.
Avoid ending every post the same way if improving copy generation.
