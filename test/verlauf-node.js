// Prüft die Verlaufskurven — VERLAEUFE in app.js.
//
// Noch nicht in Betrieb: Die Pläne rechnen weiterhin gleichmässig.
// Geprüft wird trotzdem, und zwar jetzt — damit an dem Tag, an dem der
// Verlauf eingeschaltet wird, die Rechnung nicht erst noch bewiesen
// werden muss.
//
// Der Massstab kommt aus der Praxis: «Der Baumeister ist im ersten Monat
// bei zwanzig Prozent und im zweiten bei sechzig.» Über drei Monate muss
// die Glockenkurve genau das ergeben.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const wurzel = path.join(__dirname, '..');
let fehler = 0, geprueft = 0;
const ok = (bed, was) => { geprueft++; if (!bed) { fehler++; console.log('  FEHLT: ' + was); } };

/* Nur die Kurven herauslösen — sie brauchen keine Attrappe. */
const quelle = fs.readFileSync(path.join(wurzel, 'app.js'), 'utf8');
const teil = quelle.slice(quelle.indexOf('const VERLAEUFE = {'),
                          quelle.indexOf('/** Auf welche Monate eine Position fällt'));
const ctx = { Math, console };
vm.createContext(ctx);
vm.runInContext(teil, ctx);
const G = (n, art) => vm.runInContext('verlaufGewichte', ctx)(n, art);
const V = (b, m, art, ab) => vm.runInContext('verlaufVerteilen', ctx)(b, m, art, ab);
const proz = g => g.map(x => Math.round(x * 1000) / 10);

console.log('\n=== Die Kurven stehen bereit ===');
const arten = Object.keys(vm.runInContext('VERLAEUFE', ctx));
console.log('  ' + arten.join(', '));
['gleich', 'glocke', 'vorne', 'hinten'].forEach(a => ok(arten.indexOf(a) >= 0, 'der Verlauf «' + a + '»'));

console.log('\n=== Der Massstab aus der Praxis: 20 / 60 / 20 ===');
const drei = proz(G(3, 'glocke'));
console.log('  Glocke über 3 Monate:  ' + drei.join(' / ') + ' %');
ok(Math.abs(drei[0] - 19.9) < 0.6, 'der erste Monat liegt bei rund 20 %');
ok(Math.abs(drei[1] - 60.3) < 0.6, 'der zweite bei rund 60 %');
ok(drei[0] === drei[2], 'Anlauf und Auslauf sind gleich');

console.log('\n=== Jede Kurve über 4 Monate ===');
['gleich', 'glocke', 'vorne', 'hinten'].forEach(a => {
  const g = proz(G(4, a));
  console.log('  ' + a.padEnd(8) + g.map(x => String(x).padStart(5)).join(' / ') + ' %');
});

console.log('\n=== Die Summe bleibt immer dieselbe ===');
[1, 2, 3, 5, 8, 14].forEach(n => {
  ['gleich', 'glocke', 'vorne', 'hinten'].forEach(a => {
    const s = G(n, a).reduce((x, y) => x + y, 0);
    ok(Math.abs(s - 1) < 1e-9, n + ' Monate, ' + a + ': die Gewichte ergeben 1 (' + s + ')');
  });
});

console.log('\n=== Kein Monat bekommt einen negativen Betrag ===');
[2, 3, 6, 12].forEach(n => ['gleich', 'glocke', 'vorne', 'hinten'].forEach(a =>
  ok(G(n, a).every(x => x >= 0), n + ' Monate, ' + a + ': alle Gewichte sind positiv')));

console.log('\n=== Die Richtung stimmt ===');
const v4 = G(4, 'vorne'), h4 = G(4, 'hinten'), gl4 = G(4, 'glocke');
ok(v4[0] > v4[3], '«vorne» beginnt schwer und endet leicht');
ok(h4[0] < h4[3], '«hinten» beginnt leicht und endet schwer');
ok(gl4[1] > gl4[0] && gl4[2] > gl4[3], '«Glocke» ist in der Mitte am höchsten');
ok(G(5, 'gleich').every(x => Math.abs(x - 0.2) < 1e-9), '«gleichmässig» teilt gleich');

console.log('\n=== Verteilen: die Summe kommt vollständig an ===');
const monate = ['2026-01', '2026-02', '2026-03', '2026-04'];
['gleich', 'glocke', 'vorne', 'hinten'].forEach(a => {
  const t = V(120000, monate, a);
  const s = t.reduce((x, y) => x + y.betrag, 0);
  console.log('  ' + a.padEnd(8) + t.map(x => Math.round(x.betrag)).join(' / '));
  ok(Math.abs(s - 120000) < 0.005, a + ': die 120\'000 kommen vollständig an');
  ok(t.length === monate.length, a + ': jeder Monat bekommt einen Anteil');
});

/* Der «Stand heute» plant nur noch, was vor ihm liegt — die Form muss
   dabei erhalten bleiben, und der Restbetrag vollständig ankommen. */
console.log('\n=== Ab einem Stichtag bleibt die Form und die Summe ===');
['gleich', 'glocke', 'vorne', 'hinten'].forEach(a => {
  const t = V(60000, monate, a, '2026-03');
  const s = t.reduce((x, y) => x + y.betrag, 0);
  console.log('  ' + a.padEnd(8) + 'ab März: ' + t.map(x => x.mk + ' ' + Math.round(x.betrag)).join('  '));
  ok(t.length === 2, a + ': nur die beiden verbleibenden Monate');
  ok(Math.abs(s - 60000) < 0.005, a + ': der Restbetrag kommt vollständig an');
});
/* Bei «hinten» muss der letzte Monat auch nach dem Zuschnitt der grössere
   sein — sonst wäre die Form beim Neuverteilen verlorengegangen. */
const rest = V(60000, monate, 'hinten', '2026-03');
ok(rest[1].betrag > rest[0].betrag, 'die Form überlebt den Zuschnitt');

console.log('\n=== Randfälle ===');
ok(G(0, 'glocke').length === 0, 'null Monate ergeben keine Gewichte');
ok(G(1, 'glocke').length === 1 && Math.abs(G(1, 'glocke')[0] - 1) < 1e-9, 'ein Monat bekommt alles');
ok(V(1000, [], 'glocke').length === 0, 'ohne Monate wird nichts verteilt');
ok(V(1000, monate, 'gibtsnicht').length === 4, 'ein unbekannter Verlauf fällt auf gleichmässig zurück');
ok(V(1000, monate, 'glocke', '2099-01').length === 0, 'ein Stichtag nach allen Monaten ergibt nichts');

console.log('\n=== Und es ist noch nicht eingeschaltet ===');
/* Solange das gilt, ändert sich an den bestehenden Plänen nichts. */
const plaene = quelle.slice(quelle.indexOf('function bauherrPlan('));
ok(!/verlaufVerteilen\(/.test(plaene), 'die Pläne rechnen weiterhin gleichmässig');
ok(/Yanicks Entscheid vom 14\.08\.2026: bereitstellen, aber nicht anwenden/.test(quelle),
   'und der Grund steht dabei');

console.log('\n  ' + (geprueft - fehler) + '/' + geprueft + ' geprüft'
  + (fehler ? '   ' + fehler + ' FEHLER' : '   alles grün') + '\n');
process.exit(fehler ? 1 : 0);
