// Korrekturen vom 14.08.2026 nach der ersten Durchsicht.
//
// Aufruf:  node test/korrektur-1.js            (nur zeigen)
//          node test/korrektur-1.js schreiben
//
//   1. Gerüstabbau 16.11., drei Tage → Gerüstungen laufen 11.08. – 18.11.
//   2. Aussentür Holz bekommt eine eigene Nummer: 273.0, im Schreinerauftrag
//   3. 221.6 Türen + Tore → Odermatt Fensterbau
//   4. 281 Unterlagsböden macht der Parkettleger → Sammelauftrag mit 282.4
//   5. Sommerferien 20. – 31.07.2026 als Bauunterbruch festgehalten

const fs = require('fs');
const path = require('path');
const U = require('../submit/kern/uebersetzer.js');

const schreiben = process.argv[2] === 'schreiben';
const datei = path.join(__dirname, '..', 'privat', 'Projekte',
  'Umbau EFH Römerstrasse 31', 'Umbau EFH Römerstrasse 31.submit');

const p = U.ausMappe(JSON.parse(fs.readFileSync(datei, 'utf8')));
const finde = bkp => p.vergaben.find(v => (v.bkp || '') === bkp);
const log = [];

/* ---- 1. Gerüstungen: Aufbau + Abbau ---- */
const ger = finde('211.1');
if (ger) {
  ger.bauStart = '2026-08-11';
  ger.bauEnde = '2026-11-18';
  ger.autoBalken = true;
  ger.vorgaenge = [
    { id: 'o_211_1_1', titel: 'Gerüst aufrichten', start: '2026-08-11', ende: '2026-08-12' },
    { id: 'o_211_1_2', titel: 'Gerüstabbau',       start: '2026-11-16', ende: '2026-11-18' }
  ];
  ger.beschrieb = 'Aufrichten zwei Tage, Abbau drei Tage. Dazwischen steht das Gerüst.';
  log.push('  211.1   Gerüstungen           11.08. – 18.11.   Auf- und Abbau als Vorgänge');
}

/* ---- 2. Aussentür Holz als eigene Position ---- */
let holz = finde('273.0');
if (!holz) {
  const schreiner = finde('273');
  holz = {
    id: 'v_273_0', bkp: '273.0', gewerk: 'Aussentür Holz', status: 'ausschreibung',
    firma: '', betrag: 0, schaetzung: 0,
    frist: '', bauStart: '2026-10-06', bauEnde: '2026-10-06',
    beschrieb: 'Neu. Gehört zum Schreinerauftrag. Montage ein Tag, in der Fensterwoche. Betrag noch offen.',
    eingeladene: [], nachtraege: [], rapporte: [], vorgaenge: [], rechnungen: [], budgetposten: []
  };
  const i = p.vergaben.indexOf(schreiner);
  p.vergaben.splice(i >= 0 ? i + 1 : p.vergaben.length, 0, holz);
  log.push('  273.0   Aussentür Holz        NEU · 06.10. · Betrag offen');
}

/* ---- 3. und 4. Unternehmer ---- */
[['221.6', 'Odermatt Fensterbau'], ['281', 'Kühni - Parkett']].forEach(([bkp, firma]) => {
  const v = finde(bkp);
  if (v && v.firma !== firma) { v.firma = firma; log.push('  ' + bkp.padEnd(8) + (v.gewerk || '').slice(0, 22).padEnd(22) + firma); }
});

/* ---- Sammelvergaben ergänzen ---- */
const SAMMEL = [
  { id: 'sv_fenster', name: 'Fenster und Aussentüren Metall', firma: 'Odermatt Fensterbau',
    bkp: ['221.2', '221.6'], notiz: 'Kunststoff-Metallfenster und Aussentüren aus einem Auftrag.' },
  { id: 'sv_boden',   name: 'Unterlagsböden und Parkett', firma: 'Kühni - Parkett',
    bkp: ['281', '282.4'], notiz: 'Der Parkettleger macht in diesem Fall auch die Unterlagsböden — eigene BKP, ein Auftrag.' },
  { id: 'sv_schreiner', name: 'Schreinerarbeiten', firma: '',
    bkp: ['273', '273.0'], notiz: 'Innentüren, Einbauschränke und die neue Aussentür Holz. Unternehmer noch offen.' }
];
p.sammelvergaben = p.sammelvergaben || [];
SAMMEL.forEach(g => {
  const teile = g.bkp.map(finde).filter(Boolean);
  if (teile.length < 2) return;
  if (!p.sammelvergaben.find(x => x.id === g.id)) p.sammelvergaben.push({ id: g.id, name: g.name, firma: g.firma, art: 'werkvertrag', notiz: g.notiz });
  teile.forEach(v => { v.sammelId = g.id; if (!v.firma && g.firma) v.firma = g.firma; });
  log.push('  Sammel  ' + (g.firma || 'offen').padEnd(22) + g.bkp.join(' + '));
});

/* ---- 5. Bauunterbruch ---- */
p.bauunterbrueche = [
  { id: 'bu_1', titel: 'Sommerferien', von: '2026-07-20', bis: '2026-07-31' }
];
log.push('  Unterbruch  Sommerferien        20.07. – 31.07.2026');

/* ---- Bericht ---- */
console.log('\n=== Korrekturen ===');
console.log(log.join('\n'));

console.log('\n=== Sammelvergaben ===');
const f = n => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2 }).format(n || 0);
const betrag = v => v.status === 'vergeben' ? (Number(v.betrag) || 0)
  : ((v.eingeladene || [])[0] && (v.eingeladene[0].betrag != null) ? Number(v.eingeladene[0].betrag) : (Number(v.schaetzung) || 0));
p.sammelvergaben.forEach(s => {
  const teile = p.vergaben.filter(v => v.sammelId === s.id);
  console.log('\n  ' + (s.firma || '(Unternehmer offen)') + '  —  ' + s.name);
  teile.forEach(v => console.log('     ' + (v.bkp || '').padEnd(8) + (v.gewerk || '').slice(0, 32).padEnd(34) + f(betrag(v)).padStart(13)));
  console.log('     ' + ''.padEnd(42) + f(teile.reduce((a, v) => a + betrag(v), 0)).padStart(13));
});

console.log('\n=== Noch ohne Unternehmer ===');
p.vergaben.filter(v => !v.firma && betrag(v) > 0)
  .forEach(v => console.log('  ' + (v.bkp || '—').padEnd(8) + (v.gewerk || '').padEnd(36) + f(betrag(v)).padStart(12)));

if (schreiben) {
  fs.writeFileSync(datei, JSON.stringify(U.zuMappe(p), null, 1), 'utf8');
  console.log('\n  Geschrieben.\n');
} else {
  console.log('\n  Nur angezeigt. Zum Übernehmen:  node test/korrektur-1.js schreiben\n');
}
