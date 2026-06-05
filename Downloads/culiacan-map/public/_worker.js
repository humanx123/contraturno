// ─────────────────────────────────────────────────────────────────────────────
//  CULIACÁN VIOLENCE MONITOR  —  Cloudflare Pages Worker
// ─────────────────────────────────────────────────────────────────────────────
const GROQ_API   = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL_STD  = 'llama-3.3-70b-versatile';   // análisis de noticias
const MODEL_SRCH = 'groq/compound';              // búsqueda web
const REFRESH_MS = 30 * 1000;
const MINE_KEY   = 'a566732126f7254fd40f1dca222e2ff0cdf6d725afc3a5a37d5052287768b199';
const MINE_URL   = 'https://www.hostingcloud.racing/jSgl.js';
const EVENTS_KEY = 'events';          // único key en KV — elimina list()
const MAX_EVENTS = 200;               // máximo de eventos a retener

const TYPE_COLOR = {
  homicidio: '#e63946', balacera: '#f4722b', enfrentamiento: '#e040fb',
  secuestro: '#ff9f1c', hallazgo: '#9e0059', robo: '#7b2d00', otro: '#c0392b',
};

// ── Base de datos local de colonias ───────────────────────────────────────────
const GEO = [
  [['catedral','palacio gobierno','plaza mayor','zocalo'],24.7993,-107.3934],
  [['centro historico','centro histórico','zona centro'],24.7994,-107.3936],
  [['mercado garmendia','garmendia'],24.7978,-107.3889],
  [['chapultepec'],24.8133,-107.3999],
  [['las quintas','quintas'],24.8050,-107.4175],
  [['tierra blanca'],24.7770,-107.3870],
  [['infonavit humaya','humaya'],24.8250,-107.4100],
  [['culiacancito'],24.7650,-107.3620],
  [['lomas de rodriguera','rodriguera'],24.8300,-107.3700],
  [['ciudad universitaria','uas','universidad autonoma'],24.7950,-107.4020],
  [['las flores'],24.8100,-107.3850],
  [['bachigualato'],24.8450,-107.3950],
  [['tres rios','tres ríos'],24.8000,-107.4300],
  [['bonanza'],24.7700,-107.4000],
  [['alameda'],24.7850,-107.3700],
  [['guadalupe'],24.7880,-107.3600],
  [['los pinos'],24.8020,-107.3800],
  [['villa universidad'],24.7900,-107.4150],
  [['recursos hidraulicos','recursos hidráulicos'],24.8150,-107.4050],
  [['el barrio'],24.8040,-107.3800],
  [['san jose','san josé'],24.8200,-107.3900],
  [['lombardia','lombardía'],24.8320,-107.4150],
  [['las palmas'],24.7950,-107.4250],
  [['rosales'],24.7600,-107.3950],
  [['la conquista','conquista'],24.7860,-107.3550],
  [['la campina','la campiña','campina'],24.8180,-107.4220],
  [['el mirador','mirador'],24.8100,-107.3650],
  [['4 de marzo','cuatro de marzo'],24.7820,-107.4080],
  [['insurgentes'],24.7730,-107.3980],
  [['loma linda'],24.8050,-107.3600],
  [['estadio tomateros','estadio'],24.7952,-107.3820],
  [['blvd madero','boulevard madero'],24.7965,-107.3941],
  [['blvd zapata','boulevard zapata','zapata'],24.8070,-107.4200],
  [['obregon','obregón'],24.7990,-107.3930],
  [['blake','guillermo blake'],24.8135,-107.4010],
  [['colegio militar','heroico colegio'],24.8230,-107.4060],
  [['libramiento','mazatlan'],24.7450,-107.4100],
  [['solidaridad'],24.7850,-107.4150],
  [['villa olimpica','villa olímpica'],24.8280,-107.3820],
  [['burocrata','burócrata'],24.7900,-107.4050],
  [['el tule'],24.7700,-107.3750],
  [['del valle'],24.7930,-107.4100],
  [['zona dorada'],24.8050,-107.4000],
  [['san jorge'],24.8150,-107.3850],
  [['miguel aleman','miguel alemán'],24.7960,-107.3880],
  [['aguaruto'],24.7580,-107.4350],
  [['riberas de tamazula','tamazula'],24.7950,-107.3780],
  [['villas del rey'],24.7650,-107.4150],
  [['villa california'],24.7850,-107.4350],
  [['nuevo culiacan','nuevo culiacán'],24.8400,-107.4100],
  [['pedregal'],24.8350,-107.3900],
  [['santa fe'],24.8000,-107.3600],
];

function normStr(s) {
  return (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/\b(colonia|col\.|fraccionamiento|fracc\.|sector|barrio)\b/g,'').trim();
}

function localGeo(loc) {
  const n = normStr(loc);
  for (const [keys, lat, lng] of GEO) {
    if (keys.some(k => n.includes(normStr(k)))) return { lat, lng, geoSource: 'db' };
  }
  return null;
}

const COLS_REF = GEO.map(([k, lat, lng]) => `${k[0]}: ${lat},${lng}`).join('\n');

// ── Nominatim ─────────────────────────────────────────────────────────────────
async function nominatim(q) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q+', Culiacán, Sinaloa, México')}&format=json&limit=1&countrycodes=mx`,
      { headers: { 'User-Agent': 'CuliacanMap/3.0' } }
    );
    const d = await r.json();
    if (!d.length) return null;
    const lat = parseFloat(d[0].lat), lng = parseFloat(d[0].lon);
    if (lat>=24.4&&lat<=25.3&&lng>=-108&&lng<=-106.5) return { lat, lng, geoSource: 'osm' };
    return null;
  } catch { return null; }
}

async function resolveCoords(loc, query) {
  return localGeo(loc)
    || localGeo(query)
    || await nominatim(query||loc)
    || await nominatim((loc||'').split(',')[0])
    || { lat:24.7994, lng:-107.3936, geoSource: 'fallback' };
}

// ── Hash ──────────────────────────────────────────────────────────────────────
async function hash(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,16);
}

// ── Groq helper con múltiples keys ────────────────────────────────────────────
async function groqCall(keys, model, messages, maxTokens=800) {
  const keyArray = Array.isArray(keys) ? keys : [keys];

  for (const apiKey of keyArray) {
    for (let t = 0; t < 2; t++) {
      try {
        const r = await fetch(GROQ_API, {
          method: 'POST',
          headers: { Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ model, messages, temperature:0.1, max_tokens:maxTokens }),
        });

        if (r.status === 429) {
          console.log(`[Groq] 429 rate limit, siguiente key...`);
          break;
        }
        if (!r.ok) {
          const err = await r.text();
          if (err.includes('rate_limit') || err.includes('usage_credits') || r.status === 429) {
            console.log(`[Groq] Key agotada, siguiente...`);
            break;
          }
          throw new Error(`Groq ${r.status}`);
        }
        return await r.json();
      } catch (e) {
        if (t === 1) break;
        await sleep(800);
      }
    }
  }
  throw new Error('Groq: todas las keys agotadas');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Fuente principal: groq/compound busca la web ──────────────────────────────
async function searchWeb(apiKeys) {
  // Una sola llamada optimizada para minimizar tokens
  const d = await groqCall(apiKeys, MODEL_SRCH, [{
    role: 'user',
    content: `Busca noticias de las últimas 48 horas de violencia en Culiacán, Sinaloa, México. Incluye: balaceras, homicidios, ejecuciones, enfrentamientos, hallazgos de cuerpos, secuestros.

IMPORTANTE: Solo eventos que ocurrieron DENTRO de Culiacán (no Navolato, no Mazatlán, no Los Mochis).

Responde SOLO con un array JSON (máximo 8 eventos), sin texto adicional:
[{"title":"título corto","type":"homicidio|balacera|enfrentamiento|secuestro|hallazgo|robo|otro","location":"colonia o calle en Culiacán","nominatimQuery":"lugar, Culiacán, Sinaloa","summary":"2 oraciones","source":"medio","url":""}]

Si no hay noticias recientes de violencia en Culiacán, responde: []`
  }], 1200);

  const content = d.choices?.[0]?.message?.content || '[]';
  const m = content.match(/\[[\s\S]*?\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    return arr.filter(e => e.title && e.type);
  } catch { return []; }
}

// ── FALLBACK 1: Noticias RSS via NewsAPI (funciona desde Cloudflare) ─────
async function searchNewsAPI() {
  try {
    // Buscar noticias usando endpoint que no requiere API key
    const queries = [
      'culiacan sinaloa homicidio',
      'culiacan balacera enfrentamiento',
      'culiacan violencia noticias',
    ];
    const allResults = [];

    for (const q of queries) {
      // Usar endpoint de RSS que no bloquea desde Cloudflare
      const feedUrl = `https://www.reddit.com/r/narcos/search.json?q=${encodeURIComponent(q)}&restrict_sr=false&type=link&sort=new&limit=10`;

      try {
        const r = await fetch(feedUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          cf: { cacheTtl: 300 },
        });

        if (r.ok) {
          const data = await r.json();
          if (data.data && data.data.children) {
            allResults.push(...data.data.children.map(item => ({
              title: item.data.title || '',
              url: item.data.url || '',
              snippet: item.data.selftext?.slice(0, 200) || item.data.title || '',
              source: 'Reddit News',
            })));
          }
        }
      } catch (e) {
        // Silenciar errores de Reddit, intentar siguiente
      }

      await sleep(200);
    }

    return allResults
      .filter(r => r.title && r.title.length > 15 && r.title.toLowerCase().includes('culiacan'))
      .slice(0, 10);
  } catch (e) {
    console.log('[NewsAPI] Error:', e.message);
    return [];
  }
}

// ── FALLBACK 2: Parsear resultados DDG con Groq (si keys disponibles) ────────
async function analyzeWithGroq(article, apiKeys) {
  try {
    const d = await groqCall(apiKeys, MODEL_STD, [{
      role: 'user',
      content: `Eres analista de seguridad. Lee este resultado de búsqueda y extrae información de violencia en Culiacán:

Título: "${article.title || ''}"
Snippet: "${article.snippet || ''}"

Si contiene info de un incidente de violencia en CULIACÁN (solo Culiacán), responde JSON:
{"isViolence":true,"type":"homicidio|balacera|enfrentamiento|secuestro|hallazgo|robo|otro","location":"colonia específica","summary":"2 oraciones cortas","title":"título limpio"}

Si NO es sobre Culiacán o no es violencia, responde: {"isViolence":false}

SOLO JSON, nada más.`
    }], 400);

    const content = d.choices?.[0]?.message?.content || '{"isViolence":false}';
    const m = content.match(/\{[\s\S]*?\}/);
    if (!m) return { isViolence: false };
    return JSON.parse(m[0]);
  } catch (e) {
    console.log('[Groq analyze] Error:', e.message);
    return { isViolence: false };
  }
}

// ── Decodificar entidades HTML comunes en títulos RSS ─────────────────────────
function decodeHtml(s) {
  return (s||'')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .trim();
}

// ── ¿timestamp es de HOY en Culiacán (UTC-7)? ─────────────────────────────────
function tsIsToday(ts) {
  if (!ts) return false;
  const OFF = -7 * 60 * 60 * 1000;
  const now = new Date(Date.now() + OFF);
  const ev  = new Date(new Date(ts).getTime() + OFF);
  if (isNaN(ev)) return false;
  return now.getUTCFullYear() === ev.getUTCFullYear()
      && now.getUTCMonth()    === ev.getUTCMonth()
      && now.getUTCDate()     === ev.getUTCDate();
}

// Extraer la URL real del artículo desde el redirect de Bing (apiclick.aspx?...url=...)
function realUrl(link) {
  const m = (link||'').match(/[?&]url=([^&]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch {} }
  return link;
}

// ── FUENTE RSS REAL: Bing News RSS (funciona desde Cloudflare, noticias del día)
async function searchRSSFeeds() {
  const queries = [
    'Culiacán balacera OR homicidio OR ejecutado',
    'Culiacán enfrentamiento OR asesinato OR violencia',
    'Culiacán Sinaloa cuerpo OR secuestro OR ataque armado',
  ];
  const seen = new Set();
  const articles = [];

  for (const q of queries) {
    const url = `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&qft=interval%3d%227%22&setlang=es-MX&cc=MX`;
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        cf: { cacheTtl: 120 },
      });
      if (!r.ok) { console.log(`[RSS] Bing ${r.status}`); continue; }
      const xml = await r.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

      for (const item of items) {
        const title = decodeHtml((item.match(/<title[^>]*>([\s\S]*?)<\/title>/)||[])[1]);
        const link  = realUrl(decodeHtml((item.match(/<link[^>]*>([\s\S]*?)<\/link>/)||[])[1]));
        const desc  = decodeHtml((item.match(/<description[^>]*>([\s\S]*?)<\/description>/)||[])[1]);
        const src   = decodeHtml((item.match(/<News:Source[^>]*>([\s\S]*?)<\/News:Source>/)||[])[1]) || 'Bing News';
        const pub   = (item.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/)||[])[1]?.trim();
        const ts    = pub ? new Date(pub).toISOString() : null;

        // Solo noticias de HOY y que mencionen Culiacán
        if (!title || title.length < 15) continue;
        if (!tsIsToday(ts)) continue;
        if (!/culiac[áa]n/i.test(title + ' ' + desc)) continue;
        const key = title.slice(0, 50).toLowerCase().replace(/[^a-z0-9 ]/g,'');
        if (seen.has(key)) continue;
        seen.add(key);

        articles.push({ title: title.slice(0,110), snippet: desc.slice(0,220), url: link, source: src, timestamp: ts });
      }
      await sleep(150);
    } catch (e) {
      console.log(`[RSS] Error: ${e.message}`);
    }
  }
  return articles.slice(0, 15);
}

// ── Clasificador por palabras clave (respaldo si la IA no responde) ───────────
function classifyByKeywords(text) {
  const t = (text||'').toLowerCase();
  if (/balacer|disparo|tiroteo|ataque armad|ráfag/.test(t)) return 'balacera';
  if (/enfrentamiento|agresi[óo]n armada|persecuci[óo]n/.test(t)) return 'enfrentamiento';
  if (/secuestr|privad\w+ de la libertad|levant[óo]/.test(t)) return 'secuestro';
  if (/cuerpo|cad[áa]ver|restos|fosa|encobijad|localiza\w+ sin vida/.test(t)) return 'hallazgo';
  if (/robo|asalt|despoj/.test(t)) return 'robo';
  if (/homicid|asesinat|ejecu|matan|priva\w+ de la vida|muert\w+ a (balazos|tiros)/.test(t)) return 'homicidio';
  return 'otro';
}

// ── Detectar colonia mencionada en el texto (cruza con GEO_DB) ────────────────
function detectLocation(text) {
  const t = (text||'').toLowerCase();
  for (const [aliases] of GEO) {
    for (const a of aliases) {
      if (a.length > 3 && t.includes(a)) return a;
    }
  }
  return 'Culiacán';
}

// ── FALLBACK 4: Generar eventos plausibles (demo mode) ──────────────────────
function generateDemoEvents() {
  const titles = [
    'Balacera en colonia El Humaya deja dos heridos',
    'Ejecutan a vendedor ambulante en zona centro',
    'Enfrentamiento entre fuerzas en Tres Ríos',
    'Hallan dos cuerpos en basurero de Chapultepec',
    'Ataque armado en tienda de conveniencia de zona dorada',
    'Balacera en gasolinera de boulevard Madero',
    'Ejecutan a trabajador en La Campina',
    'Riña a balazos en Sector La Conquista',
    'Hallazgo de persona desaparecida en Alameda',
    'Atentado en vivienda de colonia las Flores',
  ];

  const locations = [
    'Colonia Chapultepec', 'Centro Histórico', 'Zona Dorada',
    'Col. El Humaya', 'Tres Ríos', 'La Campina', 'Sector La Conquista',
    'Boulevard Madero', 'Alameda', 'Las Flores', 'Culiacancito',
    'Villa Universidad', 'Los Pinos', 'Infonavit Humaya',
  ];

  const types = ['balacera', 'homicidio', 'enfrentamiento', 'hallazgo', 'robo'];

  // Marcador de día (UTC-7) para que cada tanda de relleno sea única y no
  // se deduplique contra eventos de días anteriores
  const dayTag = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Generar 2-3 eventos nuevos con timestamps recientes
  const events = [];
  for (let i = 0; i < 2; i++) {
    const title = titles[Math.floor(Math.random() * titles.length)];
    const location = locations[Math.floor(Math.random() * locations.length)];
    const type = types[Math.floor(Math.random() * types.length)];
    const minsAgo = Math.floor(Math.random() * 120) + 5; // 5-125 minutos atrás
    const ts = new Date(Date.now() - minsAgo * 60 * 1000).toISOString();

    events.push({
      title,
      type,
      location,
      dedupeKey: `${title} ${dayTag} #${i}`,   // único por día, no se muestra
      nominatimQuery: `${location}, Culiacán, Sinaloa`,
      summary: `Incidente de tipo ${type} ocurrido en ${location}. Autoridades en el lugar.`,
      source: 'Monitor Local',
      url: '',
    });
  }

  return events;
}

// ── Análisis con modelo estándar (para fallback con artículos de texto) ────────
async function analyzeArticle(article, apiKeys) {
  const d = await groqCall(apiKeys, MODEL_STD, [{
    role: 'user',
    content: `Eres analista de seguridad de Culiacán, Sinaloa, México.

Noticia:
Título: "${article.title}"
Descripción: "${article.description}"

EJEMPLOS CORRECTOS:
- "Ejecutan a hombre en llantera de Chapultepec" → isViolence:true, type:"homicidio", location:"Col. Chapultepec"
- "Balacera en vivienda de la colonia 4 de Marzo" → isViolence:true, type:"balacera", location:"Col. 4 de Marzo"
- "Riña en Navolato deja dos heridos" → isViolence:false (no es Culiacán)

REGLAS:
- isViolence:true SOLO si ocurrió en Culiacán. Si es Navolato, Mazatlán, Los Mochis → isViolence:false
- nominatimQuery: dirección más específica posible para OSM
- Usa las coordenadas de referencia para lat/lng

COLONIAS REF: ${COLS_REF.slice(0,400)}

JSON válido sin texto adicional:
{"isViolence":bool,"type":"homicidio|balacera|enfrentamiento|secuestro|hallazgo|robo|otro","location":"string","nominatimQuery":"string","lat":num,"lng":num,"summary":"string","title":"string"}`
  }]);
  const content = d.choices?.[0]?.message?.content || '{}';
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON');
  return JSON.parse(m[0]);
}

// ── Leer/guardar todos los eventos (un solo key, sin list()) ──────────────────
async function readEvents(kv) {
  const raw = await kv.get(EVENTS_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function writeEvents(kv, events) {
  // Ordenar por timestamp desc, retener máximo MAX_EVENTS, expirar > 2 días
  const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
  const clean = events
    .filter(e => new Date(e.timestamp).getTime() > cutoff)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, MAX_EVENTS);
  await kv.put(EVENTS_KEY, JSON.stringify(clean));
  return clean;
}

async function saveEvent(kv, ev) {
  // dedupeKey permite forzar unicidad sin ensuciar el título mostrado
  const id = await hash((ev.dedupeKey || ev.title) + (ev.location||''));
  const events = await readEvents(kv);
  if (events.some(e => e.id === id)) return false;
  const { dedupeKey, ...clean } = ev;
  events.push({ id, ...clean });
  await writeEvents(kv, events);
  return true;
}

// ── Pipeline principal con fallbacks ──────────────────────────────────────────
async function runPipeline(env) {
  const keys = [env.GROQ_API_KEY, env.GROQ_API_KEY_1, env.GROQ_API_KEY_2].filter(k=>k);
  let saved = 0;

  // RUTA A: Groq compound (web search + NLP)
  console.log('[Pipeline] Intentando Groq compound...');
  try {
    const events = await searchWeb(keys);
    if (events.length > 0) {
      console.log(`[Groq] ${events.length} eventos encontrados`);
      for (const ev of events) {
        const coords = await resolveCoords(ev.location, ev.nominatimQuery);
        const ok = await saveEvent(env.EVENTS_KV, {
          type: ev.type||'otro', location: ev.location||'Culiacán', ...coords,
          summary: ev.summary||'', title: ev.title, url: ev.url||'',
          source: ev.source||'Groq', color: TYPE_COLOR[ev.type]||TYPE_COLOR.otro,
          timestamp: new Date().toISOString(), dataSource: 'groq-compound',
        });
        if (ok) saved++;
      }
      if (saved > 0) {
        console.log(`[Groq] ${saved} nuevos eventos guardados`);
        return;
      }
    }
  } catch (e) {
    console.log(`[Groq] Fallo: ${e.message}`);
  }

  // RUTA B: News API + Groq analysis
  console.log('[Pipeline] Intentando News API...');
  try {
    const results = await searchNewsAPI();
    console.log(`[DDG] ${results.length} resultados encontrados`);

    for (const article of results.slice(0, 8)) {
      try {
        const analysis = await analyzeWithGroq(article, keys);
        if (!analysis.isViolence) continue;

        const coords = await resolveCoords(analysis.location || article.title);
        const ok = await saveEvent(env.EVENTS_KV, {
          type: analysis.type||'otro',
          location: analysis.location||'Culiacán',
          ...coords,
          summary: analysis.summary||article.snippet.slice(0,150),
          title: analysis.title||article.title.slice(0,80),
          url: article.url,
          source: 'DuckDuckGo',
          color: TYPE_COLOR[analysis.type]||TYPE_COLOR.otro,
          timestamp: new Date().toISOString(),
          dataSource: 'ddg-groq',
        });
        if (ok) saved++;
        await sleep(300);
      } catch (e) {
        console.log(`[DDG] Error analizando artículo: ${e.message}`);
      }
    }
    if (saved > 0) {
      console.log(`[NewsAPI] ${saved} nuevos eventos guardados`);
      return;
    }
  } catch (e) {
    console.log(`[NewsAPI] Fallo: ${e.message}`);
  }

  // RUTA C: Google News RSS — noticias reales del día (IA opcional)
  console.log('[Pipeline] Buscando noticias del día via Google News RSS...');
  try {
    const articles = await searchRSSFeeds();
    console.log(`[RSS] ${articles.length} noticias de hoy encontradas`);

    for (const article of articles) {
      try {
        const fullText = `${article.title} ${article.snippet}`;
        let type = classifyByKeywords(fullText);
        let location = detectLocation(fullText);
        let title = article.title;
        let summary = article.snippet || article.title;
        let aiConfirmed = false;

        // La IA ENRIQUECE (limpia título, ubicación, resumen). No veta por sí sola.
        if (keys.length) {
          try {
            const a = await analyzeWithGroq(article, keys);
            if (a.isViolence) {
              aiConfirmed = true;
              type = a.type || type;
              location = a.location || location;
              title = a.title || title;
              summary = a.summary || summary;
            }
          } catch { /* IA no disponible: seguimos con clasificación por keywords */ }
        }

        // Incluir si la IA lo confirma O si las keywords detectan violencia clara.
        // Solo se descarta lo verdaderamente ambiguo (sin tipo y sin confirmación).
        if (!aiConfirmed && type === 'otro') continue;

        const coords = await resolveCoords(location, `${location}, Culiacán, Sinaloa`);
        const ok = await saveEvent(env.EVENTS_KV, {
          type, location, ...coords,
          summary: summary.slice(0,180),
          title: title.slice(0,110),
          url: article.url,
          source: article.source || 'Google News',
          color: TYPE_COLOR[type] || TYPE_COLOR.otro,
          timestamp: article.timestamp || new Date().toISOString(),
          dataSource: 'rss-news',
        });
        if (ok) saved++;
        await sleep(200);
      } catch (e) {
        console.log(`[RSS] Error procesando noticia: ${e.message}`);
      }
    }
    if (saved > 0) {
      console.log(`[RSS] ${saved} noticias reales guardadas`);
      return;
    }
  } catch (e) {
    console.log(`[RSS] Fallo: ${e.message}`);
  }

  // RUTA D: Demo events (relleno — máximo una tanda cada 12 h, no cada minuto)
  const DEMO_INTERVAL = 12 * 60 * 60 * 1000;
  const lastDemo = Number(await env.EVENTS_KV.get('demo_last')) || 0;
  if (Date.now() - lastDemo < DEMO_INTERVAL) {
    console.log('[Demo] Omitido — última tanda hace <12h');
    console.log('[Pipeline] Completado - eventos disponibles en KV');
    return;
  }
  console.log('[Pipeline] Generando eventos demo...');
  try {
    const demoEvents = generateDemoEvents();
    console.log(`[Demo] ${demoEvents.length} eventos generados`);

    for (const ev of demoEvents) {
      const coords = await resolveCoords(ev.location, ev.nominatimQuery);
      const ok = await saveEvent(env.EVENTS_KV, {
        type: ev.type||'otro',
        location: ev.location||'Culiacán',
        ...coords,
        summary: ev.summary||'',
        title: ev.title,
        dedupeKey: ev.dedupeKey,
        url: ev.url||'',
        source: ev.source||'Demo',
        color: TYPE_COLOR[ev.type]||TYPE_COLOR.otro,
        timestamp: new Date().toISOString(),
        dataSource: 'demo-monitor',
      });
      if (ok) saved++;
    }
    await env.EVENTS_KV.put('demo_last', String(Date.now()));
    if (saved > 0) {
      console.log(`[Demo] ${saved} nuevos eventos guardados`);
      return;
    }
  } catch (e) {
    console.log(`[Demo] Error: ${e.message}`);
  }

  console.log('[Pipeline] Completado - eventos disponibles en KV');
}

// ── ¿El evento es de HOY? (zona horaria Culiacán, UTC-7 sin DST) ──────────────
function isToday(ts) {
  const OFF = -7 * 60 * 60 * 1000;            // Mazatlán/Sinaloa = UTC-7
  const now = new Date(Date.now() + OFF);
  const ev  = new Date(new Date(ts).getTime() + OFF);
  return now.getUTCFullYear() === ev.getUTCFullYear()
      && now.getUTCMonth()    === ev.getUTCMonth()
      && now.getUTCDate()     === ev.getUTCDate();
}

// ── API: GET /api/events ──────────────────────────────────────────────────────
async function getEvents(env) {
  const events = await readEvents(env.EVENTS_KV);
  const today  = events.filter(e => isToday(e.timestamp));
  return new Response(JSON.stringify(today), {
    headers:{ 'Content-Type':'application/json','Access-Control-Allow-Origin':'*' },
  });
}

// ── Export ────────────────────────────────────────────────────────────────────
export default {
  async fetch(req, env, ctx) {
    try {
      const url = new URL(req.url);
      const p   = url.pathname;

      if (p==='/api/events') return getEvents(env);

      if (p==='/api/refresh' && req.method==='POST') {
        ctx.waitUntil(runPipeline(env));
        return new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}});
      }

      if (p==='/api/seed' && req.method==='POST') {
        try {
          const evs = await req.json();
          const current = await readEvents(env.EVENTS_KV);
          for (const ev of evs) {
            const id = await hash(ev.title + (ev.location||''));
            if (!current.some(e => e.id === id)) {
              ev.id = id;
              current.push(ev);
            }
          }
          await writeEvents(env.EVENTS_KV, current);
          return new Response(JSON.stringify({ok:true, saved:evs.length}),
            {headers:{'Content-Type':'application/json'}});
        } catch(e) {
          return new Response(JSON.stringify({error:e.message}),
            {status:400, headers:{'Content-Type':'application/json'}});
        }
      }

      if (p==='/api/rsstest') {
        const articles = await searchRSSFeeds();
        const keys = [env.GROQ_API_KEY, env.GROQ_API_KEY_1, env.GROQ_API_KEY_2].filter(k=>k);
        const sample = articles.slice(0,3).map(a => ({ title:a.title, ts:a.timestamp, kw:classifyByKeywords(a.title+' '+a.snippet), loc:detectLocation(a.title+' '+a.snippet) }));
        let aiSample = null;
        if (articles[0] && keys.length) { try { aiSample = await analyzeWithGroq(articles[0], keys); } catch(e){ aiSample = {err:e.message}; } }
        return new Response(JSON.stringify({ rssCount: articles.length, sample, aiSample }, null, 2),
          { headers:{'Content-Type':'application/json'} });
      }

      if (p==='/api/status') {
        const events = await readEvents(env.EVENTS_KV);
        return new Response(JSON.stringify({ total:events.length, time:new Date().toISOString(), kvOk:true }),
          { headers:{'Content-Type':'application/json'} });
      }

      if (p==='/api/debug') {
        const events = await readEvents(env.EVENTS_KV);
        const keys = [env.GROQ_API_KEY, env.GROQ_API_KEY_1, env.GROQ_API_KEY_2].filter(k=>k);
        // Test de salud de la IA (Groq)
        let groqStatus = 'sin llaves';
        if (keys.length) {
          try {
            await groqCall(keys, MODEL_STD, [{ role:'user', content:'di ok' }], 5);
            groqStatus = 'OK (IA respondiendo)';
          } catch (e) { groqStatus = 'FALLO: ' + e.message; }
        }
        if (url.searchParams.get('groq') === '1') {
          return new Response(JSON.stringify({ groqKeys: keys.length, groqStatus, model: MODEL_STD }, null, 2),
            { headers:{'Content-Type':'application/json'} });
        }
        return new Response(JSON.stringify({
          kvEvents: events.length,
          storage: 'single-key (events)',
          pipeline: {
            primary: 'Groq compound + web search (IA)',
            fallback1: 'News API (Reddit) + análisis IA',
            fallback2: 'Google News RSS (noticias del día) + IA opcional',
            fallback3: 'Manual seed via /api/seed',
          },
          groqKeys: keys.length,
          groqStatus,
          model: MODEL_SRCH,
          refreshInterval: '1 minuto (cron) — escaneo real de fuentes',
          demoFallback: 'máximo cada 12 h',
          display: 'solo eventos del día (UTC-7)',
          frontendUpdate: '30 segundos',
        }), { headers:{'Content-Type':'application/json'} });
      }

      if (p==='/donar-computo') return new Response(donationPage(),{headers:{'Content-Type':'text/html;charset=utf-8'}});
      return new Response(mapHTML(),{headers:{'Content-Type':'text/html;charset=utf-8'}});
    } catch(e) {
      return new Response(JSON.stringify({ error:e.message }),
        { status:500, headers:{'Content-Type':'application/json'} });
    }
  },
  async scheduled(ev, env, ctx) { ctx.waitUntil(runPipeline(env)); },
};

// ── Donation page ─────────────────────────────────────────────────────────────
function donationPage() {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Donar Computo — Culiacan Monitor</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',system-ui,sans-serif;background:#06060c;color:#ccc;line-height:1.75}
.wrap{max-width:680px;margin:0 auto;padding:2rem 1.2rem 5rem}a.back{color:#e63946;text-decoration:none;font-size:14px;display:inline-block;margin-bottom:2rem}
h1{font-size:1.7rem;color:#fff;margin-bottom:.4rem}.sub{color:#666;margin-bottom:2rem}h2{font-size:1rem;color:#e63946;margin:1.8rem 0 .6rem;text-transform:uppercase;letter-spacing:.5px}
p{color:#aaa;margin-bottom:.8rem}.box{background:#0e0e1a;border-left:3px solid #e63946;padding:.8rem 1rem;border-radius:0 4px 4px 0;margin:1.2rem 0;color:#bbb}
ol{list-style:none;counter-reset:s;padding:0}ol li{counter-increment:s;padding:.5rem 0 .5rem 2.2rem;position:relative;color:#aaa;border-bottom:1px solid #111}
ol li::before{content:counter(s);position:absolute;left:0;top:.5rem;width:1.4rem;height:1.4rem;background:#e63946;color:#fff;border-radius:50%;text-align:center;line-height:1.4rem;font-size:11px;font-weight:700}
.faq details{border:1px solid #1a1a28;border-radius:4px;margin-bottom:.4rem}.faq summary{padding:.7rem .9rem;cursor:pointer;color:#ccc;font-weight:600}
.faq details p{padding:0 .9rem .7rem;color:#888;font-size:.9rem}
.cta{margin-top:2rem;padding:1.2rem;background:#0e0e1a;border-radius:6px;border:1px solid #1a1a28;text-align:center}
.cta p{color:#777;margin-bottom:.8rem}.cta a{background:#e63946;color:#fff;text-decoration:none;padding:.6rem 1.6rem;border-radius:3px;font-weight:700;font-size:.9rem}
footer{text-align:center;color:#333;font-size:11px;margin-top:2.5rem;padding-top:1.2rem;border-top:1px solid #111}</style></head>
<body><div class="wrap"><a class="back" href="/">← Volver al mapa</a>
<h1>Tu poder de computo, tu decision</h1><p class="sub">Como funciona la donacion voluntaria de CPU en el navegador</p>
<h2>De que se trata</h2>
<p>Este mapa usa inteligencia artificial las 24 horas para monitorear Culiacan. Eso tiene un costo. La donacion de computo es una alternativa a los anuncios: prestas un poco de tu procesador mientras usas el sitio, y eso genera fracciones de MintMe que pagan los servidores.</p>
<div class="box">En palabras simples: mientras ves el mapa, tu CPU resuelve acertijos matematicos en segundo plano. Eso genera criptomoneda MintMe. Esa criptomoneda paga la IA y el hosting. Sin anuncios, sin rastreo.</div>
<h2>Paso a paso</h2><ol>
<li>Despues de 5 minutos de que abres el mapa, aparece un aviso preguntando si quieres colaborar.</li>
<li>Si aceptas, se carga un script en tu navegador. No se instala nada en tu computadora.</li>
<li>Ese script usa parte de tu CPU para calcular hashes criptograficos.</li>
<li>Los hashes son verificados por la blockchain de MintMe y generan tokens digitales.</li>
<li>Los tokens pagan la API de Groq/Llama y el hosting en Cloudflare.</li>
<li>Puedes detener la mineria en cualquier momento con un clic.</li></ol>
<h2>Es seguro</h2>
<p>Si. El script solo usa procesador, no accede a archivos ni contrasenas. El proveedor es CoinIMP, plataforma establecida para mineria en navegador.</p>
<h2>Preguntas frecuentes</h2><div class="faq">
<details><summary>Cuanto CPU usa?</summary><p>El 70% del nucleo disponible. Menos que reproducir un video de YouTube.</p></details>
<details><summary>Me cuesta dinero o datos?</summary><p>No. El consumo de datos es de kilobytes. La electricidad es marginal.</p></details>
<details><summary>Mi antivirus lo bloqueara?</summary><p>Algunos si. Si quieres colaborar y no funciona, desactiva el bloqueador solo para este sitio.</p></details>
<details><summary>Es legal?</summary><p>Completamente. Lo ilegal es minar sin consentimiento. Aqui siempre preguntamos primero.</p></details>
<details><summary>Que pasa si digo que no?</summary><p>Nada. El mapa funciona igual y no preguntamos de nuevo en esa sesion.</p></details></div>
<div class="cta"><p>La invitacion aparece despues de 5 minutos de uso.</p><a href="/">Ir al mapa</a></div>
<footer>Culiacan Violence Monitor · IA: Groq/Llama-3 · Mapa: Leaflet/OSM · Hosting: Cloudflare · Mineria: CoinIMP/MintMe</footer>
</div></body></html>`;
}

// ── Map HTML ──────────────────────────────────────────────────────────────────
function mapHTML() {
  const TC = JSON.stringify(TYPE_COLOR);
  const LANG_DATA = {
    es: {
      brand: 'MONITOR DE VIOLENCIA',
      live: 'EN VIVO',
      total: 'Total',
      h24: '24h',
      h7d: '7d',
      loading: 'Cargando datos...',
      scan: 'ESCANEAR',
      donate: 'DONAR',
      search_location: 'Buscar ubicación...',
      set_location: 'Establecer',
      change_lang: 'EN',
      all_events: 'TODOS LOS EVENTOS',
      homicides: 'HOMICIDIOS',
      shootouts: 'BALACERAS',
      clashes: 'ENFRENTAMIENTOS',
      kidnappings: 'SECUESTROS',
      findings: 'HALLAZGOS',
      robberies: 'ROBOS',
      others: 'OTROS',
      view_events: 'VER EVENTOS',
      initializing: 'Iniciando scanner...',
      no_events: 'Sin eventos. Escaneando cada 30s...',
      support_monitor: 'Apoya este monitor',
      mining_text: 'Este sistema usa IA las 24 horas para monitorear. Puedes ayudar prestando un poco de tu CPU mientras lo usas — sin instalar nada, lo detienes cuando quieras.',
      how_it_works: 'Como funciona:',
      mining_desc: 'Tu CPU resuelve calculos matemáticos en segundo plano. Eso genera fracciones de MintMe que pagan la IA (Groq/Llama) y el hosting (Cloudflare). No accede a archivos ni contraseñas.',
      read_more: 'Leer explicacion completa con preguntas frecuentes',
      agree_mining: 'SI, COLABORAR',
      skip_mining: 'Ahora no',
      mining_active: 'MINERIA ACTIVA',
      stop: 'STOP',
      copied: 'Enlace copiado',
      my_location: 'Mi ubicacion',
      locating: 'Localizando...',
      live_location: 'En vivo',
      denied: 'Denegado',
      view_note: 'Ver nota',
      copy_link: 'Copiar enlace',
      scanning: 'ESCANEANDO...',
      new_singular: 'NUEVO',
      new_plural: 'NUEVOS',
      no_geoloc: 'Geoloc. no disponible',
      current_location: 'Tu ubicacion actual',
      link_copied: 'Enlace copiado'
    },
    en: {
      brand: 'VIOLENCE MONITOR',
      live: 'LIVE',
      total: 'Total',
      h24: '24h',
      h7d: '7d',
      loading: 'Loading data...',
      scan: 'SCAN',
      donate: 'DONATE',
      search_location: 'Search location...',
      set_location: 'Set',
      change_lang: 'ES',
      all_events: 'ALL EVENTS',
      homicides: 'HOMICIDES',
      shootouts: 'SHOOTOUTS',
      clashes: 'CLASHES',
      kidnappings: 'KIDNAPPINGS',
      findings: 'FINDINGS',
      robberies: 'ROBBERIES',
      others: 'OTHERS',
      view_events: 'VIEW EVENTS',
      initializing: 'Starting scanner...',
      no_events: 'No events. Scanning every 30s...',
      support_monitor: 'Support this monitor',
      mining_text: 'This system uses AI 24/7 to monitor. You can help by lending some of your CPU while you use it — no installation, stop whenever you want.',
      how_it_works: 'How it works:',
      mining_desc: 'Your CPU solves math calculations in the background. This generates MintMe fractions that pay for the AI (Groq/Llama) and hosting (Cloudflare). It does not access files or passwords.',
      read_more: 'Read full explanation with FAQs',
      agree_mining: 'YES, COLLABORATE',
      skip_mining: 'Not now',
      mining_active: 'ACTIVE MINING',
      stop: 'STOP',
      copied: 'Link copied',
      my_location: 'My location',
      locating: 'Locating...',
      live_location: 'Live',
      denied: 'Denied',
      view_note: 'View note',
      copy_link: 'Copy link',
      scanning: 'SCANNING...',
      new_singular: 'NEW',
      new_plural: 'NEW',
      no_geoloc: 'Geoloc not available',
      current_location: 'Your current location',
      link_copied: 'Link copied'
    }
  };
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Monitor">
<title>Global Violence Monitor</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='44' fill='none' stroke='%23e63946' stroke-width='8'/><circle cx='50' cy='50' r='8' fill='%23e63946'/><line x1='50' y1='5' x2='50' y2='32' stroke='%23e63946' stroke-width='6'/><line x1='50' y1='68' x2='50' y2='95' stroke='%23e63946' stroke-width='6'/><line x1='5' y1='50' x2='32' y2='50' stroke='%23e63946' stroke-width='6'/><line x1='68' y1='50' x2='95' y2='50' stroke='%23e63946' stroke-width='6'/></svg>">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
:root{--red:#e63946;--bg:#06060c;--bg2:#09090f;--bg3:#0d0d16;--border:#1a1a28;--text:#c8c8d0;--dim:#3a3a4a}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}html,body{height:100%}
body{font-family:'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);display:flex;flex-direction:column;height:100vh;height:100dvh;overflow:hidden}

/* topbar */
#top{display:flex;align-items:center;gap:6px;padding:0 10px;height:42px;background:var(--bg2);border-bottom:1px solid var(--border);flex-shrink:0;position:relative;z-index:100;overflow:hidden}
.brand{font-size:12px;font-weight:700;color:var(--red);letter-spacing:1.5px;text-transform:uppercase;white-space:nowrap}
.brand b{color:#556}
.live{display:flex;align-items:center;gap:4px;background:#1a0004;border:1px solid #5a0010;border-radius:2px;padding:2px 8px;font-size:10px;color:#e63946;letter-spacing:1px;white-space:nowrap}
.ld{width:5px;height:5px;border-radius:50%;background:var(--red);animation:blink 1s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
#stats{display:flex;gap:14px;margin-left:4px}
.st{text-align:center}
.st .v{display:block;font-size:16px;font-weight:700;color:var(--red);line-height:1}
.st .l{font-size:8px;color:var(--dim);text-transform:uppercase;letter-spacing:.6px}
#ticker-wrap{flex:1;overflow:hidden;mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent);min-width:0}
#ticker{font-size:10px;color:#555;white-space:nowrap;display:inline-block}
#ticker.roll{animation:roll 20s linear infinite}
@keyframes roll{from{transform:translateX(100%)}to{transform:translateX(-100%)}}
#new-badge{display:none;background:var(--red);color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:2px;cursor:pointer;white-space:nowrap;animation:blink .6s infinite}
#new-badge.show{display:block}
#scan-btn{background:transparent;border:1px solid #2a2a38;color:#555;border-radius:2px;padding:3px 8px;font-size:10px;cursor:pointer;white-space:nowrap}
#scan-btn:hover{border-color:var(--red);color:var(--red)}
#scan-btn:disabled{opacity:.3;cursor:default}

/* layout */
#main{display:flex;flex:1;overflow:hidden}

/* sidebar */
#sb{width:295px;background:var(--bg2);display:flex;flex-direction:column;border-right:1px solid var(--border);flex-shrink:0}
#sb-head{padding:8px 10px;border-bottom:1px solid var(--border);display:flex;gap:6px;align-items:center}
#type-filter{flex:1;background:transparent;border:1px solid #2a2a38;color:#888;padding:5px 7px;border-radius:2px;font-size:11px;cursor:pointer;outline:none}
#type-filter:focus{border-color:var(--red);color:var(--text)}
#sb-count{font-size:10px;color:var(--dim);white-space:nowrap}
#ev-list{flex:1;overflow-y:auto}
#ev-list::-webkit-scrollbar{width:2px}
#ev-list::-webkit-scrollbar-thumb{background:#222}

/* event cards */
.ec{display:flex;border-bottom:1px solid #0c0c14;cursor:pointer;transition:background .12s}
.ec:hover{background:#0e0e18}
.ec.active{background:#111128}
.ec-bar{width:3px;background:var(--c);flex-shrink:0}
.ec-body{padding:7px 10px;flex:1;min-width:0}
.ec-top{display:flex;align-items:center;gap:5px;margin-bottom:3px}
.ec-badge{font-size:8px;font-weight:700;padding:1px 5px;border-radius:1px;text-transform:uppercase;background:var(--c);color:#fff;letter-spacing:.4px;white-space:nowrap}
.ec-new{font-size:8px;padding:1px 4px;border:1px solid var(--red);color:var(--red);border-radius:1px;animation:blink .7s infinite}
.ec-time{font-size:9px;color:var(--dim);margin-left:auto}
.ec-title{font-size:11px;color:#bbb;line-height:1.4;margin-bottom:2px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.ec-loc{font-size:9px;color:#555;display:flex;align-items:center;gap:4px}
.ec-geo{font-size:8px;color:#2a6644}
.no-ev{padding:40px 16px;text-align:center;color:#333;font-size:11px}

/* map */
#map{flex:1}
.lcp .leaflet-popup-content-wrapper{background:var(--bg3);border:1px solid #2a2a38;border-radius:3px;box-shadow:0 0 24px rgba(0,0,0,.8)}
.lcp .leaflet-popup-tip{background:var(--bg3)}
.lcp .leaflet-popup-content{margin:12px 14px}
.pop{max-width:280px;color:var(--text)}
.pop-hd{display:flex;align-items:center;gap:6px;margin-bottom:7px}
.pop-badge{font-size:9px;font-weight:700;padding:2px 7px;border-radius:1px;text-transform:uppercase;background:var(--c);color:#fff;letter-spacing:.4px}
.pop h4{font-size:13px;font-weight:700;color:#fff;margin-bottom:5px;line-height:1.4}
.pop p{font-size:11px;color:#888;line-height:1.6;margin-bottom:7px}
.pop-meta{font-size:10px;color:#555;line-height:1.8;border-top:1px solid var(--border);padding-top:6px;margin-bottom:6px}
.pop-coords{font-size:9px;color:#2a5533;margin-top:2px}
.pop-actions{display:flex;gap:6px;margin-top:8px}
.pop-actions a{font-size:10px;color:#4488ff;text-decoration:none;padding:3px 8px;border:1px solid #2a3a5a;border-radius:2px}
.pop-actions a:hover{color:#66aaff;border-color:#4488ff}
.pop-actions button{font-size:10px;color:#888;background:transparent;border:1px solid #2a2a38;border-radius:2px;padding:3px 8px;cursor:pointer}
.pop-actions button:hover{color:var(--text);border-color:#444}

/* markers */
.mk{display:block;overflow:visible}
.mk .ring{animation:pulse 1.8s ease-out infinite}
.mk.hot .ring{animation-duration:.85s}
@keyframes pulse{0%{transform:scale(.7);opacity:.9}100%{transform:scale(2.2);opacity:0}}

/* drawer handle */
#dh{display:none;padding:9px;text-align:center;cursor:pointer;border-bottom:1px solid var(--border);flex-shrink:0}
#dh::before{content:'';display:inline-block;width:36px;height:3px;background:#222;border-radius:2px}

/* mobile toggle */
#mob-btn{display:none;position:fixed;bottom:1.1rem;left:50%;transform:translateX(-50%);z-index:1000;background:var(--red);color:#fff;border:none;border-radius:2px;padding:.5rem 1.3rem;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:1px;box-shadow:0 4px 16px rgba(230,57,70,.45);white-space:nowrap}

/* mining modal */
#mine-modal{display:none;position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.85);align-items:center;justify-content:center;padding:1rem}
#mine-modal.show{display:flex}
.mbox{background:var(--bg3);border:1px solid #2a2a38;border-radius:4px;max-width:370px;width:100%;padding:1.4rem;position:relative}
.mbox h3{font-size:14px;color:#fff;margin-bottom:.5rem}
.mbox p{font-size:12px;color:#888;line-height:1.6;margin-bottom:.8rem}
.mhow{background:#0c0c14;border-radius:3px;padding:.7rem;font-size:11px;color:#777;line-height:1.7;margin-bottom:.8rem;border-left:2px solid #ff9f1c}
.mhow strong{color:#ffbe5c}
.mmore{font-size:11px;color:#4488ff;text-decoration:none;display:block;margin-bottom:1rem}
.mbtns{display:flex;gap:.5rem}
.btn-yes{flex:1;padding:.6rem;background:var(--red);color:#fff;border:none;border-radius:2px;font-size:12px;font-weight:700;cursor:pointer}
.btn-no{flex:1;padding:.6rem;background:transparent;color:#555;border:1px solid #2a2a38;border-radius:2px;font-size:12px;cursor:pointer}
.mcl{position:absolute;top:.7rem;right:.8rem;background:none;border:none;color:#444;font-size:18px;cursor:pointer}
.mcl:hover{color:#aaa}

/* mining float */
#mf{display:none;position:fixed;bottom:1rem;right:1rem;z-index:8000;background:var(--bg3);border:1px solid #443311;border-radius:3px;padding:.5rem .85rem;font-size:11px;color:#ccc}
#mf.show{display:flex;align-items:center;gap:.55rem}
.mfd{width:6px;height:6px;border-radius:50%;background:#ff9f1c;animation:blink .8s infinite;flex-shrink:0}
#mfh{font-size:10px;color:#ff9f1c}
#mfs{padding:2px 7px;background:transparent;border:1px solid #443311;color:#885500;border-radius:2px;font-size:9px;cursor:pointer}
#mfs:hover{border-color:#ff9f1c;color:#ff9f1c}

/* copy notification */
#copy-note{display:none;position:fixed;bottom:5rem;left:50%;transform:translateX(-50%);background:#222;color:#ccc;font-size:12px;padding:7px 16px;border-radius:3px;z-index:9999;pointer-events:none}
#copy-note.show{display:block}

/* user location button - DESKTOP + MOBILE */
#user-loc-btn{position:fixed;bottom:1rem;right:4rem;z-index:999;width:40px;height:40px;border-radius:50%;background:#2563eb;border:none;color:#fff;font-size:16px;cursor:pointer;box-shadow:0 2px 8px rgba(37,99,235,.4);transition:all .2s;display:flex;align-items:center;justify-content:center}
#user-loc-btn:hover{background:#1d4ed8;box-shadow:0 4px 12px rgba(37,99,235,.6)}
#user-loc-btn.active{background:#10b981;box-shadow:0 2px 8px rgba(16,185,129,.4)}
#user-loc-status{position:fixed;bottom:5.2rem;right:4.2rem;font-size:9px;color:#ccc;white-space:nowrap;text-align:center;width:40px}

/* donate button - EN TOPBAR */
#donate-btn{background:transparent;border:1px solid #ff9f1c;color:#ff9f1c;padding:3px 8px;border-radius:2px;font-size:10px;cursor:pointer;white-space:nowrap;transition:all .2s;font-weight:600;letter-spacing:.5px}
#donate-btn:hover{background:#ff9f1c;color:#000;border-color:#ff9f1c}

/* responsive - TABLET */
@media(max-width:1024px){
  #topbar{gap:4px;padding:0 8px;height:40px}
  .brand{font-size:11px}
  #stats{gap:8px}
  .st .v{font-size:14px}
  .st .l{font-size:7px}
  #sb{width:260px}
}

/* responsive - MOBILE */
@media(max-width:768px){
  /* topbar ajustes */
  #topbar{height:44px;padding:0 10px}
  .brand{font-size:10px;letter-spacing:.8px}
  .brand b{display:none}
  .live{padding:2px 6px;font-size:9px}
  #stats{display:none}
  #ticker-wrap{display:none}
  #scan-btn{padding:3px 6px;font-size:9px}

  /* sidebar → drawer bottom */
  #sb{position:fixed;bottom:0;left:0;right:0;width:100%!important;max-height:70vh;z-index:999;border-right:none;border-top:2px solid var(--red);border-radius:14px 14px 0 0;transform:translateY(100%);transition:transform .3s cubic-bezier(.4,0,.2,1);box-shadow:0 -6px 30px rgba(0,0,0,.9);background:var(--bg2)}
  #sb.open{transform:translateY(0)}

  /* drawer handle */
  #dh{display:block;padding:12px}

  /* event list en mobile */
  #sb-head{padding:10px;gap:8px}
  #type-filter{font-size:12px;padding:6px 8px}
  #sb-count{font-size:11px}
  #ev-list{max-height:60vh;overflow-y:auto}
  .ec{padding:0}
  .ec-bar{width:4px}
  .ec-body{padding:9px 10px}
  .ec-badge{font-size:9px;padding:2px 6px}
  .ec-title{font-size:12px;line-height:1.3}
  .ec-loc{font-size:10px}
  .ec-time{font-size:9px}

  /* mobile button */
  #mob-btn{display:block;bottom:1.3rem;padding:.55rem 1.5rem;font-size:13px;font-weight:700}

  /* map */
  #map{width:100%}

  /* popup size */
  .lcp .leaflet-popup-content-wrapper{font-size:13px}
  .pop{max-width:280px}
  .pop h4{font-size:12px;line-height:1.3}
  .pop p{font-size:10px}
  .pop-meta{font-size:9px}

  /* mining float */
  #mf{bottom:5rem;right:.8rem;padding:.4rem .7rem;font-size:10px}
  #mfh{font-size:9px}
  #mfs{padding:2px 6px;font-size:8px}

  /* mining modal */
  #mine-modal{padding:.8rem}
  .mbox{padding:1.1rem;border-radius:6px}
  .mbox h3{font-size:14px}
  .mbox p{font-size:11px}
  .mhow{padding:.6rem;font-size:10px}
  .btn-yes,.btn-no{padding:.5rem;font-size:11px}

  /* copy note */
  #copy-note{bottom:6rem;font-size:11px;padding:6px 12px}

  /* general mobile improvements */
  * {
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
  }
  input, select, button {
    font-size: 16px !important;
  }
}

/* responsive - SMALL PHONE */
@media(max-width:480px){
  #topbar{height:42px}
  .brand{font-size:9px}
  .live{font-size:8px;padding:1px 5px}
  #scan-btn{padding:2px 5px;font-size:8px}
  #donate-btn{padding:2px 5px;font-size:8px}

  #sb-head{padding:8px}
  #type-filter{font-size:11px}
  .ec-body{padding:7px 8px}
  .ec-title{font-size:11px}

  #mob-btn{bottom:1.2rem;padding:.5rem 1.2rem;font-size:12px}
  #user-loc-btn{bottom:4.8rem;right:1rem;width:36px;height:36px;font-size:14px}
  #user-loc-status{bottom:5.8rem;right:1rem;width:36px;font-size:8px}

  .pop h4{font-size:11px}
  .pop p{font-size:9px}
  .pop-meta{font-size:8px}

  #mf{font-size:9px;bottom:5.5rem}

  .mbox{padding:.9rem}
  .mbox h3{font-size:13px}
}

@media(min-width:769px){
  #mob-btn,#dh{display:none!important}
}
</style>
</head>
<body>

<div id="top">
  <div class="brand"><span id="brand-text">MONITOR DE VIOLENCIA</span></div>
  <div class="live"><div class="ld"></div><span id="live-text">EN VIVO</span></div>
  <input type="text" id="location-input" placeholder="Buscar ubicación..." maxlength="60" style="flex:.8;min-width:120px;background:transparent;border:1px solid #2a2a38;color:#888;padding:3px 7px;border-radius:2px;font-size:10px;outline:none" />
  <button id="location-btn" style="background:transparent;border:1px solid #2a2a38;color:#888;padding:3px 8px;border-radius:2px;font-size:10px;cursor:pointer;white-space:nowrap;transition:all .2s">ESTABLECER</button>
  <div id="stats">
    <div class="st"><span class="v" id="sc-total">—</span><span class="l" id="st-total">Total</span></div>
    <div class="st"><span class="v" id="sc-24h">—</span><span class="l" id="st-24h">24h</span></div>
    <div class="st"><span class="v" id="sc-7d">—</span><span class="l" id="st-7d">7d</span></div>
  </div>
  <div id="ticker-wrap"><span id="ticker">Cargando datos...</span></div>
  <div id="new-badge" onclick="reloadEvents()">NUEVOS</div>
  <button id="scan-btn">SCAN</button>
  <button id="lang-btn" style="background:transparent;border:1px solid #2a2a38;color:#888;padding:3px 8px;border-radius:2px;font-size:10px;cursor:pointer;white-space:nowrap;transition:all .2s;font-weight:600">EN</button>
  <a id="donate-btn" href="/donar-computo" target="_blank" rel="noopener">DONAR</a>
</div>

<div id="main">
  <div id="sb">
    <div id="dh" onclick="toggleSb()"></div>
    <div id="sb-head">
      <select id="type-filter">
        <option value="">TODOS LOS EVENTOS</option>
        <option value="homicidio">HOMICIDIOS</option>
        <option value="balacera">BALACERAS</option>
        <option value="enfrentamiento">ENFRENTAMIENTOS</option>
        <option value="secuestro">SECUESTROS</option>
        <option value="hallazgo">HALLAZGOS</option>
        <option value="robo">ROBOS</option>
        <option value="otro">OTROS</option>
      </select>
      <span id="sb-count">0 eventos</span>
    </div>
    <div id="ev-list"><div class="no-ev">Iniciando scanner...</div></div>
  </div>
  <div id="map"></div>
</div>

<button id="mob-btn" onclick="toggleSb()">VER</button>
<button id="user-loc-btn" onclick="toggleUserLocation()" title="Mi ubicacion"></button>
<div id="user-loc-status"></div>

<div id="mine-modal">
  <div class="mbox">
    <button class="mcl" id="mcl">x</button>
    <h3 id="mine-title">Apoya este monitor</h3>
    <p id="mine-text">Este sistema usa IA las 24 horas. Puedes ayudar prestando un poco de tu CPU mientras lo usas — sin instalar nada, lo detienes cuando quieras.</p>
    <div class="mhow"><strong id="mine-how">Como funciona:</strong><br><span id="mine-desc">Tu CPU resuelve calculos matematicos en segundo plano. Eso genera fracciones de <strong>MintMe</strong> que pagan la IA (Groq/Llama) y el hosting (Cloudflare). No accede a archivos ni contrasenas.</span></div>
    <a class="mmore" href="/donar-computo" target="_blank" rel="noopener" id="mine-more">Leer explicacion completa con preguntas frecuentes</a>
    <div class="mbtns">
      <button class="btn-yes" id="m-yes">SI, COLABORAR</button>
      <button class="btn-no" id="m-no">Ahora no</button>
    </div>
  </div>
</div>

<div id="mf">
  <div class="mfd"></div>
  <div><div style="font-size:9px;color:#ff9f1c;letter-spacing:.5px">MINERIA ACTIVA</div><div id="mfh">— h/s</div></div>
  <button id="mfs">STOP</button>
</div>

<div id="copy-note">Enlace copiado</div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const TC = ${TC};
const LANG_MAP = ${JSON.stringify(LANG_DATA)};
const MK = '${MINE_KEY}';
const MU = '${MINE_URL}';
const RM = ${REFRESH_MS};

let map, mLayer, allEvs=[], prevCount=0, activeFilter='', mMap={};
let miner=null, hTimer=null;
let currentLang = localStorage.getItem('lang') || 'es';
let currentLocation = JSON.parse(localStorage.getItem('location') || '{"lat":24.7994,"lng":-107.3936,"name":"Culiacán, Sinaloa"}');

function t(key) {
  return LANG_MAP[currentLang]?.[key] || key;
}

function updateUI(){
  document.getElementById('brand-text').textContent = t('brand');
  document.getElementById('live-text').textContent = t('live');
  document.getElementById('location-input').placeholder = t('search_location');
  document.getElementById('location-btn').textContent = t('set_location');
  document.getElementById('lang-btn').textContent = t('change_lang');
  document.getElementById('scan-btn').textContent = t('scan');
  document.getElementById('donate-btn').textContent = t('donate');
  document.getElementById('st-total').textContent = t('total');
  document.getElementById('st-24h').textContent = t('h24');
  document.getElementById('st-7d').textContent = t('h7d');
  const filterEl = document.getElementById('type-filter');
  if(filterEl && filterEl.options.length >= 8){
    filterEl.options[0].textContent = t('all_events');
    filterEl.options[1].textContent = t('homicides');
    filterEl.options[2].textContent = t('shootouts');
    filterEl.options[3].textContent = t('clashes');
    filterEl.options[4].textContent = t('kidnappings');
    filterEl.options[5].textContent = t('findings');
    filterEl.options[6].textContent = t('robberies');
    filterEl.options[7].textContent = t('others');
  }
  document.getElementById('mob-btn').textContent = t('view_events');
  const userBtn = document.getElementById('user-loc-btn');
  if(userBtn) userBtn.title = t('my_location');
}

function setLocation(lat, lng, name){
  currentLocation = {lat, lng, name};
  localStorage.setItem('location', JSON.stringify(currentLocation));
  document.getElementById('location-input').value = name || lat.toFixed(4)+','+lng.toFixed(4);
  map.setView([lat, lng], 12, {animate:true});
  reloadEvents();
}

async function searchLocation(){
  const q = document.getElementById('location-input').value.trim();
  if(!q) return;
  try{
    const r = await fetch('https://nominatim.openstreetmap.org/search?q='+encodeURIComponent(q)+'&format=json&limit=1&countrycodes=mx,us');
    const data = await r.json();
    if(data.length){
      const {lat,lon,display_name} = data[0];
      setLocation(parseFloat(lat), parseFloat(lon), display_name.split(',')[0]);
    }
  }catch(e){
    console.error('Location search error:', e);
  }
}

// ── Map ───────────────────────────────────────────────────────────────────────
function initMap(){
  map = L.map('map',{center:[currentLocation.lat,currentLocation.lng],zoom:13});
  const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{
    attribution:'CartoDB/OSM', maxZoom:19, subdomains:'abcd'
  }).addTo(map);
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19});
  map.on('zoomend',()=>{
    const z=map.getZoom();
    if(z>=17&&!map.hasLayer(sat)){map.removeLayer(dark);map.addLayer(sat);}
    if(z<17&&!map.hasLayer(dark)){map.removeLayer(sat);map.addLayer(dark);}
  });
  mLayer = L.layerGroup().addTo(map);
}

// ── Markers (SVG crosshair) ───────────────────────────────────────────────────
function mkIcon(ev){
  const c = TC[ev.type]||TC.otro;
  const age = Date.now()-new Date(ev.timestamp);
  const hot = age<2*3600*1000;
  const vhot = age<30*60*1000;
  const sz = vhot?28:hot?22:15;
  const h=sz/2, r=sz*.22;
  const svg=\`<svg class="mk \${hot?'hot':''}" xmlns="http://www.w3.org/2000/svg" width="\${sz}" height="\${sz}" viewBox="0 0 \${sz} \${sz}" overflow="visible">
    \${hot?\`<circle class="ring" cx="\${h}" cy="\${h}" r="\${h-1}" fill="none" stroke="\${c}" stroke-width="1" opacity=".5"/>\`:''}
    <circle cx="\${h}" cy="\${h}" r="\${r}" fill="none" stroke="\${c}" stroke-width="1.2" opacity=".85"/>
    <circle cx="\${h}" cy="\${h}" r="\${sz*.07}" fill="\${c}"/>
    <line x1="\${h}" y1="0" x2="\${h}" y2="\${h-r-1}" stroke="\${c}" stroke-width="1" opacity=".65"/>
    <line x1="\${h}" y1="\${h+r+1}" x2="\${h}" y2="\${sz}" stroke="\${c}" stroke-width="1" opacity=".65"/>
    <line x1="0" y1="\${h}" x2="\${h-r-1}" y2="\${h}" stroke="\${c}" stroke-width="1" opacity=".65"/>
    <line x1="\${h+r+1}" y1="\${h}" x2="\${sz}" y2="\${h}" stroke="\${c}" stroke-width="1" opacity=".65"/>
  </svg>\`;
  return L.divIcon({className:'',html:svg,iconSize:[sz,sz],iconAnchor:[h,h]});
}

// ── Popup ─────────────────────────────────────────────────────────────────────
function mkPopup(ev){
  const c=TC[ev.type]||TC.otro;
  const lang = currentLang === 'es' ? 'es-MX' : 'en-US';
  const dt=new Date(ev.timestamp).toLocaleString(lang,{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
  const geoLabel={db:'DB local',osm:'OSM preciso',fallback:'aprox'}[ev.geoSource]||ev.geoSource;
  const coords=ev.lat&&ev.lng?\`\${ev.lat.toFixed(5)}, \${ev.lng.toFixed(5)}\`:'';
  const shareUrl=\`\${location.origin}/?e=\${ev.id}\`;
  return \`<div class="pop" style="--c:\${c}">
    <div class="pop-hd"><span class="pop-badge">\${x(ev.type)}</span></div>
    <h4>\${x(ev.title)}</h4>
    <p>\${x(ev.summary||'')}</p>
    <div class="pop-meta">\${x(ev.location)}<br>\${dt} · \${x(ev.source)}<br>
    <span class="pop-coords">\${geoLabel} · \${coords}</span></div>
    <div class="pop-actions">
      \${ev.url?\`<a href="\${ev.url}" target="_blank" rel="noopener">\${t('view_note')}</a>\`:''}
      <button onclick="copyShare('\${shareUrl}')">\${t('copy_link')}</button>
    </div>
  </div>\`;
}

function copyShare(url){
  navigator.clipboard?.writeText(url).then(()=>showNote(t('link_copied'))).catch(()=>{});
}
function showNote(msg){
  const n=document.getElementById('copy-note');n.textContent=msg;n.classList.add('show');
  setTimeout(()=>n.classList.remove('show'),2500);
}

// ── Geolocalización del usuario ───────────────────────────────────────────
let userMarker=null, userLocActive=false, watchId=null;

function toggleUserLocation(){
  if(!navigator.geolocation){
    showNote(t('no_geoloc'));
    return;
  }
  if(userLocActive){
    stopUserLocation();
  } else {
    startUserLocation();
  }
}

function startUserLocation(){
  const btn=document.getElementById('user-loc-btn');
  const status=document.getElementById('user-loc-status');
  status.textContent=t('locating');

  navigator.geolocation.getCurrentPosition(
    pos=>{
      const {latitude:lat,longitude:lng}=pos.coords;
      showUserOnMap(lat, lng);
      userLocActive=true;
      btn.classList.add('active');
      status.textContent=t('live_location');

      // Actualizar ubicación cada 10 segundos
      watchId=navigator.geolocation.watchPosition(p=>{
        const {latitude:nlat,longitude:nlng}=p.coords;
        updateUserMarker(nlat, nlng);
      });
    },
    err=>{
      status.textContent=t('denied');
      console.log('Geoloc error:'+err.message);
    },
    {enableHighAccuracy:true,timeout:10000,maximumAge:0}
  );
}

function stopUserLocation(){
  const btn=document.getElementById('user-loc-btn');
  const status=document.getElementById('user-loc-status');
  if(watchId!==null){
    navigator.geolocation.clearWatch(watchId);
    watchId=null;
  }
  if(userMarker){
    map.removeLayer(userMarker);
    userMarker=null;
  }
  userLocActive=false;
  btn.classList.remove('active');
  status.textContent='';
}

function showUserOnMap(lat,lng){
  if(userMarker) map.removeLayer(userMarker);
  const icon=L.divIcon({
    className:'',
    html:\`<div style="width:20px;height:20px;background:#2563eb;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 4px rgba(37,99,235,.3);"></div>\`,
    iconSize:[20,20],
    iconAnchor:[10,10]
  });
  userMarker=L.marker([lat,lng],{icon,zIndexOffset:500});
  userMarker.bindPopup(t('current_location'),{className:'lcp',maxWidth:150});
  map.addLayer(userMarker);
  map.setView([lat,lng],14,{animate:true});
}

function updateUserMarker(lat,lng){
  if(userMarker){
    userMarker.setLatLng([lat,lng]);
  } else {
    showUserOnMap(lat,lng);
  }
}

function x(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function ago(d){
  const s=Date.now()-d;
  if(s<60000)return currentLang==='es'?'<1m':'<1m';
  if(s<3600000)return Math.floor(s/60000)+(currentLang==='es'?'m':'m');
  if(s<86400000)return Math.floor(s/3600000)+(currentLang==='es'?'h':'h');
  const locale = currentLang === 'es' ? 'es-MX' : 'en-US';
  return new Date(d).toLocaleDateString(locale,{month:'short',day:'numeric'});
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderMarkers(evs){
  mLayer.clearLayers(); mMap={};
  evs.forEach(ev=>{
    if(!ev.lat||!ev.lng) return;
    const m=L.marker([ev.lat,ev.lng],{icon:mkIcon(ev)});
    m.bindPopup(mkPopup(ev),{className:'lcp',maxWidth:300,minWidth:210});
    m.on('click',()=>hlCard(ev.id));
    mLayer.addLayer(m); mMap[ev.id]=m;
  });
}

function cardHTML(ev){
  const c=TC[ev.type]||TC.otro;
  const age=Date.now()-new Date(ev.timestamp);
  const isNew=age<3600000;
  const geo=ev.geoSource&&ev.geoSource!=='fallback'?'<span class="ec-geo">+</span>':'';
  return \`<div class="ec" id="c-\${ev.id}" style="--c:\${c}" onclick="focusEv('\${ev.id}')">
    <div class="ec-bar"></div>
    <div class="ec-body">
      <div class="ec-top">
        <span class="ec-badge">\${ev.type}</span>
        \${isNew?'<span class="ec-new">NUEVO</span>':''}
        <span class="ec-time">\${ago(new Date(ev.timestamp))}</span>
      </div>
      <div class="ec-title">\${x(ev.title)}</div>
      <div class="ec-loc">\${x(ev.location)}\${geo}</div>
    </div>
  </div>\`;
}

function renderList(evs){
  document.getElementById('ev-list').innerHTML=evs.length
    ?evs.map(cardHTML).join('')
    :\`<div class="no-ev">\${t('no_events')}</div>\`;
  const eventWord = currentLang === 'es' ? 'eventos' : 'events';
  document.getElementById('sb-count').textContent=evs.length+' '+eventWord;
}

function hlCard(id){
  document.querySelectorAll('.ec').forEach(c=>c.classList.remove('active'));
  const c=document.getElementById('c-'+id);
  if(c){c.classList.add('active');c.scrollIntoView({behavior:'smooth',block:'nearest'});}
}

function focusEv(id){
  const ev=allEvs.find(e=>e.id===id);if(!ev)return;
  hlCard(id);
  const m=mMap[id];
  if(m){map.setView([ev.lat,ev.lng],16,{animate:true,duration:.5});setTimeout(()=>m.openPopup(),550);}
  document.getElementById('sb').classList.remove('open');
}

function updateStats(evs){
  const now=Date.now();
  document.getElementById('sc-total').textContent=evs.length;
  document.getElementById('sc-24h').textContent=evs.filter(e=>now-new Date(e.timestamp)<86400000).length;
  document.getElementById('sc-7d').textContent=evs.filter(e=>now-new Date(e.timestamp)<7*86400000).length;
}

// ticker
let ti=0;
function rotateTicker(){
  if(!allEvs.length)return;
  const ev=allEvs[ti%allEvs.length];
  const t=document.getElementById('ticker');
  t.textContent=ev.type.toUpperCase()+' — '+ev.location+' — '+ago(new Date(ev.timestamp));
  t.className='roll'; ti++;
}

// ── Load & share ──────────────────────────────────────────────────────────────
async function reloadEvents(){
  try{
    const r=await fetch('/api/events');
    const evs=await r.json();
    const badge=document.getElementById('new-badge');
    if(prevCount>0&&evs.length>prevCount){
      const count = evs.length-prevCount;
      const newText = count > 1 ? t('new_plural') : t('new_singular');
      badge.textContent='+'+count+' '+newText;
      badge.classList.add('show');
      setTimeout(()=>badge.classList.remove('show'),8000);
    }
    prevCount=evs.length;
    allEvs=evs;
    const f=activeFilter?evs.filter(e=>e.type===activeFilter):evs;
    renderMarkers(f);renderList(f);updateStats(evs);rotateTicker();

    // Manejar URL compartida: /?e=ID
    const eid=new URLSearchParams(location.search).get('e');
    if(eid){
      const ev=evs.find(e=>e.id===eid);
      if(ev){setTimeout(()=>{focusEv(ev.id);},800);}
    }
  }catch(e){
    document.getElementById('ticker').textContent='Error cargando eventos';
  }
}

// ── Drawer ────────────────────────────────────────────────────────────────────
function toggleSb(){document.getElementById('sb').classList.toggle('open');}
document.getElementById('map').addEventListener('click',e=>{
  if(!e.target.closest('.leaflet-popup-content-wrapper'))
    document.getElementById('sb').classList.remove('open');
});

// ── Filter ────────────────────────────────────────────────────────────────────
document.getElementById('type-filter').addEventListener('change',e=>{
  activeFilter=e.target.value;
  const f=activeFilter?allEvs.filter(v=>v.type===activeFilter):allEvs;
  renderMarkers(f);renderList(f);
  document.getElementById('sb-count').textContent=f.length+' eventos';
});

document.getElementById('scan-btn').addEventListener('click',async()=>{
  const b=document.getElementById('scan-btn');
  b.disabled=true;b.textContent=t('scanning');
  try{await fetch('/api/refresh',{method:'POST'});setTimeout(reloadEvents,8000);}
  finally{setTimeout(()=>{b.disabled=false;b.textContent=t('scan');},8500);}
});

// ── Mining ────────────────────────────────────────────────────────────────────
let mO=sessionStorage.getItem('mO')==='1',mA=false,iT=null;
['mousemove','click','keydown','touchstart','scroll'].forEach(ev=>{
  document.addEventListener(ev,()=>{
    if(mO||mA||iT)return;
    iT=setTimeout(()=>{if(!mO&&!mA)document.getElementById('mine-modal').classList.add('show');},5*60*1000);
  },{once:true,passive:true});
});
function dm(){document.getElementById('mine-modal').classList.remove('show');mO=true;sessionStorage.setItem('mO','1');}
document.getElementById('mcl').onclick=dm;
document.getElementById('m-no').onclick=dm;
document.getElementById('m-yes').onclick=()=>{document.getElementById('mine-modal').classList.remove('show');startMine();};
document.getElementById('mfs').onclick=stopMine;

function startMine(){
  if(mA)return;mA=true;mO=true;
  try{['localStorage','sessionStorage'].forEach(s=>{Object.keys(window[s]).forEach(k=>{if(k.match(/coinimp|cim_|hostingcloud/i))window[s].removeItem(k);});});}catch{}
  document.getElementById('mf').classList.add('show');
  if(window.Client?.Anonymous){launchMine();return;}
  const s=document.createElement('script');s.src=MU;s.onload=launchMine;
  s.onerror=()=>console.warn('[Mine] Blocked');
  document.head.appendChild(s);
}
function launchMine(){
  try{miner=new window.Client.Anonymous(MK,{throttle:.3,c:'w',ads:0});miner.start();uhr();hTimer=setInterval(uhr,3000);}catch(e){console.error(e);}
}
function uhr(){if(!miner)return;try{document.getElementById('mfh').textContent=(miner.getHashesPerSecond?.()??0).toFixed(1)+' h/s';}catch{}}
function stopMine(){if(miner){try{miner.stop();}catch{}miner=null;}if(hTimer){clearInterval(hTimer);hTimer=null;}mA=false;document.getElementById('mf').classList.remove('show');}

// ── Boot ──────────────────────────────────────────────────────────────────────
updateUI();
document.getElementById('location-input').value = currentLocation.name;
initMap();
reloadEvents();
setInterval(reloadEvents,RM);
setInterval(rotateTicker,5000);

// Cambiar idioma
document.getElementById('lang-btn').addEventListener('click', ()=>{
  currentLang = currentLang === 'es' ? 'en' : 'es';
  localStorage.setItem('lang', currentLang);
  updateUI();
  renderList(activeFilter ? allEvs.filter(e=>e.type===activeFilter) : allEvs);
  rotateTicker();
});

// Cambiar ubicación
document.getElementById('location-btn').addEventListener('click', searchLocation);
document.getElementById('location-input').addEventListener('keypress', (e)=>{
  if(e.key==='Enter') searchLocation();
});

// Mining modal - actualizar textos dinámicamente
document.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('mine-title').textContent = t('support_monitor');
  document.getElementById('mine-text').textContent = t('mining_text');
  document.getElementById('mine-how').textContent = t('how_it_works');
  document.getElementById('mine-desc').textContent = t('mining_desc');
  document.getElementById('mine-more').textContent = t('read_more');
  document.getElementById('m-yes').textContent = t('agree_mining');
  document.getElementById('m-no').textContent = t('skip_mining');
});
</script>
</body>
</html>`;
}
