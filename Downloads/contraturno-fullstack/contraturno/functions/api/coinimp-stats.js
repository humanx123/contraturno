import { ensureSchema } from './schema.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function authUser(env, request) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const hash = await sha256Hex(token);
  return env.DB.prepare(
    'SELECT id, coinimp_api_id, coinimp_api_key, coinimp_site_key FROM users WHERE token_hash = ?'
  ).bind(hash).first();
}

async function coinimpFetch(path, apiId, apiKey, params = {}) {
  const url = new URL(`https://www.coinimp.com/api/v2/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.href, {
    headers: { 'X-API-ID': apiId, 'X-API-KEY': apiKey }
  });
  if (!res.ok) throw new Error(`CoinIMP ${path} HTTP ${res.status}`);
  return res.json();
}

export async function onRequest({ request, env }) {
  await ensureSchema(env.DB);

  if (request.method === 'OPTIONS') return json({ ok: true });

  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);

  const user = await authUser(env, request);
  if (!user) return json({ ok: false, error: 'No autenticado' }, 401);

  if (!user.coinimp_api_id || !user.coinimp_api_key) {
    return json({ ok: false, error: 'API credentials not configured', code: 'NO_CREDS' }, 200);
  }

  const currency = 'mintme';
  const siteKey = user.coinimp_site_key || undefined;
  const params = { currency, ...(siteKey ? { 'site-key': siteKey } : {}) };

  try {
    const [hashesData, rewardData] = await Promise.all([
      coinimpFetch('hashes', user.coinimp_api_id, user.coinimp_api_key, params),
      coinimpFetch('reward', user.coinimp_api_id, user.coinimp_api_key, params),
    ]);

    return json({
      ok: true,
      stats: {
        hashes: hashesData.message ?? hashesData,
        reward: rewardData.message ?? rewardData,
        currency,
        fetched_at: new Date().toISOString(),
      }
    });
  } catch (err) {
    return json({ ok: false, error: err.message }, 502);
  }
}
