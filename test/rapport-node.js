// Prüft den Stundenrapport in SubZeit.
//
// Er beantwortet zwei verschiedene Fragen an dieselben Einträge:
//   «Wie lange habe ich an dieser Sache gearbeitet?»
//   «Was habe ich in den letzten zwei Wochen geleistet?»
// Keine davon ist eine Rechnung.
//
// Geprüft wird die Bündelung — dort entscheidet sich, ob das Blatt
// lesbar wird —, dass jeder Aufruf ankommt, und dass gedruckt nur das
// Blatt erscheint und nicht die Regler.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const zeit = p => path.join(__dirname, '..', 'submit', 'zeit', p);
const quelle = fs.readFileSync(zeit('app.js'), 'utf8');
const css = fs.readFileSync(zeit('stil.css'), 'utf8');

let fehler = 0, geprueft = 0;
const ok = (bed, was) => { geprueft++; if (!bed) { fehler++; console.log('  FEHLT: ' + was); } };

console.log('\n=== Die Seite ist eingehängt ===');
ok(/\['rapport', 'Rapport'/.test(quelle), 'sie steht in der Seitenleiste');
ok(/case 'rapport':\s*return seiteRapport\(\)/.test(quelle), 'und wird aufgerufen');
['seiteRapport', 'rapportStand', 'rapportZeilen', 'rapportGruppen', 'rapportCsv']
  .forEach(n => ok(new RegExp('function ' + n + '\\b').test(quelle), n + '()'));

console.log('\n=== Jeder Aufruf trifft etwas ===');
function bietet(datei) {
  const t = fs.readFileSync(datei, 'utf8');
  const namen = new Set();
  [...t.matchAll(/function\s+([A-Za-zÄÖÜäöü_$][\w$]*)\s*\(/g)].forEach(m => namen.add(m[1]));
  [...t.matchAll(/^\s{0,12}([A-Za-z_$][\w$]*)\s*[:(,]/gm)].forEach(m => namen.add(m[1]));
  [...t.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].forEach(m => namen.add(m[1]));
  return namen;
}
const kern = path.join(__dirname, '..', 'submit', 'kern', 'kern.js');
const module_ = { Fach: bietet(zeit('fach.js')), Hilf: bietet(kern), Ui: bietet(kern) };

/* Nur den Rapport-Teil ansehen — der Rest von app.js ist hier nicht der
   Gegenstand. */
const von = quelle.indexOf('function rapportStand');
const bis = quelle.indexOf('function seiteAuswertung');
const teil = quelle.slice(von, bis);
ok(von > 0 && bis > von, 'der Rapport-Abschnitt liess sich herauslösen');

Object.keys(module_).forEach(mod => {
  const gerufen = [...new Set([...teil.matchAll(new RegExp('\\b' + mod + '\\.([A-Za-z_$][\\w$]*)', 'g'))].map(m => m[1]))].sort();
  const fehlend = gerufen.filter(n => !module_[mod].has(n));
  console.log('  ' + mod + ': ' + gerufen.length + ' Namen' + (fehlend.length ? '   NICHT GEFUNDEN: ' + fehlend.join(', ') : '   alle vorhanden'));
  ok(fehlend.length === 0, mod + ' — ' + fehlend.join(', '));
});

/* =====================================================================
   Die Bündelung
   ---------------------------------------------------------------------
   Sie wird mit Attrappen für Fach und Hilf ausgeführt: Die Funktion ist
   rein, sie ordnet nur — genau das lässt sich nachrechnen.
   ===================================================================== */

console.log('\n=== Die Bündelung ordnet richtig ===');
const quellText = teil.match(/function rapportGruppen[\s\S]*?\n    \}/);
ok(!!quellText, 'rapportGruppen liess sich herauslösen');

const ctx = {
  Map, Set, console,
  Fach: {
    dauerVon: e => e.dauer,
    projektName: id => ({ p1: 'Römerstrasse', p2: 'Kunoweg' })[id] || id,
    projektFarbe: () => '#7132e3',
    taetigkeit: id => id ? { name: ({ t1: 'Bauleitung', t2: 'Zahlungsplan' })[id] || id } : null
  },
  Hilf: { tagLang: d => 'Tag', datum: d => d }
};
vm.createContext(ctx);
vm.runInContext(quellText[0].replace(/^\s*function/, 'function'), ctx);

const e = (datum, dauer, projektId, taetigkeitId) => ({ datum, dauer, projektId, taetigkeitId });
const zeilen = [
  e('2026-08-10', 120, 'p1', 't1'),
  e('2026-08-10', 60,  'p2', 't2'),
  e('2026-08-11', 240, 'p1', 't2'),
  e('2026-08-12', 30,  'p1', 't1'),
  e('2026-08-12', 90,  null, null)
];

const zeig = (g, wie) => {
  console.log('  ' + wie);
  g.forEach(x => console.log('    ' + String(x.titel).padEnd(22) + (x.minuten / 60).toFixed(2).padStart(6) + ' h   ' + x.zeilen.length + ' Einträge'));
  return g;
};

let g = zeig(vm.runInContext('rapportGruppen', ctx)(zeilen, 'tag'), 'nach Tag');
ok(g.length === 3, 'drei Tage');
ok(g[0].minuten === 180 && g[1].minuten === 240 && g[2].minuten === 120, 'die Summen je Tag stimmen');
/* Nach Tag MUSS chronologisch bleiben — ein Rapport, der mit dem
   längsten Tag beginnt, liest sich nicht als Verlauf. */
ok(g[0].zeilen[0].datum === '2026-08-10' && g[2].zeilen[0].datum === '2026-08-12',
   'nach Tag bleibt es chronologisch, nicht nach Grösse sortiert');

g = zeig(vm.runInContext('rapportGruppen', ctx)(zeilen, 'projekt'), 'nach Projekt');
ok(g.length === 3, 'zwei Projekte und «ohne»');
ok(g[0].titel === 'Römerstrasse' && g[0].minuten === 390, 'das grösste Projekt steht zuoberst');
ok(g[g.length - 1].minuten === 60, 'das kleinste zuunterst');
ok(g.some(x => x.titel === 'Ohne Projekt'), 'was keinem Projekt gehört, fällt nicht weg');

g = zeig(vm.runInContext('rapportGruppen', ctx)(zeilen, 'taetigkeit'), 'nach Tätigkeit');
ok(g.length === 3, 'zwei Tätigkeiten und «ohne»');
ok(g[0].minuten === 300, 'die grösste Tätigkeit zuoberst');

const summe = zeilen.reduce((a, x) => a + x.dauer, 0);
['tag', 'projekt', 'taetigkeit'].forEach(art => {
  const s = vm.runInContext('rapportGruppen', ctx)(zeilen, art).reduce((a, x) => a + x.minuten, 0);
  ok(s === summe, 'bei «' + art + '» geht keine Minute verloren (' + s + ' von ' + summe + ')');
});

console.log('\n=== Gedruckt erscheint nur das Blatt ===');
ok(/@media print/.test(css), 'es gibt Druckregeln');
const druck = css.slice(css.indexOf('@media print'));
['seitenleiste', 'rp-steuer', 'seitenkopf'].forEach(k =>
  ok(new RegExp('\\.' + k + '\\b').test(druck), '.' + k + ' wird im Druck ausgeblendet'));
ok(/@page/.test(druck), 'das Papierformat ist gesetzt');

console.log('\n=== Und es ist keine Rechnung ===');
ok(/keine Rechnung/.test(quelle), 'das Blatt sagt es selbst');
ok(!/preis|ansatz|betrag|chf/i.test(teil.replace(/\/\*[\s\S]*?\*\//g, '')),
   'im Rapport steht kein Preis und kein Betrag');

console.log('\n  ' + (geprueft - fehler) + '/' + geprueft + ' geprüft'
  + (fehler ? '   ' + fehler + ' FEHLER' : '   alles grün') + '\n');
process.exit(fehler ? 1 : 0);
