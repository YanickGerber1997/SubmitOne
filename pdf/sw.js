/* Submit PDF – Service Worker: App-Shell cachen + Teilen-Ziel (Handy) entgegennehmen. */
const CACHE = 'submitpdf-v2';
const SHELL = ['./', './index.html', './pdf.css', './pdf.js', './tauri-bridge.js', './icon.png', './logo.png', './wordmark.png', './bg.png', './manifest.webmanifest'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Teilen-Ziel: geteilte Datei zwischenspeichern und zur App weiterleiten
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const file = form.get('file');
        if (file) { const c = await caches.open(CACHE); await c.put('shared-file', new Response(file, { headers: { 'Content-Type': file.type || 'application/pdf', 'X-Filename': encodeURIComponent(file.name || 'geteilt') } })); }
      } catch (_) {}
      return Response.redirect('./index.html?shared=1', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;            // Fremd-Ressourcen (CDN) normal laden
  // Netzwerk-zuerst: immer die aktuelle Version; bei Offline aus dem Cache
  e.respondWith(
    fetch(e.request).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
