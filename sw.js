// Service worker de La Cabaña: avisos push, fotos compartidas desde otras apps y uso SIN INTERNET.
// El panel siempre se pide primero a internet (así nunca se queda una versión vieja);
// solo si no hay señal se usa la copia guardada. Las últimas fotos vistas también quedan guardadas.
const VERSION = 'cabana-v2';
const BASICOS = ['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-180.png'];
const EXTERNOS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];
const MAX_FOTOS = 250;

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all([
      ...BASICOS.map(u => c.add(new Request(new URL(u, self.registration.scope).href, { cache: 'reload' })).catch(() => {})),
      ...EXTERNOS.map(u => fetch(u, { mode: 'cors' }).then(r => r.ok && c.put(u, r)).catch(() => {}))
    ]);
  })());
});
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('cabana-') && k !== VERSION && k !== VERSION + '-fotos') await caches.delete(k);
  await self.clients.claim();
})()));

// Cada página se guarda con su propio nombre (sin lo que va después del "?"), así demo.html nunca reemplaza al panel.
function claveDePagina(url) {
  const u = new URL(url);
  u.search = ''; u.hash = '';
  if (u.pathname.endsWith('/')) u.pathname += 'index.html';
  return u.href;
}
async function primeroInternet(req) {
  const c = await caches.open(VERSION), clave = claveDePagina(req.url);
  try {
    const r = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error('lento')), 8000))]);
    if (r && r.ok && !r.redirected) c.put(clave, r.clone());
    return r;
  } catch (_) {
    return (await c.match(clave)) || Response.error();
  }
}
async function guardadoYActualizar(req) {
  const c = await caches.open(VERSION);
  const guardado = await c.match(req);
  const nuevo = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }).catch(() => guardado);
  return guardado || nuevo;
}
// Fotos: se piden a internet como siempre (si cambian, se ve la nueva); la copia solo se usa sin señal.
async function fotoGuardada(req) {
  const c = await caches.open(VERSION + '-fotos');
  try {
    const r = await fetch(req);
    if (r && (r.ok || r.type === 'opaque')) {
      await c.put(req, r.clone());
      const claves = await c.keys();
      if (claves.length > MAX_FOTOS) for (const k of claves.slice(0, claves.length - MAX_FOTOS)) await c.delete(k);
    }
    return r;
  } catch (_) {
    return (await c.match(req)) || Response.error();
  }
}

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

// ---- Fotos compartidas desde otra app (Galería → Compartir → La Cabaña) ----
// Android envía las fotos por POST a /share-target; aquí se guardan en IndexedDB
// y se redirige a la app, que las recoge y abre "Nuevo producto" con ellas.
function abrirBaseCompartido() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('cabana-compartido', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('fotos', { autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function guardarFotosCompartidas(archivos) {
  const db = await abrirBaseCompartido();
  await new Promise((res, rej) => {
    const tx = db.transaction('fotos', 'readwrite'), st = tx.objectStore('fotos');
    archivos.forEach(f => st.add({ nombre: f.name, tipo: f.type, blob: f }));
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  db.close();
}
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method === 'GET') {
    const mismo = u.origin === self.location.origin;
    if (e.request.mode === 'navigate' && mismo) { e.respondWith(primeroInternet(e.request)); return; }
    if (mismo && /\.(png|svg|json|webmanifest)$/i.test(u.pathname)) { e.respondWith(guardadoYActualizar(e.request)); return; }
    if (/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(u.hostname)) { e.respondWith(guardadoYActualizar(e.request)); return; }
    if (/\/storage\/v1\/object\/public\/.+\.(webp|jpe?g|png)$/i.test(u.pathname)) { e.respondWith(fotoGuardada(e.request)); return; }
    return;   // lo demás (datos de Supabase) va directo a internet; el panel guarda su propia copia
  }
  if (e.request.method === 'POST' && u.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const fd = await e.request.formData();
        const fotos = fd.getAll('fotos').filter(f => f && f.size && /^image\//.test(f.type || 'image/'));
        if (fotos.length) await guardarFotosCompartidas(fotos);
      } catch (_) { /* si falla, igual se abre la app */ }
      return Response.redirect(new URL('./?compartido=1', self.registration.scope).href, 303);
    })());
  }
});
