// Ruft die Druckausgaben wirklich auf — an echten Zahlen.
//
// Warum es diesen Test gibt
// -------------------------
// ansichten-node.js deckt die Bildschirmseiten ab. Die Druckfunktionen
// lagen daneben: Sie laufen erst, wenn jemand auf «Drucken» klickt, und
// ein einziger Tippfehler darin zeigt sich deshalb nie im Test, sondern
// im Moment, in dem das Blatt gebraucht wird. Genau dort ist er am
// teuersten.
//
// Geprüft wird nicht das Aussehen, sondern: Kommt ein vollständiges
// Dokument heraus — mit Kopf, Fuss, Seitenzahlen und den Blättern, die
// darin stehen sollen?

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

/* ---- Dieselbe Attrappe wie in ansichten-node.js ---- */
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

/* Das Druckfenster: Es fängt auf, was hineingeschrieben wird. Genau das
   ist der Gegenstand der Prüfung. */
const fenster = {
  __html: '',
  document: {
    write(h) { fenster.__html += h; },
    close() {}
  },
  focus() {}, print() {}, close() {}
};

const ctx = {
  console, document: dokument, Intl, Date, Math, JSON, URL,
  window: {
    addEventListener() {}, location: { hash: '', protocol: 'http:' }, print() {}, scrollTo() {},
    open() { fenster.__html = ''; return fenster; },
    matchMedia() { return { matches: false, addEventListener() {} }; }
  },
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

for (const s of ['submit/kern/zeitrechnung.js', 'submit/kern/uebersetzer.js', 'app.js']) {
  try { vm.runInContext(fs.readFileSync(path.join(wurzel, s), 'utf8'), ctx, { filename: s }); }
  catch (e) { console.log('\n  ' + s + ' liess sich nicht laden: ' + e.message + '\n'); process.exit(1); }
}
vm.runInContext(`
  state.projekte = [__p];
  state.buero = __b;
  state.kontakte = []; state.dokumente = [];
  save = function () {};
  render = function (h) { __out = h; };
`, ctx);

let fehler = 0, geprueft = 0;
const ok = (bed, was) => { geprueft++; if (!bed) { fehler++; console.log('  FEHLT: ' + was); } };

function drucke(name, code) {
  fenster.__html = '';
  try { vm.runInContext(code, ctx); }
  catch (e) {
    fehler++; geprueft++;
    console.log('  ABSTURZ ' + name + ': ' + e.message);
    String(e.stack).split('\n').slice(1, 3).forEach(l => console.log('          ' + l.trim()));
    return '';
  }
  return fenster.__html;
}

/* =====================================================================
   Zahlungsplan Bauherr
   ===================================================================== */

console.log('\n=== Zahlungsplan Bauherr ===');
let html = drucke('Zahlungsplan', `
  var z = zahlungsplanOf(__p); z.modus = 'bauherr';
  pdfZahlungsplan(__p.id);`);

const blaetter = (html.match(/class="blatt"/g) || []).length;
console.log('  ' + html.length + ' Zeichen, ' + blaetter + ' Blätter');
ok(html.length > 5000, 'es entsteht überhaupt ein Dokument');
ok(blaetter >= 2, 'es hat mehrere Blätter');
ok(/class="zk"/.test(html), 'jedes Blatt hat einen Kopf');
ok(/class="zf"/.test(html), 'jedes Blatt hat eine Fusszeile');
ok((html.match(/class="zk"/g) || []).length === blaetter, 'genau ein Kopf je Blatt');
ok((html.match(/class="zf"/g) || []).length === blaetter, 'genau eine Fusszeile je Blatt');
ok(/Seite 1 von /.test(html), 'die Seiten sind gezählt');

/* Die Unterschrift gehört unter den Bauherrnplan, nicht unter das letzte
   Unternehmerblatt — das geht an einen Dritten hinaus. */
// Nur die Auszeichnung zählen, nicht die Regeln im Stilblock.
const sig = (html.match(/class="zp-sig"/g) || []).length;
console.log('  Unterschriftsfeld: ' + sig + '× im Dokument');
ok(sig === 1, 'die Unterschrift steht genau einmal');
const vorUnternehmer = html.indexOf('class="zp-sig"') < html.indexOf('Auftragssumme')
  || html.indexOf('Auftragssumme') < 0;
ok(vorUnternehmer, 'und zwar vor den Unternehmerblättern');

console.log('\n=== Die Unternehmerblätter hinten ===');
const untBlaetter = (html.match(/Auftragssumme/g) || []).length;
console.log('  ' + untBlaetter + ' Unternehmerblätter');
ok(untBlaetter > 0, 'es gibt Blätter je Unternehmer');
ok(/Bereits geleistete Zahlungen/.test(html), 'mit den bereits geleisteten Zahlungen');
ok(/Ab jetzt geplante Zahlungen/.test(html), 'und den ab jetzt geplanten');
ok(/bereits geleistet/.test(html) && /noch offen/.test(html), 'im Kopf steht geleistet und offen');
ok(/Summe bereits geleistet|keine Zahlung geleistet/.test(html), 'die geleisteten Zahlungen sind summiert');
ok(/Summe geplant|keine Zahlung mehr vorgesehen/.test(html), 'die geplanten Zahlungen sind summiert');

/* -------------------------------------------------------------------
   Wer bekommt welches Blatt?
   -------------------------------------------------------------------
   Der Bauherr braucht die Unternehmerblätter nicht — sie gehen ihn
   nichts an und machen aus vier Seiten neunundzwanzig. Der einzelne
   Unternehmer darf den Gesamtplan nicht sehen: Darin stehen die Preise
   seiner Mitbewerber.
   ------------------------------------------------------------------- */

console.log('\n=== Der Umfang lässt sich wählen ===');
const zaehl = h => ({
  blaetter: (h.match(/class="blatt"/g) || []).length,
  unternehmer: (h.match(/Auftragssumme/g) || []).length,
  monatsplan: /Aufschlüsselung je Monat/.test(h)
});

const nurBh = zaehl(drucke('nur Bauherr', `
  var z = zahlungsplanOf(__p); z.modus='bauherr';
  pdfZahlungsplanBauherr(__p, z, { umfang: 'bauherr' });`));
console.log('  Bauherrschaft      ' + nurBh.blaetter + ' Blätter, ' + nurBh.unternehmer + ' Unternehmerblätter');
ok(nurBh.blaetter > 0, 'für die Bauherrschaft entsteht ein Dokument');
ok(nurBh.unternehmer === 0, 'ohne ein einziges Unternehmerblatt');
ok(nurBh.monatsplan, 'aber mit der Aufschlüsselung je Monat');
ok(nurBh.blaetter < blaetter, 'und es ist kürzer als das Gesamtdokument');

const nurUnt = zaehl(drucke('nur Unternehmer', `
  var z = zahlungsplanOf(__p); z.modus='bauherr';
  pdfZahlungsplanBauherr(__p, z, { umfang: 'unternehmer' });`));
console.log('  Alle Unternehmer   ' + nurUnt.blaetter + ' Blätter, ' + nurUnt.unternehmer + ' Unternehmerblätter');
ok(nurUnt.unternehmer > 0, 'die Unternehmerblätter entstehen');
ok(!nurUnt.monatsplan, 'ohne den Monatsplan der Bauherrschaft');
ok((nurUnt.blaetter + nurBh.blaetter) === blaetter,
   'Bauherr und Unternehmer ergeben zusammen genau das Gesamtdokument');

const einzeln = drucke('ein Unternehmer', `
  var z = zahlungsplanOf(__p); z.modus='bauherr';
  var g = unternehmerPlaene(__p, { min: Number(z.untSchwelle)||0, schritt: Number(z.untSchritt)||0 }).filter(x=>!x.klein);
  pdfZahlungsplanBauherr(__p, z, { umfang: 'einer', key: g[0].key });`);
const eins = zaehl(einzeln);
console.log('  Ein Unternehmer    ' + eins.blaetter + ' Blätter, ' + eins.unternehmer + ' Unternehmerblätter');
ok(eins.unternehmer === 1, 'genau ein Unternehmerblatt');
ok(!eins.monatsplan, 'und nichts von der Bauherrschaft');
/* Das ist der Punkt, an dem es teuer würde: Bekäme ein Unternehmer das
   Gesamtdokument, läse er die Preise seiner Mitbewerber. */
ok(eins.blaetter <= 2, 'das Blatt bleibt bei sich — kein fremder Preis darauf');

console.log('\n=== Eine Position, eine Zeile ===');
ok(/\.zp-fi\{color/.test(html) && !/\.zp-fi\{display:block/.test(html),
   'die Firma steht nicht mehr auf einer eigenen Zeile');
ok(/zp-detail td\{[^}]*white-space:nowrap/.test(html), 'die Positionszeile bricht nicht um');
ok(!/zp-mk ak">Akonto/.test(html), 'der Normalfall «Akonto» wird nicht auf jeder Zeile bezeichnet');
ok(/Schlussrechnung|Rückbehalt/.test(html), 'die Ausnahmen dagegen schon');

/* Der messende Umbruch muss im Dokument mitfahren — ohne ihn läuft der
   Inhalt wieder unter die Fusszeile. */
console.log('\n=== Der messende Umbruch fährt mit ===');
ok(/function umbrechen/.test(html), 'der Seitenumbruch steckt im Dokument');
ok(/document.fonts/.test(html), 'und wartet auf die Schriften');
ok(/window.print/.test(html), 'gedruckt wird danach');

/* =====================================================================
   Die übrigen Druckwege — sie teilen sich denselben Umbruch
   ===================================================================== */

console.log('\n=== Weitere Druckausgaben ===');
[['Baukostenübersicht', 'pdfKosten(__p.id)'],
 ['Unternehmerliste',   'pdfUnternehmer(__p.id)'],
 ['Submittentenliste',  'pdfSubmittenten(__p.id)']
].forEach(([name, code]) => {
  if (vm.runInContext('typeof ' + code.split('(')[0], ctx) !== 'function') return;
  const h = drucke(name, code);
  const n = (h.match(/class="sheet|class="blatt"/g) || []).length;
  console.log('  ' + name.padEnd(22) + h.length + ' Zeichen' + (n ? ', ' + n + ' Blätter' : ''));
  ok(h.length > 2000, name + ' erzeugt ein Dokument');
  ok(/function umbrechen/.test(h), name + ' bekommt den messenden Umbruch');
});

console.log('\n  ' + (geprueft - fehler) + '/' + geprueft + ' geprüft'
  + (fehler ? '   ' + fehler + ' FEHLER' : '   alles grün') + '\n');
process.exit(fehler ? 1 : 0);
