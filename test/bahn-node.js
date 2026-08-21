// Prüft die umgebaute Zeitbahn — submit/zeit/bahn.js.
//
// Seit dem 14.08.2026 zeichnet SubZeit nicht mehr selbst, sondern reicht
// an submit/kern/wochenraster.js weiter. Beim Umbau ist die Gefahr nicht
// die Rechnung — die steht im Raster und ist geprüft —, sondern ein
// Aufruf ins Leere: `Fach.projektFarbe` statt `Fach.farbeVon`, und die
// Seite bleibt weiss, ohne dass ein Test etwas merkt.
//
// Deshalb wird hier nachgeschlagen: Jeder Name, den bahn.js an Fach, Hilf,
// Ui oder App richtet, muss dort auch stehen.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fehler = 0, geprueft = 0;
const ok = (bed, was) => { geprueft++; if (!bed) { fehler++; console.log('  FEHLT: ' + was); } };

const zeit = p => path.join(__dirname, '..', 'submit', 'zeit', p);
const quelle = fs.readFileSync(zeit('bahn.js'), 'utf8');

console.log('\n=== Die Datei ist lesbar ===');
let syntaxOk = true;
try { new vm.Script(quelle, { filename: 'bahn.js' }); }
catch (e) { syntaxOk = false; console.log('  ' + e.message); }
ok(syntaxOk, 'bahn.js lässt sich lesen');

console.log('\n=== Sie zeichnet nicht mehr selbst ===');
ok(/wochenraster/.test(quelle), 'sie reicht an das gemeinsame Raster weiter');
ok(!/getBoundingClientRect/.test(quelle), 'keine eigene Geometrie mehr');
ok(!/addEventListener/.test(quelle), 'keine eigene Zieh-Mechanik mehr');
ok(!/NACHT_MASS|function gewicht/.test(quelle), 'keine eigene Achse mehr');
/* Die Zahl selbst ist nicht der Punkt — dass die Datei ein dünner
   Aufsatz bleibt, schon. Wächst sie wieder Richtung 502, ist Logik
   zurückgewandert, die ins gemeinsame Raster gehört. */
const zeilen = quelle.split('\n').length;
const VORHER = 502;
console.log('  bahn.js: ' + zeilen + ' Zeilen  (vorher ' + VORHER + ', '
  + Math.round((1 - zeilen / VORHER) * 100) + ' % weniger)');
ok(zeilen < VORHER * 0.7, 'und ist dabei um mindestens ein Drittel kürzer');

/* -------------------------------------------------------------------
   Jeder Aufruf muss ankommen
   ------------------------------------------------------------------- */

console.log('\n=== Jeder Aufruf trifft etwas ===');

/** Sammelt die Namen, die eine Datei nach aussen gibt. Grob, aber es
    genügt: Wir suchen Tippfehler, nicht Sichtbarkeitsregeln. */
function bietet(datei) {
    const t = fs.readFileSync(datei, 'utf8');
    const namen = new Set();
    // `name(` und `name:` in einem Rückgabeobjekt, `function name(`
    [...t.matchAll(/function\s+([A-Za-zÄÖÜäöü_$][\w$]*)\s*\(/g)].forEach(m => namen.add(m[1]));
    [...t.matchAll(/^\s{0,12}([A-Za-z_$][\w$]*)\s*[:(]/gm)].forEach(m => namen.add(m[1]));
    [...t.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].forEach(m => namen.add(m[1]));
    [...t.matchAll(/(?:get|set)\s+([A-Za-z_$][\w$]*)\s*[({]/g)].forEach(m => namen.add(m[1]));
    return namen;
}

/* Hilf und Ui liegen gemeinsam in submit/kern/kern.js — eine Ebene
   höher als SubZeit, weil beide Programme sie teilen. */
const kern = path.join(__dirname, '..', 'submit', 'kern', 'kern.js');
const module_ = {
    Fach: bietet(zeit('fach.js')),
    Hilf: bietet(kern),
    Ui:   bietet(kern),
    App:  bietet(zeit('app.js'))
};

Object.keys(module_).forEach(mod => {
    const gerufen = [...quelle.matchAll(new RegExp('\\b' + mod + '\\.([A-Za-z_$][\\w$]*)', 'g'))]
        .map(m => m[1]);
    const verschieden = [...new Set(gerufen)].sort();
    const fehlend = verschieden.filter(n => !module_[mod].has(n));
    console.log('  ' + mod + ': ' + verschieden.length + ' Namen gerufen'
        + (fehlend.length ? '   NICHT GEFUNDEN: ' + fehlend.join(', ') : '   alle vorhanden'));
    ok(fehlend.length === 0, mod + ' — ' + fehlend.join(', '));
});

/* -------------------------------------------------------------------
   Und das Raster kennt die Rückrufe, die bahn.js ihm gibt
   ------------------------------------------------------------------- */

console.log('\n=== Das Raster kennt die übergebenen Rückrufe ===');
const raster = fs.readFileSync(
    path.join(__dirname, '..', 'submit', 'kern', 'wochenraster.js'), 'utf8');

/* Was bahn.js in den Aufruf von R.zeichne hineinlegt. */
const uebergabe = quelle.slice(quelle.indexOf('R.zeichne(wurzel, {'));
const schluessel = [...uebergabe.matchAll(/^\s{12}([a-zA-ZäöüÄÖÜ]+)[:,]/gm)].map(m => m[1]);
const bekannt = [...new Set(schluessel)].sort();
console.log('  übergeben: ' + bekannt.join(', '));
ok(bekannt.length >= 10, 'die Übergabe wurde gefunden und ist vollständig');
bekannt.forEach(k => ok(new RegExp('o\\.' + k + '\\b').test(raster) || k === 'tage',
    'das Raster wertet «' + k + '» aus'));

/* Umgekehrt: Was das Raster meldet, muss bahn.js auch abfangen. */
/* -------------------------------------------------------------------
   Farbe und Inhalt der Blöcke
   -------------------------------------------------------------------
   Am 14.08.2026 waren alle Blöcke gleich grau: SubZeit ohne offenen
   Arbeitsordner hat keine Projektliste, die Kennung stand da, das
   Bauvorhaben nicht — und `projektFarbe` fiel auf einen festen Grauton
   zurück. Ausserdem musste man jeden Block anklicken, um zu sehen, was
   man getan hat.
   ------------------------------------------------------------------- */

console.log('\n=== Farbe hängt an der Kennung, nicht an der Liste ===');
const Fach = require(zeit('fach.js').replace(/\\/g, '/'));
let farbOk = typeof Fach === 'object' && typeof Fach.farbeAusId === 'function';
if (!farbOk) {
  /* fach.js lädt nur im Browser — dann die Regel aus dem Text prüfen. */
  const ft = fs.readFileSync(zeit('fach.js'), 'utf8');
  ok(/function farbeAusId/.test(ft), 'es gibt eine Farbe aus der Kennung');
  ok(/return id \? farbeAusId\(id\)/.test(ft), 'eine Kennung ohne geladenes Projekt wird nicht grau');
  ok(/'#94a3b8'/.test(ft), 'nur was WIRKLICH kein Projekt hat, bleibt grau');
  ok(/Projekt nicht geladen/.test(ft), 'und der Name sagt, dass das Projekt fehlt — nicht, dass keines da ist');
} else {
  ok(Fach.farbeAusId('p_9wajd62') === Fach.farbeAusId('p_9wajd62'), 'dieselbe Kennung, dieselbe Farbe');
  ok(Fach.farbeAusId('p_9wajd62') !== Fach.farbeAusId('p_9j8mqwx'), 'verschiedene Kennungen, verschiedene Farben');
}

/* Und die Spiegelung darf die Farbe nicht mehr an der Listenposition
   festmachen — sonst verrutschen alle, sobald ein Bauvorhaben dazukommt. */
const appText = fs.readFileSync(zeit('app.js'), 'utf8');
ok(/farbe: p\.farbe \|\| Fach\.farbeAusId\(p\.id\)/.test(appText),
   'die Spiegelung nimmt die Farbe aus der Kennung');
ok(!/FARBEN\[i % FARBEN\.length\]/.test(appText),
   'und nicht mehr aus der Position in der Liste');

console.log('\n=== Der Block zeigt sofort, was drinsteht ===');
ok(/wr-block-titel/.test(quelle) && /Fach\.projektName/.test(quelle), 'das Projekt');
ok(/wr-block-unter/.test(quelle), 'den Beschrieb');
ok(/taetigkeit \? taetigkeit\.name/.test(quelle), 'die Tätigkeit');
ok(/e\.notiz/.test(quelle), 'die Notiz');
ok(/titelVoll/.test(quelle), 'und beim Zeigen den vollständigen Text');
/* Der Beschrieb darf nicht nur in der Tagesansicht erscheinen — gerade
   in der Woche will man sehen, was man getan hat. */
const unterZeile = quelle.slice(quelle.indexOf('const unten = ['), quelle.indexOf('const unten = [') + 400);
ok(!/woche \?/.test(unterZeile), 'auch in der Wochenansicht, nicht nur am Tag');

console.log('\n=== Die Handlungen sind alle belegt ===');
[['beiNeu', 'ein neuer Eintrag durch Aufziehen'],
 ['beiGeaendert', 'verschieben und an den Rändern ziehen'],
 ['beiKlick', 'einen Block öffnen'],
 ['beiMenu', 'das Kontextmenü'],
 ['beiTagKlick', 'ein Klick auf die leere Fläche'],
 ['beiKopfKlick', 'ein Klick auf den Tageskopf']
].forEach(([r, was]) => ok(new RegExp(r + '\\s*:').test(quelle), was));

console.log('\n  ' + (geprueft - fehler) + '/' + geprueft + ' geprüft'
    + (fehler ? '   ' + fehler + ' FEHLER' : '   alles grün') + '\n');
process.exit(fehler ? 1 : 0);
