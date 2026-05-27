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

function cleanText(value, max = 1200) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function cleanNickname(value) {
  return String(value || "Anónimo crítico")
    .replace(/[<>]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 40) || "Anónimo crítico";
}

function generateId() {
  return crypto.getRandomValues(new Uint8Array(8)).reduce((a, b) => a + b.toString(16).padStart(2, '0'), '');
}

function sanitizeText(text) {
  if (!text) return '';
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .slice(0, 5000);
}

export async function onRequestOptions() {
  return json({ ok: true });
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "DB binding missing" }, 500);
  await ensureSchema(env.DB);
  const url = new URL(request.url);
  let postId = url.searchParams.get("post_id");
  const slug = url.searchParams.get("slug");

  if (!postId && slug) {
    const post = await env.DB.prepare("SELECT id FROM posts WHERE slug = ? AND status = 'published'").bind(slug).first();
    postId = post && post.id;
  }
  if (!postId) return json({ ok: false, error: "Falta post_id o slug." }, 400);

  const res = await env.DB.prepare(
    `SELECT id, post_id, nickname, body, status, created_at
     FROM comments
    WHERE post_id = ? AND status = 'published'
     ORDER BY created_at ASC
     LIMIT 200`
  ).bind(postId).all();

  return json({ ok: true, comments: res.results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "DB binding missing" }, 500);
  await ensureSchema(env.DB);
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "JSON inválido" }, 400);

  let postId = body.post_id;
  if (!postId && body.slug) {
    const post = await env.DB.prepare("SELECT id FROM posts WHERE slug = ? AND status = 'published'").bind(body.slug).first();
    postId = post && post.id;
  }

  if (!postId) return json({ ok: false, error: "Falta post_id o slug." }, 400);
  const post = await env.DB.prepare("SELECT id FROM posts WHERE id = ? AND status = 'published'").bind(postId).first();
  if (!post) return json({ ok: false, error: "No se puede comentar un texto inexistente u oculto." }, 404);

  const nickname = cleanNickname(body.nickname);
  const text = cleanText(body.body, 1200);
  if (text.length < 2) return json({ ok: false, error: "El comentario está vacío." }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO comments (id, post_id, nickname, body, status) VALUES (?, ?, ?, ?, 'published')"
  ).bind(id, postId, nickname, text).run();

  const comment = await env.DB.prepare(
    "SELECT id, post_id, nickname, body, status, created_at FROM comments WHERE id = ?"
  ).bind(id).first();

  return json({ ok: true, comment }, 201);
}

export async function onRequest(context) {
  const { request, env } = context;
  const DB = env.DB;
  if (DB) await ensureSchema(DB);
  const url = new URL(request.url);

  if (request.method === 'GET') {
    try {
      const postId = url.searchParams.get('post_id');

      if (!postId) {
        return new Response(
          JSON.stringify({ ok: false, error: 'post_id required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const comments = await DB.prepare(
        `SELECT * FROM comments WHERE post_id = ? AND status = 'approved' ORDER BY created_at ASC`
      ).bind(postId).all();

      return new Response(
        JSON.stringify({ ok: true, comments: comments.results }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error('Comments GET error:', error);
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  if (request.method === 'POST') {
    try {
      const body = await request.json();
      const { post_id, nickname, comment } = body;

      if (!post_id || !comment) {
        return new Response(
          JSON.stringify({ ok: false, error: 'post_id and comment required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const post = await DB.prepare('SELECT id FROM posts WHERE id = ?').bind(post_id).first();
      if (!post) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Post not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const commentId = generateId();
      const sanitized = sanitizeText(comment);
      const finalNickname = nickname || 'Anónimo';

      await DB.prepare(`
        INSERT INTO comments (id, post_id, nickname, body, status)
        VALUES (?, ?, ?, ?, 'pending')
      `).bind(commentId, post_id, finalNickname, sanitized).run();

      const newComment = await DB.prepare('SELECT * FROM comments WHERE id = ?').bind(commentId).first();

      return new Response(
        JSON.stringify({ ok: true, comment: newComment }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error('Comments POST error:', error);
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  return new Response(
    JSON.stringify({ ok: false, error: 'Method not allowed' }),
    { status: 405, headers: { 'Content-Type': 'application/json' } }
  );
}
