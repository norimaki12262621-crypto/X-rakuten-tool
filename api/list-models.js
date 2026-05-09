module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
  const data = await r.json();
  return res.status(200).json(data);
};
