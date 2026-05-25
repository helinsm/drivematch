// Vercel serverless function — proxies DriveMatch prompt to OpenAI.
// The OpenAI API key stays server-side (set OPENAI_API_KEY in Vercel env vars).

export default async function handler(req, res) {
  // CORS — keep simple; this function only serves the DriveMatch HTML on the same domain.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing OPENAI_API_KEY' });
  }

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid prompt' });
  }
  if (prompt.length > 12000) {
    return res.status(413).json({ error: 'Prompt too large' });
  }

  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 4500,
        temperature: 0.4,
        messages: [
          { role: 'system', content: 'You are an expert used car advisor. Always respond with ONLY a JSON array, no markdown fences, no preamble.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!upstream.ok) {
      const errBody = await upstream.text();
      return res.status(502).json({ error: `OpenAI ${upstream.status}: ${errBody.slice(0, 300)}` });
    }

    const data = await upstream.json();
    const text = data?.choices?.[0]?.message?.content || '';
    if (!text) {
      return res.status(502).json({ error: 'Empty response from OpenAI' });
    }
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
}
