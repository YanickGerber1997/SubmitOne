// Prüft Strg+P — druckt es überall das Richtige?
//
// Vorher wirkte die Taste nur im Terminprogramm. Überall sonst druckte
// der Browser die Bildschirmseite: Seitenleiste, Knöpfe, Formularfelder.
// Das ist nie gemeint, und man merkt es erst am Papier.
//
// Geprüft wird zweierlei: dass jede Zuordnung auf eine Funktion zeigt,
// die es wirklich gibt (ein Tippfehler zeigt sich sonst erst beim
// Drücken), und dass die Ansichten, die ein Blatt haben, auch eines
// bekommen.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const wurzel = path.join(__dirname, '..');
const quelle = fs.readFileSync(path.join(wurzel, 'app.js'), 'utf8');
const zeitApp = fs.readFileSync(path.join(wurzel, 'submit', 'zeit', 'app.js'), 'utf8');

let fehler = 0, geprueft = 0;
const ok = (bed, was) => { geprueft++; if (!bed) { fehler++; console.log('  FEHLT: ' + was); } };

console.log('\n=== Die Taste ist gebunden ===');
ok(/function druckKeydown/.test(quelle), 'es gibt einen Griff für Strg+P');
ok(/document\.addEventListener\('keydown', druckKeydown\)/.test(quelle), 'und er hängt am Dokument');
ok(/e\.preventDefault\(\)/.test(quelle.slice(quelle.indexOf('function druckKeydown'))),
   'der Browserdialog wird abgefangen');
ok(/\(input\|textarea\)/i.test(quelle.slice(quelle.indexOf('function druckKeydown'), quelle.indexOf('function druckKeydown') + 900)),
   'in einem Textfeld bleibt die Taste dem Feld');

console.log('\n=== Jede Zuordnung zeigt auf eine Funktion, die es gibt ===');
const block = quelle.slice(quelle.indexOf('const proAnsicht = {'));
const bis = block.indexOf('};');
const zuordnungen = [...block.slice(0, bis).matchAll(/'([^']+)':\s*\(\)\s*=>\s*([A-Za-z_$][\w$]*)\(/g)]
  .map(m => ({ ansicht: m[1], funktion: m[2] }));

ok(zuordnungen.length >= 8, 'es sind mehrere Ansichten zugeordnet (' + zuordnungen.length + ')');
zuordnungen.forEach(z => {
  const da = new RegExp('function ' + z.funktion + '\\s*\\(').test(quelle);
  console.log('  ' + z.ansicht.padEnd(22) + '→ ' + z.funktion + (da ? '' : '   GIBT ES NICHT'));
  ok(da, z.ansicht + ' ruft ' + z.funktion + '(), das es gibt');
});

/* Und die Zahl der Parameter muss passen: pdfHonorar() rechnet mit
   `honorarPid` und nimmt keine Kennung — ein übergebenes Argument wäre
   stillschweigend wirkungslos. */
console.log('\n=== Die Aufrufe passen zur Bauart ===');
zuordnungen.forEach(z => {
  const def = quelle.match(new RegExp('function ' + z.funktion + '\\s*\\(([^)]*)\\)'));
  if (!def) return;
  const nimmt = def[1].trim().length > 0;
  const gibt = new RegExp(z.funktion + '\\((?!\\s*\\))').test(
    block.slice(0, bis).match(new RegExp("'" + z.ansicht.replace(/\//g, '\\/') + "'[^\\n]*"))[0]);
  ok(nimmt === gibt || !nimmt,
     z.funktion + ': ' + (nimmt ? 'braucht eine Kennung und bekommt sie' : 'braucht keine und bekommt keine'));
});

console.log('\n=== Ohne Blatt sagt es das, statt eines zu erfinden ===');
const fn = quelle.slice(quelle.indexOf('function druckAnsicht'));
ok(/typeof machen !== 'function'/.test(fn), 'eine unbekannte Ansicht wird erkannt');
ok(/toast\(/.test(fn.slice(0, fn.indexOf('return false'))), 'und gemeldet');
ok(/catch \(e\)/.test(fn), 'ein Fehler beim Erzeugen wirft die Seite nicht um');

console.log('\n=== Das Terminprogramm behält seinen Vorrang ===');
const tk = quelle.slice(quelle.indexOf('function druckKeydown'));
ok(tk.indexOf("querySelector('.gantt')") >= 0 && tk.indexOf("querySelector('.gantt')") < tk.indexOf('druckAnsicht'),
   'was offen ist, zählt vor dem Pfad in der Adresszeile');

console.log('\n=== Auch die Stunden haben jetzt ein Blatt ===');
ok(/function pdfStunden/.test(quelle), 'pdfStunden() gibt es');
const st = quelle.slice(quelle.indexOf('function pdfStunden'), quelle.indexOf('function viewStunden'));
ok(/openPrintDoc\('Stundenrapport'/.test(st), 'es heisst Stundenrapport');
ok(/keine Rechnung/.test(st), 'und sagt, dass es keine Rechnung ist');
ok(!/preis|ansatz|chf/i.test(st.replace(/\/\*[\s\S]*?\*\//g, '')), 'kein Preis, kein Ansatz, kein Betrag');
ok(/toast\('In dieser Woche ist nichts erfasst'/.test(st), 'eine leere Woche wird nicht gedruckt');

console.log('\n=== In SubZeit ebenso ===');
ok(/key\.toLowerCase\(\) === 'p'/.test(zeitApp), 'SubZeit kennt Strg+P');
const zp = zeitApp.slice(zeitApp.indexOf("key.toLowerCase() === 'p'"));
ok(/zustand\.seite !== 'rapport'/.test(zp.slice(0, 400)), 'von anderen Seiten wechselt es zum Rapport');
ok(/window\.print\(\)/.test(zp.slice(0, 500)), 'und druckt dann');
ok(/!imFeld/.test(zp.slice(0, 200)), 'im Textfeld bleibt die Taste dem Feld');

console.log('\n=== Und app.js bleibt lesbar ===');
let lesbar = true;
try { new vm.Script(quelle, { filename: 'app.js' }); } catch (e) { lesbar = false; console.log('  ' + e.message); }
ok(lesbar, 'app.js lässt sich laden');
let zLesbar = true;
try { new vm.Script(zeitApp, { filename: 'zeit/app.js' }); } catch (e) { zLesbar = false; console.log('  ' + e.message); }
ok(zLesbar, 'submit/zeit/app.js lässt sich laden');

console.log('\n  ' + (geprueft - fehler) + '/' + geprueft + ' geprüft'
  + (fehler ? '   ' + fehler + ' FEHLER' : '   alles grün') + '\n');
process.exit(fehler ? 1 : 0);
