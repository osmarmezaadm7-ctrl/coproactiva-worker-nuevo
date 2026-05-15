// Constantes
const WORKER_URL = 'https://coproactiva-worker-nuevo.osmarmeza-adm7.workers.dev';
const ACCESS_KEY = 'copro2025';

// Estado global
let currentModule = 'crm';

// Esperar a que el DOM cargue
document.addEventListener('DOMContentLoaded', () => {
    // Elementos del DOM
    const loginScreen = document.getElementById('loginScreen');
    const appContainer = document.getElementById('app');
    const contentArea = document.getElementById('contentArea');
    const loginBtn = document.getElementById('loginBtn');
    const claveInput = document.getElementById('claveInput');
    const loginError = document.getElementById('loginError');
    const navBtns = document.querySelectorAll('.nav-btn');

    // Evento de login
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

    // Verificar si ya estaba logueado
    if (sessionStorage.getItem('token') === ACCESS_KEY) {
        loginScreen.style.display = 'none';
        appContainer.style.display = 'flex';
        cargarModulo(currentModule);
    }

    // Navegación
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentModule = btn.getAttribute('data-modulo');
            cargarModulo(currentModule);
        });
    });
});

// Función para cargar módulos
async function cargarModulo(modulo) {
    const contentArea = document.getElementById('contentArea');
    contentArea.innerHTML = '<div style="text-align:center; padding:40px;">Cargando...</div>';
    
    try {
        const response = await fetch(`modules/${modulo}.html`);
        const html = await response.text();
        contentArea.innerHTML = html;
    } catch (error) {
        contentArea.innerHTML = `<div style="color:#b83232;">Error al cargar ${modulo}: ${error.message}</div>`;
    }
}

// Función para hacer peticiones al Worker
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