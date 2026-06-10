// Cron Worker — dispara el procesamiento de noticias cada 30 min (*/30 * * * *)
// La lógica real vive en el Pages worker. Este Worker solo hace el trigger.
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      fetch('https://culiacan-violentmonitor.pages.dev/api/cron', { method: 'POST' })
        .then(r => console.log('Cron trigger:', r.status))
        .catch(e => console.error('Cron error:', e.message))
    );
  },
};
