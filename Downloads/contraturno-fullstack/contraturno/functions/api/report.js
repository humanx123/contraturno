import { ensureSchema } from './schema.js';

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const REASONS = new Set(["abuse", "copyright", "direct_attack", "spam", "privacy", "other"]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function clean(value, max = 1200) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

async function targetExists(env, targetType, targetId) {
  if (targetType === "post") {
    return await env.DB.prepare("SELECT id FROM posts WHERE id = ? AND status != 'deleted'").bind(targetId).first();
  }
  if (targetType === "comment") {
    return await env.DB.prepare("SELECT id FROM comments WHERE id = ? AND status != 'deleted'").bind(targetId).first();
  }
  return null;
}

function generateId() {
  return crypto.getRandomValues(new Uint8Array(8)).reduce((a, b) => a + b.toString(16).padStart(2, '0'), '');
}

function sanitizeText(text) {
  if (!text) return '';
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .slice(0, 1000);
}

export async function onRequestOptions() {
  return json({ ok: true });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "DB binding missing" }, 500);
  await ensureSchema(env.DB);
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "JSON inválido" }, 400);

  const targetType = body.target_type === "comment" ? "comment" : "post";
  const targetId = clean(body.target_id, 80);
  const reason = REASONS.has(body.reason) ? body.reason : "other";
  const details = clean(body.details, 1200);
  const reporter = clean(body.reporter_nickname, 40) || null;

  if (!targetId) return json({ ok: false, error: "Falta target_id." }, 400);
  const exists = await targetExists(env, targetType, targetId);
  if (!exists) return json({ ok: false, error: "No se encontró el contenido reportado." }, 404);

  const id = generateId();
  const finalNickname = reporter || 'Anónimo';
  const sanitizedDetails = sanitizeText(details);

  await env.DB.prepare(
    `INSERT INTO reports (id, target_type, target_id, reason, details, reporter_nickname, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`
  ).bind(id, targetType, targetId, reason, sanitizedDetails, finalNickname).run();

  const report = await env.DB.prepare('SELECT id, status, created_at FROM reports WHERE id = ?').bind(id).first();

  return new Response(
    JSON.stringify({ ok: true, report }),
    { status: 201, headers: { 'Content-Type': 'application/json' } }
  );
}

export async function onRequestGet() {
  return json({
    ok: true,
    endpoint: "/api/report",
    methods: ["POST"],
    reasons: ["abuse", "copyright", "direct_attack", "spam", "privacy", "other"]
  });
}
