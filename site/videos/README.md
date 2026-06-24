# Demo-Videos für die Funktions-Kacheln

Hier kommen deine kurzen Demo-Clips rein (je ~5–15 Sek., eine Funktion zeigend).

**So aktivierst du ein Video:**
1. Clip aufnehmen, als `.mp4` in diesen Ordner legen — Dateinamen siehe `../site.js` (Feld `vid`), z. B. `anmerken.mp4`, `messen.mp4`, `unterschrift.mp4` …
2. In `../site.js` bei der passenden Funktion `has: true` ergänzen, z. B.:
   `{ ic: '✎', t: 'Anmerken', d: '…', vid: 'videos/anmerken.mp4', has: true }`

Solange `has` fehlt, zeigt die Kachel einen „Demo-Video folgt"-Platzhalter.

Tipp: gleiches Seitenverhältnis (16:10) und gleiche Länge wirkt am ruhigsten.
