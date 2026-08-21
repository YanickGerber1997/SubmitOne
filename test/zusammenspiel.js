// Passt alles zusammen? — Zahlungsplan, Unternehmer, Honorar, Steuern, Druck.
//
// Warum es diesen Test gibt
// -------------------------
// Am Zahlungsplan wurde in kurzer Zeit viel gebaut: Bauherrnplan,
// Unternehmerblätter, Garantierückbehalt, Steuerjahre, vier Druckumfänge.
// Jedes Stück für sich ist geprüft. Der Fehler, der dabei entsteht, sitzt
// aber zwischen den Stücken — und genau der ist an diesem Tag dreimal
// aufgetreten:
//
//   · Bauherrnplan und Unternehmerplan kannten verschiedene Termine
//   · geplanter Plan und «Stand heute» kannten verschiedene Monate
//   · Steuertabelle und Verteilung kannten verschiedene Prozentsätze
//
// Dreimal dasselbe Muster: zwei Wege, eine Frage, zwei Antworten. Dieser
// Test rechnet die Zusammenhänge nach, an echten Zahlen.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const U = require('../submit/kern/uebersetzer.js');

const wurzel = path.join(__dirname, '..');
const datei = path.join(wurzel, 'privat', 'Projekte',
  'Umbau EFH Römerstrasse 31', 'Umbau EFH Römerstrasse 31.submit');
if (!fs.existsSync(datei)) { console.log('\n  Kein Projekt zum Prüfen — übersprungen.\n'); process.exit(0); }

const p = U.ausMappe(JSON.parse(fs.readFileSync(datei, 'utf8')));
const allgPfad = path.join(wurzel, 'privat', 'Projekte', 'Allgemein.subone');
const allg = fs.existsSync(allgPfad) ? JSON.parse(fs.readFileSync(allgPfad, 'utf8')) : {};

let fehler = 0, geprueft = 0;
const ok = (bed, was) => { geprueft++; if (!bed) { fehler++; console.log('  FEHLT: ' + was); } };
const f = n => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const gleich = (a, b, toleranz) => Math.abs((a || 0) - (b || 0)) < (toleranz || 0.05);

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
  fetch: () => Promise.reject(new Error('kein Netz')),
  __p: p, __b: allg.buero || {}
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
for (const s of ['submit/kern/zeitrechnung.js', 'submit/kern/uebersetzer.js', 'app.js'])
  vm.runInContext(fs.readFileSync(path.join(wurzel, s), 'utf8'), ctx, { filename: s });
vm.runInContext('save=function(){};render=function(){};state.projekte=[__p];state.buero=__b;', ctx);
const lauf = code => vm.runInContext(code, ctx);

/* =====================================================================
   1. Die Baukosten — eine Zahl, überall dieselbe
   ===================================================================== */

console.log('\n=== Die Baukosten sind überall dieselbe Zahl ===');
const baukosten = lauf('gewerkeSorted(__p).reduce((a,v)=>a+kostenZeile(v).prognose,0)');
const bp = lauf('bauherrPlan(__p, { grundlage: "alle" })');
console.log('  Summe aller Positionen   ' + f(baukosten).padStart(14));
console.log('  Zahlungsplan Bauherr     ' + f(bp.total).padStart(14));
ok(gleich(baukosten, bp.total), 'der Bauherrnplan deckt die ganzen Baukosten');

const monatsSumme = bp.monate.reduce((a, m) => a + m.betrag, 0);
console.log('  Summe der Monate         ' + f(monatsSumme).padStart(14));
ok(gleich(monatsSumme, bp.total), 'die Monate summieren sich auf das Total');
ok(bp.fehlend.length === 0, 'keine Position fällt aus dem Plan');

/* =====================================================================
   2. Bauherr und Unternehmer beschreiben dasselbe Bauvorhaben
   ===================================================================== */

console.log('\n=== Bauherr und Unternehmer decken sich ===');
const alle = lauf('unternehmerPlaene(__p, { min: 0, schritt: 0 })');
const untSumme = alle.reduce((a, g) => a + g.betrag, 0);
console.log('  Auftragseinheiten        ' + String(alle.length).padStart(14));
console.log('  Summe aller Aufträge     ' + f(untSumme).padStart(14));
ok(gleich(untSumme, baukosten), 'jede Position steckt in genau einer Auftragseinheit');

/* Und wirklich in genau EINER — nicht in zweien, nicht in keiner. */
const gezaehlt = new Map();
alle.forEach(g => g.positionen.forEach(v => gezaehlt.set(v.id, (gezaehlt.get(v.id) || 0) + 1)));
const doppelt = [...gezaehlt.entries()].filter(([, n]) => n > 1);
const mitBetrag = lauf('gewerkeSorted(__p).filter(v=>kostenZeile(v).prognose>0).map(v=>v.id)');
const fehlend = mitBetrag.filter(id => !gezaehlt.has(id));
console.log('  doppelt zugeordnet       ' + String(doppelt.length).padStart(14));
console.log('  gar nicht zugeordnet     ' + String(fehlend.length).padStart(14));
ok(doppelt.length === 0, 'keine Position steht in zwei Aufträgen');
ok(fehlend.length === 0, 'keine Position fehlt in allen Aufträgen');

/* Die Monatsbeträge der Unternehmer müssen dieselbe Summe ergeben. */
const untMonate = alle.reduce((a, g) => a + g.monate.reduce((b, m) => b + m.betrag, 0), 0);
console.log('  Summe Unternehmermonate  ' + f(untMonate).padStart(14));
ok(gleich(untMonate, baukosten, 1), 'auch monatsweise geht es auf');

/* =====================================================================
   3. Unser eigenes Honorar
   ===================================================================== */

console.log('\n=== Das eigene Honorar ist eine Position wie jede andere ===');
const hon = alle.find(g => /hefti/i.test(g.firma || g.name));
if (hon) {
  console.log('  ' + (hon.firma || hon.name) + '   ' + f(hon.betrag)
    + '   ' + hon.positionen.length + ' Position(en)');
  hon.positionen.forEach(v => console.log('     ' + String(v.bkp).padEnd(7)
    + String(v.gewerk).slice(0, 30).padEnd(32) + f(lauf('kostenZeile(findVergabe(__p,"' + v.id + '")).prognose'))));
  ok(hon.betrag > 0, 'das Honorar steht mit einem Betrag im Plan');
  /* Es darf nicht aus dem Monatsplan fallen — auch wenn es keine
     Bautermine hat, sondern eine Zeitlage. */
  const honMonate = hon.monate.reduce((a, m) => a + m.betrag, 0);
  console.log('  davon verteilt           ' + f(honMonate).padStart(14));
  ok(gleich(honMonate, hon.betrag, 1), 'und ist vollständig auf Monate verteilt');
  ok(hon.ohneTermin < 0.05, 'nichts davon bleibt ohne Termin liegen');
} else {
  ok(false, 'das eigene Honorar wurde im Plan nicht gefunden');
}

/* =====================================================================
   4. Der Garantierückbehalt
   ===================================================================== */

console.log('\n=== Der Rückbehalt ist vollständig und liegt richtig ===');
const rbTeile = [];
bp.monate.forEach(m => (m.teile || []).forEach(t => { if (t.rueckbehalt) rbTeile.push({ m: m.key, t }); }));
const rbSumme = rbTeile.reduce((a, x) => a + x.t.anteil, 0);
const rbErwartet = lauf(`
  (function(){ var z = zahlungsplanOf(__p), std = zpRueckbehalt(z), s = 0;
    gewerkeSorted(__p).forEach(function(v){
      var b = kostenZeile(v).prognose; if (b <= 0) return;
      s += rp5(b * rueckbehaltVon(v, std)); });
    return s; })()`);
console.log('  einbehalten (im Plan)    ' + f(rbSumme).padStart(14) + '   ' + rbTeile.length + ' Positionen');
console.log('  erwartet (10 % je Pos.)  ' + f(rbErwartet).padStart(14));
ok(gleich(rbSumme, rbErwartet, 1), 'der Rückbehalt ist vollständig im Plan');

/* Jeder Rückbehalt liegt im Schlussrechnungsmonat SEINER Position. */
const falschGelegen = rbTeile.filter(x =>
  lauf('schlussMonatVon(findVergabe(__p,"' + x.t.v.id + '"), projektMonate(__p))') !== x.m);
console.log('  im falschen Monat        ' + String(falschGelegen.length).padStart(14));
ok(falschGelegen.length === 0, 'jeder Rückbehalt liegt im Monat seiner Schlussrechnung');

/* =====================================================================
   5. «Stand heute» erzählt dieselbe Geschichte
   ===================================================================== */

console.log('\n=== Geplant und «Stand heute» ===');
const ist = lauf('bauherrPlanIst(__p, { grundlage: "alle" })');
console.log('  Soll                     ' + f(ist.soll).padStart(14));
console.log('  bereits verrechnet       ' + f(ist.ist).padStart(14));
console.log('  Rest                     ' + f(ist.rest).padStart(14));
ok(gleich(ist.soll, baukosten), 'das Soll ist dieselbe Bausumme');
ok(gleich(ist.ist + ist.rest, ist.soll, 1), 'verrechnet plus Rest ergibt das Soll');
const istMonate = ist.monate.reduce((a, m) => a + m.betrag, 0);
ok(gleich(istMonate, ist.soll, 1), 'auch hier summieren sich die Monate auf das Soll');

const mGeplant = new Set(bp.monate.map(m => m.key));
const mIst = new Set(ist.monate.map(m => m.key));
const nurIm = [...mIst].filter(k => !mGeplant.has(k) && k >= bp.monate[0].key);
console.log('  Monate geplant/Stand     ' + mGeplant.size + ' / ' + mIst.size);
ok([...mGeplant].filter(k => !mIst.has(k) && k >= new Date().toISOString().slice(0, 7)).length === 0,
   'kein künftiger Monat des Plans fehlt im «Stand heute»');

/* =====================================================================
   6. Die Steuern
   ===================================================================== */

console.log('\n=== Steuern: Zeilen, Jahre und Verteilung stimmen überein ===');
const st = lauf('steuerPlan(__p)');
const zeilenAbz = st.rows.reduce((a, r) => a + r.abziehbar, 0);
const jahreAbz = st.jahre.reduce((a, j) => a + j.abziehbar, 0);
console.log('  abziehbar (Zeilen)       ' + f(zeilenAbz).padStart(14));
console.log('  abziehbar (Jahre)        ' + f(jahreAbz).padStart(14));
ok(gleich(zeilenAbz, jahreAbz, 1), 'die Jahressummen decken sich mit den Zeilen');

const zw = lauf('steuerZuweisen(__p, { jahre: steuerJahre(__p), ziele: __p.steuerZiel || {} })');
const nachJahr = {};
zw.rows.forEach(r => { if (r.jahr) nachJahr[r.jahr] = (nachJahr[r.jahr] || 0) + r.abziehbar; });
const st2 = lauf('steuerPlan(__p)');
console.log('\n  JAHR   TABELLE          VERTEILUNG       ZIEL');
st2.jahre.forEach(j => {
  const v = nachJahr[j.jahr] || 0;
  const ziel = (p.steuerZiel || {})[j.jahr] || 0;
  console.log('  ' + j.jahr + '   ' + f(j.abziehbar).padStart(14) + '   ' + f(v).padStart(14)
    + '   ' + (ziel ? f(ziel).padStart(12) : '—'.padStart(12)));
  ok(gleich(j.abziehbar, v, 1), j.jahr + ': Tabelle und Verteilung rechnen gleich');
  if (ziel) ok(j.abziehbar <= ziel + 0.5, j.jahr + ': das Ziel wird nicht überschritten');
});

/* Kein Steuerjahr in der Vergangenheit. */
const heuteJahr = Number(new Date().toISOString().slice(0, 4));
const zurueck = zw.rows.filter(r => r.jahr && r.jahr < heuteJahr && !(r.v.rechnungen || []).some(x => x.art === 'schluss'));
console.log('  in abgelaufenen Jahren   ' + String(zurueck.length).padStart(14));
ok(zurueck.length === 0, 'nichts wird in ein abgelaufenes Jahr geschoben');

/* =====================================================================
   7. Gedruckt steht dasselbe wie gerechnet
   ===================================================================== */

console.log('\n=== Der Ausdruck zeigt dieselben Zahlen ===');
const drucke = code => { fenster.__html = ''; lauf(code); return fenster.__html; };
const html = drucke('var z=zahlungsplanOf(__p); z.modus="bauherr"; pdfZahlungsplanBauherr(__p, z, {umfang:"alle"});');

/* Die Gesamtsumme muss so im Blatt stehen, wie sie gerechnet wurde. */
/* …in der Setzung des Programms, nicht in einer nachgebauten: Es rundet
   auf fünf Rappen, und wer das im Test nachbildet, prüft am Ende seine
   eigene Nachbildung statt das Programm. */
const imBlatt = (html.match(/class="ek-gross">([^<]+)</) || [])[1] || '';
const alsZahl = s => Number(String(s).replace(/[^\d.,-]/g, '').replace(/'/g, '').replace(',', '.'));
const gedruckt = alsZahl(imBlatt);
const erwartet = lauf('inAnsicht(' + baukosten + ')');
console.log('  Gesamtbetrag im Blatt    ' + String(imBlatt).trim().padStart(14));
console.log('  erwartet (' + lauf('ansichtNote()') + ')      ' + f(erwartet).padStart(14));
ok(!!imBlatt, 'der Gesamtbetrag steht im Blatt');
/* Fünf Rappen Spielraum: Der geplante Plan und der «Stand heute» runden
   an verschiedenen Stellen auf fünf Rappen und weichen deshalb um zwei
   Rappen voneinander ab. Auf 800'000 Franken ist das keine Aussage. */
ok(gleich(gedruckt, erwartet, 0.06), 'und entspricht den Baukosten in der gewählten Ansicht');

/* Jede Auftragseinheit über der Schwelle bekommt genau ein Blatt. */
const z = lauf('zahlungsplanOf(__p)');
const gross = lauf('unternehmerPlaene(__p, { min: Number(zahlungsplanOf(__p).untSchwelle)||0, schritt: Number(zahlungsplanOf(__p).untSchritt)||0 }).filter(function(g){return !g.klein;})');
const blaetterUnt = (html.match(/Auftragssumme/g) || []).length;
console.log('  Unternehmer über Schwelle ' + String(gross.length).padStart(13));
console.log('  Blätter im Dokument       ' + String(blaetterUnt).padStart(13));
ok(blaetterUnt === gross.length, 'jeder bekommt genau ein Blatt');

/* Kopf und Fuss auf jeder Seite, Seitenzahlen lückenlos. */
const seiten = (html.match(/class="blatt"/g) || []).length;
ok((html.match(/class="zk"/g) || []).length === seiten, 'ein Kopf je Seite');
ok((html.match(/class="zf"/g) || []).length === seiten, 'eine Fusszeile je Seite');
for (let i = 1; i <= seiten; i++) {
  if (html.indexOf('Seite ' + i + ' von ' + seiten) < 0) { ok(false, 'Seite ' + i + ' fehlt in der Zählung'); break; }
  if (i === seiten) ok(true, 'die Seitenzahlen laufen lückenlos von 1 bis ' + seiten);
}

/* Das Steuerblatt gehört dazu und zeigt dieselben Jahre. */
ok(/Steuerliche Zuteilung/.test(html), 'die steuerliche Zuteilung liegt bei');
st2.jahre.forEach(j => ok(html.indexOf('Steuerjahr ' + j.jahr) >= 0,
  'das Steuerblatt führt ' + j.jahr));

/* Und die Mehrwertsteuer ist einheitlich angeschrieben. */
const note = lauf('ansichtNote()');
console.log('  Anschrift MwSt           ' + note.padStart(14));
ok(html.indexOf(note) >= 0, 'die MwSt-Anschrift steht im Blatt');
ok(!/inkl\. 8\.1 % MwSt[\s\S]{0,40}exkl\. MwSt/.test(html.replace(/<[^>]*>/g, ' ')),
   'und widerspricht sich nicht');

console.log('\n  ' + (geprueft - fehler) + '/' + geprueft + ' geprüft'
  + (fehler ? '   ' + fehler + ' FEHLER' : '   alles grün') + '\n');
process.exit(fehler ? 1 : 0);
