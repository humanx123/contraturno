import { ensureSchema } from './schema.js';

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('pbkdf2:')) return false;
  const [, saltHex, hashHex] = stored.split(':');
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    keyMaterial, 256
  );
  const computed = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
  return computed === hashHex;
}

function makeToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `ct_${b64}`;
}

export async function onRequestOptions() {
  return json({ ok: true });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "DB binding missing" }, 500);
  await ensureSchema(env.DB);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "JSON inválido" }, 400); }

  const nickname = String(body.nickname || "").trim();
  const password = String(body.password || "").trim();

  if (!nickname || !password) {
    return json({ ok: false, error: "Nickname y contraseña requeridos." }, 400);
  }

  const user = await env.DB.prepare(
    'SELECT id, nickname, role, password_hash FROM users WHERE nickname = ?'
  ).bind(nickname).first();

  if (!user) {
    return json({ ok: false, error: "Nickname o contraseña incorrectos." }, 401);
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return json({ ok: false, error: "Nickname o contraseña incorrectos." }, 401);
  }

  // Issue a new session token
  const token = makeToken();
  const tokenHash = await sha256Hex(token);

  await env.DB.prepare(
    'UPDATE users SET token_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(tokenHash, user.id).run();

  return json({
    ok: true,
    user: { id: user.id, nickname: user.nickname, role: user.role },
    token
  });
}
