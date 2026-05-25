// Vercel serverless function — proxies DriveMatch prompt to OpenAI.
// The OpenAI API key stays server-side (set OPENAI_API_KEY in Vercel env vars).
// Defenses:
//   1. No CORS wildcard. Browsers enforce same-origin since the HTML is served
//      from the same Vercel deployment.
//   2. Referer/Origin allowlist on the server side to deter curl-based abuse.
//   3. Optional IP rate limit via Upstash Redis (set UPSTASH_REDIS_REST_URL and
//      UPSTASH_REDIS_REST_TOKEN env vars). If unset, the function skips rate
//      limiting but still works.

const RATE_LIMIT_MAX = 6;            // requests per IP per window
const RATE_LIMIT_WINDOW_SEC = 60;    // window length in seconds

function getRequestHost(req) {
  const referer = req.headers.referer || req.headers.origin || '';
  try {
    return new URL(referer).hostname;
  } catch (e) {
    return '';
  }
}

function isAllowedReferer(host) {
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  // Any *.vercel.app deployment (covers production + previews)
  if (host.endsWith('.vercel.app')) return true;
  return false;
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

// Returns { allowed: boolean, remaining: number, retryAfter?: number }
async function checkRateLimit(ip) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return { allowed: true, remaining: -1 }; // not configured — skip

  const key = `drivematch:rl:${ip}`;
  try {
    // INCR + EXPIRE in a pipeline
    const resp = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, RATE_LIMIT_WINDOW_SEC, 'NX'],
      ]),
    });
    if (!resp.ok) return { allowed: true, remaining: -1 }; // fail open on rate-limiter outage
    const results = await resp.json();
    const count = Number(results?.[0]?.result || 0);
    const allowed = count <= RATE_LIMIT_MAX;
    return {
      allowed,
      remaining: Math.max(0, RATE_LIMIT_MAX - count),
      retryAfter: allowed ? undefined : RATE_LIMIT_WINDOW_SEC,
    };
  } catch (e) {
    return { allowed: true, remaining: -1 }; // fail open
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Referer/Origin allowlist — blocks direct curl from random origins.
  const refererHost = getRequestHost(req);
  if (!isAllowedReferer(refererHost)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Rate limit per IP (no-op if Upstash env vars aren't set)
  const ip = getClientIp(req);
  const limit = await checkRateLimit(ip);
  if (!limit.allowed) {
    if (limit.retryAfter) res.setHeader('Retry-After', String(limit.retryAfter));
    return res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
  }

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
