// Prüft die Regelprüfung: die Zustandsleiter, die Standardregeln und
// was beides am echten Bauvorhaben ergibt.
//
// Der wichtigste Test hier ist unscheinbar: Jeder Handwerksschlüssel in
// REGEL_STANDARD muss es in GEWERK_FAMILIEN wirklich geben. Ein Tippfehler
// würde die Regel nie greifen lassen — und nichts würde es melden.

const fs = require('fs');
const path = require('path');
const U = require('../submit/kern/uebersetzer.js');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function holeBlock(name) {
  const start = app.indexOf('const ' + name + ' = [');
  if (start < 0) throw new Error(name + ' nicht in app.js gefunden');
  const von = app.indexOf('[', start);
  let tiefe = 0, i = von;
  for (; i < app.length; i++) {
    if (app[i] === '[') tiefe++;
    else if (app[i] === ']') { tiefe--; if (!tiefe) break; }
  }
  return eval(app.slice(von, i + 1));
}

const GEWERK_FAMILIEN = holeBlock('GEWERK_FAMILIEN');
const REGEL_STANDARD  = holeBlock('REGEL_STANDARD');

function familieVon(v) {
  const bkp = String((v && v.bkp) || '').trim();
  if (bkp) {
    let best = null, bestLen = -1;
    for (const f of GEWERK_FAMILIEN) for (const pre of f.bkp) {
      if ((bkp === pre || bkp.startsWith(pre)) && pre.length > bestLen) { best = f; bestLen = pre.length; }
    }
    if (best) return best;
  }
  const txt = ((v && v.gewerk) || '').toLowerCase();
  if (txt) for (const f of GEWERK_FAMILIEN) if (f.wort.some(w => txt.includes(w))) return f;
  return null;
}

/* Wortgleich mit regelVerletzt() in app.js. */
function regelVerletzt(a, b, rel) {
  if (!a || !b || !a.bauStart || !a.bauEnde || !b.bauStart || !b.bauEnde) return null;
  if (rel === 'davor')      return a.bauEnde > b.bauStart ? 'endet zu spät' : null;
  if (rel === 'beginntvor') return a.bauStart > b.bauStart ? 'beginnt zu spät' : null;
  if (rel === 'danach')     return a.bauStart < b.bauEnde ? 'beginnt zu früh' : null;
  if (rel === 'parallel')   return (a.bauStart <= b.bauEnde && b.bauStart <= a.bauEnde) ? null : 'überschneidet sich nicht';
  return null;
}

/* Wortgleich mit regelStatus() in app.js. */
function regelStatus(finde, r) {
  const a = finde(r.aVid), b = finde(r.bVid);
  if (!a || !b) return 'offen';
  if (r.aktiv === false) return 'aus';
  if (!a.bauStart || !a.bauEnde || !b.bauStart || !b.bauEnde) return 'offen';
  if (!regelVerletzt(a, b, r.rel)) return 'ok';
  if (r.ausnahme && r.ausnahme.grund) return 'erklaert';
  return 'verletzt';
}

let fehler = 0, geprueft = 0;
const ok = (bed, was) => { geprueft++; if (!bed) { fehler++; console.log('  FEHLT: ' + was); } };

/* ---- Die Schlüssel müssen es geben ---- */
console.log('\n=== Standardregeln zeigen auf echte Handwerke ===');
const keys = new Set(GEWERK_FAMILIEN.map(f => f.key));
const RELS = ['davor', 'beginntvor', 'parallel', 'danach'];
for (const [ka, rel, kb, warum] of REGEL_STANDARD) {
  ok(keys.has(ka), 'Handwerk „' + ka + '" gibt es');
  ok(keys.has(kb), 'Handwerk „' + kb + '" gibt es');
  ok(RELS.includes(rel), 'Beziehung „' + rel + '" ist gültig');
  ok(!!warum && warum.length > 10, 'Regel ' + ka + '→' + kb + ' hat eine Begründung');
  ok(ka !== kb, 'Regel ' + ka + '→' + kb + ' zeigt nicht auf sich selbst');
}
console.log('  ' + REGEL_STANDARD.length + ' Standardregeln, alle Schlüssel gültig');

/* Zwei Regeln, die sich gegenseitig ausschliessen, können nie beide
   aufgehen — eine davon meldet für immer einen Verstoss, den niemand
   beheben kann. Genau das war einmal drin: Gipser vor Boden UND Boden
   vor Gipser. */
console.log('\n=== Kein Widerspruch in sich ===');
const gegen = { davor: ['davor', 'beginntvor', 'danach'], beginntvor: ['davor', 'beginntvor'], danach: ['davor'], parallel: [] };
let paare = 0;
for (const [ka, rel, kb] of REGEL_STANDARD) {
  for (const [ka2, rel2, kb2] of REGEL_STANDARD) {
    if (ka === kb2 && kb === ka2 && (gegen[rel] || []).includes(rel2)) {
      console.log('  WIDERSPRUCH: ' + ka + ' ' + rel + ' ' + kb + '  gegen  ' + ka2 + ' ' + rel2 + ' ' + kb2);
      paare++;
    }
  }
}
ok(!paare, 'keine zwei Standardregeln widersprechen sich');

/* ---- Die Zustandsleiter ---- */
console.log('\n=== Die fünf Zustände ===');
const A = { id: 'a', gewerk: 'A', bauStart: '2026-01-05', bauEnde: '2026-01-09' };
const B = { id: 'b', gewerk: 'B', bauStart: '2026-01-12', bauEnde: '2026-01-16' };
const ohne = { id: 'c', gewerk: 'C' };
const finde = id => ({ a: A, b: B, c: ohne })[id] || null;

ok(regelStatus(finde, { aVid: 'a', rel: 'davor', bVid: 'b' }) === 'ok',        'A endet vor B → eingehalten');
ok(regelStatus(finde, { aVid: 'b', rel: 'davor', bVid: 'a' }) === 'verletzt',  'B endet nach A → verletzt');
ok(regelStatus(finde, { aVid: 'a', rel: 'davor', bVid: 'c' }) === 'offen',     'ohne Termin → nicht prüfbar');
ok(regelStatus(finde, { aVid: 'a', rel: 'davor', bVid: 'x' }) === 'offen',     'gelöschtes Gewerk → nicht prüfbar');
ok(regelStatus(finde, { aVid: 'b', rel: 'davor', bVid: 'a', aktiv: false }) === 'aus', 'ausgeschaltet → nicht geprüft');
ok(regelStatus(finde, { aVid: 'b', rel: 'davor', bVid: 'a', ausnahme: { grund: 'von innen montiert' } }) === 'erklaert',
   'verletzt + Begründung → abgenommen');
ok(regelStatus(finde, { aVid: 'b', rel: 'davor', bVid: 'a', ausnahme: { grund: '' } }) === 'verletzt',
   'leere Begründung nimmt nichts ab');
ok(regelStatus(finde, { aVid: 'a', rel: 'parallel', bVid: 'b' }) === 'verletzt', 'A und B überschneiden sich nicht');
ok(regelStatus(finde, { aVid: 'b', rel: 'danach', bVid: 'a' }) === 'ok',        'B nach A → eingehalten');

/* Eine eingehaltene Regel darf durch eine Begründung nicht schlechter werden. */
ok(regelStatus(finde, { aVid: 'a', rel: 'davor', bVid: 'b', ausnahme: { grund: 'egal' } }) === 'ok',
   'Begründung an erfüllter Regel ändert nichts');

/* ---- Am echten Bauvorhaben ---- */
const datei = path.join(__dirname, '..', 'privat', 'Projekte',
  'Umbau EFH Römerstrasse 31', 'Umbau EFH Römerstrasse 31.submit');
if (fs.existsSync(datei)) {
  const p = U.ausMappe(JSON.parse(fs.readFileSync(datei, 'utf8')));
  const vs = (p.vergaben || []).filter(v => v.bauStart || v.bauEnde);
  const ersteVon = key => vs.find(v => { const f = familieVon(v); return f && f.key === key; });
  const finde2 = id => (p.vergaben || []).find(v => v.id === id) || null;

  console.log('\n=== Standardregeln am Umbau Römerstrasse 31 ===');
  console.log('  Regel                                              Stand');
  console.log('  ' + '-'.repeat(78));
  const zaehl = { ok: 0, verletzt: 0, offen: 0 };
  let anwendbar = 0;
  for (const [ka, rel, kb, warum] of REGEL_STANDARD) {
    const a = ersteVon(ka), b = ersteVon(kb);
    if (!a || !b || a.id === b.id) continue;
    anwendbar++;
    const st = regelStatus(finde2, { aVid: a.id, rel, bVid: b.id });
    zaehl[st] = (zaehl[st] || 0) + 1;
    const satz = (a.gewerk || '').slice(0, 22) + ' → ' + (b.gewerk || '').slice(0, 22);
    console.log('  ' + satz.padEnd(50) + (st === 'ok' ? 'eingehalten' : st === 'verletzt' ? 'VERLETZT' : 'kein Termin'));
    if (st === 'verletzt') console.log('        ' + warum);
  }
  console.log('  ' + '-'.repeat(78));
  console.log('  ' + anwendbar + ' Regeln passen auf dieses Projekt: '
    + (zaehl.ok || 0) + ' eingehalten, ' + (zaehl.verletzt || 0) + ' verletzt, ' + (zaehl.offen || 0) + ' ohne Termin');
  ok(anwendbar > 0, 'mindestens eine Standardregel passt auf das Projekt');
}

console.log('\n  ' + (geprueft - fehler) + '/' + geprueft + ' geprüft'
  + (fehler ? '   ' + fehler + ' FEHLER' : '   alles grün') + '\n');
process.exit(fehler ? 1 : 0);
