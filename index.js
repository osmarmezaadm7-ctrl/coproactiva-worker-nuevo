export default {
  async fetch(request) {
    return new Response('Worker funcionando desde GitHub', { 
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};
