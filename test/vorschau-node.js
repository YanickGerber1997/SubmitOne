// Vorschau-Server für das fertige Serverpaket.
//
// Aufruf (ohne Node-Installation, über die Electron-Laufzeit von VS Code):
//   $env:ELECTRON_RUN_AS_NODE=1
//   & "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" test\vorschau-node.js
//
// Danach im Browser:  http://localhost:8080
//
// Warum ein Server und nicht die Datei direkt
// -------------------------------------------
// Über file:// laufen weder Dienstarbeiter noch der Ordner-Modus:
// showDirectoryPicker verlangt einen sicheren Ursprung, und localhost gilt
// als sicher. Ausserdem kommt .webmanifest sonst ohne Typangabe heraus und
// der Browser bietet die Installation nicht an — dasselbe, was die
// .htaccess auf dem Server geraderückt.

const http = require('http');
const fs = require('fs');
const path = require('path');

const wurzel = path.join(__dirname, '..', process.argv[3] || 'hochladen');
const port = Number(process.argv[2]) || 8080;

const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.submit': 'application/json; charset=utf-8',
  '.subone': 'application/json; charset=utf-8'
};

http.createServer((anfrage, antwort) => {
  let pfad = decodeURIComponent((anfrage.url || '/').split('?')[0]);
  if (pfad.endsWith('/')) pfad += 'index.html';

  const datei = path.join(wurzel, pfad);

  // Nicht aus dem Paket herausklettern lassen.
  if (!datei.startsWith(wurzel)) {
    antwort.writeHead(403).end('Verboten');
    return;
  }

  fs.readFile(datei, (fehler, inhalt) => {
    if (fehler) {
      // PHP kann dieser Server nicht - das faellt sonst als leere Seite auf.
      if (datei.endsWith('.php')) {
        antwort.writeHead(501, { 'Content-Type': 'text/html; charset=utf-8' })
          .end('<h1>PHP läuft hier nicht</h1><p>Diese Vorschau liefert nur Dateien aus. '
             + 'konto.php und dashboard.php brauchen den echten Server.</p>');
        return;
      }
      antwort.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end('Nicht gefunden: ' + pfad);
      console.log('  404  ' + pfad);
      return;
    }

    const typ = TYPEN[path.extname(datei).toLowerCase()] || 'application/octet-stream';
    antwort.writeHead(200, {
      'Content-Type': typ,
      // Beim Testen soll nie eine alte Fassung erscheinen.
      'Cache-Control': 'no-store'
    }).end(inhalt);
  });
}).listen(port, () => {
  console.log('');
  console.log('  Vorschau laeuft:  http://localhost:' + port);
  console.log('  Ordner:           ' + wurzel);
  console.log('');
  console.log('  /                  Verkaufsseite');
  console.log('  /one/              SubmitOne');
  console.log('  /paper/            SubPaper');
  console.log('  /pdf/              Submit PDF');
  console.log('  /mappe/zeit/       SubZeit');
  console.log('  /mappe/            Projektmappe');
  console.log('');
  console.log('  Beenden: dieses Fenster schliessen oder Strg+C');
});
