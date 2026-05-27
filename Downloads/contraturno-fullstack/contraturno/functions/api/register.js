import { ensureSchema } from './schema.js';

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

function cleanNickname(value) {
  return String(value || "").trim().replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_\-\.]/g, "").slice(0, 40);
}

function validEmail(value) {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value).trim()) && String(value).length <= 254;
}

function generateId() {
  return crypto.getRandomValues(new Uint8Array(8))
    .reduce((a, b) => a + b.toString(16).padStart(2, '0'), '');
}

function makeToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `ct_${b64}`;
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    keyMaterial, 256
  );
  const saltHex = [...salt].map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${saltHex}:${hashHex}`;
}

export async function onRequestOptions() {
  return json({ ok: true });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "DB binding missing" }, 500);
  await ensureSchema(env.DB);

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "JSON inválido" }, 400);

  const nickname = cleanNickname(body.nickname);
  const password = String(body.password || "").trim();
  const email = body.email ? String(body.email).trim().toLowerCase() : null;

  if (nickname.length < 2) {
    return json({ ok: false, error: "El nickname debe tener al menos 2 caracteres. Solo letras, números, guiones y puntos." }, 400);
  }
  if (password.length < 6) {
    return json({ ok: false, error: "La contraseña debe tener al menos 6 caracteres." }, 400);
  }
  if (!validEmail(email)) {
    return json({ ok: false, error: "Correo inválido." }, 400);
  }

  // Check nickname availability
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE nickname = ?'
  ).bind(nickname).first();
  if (existing) {
    return json({ ok: false, error: "Ese nickname ya está en uso. Elegí otro." }, 409);
  }

  const id = crypto.randomUUID();
  const token = makeToken();
  const tokenHash = await sha256Hex(token);
  const passwordHash = await hashPassword(password);

  try {
    await env.DB.prepare(
      `INSERT INTO users (id, nickname, email, token_hash, password_hash, role)
       VALUES (?, ?, ?, ?, ?, 'author')`
    ).bind(id, nickname, email, tokenHash, passwordHash).run();
  } catch (err) {
    const msg = String(err?.message ?? err);
    if (msg.includes("UNIQUE")) {
      return json({ ok: false, error: "Ese nickname ya está en uso." }, 409);
    }
    return json({ ok: false, error: "No se pudo crear la cuenta." }, 500);
  }

  return json({
    ok: true,
    user: { id, nickname, role: "author" },
    token
  }, 201);
}
