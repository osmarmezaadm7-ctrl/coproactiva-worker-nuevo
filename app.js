// app.js — CoproActiva
// Versión: 2.4 · Mayo 2026
// Caché de HTML + re-ejecución de scripts en cada navegación

var WORKER_URL = 'https://coproactiva-worker-nuevo.osmarmeza-adm7.workers.dev';
var ACCESS_KEY = 'copro2025';

let currentModule = 'crm';

// Caché de HTML — solo se hace fetch una vez por módulo
const moduleCache = {};
window.moduleCache = moduleCache;

document.addEventListener('DOMContentLoaded', () => {
    const loginScreen  = document.getElementById('loginScreen');
    const appContainer = document.getElementById('app');
    const loginBtn     = document.getElementById('loginBtn');
    const claveInput   = document.getElementById('claveInput');
    const loginError   = document.getElementById('loginError');

    // Login
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

    // Sesión activa
    if (sessionStorage.getItem('token') === ACCESS_KEY) {
        loginScreen.style.display = 'none';
        appContainer.style.display = 'flex';
        cargarModulo(currentModule);
    }

    // Navegación
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modulo = btn.getAttribute('data-modulo');
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll(`.nav-btn[data-modulo="${modulo}"]`).forEach(b => b.classList.add('active'));
            currentModule = modulo;
            cargarModulo(modulo);
        });
    });
});

// Cargar módulo — fetch solo la primera vez, scripts siempre se re-ejecutan
async function cargarModulo(modulo) {
    const contentArea = document.getElementById('contentArea');

    if (moduleCache[modulo]) {
        // HTML ya en caché — inyectar y re-ejecutar scripts sin fetch
        ejecutarModulo(contentArea, moduleCache[modulo]);
        return;
    }

    contentArea.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;">Cargando...</div>';

    try {
        const response = await fetch(`modules/${modulo}.html`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        moduleCache[modulo] = html;
        ejecutarModulo(contentArea, html);
    } catch (error) {
        contentArea.innerHTML = `<div style="color:#b83232;padding:20px;">Error al cargar ${modulo}: ${error.message}</div>`;
    }
}

// Inyectar HTML y re-ejecutar scripts — se llama siempre, con o sin caché
function ejecutarModulo(contentArea, html) {
    const temp = document.createElement('div');
    temp.innerHTML = html;

    // Separar scripts del HTML antes de inyectar
    const scripts = Array.from(temp.querySelectorAll('script'));
    scripts.forEach(s => s.remove());

    // Inyectar HTML sin scripts
    contentArea.innerHTML = temp.innerHTML;

    // Re-ejecutar scripts manualmente — esto inicializa el módulo
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
}

// Helper global para llamadas al Worker
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
