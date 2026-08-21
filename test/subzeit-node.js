// Rechnet SubZeit an den echten Stunden nach — die Fachlogik, nicht die Datei.
//
// zeit-node.js prüft, dass die Datei durch SubZeits eigene Prüfung geht.
// Das sagt aber nichts darüber, ob die Stunden stimmen. Dieser Test lädt
// die echte Fachlogik und lässt sie rechnen: Dauer, Tagessummen, Soll und
// Differenz, Projektzuordnung, Farben — und den Rapport, der am Ende
// gedruckt wird.
//
// Damit das Programm mit den erfassten Stunden brauchbar ist, muss beides
// stimmen: die Zahl unten am Blatt und die Zuordnung dahinter.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const U = require('../submit/kern/uebersetzer.js');

const wurzel = path.join(__dirname, '..');
const basis = path.join(wurzel, 'privat', 'Projekte');
const allgPfad = path.join(basis, 'Allgemein.subone');
if (!fs.existsSync(allgPfad)) { console.log('\n  Kein Arbeitsordner — übersprungen.\n'); process.exit(0); }

let fehler = 0, geprueft = 0;
const ok = (bed, was) => { geprueft++; if (!bed) { fehler++; console.log('  FEHLT: ' + was); } };

/* ---- Die Bauvorhaben aus dem Ordner, wie App.imOrdner sie lädt ---- */
const ordnerProjekte = fs.readdirSync(basis, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => path.join(basis, d.name, d.name + '.submit'))
  .filter(fs.existsSync)
  .map(f2 => { const p = U.ausMappe(JSON.parse(fs.readFileSync(f2, 'utf8'))); return { id: p.id, name: p.name, phase: p.phase }; });

const allg = JSON.parse(fs.readFileSync(allgPfad, 'utf8'));

/* ---- SubZeit in einer Attrappe ---- */
const knoten = () => ({
  style: {}, dataset: {}, value: '', textContent: '', innerHTML: '', children: [],
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
  querySelector() { return null; }, querySelectorAll() { return []; },
  setAttribute() {}, getAttribute() { return null; }, focus() {}, blur() {},
  insertBefore() {}, replaceChildren() {}, closest() { return null; },
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; }
});
const sp = {};
const ctx = {
  console, Intl, Date, Math, JSON, URL, Blob: function () {}, crypto: { getRandomValues: a => a },
  document: { querySelector: () => knoten(), querySelectorAll: () => [], createElement: () => knoten(),
              getElementById: () => knoten(), addEventListener() {}, body: knoten(),
              documentElement: knoten(), head: knoten(), createTextNode: () => knoten() },
  window: { addEventListener() {}, location: { hash: '', search: '', protocol: 'http:' }, print() {},
            matchMedia: () => ({ matches: false, addEventListener() {} }) },
  localStorage: { getItem: k => (k in sp ? sp[k] : null), setItem: (k, v) => { sp[k] = String(v); }, removeItem: k => { delete sp[k]; } },
  navigator: { userAgent: 'node' }, location: { hash: '', search: '', protocol: 'http:' },
  history: { replaceState() {}, pushState() {}, back() {} },
  requestAnimationFrame: fn => { try { fn(); } catch (_) {} return 0; },
  cancelAnimationFrame() {}, setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: () => Promise.reject(new Error('kein Netz'))
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);

for (const s of ['submit/kern/kern.js', 'submit/kern/zeitrechnung.js', 'submit/zeit/fach.js']) {
  try { vm.runInContext(fs.readFileSync(path.join(wurzel, s), 'utf8'), ctx, { filename: s }); }
  catch (e) { console.log('\n  ' + s + ' liess sich nicht laden: ' + e.message + '\n'); process.exit(1); }
}

/* Das Zeitdokument setzen — genau wie App.imOrdner es tut: die Projekte
   werden aus dem Ordner gespiegelt, nicht aus der Datei gelesen. */
ctx.__zeit = allg.zeit;
ctx.__ordner = ordnerProjekte;
vm.runInContext(`
  var dok = Ablage.pruefe(__zeit);
  dok.projekte = __ordner.map(function (p) {
    return { id: p.id, name: p.name, farbe: Fach.farbeAusId(p.id),
             kundeId: null, ausOrdner: true, aktiv: p.phase !== 'abschluss' };
  });
  Daten.setze(dok, true);
`, ctx);
const lauf = code => vm.runInContext(code, ctx);

const dauer = m => Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');

/* =====================================================================
   1. Die Einträge kommen an
   ===================================================================== */

console.log('\n=== Die erfassten Stunden ===');
const eintraege = lauf('Daten.doc.eintraege || []');
const tage = [...new Set(eintraege.map(e => e.datum))].sort();
console.log('  ' + eintraege.length + ' Einträge an ' + tage.length + ' Tagen: ' + tage.join(', '));
ok(eintraege.length > 0, 'es sind Stunden erfasst');
ok(eintraege.every(e => e.datum && Number.isFinite(e.von)), 'jeder Eintrag hat Datum und Beginn');

/* =====================================================================
   2. Jeder Tag rechnet auf
   ===================================================================== */

console.log('\n=== Je Tag: gearbeitet, Soll, Differenz ===');
let summeTage = 0;
tage.forEach(d => {
  const t = lauf('Fach.tag("' + d + '")');
  const ausEintraegen = t.eintraege.reduce((a, e) => a + lauf('Fach.dauerVon(' + JSON.stringify(e) + ')'), 0);
  summeTage += t.gearbeitet;
  console.log('  ' + d + '   ' + String(t.eintraege.length) + ' Einträge   gearbeitet ' + dauer(t.gearbeitet).padStart(6)
    + '   Soll ' + dauer(t.soll).padStart(6) + '   Differenz ' + (t.differenz >= 0 ? '+' : '') + dauer(Math.abs(t.differenz)));
  ok(t.gearbeitet === ausEintraegen, d + ': die Tagessumme ist die Summe seiner Einträge');
  ok(t.differenz === t.gearbeitet - t.soll, d + ': die Differenz ist gearbeitet minus Soll');
  ok(t.gearbeitet >= 0, d + ': keine negative Arbeitszeit');
});

/* Und die Spanne über alle Tage muss dasselbe ergeben. */
const bereich = lauf('Fach.zeitraum("' + tage[0] + '","' + tage[tage.length - 1] + '")');
console.log('  ── Spanne   gearbeitet ' + dauer(bereich.gearbeitet) + '   (Summe der Tage ' + dauer(summeTage) + ')');
ok(bereich.gearbeitet === summeTage, 'die Spanne summiert genau die Tage');

/* =====================================================================
   3. Kein Eintrag überschneidet einen anderen
   ===================================================================== */

console.log('\n=== Keine Überschneidungen ===');
let ueber = 0;
tage.forEach(d => {
  const amTag = eintraege.filter(e => e.datum === d).sort((a, b) => a.von - b.von);
  for (let i = 1; i < amTag.length; i++) {
    const vorher = amTag[i - 1], jetzt = amTag[i];
    const ende = Number.isFinite(vorher.bis) ? vorher.bis : vorher.von;
    if (jetzt.von < ende) { ueber++; console.log('    ' + d + ': ' + vorher.von + '-' + ende + ' und ' + jetzt.von); }
  }
});
ok(ueber === 0, 'kein Eintrag liegt auf einem anderen');

/* =====================================================================
   4. Die Projekte werden gefunden — Name und Farbe
   ===================================================================== */

console.log('\n=== Projekte, Farben, Tätigkeiten ===');
const mitProjekt = eintraege.filter(e => e.projektId);
const namen = new Map();
mitProjekt.forEach(e => namen.set(e.projektId, lauf('Fach.projektName("' + e.projektId + '")')));
namen.forEach((n, id) => {
  const farbe = lauf('Fach.projektFarbe("' + id + '")');
  console.log('  ' + id.padEnd(14) + String(n).padEnd(30) + farbe);
  ok(n !== 'Ohne Projekt' && n !== 'Projekt nicht geladen', id + ' wird einem Bauvorhaben zugeordnet');
  ok(/^#[0-9a-f]{6}$/i.test(farbe), id + ' hat eine richtige Farbe');
  ok(farbe !== '#94a3b8', id + ' ist nicht die Ersatzfarbe für «ohne Projekt»');
});
/* Verschiedene Bauvorhaben müssen verschiedene Farben tragen — sonst
   sagt die Farbe auf dem Wochenplan nichts. */
const farben = [...namen.keys()].map(id => lauf('Fach.projektFarbe("' + id + '")'));
ok(new Set(farben).size === farben.length, 'verschiedene Bauvorhaben, verschiedene Farben');

const ohneProjekt = eintraege.filter(e => !e.projektId);
console.log('  ohne Projekt: ' + ohneProjekt.length + ' Einträge   Farbe '
  + lauf('Fach.projektFarbe(null)') + '   Name «' + lauf('Fach.projektName(null)') + '»');
ok(lauf('Fach.projektName(null)') === 'Ohne Projekt', 'was kein Projekt hat, heisst auch so');

const mitTaetigkeit = eintraege.filter(e => e.taetigkeitId);
const tNamen = new Set(mitTaetigkeit.map(e => (lauf('Fach.taetigkeit("' + e.taetigkeitId + '")') || {}).name));
console.log('  Tätigkeiten: ' + [...tNamen].join(', '));
ok([...tNamen].every(Boolean), 'jede benutzte Tätigkeit ist auffindbar');

/* =====================================================================
   5. Der Rapport — die Zahl, die am Ende auf dem Blatt steht
   ===================================================================== */

console.log('\n=== Der Rapport rechnet dasselbe ===');
/* Die Bündelung aus app.js herauslösen und mit der echten Fachlogik
   füttern — genau so läuft sie im Programm. */
const appText = fs.readFileSync(path.join(wurzel, 'submit', 'zeit', 'app.js'), 'utf8');
const gruppenText = appText.match(/function rapportGruppen[\s\S]*?\n    \}/);
ok(!!gruppenText, 'rapportGruppen liess sich herauslösen');
lauf(gruppenText[0].replace(/^\s*function/, 'function'));

const zeilen = eintraege.slice().sort((a, b) => a.datum.localeCompare(b.datum) || a.von - b.von);
const gesamt = zeilen.reduce((a, e) => a + lauf('Fach.dauerVon(' + JSON.stringify(e) + ')'), 0);
console.log('  Gesamt über alle Einträge: ' + dauer(gesamt) + '   (' + (gesamt / 60).toFixed(2) + ' Stunden)');
ok(gesamt === summeTage, 'der Rapport zählt dieselbe Summe wie die Tagesansicht');

ctx.__zeilen = zeilen;
['tag', 'projekt', 'taetigkeit'].forEach(art => {
  const g = lauf('rapportGruppen(__zeilen, "' + art + '")');
  const s = g.reduce((a, x) => a + x.minuten, 0);
  const n = g.reduce((a, x) => a + x.zeilen.length, 0);
  console.log('  nach ' + art.padEnd(11) + g.length + ' Gruppen   ' + dauer(s).padStart(7)
    + '   ' + n + ' Einträge');
  ok(s === gesamt, 'nach ' + art + ': keine Minute geht verloren');
  ok(n === zeilen.length, 'nach ' + art + ': kein Eintrag geht verloren');
});

/* Nach Tag muss der Verlauf erhalten bleiben, sonst liest sich der
   Rapport nicht als Woche. */
const nachTag = lauf('rapportGruppen(__zeilen, "tag")');
const reihe = nachTag.map(g => g.zeilen[0].datum);
console.log('  Reihenfolge nach Tag: ' + reihe.join(' → '));
ok(reihe.join() === reihe.slice().sort().join(), 'nach Tag bleibt es chronologisch');

/* =====================================================================
   6. Der Weg zurück in die Datei
   ===================================================================== */

console.log('\n=== Speichern lässt die Projekte im Ordner ===');
const kopie = lauf('(function(){ var k = Daten.kopie(Daten.doc); delete k.projekte; return k; })()');
ok(kopie.projekte === undefined, 'die gespiegelten Projekte wandern nicht in die Datei');
ok((kopie.eintraege || []).length === eintraege.length, 'alle Einträge bleiben erhalten');
ok(kopie.format === 'submit.zeit', 'das Format bleibt «submit.zeit»');

/* Und noch einmal durch SubZeits eigene Prüfung. */
ctx.__kopie = kopie;
let nochmal = true, meldung = '';
try { lauf('Ablage.pruefe(__kopie)'); } catch (e) { nochmal = false; meldung = e.message; }
ok(nochmal, 'das Gespeicherte geht wieder durch SubZeits Prüfung' + (meldung ? ': ' + meldung : ''));

console.log('\n  ' + (geprueft - fehler) + '/' + geprueft + ' geprüft'
  + (fehler ? '   ' + fehler + ' FEHLER' : '   alles grün') + '\n');
process.exit(fehler ? 1 : 0);
