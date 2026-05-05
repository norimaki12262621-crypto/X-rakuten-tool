// api/post-tweet.js
// Vercel Serverless Function — X (Twitter) v2 API投稿エンドポイント
//
// 【設置方法】
// このファイルを /api/post-tweet.js に配置してください
//
// 【Vercel環境変数に以下を設定】
// X_API_KEY
// X_API_SECRET
// X_ACCESS_TOKEN
// X_ACCESS_TOKEN_SECRET

import crypto from "crypto";

export default async function handler(req, res) {
  // CORS設定
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { text } = req.body;

  if (!text || text.trim() === "") {
    return res.status(400).json({ error: "投稿テキストが空です" });
  }

  if ([...text].length > 280) {
    return res.status(400).json({ error: "文字数が280字を超えています" });
  }

  const apiKey        = process.env.X_API_KEY;
  const apiSecret     = process.env.X_API_SECRET;
  const accessToken   = process.env.X_ACCESS_TOKEN;
  const accessSecret  = process.env.X_ACCESS_TOKEN_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    return res.status(500).json({ error: "X APIキーが設定されていません（環境変数を確認）" });
  }

  try {
    const tweetUrl = "https://api.twitter.com/2/tweets";
    const oauthHeader = buildOAuthHeader("POST", tweetUrl, apiKey, apiSecret, accessToken, accessSecret);

    const response = await fetch(tweetUrl, {
      method: "POST",
      headers: {
        "Authorization": oauthHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("X API error:", data);
      return res.status(response.status).json({ error: data?.detail || "X APIエラー", detail: data });
    }

    return res.status(200).json({ success: true, tweet_id: data.data?.id });

  } catch (err) {
    console.error("Unexpected error:", err);
    return res.status(500).json({ error: "サーバーエラー: " + err.message });
  }
}

// ---- OAuth 1.0a 署名生成 ----
function buildOAuthHeader(method, url, apiKey, apiSecret, accessToken, accessSecret) {
  const nonce     = crypto.randomBytes(16).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams = {
    oauth_consumer_key:     apiKey,
    oauth_nonce:            nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp:        timestamp,
    oauth_token:            accessToken,
    oauth_version:          "1.0",
  };

  // 署名ベース文字列の作成
  const paramString = Object.keys(oauthParams)
    .sort()
    .map(k => `${encode(k)}=${encode(oauthParams[k])}`)
    .join("&");

  const baseString = [method.toUpperCase(), encode(url), encode(paramString)].join("&");

  // 署名キー
  const signingKey = `${encode(apiSecret)}&${encode(accessSecret)}`;

  // HMAC-SHA1署名
  const signature = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");

  oauthParams["oauth_signature"] = signature;

  const headerValue = "OAuth " + Object.keys(oauthParams)
    .sort()
    .map(k => `${encode(k)}="${encode(oauthParams[k])}"`)
    .join(", ");

  return headerValue;
}

function encode(str) {
  return encodeURIComponent(String(str))
    .replace(/!/g, "%21").replace(/'/g, "%27")
    .replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\*/g, "%2A");
}
