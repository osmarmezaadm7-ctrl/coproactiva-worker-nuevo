// app.js — CoproActiva
// Versión: 2.5 · Mayo 2026
// Caché de HTML + scripts envueltos en IIFE para evitar conflictos de scope

var WORKER_URL = 'https://coproactiva-worker-nuevo.osmarmeza-adm7.workers.dev';
var ACCESS_KEY = 'copro2025';

let currentModule = 'crm';

const moduleCache = {};
window.moduleCache = moduleCache;

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
});

async function cargarModulo(modulo) {
    const contentArea = document.getElementById('contentArea');

    if (moduleCache[modulo]) {
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

function ejecutarModulo(contentArea, html) {
    const temp = document.createElement('div');
    temp.innerHTML = html;

    const scripts = Array.from(temp.querySelectorAll('script'));
    scripts.forEach(s => s.remove());

    contentArea.innerHTML = temp.innerHTML;

    scripts.forEach(oldScript => {
        const newScript = document.createElement('script');
        if (oldScript.src) {
            newScript.src = oldScript.src;
        } else {
            // Envolver en IIFE para aislar el scope — evita conflictos de
            // redeclaración de const/let entre navegaciones
            newScript.textContent = '(function(){\n' + oldScript.textContent + '\n})();';
        }
        document.body.appendChild(newScript);
        document.body.removeChild(newScript);
    });
}

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
