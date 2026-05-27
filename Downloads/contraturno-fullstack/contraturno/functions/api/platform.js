const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' };

export async function onRequestGet({ env }) {
  return new Response(JSON.stringify({
    ok: true,
    platform: {
      name: env.APP_NAME || 'Contraturno',
      compute_enabled: !!(env.PLATFORM_COINIMP_SITE_KEY),
      coinimp_site_key: env.PLATFORM_COINIMP_SITE_KEY || '',
      coinimp_script_url: env.PLATFORM_COINIMP_SCRIPT_URL || '',
    }
  }), { headers: JSON_HEADERS });
}
