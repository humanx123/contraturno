import { ensureSchema } from "./schema.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bearerToken(request) {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function authUser(env, request) {
  const token = bearerToken(request);
  if (!token) return null;

  const hash = await sha256Hex(token);

  return await env.DB.prepare(
    "SELECT id, nickname, email, role, donation_url, compute_enabled, coinimp_site_key, coinimp_script_url FROM users WHERE token_hash = ?"
  ).bind(hash).first();
}

function cleanUrl(value, max = 700) {
  const url = String(value || "").trim().slice(0, max);
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) throw new Error("La URL debe empezar con http:// o https://");
  return url;
}

function cleanSiteKey(value) {
  const key = String(value || "").trim();
  if (!key) return "";
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error("La site-key debe tener 64 caracteres hexadecimales.");
  return key;
}

function publicProfile(row) {
  if (!row) return null;

  const enabled = Number(row.compute_enabled || 0) === 1 && Boolean(row.coinimp_site_key);

  return {
    user_id: row.id,
    nickname: row.nickname,
    donation_url: row.donation_url || "",
    compute_enabled: enabled,
    coinimp_site_key: enabled ? row.coinimp_site_key : "",
    coinimp_script_url: enabled ? (row.coinimp_script_url || "https://www.hostingcloud.racing/zvE1.js") : ""
  };
}

function privateProfile(row) {
  if (!row) return null;

  return {
    user_id: row.id,
    nickname: row.nickname,
    email: row.email || "",
    role: row.role,
    donation_url: row.donation_url || "",
    compute_enabled: Number(row.compute_enabled || 0) === 1,
    coinimp_site_key: row.coinimp_site_key || "",
    coinimp_script_url: row.coinimp_script_url || "https://www.hostingcloud.racing/zvE1.js",
    coinimp_api_id: row.coinimp_api_id || "",
    coinimp_api_key: row.coinimp_api_key || "",
  };
}

async function verifyToken(tokenHash, DB) {
  const user = await DB.prepare(
    'SELECT id, nickname, email FROM users WHERE token_hash = ?'
  ).bind(tokenHash).first();
  return user;
}

function validateHttpUrl(url) {
  if (!url) return true;
  return url.startsWith('http://') || url.startsWith('https://');
}

function validateCoinimpSiteKey(key) {
  if (!key) return true;
  return /^[a-f0-9]{64}$/.test(key);
}

export async function onRequest(context) {
  const { request, env } = context;
  const DB = env.DB;
  if (DB) await ensureSchema(DB);
  const url = new URL(request.url);

  if (request.method === 'GET') {
    try {
      const mine = url.searchParams.get('mine');
      const userId = url.searchParams.get('user_id');

      if (mine === '1') {
        const auth = request.headers.get('authorization');
        if (!auth || !auth.startsWith('Bearer ')) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const token = auth.slice(7);
        const tokenHash = await sha256Hex(token);
        const user = await verifyToken(tokenHash, DB);

        if (!user) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Invalid token' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const profile = await DB.prepare(
          'SELECT * FROM users WHERE id = ?'
        ).bind(user.id).first();

        return new Response(
          JSON.stringify({ ok: true, profile }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (userId) {
        const row = await DB.prepare(
          'SELECT id, nickname, donation_url, compute_enabled, coinimp_site_key, coinimp_script_url FROM users WHERE id = ?'
        ).bind(userId).first();

        if (!row) {
          return new Response(
            JSON.stringify({ ok: false, error: 'User not found' }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ ok: true, profile: publicProfile(row) }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ ok: false, error: 'Missing mine or user_id' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error('Profile GET error:', error);
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  if (request.method === 'POST') {
    try {
      const auth = request.headers.get('authorization');
      if (!auth || !auth.startsWith('Bearer ')) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Unauthorized' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const token = auth.slice(7);
      const tokenHash = await sha256Hex(token);
      const user = await verifyToken(tokenHash, DB);

      if (!user) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Invalid token' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const body = await request.json();
      const { donation_url, compute_enabled, coinimp_site_key, coinimp_script_url, coinimp_api_id, coinimp_api_key } = body;

      if (!validateHttpUrl(donation_url)) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Invalid donation_url' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (!validateHttpUrl(coinimp_script_url)) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Invalid coinimp_script_url' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (!validateCoinimpSiteKey(coinimp_site_key)) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Invalid coinimp_site_key format' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      await DB.prepare(`
        UPDATE users
        SET donation_url = ?, compute_enabled = ?, coinimp_site_key = ?, coinimp_script_url = ?,
            coinimp_api_id = ?, coinimp_api_key = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(
        donation_url || null, compute_enabled ? 1 : 0,
        coinimp_site_key || null, coinimp_script_url || null,
        coinimp_api_id || null, coinimp_api_key || null,
        user.id
      ).run();

      const updated = await DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();

      return new Response(
        JSON.stringify({ ok: true, profile: updated }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error('Profile POST error:', error);
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // PATCH → change password
  if (request.method === 'PATCH') {
    try {
      const auth = request.headers.get('authorization');
      if (!auth || !auth.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      const token = auth.slice(7);
      const tokenHash = await sha256Hex(token);
      const user = await verifyToken(tokenHash, DB);
      if (!user) {
        return new Response(JSON.stringify({ ok: false, error: 'Token inválido' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }

      const body = await request.json();
      const newPassword = String(body.new_password || '').trim();
      if (newPassword.length < 6) {
        return new Response(JSON.stringify({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }

      // PBKDF2 hash
      const saltBytes = new Uint8Array(16);
      crypto.getRandomValues(saltBytes);
      const saltHex = [...saltBytes].map(b => b.toString(16).padStart(2, '0')).join('');
      const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(newPassword), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: 100000 }, keyMaterial, 256);
      const hashHex = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
      const stored = `pbkdf2:${saltHex}:${hashHex}`;

      await DB.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(stored, user.id).run();

      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }

  return new Response(
    JSON.stringify({ ok: false, error: 'Method not allowed' }),
    { status: 405, headers: { 'Content-Type': 'application/json' } }
  );
}
