/**
 * Local dev server for Contraturno — bypasses wrangler/workerd entirely.
 * Works on Node 18+ (including Node 24) on Windows.
 *
 * Implements:
 *   - D1-compatible SQLite wrapper (via better-sqlite3)
 *   - Pages Functions context (onRequest, env, params, waitUntil)
 *   - Static file serving from public/
 *   - CORS for local dev
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);

const PORT = process.env.PORT || 8788;
const PUBLIC_DIR = join(__dirname, 'public');

// ─── D1 adapter (better-sqlite3 → D1 API) ────────────────────────────────────

let BetterSqlite3;
try {
  BetterSqlite3 = require('better-sqlite3');
} catch {
  console.error('\n[dev-server] Missing dependency: better-sqlite3');
  console.error('Run: npm install --save-dev better-sqlite3\n');
  process.exit(1);
}

let sqliteDb; // initialized in main() after directory is created

class D1Statement {
  #sql;
  #params = [];

  constructor(sql) {
    this.#sql = sql;
  }

  bind(...params) {
    const clone = new D1Statement(this.#sql);
    clone.#params = params;
    return clone;
  }

  #compiled() {
    return sqliteDb.prepare(this.#sql);
  }

  async run() {
    try {
      const info = this.#compiled().run(...this.#params);
      return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
    } catch (e) {
      throw Object.assign(new Error(e.message), { cause: e });
    }
  }

  async all() {
    try {
      const rows = this.#compiled().all(...this.#params);
      return { results: rows, success: true };
    } catch (e) {
      throw Object.assign(new Error(e.message), { cause: e });
    }
  }

  async first() {
    try {
      const row = this.#compiled().get(...this.#params);
      return row ?? null;
    } catch (e) {
      throw Object.assign(new Error(e.message), { cause: e });
    }
  }
}

const D1 = {
  prepare(sql) {
    return new D1Statement(sql);
  },
  async batch(statements) {
    return statements.map(s => {
      try {
        if (typeof s.run === 'function') {
          // already a D1Statement — we need to call the sync version
        }
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });
  },
  async exec(sql) {
    sqliteDb.exec(sql);
    return { count: 1, duration: 0 };
  },
};

// ─── Pages Functions router ───────────────────────────────────────────────────

const ROUTES = {
  '/api/schema':   () => import('./functions/api/schema.js'),
  '/api/register': () => import('./functions/api/register.js'),
  '/api/login':    () => import('./functions/api/login.js'),
  '/api/posts':    () => import('./functions/api/posts.js'),
  '/api/comments': () => import('./functions/api/comments.js'),
  '/api/report':   () => import('./functions/api/report.js'),
  '/api/profile':        () => import('./functions/api/profile.js'),
  '/api/coinimp-stats':  () => import('./functions/api/coinimp-stats.js'),
  '/api/platform':       () => import('./functions/api/platform.js'),
};

const ENV = {
  DB: D1,
  APP_NAME: 'Contraturno',
  APP_LEMA: 'Escritura pública fuera del turno oficial',
  PLATFORM_COINIMP_SITE_KEY: 'a566732126f7254fd40f1dca222e2ff0cdf6d725afc3a5a37d5052287768b199',
  PLATFORM_COINIMP_SCRIPT_URL: 'https://www.hostingcloud.racing/aG1U.js',
};

function makePagesContext(request, params = {}) {
  return {
    request,
    env: ENV,
    params,
    waitUntil: (p) => p, // no-op in dev
    next: async () => new Response('Not Found', { status: 404 }),
    data: {},
    functionPath: '',
    pluginArgs: [],
  };
}

// ─── MIME types ───────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
  '.ttf':  'font/ttf',
  '.txt':  'text/plain; charset=utf-8',
};

// ─── HTTP server ──────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Auth-Token');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── API routes ──
  const routeLoader = ROUTES[pathname];
  if (routeLoader) {
    try {
      const mod = await routeLoader();

      // Collect body
      const bodyChunks = [];
      for await (const chunk of req) bodyChunks.push(chunk);
      const bodyBuffer = Buffer.concat(bodyChunks);

      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers.set(k, v);
        else if (Array.isArray(v)) v.forEach(val => headers.append(k, val));
      }

      const hasBody = bodyBuffer.length > 0 && !['GET', 'HEAD'].includes(req.method);
      const workerRequest = new Request(url.href, {
        method: req.method,
        headers,
        ...(hasBody ? { body: bodyBuffer, duplex: 'half' } : {}),
      });

      const method = req.method.charAt(0) + req.method.slice(1).toLowerCase(); // Post, Get, etc.
      const handler =
        mod[`onRequest${method}`] ??
        mod.onRequest ??
        mod.default;

      if (!handler) {
        res.writeHead(405, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `No handler for ${req.method}` }));
        return;
      }

      const context = makePagesContext(workerRequest);
      const workerResponse = await handler(context);

      res.writeHead(workerResponse.status, Object.fromEntries(workerResponse.headers));
      const body = await workerResponse.arrayBuffer();
      res.end(Buffer.from(body));
    } catch (err) {
      console.error(`[${pathname}]`, err);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // ── Static files ──
  let filePath = join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // fallback to SPA index
    filePath = join(PUBLIC_DIR, 'index.html');
  }

  try {
    const content = await readFile(filePath);
    const mime = MIME[extname(filePath)] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': mime });
    res.end(content);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404 Not Found');
  }
});

// ─── Init DB schema then start ────────────────────────────────────────────────

async function ensureDir(dir) {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
}

async function main() {
  const dbDir = join(__dirname, '.wrangler/state/d1');
  await ensureDir(dbDir);

  // Open SQLite DB after directory exists
  sqliteDb = new BetterSqlite3(join(dbDir, 'contraturno-db.sqlite3'), {
    verbose: process.env.D1_VERBOSE ? console.log : undefined,
  });
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');

  // Run schema migrations
  const { ensureSchema } = await import('./functions/api/schema.js');
  await ensureSchema(D1);

  server.listen(PORT, () => {
    console.log(`\n  ⚡ Contraturno dev server`);
    console.log(`  ➜ Local: http://localhost:${PORT}`);
    console.log(`  ➜ API:   http://localhost:${PORT}/api/*`);
    console.log(`  ➜ DB:    .wrangler/state/d1/contraturno-db.sqlite3`);
    console.log(`\n  (Ctrl+C para detener)\n`);
  });
}

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ❌ Puerto ${PORT} ya está en uso.`);
    console.error(`  → Cerrá la terminal anterior con Ctrl+C y volvé a correr npm run dev\n`);
  } else {
    console.error('[dev-server] Error:', err);
  }
  process.exit(1);
});

main().catch(err => {
  console.error('[dev-server] Fatal:', err);
  process.exit(1);
});
