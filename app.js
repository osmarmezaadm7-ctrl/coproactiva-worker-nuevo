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
    cargarComunidades();
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
Object.defineProperty(window, 'currentModuleElement', {
    get: function() { return currentModuleElement; },
    set: function(v) { currentModuleElement = v; }
});

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
    }

    // Escuchar mensajes del iframe del diagnóstico (siempre registrar)
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

    // Menú de usuario (tres puntos en el footer del sidebar)
    const btnUserMenu = document.getElementById('btnUserMenu');
    if (btnUserMenu) btnUserMenu.addEventListener('click', function(e) {
        e.stopPropagation();
        _abrirMenuUsuario(btnUserMenu);
    });

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
    // modulos puede llegar como string JSON o como array — normalizar
    var modulos = usuario.modulos || ['*'];
    if (typeof modulos === 'string') {
        try { modulos = JSON.parse(modulos); } catch(e) { modulos = ['*']; }
    }
    if (!Array.isArray(modulos)) modulos = ['*'];
    if (modulos.includes('*')) return; // acceso total

    // Sidebar desktop — módulos planos (con data-mod)
    document.querySelectorAll('.mod-row[data-mod]').forEach(function(btn) {
        const modulo = btn.getAttribute('data-mod');
        if (!modulos.includes(modulo)) {
            btn.style.display = 'none';
        }
    });

    // Sidebar desktop — módulos con submenú (id="mod-XXX")
    ['finanzas','servicios','remuneraciones','mantenciones','incidencias','comunicaciones','documentos','reportes'].forEach(function(modulo) {
        if (!modulos.includes(modulo)) {
            const el = document.getElementById('mod-' + modulo);
            if (el) el.style.display = 'none';
        }
    });

    // Ocultar separadores de sección si todos sus módulos están ocultos
    document.querySelectorAll('.sb-section').forEach(function(sec) {
        var siguiente = sec.nextElementSibling;
        var todosOcultos = true;
        while (siguiente && !siguiente.classList.contains('sb-section') && !siguiente.classList.contains('sb-sep')) {
            if (siguiente.style.display !== 'none') { todosOcultos = false; break; }
            siguiente = siguiente.nextElementSibling;
        }
        if (todosOcultos) sec.style.display = 'none';
    });

    // Bottom nav móvil — ocultar botones no permitidos
    document.querySelectorAll('.bottom-nav .nav-btn[data-nav]').forEach(function(btn) {
        const modulo = btn.getAttribute('data-nav');
        if (modulo !== 'menu' && !modulos.includes(modulo)) {
            btn.style.display = 'none';
        }
    });
}

// ── Helper: input password con botón ojo ─────────────────────────────────────
function _inputPasswordConOjo(id, placeholder) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;display:flex;align-items:center';
    var inp = document.createElement('input');
    inp.type = 'password';
    inp.id = id;
    inp.placeholder = placeholder || '••••••••';
    inp.style.cssText = 'width:100%;padding:10px 38px 10px 13px;border:1.5px solid var(--co-line);border-radius:var(--co-r-md);font-size:13px;font-family:var(--co-font);color:var(--co-ink);background:var(--co-surface);outline:none;box-sizing:border-box';
    inp.addEventListener('focus', function() { inp.style.borderColor = 'var(--co-orange)'; });
    inp.addEventListener('blur',  function() { inp.style.borderColor = 'var(--co-line)'; });
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'position:absolute;right:10px;background:none;border:none;cursor:pointer;color:var(--co-mute);padding:0;display:flex;align-items:center';
    btn.innerHTML = '<svg id="' + id + '-eye-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>';
    btn.setAttribute('aria-label', 'Mostrar/ocultar clave');
    var visible = false;
    btn.addEventListener('click', function() {
        visible = !visible;
        inp.type = visible ? 'text' : 'password';
        btn.style.color = visible ? 'var(--co-orange)' : 'var(--co-mute)';
    });
    wrap.appendChild(inp);
    wrap.appendChild(btn);
    return wrap;
}

// ── Menú contextual de usuario ───────────────────────────────────────────────
function _abrirMenuUsuario(ancla) {
    // Eliminar menú previo si existe
    var prev = document.getElementById('menuUsuarioCtx');
    if (prev) { prev.remove(); return; }

    var menu = document.createElement('div');
    menu.id = 'menuUsuarioCtx';
    menu.style.cssText = 'position:fixed;background:var(--co-surface);border:1px solid var(--co-line);border-radius:var(--co-r-md);box-shadow:0 8px 24px rgba(0,0,0,0.12);z-index:9999;min-width:190px;padding:4px 0;font-family:var(--co-font)';

    var rect = ancla.getBoundingClientRect();
    menu.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    menu.style.left   = rect.left + 'px';

    function item(icono, texto, fn, color) {
        var btn = document.createElement('button');
        btn.style.cssText = 'display:flex;align-items:center;gap:10px;width:100%;padding:10px 16px;background:none;border:none;font-family:var(--co-font);font-size:13px;font-weight:600;color:' + (color || 'var(--co-ink)') + ';cursor:pointer;text-align:left';
        btn.innerHTML = icono + '<span>' + texto + '</span>';
        btn.addEventListener('mouseenter', function() { btn.style.background = 'var(--co-cream)'; });
        btn.addEventListener('mouseleave', function() { btn.style.background = 'none'; });
        btn.addEventListener('click', function() { menu.remove(); fn(); });
        menu.appendChild(btn);
    }

    var icoUser = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="8" cy="6" r="3"/><path d="M3 14c0-3 2-5 5-5s5 2 5 5"/></svg>';
    var icoOut  = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 10H3m3-3L3 10l3 3"/><path d="M7 6V4a1 1 0 011-1h4a1 1 0 011 1v8a1 1 0 01-1 1H8a1 1 0 01-1-1v-2"/></svg>';

    item(icoUser, 'Mi perfil', _abrirModalPerfil);

    var sep = document.createElement('div');
    sep.style.cssText = 'height:1px;background:var(--co-line);margin:4px 0';
    menu.appendChild(sep);

    item(icoOut, 'Cerrar sesión', _cerrarSesion, 'var(--co-red)');

    document.body.appendChild(menu);

    var cerrar = function(ev) {
        if (!menu.contains(ev.target) && ev.target !== ancla) {
            menu.remove();
            document.removeEventListener('click', cerrar);
        }
    };
    setTimeout(function() { document.addEventListener('click', cerrar); }, 50);
}

// ── Modal de perfil (todos los usuarios) ─────────────────────────────────────
function _abrirModalCambiarClave() {
    _abrirModalPerfil();
}

function _abrirModalPerfil() {
    if (document.getElementById('modalPerfil')) {
        document.getElementById('modalPerfil').style.display = 'flex';
        _perfilCambiarTab('datos');
        return;
    }

    var usuario = _getUsuario();
    if (!usuario) return;

    var overlay = document.createElement('div');
    overlay.id = 'modalPerfil';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(26,23,20,0.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:24px;z-index:9999';

    var box = document.createElement('div');
    box.style.cssText = 'background:var(--co-surface);border-radius:var(--co-r-lg);width:100%;max-width:480px;max-height:90vh;overflow-y:auto;position:relative;box-shadow:var(--co-shadow-lg)';

    // ── Header con avatar ──
    var hdr = document.createElement('div');
    hdr.style.cssText = 'padding:20px 24px 16px;border-bottom:1px solid var(--co-line);display:flex;align-items:center;gap:14px';
    var av = document.createElement('div');
    av.style.cssText = 'width:46px;height:46px;border-radius:50%;background:var(--co-orange);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:#fff;flex-shrink:0;letter-spacing:-0.01em';
    av.textContent = usuario.nombre.charAt(0).toUpperCase();
    var info = document.createElement('div');
    info.style.flex = '1';
    var nm = document.createElement('div');
    nm.style.cssText = 'font-size:15px;font-weight:700;color:var(--co-ink);letter-spacing:-0.01em';
    nm.textContent = usuario.nombre;
    var em = document.createElement('div');
    em.style.cssText = 'font-size:12px;color:var(--co-mute);margin-top:2px';
    em.textContent = usuario.email;
    var rolSpan = document.createElement('span');
    var rolColors = { superadmin:'background:#FEF3C7;color:#92400E', admin:'background:var(--co-blue-soft);color:var(--co-blue)', operador:'background:#EDE9FE;color:#5B21B6', visualizador:'background:var(--co-cream-deep);color:var(--co-mute)' };
    rolSpan.style.cssText = 'display:inline-block;margin-top:4px;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;' + (rolColors[usuario.rol] || rolColors.visualizador);
    rolSpan.textContent = { superadmin:'Superadmin', admin:'Admin', operador:'Operador', visualizador:'Visualizador' }[usuario.rol] || usuario.rol;
    info.appendChild(nm); info.appendChild(em); info.appendChild(rolSpan);
    var btnX = document.createElement('button');
    btnX.style.cssText = 'background:var(--co-cream);border:1px solid var(--co-line);border-radius:50%;font-size:18px;cursor:pointer;color:var(--co-ink-2);width:34px;height:34px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:var(--co-font)';
    btnX.textContent = '×';
    btnX.addEventListener('click', function() { overlay.style.display = 'none'; });
    hdr.appendChild(av); hdr.appendChild(info); hdr.appendChild(btnX);

    // ── Tabs ──
    var tabsDiv = document.createElement('div');
    tabsDiv.id = 'perfil-tabs';
    tabsDiv.style.cssText = 'display:flex;border-bottom:1px solid var(--co-line);padding:0 24px';
    function crearTab(id, label) {
        var btn = document.createElement('button');
        btn.setAttribute('data-perfil-tab', id);
        btn.style.cssText = 'font-size:12px;font-weight:600;padding:10px 14px;color:var(--co-mute);cursor:pointer;border:none;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;background:none;font-family:var(--co-font);transition:color 0.13s';
        btn.textContent = label;
        btn.addEventListener('click', function() { _perfilCambiarTab(id); });
        return btn;
    }
    tabsDiv.appendChild(crearTab('datos', 'Datos personales'));
    tabsDiv.appendChild(crearTab('seguridad', 'Seguridad'));

    // ── Panel datos personales ──
    var panelDatos = document.createElement('div');
    panelDatos.id = 'perfil-panel-datos';
    panelDatos.style.cssText = 'padding:20px 24px';

    function crearCampoForm(labelText, inputId, type, valor, hint) {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;gap:5px;margin-bottom:14px';
        var lbl = document.createElement('label');
        lbl.htmlFor = inputId;
        lbl.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--co-mute)';
        lbl.textContent = labelText;
        var inp = document.createElement('input');
        inp.type = type;
        inp.id = inputId;
        inp.value = valor || '';
        inp.style.cssText = 'padding:10px 13px;border:1.5px solid var(--co-line);border-radius:var(--co-r-md);font-size:13px;font-family:var(--co-font);color:var(--co-ink);background:var(--co-surface);outline:none';
        inp.addEventListener('focus', function() { inp.style.borderColor = 'var(--co-orange)'; });
        inp.addEventListener('blur',  function() { inp.style.borderColor = 'var(--co-line)'; });
        wrap.appendChild(lbl);
        wrap.appendChild(inp);
        if (hint) {
            var h = document.createElement('div');
            h.style.cssText = 'font-size:11px;color:var(--co-mute)';
            h.textContent = hint;
            wrap.appendChild(h);
        }
        return wrap;
    }

    panelDatos.appendChild(crearCampoForm('Nombre completo', 'perfil-nombre', 'text', usuario.nombre));
    panelDatos.appendChild(crearCampoForm('Correo electrónico', 'perfil-email', 'email', usuario.email,
        'Al cambiar el email deberás ingresar tu clave actual.'));

    var errDatos = document.createElement('div');
    errDatos.id = 'perfil-err-datos';
    errDatos.style.cssText = 'color:var(--co-red);font-size:12px;font-weight:600;min-height:16px;margin-bottom:8px';

    var btnDatos = document.createElement('button');
    btnDatos.style.cssText = 'background:var(--co-orange);color:#fff;border:none;border-radius:var(--co-r-md);padding:12px;font-weight:700;font-size:14px;cursor:pointer;width:100%;font-family:var(--co-font)';
    btnDatos.textContent = 'Guardar cambios';
    btnDatos.addEventListener('click', function() {
        var nombre = document.getElementById('perfil-nombre').value.trim();
        var email  = document.getElementById('perfil-email').value.trim();
        errDatos.textContent = '';
        if (!nombre) { errDatos.textContent = 'El nombre es obligatorio'; return; }
        if (!email)  { errDatos.textContent = 'El email es obligatorio'; return; }
        var cambioEmail = email.toLowerCase() !== usuario.email.toLowerCase();
        if (cambioEmail) {
            var claveConf = prompt('Para cambiar el email ingresa tu clave actual:');
            if (!claveConf) return;
        }
        btnDatos.disabled = true; btnDatos.textContent = 'Guardando…';
        var payload = { action: 'editarUsuario', id: usuario.id, nombre: nombre, email: email };
        if (cambioEmail) payload.clave = prompt('Repite tu clave para confirmar:') || '';
        apiCall('/usuarios', 'POST', payload)
            .then(function(resp) {
                var ok = resp.ok || (resp.data && resp.data.ok);
                if (!ok) { errDatos.textContent = resp.error || (resp.data && resp.data.error) || 'Error al guardar'; return; }
                // Actualizar sessionStorage
                usuario.nombre = nombre;
                usuario.email  = email;
                sessionStorage.setItem('usuario', JSON.stringify(usuario));
                var avatarEl = document.getElementById('sidebarUserInitial');
                var nombreEl = document.getElementById('sidebarUserName');
                if (avatarEl) avatarEl.textContent = nombre.charAt(0).toUpperCase();
                if (nombreEl) nombreEl.textContent = nombre;
                av.textContent = nombre.charAt(0).toUpperCase();
                nm.textContent = nombre;
                em.textContent = email;
                btnDatos.textContent = '✓ Guardado';
                btnDatos.style.background = 'var(--co-green)';
                setTimeout(function() { btnDatos.disabled = false; btnDatos.textContent = 'Guardar cambios'; btnDatos.style.background = ''; }, 1500);
            })
            .catch(function(e) { errDatos.textContent = 'Error de conexión: ' + e.message; })
            .finally(function() { if (btnDatos.textContent !== '✓ Guardado') { btnDatos.disabled = false; btnDatos.textContent = 'Guardar cambios'; } });
    });

    panelDatos.appendChild(errDatos);
    panelDatos.appendChild(btnDatos);

    // ── Panel seguridad ──
    var panelSeg = document.createElement('div');
    panelSeg.id = 'perfil-panel-seguridad';
    panelSeg.style.cssText = 'padding:20px 24px;display:none';

    function campoConOjo(labelText, id, hint) {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;gap:5px;margin-bottom:14px';
        var lbl = document.createElement('label');
        lbl.htmlFor = id;
        lbl.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--co-mute)';
        lbl.textContent = labelText;
        wrap.appendChild(lbl);
        wrap.appendChild(_inputPasswordConOjo(id, '••••••••'));
        if (hint) {
            var h = document.createElement('div');
            h.style.cssText = 'font-size:11px;color:var(--co-mute)';
            h.textContent = hint;
            wrap.appendChild(h);
        }
        return wrap;
    }
    panelSeg.appendChild(campoConOjo('Clave actual', 'perfil-clave-actual'));
    panelSeg.appendChild(campoConOjo('Nueva clave', 'perfil-clave-nueva', 'Mínimo 6 caracteres.'));
    panelSeg.appendChild(campoConOjo('Repetir nueva clave', 'perfil-clave-repetir'));

    var errSeg = document.createElement('div');
    errSeg.id = 'perfil-err-seg';
    errSeg.style.cssText = 'color:var(--co-red);font-size:12px;font-weight:600;min-height:16px;margin-bottom:8px';

    var btnSeg = document.createElement('button');
    btnSeg.style.cssText = 'background:var(--co-orange);color:#fff;border:none;border-radius:var(--co-r-md);padding:12px;font-weight:700;font-size:14px;cursor:pointer;width:100%;font-family:var(--co-font)';
    btnSeg.textContent = 'Cambiar clave';
    btnSeg.addEventListener('click', function() {
        var actual   = document.getElementById('perfil-clave-actual').value;
        var nueva    = document.getElementById('perfil-clave-nueva').value;
        var repetir  = document.getElementById('perfil-clave-repetir').value;
        errSeg.textContent = '';
        if (!actual)              { errSeg.textContent = 'Ingresa tu clave actual'; return; }
        if (!nueva)               { errSeg.textContent = 'Ingresa la nueva clave'; return; }
        if (nueva.length < 6)     { errSeg.textContent = 'La nueva clave debe tener al menos 6 caracteres'; return; }
        if (nueva !== repetir)    { errSeg.textContent = 'Las claves nuevas no coinciden'; return; }
        btnSeg.disabled = true; btnSeg.textContent = 'Guardando…';
        apiCall('/usuarios', 'POST', { action: 'cambiarClave', id: usuario.id, claveActual: actual, claveNueva: nueva })
            .then(function(resp) {
                var ok = resp.ok || (resp.data && resp.data.ok);
                if (!ok) { errSeg.textContent = resp.error || (resp.data && resp.data.error) || 'Error al cambiar clave'; return; }
                document.getElementById('perfil-clave-actual').value  = '';
                document.getElementById('perfil-clave-nueva').value   = '';
                document.getElementById('perfil-clave-repetir').value = '';
                btnSeg.textContent = '✓ Clave actualizada';
                btnSeg.style.background = 'var(--co-green)';
                setTimeout(function() { btnSeg.disabled = false; btnSeg.textContent = 'Cambiar clave'; btnSeg.style.background = ''; }, 1800);
            })
            .catch(function(e) { errSeg.textContent = 'Error de conexión: ' + e.message; })
            .finally(function() { if (btnSeg.textContent !== '✓ Clave actualizada') { btnSeg.disabled = false; btnSeg.textContent = 'Cambiar clave'; } });
    });

    panelSeg.appendChild(errSeg);
    panelSeg.appendChild(btnSeg);

    box.appendChild(hdr);
    box.appendChild(tabsDiv);
    box.appendChild(panelDatos);
    box.appendChild(panelSeg);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    _perfilCambiarTab('datos');
}

function _perfilCambiarTab(tab) {
    var tabs = document.querySelectorAll('[data-perfil-tab]');
    tabs.forEach(function(btn) {
        var activo = btn.getAttribute('data-perfil-tab') === tab;
        btn.style.color = activo ? 'var(--co-orange)' : 'var(--co-mute)';
        btn.style.borderBottomColor = activo ? 'var(--co-orange)' : 'transparent';
    });
    var panelDatos = document.getElementById('perfil-panel-datos');
    var panelSeg   = document.getElementById('perfil-panel-seguridad');
    if (panelDatos) panelDatos.style.display = tab === 'datos'     ? 'block' : 'none';
    if (panelSeg)   panelSeg.style.display   = tab === 'seguridad' ? 'block' : 'none';
}


// ── Router principal ──────────────────────────────────────────────────────────
async function cargarModulo(modulo) {
    // Guard: verificar que el usuario tiene acceso al módulo
    const usuario = _getUsuario();
    if (usuario) {
        var modsPermitidos = usuario.modulos || ['*'];
        if (typeof modsPermitidos === 'string') {
            try { modsPermitidos = JSON.parse(modsPermitidos); } catch(e) { modsPermitidos = ['*']; }
        }
        if (!Array.isArray(modsPermitidos)) modsPermitidos = ['*'];
        if (!modsPermitidos.includes('*') && !modsPermitidos.includes(modulo)) {
            console.warn('Acceso denegado al módulo:', modulo);
            return;
        }
    }

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

// ── Selector de comunidad global ──────────────────────────────────────────────
// Lista de comunidades disponibles para el usuario activo
window._comunidades = [];

// Carga comunidades desde el Worker al iniciar sesion
// Filtra segun usuario.comunidades si no es ['*']
async function cargarComunidades() {
    try {
        const resp = await apiCall('/comunidades');
        const lista = (resp.data && resp.data.data) ? resp.data.data : (resp.data || []);
        const usuario = _getUsuario();
        const permitidas = usuario && usuario.comunidades ? usuario.comunidades : ['*'];
        if (Array.isArray(permitidas) && !permitidas.includes('*')) {
            window._comunidades = lista.filter(function(c) { return permitidas.includes(c.id); });
        } else {
            window._comunidades = lista;
        }
        // Si la comunidad activa en localStorage ya no esta disponible, resetear
        var activa = getComunidadActiva();
        if (activa && !window._comunidades.find(function(c) { return c.id === activa.id; })) {
            localStorage.removeItem('coproActiva_comunidad');
        }
    } catch(e) {
        console.warn('cargarComunidades error:', e);
        window._comunidades = [];
    }
}

// Obtiene la comunidad activa desde localStorage
// Retorna objeto {id, nombre} o null
function getComunidadActiva() {
    try {
        return JSON.parse(localStorage.getItem('coproActiva_comunidad') || 'null');
    } catch(e) {
        return null;
    }
}

// Guarda la comunidad activa en localStorage
function setComunidadActiva(comunidad) {
    if (!comunidad) {
        localStorage.removeItem('coproActiva_comunidad');
        return;
    }
    localStorage.setItem('coproActiva_comunidad', JSON.stringify({ id: comunidad.id, nombre: comunidad.nombre }));
}

// Renderiza el selector de comunidad en el elemento indicado
// containerId: id del elemento donde se inyecta el selector
// onCambio: callback(comunidad) que se llama al cambiar la seleccion
function renderSelectorComunidad(containerId, onCambio) {
    var container = document.getElementById(containerId);
    if (!container) return;

    function _render() {
        var lista = window._comunidades || [];
        var activa = getComunidadActiva();

        // Si no hay comunidad activa, usar la primera disponible
        if (!activa && lista.length > 0) {
            activa = { id: lista[0].id, nombre: lista[0].nombre };
            setComunidadActiva(activa);
        }

        var nombreActiva = activa ? activa.nombre : 'Sin comunidad';
        var nombreCorto = nombreActiva.length > 22 ? nombreActiva.substring(0, 22) + '\u2026' : nombreActiva;

        var itemsHtml = lista.map(function(c) {
            var esActiva = activa && c.id === activa.id;
            return '<div class="com-sel-item' + (esActiva ? ' activa' : '') + '" data-id="' + c.id + '" data-nombre="' + c.nombre.replace(/"/g, '&quot;') + '">' +
                '<span class="com-sel-check">' + (esActiva ? '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l3.5 3.5L13 4.5"/></svg>' : '') + '</span>' +
                '<span>' + c.nombre + '</span>' +
            '</div>';
        }).join('');

        container.innerHTML =
            '<div class="com-sel-btn" id="comSelBtn_' + containerId + '">' +
                '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="#D9853B" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2C7.24 2 5 4.24 5 7c0 4.25 5 11 5 11s5-6.75 5-11c0-2.76-2.24-5-5-5z"/><circle cx="10" cy="7" r="2"/></svg>' +
                '<span class="com-sel-nombre">' + nombreCorto + '</span>' +
                '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="#B0A89E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>' +
            '</div>' +
            '<div class="com-sel-dropdown" id="comSelDd_' + containerId + '" style="display:none">' +
                '<div class="com-sel-dd-label">Mis comunidades</div>' +
                itemsHtml +
            '</div>';

        // Toggle dropdown
        var btn = document.getElementById('comSelBtn_' + containerId);
        var dd  = document.getElementById('comSelDd_' + containerId);
        if (btn) btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var abierto = dd.style.display !== 'none';
            // Cerrar todos los dropdowns abiertos
            document.querySelectorAll('.com-sel-dropdown').forEach(function(el) { el.style.display = 'none'; });
            dd.style.display = abierto ? 'none' : 'block';
        });

        // Seleccion de item
        container.querySelectorAll('.com-sel-item').forEach(function(item) {
            item.addEventListener('click', function(e) {
                e.stopPropagation();
                var nueva = { id: item.dataset.id, nombre: item.dataset.nombre };
                setComunidadActiva(nueva);
                dd.style.display = 'none';
                _render();
                if (typeof onCambio === 'function') onCambio(nueva);
            });
        });
    }

    // Si las comunidades ya estan cargadas, renderizar inmediatamente
    // Si no, esperar hasta que se carguen (reintento simple)
    if (window._comunidades && window._comunidades.length > 0) {
        _render();
    } else {
        var intentos = 0;
        var espera = setInterval(function() {
            intentos++;
            if ((window._comunidades && window._comunidades.length > 0) || intentos > 20) {
                clearInterval(espera);
                _render();
            }
        }, 200);
    }
}

// Cerrar dropdowns al hacer clic fuera
document.addEventListener('click', function() {
    document.querySelectorAll('.com-sel-dropdown').forEach(function(el) { el.style.display = 'none'; });
});

// ── Estilos del selector de comunidad ────────────────────────────────────────
(function() {
    var style = document.createElement('style');
    style.textContent = [
        '.com-sel-wrap{position:relative;display:inline-flex;align-items:center}',
        '.com-sel-btn{display:flex;align-items:center;gap:7px;padding:7px 12px;background:#fff;border:1px solid #E0D9D0;border-radius:10px;cursor:pointer;transition:border-color 0.15s;font-family:var(--co-font);user-select:none}',
        '.com-sel-btn:hover{border-color:#D9853B}',
        '.com-sel-nombre{font-size:13px;font-weight:700;color:#1A1714;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis}',
        '.com-sel-dropdown{position:absolute;top:calc(100% + 6px);right:0;background:#fff;border:1px solid #E0D9D0;border-radius:12px;padding:6px;min-width:220px;box-shadow:0 4px 16px rgba(26,23,20,0.12);z-index:999}',
        '.com-sel-dd-label{font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#B0A89E;padding:6px 10px 4px}',
        '.com-sel-item{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:8px;font-size:13px;font-weight:600;color:#1A1714;cursor:pointer;font-family:var(--co-font)}',
        '.com-sel-item:hover{background:#FBF7F0}',
        '.com-sel-item.activa{background:#FEF0E3;color:#D9853B}',
        '.com-sel-check{width:16px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#D9853B}'
    ].join('');
    document.head.appendChild(style);
})();
