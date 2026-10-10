const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
function reply(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS }); }
function extractAddress(value) {
  try {
    const url = new URL(value);
    const query = url.searchParams.get('query') || url.searchParams.get('q') || url.searchParams.get('destination') || url.searchParams.get('daddr');
    if (query) return query.replace(/\+/g, ' ').trim();
    const match = url.pathname.match(/\/place\/([^/]+)/i);
    if (match) return decodeURIComponent(match[1]).replace(/\+/g, ' ').replace(/\s*@.*$/, '').trim();
    return '';
  } catch { return ''; }
}

export async function GET(request) {
  const requested = new URL(request.url).searchParams.get('url') || '';
  if (requested.length > 2000) return reply({ error: 'Link muito longo.' }, 400);
  let parsed;
  try { parsed = new URL(requested); } catch { return reply({ error: 'Informe um link válido do Google Maps.' }, 400); }
  const allowedHosts = new Set(['maps.app.goo.gl','goo.gl','www.google.com','google.com','maps.google.com','maps.google.com.br','www.google.com.br']);
  if (!['http:','https:'].includes(parsed.protocol) || !allowedHosts.has(parsed.hostname.toLowerCase())) {
    return reply({ error: 'Por segurança, informe um link do Google Maps.' }, 400);
  }
  let finalUrl = requested;
  try {
    // A URL de resposta normalmente já contém o destino final após os redirecionamentos.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      let response = await fetch(requested, { method: 'HEAD', redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'RaizPixelLinkResolver/1.0' } });
      if (response.url) finalUrl = response.url;
      if (!response.ok || finalUrl === requested) {
        response = await fetch(requested, { method: 'GET', redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'RaizPixelLinkResolver/1.0', 'Range': 'bytes=0-0' } });
        if (response.url) finalUrl = response.url;
        try { await response.body?.cancel(); } catch {}
      }
    } finally { clearTimeout(timer); }
    return reply({ url: finalUrl, address: extractAddress(finalUrl) });
  } catch (error) {
    console.error('Erro ao resolver link do Maps:', error);
    return reply({ url: requested, address: extractAddress(requested), warning: 'Não foi possível expandir o link automaticamente. Se necessário, preencha o endereço manualmente.' }, 200);
  }
}
