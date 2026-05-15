// app.js — CoproActiva
// Versión: 2.2 · Mayo 2026

const WORKER_URL = 'https://coproactiva-worker-nuevo.osmarmeza-adm7.workers.dev';
const ACCESS_KEY = 'copro2025';

let currentModule = 'crm';

// Caché de HTML por módulo — expuesto en window para que módulos puedan invalidarlo
const moduleCache = {};
window.moduleCache = moduleCache;

document.addEventListener('DOMContentLoaded', () => {
    const loginScreen  = document.getElementById('loginScreen');
    const appContainer = document.getElementById('app');
    const loginBtn     = document.getElementById('loginBtn');
    const claveInput   = document.getElementById('claveInput');
    const loginError   = document.getElementById('loginError');
    const navBtns      = document.querySelectorAll('.nav-btn');

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

    // Enter en clave
    claveInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') loginBtn.click();
    });

    // Sesión activa
    if (sessionStorage.getItem('token') === ACCESS_KEY) {
        loginScreen.style.display = 'none';
        appContainer.style.display = 'flex';
        cargarModulo(currentModule);
    }

    // Navegación — sidebar desktop y barra inferior móvil
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const modulo = btn.getAttribute('data-modulo');
            // Activar todos los botones del mismo módulo
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll(`.nav-btn[data-modulo="${modulo}"]`).forEach(b => b.classList.add('active'));
            currentModule = modulo;
            cargarModulo(modulo);
        });
    });
});

// Cargar módulo con caché
async function cargarModulo(modulo) {
    const contentArea = document.getElementById('contentArea');

    // Si ya está en caché, usarlo y salir — sin re-fetch, sin re-ejecutar scripts
    if (moduleCache[modulo]) {
        contentArea.innerHTML = moduleCache[modulo];
        return;
    }

    contentArea.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;">Cargando...</div>';

    try {
        const response = await fetch(`modules/${modulo}.html`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();

        // Guardar en caché antes de inyectar
        moduleCache[modulo] = html;

        // Inyectar HTML — los scripts se ejecutan la primera vez
        ejecutarModulo(contentArea, html);

    } catch (error) {
        contentArea.innerHTML = `<div style="color:#b83232;padding:20px;">Error al cargar ${modulo}: ${error.message}</div>`;
    }
}

// Inyectar HTML y ejecutar scripts (solo en primera carga)
function ejecutarModulo(contentArea, html) {
    const temp = document.createElement('div');
    temp.innerHTML = html;

    const scripts = temp.querySelectorAll('script');
    scripts.forEach(s => s.remove());

    contentArea.innerHTML = temp.innerHTML;

    // Ejecutar scripts manualmente (innerHTML no los ejecuta)
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

// Helper global para llamadas al Worker — disponible para todos los módulos
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
