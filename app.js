// app.js — CoproActiva
// Versión: 2.6 · Mayo 2026
// Router con display:none — módulos se crean una vez y se ocultan/muestran

var WORKER_URL = 'https://coproactiva-worker-nuevo.osmarmeza-adm7.workers.dev';
var ACCESS_KEY = 'copro2025';

let currentModule = 'crm';

// Contenedores de módulos ya cargados
const moduleElements = {};
let currentModuleElement = null;

window.moduleCache = moduleElements; // compatibilidad con módulos que lo referencian

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

async function cargarModulo(modulo) {
    const contentArea = document.getElementById('contentArea');

    // Ocultar módulo actual
    if (currentModuleElement) {
        currentModuleElement.style.display = 'none';
    }

    // Si el módulo ya existe en el DOM, solo mostrarlo
    if (moduleElements[modulo]) {
        moduleElements[modulo].style.display = 'block';
        currentModuleElement = moduleElements[modulo];
        return;
    }

    // Primera carga — mostrar loading
    const loading = document.createElement('div');
    loading.style.cssText = 'text-align:center;padding:40px;color:#6b7280;';
    loading.textContent = 'Cargando...';
    contentArea.appendChild(loading);

    try {
        const response = await fetch(`modules/${modulo}.html`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();

        // Remover loading
        loading.remove();

        // Crear wrapper del módulo
        const wrapper = document.createElement('div');
        wrapper.setAttribute('data-modulo', modulo);
        wrapper.style.width = '100%';

        // Separar scripts del HTML
        const temp = document.createElement('div');
        temp.innerHTML = html;
        const scripts = Array.from(temp.querySelectorAll('script'));
        scripts.forEach(s => s.remove());

        // Inyectar HTML en el wrapper
        wrapper.innerHTML = temp.innerHTML;

        // Agregar al contentArea y registrar
        contentArea.appendChild(wrapper);
        moduleElements[modulo] = wrapper;
        currentModuleElement = wrapper;

        // Ejecutar scripts — solo ocurre una vez por módulo
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
