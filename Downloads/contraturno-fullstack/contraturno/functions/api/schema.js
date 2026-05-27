const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

export async function ensureSchema(DB) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      nickname TEXT UNIQUE,
      email TEXT,
      token_hash TEXT NOT NULL,
      role TEXT DEFAULT 'author',
      donation_url TEXT,
      compute_enabled INTEGER DEFAULT 0,
      coinimp_site_key TEXT,
      coinimp_script_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      author TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      excerpt TEXT,
      slug TEXT NOT NULL UNIQUE,
      tags TEXT,
      body_html TEXT NOT NULL,
      license TEXT NOT NULL DEFAULT 'CC-BY-NC-SA-4.0',
      likes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      ip_confirmed INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      published_at TEXT,
      deleted_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      nickname TEXT,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      hidden_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      details TEXT,
      reporter_nickname TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_posts_status_published ON posts(status, published_at)`,
    `CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug)`,
    `CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id)`
  ];

  for (const statement of statements) {
    await DB.prepare(statement).run();
  }
  try {
    await DB.prepare('ALTER TABLE posts ADD COLUMN likes INTEGER NOT NULL DEFAULT 0').run();
  } catch (_) {}
  try {
    await DB.prepare('ALTER TABLE users ADD COLUMN password_hash TEXT').run();
  } catch (_) {}
  try {
    await DB.prepare('ALTER TABLE users ADD COLUMN coinimp_api_id TEXT').run();
  } catch (_) {}
  try {
    await DB.prepare('ALTER TABLE users ADD COLUMN coinimp_api_key TEXT').run();
  } catch (_) {}
}

export async function onRequest(context) {
  const { request, env } = context;
  const DB = env.DB;

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const tables = await DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
    ).all();

    return new Response(
      JSON.stringify({
        ok: true,
        tables: tables.results.map(r => r.name)
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Schema error:', error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
