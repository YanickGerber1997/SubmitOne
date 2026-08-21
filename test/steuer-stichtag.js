// Prüft, dass «Jetzt verteilen» nicht in die Vergangenheit schiebt.
//
// Warum es diesen Test gibt
// -------------------------
// Am 14.08.2026 schob die Verteilung sämtliche 35 Positionen der
// Römerstrasse ins Jahr 2025 — obwohl dort nur das Baugespann für 638
// Franken endete und alles Übrige erst im Herbst 2026 fertig wird. Das
// Blatt sah aufgeräumt aus und war frei erfunden.
//
// Zwei Schranken folgen aus der Sache, und beide fehlten:
//   · nicht in ein vergangenes Jahr — der Kalender ist weiter
//   · nicht bevor die Arbeiten fertig sind
// Dazu die dritte, die schon galt: Eine gestellte Schlussrechnung trägt
// ihr Datum auf dem Papier beim Unternehmer und ist unverrückbar.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const wurzel = path.join(__dirname, '..');
let fehler = 0, geprueft = 0;
const ok = (bed, was) => { geprueft++; if (!bed) { fehler++; console.log('  FEHLT: ' + was); } };

/* ---- Die App in einer Attrappe, mit gestellter Uhr ---- */
const knoten = () => ({
  style: {}, dataset: {}, value: '', textContent: '', innerHTML: '',
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
  querySelector() { return null; }, querySelectorAll() { return []; },
  setAttribute() {}, getAttribute() { return null; }, focus() {}, blur() {},
  setSelectionRange() {}, select() {}, checked: false, files: [], scrollIntoView() {},
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; }
});
const speicher = {};
const ctx = {
  console, Intl, Date, Math, JSON, URL,
  document: {
    querySelector() { return knoten(); }, querySelectorAll() { return []; },
    createElement() { return knoten(); }, getElementById() { return knoten(); },
    addEventListener() {}, body: knoten(), documentElement: knoten(), head: knoten()
  },
  window: { addEventListener() {}, location: { hash: '', protocol: 'http:' }, print() {}, scrollTo() {},
            matchMedia() { return { matches: false, addEventListener() {} }; } },
  localStorage: { getItem: k => (k in speicher ? speicher[k] : null), setItem: (k, v) => { speicher[k] = String(v); }, removeItem: k => { delete speicher[k]; } },
  navigator: { userAgent: 'node' }, location: { hash: '', protocol: 'http:' },
  history: { replaceState() {}, pushState() {}, back() {} },
  requestAnimationFrame: fn => { try { fn(); } catch (_) {} return 0; },
  cancelAnimationFrame() {}, setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: () => Promise.reject(new Error('kein Netz')),
  __heute: '2026-08-14', __erg: null, __p: null
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);

for (const s of ['submit/kern/zeitrechnung.js', 'submit/kern/uebersetzer.js', 'app.js']) {
  try { vm.runInContext(fs.readFileSync(path.join(wurzel, s), 'utf8'), ctx, { filename: s }); }
  catch (e) { console.log('\n  ' + s + ': ' + e.message + '\n'); process.exit(1); }
}

/* Die Uhr anhalten: Der Test darf nicht nächstes Jahr etwas anderes
   behaupten als heute. */
vm.runInContext(`
  todayIso = function () { return __heute; };
  save = function () {};
  render = function () {};
`, ctx);

function verteile(vergaben, einst) {
  ctx.__p = Object.assign({ id: 'p1', name: 'Test', vergaben }, einst || {});
  return vm.runInContext(`
    state.projekte = [__p];
    steuerZuweisen(__p, { jahre: steuerJahre(__p), ziele: __p.steuerZiel || {} });
  `, ctx);
}
const pos = (id, bkp, betrag, bauEnde, art, extra) =>
  Object.assign({ id, bkp, gewerk: bkp, betrag, status: 'vergeben', bauEnde,
                  steuer: { art } }, extra || {});

const jahrVon = (e, id) => (e.rows.find(r => r.v.id === id) || {}).jahr;
const grundVon = (e, id) => (e.rows.find(r => r.v.id === id) || {}).grund || '';

console.log('\n=== Heute ist der ' + ctx.__heute + ' ===');

/* -------------------------------------------------------------------
   1. Nicht in ein vergangenes Jahr
   ------------------------------------------------------------------- */
console.log('\n=== Ein abgelaufenes Jahr nimmt nichts mehr auf ===');
let e = verteile([
  pos('a', '211', 100000, '2026-11-20', 'unterhalt'),
  pos('b', '230', 50000, '2026-12-11', 'unterhalt')
], { steuerZiel: { 2025: 500000 }, steuerAuffang: 2027 });

console.log('  2025 Ziel 500\'000, beide Positionen enden Ende 2026');
[['a', 100000], ['b', 50000]].forEach(([id]) => {
  const j = jahrVon(e, id);
  console.log('    ' + id + ' → ' + j + '   ' + grundVon(e, id));
  ok(j >= 2026, id + ' landet nicht im abgelaufenen 2025');
});

/* -------------------------------------------------------------------
   2. Nicht bevor die Arbeiten fertig sind
   ------------------------------------------------------------------- */
console.log('\n=== Nicht schlussrechnen, was noch gebaut wird ===');
e = verteile([
  pos('frueh', '211', 20000, '2026-09-04', 'unterhalt'),
  pos('spaet', '250', 20000, '2028-06-30', 'unterhalt')
], { steuerZiel: { 2026: 500000 }, steuerAuffang: 2029 });

console.log('    fertig 2026 → ' + jahrVon(e, 'frueh'));
console.log('    fertig 2028 → ' + jahrVon(e, 'spaet'));
ok(jahrVon(e, 'frueh') === 2026, 'was 2026 fertig wird, darf ins 2026');
ok(jahrVon(e, 'spaet') >= 2028, 'was erst 2028 fertig wird, kann nicht 2026 schlussgerechnet werden');

/* Und jetzt so, dass die Sperre wirklich zieht: Das Auffangjahr liegt
   VOR dem Bauende. Sie muss die Position anheben und sagen, weshalb. */
e = verteile([
  pos('zieht', '250', 20000, '2028-06-30', 'unterhalt'),
  pos('mit',   '211', 10000, '2026-05-30', 'unterhalt')
], { steuerZiel: {}, steuerAuffang: 2026 });
console.log('    Auffangjahr 2026, aber fertig erst 2028 → ' + jahrVon(e, 'zieht'));
console.log('    ' + grundVon(e, 'zieht'));
ok(jahrVon(e, 'zieht') >= 2028, 'die Sperre hebt sie über das Auffangjahr hinaus');
ok(/frühestens 2028/.test(grundVon(e, 'zieht')), 'und der Grund sagt, warum');

/* -------------------------------------------------------------------
   3. Eine gestellte Schlussrechnung ist unverrückbar
   ------------------------------------------------------------------- */
console.log('\n=== Was gestellt ist, bleibt stehen ===');
e = verteile([
  pos('sr', '287', 30000, '2026-03-04', 'unterhalt',
      { rechnungen: [{ id: 'r1', art: 'schluss', betrag: 30000, datum: '2026-03-20', bezahlt: true }] })
], { steuerZiel: { 2027: 500000 }, steuerAuffang: 2027 });
console.log('    Schlussrechnung vom 20.03.2026 → ' + jahrVon(e, 'sr'));
console.log('    ' + grundVon(e, 'sr'));
ok(jahrVon(e, 'sr') === 2026, 'das Jahr folgt dem Rechnungsdatum, nicht dem Ziel');
ok(/bereits/.test(grundVon(e, 'sr')), 'und es steht dabei, weshalb');

/* -------------------------------------------------------------------
   4. Die Regel aus dem Fall: E ins 2027, 1:1 bis 200'000 ins 2026
   ------------------------------------------------------------------- */
console.log('\n=== Der Fall Römerstrasse: E ins 2027, 200\'000 1:1 ins 2026 ===');
e = verteile([
  pos('e1', '221.2', 44322.05, '2026-10-09', 'energie'),
  pos('e2', '237',   32608.35, '2026-09-11', 'energie'),
  pos('u1', '258',   64929.55, '2026-11-13', 'unterhalt'),
  pos('u2', '250',   34650.00, '2026-11-20', 'unterhalt'),
  pos('u3', '282.4', 30000.00, '2026-11-06', 'unterhalt'),
  pos('u4', '230',   29314.55, '2026-11-20', 'unterhalt'),
  pos('u5', '272',   16855.50, '2026-11-27', 'unterhalt'),
  pos('u6', '285.1', 16440.75, '2026-11-27', 'unterhalt'),
  pos('u7', '281.6', 20216.40, '2026-11-06', 'unterhalt')
], { steuerZiel: { 2026: 200000 }, steuerAuffang: 2027, steuerEJahr: 2027 });

const proJ = {};
e.rows.forEach(r => { if (r.jahr) proJ[r.jahr] = (proJ[r.jahr] || 0) + r.betrag; });
Object.entries(proJ).sort().forEach(([j, s]) =>
  console.log('    ' + j + '   ' + new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2 }).format(s)));

ok(jahrVon(e, 'e1') === 2027 && jahrVon(e, 'e2') === 2027, 'jede E-Position geht ins 2027');
ok(!proJ[2025], 'nichts landet im abgelaufenen 2025');
const imSechsundzwanzig = e.rows.filter(r => r.jahr === 2026);
const summe26 = imSechsundzwanzig.reduce((a, r) => a + r.betrag, 0);
console.log('    1:1 im 2026: ' + summe26.toFixed(2) + ' von 200\'000');
ok(summe26 <= 200000.05, 'das Ziel 2026 wird nicht überschritten');
ok(imSechsundzwanzig.every(r => r.art !== 'energie'), 'im 2026 steht keine E-Position');
ok(e.rows.filter(r => r.jahr === 2027).length > 0, 'der Rest geht ins 2027');

/* -------------------------------------------------------------------
   5. Die Schlussrechnung fällt in den Januar des Steuerjahrs
   ------------------------------------------------------------------- */
console.log('\n=== Schlussrechnung im Januar, nicht im Dezember ===');
ctx.__p = {
  id: 'p2', name: 'T', vergaben: [
    { id: 'x', bkp: '250', gewerk: 'Sanitär', betrag: 50000, status: 'vergeben',
      bauStart: '2026-09-01', bauEnde: '2026-11-30', steuer: { art: 'unterhalt', jahr: 2027 } }
  ]
};
const bp = vm.runInContext('state.projekte=[__p]; bauherrPlan(__p, {})', ctx);
const sr = bp.rows[0].schlussMonat;
console.log('    Bauende 30.11.2026, Steuerjahr 2027  →  Schlussrechnung ' + sr);
ok(sr === '2027-01', 'sie fällt in den Januar des Steuerjahrs');
/* Die Akontozahlungen folgen weiter dem Baufortschritt — sie sind
   steuerlich neutral, und wer sie verschöbe, stellte der Bank die
   Liquidität falsch dar. Was in den Januar 2027 wandert, ist der
   Garantierückbehalt: einbehalten bis zur Schlussrechnung, dort zahlbar,
   und dort steuerlich wirksam. */
console.log('    Zahlungsmonate: ' + bp.monate.map(m => m.key + ' ' + m.betrag.toFixed(2)).join('  |  '));
const bau = bp.monate.filter(m => m.key <= '2026-11');
const januar = bp.monate.find(m => m.key === '2027-01');
ok(bau.length === 3, 'die Akontozahlungen bleiben in den drei Baumonaten');
ok(!!januar, 'im Januar 2027 steht eine Zahlung');
ok(Math.abs(januar.betrag - 5000) < 0.05, 'nämlich der Rückbehalt von 10 % auf 50\'000');
ok(Math.abs(bau.reduce((a, m) => a + m.betrag, 0) - 45000) < 0.05, 'die übrigen 45\'000 laufen mit dem Bau');
ok((januar.teile || []).some(t => t.rueckbehalt), 'und sie ist als Rückbehalt bezeichnet');

/* -------------------------------------------------------------------
   6. Beide Zahlungspläne antworten gleich
   -------------------------------------------------------------------
   Der geplante und der «Stand heute» sind zwei Funktionen für dieselbe
   Frage. Am 14.08.2026 wich der zweite ab: Er kannte weder Rückbehalt
   noch Schlussrechnungsmonat, und im Ausdruck fehlte der Januar 2027
   samt dem ganzen Rückbehalt.
   ------------------------------------------------------------------- */
console.log('\n=== Geplant und «Stand heute» kennen dieselben Monate ===');
ctx.__p = {
  id: 'p3', name: 'T', vergaben: [
    { id: 'x', bkp: '250', gewerk: 'Sanitär', betrag: 50000, status: 'vergeben',
      bauStart: '2026-09-01', bauEnde: '2026-11-30', steuer: { art: 'unterhalt', jahr: 2027 },
      /* Vor dem Stichtag (14.08.2026) — nur dann zählt sie als bereits
         verrechnet. Was danach datiert ist, gehört in den Plan. */
      rechnungen: [{ id: 'r1', art: 'akonto', betrag: 10000, datum: '2026-06-30', bezahlt: true }] }
  ]
};
const geplant = vm.runInContext('state.projekte=[__p]; bauherrPlan(__p, {})', ctx);
const stand   = vm.runInContext('bauherrPlanIst(__p, { stichtag: __heute })', ctx);
const mg = geplant.monate.map(m => m.key), ms = stand.monate.map(m => m.key);
console.log('    geplant:      ' + mg.join(', '));
console.log('    Stand heute:  ' + ms.join(', '));
ok(mg.indexOf('2027-01') >= 0, 'der geplante Plan kennt den Januar 2027');
ok(ms.indexOf('2027-01') >= 0, 'der «Stand heute» ebenfalls — vorher fehlte er');

const rbStand = stand.monate.find(m => m.key === '2027-01');
console.log('    Rückbehalt im Januar 2027: ' + (rbStand ? rbStand.betrag.toFixed(2) : '—'));
ok(rbStand && Math.abs(rbStand.betrag - 4000) < 0.05,
   '10 % auf die ausstehenden 40\'000 — die 10\'000 Akonto sind schon geflossen');
ok((rbStand.teile || []).some(t => t.rueckbehalt), 'und er ist als Rückbehalt bezeichnet');

console.log('\n=== Ein Jahr mit Zahlungen bleibt sichtbar ===');
ctx.__p = {
  id: 'p4', name: 'T', vergaben: [
    { id: 'y', bkp: '211', gewerk: 'Baumeister', betrag: 80000, status: 'vergeben',
      bauStart: '2026-03-01', bauEnde: '2026-10-31', steuer: { art: 'unterhalt', jahr: 2027 },
      rechnungen: [{ id: 'r2', art: 'akonto', betrag: 9000, datum: '2025-12-10', bezahlt: true }] }
  ],
  steuerZiel: { 2027: 0 }
};
const jahre = vm.runInContext('state.projekte=[__p]; steuerJahre(__p)', ctx);
console.log('    Steuerjahre: ' + jahre.join(', '));
ok(jahre.indexOf(2025) >= 0, '2025 steht in der Tabelle, weil dort gezahlt wurde');
ok(jahre.indexOf(2027) >= 0, 'und 2027, weil dort schlussgerechnet wird');

/* -------------------------------------------------------------------
   7. Verteilung und Tabelle rechnen mit demselben Prozentsatz
   -------------------------------------------------------------------
   Bei «anteilig» ohne eigenen Satz gilt die nach Merkblatt 11.3 a
   berechnete Quote. Die Tabelle zeigte sie, die Verteilung rechnete mit
   null — das Ziel 2026 galt als gefüllt, während die Tabelle «89'315
   darüber» meldete, und kein noch so häufiges «Jetzt verteilen» konnte
   das auflösen.
   ------------------------------------------------------------------- */
console.log('\n=== Verteilung und Tabelle rechnen gleich ===');
ctx.__p = {
  id: 'p5', name: 'T',
  vergaben: [
    { id: 'u', bkp: '250', gewerk: 'Sanitär',    betrag: 100000, status: 'vergeben', bauEnde: '2026-10-31', steuer: { art: 'unterhalt' } },
    { id: 'w', bkp: '421', gewerk: 'Umgebung',   betrag: 100000, status: 'vergeben', bauEnde: '2026-10-31', steuer: { art: 'wertvermehrend' } },
    /* Anteilig ohne eigenen Satz: 50 % nach Merkblatt (100'000 Unterhalt
       zu 100'000 Anlagekosten). */
    { id: 'a', bkp: '211', gewerk: 'Baumeister', betrag: 100000, status: 'vergeben', bauEnde: '2026-09-30', steuer: { art: 'anteilig' } }
  ],
  steuerZiel: { 2026: 120000 }, steuerAuffang: 2027
};
const erg = vm.runInContext(`
  state.projekte=[__p];
  steuerZuweisen(__p, { jahre: steuerJahre(__p), ziele: __p.steuerZiel });`, ctx);
const plan = vm.runInContext('steuerPlan(__p)', ctx);

const nachVerteilung = {};
erg.rows.forEach(r => { if (r.jahr) nachVerteilung[r.jahr] = (nachVerteilung[r.jahr] || 0) + r.abziehbar; });
plan.jahre.forEach(j => {
  const v = Math.round(nachVerteilung[j.jahr] || 0);
  console.log('    ' + j.jahr + '   Tabelle ' + Math.round(j.abziehbar).toString().padStart(7)
    + '   Verteilung ' + String(v).padStart(7));
  ok(Math.abs(j.abziehbar - (nachVerteilung[j.jahr] || 0)) < 0.5,
     j.jahr + ': Tabelle und Verteilung stimmen überein');
});

const ziel2026 = plan.jahre.find(j => j.jahr === 2026);
ok(ziel2026 && ziel2026.abziehbar <= 120000.05,
   'das Ziel 2026 wird nicht überschritten (' + Math.round(ziel2026.abziehbar) + ' von 120\'000)');
const anteilig = erg.rows.find(r => r.v.id === 'a');
console.log('    anteilige Position zählt mit ' + Math.round((anteilig.quote || 0) * 100) + ' %');
ok(anteilig.abziehbar > 0.05, 'die anteilige Position zählt nicht mehr als null');

console.log('\n  ' + (geprueft - fehler) + '/' + geprueft + ' geprüft'
  + (fehler ? '   ' + fehler + ' FEHLER' : '   alles grün') + '\n');
process.exit(fehler ? 1 : 0);
