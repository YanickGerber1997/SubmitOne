/* Submit PDF – Service Worker.
   WICHTIG: Während der aktiven Entwicklung KEIN App-Caching mehr (verhinderte, dass Updates ankamen).
   Der SW löscht alte Caches und lädt alles frisch aus dem Netzwerk. Teilen-Ziel (Handy) bleibt. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.map(k => caches.delete(k)));   // alle alten Caches weg
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Teilen-Ziel: geteilte Datei zwischenspeichern und zur App weiterleiten
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const file = form.get('file');
        if (file) { const c = await caches.open('submitpdf-share'); await c.put('shared-file', new Response(file, { headers: { 'Content-Type': file.type || 'application/pdf', 'X-Filename': encodeURIComponent(file.name || 'geteilt') } })); }
      } catch (_) {}
      return Response.redirect('./index.html?shared=1', 303);
    })());
    return;
  }
  // Sonst: NICHT abfangen → Browser lädt normal aus dem Netzwerk (immer aktuell).
});
