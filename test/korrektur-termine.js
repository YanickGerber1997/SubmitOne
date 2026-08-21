// Termine und Zeitlagen nachführen — Yanicks Korrektur vom 14.08.2026.
//
// Aufruf:  node test/korrektur-termine.js            (nur zeigen)
//          node test/korrektur-termine.js schreiben
//
//   121    Sicherung vorhandener Anlagen   08.06. – 09.06.2026
//   191    Architekt (Vorbereitung)        Februar 2026, zwei Wochen
//   292    Ingenieur                       Juni 2026, zwei Wochen (ist fertig)
//   296    Schadstoff-Untersuchung         April 2026, eine Woche
//   291    Honorar Architekt               kein fester Termin, über die ganze Bauzeit
//   299.1  Reserve                         kein fester Termin, am Ende
//   511.0  Bewilligungen, Gebühren         kein fester Termin, am Ende

const fs = require('fs');
const path = require('path');
const U = require('../submit/kern/uebersetzer.js');

const schreiben = process.argv[2] === 'schreiben';
const datei = path.join(__dirname, '..', 'privat', 'Projekte',
  'Umbau EFH Römerstrasse 31', 'Umbau EFH Römerstrasse 31.submit');

const T = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const tag = iso => iso ? T[new Date(iso + 'T12:00:00').getDay()] : '';
const zeig = iso => iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) + ' ' + tag(iso) : '–';

/* Termine: [bkp, von, bis] */
const TERMINE = [
  ['121',   '2026-06-08', '2026-06-09'],
  ['191',   '2026-02-02', '2026-02-13'],
  ['292',   '2026-06-08', '2026-06-19'],
  ['296',   '2026-04-13', '2026-04-17']
];

/* Zeitlagen: [bkp, lage] */
const LAGEN = [
  ['291',   'verteilt'],
  ['299.1', 'ende'],
  ['511.0', 'ende']
];

const p = U.ausMappe(JSON.parse(fs.readFileSync(datei, 'utf8')));
const finde = bkp => (p.vergaben || []).find(v => (v.bkp || '') === bkp);

let fehler = 0;
console.log('\n=== Termine ===');
console.log('  BKP      Gewerk                        von                  bis');
console.log('  ' + '-'.repeat(76));
for (const [bkp, von, bis] of TERMINE) {
  const v = finde(bkp);
  if (!v) { console.log('  ' + bkp.padEnd(9) + 'NICHT GEFUNDEN'); fehler++; continue; }
  // Kein Termin darf auf einem Wochenende beginnen oder enden.
  [von, bis].forEach(d => {
    const w = new Date(d + 'T12:00:00').getDay();
    if (w === 0 || w === 6) { console.log('  ACHTUNG ' + bkp + ': ' + zeig(d) + ' ist ein Wochenende'); fehler++; }
  });
  console.log('  ' + bkp.padEnd(9) + String(v.gewerk || '').slice(0, 28).padEnd(30) + zeig(von) + '   ' + zeig(bis));
  v.bauStart = von; v.bauEnde = bis;
  delete v.zeitlage;
}

console.log('\n=== Ohne festen Termin ===');
const LABELS = { anfang: 'am Anfang', ende: 'am Ende', verteilt: 'über die ganze Bauzeit' };
console.log('  BKP      Gewerk                        Zeitlage');
console.log('  ' + '-'.repeat(70));
for (const [bkp, lage] of LAGEN) {
  const v = finde(bkp);
  if (!v) { console.log('  ' + bkp.padEnd(9) + 'NICHT GEFUNDEN'); fehler++; continue; }
  console.log('  ' + bkp.padEnd(9) + String(v.gewerk || '').slice(0, 28).padEnd(30) + LABELS[lage]);
  v.zeitlage = lage;
  v.bauStart = ''; v.bauEnde = '';       // eine Zeitlage schliesst Termine aus
  v.imTermin = false;                    // und erscheint nicht im Balkenplan
}

/* ---- Was danach noch ohne Zuordnung ist ---- */
const projMonate = (() => {
  let min = null, max = null;
  (p.vergaben || []).forEach(v => { if (!v.bauStart || !v.bauEnde) return; if (!min || v.bauStart < min) min = v.bauStart; if (!max || v.bauEnde > max) max = v.bauEnde; });
  if (!min || !max) return [];
  const out = []; let y = +min.slice(0, 4), m = +min.slice(5, 7) - 1;
  const ey = +max.slice(0, 4), em = +max.slice(5, 7) - 1;
  while (y < ey || (y === ey && m <= em)) { out.push(y + '-' + String(m + 1).padStart(2, '0')); m++; if (m > 11) { m = 0; y++; } }
  return out;
})();

console.log('\n=== Projektzeitraum daraus ===');
console.log('  ' + (projMonate[0] || '–') + ' bis ' + (projMonate[projMonate.length - 1] || '–')
  + '   (' + projMonate.length + ' Monate)');

const offen = (p.vergaben || []).filter(v => {
  const betrag = Number(v.betrag) || 0;
  const eig = (v.prognoseEigen != null && v.prognoseEigen !== '') ? Number(v.prognoseEigen) : 0;
  return (betrag > 0 || eig > 0) && !(v.bauStart && v.bauEnde) && !v.zeitlage;
});
console.log('\n=== Weiterhin ohne Termin und ohne Zeitlage ===');
if (!offen.length) console.log('  keine – jede Position mit Betrag ist zugeordnet');
else offen.forEach(v => console.log('  ' + String(v.bkp || '').padEnd(9)
  + String(v.gewerk || '').slice(0, 30).padEnd(32)
  + new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      .format(Number(v.betrag) || Number(v.prognoseEigen) || 0).padStart(12)));

if (fehler) { console.log('\n  ' + fehler + ' FEHLER – nichts geschrieben\n'); process.exit(1); }

if (schreiben) {
  fs.writeFileSync(datei, JSON.stringify(U.zuMappe(p), null, 1), 'utf8');
  console.log('\n  Geschrieben.\n');
} else {
  console.log('\n  Zum Übernehmen:  node test/korrektur-termine.js schreiben\n');
}
