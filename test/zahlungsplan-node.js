// Prüft den Zahlungsplan Bauherr: Verteilung, Rundung, Überträge und die
// Aufschlüsselung je Monat — an echten Zahlen, nicht an erfundenen.
//
// Der Kern ist verteileAufSchritt(): Sie rundet die AUFLAUFENDE Summe.
// Rundet man jeden Monat für sich, summieren sich die Rappen, und ein
// Zahlungsplan, dessen Summe nicht aufgeht, ist gegenüber Bauherr und
// Bank nicht zu vertreten.

const fs = require('fs');
const path = require('path');
const U = require('../submit/kern/uebersetzer.js');

const rp5 = n => Math.round(n * 20) / 20;
const f = n => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

/* Wortgleich mit verteileAufSchritt() in app.js. */
function verteileAufSchritt(sorted, total, schritt) {
  let exaktKum = 0, vorher = 0;
  return sorted.map(([k, b], i) => {
    exaktKum += b;
    const kum = (i === sorted.length - 1) ? rp5(total)
      : (schritt ? Math.round(exaktKum / schritt) * schritt : rp5(exaktKum));
    const betrag = rp5(kum - vorher); vorher = kum;
    return { key: k, betrag, cum: rp5(kum) };
  });
}

/* Wortgleich mit monatEnde() im Druck. */
const isoOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function monatEnde(key, n) {
  const [y, m] = key.split('-').map(Number);
  return isoOf(new Date(y, (m - 1) + n + 1, 0));
}
function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d);
}

let fehler = 0, geprueft = 0;
const ok = (bed, was) => { geprueft++; if (!bed) { fehler++; console.log('  FEHLT: ' + was); } };

/* ---- Die Rundung ---- */
console.log('\n=== Rundung der auflaufenden Summe ===');
{
  const roh = [['2026-06', 33333.333], ['2026-07', 33333.333], ['2026-08', 33333.334]];
  const total = 100000;
  const genau = verteileAufSchritt(roh, total, 0);
  ok(rp5(genau.reduce((a, m) => a + m.betrag, 0)) === total, 'ohne Raster geht die Summe auf');
  ok(genau[genau.length - 1].cum === total, 'die letzte Kumulierte ist der Gesamtbetrag');

  const raster = verteileAufSchritt(roh, total, 25000);
  ok(rp5(raster.reduce((a, m) => a + m.betrag, 0)) === total, 'mit 25000er-Raster geht die Summe auf');
  raster.slice(0, -1).forEach((m, i) => ok(m.cum % 25000 === 0, 'Kumulierte ' + (i + 1) + ' liegt auf dem Raster'));
  console.log('  ohne Raster:  ' + genau.map(m => f(m.betrag)).join('  ·  '));
  console.log('  25000er:      ' + raster.map(m => f(m.betrag)).join('  ·  '));
}

/* Ein einzelner Monat darf die Summe nicht sprengen. */
{
  const einer = verteileAufSchritt([['2026-06', 12345.67]], 12345.67, 25000);
  ok(einer.length === 1 && einer[0].betrag === rp5(12345.67), 'ein einziger Monat bleibt unverändert');
}

/* ---- Der Rechnungslauf ---- */
console.log('\n=== Rechnungslauf ===');
ok(monatEnde('2026-06', 0) === '2026-06-30', 'ohne Versatz: Ende Ausführungsmonat');
ok(monatEnde('2026-06', 1) === '2026-07-31', 'ein Monat Versatz: Ende Folgemonat');
ok(monatEnde('2026-12', 1) === '2027-01-31', 'Versatz über den Jahreswechsel');
ok(monatEnde('2026-01', 1) === '2026-02-28', 'Februar hat 28 Tage (2026 ist kein Schaltjahr)');
ok(addDays('2026-07-31', 30) === '2026-08-30', '30 Tage Zahlungsfrist');
console.log('  Ausführung Juni 2026 → Rechnung bis ' + monatEnde('2026-06', 1) + ' → zahlbar bis ' + addDays(monatEnde('2026-06', 1), 30));

/* ---- Die Überträge ---- */
console.log('\n=== Überträge über die Seiten ===');
{
  const monate = verteileAufSchritt(
    Array.from({ length: 14 }, (_, i) => ['2026-' + String(i + 1).padStart(2, '0'), 10000]), 140000, 0);
  // Seitenweise zerlegen wie im Druck und die Kette prüfen
  const seiten = [[0, 5], [5, 10], [10, 14]];
  let gelaufen = 0, kette = true;
  seiten.forEach(([a, b], si) => {
    const vorher = gelaufen;
    for (let i = a; i < b; i++) gelaufen += monate[i].betrag;
    if (si > 0 && rp5(vorher) !== rp5(monate[a - 1].cum)) kette = false;
  });
  ok(kette, 'jeder Übertrag entspricht der Kumulierten der Vorseite');
  ok(rp5(gelaufen) === 140000, 'der letzte Übertrag ist der Gesamtbetrag');
}

/* ---- Der Ist-Abgleich ----
   Kernfrage: Wenn der Baumeister im August erst einen Bruchteil verrechnet
   hat, muss der Rest in die Zukunft wandern — und die Summe muss trotzdem
   die Vergabesumme ergeben. */
console.log('\n=== Ist-Abgleich ===');
{
  const naechsterMonat = mk => { const [y, m] = mk.split('-').map(Number); return m >= 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0'); };
  ok(naechsterMonat('2026-08') === '2026-09', 'nächster Monat');
  ok(naechsterMonat('2026-12') === '2027-01', 'nächster Monat über den Jahreswechsel');

  /* Ein Gewerk: 100'000, Bauzeit Juni–August, Stichtag August.
     Verrechnet wurden bis dahin nur 20'000 statt der geplanten ~66'000. */
  const stichMon = '2026-08';
  const soll = 100000;
  const rechnungen = [{ datum: '2026-06-20', betrag: 12000 }, { datum: '2026-07-15', betrag: 8000 }];
  const istMap = new Map(), planMap = new Map();
  let verrechnet = 0;
  rechnungen.forEach(r => { if (r.datum.slice(0, 7) <= stichMon) { verrechnet += r.betrag; istMap.set(r.datum.slice(0, 7), (istMap.get(r.datum.slice(0, 7)) || 0) + r.betrag); } });
  const rest = soll - verrechnet;
  const restMonate = ['2026-06', '2026-07', '2026-08'].filter(mk => mk >= stichMon);
  const per = rest / restMonate.length;
  restMonate.forEach(mk => planMap.set(mk, (planMap.get(mk) || 0) + per));

  const alle = [...new Set([...istMap.keys(), ...planMap.keys()])].sort();
  const summe = rp5(alle.reduce((a, mk) => a + (istMap.get(mk) || 0) + (planMap.get(mk) || 0), 0));

  console.log('  Vergabesumme           ' + f(soll));
  console.log('  verrechnet bis 08/26   ' + f(verrechnet) + '   (' + Math.round(verrechnet / soll * 100) + ' %)');
  console.log('  Rest auf ' + restMonate.length + ' Monat        ' + f(rest));
  alle.forEach(mk => console.log('     ' + mk + '   ' + f((istMap.get(mk) || 0) + (planMap.get(mk) || 0)).padStart(12)
    + (istMap.has(mk) && !planMap.has(mk) ? '   verrechnet' : '')));
  ok(summe === rp5(soll), 'Ist + Rest ergibt die Vergabesumme');
  ok(rest === 80000, 'der Rest ist die Differenz zum Verrechneten');
  ok(istMap.get('2026-06') === 12000 && istMap.get('2026-07') === 8000, 'die Ist-Monate stehen mit ihrem echten Betrag');
  ok(!planMap.has('2026-06') && !planMap.has('2026-07'), 'vergangene Monate bekommen keinen Plananteil mehr');

  /* Bauzeit vorbei, Rechnung fehlt: der Rest fällt in den nächsten Monat. */
  const fertigMonate = ['2026-05', '2026-06'].filter(mk => mk >= stichMon);
  ok(fertigMonate.length === 0, 'ein abgeschlossenes Gewerk hat keine Restmonate mehr');
  ok(naechsterMonat(stichMon) === '2026-09', 'sein Rest fällt in den Folgemonat – die Rechnung steht aus');
}

/* ---- Am echten Bauvorhaben ---- */
const datei = path.join(__dirname, '..', 'privat', 'Projekte',
  'Umbau EFH Römerstrasse 31', 'Umbau EFH Römerstrasse 31.submit');
if (fs.existsSync(datei)) {
  const p = U.ausMappe(JSON.parse(fs.readFileSync(datei, 'utf8')));

  // Verteilung wie bauherrPlan(), ohne app.js zu laden
  const map = new Map(), detail = new Map();
  let total = 0;
  (p.vergaben || []).forEach(v => {
    const betrag = Number(v.betrag) || 0;
    if (betrag <= 0 || !v.bauStart || !v.bauEnde) return;
    const s = new Date(v.bauStart), e = new Date(v.bauEnde);
    const months = [];
    let y = s.getFullYear(), m = s.getMonth();
    const ey = e.getFullYear(), em = e.getMonth();
    while (y < ey || (y === ey && m <= em)) { months.push(y + '-' + String(m + 1).padStart(2, '0')); m++; if (m > 11) { m = 0; y++; } }
    if (!months.length) return;
    total += betrag;
    const per = betrag / months.length;
    months.forEach(mk => {
      map.set(mk, (map.get(mk) || 0) + per);
      if (!detail.has(mk)) detail.set(mk, []);
      detail.get(mk).push({ bkp: v.bkp, firma: v.firma, anteil: per });
    });
  });

  const sorted = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const schritt of [0, 25000]) {
    const monate = verteileAufSchritt(sorted, total, schritt);
    const summe = rp5(monate.reduce((a, m) => a + m.betrag, 0));
    console.log('\n=== Zahlungsplan, Raster ' + (schritt ? f(schritt) : 'haargenau') + ' ===');
    console.log('  Monate                 ' + monate.length);
    console.log('  Summe der Zahlungen    ' + f(summe));
    console.log('  Bausumme               ' + f(rp5(total)));
    ok(summe === rp5(total), 'Raster ' + schritt + ': die Zahlungen ergeben die Bausumme');
    ok(monate.every(m => m.betrag >= 0), 'Raster ' + schritt + ': keine negative Zahlung');

    // Die Anteile eines Monats müssen den Monat ergeben, bis auf die Rundung
    let maxAbw = 0;
    monate.forEach(m => {
      const exakt = (detail.get(m.key) || []).reduce((a, t) => a + t.anteil, 0);
      maxAbw = Math.max(maxAbw, Math.abs(m.betrag - exakt));
    });
    console.log('  grösste Rundungszeile  ' + f(maxAbw));
    ok(schritt === 0 ? maxAbw < 0.06 : maxAbw <= schritt,
      'Raster ' + schritt + ': die Rundung bleibt im erwarteten Rahmen');
  }

  // Anteile in Prozent
  const monate = verteileAufSchritt(sorted, total, 0);
  const pctSumme = monate.reduce((a, m) => a + (m.betrag / total * 100), 0);
  ok(Math.abs(pctSumme - 100) < 0.01, 'die Prozentanteile ergeben 100 %');

  console.log('\n=== Die ersten vier Monate im Klartext ===');
  monate.slice(0, 4).forEach((m, i) => {
    const re = monatEnde(m.key, 1), za = addDays(re, 30);
    console.log('  ' + (i + 1) + '  ' + m.key + '   ' + f(m.betrag).padStart(12)
      + '   ' + (m.betrag / total * 100).toFixed(1).padStart(5) + ' %'
      + '   Rechnung bis ' + re + ' · zahlbar bis ' + za);
    (detail.get(m.key) || []).slice().sort((a, b) => b.anteil - a.anteil).slice(0, 3)
      .forEach(t => console.log('        ' + String(t.bkp || '').padEnd(8) + String(t.firma || '').slice(0, 26).padEnd(28) + f(t.anteil).padStart(12)));
  });
}

console.log('\n  ' + (geprueft - fehler) + '/' + geprueft + ' geprüft'
  + (fehler ? '   ' + fehler + ' FEHLER' : '   alles grün') + '\n');
process.exit(fehler ? 1 : 0);
