# Coproactiva CRM híbrido

Versión generada desde los dos ZIP revisados:

- Base operativa: `coproactiva-worker-nuevo-main.zip`
- Base visual: `coproactiva-crm-v2-4-sin-pruebas.zip`

## Criterio aplicado

Se mantuvo el backend original basado en Cloudflare Worker + Apps Script. No se integró Firebase ni Firestore.

El módulo `modules/crm.html` fue reemplazado por una versión híbrida con visual renovado y tabs internas:

1. Resumen
2. Leads
3. Pipeline
4. Diagnóstico
5. Recepción
6. Actividades
7. Plantillas
8. Archivos

## Reglas funcionales aplicadas

- `Leads` reemplaza al antiguo concepto `Dato`.
- `Leads` queda inmediatamente después de `Resumen`.
- Un lead puede convertirse a prospecto mediante la acción original `convertirLead`.
- Un prospecto puede volver a lead desde el detalle del prospecto.
- La etapa `Diagnóstico` queda dentro del pipeline.
- El diagnóstico solo se inicia desde prospectos, no desde leads.
- La recepción documental se muestra únicamente vinculada a prospectos ganados.
- El menú lateral deja de mostrar `Flujo comercial` como módulo separado, porque ahora queda dentro de CRM como tab `Pipeline`.

## Seguridad corregida

Se retiró la clave legacy del Worker, del diagnóstico y del `wrangler.toml`.

`wrangler.toml` ahora declara secretos requeridos:

```toml
[secrets]
required = ["SECRET_KEY", "ANTHROPIC_API_KEY"]
```

Antes de desplegar, configurar:

```bash
npx wrangler secret put SECRET_KEY
npx wrangler secret put ANTHROPIC_API_KEY
```

## Nota sobre “volver prospecto a lead”

El frontend primero intenta usar la acción backend:

```js
{ action: 'convertirProspectoALead', id: prospectoId }
```

Si Apps Script aún no tiene esa acción, usa un fallback operativo:

1. Crea un lead nuevo con los datos del prospecto.
2. Cambia el prospecto original a etapa `Perdido` para sacarlo del pipeline activo.

Para una implementación limpia al 100%, conviene agregar en Apps Script la acción `convertirProspectoALead`, de modo que se haga como movimiento real y no como fallback.

## Archivos modificados principales

- `modules/crm.html`
- `modules/diagnostico.html`
- `diagnostico_standalone.html`
- `index.html`
- `app.js`
- `index.js`
- `wrangler.toml`

## Validación realizada

Se validó sintaxis JavaScript con `node --check` en:

- `app.js`
- `index.js`
- scripts embebidos de módulos principales
- scripts embebidos de `diagnostico_standalone.html`

## Accesos iniciales configurados

El login principal sigue usando `/auth` en `index.js`.

El Worker valida primero los usuarios bootstrap definidos en `BOOTSTRAP_USERS` dentro de `index.js`; si el correo no corresponde a un usuario bootstrap, mantiene el flujo original contra Apps Script mediante la acción `loginUsuario`.

Las claves de estos usuarios bootstrap no están en texto plano: se guardan como hash SHA-256.
