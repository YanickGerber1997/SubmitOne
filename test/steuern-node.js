// Steuerliche Verteilung der Schlussrechnungen.
//
// Grundlage: Merkblatt 5 der Steuerverwaltung des Kantons Bern,
// «Grundstückkosten», Natürliche Personen ab 2025.
//
// Ziffer 3 ist der ganze Kern:
//   «Im Steuerjahr, in dem die Rechnung gestellt worden ist, darf die
//    steuerpflichtige Person die abzugsfähigen Kosten geltend machen.
//    Liegt für bereits abgeschlossene und klar abgrenzbare Arbeiten eine
//    Teilrechnung mit detaillierten Angaben vor, kann der Teilrechnungs-
//    betrag geltend gemacht werden. Nicht abziehbar sind hingegen
//    Akontozahlungen.»
//
// Daraus folgen drei Regeln, die hier geprüft werden:
//   1. Akonto ist steuerlich neutral — man darf beliebig viel anzahlen.
//   2. Eine detaillierte Teilrechnung wirkt im Jahr ihrer Ausstellung.
//   3. Der Rest wirkt im Jahr der Schlussrechnung.

const fs = require('fs');
const path = require('path');
const U = require('../submit/kern/uebersetzer.js');

const rp5 = n => Math.round(n * 20) / 20;
const f = n => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function holeBlock(name, klammer) {
  const auf = klammer === '[' ? '[' : '{', zu = klammer === '[' ? ']' : '}';
  const start = app.indexOf('const ' + name + ' = ' + auf);
  if (start < 0) throw new Error(name + ' nicht in app.js gefunden');
  const von = app.indexOf(auf, start);
  let tiefe = 0, i = von;
  for (; i < app.length; i++) {
    if (app[i] === auf) tiefe++;
    else if (app[i] === zu) { tiefe--; if (!tiefe) break; }
  }
  return eval('(' + app.slice(von, i + 1) + ')');
}

const GEWERK_FAMILIEN   = holeBlock('GEWERK_FAMILIEN', '[');
const STEUER_ARTEN      = holeBlock('STEUER_ARTEN', '{');
const STEUER_VORSCHLAG  = holeBlock('STEUER_VORSCHLAG', '{');

function familieVon(v) {
  const bkp = String((v && v.bkp) || '').trim();
  if (bkp) {
    let best = null, bestLen = -1;
    for (const fam of GEWERK_FAMILIEN) for (const pre of fam.bkp) {
      if ((bkp === pre || bkp.startsWith(pre)) && pre.length > bestLen) { best = fam; bestLen = pre.length; }
    }
    if (best) return best;
  }
  const txt = ((v && v.gewerk) || '').toLowerCase();
  if (txt) for (const fam of GEWERK_FAMILIEN) if (fam.wort.some(w => txt.includes(w))) return fam;
  return null;
}

/* Yanicks Entscheid: Teilrechnungen sind bei ihm der Sache nach
   Akontozahlungen. Nur die Schlussrechnung zählt. */
const steuerWirksam = r => !!r && r.art === 'schluss';

let fehler = 0, geprueft = 0;
const ok = (bed, was) => { geprueft++; if (!bed) { fehler++; console.log('  FEHLT: ' + was); } };

/* ---- Die Arten ---- */
console.log('\n=== Steuerarten ===');
ok(STEUER_ARTEN.unterhalt.quote === 1,      'Unterhalt ist voll abziehbar');
ok(STEUER_ARTEN.energie.quote === 1,        'Energiemassnahmen sind voll abziehbar');
ok(STEUER_ARTEN.wertvermehrend.quote === 0, 'Wertvermehrendes ist nicht abziehbar');
ok(STEUER_ARTEN.offen.quote === 0,          'Unbeurteiltes zählt vorsichtshalber nicht mit');
ok(STEUER_ARTEN.anteilig.quote === null,    'Anteiliges braucht eine eigene Quote');

/* ---- Welche Rechnung zählt ---- */
console.log('\n=== Ziffer 3: welche Rechnung steuerlich wirkt ===');
ok(!steuerWirksam({ art: 'akonto' }),     'Akonto-/Teilrechnung ist NICHT abziehbar');
ok(steuerWirksam({ art: 'schluss' }),     'Schlussrechnung ist abziehbar');
ok(!steuerWirksam({ art: 'gutschrift' }), 'eine Gutschrift ist keine gestellte Rechnung');
ok(!steuerWirksam(null),                  'nichts ist nichts');

/* ---- Cosimas Fall, nachgerechnet ---- */
console.log('\n=== Cosimas Vorgabe, nachgerechnet ===');
{
  // Ein Gewerk 1:1-Ersatz, 100'000, Akonto 2026, Schlussrechnung 2027
  const rech = [{ art: 'akonto', datum: '2026-09-30', betrag: 90000 }];
  const betrag = 100000, quote = 1, zieljahr = 2027;
  const gestellt = rech.filter(steuerWirksam).reduce((a, r) => a + r.betrag, 0);
  const rest = betrag - gestellt;
  ok(gestellt === 0, 'die Akontozahlung von 90 000 wirkt steuerlich nicht');
  ok(rest === 100000, 'der volle Betrag wirkt erst mit der Schlussrechnung');
  console.log('  90 000 akonto 2026 bezahlt, Schlussrechnung 2027');
  console.log('    steuerwirksam 2026    ' + f(0));
  console.log('    steuerwirksam 2027    ' + f(rest * quote));

  // Beliebig viele Akonto-/Teilrechnungen bleiben neutral
  const rech2 = [{ art: 'akonto', datum: '2026-07-31', betrag: 40000 },
                 { art: 'akonto', datum: '2026-11-30', betrag: 50000 }];
  const gestellt2 = rech2.filter(steuerWirksam).reduce((a, r) => a + r.betrag, 0);
  ok(gestellt2 === 0, 'auch mehrere Akonto-/Teilrechnungen wirken nicht');
  ok(betrag - gestellt2 === 100000, 'der volle Betrag bleibt für die Schlussrechnung');

  // Eine Schlussrechnung im falschen Jahr zieht den Abzug vor
  const rech3 = [{ art: 'schluss', datum: '2026-12-20', betrag: 100000 }];
  ok(rech3.filter(steuerWirksam).reduce((a, r) => a + r.betrag, 0) === 100000,
     'eine Schlussrechnung im 2026 wirkt im 2026 – das gilt es zu vermeiden');
  console.log('  90 000 + 50 000 akonto 2026: steuerlich weiterhin 0.00');
  console.log('  Schlussrechnung im Dez 2026 statt 2027: der Abzug faellt ins falsche Jahr');
}

/* ---- Die Quoten ---- */
console.log('\n=== Anteilige Positionen ===');
ok(rp5(60000 * 0.5) === 30000, 'halbe Quote halbiert den Abzug');
ok(rp5(60000 * (2 / 3)) === 40000, 'zwei Drittel wie im Merkblatt 3.1.3 b');
ok(rp5(12000 * 0) === 0, 'wertvermehrend ergibt keinen Abzug');

/* ---- Die Vorschläge ---- */
console.log('\n=== Vorschläge aus dem Merkblatt ===');
const keys = new Set(GEWERK_FAMILIEN.map(x => x.key));
Object.entries(STEUER_VORSCHLAG).forEach(([k, s]) => {
  ok(keys.has(k), 'Handwerk „' + k + '" gibt es in der Farbmatrix');
  ok(!!STEUER_ARTEN[s.art], 'Art „' + s.art + '" ist gültig');
  ok(!!s.mb, 'Vorschlag ' + k + ' nennt die Ziffer des Merkblatts');
  ok(!!s.hinweis && s.hinweis.length > 15, 'Vorschlag ' + k + ' erklärt den Vorbehalt');
  if (s.art === 'anteilig') ok(s.quote != null && s.quote > 0 && s.quote < 1, 'anteiliger Vorschlag ' + k + ' hat eine Quote');
});
console.log('  ' + Object.keys(STEUER_VORSCHLAG).length + ' Handwerke mit Vorschlag und Merkblatt-Ziffer');

/* Cosima nennt die E-Positionen ausdrücklich – die müssen als Energie gelten. */
console.log('\n=== Cosimas E-Positionen ===');
[['huelle', 'Fassadendämmung'], ['fenster', 'Fenster'], ['heizung', 'Heizung/Wärmepumpe'], ['pv', 'Photovoltaik']]
  .forEach(([k, n]) => ok(STEUER_VORSCHLAG[k] && STEUER_VORSCHLAG[k].art === 'energie', n + ' ist als E-Massnahme vorgeschlagen'));

/* Und die 1:1-Positionen aus ihrer Mail */
console.log('\n=== Cosimas 1:1-Positionen ===');
[['schreiner', 'Türen und Küche'], ['spengler', 'Spengler'], ['dach', 'Dacharbeiten'], ['elektro', 'Elektro'],
 ['storen', 'Storen-Ersatz'], ['sanitaer', 'Sanitär'], ['gipser', 'Maler, Wand- und Bodenbeläge'], ['boden', 'Bodenbeläge']]
  .forEach(([k, n]) => ok(STEUER_VORSCHLAG[k] && STEUER_VORSCHLAG[k].art === 'unterhalt', n + ' ist als 1:1-Ersatz vorgeschlagen'));

/* ---- Die automatische Zuweisung ----
   Cosimas Regel in Code: E ins Folgejahr, 1:1-Ersatz füllt das Ziel
   chronologisch, Wertvermehrendes bleibt unberührt. */
console.log('\n=== Zuweisung auf die Steuerjahre ===');
/* Wortgleich mit steuerZuweisen() in app.js — beliebig viele Jahre. */
function zuweisen(positionen, { jahre, ziele }) {
  jahre = jahre.slice().sort((a, b) => a - b);
  const restJahr = jahre.find(j => !(Number(ziele[j]) > 0)) || jahre[jahre.length - 1];
  const stand = {}; jahre.forEach(j => { stand[j] = 0; });
  const platzFuer = betrag => {
    for (const j of jahre) {
      if (j === restJahr) continue;
      const ziel = Number(ziele[j]) || 0;
      if (ziel > 0 && stand[j] + betrag <= ziel + 0.05) return j;
    }
    return restJahr;
  };
  const reihe = positionen.slice().sort((a, b) =>
    String(a.bauEnde || '9999').localeCompare(String(b.bauEnde || '9999')));
  return { restJahr, stand, rows: reihe.map(x => {
    let jahr = null, grund = '';
    if (x.art === 'energie') { jahr = restJahr; grund = 'E'; }
    else if (x.art === 'wertvermehrend') { grund = 'wertvermehrend'; }
    else if (x.art === 'offen') { grund = 'offen'; }
    else { jahr = platzFuer(x.betrag); stand[jahr] = rp5(stand[jahr] + x.betrag); grund = 'fuellt ' + jahr; }
    return { ...x, jahr, grund };
  }) };
}
{
  const pos = [
    { bkp: 'A', art: 'unterhalt',      betrag: 40000, bauEnde: '2025-11-30' },
    { bkp: 'B', art: 'unterhalt',      betrag: 80000, bauEnde: '2026-06-30' },
    { bkp: 'C', art: 'energie',        betrag: 50000, bauEnde: '2026-07-31' },
    { bkp: 'D', art: 'unterhalt',      betrag: 90000, bauEnde: '2026-08-31' },
    { bkp: 'E', art: 'unterhalt',      betrag: 70000, bauEnde: '2026-09-30' },
    { bkp: 'F', art: 'wertvermehrend', betrag: 10000, bauEnde: '2026-10-31' },
    { bkp: 'G', art: 'offen',          betrag:  5000, bauEnde: '2026-11-30' }
  ];
  /* Yanicks Vorgabe: ein Teil 2025, ein Teil 2026, der Rest 2027. */
  const e = zuweisen(pos, { jahre: [2025, 2026, 2027], ziele: { 2025: 50000, 2026: 200000 } });
  const nach = k => e.rows.find(x => x.bkp === k);
  e.rows.forEach(x => console.log('  ' + x.bkp + '  ' + String(x.art).padEnd(15) + f(x.betrag).padStart(11)
    + '  -> ' + (x.jahr || '—') + '   ' + x.grund));
  console.log('  Auffangjahr ' + e.restJahr + '   Stand: '
    + Object.entries(e.stand).map(([j, w]) => j + ' ' + f(w)).join(' · '));

  ok(e.restJahr === 2027,        'das Jahr ohne Ziel wird zum Auffangjahr');
  ok(nach('A').jahr === 2025,    'die erste Position füllt 2025');
  ok(nach('B').jahr === 2026,    '80 000 passen nicht mehr in die 50 000 von 2025 – also 2026');
  ok(nach('C').jahr === 2027,    'die E-Position geht ins Auffangjahr, egal wann sie fertig wird');
  ok(nach('D').jahr === 2026,    '170 000 liegen noch unter dem Ziel 2026');
  ok(nach('E').jahr === 2027,    'die vierte sprengt beide Ziele und landet im Auffangjahr');
  ok(nach('F').jahr === null,    'Wertvermehrendes bekommt kein Steuerjahr');
  ok(nach('G').jahr === null,    'Unbeurteiltes wird nicht zugewiesen, sondern gemeldet');
  ok(e.stand[2025] === 40000 && e.stand[2026] === 170000, 'die Füllstände stimmen je Jahr');

  /* Eine kleine Position darf ein noch offenes früheres Jahr füllen —
     sonst bliebe dort Platz ungenutzt. */
  const e2 = zuweisen(pos.concat([{ bkp: 'H', art: 'unterhalt', betrag: 9000, bauEnde: '2026-12-31' }]),
                      { jahre: [2025, 2026, 2027], ziele: { 2025: 50000, 2026: 200000 } });
  ok(e2.rows.find(x => x.bkp === 'H').jahr === 2025, 'was in ein früheres Ziel passt, geht dorthin');

  /* Reihenfolge der Eingabe darf nichts ändern. */
  const e3 = zuweisen(pos.slice().reverse(), { jahre: [2025, 2026, 2027], ziele: { 2025: 50000, 2026: 200000 } });
  ok(e3.rows.find(x => x.bkp === 'A').jahr === 2025 && e3.rows.find(x => x.bkp === 'E').jahr === 2027,
     'sortiert wird nach Bauende, nicht nach Eingabe');

  /* Ohne Ziele landet alles im Auffangjahr — dem ersten ohne Ziel. */
  const e4 = zuweisen(pos, { jahre: [2025, 2026, 2027], ziele: {} });
  ok(e4.restJahr === 2025, 'ohne jedes Ziel ist das erste Jahr das Auffangjahr');
  ok(e4.rows.filter(x => x.jahr && x.jahr !== 2025).length === 0, 'dann liegt alles dort');

  /* Nur ein Jahr: keine Verteilung möglich. */
  const e5 = zuweisen(pos, { jahre: [2026], ziele: { 2026: 200000 } });
  ok(e5.restJahr === 2026, 'bei einem einzigen Jahr ist dieses das Auffangjahr');
}

/* ---- Am echten Bauvorhaben ---- */
const datei = path.join(__dirname, '..', 'privat', 'Projekte',
  'Umbau EFH Römerstrasse 31', 'Umbau EFH Römerstrasse 31.submit');
if (fs.existsSync(datei)) {
  const p = U.ausMappe(JSON.parse(fs.readFileSync(datei, 'utf8')));
  const ZIEL = 200000;

  console.log('\n=== Umbau Römerstrasse 31 – Vorschlag nach Merkblatt ===');
  console.log('  BKP      Gewerk                        Betrag        Art       abziehbar   MB');
  console.log('  ' + '-'.repeat(92));

  const kat = new Map();
  let gesamt = 0, abziehbarTotal = 0;
  (p.vergaben || []).slice().sort((a, b) => String(a.bkp).localeCompare(String(b.bkp), 'de', { numeric: true })).forEach(v => {
    const betrag = Number(v.betrag) || 0;
    if (betrag <= 0) return;
    gesamt += betrag;
    const fam = familieVon(v);
    const s = fam ? STEUER_VORSCHLAG[fam.key] : null;
    const art = s ? s.art : 'offen';
    const quote = s ? (s.quote != null ? s.quote : STEUER_ARTEN[s.art].quote) : 0;
    const abz = rp5(betrag * quote);
    abziehbarTotal += abz;
    if (!kat.has(art)) kat.set(art, { betrag: 0, abz: 0, n: 0 });
    const k = kat.get(art); k.betrag += betrag; k.abz += abz; k.n++;
    console.log('  ' + String(v.bkp || '').padEnd(9) + String(v.gewerk || '').slice(0, 26).padEnd(28)
      + f(betrag).padStart(12) + '  ' + String(STEUER_ARTEN[art].kurz).padStart(7)
      + f(abz).padStart(13) + '   ' + (s ? s.mb : '—'));
  });
  console.log('  ' + '-'.repeat(92));

  console.log('\n=== Nach Kategorie ===');
  [...kat.entries()].sort((a, b) => b[1].abz - a[1].abz).forEach(([art, k]) =>
    console.log('  ' + STEUER_ARTEN[art].label.padEnd(28) + String(k.n).padStart(3) + ' Pos.'
      + f(k.betrag).padStart(14) + '   davon abziehbar ' + f(k.abz).padStart(13)));

  const energie = kat.get('energie') || { abz: 0 };
  const einszueins = (kat.get('unterhalt') || { abz: 0 }).abz;
  console.log('\n=== Gegen Cosimas Vorgabe ===');
  console.log('  Bausumme gesamt                    ' + f(gesamt));
  console.log('  abziehbar total (Vorschlag)        ' + f(abziehbarTotal));
  console.log('');
  console.log('  Ziel 1:1-Ersatz im 2026            ' + f(ZIEL));
  console.log('  vorgeschlagen als 1:1-Ersatz       ' + f(einszueins));
  console.log('  Differenz                          ' + f(einszueins - ZIEL)
    + (einszueins >= ZIEL ? '   reicht' : '   zu wenig'));
  console.log('');
  console.log('  E-Massnahmen, gehören ins 2027     ' + f(energie.abz));

  ok(gesamt > 0, 'das Projekt hat Beträge');
  ok(abziehbarTotal <= gesamt, 'der Abzug kann die Bausumme nicht übersteigen');
}

console.log('\n  ' + (geprueft - fehler) + '/' + geprueft + ' geprüft'
  + (fehler ? '   ' + fehler + ' FEHLER' : '   alles grün') + '\n');
process.exit(fehler ? 1 : 0);
