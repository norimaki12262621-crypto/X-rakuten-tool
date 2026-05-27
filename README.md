# X × 楽天 半自動投稿ツール

楽天商品をAIがスコアリング・投稿文生成し、Googleスプレッドシートに蓄積。  
人間が確認・編集してXに投稿する**半自動運用ツール**です。（完全自動投稿ではありません）

デプロイ先: https://x-rakuten-tool.vercel.app

---

## プロジェクト概要

### 半自動運用フロー

```
1. [ジャンル選択タブ] 感情カテゴリ・予算を選んで「📋 5件ストック生成」
   → 楽天商品を検索してAIスコアリング → 上位5件をスプレッドシートに保存

2. 「✍️ 未生成の投稿文を作る」ボタン
   → スプレッドシートの「未確認」商品（最大5件）に投稿文を生成してシートに書き込む

3. スプレッドシートを開いて投稿文を確認・編集
   → 問題なければXへ手動投稿（またはBufferに追加）

4. 投稿日・反応メモ列に記録
```

このフローにより、毎日数分の作業で複数の投稿候補を蓄積・管理できます。

---

## Google Sheets API 設定方法

### 1. Google Cloud Console でサービスアカウントを作成

1. https://console.cloud.google.com/ にアクセス
2. 新しいプロジェクトを作成（または既存のプロジェクトを選択）
3. 左メニュー →「APIとサービス」→「ライブラリ」
4. 「Google Sheets API」を検索して有効化
5. 「APIとサービス」→「認証情報」→「認証情報を作成」→「サービスアカウント」
6. サービスアカウント名を入力（例: `x-rakuten-sheets`）→「作成して続行」
7. ロール: 「編集者」または「基本 > 編集者」→「続行」→「完了」
8. 作成したサービスアカウントをクリック → 「キー」タブ → 「鍵を追加」→「新しい鍵を作成」→「JSON」→「作成」
9. JSONファイルがダウンロードされます（大切に保管してください）

### 2. スプレッドシートを作成・共有

1. https://docs.google.com/spreadsheets/create で新しいスプレッドシートを作成
2. URLから**スプレッドシートID**をコピー
   - URL例: `https://docs.google.com/spreadsheets/d/`**`1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms`**`/edit`
3. 「共有」ボタン → ダウンロードしたJSONの `client_email` の値をコピーして貼り付け
4. 権限を「編集者」に設定して共有

### 3. 環境変数の設定

ダウンロードしたJSONファイルから以下の値を取得します：

| 変数名 | JSONのキー | 説明 |
|--------|-----------|------|
| `GOOGLE_SHEET_ID` | — | スプレッドシートURLの中のID |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` | サービスアカウントのメールアドレス |
| `GOOGLE_PRIVATE_KEY` | `private_key` | 秘密鍵（改行処理が必要） |

### 4. Vercel Environment Variables の設定

```
Vercel Dashboard → プロジェクト → Settings → Environment Variables
```

各変数を追加してください。特に `GOOGLE_PRIVATE_KEY` は下記の注意点を参照。

### 5. GOOGLE_PRIVATE_KEY の改行問題への対処法

JSONファイル内の `private_key` はそのままでは使えません。

**方法A（推奨）: 改行を `\n` に変換してから貼り付け**

PowerShellで変換：
```powershell
$json = Get-Content "path\to\service-account.json" | ConvertFrom-Json
$json.private_key -replace "`n", "\n"
```

出力された1行の文字列を `GOOGLE_PRIVATE_KEY` の値として貼り付けます。

**方法B: Vercelの改行対応**

Vercel の Environment Variables 入力欄では実際の改行（Enterキー）を含めて貼り付け可能です。  
その場合は変換不要です。

---

## スプレッドシートの列構成（28列）

| 列 | カラム名 | 説明 |
|----|---------|------|
| A | 保存日時 | 商品をストックした日時 |
| B | 状態 | `未確認` → `投稿文生成済み` → （手動で`投稿済み`に変更） |
| C | 感情カテゴリ | 選択した感情ラベル（癒されたい 等） |
| D | 検索ワード | 実際にヒットした楽天検索ワード |
| E | 商品名 | 楽天商品名（整形済み） |
| F | 商品価格 | 円（数値） |
| G | 商品URL | 短縮URL（a.r10.to または tinyurl） |
| H | 商品画像URL | 楽天商品画像URL |
| I | JSスコア | JavaScript一次スコア（0-100） |
| J | X適性スコア | AIバッチスコア（0-100） |
| K-R | 各スコア詳細 | emotionScore / impulseScore 等（将来拡張用） |
| S | emotion | 感情タグ |
| T | pain | 悩みタグ |
| U | season | 季節タグ |
| V | angle | 投稿切り口 |
| W | scene | 情景・感情の切り抜き |
| X | HOOK候補 | 5案を「 / 」区切りで保存 |
| Y | 投稿文たたき台 | AI生成の投稿文（編集前） |
| Z | 最終投稿文 | 実際に投稿する文（編集済み） |
| AA | 投稿日 | 手動で記入 |
| AB | 反応メモ | いいね数・RT数など手動記入 |

---

## 各ボタンの説明

### 📋 5件ストック生成（ジャンル選択タブ内）

- 選択した感情カテゴリ・予算で楽天商品を検索
- AIスコアリングで上位5件を選定
- 重複チェックをしてスプレッドシートに追加
- 状態は`未確認`、投稿文は空の状態で保存

### ✍️ 未生成の投稿文を作る（sheet-panel）

- スプレッドシートの`未確認`かつ`最終投稿文`が空の行を最大5件取得
- Groq AIで感情分析・HOOK生成・投稿文生成
- 状態を`投稿文生成済み`に更新してシートに書き込む

### 🔍 分析してポスト文を生成（通常の使い方）

- URL入力タブ: 楽天URLから商品取得→投稿文即時生成
- ジャンル選択タブ: カテゴリ検索→1件選定→投稿文即時生成（シートには保存しない）

---

## スプレッドシートの状態管理

```
未確認
 ↓（「✍️ 未生成の投稿文を作る」実行後）
投稿文生成済み
 ↓（スプレッドシートで確認・編集後、手動で変更）
投稿済み
```

B列（状態）を手動で更新することで、投稿管理ができます。

---

## 環境変数一覧

`.env.example` を参照してください。必須の環境変数：

- `GROQ_API_KEY`: Groq APIキー（https://console.groq.com/）
- `RAKUTEN_APP_ID`: 楽天アプリID
- `GOOGLE_SHEET_ID`: GoogleスプレッドシートID
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: サービスアカウントのメール
- `GOOGLE_PRIVATE_KEY`: サービスアカウントの秘密鍵
