// Prüft das Zeitdokument im Arbeitsordner — mit SubZeits eigener Prüfung.
//
// Warum es diesen Test gibt
// -------------------------
// Am 14.08.2026 habe ich `zeit.format` auf «subzeit» gesetzt. SubZeit prüft
// aber gegen «submit.zeit» und wirft sonst eine Ausnahme — der Arbeitsordner
// liess sich nicht mehr öffnen, die Seite blieb einfach hängen.
//
// Ein Feldname, ein Buchstabendreher, und ein Programm startet nicht mehr.
// Deshalb schickt dieser Test die echte Datei durch die echte Prüfung von
// SubZeit, statt die Erwartung ein zweites Mal aufzuschreiben.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const wurzel = path.join(__dirname, '..');
const basis = path.join(wurzel, 'privat', 'Projekte');
const allgPfad = path.join(basis, 'Allgemein.subone');

let fehler = 0, geprueft = 0;
const ok = (bed, was) => { geprueft++; if (!bed) { fehler++; console.log('  FEHLT: ' + was); } };

/* ---- Erwartetes Format aus dem Kern lesen, nicht aus dem Gedächtnis ---- */
const kernQuelle = fs.readFileSync(path.join(wurzel, 'submit', 'kern', 'kern.js'), 'utf8');
const mFormat = kernQuelle.match(/const FORMAT = '([^']+)'/);
const ERWARTET = mFormat && mFormat[1];

console.log('\n=== Das Format, das SubZeit verlangt ===');
ok(!!ERWARTET, 'kern.js nennt ein FORMAT');
console.log('  ' + ERWARTET);

if (!fs.existsSync(allgPfad)) {
  console.log('\n  Kein Arbeitsordner zum Prüfen — übersprungen.\n');
  process.exit(0);
}
const allg = JSON.parse(fs.readFileSync(allgPfad, 'utf8'));

if (!allg.zeit) {
  console.log('\n  Noch keine Zeitdaten erfasst — nichts zu prüfen.\n');
  process.exit(fehler ? 1 : 0);
}

console.log('\n=== Die Datei durch SubZeits eigene Prüfung ===');
ok(allg.zeit.format === ERWARTET,
   'zeit.format ist «' + ERWARTET + '» (steht: «' + allg.zeit.format + '»)');

const st = {};
const ctx = {
  console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Intl, URL, setTimeout, clearTimeout,
  window: { addEventListener() {} },
  document: { addEventListener() {}, createElement: () => ({ click() {}, style: {} }) },
  localStorage: { getItem: k => (k in st ? st[k] : null), setItem: (k, v) => { st[k] = String(v); }, removeItem: k => { delete st[k]; } },
  crypto: { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; }, randomUUID: () => 'x' },
  __roh: allg.zeit, __doc: null, __fehler: null
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
try {
  vm.runInContext(kernQuelle, ctx, { filename: 'kern.js' });
  vm.runInContext('try { __doc = Ablage.pruefe(__roh); } catch (e) { __fehler = e.message; }', ctx);
} catch (e) { ctx.__fehler = e.message; }

ok(!ctx.__fehler, 'SubZeit nimmt die Datei an' + (ctx.__fehler ? ' — ' + ctx.__fehler : ''));
if (ctx.__fehler) { console.log('\n  ' + (geprueft - fehler) + '/' + geprueft + '   ' + fehler + ' FEHLER\n'); process.exit(1); }

const d = ctx.__doc;
console.log('  ' + (d.eintraege || []).length + ' Einträge · ' + (d.taetigkeiten || []).length + ' Tätigkeiten · '
  + (d.absenztypen || []).length + ' Absenzarten');

/* ---- Die Einträge in sich ---- */
console.log('\n=== Die Einträge ===');
const eintraege = d.eintraege || [];
ok(eintraege.every(e => /^\d{4}-\d{2}-\d{2}$/.test(e.datum)), 'jedes Datum hat die Form JJJJ-MM-TT');
ok(eintraege.every(e => Number.isFinite(e.von) && e.von >= 0 && e.von < 1440), 'jede Startzeit liegt im Tag');
ok(eintraege.every(e => !Number.isFinite(e.bis) || e.bis > e.von), 'kein Eintrag endet vor seinem Beginn');
ok(eintraege.every(e => e.id), 'jeder Eintrag hat eine Kennung');
ok(new Set(eintraege.map(e => e.id)).size === eintraege.length, 'keine doppelten Kennungen');

/* Tätigkeiten müssen es geben — sonst zeigt SubZeit eine leere Spalte. */
const tIds = new Set((d.taetigkeiten || []).map(t => t.id));
ok(eintraege.every(e => !e.taetigkeitId || tIds.has(e.taetigkeitId)),
   'jede verwendete Tätigkeit ist auch angelegt');

/* Projekte kommen aus dem Ordner, nicht aus dem Zeitdokument. */
ok(d.projekte === undefined || !Array.isArray(allg.zeit.projekte),
   'die Projektliste steht nicht doppelt im Zeitdokument');

const projIds = new Set();
for (const o of fs.readdirSync(basis, { withFileTypes: true })) {
  if (!o.isDirectory()) continue;
  const f = path.join(basis, o.name, o.name + '.submit');
  if (!fs.existsSync(f)) continue;
  const m = JSON.parse(fs.readFileSync(f, 'utf8'));
  const id = m.module && m.module.one && m.module.one.id;
  if (id) projIds.add(id);
}
const verwaist = eintraege.filter(e => e.projektId && !projIds.has(e.projektId));
verwaist.forEach(e => console.log('  verwaist: ' + e.datum + ' zeigt auf ' + e.projektId));
ok(!verwaist.length, 'jeder Eintrag mit Projekt zeigt auf ein Bauvorhaben im Ordner');

/* Keine Überschneidungen am selben Tag — SubZeit lässt sie gar nicht zu. */
const proTag = new Map();
eintraege.forEach(e => { if (!proTag.has(e.datum)) proTag.set(e.datum, []); proTag.get(e.datum).push(e); });
let ueber = 0;
proTag.forEach((liste, tag) => {
  const s = liste.slice().sort((a, b) => a.von - b.von);
  for (let i = 1; i < s.length; i++) {
    if (s[i].von < (Number.isFinite(s[i - 1].bis) ? s[i - 1].bis : s[i - 1].von)) {
      console.log('  Überschneidung am ' + tag); ueber++;
    }
  }
});
ok(!ueber, 'keine zwei Einträge überschneiden sich');

/* ---- Was dabei herauskommt ---- */
/* ---- Der gemeinsame Kern ----
   Die Probe aufs Exempel: SubZeits Fachlogik und SubmitOne rechnen jetzt
   mit derselben Datei. Wenn hier etwas auseinanderläuft, ist die
   Vereinheitlichung nur behauptet. */
console.log('\n=== Zeitrechnung: der gemeinsame Kern ===');
const Z = require('../submit/kern/zeitrechnung.js');

ok(typeof Z.soll === 'function' && typeof Z.dauer === 'function', 'der Kern stellt soll() und dauer() bereit');

/* Feiertage — genau die Stelle, an der SubmitOne vorher falsch lag. */
const bern = { einstellungen: { kanton: 'BE', sollProTag: { 1: 510, 2: 510, 3: 510, 4: 510, 5: 480, 6: 0, 0: 0 } },
               eintraege: [], absenzen: [], absenztypen: [], eigeneFeiertage: [], abgewaehlteFeiertage: [] };
ok(Z.soll(bern, '2026-08-01') === 0,      'Bundesfeier: kein Soll (1.8.2026 ist ein Samstag – bleibt 0)');
ok(Z.soll(bern, '2026-01-01') === 0,      'Neujahr: kein Soll');
ok(Z.soll(bern, '2026-08-13') === 510,    'ein gewöhnlicher Donnerstag: 510 Minuten');
ok(Z.soll(bern, '2026-08-15') === 0,      'Samstag: kein Soll');
ok(!!Z.feiertagAm(bern, '2026-01-01'),    'Neujahr wird als Feiertag erkannt');
ok(!Z.feiertagAm(bern, '2026-01-06'),     'Dreikönigstag gilt in Bern nicht');
const luzern = JSON.parse(JSON.stringify(bern)); luzern.einstellungen.kanton = 'LU';
ok(!!Z.feiertagAm(luzern, '2026-01-06'),  'in Luzern schon — der Kanton entscheidet');

/* Ostern und was daran hängt. */
ok(Z.alsText(Z.ostern(2026)) === '2026-04-05', 'Ostersonntag 2026 fällt auf den 5. April');
ok(!!Z.feiertagAm(bern, '2026-04-03'),         'Karfreitag zwei Tage davor');
ok(!!Z.feiertagAm(bern, '2026-05-14'),         'Auffahrt 39 Tage nach Ostern');

/* Dauer, Raster, Überschneidung. */
ok(Z.dauer({ von: 450, bis: 720, pause: 0 }) === 270,  '07:30–12:00 sind 270 Minuten');
ok(Z.dauer({ von: 450, bis: 720, pause: 30 }) === 240, 'die Pause wird abgezogen');
ok(Z.dauer({ von: 1320, bis: 120 }) === 240,           'über Mitternacht: 22:00–02:00 sind vier Stunden');
ok(Z.dauer({ von: 450 }) === 0,                        'ein laufender Timer zählt noch nicht');
const r15 = { einstellungen: { raster: 15 } };
ok(Z.runde(r15, 712) === 705,                          '11:52 wird zu 11:45 — zur nächsten Marke, nicht aufwärts');
const spanne = Z.rundeSpanne(r15, 452, 458);
ok(spanne[0] === 450 && spanne[1] === 465,             'eine zu kurze Spanne fällt nicht auf null');

const belegt = { eintraege: [{ id: 'a', datum: '2026-08-13', von: 450, bis: 720 }] };
ok(Z.ueberschneidung(belegt, '2026-08-13', 600, 700),        'mitten hinein überschneidet sich');
ok(!Z.ueberschneidung(belegt, '2026-08-13', 720, 780),       'direkt anschliessend nicht');
ok(!Z.ueberschneidung(belegt, '2026-08-13', 600, 700, 'a'),  'der Eintrag selbst zählt beim Ändern nicht mit');

/* Und dass SubZeit wirklich nicht mehr selber rechnet. */
const fachQuelle = fs.readFileSync(path.join(wurzel, 'submit', 'zeit', 'fach.js'), 'utf8');
ok(/require\(.\.\.\/kern\/zeitrechnung|Zeitrechnung/.test(fachQuelle), 'fach.js greift auf den Kern zu');
ok(!/name: 'Neujahr'/.test(fachQuelle),        'die Feiertagstabelle steht nicht mehr doppelt in fach.js');
ok(!/function ostern/.test(fachQuelle),        'die Osterformel steht nicht mehr doppelt');
const appQuelle = fs.readFileSync(path.join(wurzel, 'app.js'), 'utf8');
ok(/Zeitrechnung\.soll/.test(appQuelle),       'SubmitOne rechnet das Soll im Kern');
ok(/Zeitrechnung\.ueberschneidung/.test(appQuelle), 'SubmitOne prüft Überschneidungen im Kern');

console.log('\n=== Erfasste Zeit je Tag ===');
[...proTag.keys()].sort().forEach(tag => {
  const min = proTag.get(tag).reduce((a, e) => a + (Number.isFinite(e.bis) ? e.bis - e.von - (e.pause || 0) : 0), 0);
  console.log('  ' + tag + '   ' + (min / 60).toFixed(2).replace('.', ',') + ' h in ' + proTag.get(tag).length + ' Einträgen');
});

console.log('\n  ' + (geprueft - fehler) + '/' + geprueft + ' geprüft'
  + (fehler ? '   ' + fehler + ' FEHLER' : '   alles grün') + '\n');
process.exit(fehler ? 1 : 0);
