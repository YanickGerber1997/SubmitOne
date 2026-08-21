// Konditionen je Gewerk hinterlegen — Stand 14.08.2026, von Yanick durchgegeben.
//
// Aufruf:  node test/konditionen.js            (nur rechnen und zeigen)
//          node test/konditionen.js schreiben
//
// Yanicks Vorgabe: «du musst in den Gewerken die Rechnung selber machen lassen,
// das heisst Brutto eintragen, Konditionen eintragen, MwSt drauf rechnen, und
// am Ende müssen wir auf die aktuellen WV-Summen kommen.»
//
// Also nicht die Werkvertragssumme abtippen, sondern die Offertsumme — den
// Bruttobetrag — und das Programm rechnen lassen:
//
//     Brutto  −Rabatt  −Skonto  −allg. Abzüge  +MwSt  =  Werkvertrag
//
// Yanick nennt die Summen NACH allen Abzügen. Der Bruttobetrag wird deshalb
// hier zurückgerechnet:  Brutto = WV / ((1−r)(1−s)(1−a) × (1 + MwSt))
//
// Danach läuft die Rechnung vorwärts durch dieselbe Formel wie condParts()
// in app.js und muss die gespeicherte WV-Summe auf den Rappen treffen.

const fs = require('fs');
const path = require('path');
const U = require('../submit/kern/uebersetzer.js');

const schreiben = process.argv[2] === 'schreiben';
const datei = path.join(__dirname, '..', 'privat', 'Projekte',
  'Umbau EFH Römerstrasse 31', 'Umbau EFH Römerstrasse 31.submit');

const MWST = 8.1;   // Leistungsdatum 2026 → 8.1 %
const ALLG = 1;     // «wir haben immer allg. Abzüge» — bestätigt: 1 %

const K = [
  ['211',   'Baumeisterarbeiten',               2,  2],
  ['211.1', 'Gerüstungen',                      5,  0],
  ['214',   'Holzbau / Geneigte Dächer',        3,  0],
  ['221.2', 'Fenster',                          8,  2],
  ['222.0', 'Spenglerarbeiten',                 4,  2],
  ['224.0', 'Steildach',                        4,  2],
  ['226.2', 'Fassadendämmung verputzt',         3,  2],
  ['228',   'Sonnen- und Wetterschutz',        20,  0],
  ['240',   'Heizungsanlagen',                  3,  2],
  ['250',   'Sanitäranlagen',                   3,  2],
  ['271',   'Gipserarbeiten / Trockenbau',      3,  2],
  ['272',   'Allgemeine Metallbauarbeiten',     0,  0],
  ['281.6', 'Keramische Wand- und Bodenbeläge', 5,  2],
  ['285.1', 'Malerarbeiten',                    5,  2],
  ['287',   'Baureinigung',                     0,  0]
];

const p = U.ausMappe(JSON.parse(fs.readFileSync(datei, 'utf8')));
const f = n => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const r2 = n => Math.round(n * 100) / 100;
const rp5 = n => Math.round(n * 20) / 20;          // Rappenrundung auf 5 Rp.

/** Runde Offertsummen, von fein nach grob — die erste, die passt, gewinnt. */
const kandidaten = roh => [rp5(roh), Math.round(roh), Math.round(roh / 5) * 5,
                           Math.round(roh / 10) * 10, Math.round(roh / 50) * 50];

/** Nur bis zur Endsumme — für die Suche nach der runden Offertsumme. */
const vorwaerts = (b, r, s) =>
  b * (1 - r / 100) * (1 - s / 100) * (1 - ALLG / 100) * (1 + MWST / 100);

/** Vorwärts — Zeile für Zeile dieselbe Folge wie condParts() in app.js. */
function rechne(brutto, r, s, a, mw) {
  const rabatt = brutto * r / 100;
  const zs1    = brutto - rabatt;
  const skonto = zs1 * s / 100;
  const netto  = zs1 - skonto;
  const allg   = netto * a / 100;
  const zs2    = netto - allg;
  const mwst   = zs2 * mw / 100;
  return { brutto, rabatt, zs1, skonto, netto, allg, zs2, mwst, total: zs2 + mwst };
}

console.log('\n=== Brutto aus der Werkvertragssumme zurückgerechnet ===\n');
console.log('  BKP      Gewerk                       Rab  Sko  Allg        Brutto            WV      Kontrolle');
console.log('  ' + '-'.repeat(101));

let gesetzt = 0, abweichungen = 0, summeBrutto = 0, summeWV = 0;
const offen = [];

for (const [bkp, name, rab, sko] of K) {
  const v = p.vergaben.find(x => (x.bkp || '') === bkp);
  if (!v) { console.log('  ' + bkp.padEnd(8) + name.padEnd(29) + '  NICHT GEFUNDEN'); continue; }

  const eing = v.eingeladene || [];
  let e = (v.firma && eing.find(x => x.firma === v.firma)) || eing[0];
  if (!e) {
    e = { id: 'eo_' + bkp.replace('.', '_'), firma: v.firma || '', email: '', status: 'offeriert', datumMail: '' };
    eing.push(e);
  }

  const faktor = (1 - rab / 100) * (1 - sko / 100) * (1 - ALLG / 100) * (1 + MWST / 100);
  const wv = Number(v.betrag) || 0;

  // Ohne Werkvertragssumme gibt es nichts zurückzurechnen — nur die
  // Konditionen festhalten, damit sie bei der Vergabe schon dastehen.
  if (!wv) {
    e.vergabe = Object.assign({}, e.vergabe, { rabatt: rab, skonto: sko, weitereAbz: ALLG, mwst: MWST });
    v.eingeladene = eing; gesetzt++;
    offen.push([bkp, name]);
    console.log('  ' + bkp.padEnd(8) + name.slice(0, 27).padEnd(29)
      + String(rab).padStart(4) + String(sko).padStart(5) + String(ALLG).padStart(6)
      + '            –             –      kein WV (Prognose)');
    continue;
  }

  /* Die rohe Division trifft die WV-Summe, sieht aber aus wie 2'999.98.
     Echte Offerten sind runde Zahlen; die WV-Summe ist auf 5 Rappen
     gerundet. Also die nächstliegende runde Summe nehmen, die — vorwärts
     gerechnet und gerundet — dieselbe WV-Summe ergibt. */
  const roh = wv / faktor;
  const brutto = kandidaten(roh).find(k => Math.abs(rp5(vorwaerts(k, rab, sko))) === rp5(wv))
              || r2(roh);
  e.vergabe = Object.assign({}, e.vergabe,
    { brutto, rabatt: rab, skonto: sko, weitereAbz: ALLG, mwst: MWST });
  v.eingeladene = eing; gesetzt++;

  const z = rechne(brutto, rab, sko, ALLG, MWST);
  const diff = rp5(z.total) - wv;      // wie condNetto(): zahlbar auf 5 Rappen
  if (Math.abs(diff) > 0.005) abweichungen++;
  summeBrutto += brutto; summeWV += wv;

  console.log('  ' + bkp.padEnd(8) + name.slice(0, 27).padEnd(29)
    + String(rab).padStart(4) + String(sko).padStart(5) + String(ALLG).padStart(6)
    + f(brutto).padStart(14) + f(wv).padStart(14)
    + (Math.abs(diff) <= 0.005 ? '      stimmt' : '      AB ' + f(diff)));
}

console.log('  ' + '-'.repeat(101));
console.log('  ' + 'Total'.padEnd(52) + f(summeBrutto).padStart(14) + f(summeWV).padStart(14));

/* ---- Eine Rechnung ganz ausgeschrieben, zur Sichtprüfung ---- */
const bsp = p.vergaben.find(x => (x.bkp || '') === '211');
if (bsp) {
  const e = (bsp.eingeladene || []).find(x => x.vergabe && x.vergabe.brutto);
  const z = rechne(e.vergabe.brutto, 2, 2, ALLG, MWST);
  console.log('\n=== 211 Baumeisterarbeiten — die Rechnung im Klartext ===\n');
  console.log('    Offerte brutto            ' + f(z.brutto).padStart(13));
  console.log('  − Rabatt 2 %                ' + ('-' + f(z.rabatt)).padStart(13));
  console.log('  = Zwischensumme             ' + f(z.zs1).padStart(13));
  console.log('  − Skonto 2 %                ' + ('-' + f(z.skonto)).padStart(13));
  console.log('  = Netto                     ' + f(z.netto).padStart(13));
  console.log('  − Allg. Abzüge 1 %          ' + ('-' + f(z.allg)).padStart(13));
  console.log('  = Zwischensumme             ' + f(z.zs2).padStart(13));
  console.log('  + MwSt 8.1 %                ' + ('+' + f(z.mwst)).padStart(13));
  console.log('  ' + '-'.repeat(41));
  console.log('  = Werkvertrag               ' + f(z.total).padStart(13)
    + '   gespeichert: ' + f(bsp.betrag));
}

console.log('\n  ' + gesetzt + ' Gewerke, ' + (abweichungen ? abweichungen + ' ABWEICHUNGEN' : 'keine Abweichung'));
if (offen.length) console.log('  Ohne WV (nur Konditionen): ' + offen.map(o => o[0]).join(', '));

if (schreiben) {
  fs.writeFileSync(datei, JSON.stringify(U.zuMappe(p), null, 1), 'utf8');
  console.log('  Geschrieben.\n');
} else {
  console.log('  Zum Übernehmen:  node test/konditionen.js schreiben\n');
}
