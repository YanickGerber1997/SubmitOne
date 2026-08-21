// Hält es auch unter anderen Bedingungen? — die zweite Prüfrunde.
//
// zusammenspiel.js rechnet EINEN Zustand nach: die Römerstrasse, so wie
// sie heute eingestellt ist. Das lässt drei Fragen offen, und jede davon
// hat schon einmal etwas verborgen:
//
//   · Bleibt es gleich, wenn man dieselbe Handlung zweimal auslöst?
//   · Bleibt es gleich, wenn man an den Reglern dreht?
//   · Gilt es auch für die anderen Bauvorhaben — und für ein leeres?
//
// Geprüft werden deshalb Zusicherungen, nicht Zahlen: Was auch immer
// eingestellt ist, die Summe muss aufgehen.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const U = require('../submit/kern/uebersetzer.js');

const wurzel = path.join(__dirname, '..');
const projekteOrdner = path.join(wurzel, 'privat', 'Projekte');
if (!fs.existsSync(projekteOrdner)) { console.log('\n  Keine Projekte — übersprungen.\n'); process.exit(0); }

let fehler = 0, geprueft = 0;
const ok = (bed, was) => { geprueft++; if (!bed) { fehler++; console.log('  FEHLT: ' + was); } };
const f = n => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const gleich = (a, b, t) => Math.abs((a || 0) - (b || 0)) < (t || 0.05);

/* ---- Umgebung ---- */
const knoten = () => ({
  style: {}, dataset: {}, value: '', textContent: '', innerHTML: '',
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
  querySelector() { return null; }, querySelectorAll() { return []; },
  setAttribute() {}, getAttribute() { return null; }, focus() {}, blur() {},
  setSelectionRange() {}, select() {}, checked: false, files: [], scrollIntoView() {},
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; }
});
const fenster = { __html: '', document: { write(h) { fenster.__html += h; }, close() {} }, focus() {}, print() {}, close() {} };
const sp = {};
const ctx = {
  console, Intl, Date, Math, JSON, URL,
  document: { querySelector: () => knoten(), querySelectorAll: () => [], createElement: () => knoten(),
              getElementById: () => knoten(), addEventListener() {}, body: knoten(), documentElement: knoten(), head: knoten() },
  window: { addEventListener() {}, location: { hash: '', protocol: 'http:' }, print() {}, scrollTo() {},
            open() { fenster.__html = ''; return fenster; },
            matchMedia: () => ({ matches: false, addEventListener() {} }) },
  localStorage: { getItem: k => (k in sp ? sp[k] : null), setItem: (k, v) => { sp[k] = String(v); }, removeItem: k => { delete sp[k]; } },
  navigator: { userAgent: 'node' }, location: { hash: '', protocol: 'http:' },
  history: { replaceState() {}, pushState() {}, back() {} },
  requestAnimationFrame: fn => { try { fn(); } catch (_) {} return 0; },
  cancelAnimationFrame() {}, setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: () => Promise.reject(new Error('kein Netz')), __p: null
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
for (const s of ['submit/kern/zeitrechnung.js', 'submit/kern/uebersetzer.js', 'app.js'])
  vm.runInContext(fs.readFileSync(path.join(wurzel, s), 'utf8'), ctx, { filename: s });
vm.runInContext('save=function(){};render=function(){};', ctx);
const lauf = code => vm.runInContext(code, ctx);
const setze = projekt => { ctx.__p = projekt; lauf('state.projekte=[__p];'); };

/* Alle Bauvorhaben aus dem Arbeitsordner. */
const projekte = fs.readdirSync(projekteOrdner, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => path.join(projekteOrdner, d.name, d.name + '.submit'))
  .filter(fs.existsSync)
  .map(f2 => U.ausMappe(JSON.parse(fs.readFileSync(f2, 'utf8'))));

/* =====================================================================
   1. Dieselbe Handlung, zweimal ausgelöst
   ===================================================================== */

console.log('\n=== Zweimal verteilen ändert nichts ===');
const roem = projekte.find(x => /Römerstrasse/.test(x.name)) || projekte[0];
setze(JSON.parse(JSON.stringify(roem)));
const e1 = lauf('steuerZuweisen(__p, { jahre: steuerJahre(__p), ziele: __p.steuerZiel || {} })');
const nach1 = lauf('gewerkeSorted(__p).map(function(v){return v.id+":"+((v.steuer||{}).jahr||0);}).join("|")');
const e2 = lauf('steuerZuweisen(__p, { jahre: steuerJahre(__p), ziele: __p.steuerZiel || {} })');
const nach2 = lauf('gewerkeSorted(__p).map(function(v){return v.id+":"+((v.steuer||{}).jahr||0);}).join("|")');
console.log('  zugewiesen 1. Lauf ' + e1.zugewiesen + '   2. Lauf ' + e2.zugewiesen);
ok(nach1 === nach2, 'die Jahre stehen nach dem zweiten Lauf gleich');
ok(e1.restJahr === e2.restJahr && e1.eJahr === e2.eJahr, 'Auffang- und E-Jahr bleiben');

/* =====================================================================
   2. An den Reglern drehen
   ===================================================================== */

console.log('\n=== Egal wie gerundet wird, die Summe geht auf ===');
setze(roem);
const baukosten = lauf('gewerkeSorted(__p).reduce(function(a,v){return a+kostenZeile(v).prognose;},0)');
[0, 5000, 25000, 100000].forEach(schritt => {
  const r = lauf('bauherrPlan(__p, { grundlage:"alle", schritt:' + schritt + ' })');
  const summe = r.monate.reduce((a, m) => a + m.betrag, 0);
  const letzte = r.monate[r.monate.length - 1];
  console.log('  Schritt ' + String(schritt || 'haargenau').padEnd(9)
    + f(summe).padStart(14) + '   Schlusszahlung ' + f(letzte.betrag).padStart(12));
  ok(gleich(summe, r.total, 0.06), 'Schritt ' + schritt + ': die Monate ergeben das Total');
  ok(gleich(r.total, baukosten, 0.06), 'Schritt ' + schritt + ': das Total bleibt die Bausumme');
  ok(gleich(letzte.cum, r.total, 0.06), 'Schritt ' + schritt + ': der letzte Übertrag schliesst ab');
});

console.log('\n=== Egal welche Schwelle, kein Auftrag geht verloren ===');
[0, 5000, 25000, 50000].forEach(min => {
  const alle = lauf('unternehmerPlaene(__p, { min: ' + min + ', schritt: 0 })');
  const gross = alle.filter(g => !g.klein), klein = alle.filter(g => g.klein);
  const summe = alle.reduce((a, g) => a + g.betrag, 0);
  console.log('  Schwelle ' + String(min).padStart(6) + '   ' + String(gross.length).padStart(3) + ' mit Plan, '
    + String(klein.length).padStart(3) + ' ohne   ' + f(summe).padStart(14));
  ok(gleich(summe, baukosten), 'Schwelle ' + min + ': die Summe bleibt vollständig');
  ok(gross.length + klein.length === alle.length, 'Schwelle ' + min + ': jeder Auftrag ist auf einer Seite');
});

console.log('\n=== «nur vergebene» ist eine Teilmenge von «alle» ===');
const rAlle = lauf('bauherrPlan(__p, { grundlage:"alle" })');
const rVerg = lauf('bauherrPlan(__p, { grundlage:"vergeben" })');
console.log('  alle Gewerke    ' + f(rAlle.total).padStart(14) + '   ' + rAlle.rows.length + ' Positionen');
console.log('  nur vergebene   ' + f(rVerg.total).padStart(14) + '   ' + rVerg.rows.length + ' Positionen');
ok(rVerg.total <= rAlle.total + 0.05, 'die vergebenen sind nie mehr als alle');
ok(rVerg.rows.length <= rAlle.rows.length, 'und nie mehr Positionen');
const idsAlle = new Set(rAlle.rows.map(r => r.v.id));
ok(rVerg.rows.every(r => idsAlle.has(r.v.id)), 'jede vergebene Position steht auch in «alle»');

console.log('\n=== Ohne Rückbehalt bleibt die Summe dieselbe ===');
const mitRb = lauf('bauherrPlan(__p, { grundlage:"alle" })');
const ohneRb = lauf('(function(){ var z=zahlungsplanOf(__p), alt=z.rueckbehalt; z.rueckbehalt=0; var r=bauherrPlan(__p,{grundlage:"alle"}); z.rueckbehalt=alt; return r; })()');
console.log('  mit 10 %    ' + f(mitRb.total).padStart(14) + '   ' + mitRb.monate.length + ' Monate');
console.log('  ohne        ' + f(ohneRb.total).padStart(14) + '   ' + ohneRb.monate.length + ' Monate');
ok(gleich(mitRb.total, ohneRb.total, 0.06), 'der Rückbehalt verschiebt nur, er verändert die Summe nicht');
ok(ohneRb.monate.length <= mitRb.monate.length, 'ohne Rückbehalt braucht es keine späteren Monate mehr');

/* =====================================================================
   3. Der Weg durch die Datei
   ===================================================================== */

console.log('\n=== Der Plan übersteht Speichern und Laden ===');
const zurueck = U.ausMappe(U.zuMappe(roem));
setze(zurueck);
const rNach = lauf('bauherrPlan(__p, { grundlage:"alle" })');
setze(roem);
const rVor = lauf('bauherrPlan(__p, { grundlage:"alle" })');
console.log('  vor dem Speichern  ' + f(rVor.total).padStart(14) + '   ' + rVor.monate.length + ' Monate');
console.log('  nach dem Laden     ' + f(rNach.total).padStart(14) + '   ' + rNach.monate.length + ' Monate');
ok(gleich(rVor.total, rNach.total), 'die Summe überlebt den Weg durch die Datei');
ok(rVor.monate.length === rNach.monate.length, 'und die Monate ebenfalls');
ok(rVor.monate.map(m => m.key).join() === rNach.monate.map(m => m.key).join(), 'dieselben Monate in derselben Reihenfolge');

/* =====================================================================
   4. Die anderen Bauvorhaben — und ein leeres
   ===================================================================== */

console.log('\n=== Es gilt für jedes Bauvorhaben ===');
projekte.forEach(pr => {
  setze(pr);
  let r, u, s, absturz = '';
  try {
    r = lauf('bauherrPlan(__p, { grundlage:"alle" })');
    u = lauf('unternehmerPlaene(__p, { min: 0, schritt: 0 })');
    s = lauf('steuerPlan(__p)');
  } catch (err) { absturz = err.message; }

  if (absturz) { ok(false, pr.name + ': ' + absturz); return; }
  const bk = lauf('gewerkeSorted(__p).reduce(function(a,v){return a+kostenZeile(v).prognose;},0)');
  const uSum = u.reduce((a, g) => a + g.betrag, 0);
  console.log('  ' + String(pr.name).slice(0, 28).padEnd(30)
    + f(bk).padStart(14) + '   ' + String(r.monate.length).padStart(3) + ' Mt   '
    + String(u.length).padStart(3) + ' Aufträge');
  /* Die richtige Zusicherung ist nicht «der Plan deckt alles» — ohne
     Bautermine KANN er nicht. Sie lautet: Was nicht im Plan steht, ist
     als fehlend ausgewiesen. Nichts darf stillschweigend verschwinden.
     Beim Kunoweg 20 hat kein einziges Gewerk Termine; der Plan ist dort
     zu Recht leer, und die 126'000 stehen in `fehlend`. */
  const fehltDort = r.fehlend.reduce((a, x) => a + x.betrag, 0);
  if (fehltDort > 0.05) console.log('      davon ohne Termin: ' + f(fehltDort));
  ok(gleich(r.total + fehltDort, bk, 0.06),
     pr.name + ': Plan plus Ausgewiesenes ergibt die Baukosten');
  ok(gleich(uSum, bk, 0.06), pr.name + ': die Aufträge decken die Baukosten');
  ok(s.rows.length <= (pr.vergaben || []).length, pr.name + ': die Steuerzeilen bleiben in der Zahl der Positionen');
});

console.log('\n=== Ein leeres Bauvorhaben wirft nichts um ===');
[{ id: 'leer1', name: 'Ohne alles', vergaben: [] },
 { id: 'leer2', name: 'Ohne Termine', vergaben: [{ id: 'a', bkp: '211', gewerk: 'X', betrag: 1000, status: 'vergeben' }] },
 { id: 'leer3', name: 'Ohne Betrag', vergaben: [{ id: 'a', bkp: '211', gewerk: 'X', betrag: 0, status: 'offen', bauStart: '2026-01-01', bauEnde: '2026-02-01' }] }
].forEach(pr => {
  setze(pr);
  let meldung = '';
  try {
    const r = lauf('bauherrPlan(__p, { grundlage:"alle" })');
    const u = lauf('unternehmerPlaene(__p, { min: 0, schritt: 0 })');
    const s = lauf('steuerPlan(__p)');
    const z = lauf('steuerZuweisen(__p, { jahre: steuerJahre(__p), ziele: {} })');
    console.log('  ' + pr.name.padEnd(16) + r.monate.length + ' Monate, ' + u.length + ' Aufträge, '
      + s.rows.length + ' Steuerzeilen, ' + z.rows.length + ' verteilt');
  } catch (err) { meldung = err.message; }
  ok(!meldung, pr.name + ' rechnet ohne Absturz' + (meldung ? ': ' + meldung : ''));
});

/* =====================================================================
   5. Jeder Druckumfang ergibt ein vollständiges Dokument
   ===================================================================== */

console.log('\n=== Jeder Druckumfang ist in sich vollständig ===');
setze(roem);
const drucke = umfang => {
  fenster.__html = '';
  lauf('(function(){ var z=zahlungsplanOf(__p); z.modus="bauherr";'
     + ' pdfZahlungsplanBauherr(__p, z, { umfang: "' + umfang + '" }); })()');
  return fenster.__html;
};
['bauherr', 'steuern', 'unternehmer', 'alle'].forEach(umfang => {
  const h = drucke(umfang);
  const seiten = (h.match(/class="blatt"/g) || []).length;
  const koepfe = (h.match(/class="zk"/g) || []).length;
  const fuesse = (h.match(/class="zf"/g) || []).length;
  const letzte = h.indexOf('Seite ' + seiten + ' von ' + seiten) >= 0;
  console.log('  ' + umfang.padEnd(12) + String(seiten).padStart(3) + ' Seiten   '
    + (letzte ? 'Zählung schliesst ab' : 'ZÄHLUNG UNVOLLSTÄNDIG'));
  ok(seiten > 0, umfang + ': es entsteht mindestens eine Seite');
  if (umfang === 'bauherr' || umfang === 'alle') {
    /* Fehlt etwas im Plan, muss es AUF dem Blatt stehen — nicht nur auf
       dem Bildschirm. */
    const fehltHier = rAlle.fehlend.reduce((a, x) => a + x.betrag, 0);
    if (fehltHier > 0.05) ok(/nicht enthalten/.test(h), umfang + ': das Fehlende ist auf dem Blatt vermerkt');
  }
  ok(koepfe === seiten && fuesse === seiten, umfang + ': Kopf und Fuss auf jeder Seite');
  ok(letzte, umfang + ': die Seitenzählung geht bis zur letzten Seite auf');
  ok(/function umbrechen/.test(h), umfang + ': der messende Umbruch fährt mit');
});

console.log('\n  ' + (geprueft - fehler) + '/' + geprueft + ' geprüft'
  + (fehler ? '   ' + fehler + ' FEHLER' : '   alles grün') + '\n');
process.exit(fehler ? 1 : 0);
