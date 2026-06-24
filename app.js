// app.js — CoproActiva
// Versión: 5.0 · Junio 2026 · sistema de usuarios con email+clave
// Mantiene toda la lógica original intacta.

var WORKER_URL = 'https://coproactiva-worker-nuevo.osmarmeza-adm7.workers.dev';

// ── Sesión ────────────────────────────────────────────────────────────────────
// El token ahora es HMAC generado por el Worker, no la clave en texto plano.
// Se guarda en sessionStorage junto con los datos del usuario.

function _getToken()    { return sessionStorage.getItem('token') || ''; }
function _getUsuario()  { try { return JSON.parse(sessionStorage.getItem('usuario') || 'null'); } catch(e) { return null; } }
function _getSesionOk() { return !!_getToken() && !!_getUsuario(); }

function _guardarSesion(data) {
    sessionStorage.setItem('token',    data.token);
    sessionStorage.setItem('usuario',  JSON.stringify({
        id:          data.id,
        nombre:      data.nombre,
        email:       data.email,
        rol:         data.rol,
        modulos:     data.modulos,
        comunidades: data.comunidades,
    }));
}

function _cerrarSesion() {
    sessionStorage.clear();
    location.reload();
}

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
    const loginError   = document.getElementById('loginError');

    // ── Login con email + clave ───────────────────────────────────────────────
    async function doLogin() {
        const email = (document.getElementById('emailInput')?.value || '').trim();
        const clave = (document.getElementById('claveInput')?.value || '').trim();
        if (!email || !clave) {
            loginError.textContent = 'Ingresa tu email y clave';
            return;
        }
        loginBtn.disabled = true;
        loginBtn.textContent = 'Ingresando…';
        loginError.textContent = '';
        try {
            const resp = await fetch(`${WORKER_URL}/auth`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, clave }),
            });
            const json = await resp.json();
            if (!json.ok) {
                loginError.textContent = json.error || 'Credenciales incorrectas';
                return;
            }
            _guardarSesion(json.data);
            loginScreen.style.display = 'none';
            appContainer.style.display = 'flex';
            _iniciarApp();
        } catch(e) {
            loginError.textContent = 'Error de conexión. Intenta nuevamente.';
        } finally {
            loginBtn.disabled = false;
            loginBtn.textContent = 'Ingresar';
        }
    }

    loginBtn.addEventListener('click', doLogin);

    document.getElementById('claveInput')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') doLogin();
    });
    document.getElementById('emailInput')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') doLogin();
    });

    // ── Sesión activa ─────────────────────────────────────────────────────────
    if (_getSesionOk()) {
        loginScreen.style.display = 'none';
        appContainer.style.display = 'flex';
        _iniciarApp();
        return;
    }

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

// ── Iniciar app post-login ────────────────────────────────────────────────────
function _iniciarApp() {
    const usuario = _getUsuario();

    // Mostrar nombre real en el avatar del sidebar
    const avatarNombre = document.getElementById('sidebarUserName');
    const avatarInicial = document.getElementById('sidebarUserInitial');
    if (avatarNombre && usuario) avatarNombre.textContent = usuario.nombre;
    if (avatarInicial && usuario) avatarInicial.textContent = usuario.nombre.charAt(0).toUpperCase();

    // Filtrar sidebar según módulos del usuario
    _filtrarSidebar(usuario);

    // Botón cerrar sesión
    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) btnLogout.addEventListener('click', _cerrarSesion);

    // Botón cambiar clave
    const btnCambiarClave = document.getElementById('btnCambiarClave');
    if (btnCambiarClave) btnCambiarClave.addEventListener('click', _abrirModalCambiarClave);

    // Navegación sidebar
    document.querySelectorAll('.nav-btn[data-modulo]').forEach(btn => {
        btn.addEventListener('click', () => {
            const modulo = btn.getAttribute('data-modulo');
            document.querySelectorAll('.nav-btn[data-modulo]').forEach(b => b.classList.remove('active'));
            document.querySelectorAll(`.nav-btn[data-modulo="${modulo}"]`).forEach(b => b.classList.add('active'));
            currentModule = modulo;
            cargarModulo(modulo);
        });
    });

    cargarModulo(currentModule);
}

// ── Filtrar sidebar según módulos del usuario ─────────────────────────────────
function _filtrarSidebar(usuario) {
    if (!usuario) return;
    const modulos = usuario.modulos || ['*'];
    if (modulos.includes('*')) return; // superadmin/admin ven todo

    document.querySelectorAll('.nav-btn[data-modulo]').forEach(btn => {
        const modulo = btn.getAttribute('data-modulo');
        if (!modulos.includes(modulo)) {
            btn.style.display = 'none';
        }
    });

    // Ocultar también items del menú de navegación por data-nav
    document.querySelectorAll('[data-nav-modulo]').forEach(el => {
        const modulo = el.getAttribute('data-nav-modulo');
        if (!modulos.includes(modulo)) {
            el.style.display = 'none';
        }
    });
}

// ── Modal cambiar clave ───────────────────────────────────────────────────────
function _abrirModalCambiarClave() {
    // Crear modal si no existe
    if (document.getElementById('modalCambiarClave')) {
        document.getElementById('modalCambiarClave').style.display = 'flex';
        return;
    }
    const overlay = document.createElement('div');
    overlay.id = 'modalCambiarClave';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999';

    const card = document.createElement('div');
    card.style.cssText = 'background:#fff;border-radius:12px;padding:28px;width:360px;max-width:90vw;display:flex;flex-direction:column;gap:14px';

    const titulo = document.createElement('div');
    titulo.style.cssText = 'font-size:16px;font-weight:800;color:#1A1714;letter-spacing:-0.02em';
    titulo.textContent = 'Cambiar clave';

    const errMsg = document.createElement('div');
    errMsg.style.cssText = 'color:#e53e3e;font-size:12px;font-weight:600;min-height:16px';

    function crearCampo(label, id) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;gap:5px';
        const lbl = document.createElement('label');
        lbl.textContent = label;
        lbl.style.cssText = 'font-size:12px;font-weight:700;color:#6B6560';
        const inp = document.createElement('input');
        inp.type = 'password';
        inp.id = id;
        inp.style.cssText = 'border:1.5px solid #E5DDD4;border-radius:8px;padding:10px 12px;font-size:14px;font-family:inherit;outline:none';
        wrap.appendChild(lbl);
        wrap.appendChild(inp);
        return wrap;
    }

    const campoActual = crearCampo('Clave actual', 'cc-actual');
    const campoNueva  = crearCampo('Clave nueva',  'cc-nueva');
    const campoRepeat = crearCampo('Repetir clave nueva', 'cc-repetir');

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;margin-top:4px';

    const btnGuardar = document.createElement('button');
    btnGuardar.textContent = 'Guardar';
    btnGuardar.style.cssText = 'flex:1;background:#D9853B;color:#fff;border:none;border-radius:8px;padding:11px;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit';

    const btnCancelar = document.createElement('button');
    btnCancelar.textContent = 'Cancelar';
    btnCancelar.style.cssText = 'flex:1;background:#F5EFE8;color:#1A1714;border:none;border-radius:8px;padding:11px;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit';
    btnCancelar.addEventListener('click', () => overlay.style.display = 'none');

    btnGuardar.addEventListener('click', async () => {
        const actual   = document.getElementById('cc-actual')?.value || '';
        const nueva    = document.getElementById('cc-nueva')?.value  || '';
        const repetir  = document.getElementById('cc-repetir')?.value || '';
        errMsg.textContent = '';

        if (!actual || !nueva || !repetir) { errMsg.textContent = 'Completa todos los campos'; return; }
        if (nueva !== repetir)             { errMsg.textContent = 'Las claves nuevas no coinciden'; return; }
        if (nueva.length < 6)              { errMsg.textContent = 'La clave nueva debe tener al menos 6 caracteres'; return; }

        btnGuardar.disabled = true;
        btnGuardar.textContent = 'Guardando…';
        try {
            const usuario = _getUsuario();
            const resp = await apiCall('/usuarios', 'POST', {
                action:       'cambiarClave',
                id:           usuario.id,
                claveActual:  actual,
                claveNueva:   nueva,
            });
            if (!resp.ok) { errMsg.textContent = resp.error || 'Error al cambiar clave'; return; }
            overlay.style.display = 'none';
            alert('Clave actualizada correctamente.');
        } catch(e) {
            errMsg.textContent = 'Error de conexión';
        } finally {
            btnGuardar.disabled = false;
            btnGuardar.textContent = 'Guardar';
        }
    });

    btnRow.appendChild(btnGuardar);
    btnRow.appendChild(btnCancelar);
    card.appendChild(titulo);
    card.appendChild(errMsg);
    card.appendChild(campoActual);
    card.appendChild(campoNueva);
    card.appendChild(campoRepeat);
    card.appendChild(btnRow);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
}

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
          Cargando ${
            modulo === 'crm'          ? 'CRM'          :
            modulo === 'diagnostico'  ? 'Diagnóstico'  :
            modulo === 'comunidades'  ? 'Comunidades'  :
            'Flujo de trabajo'
          }
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

    else if (modulo === 'comunidades') {
        sd.innerHTML = `
          <div class="sd-section-label">Cartera</div>
          <div class="sd-stat">
            <div class="sd-stat-label">Activas</div>
            <div class="sd-stat-val" id="sd-com-activas">—</div>
          </div>
          <div class="sd-stat">
            <div class="sd-stat-label">Alertas docs</div>
            <div class="sd-stat-val urgente" id="sd-com-alertas">—</div>
          </div>
          <div class="sd-stat">
            <div class="sd-stat-label">Vencimientos</div>
            <div class="sd-stat-val urgente" id="sd-com-venc">—</div>
          </div>
          <button class="sd-btn-nuevo" onclick="document.querySelector('#com-root .btn-nuevo')?.click()">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>
            Nueva comunidad
          </button>
        `;
        actualizarKpisComunidades();
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

// ── Actualizar KPIs de Comunidades en el sidebar ──────────────────────────────
function actualizarKpisComunidades() {
    setTimeout(() => {
        if (window._comunidadesKpis) {
            const el = {
                activas:  document.getElementById('sd-com-activas'),
                alertas:  document.getElementById('sd-com-alertas'),
                venc:     document.getElementById('sd-com-venc'),
            };
            if (el.activas) el.activas.textContent = window._comunidadesKpis.activas ?? '—';
            if (el.alertas) el.alertas.textContent = window._comunidadesKpis.alertas ?? '—';
            if (el.venc)    el.venc.textContent    = window._comunidadesKpis.venc    ?? '—';
        }
    }, 1200);
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
            'Authorization': `Bearer ${_getToken()}`,
            'Content-Type': 'application/json'
        }
    };
    if (body) options.body = JSON.stringify(body);
    const response = await fetch(`${WORKER_URL}${endpoint}`, options);
    return response.json();
}
