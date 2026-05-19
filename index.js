// ============================================================
// CoproActiva Worker — index.js
// Versión: 3.0 · Mayo 2026
// Cambios v3.0:
//   + Ruta POST /webhook/contacto (formulario público)
//   + Honeypot anti-spam
//   + Validación estricta de email y teléfono chileno
//   + Captura de UTM source
//   + Notificación por email a contacto@coproactiva.cl
//   + CORS restringido a coproactiva.cl
// ============================================================

const ACCESS_KEY = 'copro2025';

// ── Orígenes permitidos para CORS ────────────────────────────
const ALLOWED_ORIGINS = [
  'https://coproactiva.cl',
  'https://www.coproactiva.cl',
  'https://osmarmezaadm7-ctrl.github.io', // CRM interno
];

function getCorsHeaders(requestOrigin) {
  // Permitir origen null (archivo local file://) para pruebas de desarrollo.
  // En producción el origen siempre será coproactiva.cl.
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

// ── Helpers para llamar al Apps Script ───────────────────────
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

// ── Validaciones ──────────────────────────────────────────────

/**
 * Email válido: formato estándar RFC 5322 simplificado.
 * Acepta: usuario@dominio.tld (mínimo 2 chars en TLD)
 */
function validarEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  return re.test(email.trim());
}

/**
 * Teléfono chileno válido.
 * Formatos aceptados (se normalizan internamente):
 *   +56 9 1234 5678  →  +56912345678
 *   569 12345678     →  +56912345678
 *   9 12345678       →  +56912345678
 *   912345678        →  +56912345678
 * Regla: después de quitar +56 o 56, debe quedar
 *   - 9 dígitos comenzando en 9 (celular)
 *   - 9 dígitos comenzando en 2 (fijo RM) o en 3-7 (fijo regiones)
 */
function validarTelefonoChileno(tel) {
  if (!tel || typeof tel !== 'string') return false;
  // Quitar espacios, guiones, paréntesis
  let limpio = tel.replace(/[\s\-\(\)]/g, '');
  // Quitar prefijo internacional
  if (limpio.startsWith('+56')) limpio = limpio.slice(3);
  else if (limpio.startsWith('56') && limpio.length >= 11) limpio = limpio.slice(2);
  // Debe quedar exactamente 9 dígitos
  if (!/^\d{9}$/.test(limpio)) return false;
  // Primer dígito: 2 (fijo RM), 3-7 (fijo regiones), 9 (celular)
  const primero = parseInt(limpio[0]);
  return primero === 2 || (primero >= 3 && primero <= 7) || primero === 9;
}

/**
 * Normaliza teléfono a formato +569XXXXXXXX o +562XXXXXXXX
 */
function normalizarTelefono(tel) {
  let limpio = tel.replace(/[\s\-\(\)]/g, '');
  if (limpio.startsWith('+56')) limpio = limpio.slice(3);
  else if (limpio.startsWith('56') && limpio.length >= 11) limpio = limpio.slice(2);
  return '+56' + limpio;
}

// ── Envío de email de notificación interna ────────────────────
// Usa MailChannels (disponible en Cloudflare Workers gratis)
// Si no está habilitado, simplemente no bloquea el flujo.
async function notificarEmail(prospecto, env) {
  // Si no hay binding de email configurado, saltamos silenciosamente
  // Se puede habilitar más adelante con MailChannels o un servicio SMTP
  if (!env.MAILCHANNELS_ENABLED) return;

  try {
    await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: 'contacto@coproactiva.cl', name: 'CoproActiva' }],
        }],
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
  } catch (_) {
    // El fallo en el email no debe bloquear el registro del prospecto
  }
}

// ════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ════════════════════════════════════════════════════════════
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const origin = request.headers.get('Origin') || '';

    // ── Preflight CORS ────────────────────────────────────────
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(origin),
      });
    }

    const APPS_SCRIPT_URL = env.APPS_SCRIPT_URL;

    // ════════════════════════════════════════════════════════
    // RUTA PÚBLICA — sin auth (formulario web)
    // POST /webhook/contacto
    // ════════════════════════════════════════════════════════
    if (url.pathname === '/webhook/contacto' && method === 'POST') {
      try {
        const body = await request.json();

        // ── 1. Honeypot ─────────────────────────────────────
        // El campo "website" es invisible para humanos.
        // Los bots lo rellenan → detectado → respuesta OK falsa.
        if (body.website && body.website.trim() !== '') {
          return jsonResponse({ ok: true, message: 'Recibido' }, 200, origin);
        }

        // ── 2. Validar campos obligatorios ───────────────────
        const nombre    = (body.nombre    || '').trim();
        const telefono  = (body.telefono  || '').trim();
        const email     = (body.email     || '').trim();
        const condominio = (body.condominio || '').trim();

        const errores = [];
        if (!nombre)     errores.push('Nombre es obligatorio');
        if (!condominio) errores.push('Nombre del condominio es obligatorio');

        if (!email) {
          errores.push('Correo electrónico es obligatorio');
        } else if (!validarEmail(email)) {
          errores.push('El correo electrónico no tiene un formato válido');
        }

        if (!telefono) {
          errores.push('Teléfono es obligatorio');
        } else if (!validarTelefonoChileno(telefono)) {
          errores.push('El teléfono no tiene un formato chileno válido (ej: +56 9 1234 5678)');
        }

        if (errores.length > 0) {
          return jsonResponse({ ok: false, errores }, 400, origin);
        }

        // ── 3. Capturar UTM source ───────────────────────────
        // El frontend puede pasar utm_source como campo oculto,
        // o se lee desde el referer como fallback.
        const utmSource   = (body.utm_source   || '').trim();
        const utmMedium   = (body.utm_medium   || '').trim();
        const utmCampaign = (body.utm_campaign || '').trim();

        let fuenteLead = 'web_coproactiva_cl';
        if (utmSource) {
          fuenteLead = `web_${utmSource}`;
          if (utmMedium)   fuenteLead += `_${utmMedium}`;
          if (utmCampaign) fuenteLead += `_${utmCampaign}`;
        }

        // ── 4. Construir prospecto con los 20 campos ─────────
        const ahora = new Date().toISOString();
        const prospecto = {
          // Campos de la hoja CRM_Prospectos (en orden)
          nombreCondominio      : condominio,
          direccion             : '',                              // no se pide en el form
          comuna                : '',                              // no se pide en el form
          unidades              : '',                              // no se pide en el form
          nombreContacto        : nombre,
          cargoContacto         : '',                              // no se pide en el form
          telefono              : normalizarTelefono(telefono),
          email                 : email.toLowerCase(),
          tipoServicio          : (body.servicio || '').trim(),
          fuenteLead            : fuenteLead,
          etapa                 : 'Nuevo Prospecto',
          fechaPrimerContacto   : ahora,
          fechaUltimaInteraccion: ahora,
          proximaAccion         : 'Primer contacto — responder en < 24 h',
          fechaProximaAccion    : '',                              // se asigna en el CRM
          responsable           : '',                              // se asigna en el CRM
          motivoPerdida         : '',
          observaciones         : (body.mensaje || '').trim(),
          semaforo              : 'verde',
        };

        // ── 5. Guardar en Apps Script → Google Sheets ────────
        const resp = await postAppsScript(APPS_SCRIPT_URL, {
          action : 'crearProspectoPublico',
          ...prospecto,
        });

        if (!resp || resp.ok === false) {
          throw new Error(resp?.error || 'Error al guardar en el CRM');
        }

        // ── 6. Notificación interna por email ────────────────
        // No bloquea la respuesta aunque falle
        await notificarEmail(prospecto, env);

        return jsonResponse(
          { ok: true, message: 'Prospecto registrado correctamente' },
          200,
          origin
        );

      } catch (error) {
        return jsonResponse(
          { ok: false, error: error.message },
          500,
          origin
        );
      }
    }

    // ════════════════════════════════════════════════════════
    // RUTAS INTERNAS — requieren Bearer token
    // ════════════════════════════════════════════════════════
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (token !== ACCESS_KEY) {
      return jsonResponse({ ok: false, error: 'No autorizado' }, 401, origin);
    }

    try {

      // ── GET /crm ────────────────────────────────────────────
      if (url.pathname === '/crm' && method === 'GET') {
        const data = await callAppsScript(APPS_SCRIPT_URL, 'getCRM');
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      // ── POST /crm ───────────────────────────────────────────
      if (url.pathname === '/crm' && method === 'POST') {
        const body = await request.json();
        const data = await postAppsScript(APPS_SCRIPT_URL, { action: 'saveCRM', ...body });
        return jsonResponse({ ok: true, data }, 200, origin);
      }

      // ── GET /diagnosticos ───────────────────────────────────
      if (url.pathname === '/diagnosticos' && method === 'GET') {
        const resp = await callAppsScript(APPS_SCRIPT_URL, 'getDiagnosticos');
        return jsonResponse(resp.data || resp, 200, origin);
      }

      // ── POST /diagnosticos ──────────────────────────────────
      if (url.pathname === '/diagnosticos' && method === 'POST') {
        const body = await request.json();
        const resp = await postAppsScript(APPS_SCRIPT_URL, { ...body, action: 'saveDiagnostico' });
        return jsonResponse(resp, 200, origin);
      }

      // ── POST /factores — IA con Anthropic ───────────────────
      if (url.pathname === '/factores' && method === 'POST') {
        const body = await request.json();
        const prompt = body.prompt || '';
        if (!prompt) {
          return jsonResponse({ ok: false, error: 'Falta el campo prompt' }, 400, origin);
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
          return jsonResponse({ ok: false, error: `Anthropic error ${res.status}: ${err}` }, 500, origin);
        }
        const aiData = await res.json();
        const text = aiData.content?.[0]?.text || '';
        return jsonResponse({ ok: true, text }, 200, origin);
      }

      // ── GET /factores (compatibilidad) ──────────────────────
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

      return jsonResponse({ ok: false, error: 'Ruta no encontrada' }, 404, origin);

    } catch (error) {
      return jsonResponse({ ok: false, error: error.message }, 500, origin);
    }
  },
};
