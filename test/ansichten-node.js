// Rendert jede Hauptansicht und meldet, wenn eine davon abstürzt.
//
// Warum es diesen Test gibt
// -------------------------
// Am 14.08.2026 liess sich der Reiter «Zahlungsplan» nicht mehr öffnen.
// Die Ursache war ein einziges Wort: `istModus`, aus der Druckfunktion in
// die Bildschirmansicht übernommen, wo es diese Variable nicht gibt. Die
// Datei war syntaktisch fehlerfrei, alle 455 bestehenden Tests grün — und
// die Ansicht trotzdem tot, weil kein Test sie je aufgerufen hatte.
//
// Dieser Test ruft sie auf. Er prüft nicht, ob etwas hübsch aussieht,
// sondern nur: Kommt HTML heraus, oder fliegt eine Ausnahme?
//
// Die App läuft dazu in einer Attrappe von Browser. Sie ist bewusst dünn:
// Sobald eine Ansicht mehr braucht als diese paar Methoden, gehört das
// Fehlende hier ergänzt — nicht der Test übersprungen.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const U = require('../submit/kern/uebersetzer.js');

const wurzel = path.join(__dirname, '..');
const datei = path.join(wurzel, 'privat', 'Projekte',
  'Umbau EFH Römerstrasse 31', 'Umbau EFH Römerstrasse 31.submit');

if (!fs.existsSync(datei)) {
  console.log('\n  Kein Projekt zum Prüfen vorhanden — übersprungen.\n');
  process.exit(0);
}

const p = U.ausMappe(JSON.parse(fs.readFileSync(datei, 'utf8')));
const allgPfad = path.join(wurzel, 'privat', 'Projekte', 'Allgemein.subone');
const allg = fs.existsSync(allgPfad) ? JSON.parse(fs.readFileSync(allgPfad, 'utf8')) : {};

/* ---- Die Attrappe ---- */
const knoten = () => ({
  style: {}, dataset: {}, value: '', textContent: '', innerHTML: '',
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
  querySelector() { return null; }, querySelectorAll() { return []; },
  setAttribute() {}, getAttribute() { return null; }, focus() {}, blur() {},
  setSelectionRange() {}, select() {}, checked: false, files: [],
  scrollIntoView() {}, getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; }
});
const dokument = {
  querySelector() { return knoten(); }, querySelectorAll() { return []; },
  createElement() { return knoten(); }, getElementById() { return knoten(); },
  addEventListener() {}, body: knoten(), documentElement: knoten(), head: knoten()
};
const speicher = {};
const ctx = {
  console, document: dokument, Intl, Date, Math, JSON, URL,
  window: { addEventListener() {}, location: { hash: '', protocol: 'http:' }, print() {}, scrollTo() {},
            matchMedia() { return { matches: false, addEventListener() {} }; } },
  localStorage: { getItem: k => (k in speicher ? speicher[k] : null), setItem: (k, v) => { speicher[k] = String(v); }, removeItem: k => { delete speicher[k]; } },
  navigator: { userAgent: 'node' }, location: { hash: '', protocol: 'http:' },
  history: { replaceState() {}, pushState() {}, back() {} },
  requestAnimationFrame: fn => { try { fn(); } catch (_) {} return 0; },
  cancelAnimationFrame() {},
  setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: () => Promise.reject(new Error('im Test gibt es kein Netz')),
  __p: p, __b: allg.buero || {}, __out: ''
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);

/* Dieselbe Reihenfolge wie in index.html — der gemeinsame Kern zuerst,
   sonst fehlt app.js die Zeitrechnung. Weicht der Test hier von der Seite
   ab, prüft er etwas anderes als das, was ausgeliefert wird. */
const skripte = [
  'submit/kern/zeitrechnung.js',
  'submit/kern/uebersetzer.js',
  'app.js'
];
for (const s of skripte) {
  const p = path.join(wurzel, s);
  if (!fs.existsSync(p)) { console.log('\n  ' + s + ' fehlt\n'); process.exit(1); }
  try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: s }); }
  catch (e) { console.log('\n  ' + s + ' liess sich nicht laden: ' + e.message + '\n'); process.exit(1); }
}

/* Zustand und Ausgabe abfangen — im selben Geltungsbereich, sonst greift
   die Zuweisung an der modulinternen Variablen vorbei. */
vm.runInContext(`
  state.projekte = [__p];
  state.buero = __b;
  state.kontakte = []; state.dokumente = [];
  save = function () {};
  render = function (h) { __out = h; };
`, ctx);

let fehler = 0, geprueft = 0;
const lauf = (name, code) => {
  geprueft++;
  try {
    ctx.__out = '';
    vm.runInContext(code, ctx);
    const out = ctx.__out || '';
    if (out.length < 200) {
      fehler++;
      console.log('  LEER    ' + name.padEnd(30) + out.length + ' Zeichen');
      console.log('          ' + out.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100));
    } else {
      console.log('  ok      ' + name.padEnd(30) + out.length + ' Zeichen');
    }
  } catch (e) {
    fehler++;
    console.log('  ABSTURZ ' + name.padEnd(30) + e.message);
    String(e.stack).split('\n').slice(1, 3).forEach(l => console.log('          ' + l.trim()));
  }
};

console.log('\n=== Projektansichten ===');
[['Übersicht', 'viewProjekt'], ['Kosten', 'viewKosten'], ['Termine', 'viewTermine'],
 ['Gewerke', 'viewGewerke'], ['Pendenzen', 'viewPendenzen'], ['Eigentümerwünsche', 'viewBauherr'],
 ['Rechnungen', 'viewRechnungen'], ['Dossier', 'viewDossier']]
  .forEach(([n, f]) => { if (typeof ctx[f] === 'function' || vm.runInContext(`typeof ${f}`, ctx) === 'function') lauf(n, `${f}(__p.id)`); });

/* Die programmweiten Seiten — sie hängen nicht an einem Projekt und
   fallen deshalb bei Projekttests durch die Maschen. */
console.log('\n=== Programmweite Ansichten ===');
[['Wochenplanung', 'viewPlanung'], ['Stunden', 'viewStunden'],
 ['Kalender', 'viewKalenderGlobal'], ['Pendenzen (alle)', 'viewPendenzenGlobal'],
 ['Kontakte', 'viewKontakte'], ['Einstellungen', 'viewEinstellungen']]
  .forEach(([n, f]) => { if (vm.runInContext(`typeof ${f}`, ctx) === 'function') lauf(n, `${f}()`); });

console.log('\n=== Zahlungsplan, jede Einstellung ===');
const z = vm.runInContext('zahlungsplanOf(__p)', ctx);
const faelle = [
  ['Bauherr · Plan',          { modus: 'bauherr', bhIst: false, bhGrundlage: 'alle', bhSchritt: 0 }],
  ['Bauherr · Stand heute',   { modus: 'bauherr', bhIst: true }],
  ['Bauherr · nur vergebene', { modus: 'bauherr', bhIst: false, bhGrundlage: 'vergeben' }],
  ['Bauherr · 25000er',       { modus: 'bauherr', bhGrundlage: 'alle', bhSchritt: 25000 }],
  ['Bauherr · Rechnung 0 Mt', { modus: 'bauherr', bhSchritt: 0, rechnungVersatz: 0, zahlungsfrist: 10 }],
  ['Unternehmer',             { modus: 'unternehmer' }],
  ['Honorar',                 { modus: 'honorar' }]
];
faelle.forEach(([n, cfg]) => { Object.assign(z, cfg); lauf(n, 'viewZahlungsplan(__p.id)'); });

/* Beide Anzeigerichtungen — der MwSt-Schalter hat schon einmal danebengelegen. */
Object.assign(z, { modus: 'bauherr', bhIst: false, bhGrundlage: 'alle', bhSchritt: 0 });
vm.runInContext('kostenBrutto = true;', ctx);
lauf('Zahlungsplan · inkl. MwSt', 'viewZahlungsplan(__p.id)');
lauf('Kosten · inkl. MwSt', 'viewKosten(__p.id)');
vm.runInContext('kostenBrutto = false;', ctx);

console.log('\n=== Gewerk-Detail ===');
const ids = vm.runInContext('gewerkeSorted(__p).slice(0,3).map(v=>v.id)', ctx);
ids.forEach((id, i) => { ctx.__vid = id; lauf('Gewerk ' + (i + 1), `viewVergabeDetail(__p.id, ${JSON.stringify(id)})`); });

console.log('\n=== Druckdokumente ===');
/* Der Druck baut sein HTML selbst und übergibt es openPrintDoc. Genau das
   wird abgefangen — so prüft der Test das erzeugte Dokument, nicht die
   Druckvorschau. */
vm.runInContext('openPrintDoc = function (t, s, inner) { __out = String(inner || ""); };', ctx);
[['Zahlungsplan · Plan', 'z.bhIst=false', 'pdfZahlungsplan(__p.id)'],
 ['Zahlungsplan · Stand heute', 'z.bhIst=true', 'pdfZahlungsplan(__p.id)'],
 ['Bauprogramm', '', 'pdfGantt(__p.id)'],
 ['Rechnungskontrolle', '', 'pdfRechnungskontrolle(__p.id)'],
 ['Kostenschätzung', '', 'pdfKostenschaetzung(__p.id)']
].forEach(([n, vor, code]) => {
  if (vor) Object.assign(z, { bhIst: vor.includes('true') });
  if (vm.runInContext(`typeof ${code.split('(')[0]}`, ctx) !== 'function') return;
  lauf(n, code);
});

console.log('\n  ' + (geprueft - fehler) + '/' + geprueft + ' Ansichten'
  + (fehler ? '   ' + fehler + ' KAPUTT' : '   alle rendern') + '\n');
process.exit(fehler ? 1 : 0);
