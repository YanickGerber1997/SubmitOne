// Korrekturen vom 14.08.2026, dritte Runde.
//
// Aufruf:  node test/korrektur-3.js            (nur zeigen)
//          node test/korrektur-3.js schreiben
//
//   1. 199 Übriges: Budget 500.00 statt 0.00  (mein Fehler in Runde 2)
//   2. Konditionen des Werkvertrags Elag hinterlegen: 5 % Rabatt, 1 % allg. Abzüge
//   3. Nachtrag Elag über 4'662.50 inkl. MwSt einbuchen, Konditionen angewandt

const fs = require('fs');
const path = require('path');
const U = require('../submit/kern/uebersetzer.js');

const schreiben = process.argv[2] === 'schreiben';
const datei = path.join(__dirname, '..', 'privat', 'Projekte',
  'Umbau EFH Römerstrasse 31', 'Umbau EFH Römerstrasse 31.submit');

const p = U.ausMappe(JSON.parse(fs.readFileSync(datei, 'utf8')));
const finde = bkp => p.vergaben.find(v => (v.bkp || '') === bkp);
const f = n => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

/* ---- 1. 199 Übriges ----
   Die Vorlage zeigt KV rev. 0.00, aber WV 500.00 — massgebend ist der WV. */
const ueb = finde('199');
if (ueb) {
  ueb.eingeladene = [{ id: 'eo_199', firma: 'Budget', email: '', betrag: 500, status: 'offeriert', datumMail: '' }];
  if ((ueb.budgetposten || []).length) ueb.budgetposten[0].betrag = 500;
  console.log('\n  199 Übriges           Budget auf ' + f(500) + ' gesetzt');
}

/* ---- 2. Konditionen des Werkvertrags Elag ----
   «5 % Rabatt, 1 % allg. Abzüge, 8.1 % MwSt — bereits im WV so drin.»
   Hinterlegt an der Vergabestufe des Unternehmers. Damit findet sie
   wvKonditionen() und übernimmt sie bei jeder späteren Offerte von selbst. */
const KOND = { rabatt: 5, weitereAbz: 1 };
const ger = finde('211.1');
if (ger) {
  ger.firma = ger.firma || 'Elag';
  const eing = ger.eingeladene || [];
  let e = eing.find(x => x.firma === 'Elag') || eing[0];
  if (!e) { e = { id: 'eo_211_1', firma: 'Elag', email: '', betrag: ger.betrag || 0, status: 'offeriert', datumMail: '' }; eing.push(e); }
  e.firma = 'Elag';
  e.vergabe = Object.assign({ brutto: ger.betrag || 0 }, KOND);
  ger.eingeladene = eing;
  console.log('  211.1 Gerüstungen     Konditionen am WV: ' + KOND.rabatt + ' % Rabatt, ' + KOND.weitereAbz + ' % allg. Abzüge');
}

/* ---- 3. Nachtrag Elag ----
   Die ganze Baukostenübersicht rechnet inkl. 8.1 % MwSt, deshalb wirken die
   Abzüge auf den Bruttobetrag. Reihenfolge wie in condParts(): erst Rabatt,
   dann die allgemeinen Abzüge auf die Zwischensumme. */
const BRUTTO = 4662.50;
const nachRabatt = BRUTTO * (1 - KOND.rabatt / 100);
const netto = nachRabatt * (1 - KOND.weitereAbz / 100);
const gerundet = Math.round(netto * 100) / 100;

if (ger) {
  ger.nachtraege = ger.nachtraege || [];
  if (!ger.nachtraege.find(n => n.titel === 'Nachtrag Gerüst')) {
    ger.nachtraege.push({
      id: 'n_211_1_1', titel: 'Nachtrag Gerüst', nr: '1',
      betrag: gerundet, datum: '2026-08-14', status: 'genehmigt',
      brutto: BRUTTO, rabatt: KOND.rabatt, weitereAbz: KOND.weitereAbz
    });
  }
  console.log('\n  Nachtrag Elag');
  console.log('     Brutto inkl. MwSt          ' + f(BRUTTO).padStart(12));
  console.log('     − ' + KOND.rabatt + ' % Rabatt               ' + f(BRUTTO - nachRabatt).padStart(12));
  console.log('     Zwischensumme              ' + f(nachRabatt).padStart(12));
  console.log('     − ' + KOND.weitereAbz + ' % allg. Abzüge        ' + f(nachRabatt - netto).padStart(12));
  console.log('     ─────────────────────────────────────');
  console.log('     eingebucht                 ' + f(gerundet).padStart(12));
}

/* ---- Bericht ---- */
const bet = v => v.status === 'vergeben' ? (Number(v.betrag) || 0)
  : (((v.eingeladene || [])[0] && v.eingeladene[0].betrag != null) ? Number(v.eingeladene[0].betrag) : (Number(v.schaetzung) || 0));
const nt = v => (v.nachtraege || []).filter(n => n.status === 'genehmigt').reduce((a, n) => a + (Number(n.betrag) || 0), 0);

const summe = p.vergaben.reduce((a, v) => a + bet(v), 0);
const ntSumme = p.vergaben.reduce((a, v) => a + nt(v), 0);

console.log('\n=== Stand ===');
console.log('  Vergabesummen        ' + f(summe).padStart(14) + '    Vorlage 795 077.85   '
  + (Math.abs(summe - 795077.85) < 0.01 ? 'stimmt' : 'ABWEICHUNG ' + f(summe - 795077.85)));
console.log('  genehmigte Nachträge ' + f(ntSumme).padStart(14) + '    neu');
console.log('  Abrechnungsprognose  ' + f(summe + ntSumme).padStart(14));

if (schreiben) {
  fs.writeFileSync(datei, JSON.stringify(U.zuMappe(p), null, 1), 'utf8');
  console.log('\n  Geschrieben.\n');
} else {
  console.log('\n  Nur angezeigt. Zum Übernehmen:  node test/korrektur-3.js schreiben\n');
}
