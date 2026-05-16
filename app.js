// app.js — CoproActiva
// Versión: 3.1 · Mayo 2026
// Fix: módulo diagnóstico siempre recarga para leer sessionStorage fresco

var WORKER_URL = 'https://coproactiva-worker-nuevo.osmarmeza-adm7.workers.dev';
var ACCESS_KEY = 'copro2025';

let currentModule = 'crm';
const moduleElements = {};
let currentModuleElement = null;
window.moduleElements = moduleElements;
window.moduleCache    = moduleElements;

// ── Módulos que deben recargarse siempre (no cacheados)
// El diagnóstico necesita leer sessionStorage fresco con el prospecto cada vez
const MODULOS_SIN_CACHE = ['diagnostico'];

// ── Estilos del sidebar dinámico ─────────────────────────────────────────────
const SIDEBAR_STYLES = `
<style>
#sidebarDynamic {
  padding: 10px;
  border-top: 1px solid rgba(255,255,255,0.08);
  margin-top: 10px;
  flex: 1;
  overflow-y: auto;
}

/* ── Menú CRM ── */
.sd-stat { padding: 6px 8px; margin-bottom: 4px; border-radius: 6px; background: rgba(255,255,255,0.05); }
.sd-stat-label { font-size: 9px; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.8px; }
.sd-stat-val   { font-size: 20px; font-weight: 700; color: white; line-height: 1.2; }
.sd-stat-val.urgente { color: #B83232; }
.sd-stat-val.ganado  { color: #6FA885; }
.sd-btn-nuevo {
  width: 100%; padding: 10px; margin-top: 8px;
  background: #D18549; color: white; border: none;
  border-radius: 8px; font-size: 13px; font-weight: 700;
  cursor: pointer; text-align: center;
}
.sd-btn-nuevo:hover { opacity: 0.88; }

/* ── Menú Diagnóstico ── */
.sd-score-lbl { font-size: 9px; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 3px; }
.sd-score-val { font-size: 28px; font-weight: 700; color: white; line-height: 1; }
.sd-score-sub { font-size: 10px; color: rgba(255,255,255,0.4); margin-top: 2px; margin-bottom: 6px; }
.sd-bar       { height: 3px; background: rgba(255,255,255,0.1); border-radius: 2px; margin-bottom: 12px; overflow: hidden; }
.sd-bar-fill  { height: 100%; border-radius: 2px; background: #D18549; transition: width 0.4s; }
.sd-step {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 8px; border-radius: 6px;
  cursor: pointer; transition: background 0.12s;
}
.sd-step:hover  { background: rgba(255,255,255,0.05); }
.sd-step.active { background: rgba(209,133,73,0.18); }
.sd-step.done .sd-step-n { background: #6FA885; border-color: #6FA885; color: white; font-size: 8px; }
.sd-step.active .sd-step-n { background: #D18549; border-color: #D18549; color: white; }
.sd-step-n {
  width: 20px; height: 20px; border-radius: 50%;
  border: 1.5px solid rgba(255,255,255,0.2);
  display: flex; align-items: center; justify-content: center;
  font-size: 9px; color: rgba(255,255,255,0.3);
  flex-shrink: 0; transition: all 0.2s;
}
.sd-step-l { font-size: 12px; color: rgba(255,255,255,0.4); transition: color 0.12s; }
.sd-step.active .sd-step-l { color: white; font-weight: 600; }
.sd-step.done .sd-step-l   { color: rgba(255,255,255,0.6); }

/* ── Menú Flujo ── */
.sd-flujo-info { font-size: 11px; color: rgba(255,255,255,0.35); padding: 8px; line-height: 1.5; }
</style>
`;

document.head.insertAdjacentHTML('beforeend', SIDEBAR_STYLES);

// ── Inicialización ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const loginScreen  = document.getElementById('loginScreen');
    const appContainer = document.getElementById('app');
    const loginBtn     = document.getElementById('loginBtn');
    const claveInput   = document.getElementById('claveInput');
    const loginError   = document.getElementById('loginError');

    loginBtn.addEventListener('click', () => {
        const clave = claveInput.value;
        if (clave === ACCESS_KEY) {
            sessionStorage.setItem('token', clave);
            loginScreen.style.display = 'none';
            appContainer.style.display = 'flex';
            cargarModulo(currentModule);
        } else {
            loginError.textContent = 'Clave incorrecta';
        }
    });

    claveInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') loginBtn.click();
    });

    if (sessionStorage.getItem('token') === ACCESS_KEY) {
        loginScreen.style.display = 'none';
        appContainer.style.display = 'flex';
        cargarModulo(currentModule);
    }

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modulo = btn.getAttribute('data-modulo');
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll(`.nav-btn[data-modulo="${modulo}"]`).forEach(b => b.classList.add('active'));
            currentModule = modulo;
            cargarModulo(modulo);
        });
    });

    // Escuchar mensajes del iframe del diagnóstico
    window.addEventListener('message', function(event) {
        const data = event.data;
        if (!data || !data.type) return;
        if (data.type === 'diag_estado') {
            actualizarMenuDiagnostico(data);
        }
        if (data.type === 'diagnostico_guardado') {
            console.log('Diagnóstico guardado:', data.nombre);
        }
    });
});

// ── Router principal ──────────────────────────────────────────────────────────
async function cargarModulo(modulo) {
    const contentArea = document.getElementById('contentArea');

    // Ocultar módulo actual
    if (currentModuleElement) {
        currentModuleElement.style.display = 'none';
    }

    // Cargar menú lateral según módulo
    cargarMenuLateral(modulo);

    // Módulos sin caché: destruir wrapper existente para forzar recarga completa
    // Necesario para diagnóstico, que lee sessionStorage fresco en cada navegación
    if (MODULOS_SIN_CACHE.includes(modulo) && moduleElements[modulo]) {
        moduleElements[modulo].remove();
        delete moduleElements[modulo];
    }

    // Si ya existe en el DOM (y no fue destruido arriba), solo mostrar
    if (moduleElements[modulo]) {
        moduleElements[modulo].style.display = 'block';
        currentModuleElement = moduleElements[modulo];
        return;
    }

    // Primera carga (o recarga forzada)
    const loading = document.createElement('div');
    loading.style.cssText = 'text-align:center;padding:40px;color:#6b7280;';
    loading.textContent = 'Cargando...';
    contentArea.appendChild(loading);

    try {
        const response = await fetch(`modules/${modulo}.html`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();

        loading.remove();

        const wrapper = document.createElement('div');
        wrapper.setAttribute('data-modulo', modulo);
        wrapper.style.width = '100%';

        const temp = document.createElement('div');
        temp.innerHTML = html;
        const scripts = Array.from(temp.querySelectorAll('script'));
        scripts.forEach(s => s.remove());
        wrapper.innerHTML = temp.innerHTML;

        contentArea.appendChild(wrapper);
        moduleElements[modulo] = wrapper;
        currentModuleElement = wrapper;

        scripts.forEach(oldScript => {
            const newScript = document.createElement('script');
            if (oldScript.src) {
                newScript.src = oldScript.src;
            } else {
                newScript.textContent = oldScript.textContent;
            }
            document.body.appendChild(newScript);
            document.body.removeChild(newScript);
        });

    } catch (error) {
        loading.remove();
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'color:#b83232;padding:20px;';
        errDiv.textContent = `Error al cargar ${modulo}: ${error.message}`;
        contentArea.appendChild(errDiv);
    }
}

// ── Sidebar dinámico ──────────────────────────────────────────────────────────
function cargarMenuLateral(modulo) {
    const sd = document.getElementById('sidebarDynamic');
    if (!sd) return;

    if (modulo === 'crm') {
        sd.innerHTML = `
          <div class="sd-stat">
            <div class="sd-stat-label">Activos</div>
            <div class="sd-stat-val" id="sd-activos">—</div>
          </div>
          <div class="sd-stat">
            <div class="sd-stat-label">Urgentes</div>
            <div class="sd-stat-val urgente" id="sd-urgentes">—</div>
          </div>
          <div class="sd-stat">
            <div class="sd-stat-label">Ganados</div>
            <div class="sd-stat-val ganado" id="sd-ganados">—</div>
          </div>
          <button class="sd-btn-nuevo" onclick="document.getElementById('btn-nuevo')?.click()">＋ Nuevo prospecto</button>
        `;
        actualizarKpisCRM();
    }

    else if (modulo === 'diagnostico') {
        sd.innerHTML = `
          <div class="sd-score-lbl">Puntaje actual</div>
          <div class="sd-score-val" id="sd-score">0%</div>
          <div class="sd-score-sub" id="sd-nivel">Sin datos aún</div>
          <div class="sd-bar"><div class="sd-bar-fill" id="sd-bar-fill" style="width:0%"></div></div>
          <div id="sd-steps"></div>
        `;
        const iframe = document.getElementById('diagnosticoIframe');
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({ type: 'diag_ping' }, '*');
        }
    }

    else if (modulo === 'flujo') {
        sd.innerHTML = `
          <div class="sd-flujo-info">
            Flujo comercial · 3 líneas de trabajo · Ley N°21.442
          </div>
        `;
    }
}

// ── Actualizar KPIs del CRM en el sidebar ─────────────────────────────────────
function actualizarKpisCRM() {
    setTimeout(() => {
        if (window._crmKpis) {
            const el = {
                activos:  document.getElementById('sd-activos'),
                urgentes: document.getElementById('sd-urgentes'),
                ganados:  document.getElementById('sd-ganados'),
            };
            if (el.activos)  el.activos.textContent  = window._crmKpis.activos  ?? '—';
            if (el.urgentes) el.urgentes.textContent = window._crmKpis.urgentes ?? '—';
            if (el.ganados)  el.ganados.textContent  = window._crmKpis.ganados  ?? '—';
        }
    }, 800);
}

// ── Actualizar sidebar del diagnóstico desde postMessage ──────────────────────
function actualizarMenuDiagnostico(data) {
    if (currentModule !== 'diagnostico') return;

    const scoreEl   = document.getElementById('sd-score');
    const nivelEl   = document.getElementById('sd-nivel');
    const barFill   = document.getElementById('sd-bar-fill');
    const stepsEl   = document.getElementById('sd-steps');

    if (scoreEl)  scoreEl.textContent  = (data.score || 0) + '%';
    if (scoreEl)  scoreEl.style.color  = data.color || 'white';
    if (nivelEl)  nivelEl.textContent  = data.nivel || 'Sin datos aún';
    if (barFill)  barFill.style.width  = (data.score || 0) + '%';
    if (barFill)  barFill.style.background = data.color || '#D18549';

    if (stepsEl && data.steps) {
        stepsEl.innerHTML = data.steps.map((s, i) => `
          <div class="sd-step ${s.active ? 'active' : ''} ${s.done ? 'done' : ''}"
               onclick="diagGotoStep('${s.id}')">
            <div class="sd-step-n">${s.done ? '✓' : i + 1}</div>
            <div class="sd-step-l">${s.emoji ? s.emoji + ' ' : ''}${s.label}</div>
          </div>
        `).join('');
    }
}

// ── Navegar a un paso del diagnóstico desde el sidebar ────────────────────────
function diagGotoStep(viewId) {
    const iframe = document.getElementById('diagnosticoIframe');
    if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'diag_goto', view: viewId }, '*');
    }
}

// ── Helper global para llamadas al Worker ─────────────────────────────────────
async function apiCall(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${ACCESS_KEY}`,
            'Content-Type': 'application/json'
        }
    };
    if (body) options.body = JSON.stringify(body);
    const response = await fetch(`${WORKER_URL}${endpoint}`, options);
    return response.json();
}
