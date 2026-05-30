// Collective "names wall" for Every 6 Seconds.
// Zero npm deps: talks to Upstash Redis over its REST API via fetch.
// Works with env vars from either Vercel KV or an Upstash Marketplace integration.
// If the store isn't configured, every response is a harmless { disabled: true } so the
// front-end simply hides the wall (graceful degradation on GitHub Pages / before setup).

const REDIS_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

const COUNT_KEY = 'e6s:count';
const LIST_KEY = 'e6s:names';
const MAX_LIST = 200; // keep the most recent 200 names
const RETURN_N = 60; // send up to 60 to the wall

// crude abuse / profanity blocklist (substring match, lowercased, spaces stripped)
const BLOCK = [
  'fuck', 'shit', 'bitch', 'nigger', 'nigga', 'cunt', 'rape', 'nazi', 'hitler',
  'penis', 'dick', 'cock', 'pussy', 'slut', 'whore', 'faggot', 'retard',
  '操你', '傻逼', '草泥马', '妈的', '日你',
];

function clean(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().slice(0, 14);
  if (!s) return null;
  // letters (any script + combining marks), spaces, hyphen, apostrophe only
  if (!/^[\p{L}\p{M}\s'’-]+$/u.test(s)) return null;
  const low = s.toLowerCase().replace(/\s/g, '');
  for (const b of BLOCK) if (low.includes(b)) return null;
  return s;
}

async function redis(...cmd) {
  const path = cmd.map((c) => encodeURIComponent(String(c))).join('/');
  const r = await fetch(REDIS_URL + '/' + path, {
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN },
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(200).json({ count: 0, names: [], disabled: true });
  }

  try {
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
      const name = clean(body && body.name);
      if (!name) return res.status(200).json({ ok: false });

      // light per-IP rate limit: 1 write / 8s
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
      const allowed = await redis('SET', 'e6s:rl:' + ip, '1', 'NX', 'EX', '8');
      if (allowed === null) return res.status(200).json({ ok: false, throttled: true });

      await redis('INCR', COUNT_KEY);
      await redis('LPUSH', LIST_KEY, name);
      await redis('LTRIM', LIST_KEY, '0', String(MAX_LIST - 1));
      const count = await redis('GET', COUNT_KEY);
      return res.status(200).json({ ok: true, count: Number(count) || 0 });
    }

    const count = await redis('GET', COUNT_KEY);
    const names = await redis('LRANGE', LIST_KEY, '0', String(RETURN_N - 1));
    return res.status(200).json({ count: Number(count) || 0, names: Array.isArray(names) ? names : [] });
  } catch (_) {
    return res.status(200).json({ count: 0, names: [], error: true });
  }
}
