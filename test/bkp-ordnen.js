// Bringt die BKP-Nummern von Kostenübersicht und Bauprogramm zusammen.
//
// Aufruf:  node test/bkp-ordnen.js            (nur zeigen)
//          node test/bkp-ordnen.js schreiben
//
// Entschieden am 14.08.2026: Es führt die Nummer der KOSTENÜBERSICHT,
// weil dort das Geld hängt. Das Bauprogramm wird darauf umgestellt.
//
//   Bauprogramm          Kostenübersicht   Grund
//   214.6 Geneigte Dächer  →  214          der Werkvertrag ist auf 214 aufgebaut
//   225.1 Fugendichtungen  →  225
//   230   PV-Anlage        →  237
//   242   Heizung          →  240
//   271.0 + 271.1          →  271          Trockenbau ist in 271 zusammengefasst
//
// Und: 299 ist eine Reservenummer, die durchnummeriert gehört.
//   299   Reserve            →  299.1
//   (ohne) Mängelbehebung    →  299.2

const fs = require('fs');
const path = require('path');
const U = require('../submit/kern/uebersetzer.js');

const schreiben = process.argv[2] === 'schreiben';
const datei = path.join(__dirname, '..', 'privat', 'Projekte',
  'Umbau EFH Römerstrasse 31', 'Umbau EFH Römerstrasse 31.submit');

const p = U.ausMappe(JSON.parse(fs.readFileSync(datei, 'utf8')));
const finde = (bkp, name) => p.vergaben.find(v =>
  (bkp !== null && (v.bkp || '') === bkp) || (name && (v.gewerk || '').toLowerCase().includes(name)));

const aenderungen = [];
function setze(v, feld, wert, warum) {
  if (!v || v[feld] === wert) return;
  aenderungen.push(`  ${(v.bkp || '—').padEnd(8)}${(v.gewerk || '').slice(0, 30).padEnd(32)}${feld} → ${wert}   ${warum || ''}`);
  v[feld] = wert;
}

/* ---- 299 durchnummerieren ---- */
const reserve = finde('299', null);
setze(reserve, 'bkp', '299.1', 'Reservepositionen werden durchnummeriert');

const maengel = finde(null, 'mängelbehebung');
setze(maengel, 'bkp', '299.2', 'eigene Reserveposition, nicht dieselbe wie 299.1');
setze(maengel, 'gewerk', 'Mängelbehebung & Fertigstellung', 'Name aus dem Bauprogramm');

/* ---- Namen aus dem Bauprogramm übernehmen, wo er genauer ist ---- */
const namen = [
  ['112',   'Abbrüche'],
  ['211.5', 'Beton- und Stahlbeton'],
  ['214',   'Holzbau / Geneigte Dächer'],
  ['225',   'Dichtungen / Dämmungen / Fugendichtungen'],
  ['271',   'Gipserarbeiten / Trockenbau'],
  ['272',   'Allgemeine Metallbauarbeiten'],
  ['273',   'Schreinerarbeiten / Innentüren'],
  ['281.6', 'Keramische Wand- und Bodenbeläge'],
  ['421',   'Umgebungsgestaltung']
];
namen.forEach(([bkp, name]) => setze(finde(bkp, null), 'gewerk', name, 'Name aus dem Bauprogramm'));

/* ---- Bezug ---- */
const bezug = finde(null, 'bezug');
setze(bezug, 'bkp', '—', 'Meilenstein, keine BKP-Position');

/* ---- Bericht ---- */
console.log('\n=== Änderungen ===');
console.log(aenderungen.length ? aenderungen.join('\n') : '  keine');

console.log('\n=== Positionen mit BKP 299 ===');
p.vergaben.filter(v => (v.bkp || '').startsWith('299')).forEach(v =>
  console.log('  ' + (v.bkp || '—').padEnd(8) + (v.gewerk || '').padEnd(36)
    + (v.bauStart ? v.bauStart + ' – ' + v.bauEnde : 'ohne Termine')));

console.log('\n=== Noch ohne Bautermine ===');
const ohne = p.vergaben.filter(v => !v.bauStart || !v.bauEnde);
ohne.forEach(v => console.log('  ' + (v.bkp || '—').padEnd(8) + (v.gewerk || '')));
console.log('  → ' + ohne.length + ' Positionen');

if (schreiben) {
  fs.writeFileSync(datei, JSON.stringify(U.zuMappe(p), null, 1), 'utf8');
  console.log('\n  Geschrieben.\n');
} else {
  console.log('\n  Nur angezeigt. Zum Übernehmen:  node test/bkp-ordnen.js schreiben\n');
}
