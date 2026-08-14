/*
 * SubZeit — Dienstarbeiter
 *
 * Er hält das Programm offline lauffähig. Die Daten liegen in der Datei
 * des Anwenders, nicht hier — hier liegt nur das Programm selbst.
 *
 * WICHTIG bei jeder Änderung: die Fassung hochzählen. Sonst arbeiten
 * bereits installierte Geräte weiter mit dem alten Stand.
 */

const FASSUNG = 'subzeit-v1';

const DATEIEN = [
    './',
    './index.html',
    './stil.css',
    './fach.js',
    './bahn.js',
    './app.js',
    './manifest.webmanifest',
    '../kern/kern.js',
    '../../ui/tokens.css',
    '../../ui/bausteine.css',
    '../../ui/wochenraster.css',
    '../ui/marke.svg'
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(FASSUNG)
            // Einzeln, damit eine fehlende Datei nicht die ganze Installation kippt.
            .then(vorrat => Promise.all(DATEIEN.map(d => vorrat.add(d).catch(() => {}))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(namen => Promise.all(
                namen.filter(n => n !== FASSUNG).map(n => caches.delete(n))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;

    const adresse = new URL(e.request.url);
    if (adresse.origin !== self.location.origin) return;

    // Erst der Vorrat, dann das Netz: Ein Programm soll auch ohne Empfang
    // sofort starten. Neues kommt beim nächsten Start.
    e.respondWith(
        caches.match(e.request).then(treffer => treffer || fetch(e.request).then(antwort => {
            const kopie = antwort.clone();
            caches.open(FASSUNG).then(v => v.put(e.request, kopie));
            return antwort;
        }).catch(() => caches.match('./index.html')))
    );
});
