// ============================================================
// CoproActiva Worker — index.js
// Versión: 3.4 · Junio 2026
// Cambio v3.4: agrega rutas /leads y /leads/metricas
// Cambio v3.5: agrega rutas /plantillas
// Cambio v3.3: agrega ruta GET /documentos/catalogo-comunidad
// ============================================================

const ACCESS_KEY = 'copro2025';

const ALLOWED_ORIGINS = [
  'https://coproactiva.cl',
  'https://www.coproactiva.cl',
  'https://osmarmezaadm7-ctrl.github.io',
];

function getCorsHeaders(requestOrigin) {
  const isAllowed = ALLOWED_ORIGINS.includes(requestOrigin) || requestOrigin === 'null' || requestOrigin === '';
  const origin = isAllowed ? (requestOrigin || ALLOWED_ORIGINS[0]) : ALLOWED_ORIGINS[0];
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

function jsonResponse(data, status = 200, requestOrigin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: getCorsHeaders(requestOrigin),
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

function validarEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  return re.test(email.trim());
}

function validarTelefonoChileno(tel) {
  if (!tel || typeof tel !== 'string') return false;
  let limpio = tel.replace(/[\s\-\(\)]/g, '');
  if (limpio.startsWith('+56')) limpio = limpio.slice(3);
  else if (limpio.startsWith('56') && limpio.length >= 11) limpio = limpio.slice(2);
  if (!/^\d{9}$/.test(limpio)) return false;
  const primero = parseInt(limpio[0]);
  return primero === 2 || (primero >= 3 && primero <= 7) || primero === 9;
}

function normalizarTelefono(tel) {
  let limpio = tel.replace(/[\s\-\(\)]/g, '');
  if (limpio.startsWith('+56')) limpio = limpio.slice(3);
  else if (limpio.startsWith('56') && limpio.length >= 11) limpio = limpio.slice(2);
  return '+56' + limpio;
}

async function notificarEmail(prospecto, env) {
  if (!env.MAILCHANNELS_ENABLED) return;
  try {
    await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: 'contacto@coproactiva.cl', name: 'CoproActiva' }] }],
        from: { email: 'noreply@coproactiva.cl', name: 'CoproActiva Sistema' },
        subject: `🆕 Nuevo prospecto web: ${prospecto.nombreCondominio}`,
        content: [{
          type: 'text/plain',
          value: [
            '=== NUEVO PROSPECTO DESDE coproactiva.cl ===',
            '',
            `Condominio  : ${prospecto.nombreCondominio}`,
            `Contacto    : ${prospecto.nombreContacto}`,
            `Email       : ${prospecto.email}`,
            `Teléfono    : ${prospecto.telefono}`,
            `Servicio    : ${prospecto.tipoServicio || '(no indicado)'}`,
            `Origen      : ${prospecto.fuenteLead}`,
            `Observación : ${prospecto.observaciones || '(sin mensaje)'}`,
            '',
            `Fecha       : ${prospecto.fechaPrimerContacto}`,
            '',
            'Ingresa al CRM para gestionar este prospecto.',
          ].join('\n'),
        }],
      }),
    });
  } catch (_) {}
}

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const method = request.method;
    const origin = request.headers.get('Origin') || '';

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCorsHeaders(origin) });
    }

    const APPS_SCRIPT_URL = env.APPS_SCRIPT_URL;

    if (url.pathname === '/webhook/contacto' && method === 'POST') {
      try {
        const body = await request.json();
        if (body.website && body.website.trim() !== '') {
          return jsonResponse({ ok: true, message: 'Recibido' }, 200, origin);
        }
        const nombre     = (body.nombre     || '').trim();
        const telefono   = (body.telefono   || '').trim();
        const email      = (body.email      || '').trim();
        const condominio = (body.condominio || '').trim();
        const errores = [];
        if (!nombre)     errores.push('Nombre es obligatorio');
        if (!condominio) errores.push('Nombre del condominio es obligatorio');
        if (!email)                    errores.push('Correo electrónico es obligatorio');
        else if (!validarEmail(email)) errores.push('El correo electrónico no tiene un formato válido');
        if (!telefono)                          errores.push('Teléfono es obligatorio');
        else if (!validarTelefonoChileno(telefono)) errores.push('El teléfono no tiene un formato chileno válido');
        if (errores.length > 0) return jsonResponse({ ok: false, errores }, 400, origin);

        const utmSource   = (body.utm_source   || '').trim();
        const utmMedium   = (body.utm_medium   || '').trim();
        const utmCampaign = (body.utm_campaign || '').trim();
        let fuenteLead = 'web_coproactiva_cl';
        if (utmSource) {
          fuenteLead = `web_${utmSource}`;
          if (utmMedium)   fuenteLead += `_${utmMedium}`;
          if (utmCampaign) fuenteLead += `_${utmCampaign}`;
        }

        const ahora = new Date().toISOString();
        const prospecto = {
          nombreCondominio:       condominio,
          direccion:              '',
          comuna:                 '',
          unidades:               '',
          nombreContacto:         nombre,
          cargoContacto:          '',
          telefono:               normalizarTelefono(telefono),
          email:                  email.toLowerCase(),
          tipoServicio:           (body.servicio || '').trim(),
          fuenteLead,
          etapa:                  'Nuevo prospecto',
          fechaPrimerContacto:    ahora,
          fechaUltimaInteraccion: ahora,
          proximaAccion:          'Primer contacto — responder en < 24 h',
          fechaProximaAccion:     '',
          responsable:            '',
          motivoPerdida:          '',
          observaciones:          (body.mensaje || '').trim(),
          semaforo:               'verde',
        };

        const resp = await postAppsScript(APPS_SCRIPT_URL, {
          action: 'crearProspectoPublico',
          ...prospecto,
        });
        if (!resp || resp.ok === false) throw new Error(resp?.error || 'Error al guardar en el CRM');
        await notificarEmail(prospecto, env);
        return jsonResponse({ ok: true, message: 'Prospecto registrado correctamente' }, 200, origin);
      } catch (error) {
        return jsonResponse({ ok: false, error: error.message }, 500, origin);
      }
    }

    if (url.pathname === '/completar' && method === 'GET') {
      try {
        const token = url.searchParams.get('token') || '';
        if (!token) return jsonResponse({ ok: false, error: 'Token requerido' }, 400, origin);
        const data = await postAppsScript(APPS_SCRIPT_URL, { action: 'obtenerDatosToken', token });
        return jsonResponse({ ok: true, data }, 200, origin);
      } catch (error) {
        return jsonResponse({ ok: false, error: error.message }, 500, origin);
      }
    }

    if (url.pathname === '/completar' && method === 'POST') {
      try {
        const body = await request.json();
        if (!body.token) return jsonResponse({ ok: false, error: 'Token requerido' }, 400, origin);
        if (!body.comuna || !body.unidades) {
          return jsonResponse({ ok: false, error: 'Comuna y unidades son obligatorios' }, 400, origin);
        }
        const data = await postAppsScript(APPS_SCRIPT_URL, { action: 'completarDatosProspecto', ...body });
        return jsonResponse({ ok: true, data }, 200, origin);
      } catch (error) {
        return jsonResponse({ ok: false, error: error.message }, 500, origin);
      }
    }

    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (token !== ACCESS_KEY) {
      return jsonResponse({ ok: false, error: 'No autorizado' }, 401, origin);
    }

    try {

      if (url.pathname === '/crm' && method === 'GET') {
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getCRM');
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/crm' && method === 'POST') {
        const body = await request.json();
        if (body.action === 'editarProspecto' && !body.id) {
          return jsonResponse({ ok: false, error: 'Falta el ID del prospecto' }, 400, origin);
        }
        const action = body.action || 'saveCRM';
        const data = await postAppsScript(APPS_SCRIPT_URL, { ...body, action });
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/diagnosticos' && method === 'GET') {
        const resp = await callAppsScript(APPS_SCRIPT_URL, 'getDiagnosticos');
        return jsonResponse(resp.data || resp, 200, origin);
      }

      if (url.pathname === '/diagnosticos' && method === 'POST') {
        const body = await request.json();
        const action = body.action || 'saveDiagnostico';
        const resp = await postAppsScript(APPS_SCRIPT_URL, { ...body, action });
        return jsonResponse(resp, 200, origin);
      }

      if (url.pathname === '/factores' && method === 'POST') {
        const body = await request.json();
        const prompt = body.prompt || '';
        if (!prompt) return jsonResponse({ ok: false, error: 'Falta el campo prompt' }, 400, origin);
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
          return jsonResponse({ ok: false, error: `Anthropic error ${res.status}: ${err}` }, 500, origin);
        }
        const aiData = await res.json();
        const text = aiData.content?.[0]?.text || '';
        return jsonResponse({ ok: true, text }, 200, origin);
      }

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
        }, 200, origin);
      }

      if (url.pathname === '/correo' && method === 'POST') {
        const body = await request.json();
        if (!body.para || !body.asunto || !body.cuerpo) {
          return jsonResponse({ ok: false, error: 'Faltan campos: para, asunto, cuerpo' }, 400, origin);
        }
        const action = body.action || 'enviarCorreo';
        const data = await postAppsScript(APPS_SCRIPT_URL, { ...body, action });
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/comunidades' && method === 'GET') {
        const comunidadId = url.searchParams.get('comunidadId') || '';
        if (comunidadId) {
          const data = await callAppsScript(APPS_SCRIPT_URL, 'getComunidades', { comunidadId });
          return jsonResponse({ ok: true, data }, 200, origin);
        }
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getComunidades');
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/comunidades' && method === 'POST') {
        const body = await request.json();
        const data = await postAppsScript(APPS_SCRIPT_URL, body);
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/directorio' && method === 'GET') {
        const comunidadId = url.searchParams.get('comunidadId') || '';
        if (!comunidadId) return jsonResponse({ ok: false, error: 'comunidadId requerido' }, 400, origin);
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getDirectorio', { comunidadId });
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/directorio/importar' && method === 'POST') {
        const body = await request.json();
        if (!body.comunidadId) return jsonResponse({ ok: false, error: 'comunidadId requerido' }, 400, origin);
        if (!Array.isArray(body.filas) || body.filas.length === 0) {
          return jsonResponse({ ok: false, error: 'filas requeridas' }, 400, origin);
        }
        const data = await postAppsScript(APPS_SCRIPT_URL, {
          action:      'importarMasivo',
          comunidadId: body.comunidadId,
          filas:       body.filas
        });
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/unidades' && method === 'GET') {
        const comunidadId = url.searchParams.get('comunidadId') || '';
        if (!comunidadId) return jsonResponse({ ok: false, error: 'comunidadId requerido' }, 400, origin);
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getUnidades', { comunidadId });
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/unidades' && method === 'POST') {
        const body = await request.json();
        const data = await postAppsScript(APPS_SCRIPT_URL, body);
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/unidades/validar' && method === 'GET') {
        const comunidadId = url.searchParams.get('comunidadId') || '';
        if (!comunidadId) return jsonResponse({ ok: false, error: 'comunidadId requerido' }, 400, origin);
        const data = await callAppsScript(APPS_SCRIPT_URL, 'validarAlicuotas', { comunidadId });
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/copropietarios' && method === 'GET') {
        const comunidadId = url.searchParams.get('comunidadId') || '';
        if (!comunidadId) return jsonResponse({ ok: false, error: 'comunidadId requerido' }, 400, origin);
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getCopropietarios', { comunidadId });
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/copropietarios' && method === 'POST') {
        const body = await request.json();
        const data = await postAppsScript(APPS_SCRIPT_URL, body);
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/residentes' && method === 'GET') {
        const comunidadId = url.searchParams.get('comunidadId') || '';
        if (!comunidadId) return jsonResponse({ ok: false, error: 'comunidadId requerido' }, 400, origin);
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getResidentes', { comunidadId });
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/residentes' && method === 'POST') {
        const body = await request.json();
        const data = await postAppsScript(APPS_SCRIPT_URL, body);
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/documentos' && method === 'GET') {
        const comunidadId = url.searchParams.get('comunidadId') || '';
        const categoria   = url.searchParams.get('categoria')   || '';
        if (!comunidadId) return jsonResponse({ ok: false, error: 'comunidadId requerido' }, 400, origin);
        if (categoria) {
          const data = await callAppsScript(APPS_SCRIPT_URL, 'getDocumentosCategoria', { comunidadId, categoria });
          return jsonResponse({ ok: true, data }, 200, origin);
        }
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getDocumentos', { comunidadId });
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/documentos' && method === 'POST') {
        const body = await request.json();
        const data = await postAppsScript(APPS_SCRIPT_URL, body);
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/documentos/vencimientos' && method === 'GET') {
        const comunidadId = url.searchParams.get('comunidadId') || '';
        if (!comunidadId) return jsonResponse({ ok: false, error: 'comunidadId requerido' }, 400, origin);
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getVencimientos', { comunidadId });
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/documentos/resumen' && method === 'GET') {
        const comunidadId = url.searchParams.get('comunidadId') || '';
        if (!comunidadId) return jsonResponse({ ok: false, error: 'comunidadId requerido' }, 400, origin);
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getResumenDocumentos', { comunidadId });
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/documentos/catalogo' && method === 'GET') {
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getCatalogoDocumentos');
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      // ── v3.3 — Catálogo por comunidad ─────────────────────
      if (url.pathname === '/documentos/catalogo-comunidad' && method === 'GET') {
        const comunidadId = url.searchParams.get('comunidadId') || '';
        const categoria   = url.searchParams.get('categoria')   || '';
        if (!comunidadId) return jsonResponse({ ok: false, error: 'comunidadId requerido' }, 400, origin);
        const params = { comunidadId };
        if (categoria) params.categoria = categoria;
        const data = await callAppsScript(APPS_SCRIPT_URL, 'catalogoComunidadDocumentos', params);
        return jsonResponse({ ok: true, data }, 200, origin);
      }


      // ── v3.4 — Leads ──────────────────────────────────────
      if (url.pathname === '/leads' && method === 'GET') {
        const id                = url.searchParams.get('id')                || '';
        const incluirArchivados = url.searchParams.get('incluirArchivados') || 'false';
        if (id) {
          const data = await callAppsScript(APPS_SCRIPT_URL, 'getLead', { id });
          return jsonResponse({ ok: true, data }, 200, origin);
        }
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getLeads', { incluirArchivados });
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/leads/metricas' && method === 'GET') {
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getMetricasLeads');
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/leads' && method === 'POST') {
        const body = await request.json();
        const data = await postAppsScript(APPS_SCRIPT_URL, body);
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      // ── Plantillas de correo ───────────────────────────

      if (url.pathname === '/plantillas' && method === 'GET') {
        const id = url.searchParams.get('id') || '';
        if (id) {
          const data = await callAppsScript(APPS_SCRIPT_URL, 'getPlantilla', { id });
          return jsonResponse({ ok: true, data }, 200, origin);
        }
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getPlantillas');
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/plantillas' && method === 'POST') {
        const body = await request.json();
        const data = await postAppsScript(APPS_SCRIPT_URL, body);
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      // ── Recepción Documental ───────────────────────────────

      if (url.pathname === '/recepciones' && method === 'GET') {
        const id          = url.searchParams.get('id') || '';
        const comunidadId = url.searchParams.get('comunidadId') || '';
        if (id) {
          const data = await callAppsScript(APPS_SCRIPT_URL, 'getRecepcion', { id });
          return jsonResponse({ ok: true, data }, 200, origin);
        }
        if (comunidadId) {
          const data = await callAppsScript(APPS_SCRIPT_URL, 'getRecepcionComunidad', { comunidadId });
          return jsonResponse({ ok: true, data }, 200, origin);
        }
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getRecepciones');
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/recepciones' && method === 'POST') {
        const body = await request.json();
        const data = await postAppsScript(APPS_SCRIPT_URL, body);
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      return jsonResponse({ ok: false, error: 'Ruta no encontrada' }, 404, origin);

    } catch (error) {
      return jsonResponse({ ok: false, error: error.message }, 500, origin);
    }
  },
};
