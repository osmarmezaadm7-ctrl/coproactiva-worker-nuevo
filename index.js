// Clave de acceso (después la moveremos a variables de entorno)
const ACCESS_KEY = 'copro2025';

export default {
  async fetch(request) {
    // Obtener el header de autorización
    const authHeader = request.headers.get('Authorization');
    const token = authHeader ? authHeader.replace('Bearer ', '') : '';
    
    // Validar la clave
    if (token !== ACCESS_KEY) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Si la clave es correcta, responder
    return new Response(JSON.stringify({ 
      ok: true, 
      message: 'Acceso autorizado',
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
