// Trägt die Bautermine aus dem Bauprogramm V2 (01.06.26) ein.
//
// Aufruf:  node test/termine-uebernehmen.js            (nur zeigen)
//          node test/termine-uebernehmen.js schreiben
//
// Angaben von Yanick am 14.08.2026, gegen die Arbeitstagsspalten des
// Bauprogramms geprüft. Was noch offen ist, steht unten als OFFEN.

const fs = require('fs');
const path = require('path');
const U = require('../submit/kern/uebersetzer.js');

const schreiben = process.argv[2] === 'schreiben';
const datei = path.join(__dirname, '..', 'privat', 'Projekte',
  'Umbau EFH Römerstrasse 31', 'Umbau EFH Römerstrasse 31.submit');

/* Vorläufig, bis die Sommerferien und das Ende «nach Aufgebot» feststehen. */
const VOR_SOMMERFERIEN = '2026-07-17';   // letzter Arbeitstag davor — ANNAHME
const FERTIG_ENDE      = '2026-11-06';   // «ab 12.10. nach Aufgebot», bis vor der IBN

const T = [
  { bkp: '211.1', start: '2026-08-11', ende: '2026-08-12',
    notiz: 'Gerüstabbau noch offen',
    vorgaenge: [['Gerüst aufrichten', '2026-08-11', '2026-08-12']] },

  { bkp: '221.2', start: '2026-10-05', ende: '2026-10-09',
    notiz: 'Fensterersatz, eine Woche. Im Bauprogramm als frühstmöglicher Termin vermerkt.' },

  { bkp: '221.6', start: '2026-10-05', ende: '2026-10-05',
    notiz: 'Aussentür Metall, ein Tag, in der Fensterwoche. Die neue Holztür gehört zum Schreinerauftrag.' },

  { bkp: '282.4', start: '2026-11-02', ende: '2026-11-06',
    notiz: 'Parkett EG, eine Woche' },

  { bkp: '237', start: '2026-08-31', ende: '2026-09-11',
    notiz: 'Montage PV-Anlage, zwei Wochen' },

  { bkp: '230', start: '2026-06-08', ende: '2026-11-20', auto: true,
    notiz: 'Etappen nach Aufgebot. Beginn 06.06. war ein Samstag — auf Montag 08.06. gelegt.',
    vorgaenge: [
      ['Stromlos & Provisorium',   '2026-06-08', '2026-06-08'],
      ['Einlegen & Neuverkabeln',  '2026-06-22', VOR_SOMMERFERIEN],
      ['PV anschliessen',          '2026-08-31', '2026-09-11'],
      ['Einziehen',                '2026-09-21', '2026-09-25'],
      ['Fertigstellung',           '2026-10-12', FERTIG_ENDE],
      ['Anschliessen & IBN',       '2026-11-09', '2026-11-20']] },

  { bkp: '240', start: '2026-06-08', ende: '2026-11-20', auto: true,
    notiz: 'Wie Elektro, ohne Solararbeiten. Etappen nach Aufgebot.',
    vorgaenge: [
      ['Abhängen & Tankausbau',    '2026-06-08', '2026-06-08'],
      ['Einlegen & Neuverlegen',   '2026-06-22', VOR_SOMMERFERIEN],
      ['Fertigstellung',           '2026-10-12', FERTIG_ENDE],
      ['Anschliessen & IBN',       '2026-11-09', '2026-11-20']] },

  { bkp: '250', start: '2026-06-08', ende: '2026-11-20', auto: true,
    notiz: 'Wie Elektro, ohne Solararbeiten. Etappen nach Aufgebot.',
    vorgaenge: [
      ['Wasserlos & Provisorium',  '2026-06-08', '2026-06-08'],
      ['Einlegen & Neuverrohren',  '2026-06-22', VOR_SOMMERFERIEN],
      ['Einziehen',                '2026-09-21', '2026-09-25'],
      ['Fertigstellung',           '2026-10-12', FERTIG_ENDE],
      ['Anschliessen & IBN',       '2026-11-09', '2026-11-20']] }
];

/* ---- Arbeitstage aus den Spalten des Bauprogramms ---- */
const TAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
function wochentag(iso) { return TAG[new Date(iso + 'T12:00:00').getDay()]; }
function istWochenende(iso) { const t = wochentag(iso); return t === 'Sa' || t === 'So'; }

const p = U.ausMappe(JSON.parse(fs.readFileSync(datei, 'utf8')));

console.log('\n=== Prüfung: fällt ein Datum auf ein Wochenende? ===');
let warnungen = 0;
T.forEach(e => {
  [[e.start, 'Start'], [e.ende, 'Ende']].forEach(([d, was]) => {
    if (d && istWochenende(d)) { console.log(`  ${e.bkp}  ${was} ${d} ist ein ${wochentag(d)}`); warnungen++; }
  });
  (e.vorgaenge || []).forEach(([titel, a, b]) => {
    [[a, 'Start'], [b, 'Ende']].forEach(([d, was]) => {
      if (d && istWochenende(d)) { console.log(`  ${e.bkp}  «${titel}» ${was} ${d} ist ein ${wochentag(d)}`); warnungen++; }
    });
  });
});
if (!warnungen) console.log('  keine — alle Daten sind Arbeitstage');

console.log('\n=== Eintragungen ===');
const fehlt = [];
for (const e of T) {
  const v = p.vergaben.find(x => (x.bkp || '') === e.bkp);
  if (!v) { fehlt.push(e.bkp); continue; }
  v.bauStart = e.start;
  v.bauEnde = e.ende;
  if (e.notiz) v.beschrieb = (v.beschrieb ? v.beschrieb + ' ' : '') + e.notiz;
  if (e.auto) v.autoBalken = true;
  if (e.vorgaenge) {
    v.vorgaenge = e.vorgaenge.map(([titel, start, ende], i) => ({
      id: 'o_' + e.bkp.replace('.', '_') + '_' + (i + 1), titel, start, ende
    }));
  }
  const d = (a, b) => a.slice(8, 10) + '.' + a.slice(5, 7) + '. – ' + b.slice(8, 10) + '.' + b.slice(5, 7) + '.';
  console.log('  ' + e.bkp.padEnd(8) + (v.gewerk || '').slice(0, 30).padEnd(32) + d(e.start, e.ende)
    + ((e.vorgaenge || []).length ? '   ' + e.vorgaenge.length + ' Vorgänge' : ''));
}
if (fehlt.length) console.log('\n  NICHT gefunden: ' + fehlt.join(', '));

const ohne = p.vergaben.filter(v => !v.bauStart || !v.bauEnde);
console.log('\n=== Danach noch ohne Termine ===');
ohne.forEach(v => console.log('  ' + (v.bkp || '—').padEnd(8) + (v.gewerk || '')));
console.log('  → ' + ohne.length + ' Positionen (Honorare, Gebühren, Reserven — ohne Bauzeit)');

if (schreiben) {
  fs.writeFileSync(datei, JSON.stringify(U.zuMappe(p), null, 1), 'utf8');
  console.log('\n  Geschrieben.\n');
} else {
  console.log('\n  Nur angezeigt. Zum Übernehmen:  node test/termine-uebernehmen.js schreiben\n');
}
