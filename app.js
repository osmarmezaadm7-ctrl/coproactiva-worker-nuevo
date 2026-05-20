// app.js — CoproActiva
// Versión: 4.0 · Mayo 2026 · rediseño visual
// Mantiene toda la lógica original: router, postMessage diagnóstico,
// sessionStorage para prospectoVinculado, recarga forzada del módulo
// diagnóstico, etc. Solo cambia el HTML del sidebar dinámico.

var WORKER_URL = 'https://coproactiva-worker-nuevo.osmarmeza-adm7.workers.dev';
var ACCESS_KEY = 'copro2025';

let currentModule = 'crm';
const moduleElements = {};
let currentModuleElement = null;
window.moduleElements = moduleElements;
window.moduleCache    = moduleElements;

// ── Módulos que deben recargarse siempre (no cacheados)
const MODULOS_SIN_CACHE = ['diagnostico'];

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

    document.querySelectorAll('.nav-btn[data-modulo]').forEach(btn => {
        btn.addEventListener('click', () => {
            const modulo = btn.getAttribute('data-modulo');
            document.querySelectorAll('.nav-btn[data-modulo]').forEach(b => b.classList.remove('active'));
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

        if (data.type === 'actualizar_diagnostico') {
            const scoreEl  = document.getElementById('sd-score');
            const barFill  = document.getElementById('sd-bar-fill');
            const stepsEls = document.querySelectorAll('#diagSteps li, #sd-steps .sd-step');

            if (scoreEl)  scoreEl.textContent = (data.score || 0) + '%';
            if (barFill)  barFill.style.width  = (data.progress || data.score || 0) + '%';

            stepsEls.forEach(li => {
                li.classList.remove('active');
                const paso = li.dataset.paso || li.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
                if (paso && paso === data.pasoActual) li.classList.add('active');
            });
        }

        if (data.type === 'diagnostico_guardado') {
            console.log('Diagnóstico guardado:', data.nombre);
        }
    });
});

// ── Router principal ──────────────────────────────────────────────────────────
async function cargarModulo(modulo) {
    const contentArea = document.getElementById('contentArea');

    if (currentModuleElement) {
        currentModuleElement.style.display = 'none';
    }

    cargarMenuLateral(modulo);

    if (MODULOS_SIN_CACHE.includes(modulo) && moduleElements[modulo]) {
        moduleElements[modulo].remove();
        delete moduleElements[modulo];
    }

    if (moduleElements[modulo]) {
        moduleElements[modulo].style.display = 'block';
        currentModuleElement = moduleElements[modulo];
        return;
    }

    const loading = document.createElement('div');
    loading.className = 'module-loading';
    loading.innerHTML = `
      <div class="ml-iso-wrap">
        <div class="ml-iso" aria-hidden="true"></div>
      </div>
      <div class="ml-text">
        <div class="ml-brand"><b>co</b>proactiva</div>
        <div class="ml-status">
          <span class="ml-status-dot"></span>
          Cargando ${modulo === 'crm' ? 'CRM' : modulo === 'diagnostico' ? 'Diagnóstico' : 'Flujo de trabajo'}
        </div>
      </div>
    `;
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
        errDiv.className = 'module-error';
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
          <div class="sd-section-label">Resumen</div>
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
          <button class="sd-btn-nuevo" onclick="document.getElementById('btn-nuevo')?.click()">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>
            Nuevo prospecto
          </button>
        `;
        actualizarKpisCRM();
    }

    else if (modulo === 'diagnostico') {
        const pasosFijos = [
            { id: 'contexto',   label: 'Datos comunidad' },
            { id: 'legal',      label: 'Legal' },
            { id: 'financiero', label: 'Financiero' },
            { id: 'laboral',    label: 'Laboral' },
            { id: 'tecnico',    label: 'Técnico' },
            { id: 'seguridad',  label: 'Seguridad' },
            { id: 'documental', label: 'Documental' },
            { id: 'revision',   label: 'Revisión' }
        ];
        sd.innerHTML = `
          <div class="sd-section-label">Diagnóstico actual</div>
          <div class="sd-score-block">
            <div class="sd-score-lbl">Puntaje</div>
            <div class="sd-score-val" id="sd-score">0%</div>
            <div class="sd-score-sub" id="sd-nivel">Sin datos aún</div>
            <div class="sd-bar"><div class="sd-bar-fill" id="sd-bar-fill" style="width:0%"></div></div>
          </div>
          <div class="sd-section-label">Pasos</div>
          <div id="sd-steps">${pasosFijos.map((p, i) => `
            <div class="sd-step" data-paso="${p.id}" onclick="diagGotoStep('${p.id}')">
              <div class="sd-step-n">${i + 1}</div>
              <div class="sd-step-l">${p.label}</div>
            </div>`).join('')}
          </div>
        `;

        const pingIframe = () => {
            const iframe = document.getElementById('diagnosticoIframe');
            if (iframe && iframe.contentWindow) {
                iframe.contentWindow.postMessage({ type: 'diag_ping' }, '*');
            }
        };
        pingIframe();
        setTimeout(pingIframe, 800);
        setTimeout(pingIframe, 2000);
    }

    else if (modulo === 'flujo') {
        sd.innerHTML = `
          <div class="sd-section-label">Marco normativo</div>
          <div class="sd-flujo-info">
            <strong>Ley N°21.442</strong><br>
            Copropiedad inmobiliaria<br><br>
            <strong>DS44</strong><br>
            Reglamento de SST<br><br>
            <strong>Ley Karin</strong><br>
            Protocolo vigente
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
    const scoreEl = document.getElementById('sd-score');
    const nivelEl = document.getElementById('sd-nivel');
    const barFill = document.getElementById('sd-bar-fill');
    const stepsEl = document.getElementById('sd-steps');

    if (scoreEl) scoreEl.textContent = (data.score || 0) + '%';
    if (nivelEl) nivelEl.textContent = data.nivel || 'Sin datos aún';
    if (barFill) barFill.style.width = (data.score || 0) + '%';

    if (stepsEl && data.steps) {
        stepsEl.innerHTML = data.steps.map((s, i) => `
          <div class="sd-step ${s.active ? 'active' : ''} ${s.done ? 'done' : ''}"
               data-paso="${s.id}" onclick="diagGotoStep('${s.id}')">
            <div class="sd-step-n">${s.done ? '✓' : i + 1}</div>
            <div class="sd-step-l">${s.label}</div>
          </div>
        `).join('');
    }
}

// ── Navegar a un paso del diagnóstico desde el sidebar ────────────────────────
function diagGotoStep(viewId) {
    const iframe = document.getElementById('diagnosticoIframe');
    if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'diag_goto', view: viewId }, '*');
        iframe.contentWindow.postMessage({ type: 'cambiar_paso', paso: viewId }, '*');
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
