# X × 楽天アフィリエイト 自動投稿ツール

楽天商品URLまたはジャンル選択 → AIが商品分析 → Xに自動投稿するWebツール。

- 本番URL: https://x-rakuten-tool.vercel.app
- デプロイ: GitHub push → Vercel 自動デプロイ

---

## 環境変数の設定

### ローカル開発

`.env.example` をコピーして `.env.local` を作成し、各キーを入力してください。

```bash
cp .env.example .env.local
```

`.env.local` の内容例：

```
RAKUTEN_APP_ID=your_rakuten_app_id
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxx
GROQ_FAST_MODEL=llama-3.1-8b-instant
```

> **注意**: `.env.local` は `.gitignore` で除外済みです。絶対に GitHub へ push しないでください。

---

### Vercel への登録

Vercel ダッシュボード → Project → Settings → Environment Variables で各キーを登録してください。

| 変数名 | 用途 |
|---|---|
| `RAKUTEN_APP_ID` | 楽天 ShortURL API |
| `RAKUTEN_AFFILIATE_ID` | 楽天アフィリエイトID |
| `RAKUTEN_ACCESS_KEY` | 楽天APIアクセスキー |
| `GROQ_API_KEY` | Groq API（投稿文生成・商品分析） |
| `GROQ_FAST_MODEL` | 分類・JSON整形用高速モデル（省略時: llama-3.1-8b-instant） |
| `GROQ_SMART_MODEL` | 商品選定・スコアリング・フック生成用モデル（省略時: llama-3.3-70b-versatile） |
| `X_API_KEY` | X (Twitter) API Key（将来用） |
| `X_API_KEY_SECRET` | X API Secret（将来用） |
| `X_ACCESS_TOKEN` | X Access Token（将来用） |
| `X_ACCESS_TOKEN_SECRET` | X Access Token Secret（将来用） |

または CLI で追加：

```bash
vercel env add GROQ_API_KEY production
```

---

### .env.example について

`.env.example` はキー名の一覧テンプレートです。値は空欄のままリポジトリに含まれています。
新しいメンバーや環境構築時の参照用として使用してください。

---

## AI役割分担

| モデル | 環境変数 | 用途 |
|---|---|---|
| llama-3.1-8b-instant | `GROQ_FAST_MODEL` | カテゴリ分類・JSONフォーマット整形 |
| llama-3.3-70b-versatile | `GROQ_SMART_MODEL` | 商品選定スコアリング・X適性判定・独り言フック生成 |

**get-product.js の処理フロー:**
1. 楽天API から 20件取得
2. JS一次スコアリング（レビュー・価格帯・感情ワード等）→ 上位10件
3. SMART_MODEL でXバズ適性バッチスコアリング → 70pt以上でフィルタ
4. FAST_MODEL でカテゴリ分類 → 辞書から投稿文生成

**generate-post.js の処理フロー:**
1. FAST_MODEL でカテゴリ分類
2. SMART_MODEL でX適性スコア + 独り言フック生成
3. スコア70pt以上 → SMARTフック採用 / 未満 → 辞書フック

---

## ログ

投稿文生成ログは `logs/posts.json` に保存されます（Vercel環境ではコンソール出力のみ）。

---

## セキュリティ注意事項

- APIキーをコードに直書きしない
- `.env` / `.env.local` / `.env.production` を GitHub に push しない
- `.gitignore` で `.env.*` を除外済み（`.env.example` のみ許可）
- キーが漏洩した場合は即座に各サービスのダッシュボードでローテーションする
