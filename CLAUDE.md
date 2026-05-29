# X × 楽天 自動投稿ツール — CLAUDE.md

## プロジェクト概要
楽天商品URLまたはジャンル選択 → AIが商品分析 → Xに自動投稿するWebツール
- デプロイ先: https://x-rakuten-tool.vercel.app
- リポジトリ: https://github.com/norimaki12262621-crypto/X-rakuten-tool
- Vercel自動デプロイ: `git push` で本番に自動反映

## 環境
- プラットフォーム: Windows 11 / PowerShell
- デプロイ: Vercel (Serverless Functions, Node.js)
- 手動デプロイ不要（GitHub連携で自動デプロイ）

## ファイル構成
```
index.html          フロントエンド（タブUI: URL入力 / ジャンル選択）
api/
  rakuten.js        楽天 Ichiba API プロキシ
  get-product.js    ジャンル検索 → Geminiで商品選定・投稿文生成
  get-product-url.js URL解析 → shopCode / itemCode 抽出
  generate-post.js  Geminiで140字投稿文生成
  shorten-url.js    URL短縮（Rakuten ShortURL → original fallback）
  get-image.js      商品ページから画像取得
  post-tweet.js     X（Twitter）API投稿
  buffer.js         Buffer API プロキシ（Bufferへのキュー追加）
```

## 実装済み機能

### URL入力タブ
1. 楽天商品URL（item.rakuten.co.jp または a.r10.to）を入力
2. `/api/get-product-url` でshopCode/itemCode抽出
3. `/api/rakuten` + `/api/get-image` を並列実行
4. `/api/shorten-url` でアフィリエイトURLを短縮（a.r10.to or original）
5. `/api/generate-post` でGeminiが140字以内の投稿文生成

### ジャンル選択タブ
- プリセットチップからジャンル選択 + 予算上限設定
- `/api/get-product` でGeminiが商品選定＋投稿文生成まで一括処理

### 投稿文エリア
- 編集可能テキストエリア
- Twitter換算文字数カウント（URL=23字換算）140字制限
- 📋 コピーボタン（2秒後に元に戻る）
- 𝕏 に投稿ボタン
- Buffer に追加ボタン

### Buffer連携
- ⚙ Buffer設定パネル（collapsible）でAccess Token入力・localStorage保存
- `/api/buffer` サーバーサイドプロキシ経由でCORSを回避
- 全プロフィールにキュー追加

## 環境変数（Vercel設定済み）
| 変数名 | 用途 |
|---|---|
| `GEMINI_API_KEY` | Google Gemini API（投稿文生成） |
| `RAKUTEN_APP_ID` | 楽天ShortURL API（a.r10.to短縮） |
| `RAKUTEN_AFFILIATE_ID` | 楽天アフィリエイトID |
| `RAKUTEN_ACCESS_KEY` | 楽天APIアクセスキー |
| `X_API_KEY` | X（Twitter）API Key |
| `X_API_SECRET` | X API Secret |
| `X_ACCESS_TOKEN` | X Access Token |
| `X_ACCESS_TOKEN_SECRET` | X Access Token Secret |

## 重要な実装メモ

### Gemini API
- モデル: `gemini-2.0-flash-lite` (v1beta)
- 投稿文は**2行のみ**生成させ、URLはサーバー側で3行目に結合
- 140字超過時はサーバー側でトリム（2行目 → 1行目の順で削る）
- Twitter URL換算: `[...text].length - urlActualLen + urls.length * 23`
- **2026-05-20: 無料枠クォータ超過（429）→ 翌日リセット後確認予定**
  - エラー時は `"Gemini APIエラー(429): ..."` と表示される

### 楽天API
- applicationId: UUID形式（`9a9bb16b-...`）→ Ichiba検索APIのみ対応
- `RAKUTEN_APP_ID`: 数値ID → ShortURL APIに使用
- itemCode問題: URLスラッグ（例: `brt-fs145`）は内部itemCodeと別物
  → URLスラッグをkeyword検索にフォールバックして解決

### URL短縮
- `RAKUTEN_APP_ID` あり → `app.rakuten.co.jp/services/api/ShortUrl` (a.r10.to)
- なし → 元の楽天アフィリエイトURLを返す（TinyURLは使わない）

### Vercel ログ確認方法
```powershell
# リアルタイム（新規リクエスト待ち）
vercel logs https://x-rakuten-tool.vercel.app

# デプロイ一覧
vercel ls
```
- ランタイムログはリアルタイムのみ（履歴なし）
- 設定ファイル: `C:\Users\marik\AppData\Roaming\com.vercel.cli\Data\auth.json`

## 作業履歴（2026-05-20）
- Buffer API連携追加（api/buffer.js、Buffer設定パネル）
- 楽天APIのitemCodeエラー修正（URLスラッグ→keyword検索fallback）
- Gemini投稿文生成追加（api/generate-post.js）
- URL短縮API追加（api/shorten-url.js）
- 140文字カウント実装（Twitter URL=23字換算、サーバー側保証）
- コピーボタン追加
- Geminiプロンプト改善（絵文字+キャッチコピー / 商品魅力+価格 / URL）
- Gemini APIエラー表示改善（429クォータ超過を明示）
