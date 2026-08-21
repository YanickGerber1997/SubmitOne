// Sonnen- und Wetterschutz verschieben: 07.12.2026, eine Woche.
//
// Aufruf:  node test/termin-228.js            (nur zeigen)
//          node test/termin-228.js schreiben

const fs = require('fs');
const path = require('path');
const U = require('../submit/kern/uebersetzer.js');

const schreiben = process.argv[2] === 'schreiben';
const datei = path.join(__dirname, '..', 'privat', 'Projekte',
  'Umbau EFH Römerstrasse 31', 'Umbau EFH Römerstrasse 31.submit');

const NEU_START = '2026-12-07';   // Montag
const NEU_ENDE  = '2026-12-11';   // Freitag — eine Arbeitswoche, wie beim Fensterersatz

const p = U.ausMappe(JSON.parse(fs.readFileSync(datei, 'utf8')));
const T = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const tag = iso => iso ? T[new Date(iso + 'T12:00:00').getDay()] : '';
const zeig = iso => iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) + ' ' + tag(iso) : '–';

const v = p.vergaben.find(x => (x.bkp || '') === '228');
if (!v) { console.error('228 nicht gefunden'); process.exit(1); }

console.log('\n=== 228 ' + (v.gewerk || '') + ' ===');
console.log('  bisher   ' + zeig(v.bauStart) + '  bis  ' + zeig(v.bauEnde));
console.log('  neu      ' + zeig(NEU_START) + '  bis  ' + zeig(NEU_ENDE));

v.bauStart = NEU_START;
v.bauEnde  = NEU_ENDE;

/* Storen brauchen das Gerüst. Steht es zum neuen Termin noch? */
const g = p.vergaben.find(x => (x.bkp || '') === '211.1');
if (g && g.bauEnde) {
  console.log('\n=== Prüfung gegen das Gerüst ===');
  console.log('  Gerüst steht bis          ' + zeig(g.bauEnde));
  console.log('  Sonnenschutz beginnt      ' + zeig(NEU_START));
  if (NEU_START > g.bauEnde) {
    const tage = Math.round((new Date(NEU_START) - new Date(g.bauEnde)) / 86400000);
    console.log('\n  ACHTUNG: Der Sonnenschutz beginnt ' + tage + ' Tage NACH dem Gerüstabbau.');
    console.log('  Entweder das Gerüst länger stehen lassen, oder der Storenbauer');
    console.log('  braucht eine Hebebühne — beides kostet und gehört geklärt.');
  } else {
    console.log('  Passt — das Gerüst steht noch.');
  }
}

if (schreiben) {
  fs.writeFileSync(datei, JSON.stringify(U.zuMappe(p), null, 1), 'utf8');
  console.log('\n  Geschrieben.\n');
} else {
  console.log('\n  Zum Übernehmen:  node test/termin-228.js schreiben\n');
}
