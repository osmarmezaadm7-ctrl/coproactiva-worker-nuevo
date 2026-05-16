// index.js — CoproActiva Worker
// Versión: 2.3 · Mayo 2026 — fix estructura /diagnosticos desde Code.gs

const ACCESS_KEY = 'copro2025';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

async function callAppsScript(appsScriptUrl, action, params = {}) {
  const url = new URL(appsScriptUrl);
  url.searchParams.set('action', action);
  for (const [key, val] of Object.entries(params)) {
    url.searchParams.set(key, val);
  }
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Apps Script respondió ${res.status}`);
  return res.json();
}

async function postAppsScript(appsScriptUrl, body) {
  const res = await fetch(appsScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Apps Script respondió ${res.status}`);
  return res.json();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (token !== ACCESS_KEY) {
      return jsonResponse({ ok: false, error: 'No autorizado' }, 401);
    }

    const APPS_SCRIPT_URL = env.APPS_SCRIPT_URL;

    try {

      // ─── GET /crm ─────────────────────────────────────────────
      if (url.pathname === '/crm' && method === 'GET') {
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getCRM');
        return jsonResponse({ ok: true, data });
      }

      // ─── POST /crm ────────────────────────────────────────────
      if (url.pathname === '/crm' && method === 'POST') {
        const body = await request.json();
        const data = await postAppsScript(APPS_SCRIPT_URL, { action: 'saveCRM', ...body });
        return jsonResponse({ ok: true, data });
      }

      // ─── GET /diagnosticos ────────────────────────────────────
      // Code.gs devuelve: { ok: true, data: { diagnosticos: [...] } }
      // El standalone espera: { diagnosticos: [...] }
      // → desenvolver data
      if (url.pathname === '/diagnosticos' && method === 'GET') {
        const resp = await callAppsScript(APPS_SCRIPT_URL, 'getDiagnosticos');
        // resp = { ok: true, data: { diagnosticos: [...] } }
        // Pasar solo el data interior al standalone
        return jsonResponse(resp.data || resp);
      }

      // ─── POST /diagnosticos ───────────────────────────────────
      // Code.gs devuelve: { ok: true } directamente desde Diagnosticos.guardar()
      if (url.pathname === '/diagnosticos' && method === 'POST') {
        const body = await request.json();
        const resp = await postAppsScript(APPS_SCRIPT_URL, { ...body, action: 'saveDiagnostico' });
        return jsonResponse(resp);
      }

      // ─── POST /factores — IA con Anthropic ───────────────────
      if (url.pathname === '/factores' && method === 'POST') {
        const body = await request.json();
        const prompt = body.prompt || '';
        if (!prompt) {
          return jsonResponse({ ok: false, error: 'Falta el campo prompt' }, 400);
        }
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1000,
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        if (!res.ok) {
          const err = await res.text();
          return jsonResponse({ ok: false, error: `Anthropic error ${res.status}: ${err}` }, 500);
        }
        const aiData = await res.json();
        const text = aiData.content?.[0]?.text || '';
        return jsonResponse({ ok: true, text });
      }

      // ─── GET /factores (compatibilidad) ──────────────────────
      if (url.pathname === '/factores' && method === 'GET') {
        return jsonResponse({
          ok: true,
          factores: ['Mora en gastos comunes','Fondo de reserva insuficiente','Mantenciones atrasadas','Conflictos entre residentes','Documentación desactualizada'],
        });
      }

      return jsonResponse({ ok: false, error: 'Ruta no encontrada' }, 404);

    } catch (error) {
      return jsonResponse({ ok: false, error: error.message }, 500);
    }
  },
};
