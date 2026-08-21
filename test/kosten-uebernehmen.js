// Übernimmt die Baukostenübersicht «Kostenprognose 13.08.26» (Stand 16.07.2026)
// in die Projektdatei Umbau EFH Römerstrasse 31.
//
// Aufruf:  node test/kosten-uebernehmen.js          (nur zeigen, nichts schreiben)
//          node test/kosten-uebernehmen.js  schreiben
//
// Alle Beträge inkl. 8.1 % MwSt., wie in der Vorlage.
// Unternehmernamen ausgeschrieben, keine Abkürzungen.

const fs = require('fs');
const path = require('path');
const U = require('../submit/kern/uebersetzer.js');

const schreiben = process.argv[2] === 'schreiben';
const datei = path.join(__dirname, '..', 'privat', 'Projekte',
  'Umbau EFH Römerstrasse 31', 'Umbau EFH Römerstrasse 31.submit');

/* =====================================================================
   Die Vorlage, Zeile für Zeile
   ---------------------------------------------------------------------
   bkp      wie in der Datei (nicht wie in der Vorlage, wo z.B. 221 statt
            221.2 steht) — die Zuordnung steht in `vorlageBkp`
   kv       Spalte KV
   rev      Spalte KV rev.
   wv       Spalte WV
   firma    Spalte Unternehmer, ausgeschrieben
   zahlungen [[datum, betrag, text]]
   ===================================================================== */
const V = [
  { bkp: '104',   firma: 'Duna',                     kv: 0,      rev: 500,       wv: 638.65,
    zahlungen: [['2025-11-27', 486.45], ['2026-05-27', 152.20]] },
  { bkp: '121',   firma: 'Fuhrer Masciadri',         kv: 3000,   rev: 4000,      wv: 4000,
    notiz: 'Teil aus 211' },
  { bkp: '191',   firma: 'P. Hefti Bauberatung',     kv: 3520,   rev: 3794.90,   wv: 3794.90,
    zahlungen: [['2025-12-05', 3794.90]] },
  { bkp: '199',   firma: '',                         kv: 500,    rev: 0,         wv: 500 },

  { bkp: '211',   firma: 'Fuhrer Masciadri',         kv: 75000,  rev: 94397.75,  wv: 103397.75,
    notiz: 'Teil in 121 und 289. Weiterer Unternehmer: Kilchherr.',
    zahlungen: [['2025-12-10', 1179.90], ['2026-07-13', 35000, 'Fuhrer Masciadri, 1. Akonto']] },
  { bkp: '211.1', firma: 'Elag',                     kv: 6000,   rev: 6771.35,   wv: 6771.35 },
  { bkp: '214',   firma: '',                         kv: 11000,  rev: 64322.30,  wv: 64322.30,
    notiz: 'angepasste Offerte eingepflegt' },
  { bkp: '215',   firma: '',                         kv: 9000,   rev: 0,         wv: 0,
    notiz: 'angepasste Offerte eingepflegt' },
  { bkp: '221.2', firma: 'Odermatt',                 kv: 35000,  rev: 44220.75,  wv: 44322.05,
    notiz: 'Kunststoff-Metallfenster, angepasster Vertrag eingepflegt' },
  { bkp: '221.6', firma: '',                         kv: 8500,   rev: 13900,     wv: 13900 },
  { bkp: '222.0', firma: 'Künzi',                    kv: 12000,  rev: 13230.60,  wv: 13230.60 },

  { bkp: '224.0', firma: 'Jau',                      kv: 8000,   rev: 24812.40,  wv: 15000 },
  { bkp: '225',   firma: '',                         kv: 5000,   rev: 5000,      wv: 5000,
    notiz: 'Budgetposition' },
  { bkp: '226.2', firma: 'Staub + Hostettler',       kv: 28500,  rev: 52281.20,  wv: 52281.20 },
  { bkp: '228',   firma: 'Schenker',                 kv: 8500,   rev: 12258.40,  wv: 12258.40 },
  { bkp: '230',   firma: '',                         kv: 22000,  rev: 29314.55,  wv: 29314.55,
    notiz: 'angepasste Offerte eingepflegt' },
  { bkp: '237',   firma: '',                         kv: 30000,  rev: 32608.35,  wv: 32608.35,
    notiz: 'angepasste Offerte eingepflegt. Förderbeitrag Pronovo bereits abgezogen (CHF 10 088.00).' },
  { bkp: '240',   firma: 'Eichenberger',             kv: 20000,  rev: 47986,     wv: 42350,
    notiz: 'angepasste Offerte eingepflegt' },

  { bkp: '250',   firma: 'Eichenberger',             kv: 49000,  rev: 35303.50,  wv: 34650 },
  { bkp: '258',   firma: '',                         kv: 30000,  rev: 44300,     wv: 64929.55 },
  { bkp: '271',   firma: 'Staub + Hostettler',       kv: 8000,   rev: 13253.65,  wv: 13253.65 },
  { bkp: '272',   firma: 'Hermann',                  kv: 5500,   rev: 16855.50,  wv: 16855.50 },
  { bkp: '273',   firma: '',                         kv: 5500,   rev: 15000,     wv: 15000,
    notiz: 'Einbauschränke eingefügt' },
  { bkp: '281',   firma: '',                         kv: 3500,   rev: 5000,      wv: 5000 },
  { bkp: '281.6', firma: 'Böhme - Platten',          kv: 23000,  rev: 30000,     wv: 20216.40,
    gewerk: 'Wand- und Bodenbeläge', notiz: 'Parkett EG separiert nach BKP 282.4' },
  { bkp: '282.4', firma: 'Kühni - Parkett',          kv: null,   rev: null,      wv: 30000,
    gewerk: 'Parkett EG', neu: true, notiz: 'aus BKP 281.6 separiert' },
  { bkp: '285.1', firma: 'Merz Gips',                kv: 8000,   rev: 16440.75,  wv: 16440.75 },

  { bkp: '287',   firma: 'Girsberger Wiedmer',       kv: 2000,   rev: 3210.55,   wv: 3210.55 },
  { bkp: '289',   firma: 'Fuhrer Masciadri',         kv: 5000,   rev: 5000,      wv: 5000,
    notiz: 'Teil aus 211' },
  { bkp: '291',   firma: 'P. Hefti Bauberatung',     kv: 78000,  rev: 78000,     wv: 78000,
    zahlungen: [['2025-12-05', 5945.50], ['2026-01-03', 4324], ['2026-03-03', 4324],
                ['2026-04-07', 10810], ['2026-05-01', 10810], ['2026-06-01', 5405], ['2026-07-03', 5405]] },
  { bkp: '292',   firma: '',                         kv: 4000,   rev: 3200,      wv: 3200 },
  { bkp: '296',   firma: 'Bautox',                   kv: 0,      rev: 1856.60,   wv: 1856.60,
    zahlungen: [['2025-12-05', 1856.60]] },
  { bkp: '299',   firma: '',                         kv: 50000,  rev: 20000,     wv: 20000,
    notiz: 'Reservepositionen zum Teil in Offerten verlagert. Keine Reserve für Projektänderungen!' },

  { bkp: '421',   firma: '',                         kv: 25000,  rev: 10000,     wv: 10000,
    notiz: 'Eingerechnet nur noch leichte Gehweggestaltung mit Platten' },
  { bkp: '52',    firma: '',                         kv: 40000,  rev: 10000,     wv: 10000,
    gewerk: 'Baunebenkosten' },
  { bkp: '511.0', firma: 'BBP Geomatik',             kv: 0,      rev: 3546.75,   wv: 3774.75,
    notiz: 'Bewilligung, EG Bremgarten Benutzung öffentliches Terrain',
    zahlungen: [['2025-11-14', 194.60], ['2025-11-28', 128.70], ['2026-01-20', 3223.45], ['2026-06-03', 228]] }
];

const SOLL = { kv: 622020, rev: 760365.85, wv: 795077.85, zahlungen: 93268.30 };

/* ---- Datei lesen ---- */
const roh = JSON.parse(fs.readFileSync(datei, 'utf8'));
const p = U.ausMappe(roh);
const f = n => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

/* ---- Gegenprobe: stimmen die Summen der Vorlage? ---- */
const summe = k => V.reduce((a, x) => a + (Number(x[k]) || 0), 0);
const zSumme = V.reduce((a, x) => a + (x.zahlungen || []).reduce((b, z) => b + z[1], 0), 0);
console.log('\n=== Gegenprobe zur Vorlage ===');
[['KV', summe('kv'), SOLL.kv], ['KV rev.', summe('rev'), SOLL.rev],
 ['WV', summe('wv'), SOLL.wv], ['Zahlungen', zSumme, SOLL.zahlungen]].forEach(([n, ist, soll]) => {
  const ok = Math.abs(ist - soll) < 0.01;
  console.log('  ' + n.padEnd(11) + f(ist).padStart(14) + '   Vorlage ' + f(soll).padStart(14) + '   ' + (ok ? 'stimmt' : 'ABWEICHUNG ' + f(ist - soll)));
});

/* ---- Übernehmen ---- */
console.log('\n=== Änderungen ===');
let geaendert = 0, neu = 0;
const nichtGefunden = [];

for (const e of V) {
  let v = p.vergaben.find(x => (x.bkp || '') === e.bkp);

  if (!v) {
    if (!e.neu) { nichtGefunden.push(e.bkp); continue; }
    v = { id: 'v_' + e.bkp.replace('.', '_'), bkp: e.bkp, gewerk: e.gewerk || '', status: 'ausschreibung',
          firma: '', betrag: 0, schaetzung: 0, frist: '', bauStart: '', bauEnde: '',
          eingeladene: [], nachtraege: [], rapporte: [], vorgaenge: [], rechnungen: [], budgetposten: [] };
    p.vergaben.push(v);
    neu++;
    console.log('  NEU   ' + e.bkp.padEnd(8) + (e.gewerk || ''));
  }

  const vorher = JSON.stringify(v);

  if (e.gewerk) v.gewerk = e.gewerk;
  if (e.firma) v.firma = e.firma;
  if (e.kv !== null && e.kv !== undefined) v.schaetzung = e.kv;
  if (e.notiz) v.beschrieb = e.notiz;

  // Revidierter KV als angepasste Offerte
  if (e.rev !== null && e.rev !== undefined) {
    v.eingeladene = [{ id: 'eo_' + e.bkp.replace('.', '_'), firma: e.firma || 'angepasste Offerte',
                       email: '', betrag: e.rev, status: 'offeriert', datumMail: '' }];
  }

  // Werkvertragssumme. Damit die Abrechnungsprognose der Vorlage entspricht,
  // zählt der WV — dafür muss die Position als vergeben gelten.
  if (e.wv > 0) { v.betrag = e.wv; v.status = 'vergeben'; }

  // Zahlungen
  if (e.zahlungen && e.zahlungen.length) {
    v.rechnungen = e.zahlungen.map(([datum, betrag, text], i) => ({
      id: 'rg_' + e.bkp.replace('.', '_') + '_' + (i + 1),
      gruppe: '', firma: e.firma || '', text: text || 'Zahlung', nr: '',
      art: 'akonto', betrag, datum, bezahlt: true
    }));
  }

  if (JSON.stringify(v) !== vorher && !e.neu) {
    geaendert++;
    console.log('  ' + e.bkp.padEnd(8) + (v.gewerk || '').slice(0, 32).padEnd(34)
      + 'WV ' + f(e.wv).padStart(12) + '   ' + (e.firma || '—'));
  }
}

if (nichtGefunden.length) console.log('\n  NICHT gefunden: ' + nichtGefunden.join(', '));

/* ---- Ergebnis ---- */
const gesamtWv = p.vergaben.reduce((a, v) => a + (v.status === 'vergeben' ? (v.betrag || 0) : 0), 0);
const gesamtZ = p.vergaben.reduce((a, v) => a + (v.rechnungen || []).reduce((b, r) => b + (r.betrag || 0), 0), 0);
console.log('\n=== Stand danach ===');
console.log('  Positionen           ' + p.vergaben.length + '  (' + neu + ' neu, ' + geaendert + ' geändert)');
console.log('  Summe Werkverträge   ' + f(gesamtWv));
console.log('  Summe Zahlungen      ' + f(gesamtZ));
console.log('  ohne Bautermine      ' + p.vergaben.filter(v => !v.bauStart || !v.bauEnde).length);

if (schreiben) {
  fs.copyFileSync(datei, datei.replace('.submit', ' — vor Kostenuebernahme.submit.sicherung'));
  fs.writeFileSync(datei, JSON.stringify(U.zuMappe(p), null, 1), 'utf8');
  console.log('\n  Geschrieben. Sicherung daneben als «… — vor Kostenuebernahme.submit.sicherung».\n');
} else {
  console.log('\n  Nur angezeigt. Zum Übernehmen:  node test/kosten-uebernehmen.js schreiben\n');
}
