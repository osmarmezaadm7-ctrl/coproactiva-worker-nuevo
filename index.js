// ============================================================
// CoproActiva Worker — index.js
// Versión: 3.7 · Junio 2026
// Cambio v3.4: agrega rutas /leads y /leads/metricas
// Cambio v3.5: agrega rutas /plantillas
// Cambio v3.3: agrega ruta GET /documentos/catalogo-comunidad
// Cambio v3.6: agrega rutas /auth y /usuarios + validación HMAC
// Cambio v3.7: agrega rutas /remuneraciones/trabajadores, /remuneraciones/parametros
// ============================================================

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

// ── Token HMAC ────────────────────────────────────────────────────────────────
// Formato: userId.timestamp.hmac
// Válido por 8 horas

async function generarToken(userId, secretKey) {
  const timestamp = Date.now();
  const mensaje   = `${userId}.${timestamp}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const firma  = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(mensaje));
  const hmac   = Array.from(new Uint8Array(firma)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${mensaje}.${hmac}`;
}

async function validarToken(token, secretKey) {
  if (!token || typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const [userId, timestamp, hmacRecibido] = partes;

  // Verificar expiración (8 horas)
  const ahora = Date.now();
  const emitido = parseInt(timestamp, 10);
  if (isNaN(emitido) || ahora - emitido > 8 * 60 * 60 * 1000) return null;

  // Verificar firma
  const mensaje = `${userId}.${timestamp}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const firma = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(mensaje));
  const hmacEsperado = Array.from(new Uint8Array(firma)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (hmacRecibido !== hmacEsperado) return null;
  return userId;
}

// ── Helpers de validación ─────────────────────────────────────────────────────

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
    const SECRET_KEY      = env.SECRET_KEY;

    // ── Rutas públicas (sin auth) ─────────────────────────────────────────────

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

    // ── v3.6 — Login (público, sin token previo) ──────────────────────────────
    if (url.pathname === '/auth' && method === 'POST') {
      try {
        const body = await request.json();
        if (!body.email || !body.clave) {
          return jsonResponse({ ok: false, error: 'Email y clave requeridos' }, 400, origin);
        }
        const resp = await postAppsScript(APPS_SCRIPT_URL, {
          action: 'loginUsuario',
          email:  body.email,
          clave:  body.clave,
        });
        if (!resp.ok) {
          return jsonResponse({ ok: false, error: resp.error || 'Credenciales incorrectas' }, 401, origin);
        }
        const usuario = resp.data;
        const token   = await generarToken(usuario.id, SECRET_KEY);
        return jsonResponse({
          ok: true,
          data: {
            token,
            id:          usuario.id,
            nombre:      usuario.nombre,
            email:       usuario.email,
            rol:         usuario.rol,
            modulos:     usuario.modulos,
            comunidades: usuario.comunidades,
          }
        }, 200, origin);
      } catch (error) {
        return jsonResponse({ ok: false, error: error.message }, 500, origin);
      }
    }

    // ── Rutas protegidas — validar token HMAC ────────────────────────────────
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();

    // Compatibilidad transitoria: acepta clave legacy durante migración
    // TODO: eliminar ACCESS_KEY_LEGACY una vez que todos los clientes usen el nuevo login
    const ACCESS_KEY_LEGACY = env.ACCESS_KEY || 'copro2025';
    const esLegacy = token === ACCESS_KEY_LEGACY;
    const userId   = esLegacy ? 'legacy' : await validarToken(token, SECRET_KEY);

    if (!userId) {
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

      // ── Plantillas de correo ───────────────────────────────
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

      // ── v3.6 — Usuarios (requiere superadmin — validación en GAS) ─────────
      if (url.pathname === '/usuarios' && method === 'GET') {
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getUsuarios');
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/usuarios' && method === 'POST') {
        const body = await request.json();
        const data = await postAppsScript(APPS_SCRIPT_URL, body);
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      // ── v3.7 — Remuneraciones: Trabajadores ──────────────────
      if (url.pathname === '/remuneraciones/trabajadores' && method === 'GET') {
        const id          = url.searchParams.get('id')          || '';
        const comunidadId = url.searchParams.get('comunidadId') || '';
        if (id) {
          const data = await callAppsScript(APPS_SCRIPT_URL, 'getTrabajador', { id });
          return jsonResponse({ ok: true, data }, 200, origin);
        }
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getTrabajadores', { comunidadId });
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/remuneraciones/trabajadores' && method === 'POST') {
        const body = await request.json();
        const data = await postAppsScript(APPS_SCRIPT_URL, body);
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/remuneraciones/trabajadores/resumen' && method === 'GET') {
        const comunidadId = url.searchParams.get('comunidadId') || '';
        if (!comunidadId) return jsonResponse({ ok: false, error: 'comunidadId requerido' }, 400, origin);
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getResumenTrabajadores', { comunidadId });
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/remuneraciones/trabajadores/previred' && method === 'GET') {
        const id = url.searchParams.get('id') || '';
        if (!id) return jsonResponse({ ok: false, error: 'id requerido' }, 400, origin);
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getDatosPrevired', { id });
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      // ── v3.7 — Remuneraciones: Parámetros ─────────────────
      if (url.pathname === '/remuneraciones/parametros/indicadores' && method === 'GET') {
        const periodo = url.searchParams.get('periodo') || '';
        const data    = await callAppsScript(APPS_SCRIPT_URL, 'getIndicadoresRem', { periodo });
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/remuneraciones/parametros/indicadores' && method === 'POST') {
        const body = await request.json();
        const data = await postAppsScript(APPS_SCRIPT_URL, body);
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/remuneraciones/parametros/plantillas' && method === 'GET') {
        const cargo = url.searchParams.get('cargo') || '*';
        const todas = url.searchParams.get('todas') || 'false';
        if (todas === 'true') {
          const data = await callAppsScript(APPS_SCRIPT_URL, 'getTodasPlantillas');
          return jsonResponse({ ok: true, data }, 200, origin);
        }
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getPlantillaOnboarding', { cargo });
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/remuneraciones/parametros/plantillas' && method === 'POST') {
        const body = await request.json();
        const data = await postAppsScript(APPS_SCRIPT_URL, body);
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/remuneraciones/parametros/cargos' && method === 'GET') {
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getCargosRem');
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      if (url.pathname === '/remuneraciones/parametros/cargos' && method === 'POST') {
        const body = await request.json();
        const data = await postAppsScript(APPS_SCRIPT_URL, body);
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      // ── v3.7 — Scraping indicadores Previred ─────────────────────────────
      if (url.pathname === '/remuneraciones/parametros/scraping-previred' && method === 'GET') {
        try {
          // Construir URL del PDF del mes actual
          const MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                            'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
          const ahora    = new Date();
          const anio     = ahora.getFullYear();
          const mesIdx   = ahora.getMonth();
          const mesNum   = String(mesIdx + 1).padStart(2, '0');
          const mesNombre = MESES_ES[mesIdx];

          // Intentar primero con v2, luego sin sufijo
          const urls = [
            `https://www.previred.com/wp-content/uploads/${anio}/${mesNum}/Indicadores-Previsionales-Previred-${mesNombre}-${anio}v2.pdf`,
            `https://www.previred.com/wp-content/uploads/${anio}/${mesNum}/Indicadores-Previsionales-Previred-${mesNombre}-${anio}.pdf`,
          ];

          let texto = null;
          let urlUsada = null;
          for (const u of urls) {
            try {
              const r = await fetch(u);
              if (r.ok) {
                // Cloudflare Worker no puede parsear PDF binario directamente
                // Obtenemos el buffer y extraemos texto legible
                const buf = await r.arrayBuffer();
                const bytes = new Uint8Array(buf);
                let str = '';
                for (let i = 0; i < bytes.length; i++) {
                  if (bytes[i] >= 32 && bytes[i] < 127) str += String.fromCharCode(bytes[i]);
                  else str += ' ';
                }
                texto = str;
                urlUsada = u;
                break;
              }
            } catch(e) { continue; }
          }

          if (!texto) {
            return jsonResponse({ ok: false, error: 'No se pudo obtener el PDF de Previred. Intenta el mes anterior o ingresa los valores manualmente.' }, 200, origin);
          }

          // ── Parser de valores ──────────────────────────────────────────────
          function extraerMonto(texto, patrones) {
            for (const re of patrones) {
              const m = texto.match(re);
              if (m) {
                const val = m[1].replace(/\./g,'').replace(',','.');
                return parseFloat(val);
              }
            }
            return null;
          }

          function extraerPct(texto, patrones) {
            for (const re of patrones) {
              const m = texto.match(re);
              if (m) return parseFloat(m[1].replace(',','.'));
            }
            return null;
          }

          const indicadores = {};

          // UF mes actual — primer valor grande con decimales
          const ufMatch = texto.match(/\$\s*([0-9]{2}\.[0-9]{3})[,.]([0-9]{2})/);
          if (ufMatch) indicadores['UF_MES'] = parseFloat(ufMatch[1].replace('.','') + '.' + ufMatch[2]);

          // IMM — buscar valor cercano a 500.000-600.000
          const immMatch = texto.match(/\$([45][0-9]{2}\.[0-9]{3})/g);
          if (immMatch && immMatch.length > 0) {
            indicadores['IMM'] = parseInt(immMatch[0].replace(/\$|\./g,''));
          }

          // SIS — buscar 1,49% o 1,62%
          const sisMatch = texto.match(/([12],[46][0-9])%/);
          if (sisMatch) indicadores['SIS_TASA'] = parseFloat(sisMatch[1].replace(',','.'));

          // Tasas AFP — buscar patrones como "11,44%" cerca de nombre AFP
          const afpPatrones = [
            { key: 'AFP_33_CAPITAL',   re: /apital[^0-9]{0,20}([0-9]{2},[0-9]{2})%/ },
            { key: 'AFP_03_CUPRUM',    re: /uprum[^0-9]{0,20}([0-9]{2},[0-9]{2})%/ },
            { key: 'AFP_05_HABITAT',   re: /abitat[^0-9]{0,20}([0-9]{2},[0-9]{2})%/ },
            { key: 'AFP_34_MODELO',    re: /odelo[^0-9]{0,20}([0-9]{2},[0-9]{2})%/ },
            { key: 'AFP_29_PLANVITAL', re: /lanVital[^0-9]{0,20}([0-9]{2},[0-9]{2})%/ },
            { key: 'AFP_08_PROVIDA',   re: /rovida[^0-9]{0,20}([0-9]{2},[0-9]{2})%/ },
            { key: 'AFP_35_UNO',       re: /no[^0-9]{0,10}([0-9]{2},[0-9]{2})%/ },
          ];
          for (const { key, re } of afpPatrones) {
            const m = texto.match(re);
            if (m) indicadores[key] = parseFloat(m[1].replace(',','.'));
          }

          // Asignación familiar — montos
          const afMontos = texto.match(/\$\s*([0-9]{1,2}\.[0-9]{3})/g);
          if (afMontos && afMontos.length >= 2) {
            indicadores['AF_TRAMO_A_MONTO'] = parseInt(afMontos[0].replace(/\$|\s|\./g,''));
            indicadores['AF_TRAMO_B_MONTO'] = parseInt(afMontos[1].replace(/\$|\s|\./g,''));
          }

          return jsonResponse({
            ok: true,
            data: {
              indicadores,
              urlUsada,
              mes: mesNombre + ' ' + anio,
              advertencia: 'Revisa los valores antes de guardar. El parser puede no extraer todos los datos correctamente desde el PDF.'
            }
          }, 200, origin);

        } catch(err) {
          return jsonResponse({ ok: false, error: 'Error en scraping: ' + err.message }, 200, origin);
        }
      }

      if (url.pathname === '/remuneraciones/instalar' && method === 'POST') {
        const data = await postAppsScript(APPS_SCRIPT_URL, { action: 'instalarHojasParametrosRem' });
        const data2 = await postAppsScript(APPS_SCRIPT_URL, { action: 'instalarHojaTrabajadores' });
        return jsonResponse({ ok: true, parametros: data, trabajadores: data2 }, 200, origin);
      }

      return jsonResponse({ ok: false, error: 'Ruta no encontrada' }, 404, origin);

    } catch (error) {
      return jsonResponse({ ok: false, error: error.message }, 500, origin);
    }
  },
};
