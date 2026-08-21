// Legt die Bauherren-Auswahlpunkte für Umbau EFH Römerstrasse 31 an.
//
// Aufruf:  node test/bemusterung.js            (nur zeigen)
//          node test/bemusterung.js schreiben
//
// Bauherrschaft: Cosima Bader
//
// Warum hier und nicht im Code
// ----------------------------
// app.js bringt eine BEMUSTERUNG_STANDARD-Liste mit — die passt aber nicht:
// Dort ist 282.4 «Fliesen/Plättli» und 281.7 «Parkett». In diesem Projekt ist
// 282.4 das Parkett und 281.6 die keramischen Beläge. Die Liste gehört also
// ins Projekt, nicht in den Quelltext.
//
// Der Ablauf, den diese Punkte abbilden:
//   1. Ausschreibung   → Offerten, Abgebot, Zuschlag
//   2. Werkvertrag     → enthält eine ANNAHME (budget)
//   3. Bemusterung     → Cosima wählt, kurz vor Einbau
//   4. neue Offerte    → brutto, Konditionen kommen aus dem WV
//   5. Differenz       → wirkt in der Abrechnungsprognose

const fs = require('fs');
const path = require('path');
const U = require('../submit/kern/uebersetzer.js');

const schreiben = process.argv[2] === 'schreiben';
const datei = path.join(__dirname, '..', 'privat', 'Projekte',
  'Umbau EFH Römerstrasse 31', 'Umbau EFH Römerstrasse 31.submit');

/* thema · bkp · was im Werkvertrag angenommen ist */
const PUNKTE = [
  ['258',   'Küche — Fronten',                 'Ausführung gemäss Werkvertrag Stucki Küchen'],
  ['258',   'Küche — Abdeckung',               'Steinabdeckung, Standardauswahl'],
  ['258',   'Küche — Geräte',                  'Geräteset gemäss Offerte'],
  ['258',   'Küche — Spüle & Armatur',         ''],

  ['250',   'Sanitärapparate',                 'Apparate gemäss Werkvertrag Eichenberger'],
  ['250',   'Sanitärarmaturen',                ''],
  ['250',   'Duschtrennwände',                 ''],

  ['281.6', 'Keramische Wandbeläge',           'Plattenwahl gemäss Budget Böhme'],
  ['281.6', 'Keramische Bodenbeläge',          ''],
  ['282.4', 'Parkett EG',                      'Parkett gemäss Werkvertrag Kühni'],

  ['273',   'Innentüren',                      'Türblätter und Beschläge, Standardausführung'],
  ['273',   'Einbauschränke',                  'Einbauschränke gemäss Offerte'],
  ['273',   'Aussentür Holz',                  'neu, aus dem Schreinerauftrag'],

  ['285.1', 'Wandfarben & Anstrich',           'Standardanstrich'],
  ['228',   'Sonnenstoren — Stoff und Farbe',  'Ausführung gemäss Werkvertrag Schenker'],
  ['230',   'Schalter & Steckdosen',           'Standardprogramm'],
  ['230',   'Beleuchtung',                     'Grundbeleuchtung im Werkvertrag'],
  ['272',   'Geländer',                        'Ausführung gemäss Werkvertrag Hermann'],
  ['421',   'Umgebung — Plattenbelag',         'leichte Gehweggestaltung mit Platten']
];

const p = U.ausMappe(JSON.parse(fs.readFileSync(datei, 'utf8')));

/* Kennung wie Hilf.id(): Zufall, damit sie ohne Server eindeutig ist. */
let zaehler = 0;
const kennung = () => 'en_' + (++zaehler).toString().padStart(2, '0');

const vorhanden = new Set((p.entscheidungen || []).map(e => (e.thema || '').toLowerCase()));
p.entscheidungen = p.entscheidungen || [];

console.log('\n=== Auswahlpunkte für Cosima Bader ===\n');
let neu = 0, ohneGewerk = [];

for (const [bkp, thema, annahme] of PUNKTE) {
  if (vorhanden.has(thema.toLowerCase())) continue;
  const v = p.vergaben.find(x => (x.bkp || '') === bkp);
  if (!v) { ohneGewerk.push(bkp + ' ' + thema); continue; }

  p.entscheidungen.push({
    id: kennung(),
    datum: '',
    bereich: 'Bemusterung',
    thema,
    bkp,
    vid: v.id,                 // hängt am Gewerk — nicht an der BKP allein
    entscheid: '',
    status: 'offen',
    annahme,                   // was der Werkvertrag unterstellt
    budget: '',                // Anteil im WV, sobald bekannt
    brutto: '',                // Offerte nach der Auswahl
    rabatt: '', skonto: '', weitereAbz: '',
    ausstellung: null,
    wohnung: ''
  });
  neu++;
  console.log('  ' + bkp.padEnd(8) + thema.padEnd(34) + (v.firma || '—'));
}

if (ohneGewerk.length) console.log('\n  Ohne passendes Gewerk: ' + ohneGewerk.join(' · '));

/* ---- Übersicht je Gewerk ---- */
console.log('\n=== Je Gewerk ===');
const proGewerk = new Map();
p.entscheidungen.forEach(e => {
  const v = p.vergaben.find(x => x.id === e.vid);
  const k = v ? ((v.bkp || '') + ' ' + (v.gewerk || '')) : '(ohne Gewerk)';
  proGewerk.set(k, (proGewerk.get(k) || 0) + 1);
});
[...proGewerk.entries()].sort().forEach(([k, n]) =>
  console.log('  ' + k.slice(0, 44).padEnd(46) + n + ' Punkt' + (n === 1 ? '' : 'e')));

console.log('\n  ' + neu + ' Punkte angelegt, ' + p.entscheidungen.length + ' insgesamt');

if (schreiben) {
  fs.writeFileSync(datei, JSON.stringify(U.zuMappe(p), null, 1), 'utf8');
  console.log('\n  Geschrieben — in die .submit-Datei, nicht in den Code.\n');
} else {
  console.log('\n  Nur angezeigt. Zum Übernehmen:  node test/bemusterung.js schreiben\n');
}
