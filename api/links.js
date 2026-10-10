import { get, put } from '@vercel/blob';
import { randomBytes } from 'node:crypto';

const ALLOWED_THEMES = new Set(['gold','rose','emerald','midnight','burgundy','silver','pink','classic','brown']);
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function validCode(value) {
  return typeof value === 'string' && /^[a-z0-9]{8}$/i.test(value);
}

function eventExpiry(dateString) {
  if (typeof dateString !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;
  const [year, month, day] = dateString.split('-').map(Number);
  const eventDate = new Date(Date.UTC(year, month - 1, day));
  if (eventDate.getUTCFullYear() !== year || eventDate.getUTCMonth() !== month - 1 || eventDate.getUTCDate() !== day) return null;
  // 00:00 no horário de Brasília no quarto dia após o evento = fim do terceiro dia posterior.
  return new Date(Date.UTC(year, month - 1, day + 4, 3, 0, 0));
}

async function readLink(code) {
  const blob = await get(`links/${code}.json`, { access: 'private' });
  if (!blob || blob.statusCode !== 200 || !blob.stream) return null;
  const text = await new Response(blob.stream).text();
  try { return JSON.parse(text); } catch { return null; }
}

export async function GET(request) {
  const url = new URL(request.url);
  const code = (url.searchParams.get('id') || '').toLowerCase();
  if (!validCode(code)) return reply({ error: 'Link inválido ou incompleto.' }, 400);
  try {
    const record = await readLink(code);
    if (!record) return reply({ error: 'Este link não foi encontrado.' }, 404);
    if (!record.expiresAt || Date.now() >= Date.parse(record.expiresAt)) {
      return reply({ error: 'Este link expirou. Peça ao anfitrião um novo link de localização.' }, 410);
    }
    return reply({ type: 'location', payload: record.payload, expiresAt: record.expiresAt });
  } catch (error) {
    console.error('Erro ao consultar link:', error);
    return reply({ error: 'Não foi possível carregar este link agora. Tente novamente em instantes.' }, 500);
  }
}

export async function POST(request) {
  let input;
  try { input = await request.json(); } catch { return reply({ error: 'Envie os dados do link em formato válido.' }, 400); }
  if (!input || input.type !== 'location' || !input.payload || typeof input.payload !== 'object') {
    return reply({ error: 'Dados inválidos para criar o link.' }, 400);
  }
  const source = input.payload;
  const host = String(source.h || '').trim();
  const address = String(source.a || '').trim();
  const venue = String(source.v || '').trim();
  const maps = String(source.m || '').trim();
  const eventDate = String(source.e || '').trim();
  if (!host) return reply({ error: 'Informe o nome da pessoa ou evento.' }, 422);
  if (!address) return reply({ error: 'Informe o endereço completo.' }, 422);
  if (host.length > 180 || address.length > 1000 || venue.length > 180 || maps.length > 2000) {
    return reply({ error: 'Um dos campos ultrapassou o limite permitido.' }, 422);
  }
  const expiresAt = eventExpiry(eventDate);
  if (!expiresAt) return reply({ error: 'Informe uma data de evento válida.' }, 422);
  if (expiresAt.getTime() <= Date.now()) return reply({ error: 'A data do evento já passou há mais de três dias. Escolha uma data futura ou recente.' }, 422);
  if (maps && !/^https?:\/\//i.test(maps)) return reply({ error: 'O link do Google Maps precisa começar com http:// ou https://.' }, 422);

  const payload = {
    h: host,
    a: address,
    v: venue,
    m: maps,
    c: ALLOWED_THEMES.has(String(source.c || '')) ? String(source.c) : 'gold',
    e: eventDate,
  };
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomBytes(5).toString('hex').slice(0, 8);
      try {
        await put(`links/${code}.json`, JSON.stringify({ payload, expiresAt: expiresAt.toISOString(), createdAt: new Date().toISOString() }), {
          access: 'private',
          contentType: 'application/json; charset=utf-8',
          addRandomSuffix: false,
        });
        return reply({ ok: true, code, url: `${new URL(request.url).origin}/l/${code}`, expiresAt: expiresAt.toISOString() }, 201);
      } catch (error) {
        // Repetir somente em uma colisão improvável; demais falhas sobem para o tratamento externo.
        if (attempt === 4) throw error;
        if (!/already exists|precondition|conflict/i.test(String(error?.message || error))) throw error;
      }
    }
    return reply({ error: 'Não foi possível criar um código curto. Tente novamente.' }, 500);
  } catch (error) {
    console.error('Erro ao salvar link:', error);
    return reply({ error: 'Não foi possível salvar o link. Confirme se o Vercel Blob está conectado ao projeto.' }, 500);
  }
}
