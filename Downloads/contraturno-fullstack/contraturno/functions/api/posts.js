import { ensureSchema } from './schema.js';

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const LICENSES = new Set(["all-rights-reserved", "cc-by", "cc-by-sa", "cc-by-nc"]);
const STATUSES = new Set(["draft", "published", "hidden", "deleted"]);
const TAG_LIMIT = 8;
const MAX_BODY = 120_000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function escapeHtml(input) {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function stripTags(html) {
  return String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeText(value, max = 2000) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function normalizeTags(input) {
  const raw = Array.isArray(input) ? input : String(input || "").split(",");
  const tags = [];
  const seen = new Set();
  for (const item of raw) {
    const tag = String(item || "").trim().replace(/^#/, "").replace(/\s+/g, "-").slice(0, 32);
    if (!tag) continue;
    const key = tag.toLocaleLowerCase("es-MX");
    if (!seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
    if (tags.length >= TAG_LIMIT) break;
  }
  return tags;
}

function generateId() {
  return crypto.getRandomValues(new Uint8Array(8)).reduce((a, b) => a + b.toString(16).padStart(2, '0'), '');
}

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

async function generateUniqueSlug(baseSlug, DB) {
  if (!baseSlug) {
    baseSlug = `post-${generateId().slice(0, 8)}`;
  }
  let slug = baseSlug;
  const rows = await DB.prepare(
    `SELECT slug FROM posts WHERE slug = ? OR slug LIKE ?`
  ).bind(baseSlug, `${baseSlug}-%`).all();
  const existing = new Set((rows.results || []).map((row) => row.slug));
  if (!existing.has(slug)) return slug;

  let counter = 2;
  while (existing.has(`${baseSlug}-${counter}`)) {
    counter += 1;
  }
  return `${baseSlug}-${counter}`;
}

function sanitizeHtml(html) {
  if (!html) return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript:/gi, '');
}

async function verifyToken(tokenHash, DB) {
  const user = await DB.prepare(
    'SELECT id, nickname FROM users WHERE token_hash = ?'
  ).bind(tokenHash).first();
  return user;
}

async function hashToken(token) {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function onRequest(context) {
  const { request, env } = context;
  const DB = env.DB;
  if (DB) await ensureSchema(DB);
  const url = new URL(request.url);

  if (request.method === 'GET') {
    try {
      const limit = parseInt(url.searchParams.get('limit')) || 30;
      const slug = url.searchParams.get('slug');
      const mine = url.searchParams.get('mine');
  const authorId = url.searchParams.get('author_id') || url.searchParams.get('user_id');

      if (slug) {
        const post = await DB.prepare(
          `SELECT * FROM posts WHERE slug = ? AND status = 'published' AND deleted_at IS NULL`
        ).bind(slug).first();

        if (!post) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Post not found' }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ ok: true, post }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (authorId) {
        const posts = await DB.prepare(
          `SELECT * FROM posts WHERE user_id = ? AND status = 'published' AND deleted_at IS NULL ORDER BY published_at DESC LIMIT ?`
        ).bind(authorId, limit).all();

        return new Response(
          JSON.stringify({ ok: true, posts: posts.results }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (mine === '1') {
        const auth = request.headers.get('authorization');
        if (!auth || !auth.startsWith('Bearer ')) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const token = auth.slice(7);
        const tokenHash = await hashToken(token);
        const user = await verifyToken(tokenHash, DB);

        if (!user) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Invalid token' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const posts = await DB.prepare(
          `SELECT * FROM posts WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`
        ).bind(user.id, limit).all();

        return new Response(
          JSON.stringify({ ok: true, posts: posts.results }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const posts = await DB.prepare(
        `SELECT * FROM posts WHERE status = 'published' AND deleted_at IS NULL ORDER BY published_at DESC LIMIT ?`
      ).bind(limit).all();

      return new Response(
        JSON.stringify({ ok: true, posts: posts.results }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error('Posts GET error:', error);
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  if (request.method === 'PATCH') {
    try {
      const body = await request.json();
      const { id, action } = body;
      if (!id || action !== 'like') {
        return new Response(
          JSON.stringify({ ok: false, error: 'Invalid request' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      await DB.prepare(
        'UPDATE posts SET likes = COALESCE(likes, 0) + 1 WHERE id = ?'
      ).bind(id).run();

      const post = await DB.prepare('SELECT id, likes FROM posts WHERE id = ?').bind(id).first();
      return new Response(
        JSON.stringify({ ok: true, likes: post?.likes ?? 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error('Posts PATCH error:', error);
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
      const tokenHash = await hashToken(token);
      const user = await verifyToken(tokenHash, DB);

      if (!user) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Invalid token' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const body = await request.json();
      const { title, subtitle, excerpt, tags, license, body_html, status, publish } = body;

      if (!title) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Title required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const baseSlug = slugify(title) || `post-${generateId().slice(0, 8)}`;
      const slug = await generateUniqueSlug(baseSlug, DB);
      const postId = generateId();
      const finalStatus = publish ? 'published' : (status || 'draft');
      const publishedAt = publish ? new Date().toISOString() : null;

      const sanitized = sanitizeHtml(body_html);

      await DB.prepare(`
        INSERT INTO posts (id, user_id, author, title, subtitle, excerpt, slug, tags, body_html, license, status, published_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        postId,
        user.id,
        user.nickname,
        title,
        subtitle || null,
        excerpt || null,
        slug,
        tags || null,
        sanitized,
        license || 'CC-BY-NC-SA-4.0',
        finalStatus,
        publishedAt
      ).run();

      const post = await DB.prepare('SELECT * FROM posts WHERE id = ?').bind(postId).first();

      return new Response(
        JSON.stringify({ ok: true, post }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error('Posts POST error:', error);
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  if (request.method === 'PUT') {
    try {
      const auth = request.headers.get('authorization');
      if (!auth || !auth.startsWith('Bearer ')) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Unauthorized' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const token = auth.slice(7);
      const tokenHash = await hashToken(token);
      const user = await verifyToken(tokenHash, DB);

      if (!user) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Invalid token' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const body = await request.json();
      const { id, title, subtitle, excerpt, tags, license, body_html, status, publish } = body;

      if (!id) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Post ID required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const post = await DB.prepare('SELECT * FROM posts WHERE id = ? AND user_id = ?').bind(id, user.id).first();

      if (!post) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Post not found or not yours' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const sanitized = sanitizeHtml(body_html);
      const finalStatus = publish ? 'published' : (status || post.status);
      const publishedAt = publish && !post.published_at ? new Date().toISOString() : post.published_at;

      await DB.prepare(`
        UPDATE posts
        SET title = ?, subtitle = ?, excerpt = ?, tags = ?, body_html = ?, license = ?, status = ?, published_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(
        title || post.title,
        subtitle || post.subtitle,
        excerpt || post.excerpt,
        tags || post.tags,
        sanitized || post.body_html,
        license || post.license,
        finalStatus,
        publishedAt,
        id
      ).run();

      const updated = await DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first();

      return new Response(
        JSON.stringify({ ok: true, post: updated }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error('Posts PUT error:', error);
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  if (request.method === 'DELETE') {
    try {
      const auth = request.headers.get('authorization');
      if (!auth || !auth.startsWith('Bearer ')) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Unauthorized' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const token = auth.slice(7);
      const tokenHash = await hashToken(token);
      const user = await verifyToken(tokenHash, DB);

      if (!user) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Invalid token' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const body = await request.json();
      const { id } = body;

      if (!id) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Post ID required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const post = await DB.prepare('SELECT * FROM posts WHERE id = ? AND user_id = ?').bind(id, user.id).first();

      if (!post) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Post not found or not yours' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      await DB.prepare(
        'UPDATE posts SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(id).run();

      return new Response(
        JSON.stringify({ ok: true, message: 'Post deleted' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error('Posts DELETE error:', error);
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
