// api/buffer.js  —  Buffer API proxy (avoids browser CORS restriction)
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { text, access_token } = req.body;

  if (!text || text.trim() === "") return res.status(400).json({ error: "テキストが空です" });
  if (!access_token) return res.status(400).json({ error: "Buffer Access Tokenが設定されていません" });

  // Fetch connected profiles
  const profilesRes = await fetch(
    `https://api.bufferapp.com/1/profiles.json?access_token=${encodeURIComponent(access_token)}`
  );
  if (!profilesRes.ok) {
    const err = await profilesRes.json().catch(() => ({}));
    return res.status(profilesRes.status).json({
      error: err.message || "プロフィール取得失敗。Access Tokenを確認してください",
    });
  }
  const profiles = await profilesRes.json();
  if (!Array.isArray(profiles) || profiles.length === 0) {
    return res.status(400).json({ error: "連携済みプロフィールが見つかりません" });
  }

  // Queue update to all profiles
  const params = new URLSearchParams();
  params.append("access_token", access_token);
  params.append("text", text);
  profiles.forEach((p) => params.append("profile_ids[]", p.id));

  const updateRes = await fetch("https://api.bufferapp.com/1/updates/create.json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const updateData = await updateRes.json().catch(() => ({}));

  if (!updateRes.ok) {
    return res.status(updateRes.status).json({ error: updateData.message || "Buffer APIエラー" });
  }

  const services = profiles.map((p) => p.formatted_service || p.service).join(", ");
  return res.status(200).json({ success: true, profiles: profiles.length, services });
}
