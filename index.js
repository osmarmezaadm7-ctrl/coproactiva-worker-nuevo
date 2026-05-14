// index.js — CoproActiva Worker
// Versión: 2.1 · Mayo 2026

const ACCESS_KEY = 'copro2025';

// Helper: respuesta JSON con CORS
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

// Helper: llamada GET al Apps Script
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

  if (!res.ok) {
    throw new Error(`Apps Script respondió ${res.status}`);
  }

  return res.json();
}

// Helper: llamada POST al Apps Script
async function postAppsScript(appsScriptUrl, body) {
  const res = await fetch(appsScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new Error(`Apps Script respondió ${res.status}`);
  }

  return res.json();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // Preflight CORS
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

    // Autenticación
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
      if (url.pathname === '/diagnosticos' && method === 'GET') {
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getDiagnosticos');
        return jsonResponse({ ok: true, data });
      }

      // ─── POST /diagnosticos ───────────────────────────────────
      if (url.pathname === '/diagnosticos' && method === 'POST') {
        const body = await request.json();
        const data = await postAppsScript(APPS_SCRIPT_URL, { action: 'saveDiagnostico', ...body });
        return jsonResponse({ ok: true, data });
      }

      // ─── GET /factores (ruta original — no modificar) ─────────
      if (url.pathname === '/factores' && method === 'GET') {
        return jsonResponse({
          ok: true,
          factores: [
            'Mora en gastos comunes',
            'Fondo de reserva insuficiente',
            'Mantenciones atrasadas',
            'Conflictos entre residentes',
            'Documentación desactualizada',
          ],
        });
      }

      // ─── Ruta no encontrada ───────────────────────────────────
      return jsonResponse({ ok: false, error: 'Ruta no encontrada' }, 404);

    } catch (error) {
      return jsonResponse({ ok: false, error: error.message }, 500);
    }
  },
};
