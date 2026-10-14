// Service worker de La Cabaña: solo recibe avisos push y los muestra.
// No guarda nada en caché a propósito (así nunca se queda una versión vieja del panel).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { cuerpo: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'La Cabaña', {
    body: d.cuerpo || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: d.id || undefined,          // evita duplicar el mismo aviso
    data: { ir: d.ir || '' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const ir = (e.notification.data || {}).ir || '';
  const url = new URL('./' + (ir ? '?ir=' + encodeURIComponent(ir) : ''), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
    for (const c of lista) {
      if ('focus' in c) { c.postMessage({ tipo: 'ir', ir }); return c.focus(); }   // app ya abierta: solo cambia de pantalla
    }
    return self.clients.openWindow(url);                                          // app cerrada: la abre en esa pantalla
  }));
});
