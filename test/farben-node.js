// Prüft die Gewerkfarben gegen die echten Gewerke des Projekts.
//
// Die Matrix steht in app.js und wird von dort gelesen — eine zweite
// Kopie hier würde irgendwann auseinanderlaufen und niemandem auffallen.

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

/* Wortgleich mit familieVon() in app.js. */
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

let fehler = 0, geprueft = 0;
const ok = (bed, was) => { geprueft++; if (!bed) { fehler++; console.log('  FEHLT: ' + was); } };

/* ---- Yanicks Vorgaben, eins zu eins ---- */
console.log('\n=== Vorgaben aus der Farbabsprache ===');
const SOLL = [
  ['211',   'bau',      'Baumeister grau/anthrazit'],
  ['211.1', 'geruest',  'Gerüst hellblau'],
  ['214',   'holzbau',  'Holzbau braun'],
  ['224.0', 'dach',     'Bedachung bordeauxrot'],
  ['222.0', 'spengler', 'Spengler grau'],
  ['221.2', 'fenster',  'Fenster grün'],
  ['228',   'storen',   'Sonnen-/Wetterschutz hellblau'],
  ['230',   'elektro',  'Strom orange'],
  ['234',   'pv',       'PV violett'],
  ['240',   'heizung',  'Heizung rot'],
  ['250',   'sanitaer', 'Sanitär dunkelblau'],
  ['271',   'gipser',   'Gipser violett'],
  ['285.1', 'gipser',   'Maler violett (wie Gipser)'],
  ['281.6', 'gipser',   'Platten violett (wie Gipser)'],
  ['273',   'schreiner', 'Schreiner braun'],
  ['272',   'metall',   'Metallbau anthrazit']
];
for (const [bkp, key, was] of SOLL) {
  const f = familieVon({ bkp });
  ok(f && f.key === key, was + '  (' + bkp + ' → ' + (f ? f.key : 'nichts') + ')');
}

/* Die längere BKP muss gewinnen — sonst landet das Gerüst beim Baumeister. */
console.log('\n=== Feinheiten ===');
ok(familieVon({ bkp: '211.1' }).key === 'geruest',  '211.1 ist Gerüst, nicht Baumeister');
ok(familieVon({ bkp: '211' }).key === 'bau',        '211 bleibt Baumeister');
ok(familieVon({ bkp: '281.6' }).key === 'gipser',   '281.6 ist Platten, nicht Schreiner');
ok(familieVon({ bkp: '281.2' }).key === 'schreiner', '281.2 ist Parkett/Schreiner');
ok(familieVon({ bkp: '234' }).key === 'pv',         '234 ist PV, nicht Elektro');
ok(familieVon({ bkp: '230' }).key === 'elektro',    '230 bleibt Elektro');

/* Ohne BKP — für Branchen, die keine haben. */
console.log('\n=== Ohne BKP-Nummer (andere Branchen) ===');
ok(familieVon({ gewerk: 'Malerarbeiten innen' }).key === 'gipser',   'Maler über den Namen');
ok(familieVon({ gewerk: 'Heizung Ersatz' }).key === 'heizung',       'Heizung über den Namen');
ok(familieVon({ gewerk: 'Gerüstbau' }).key === 'geruest',            'Gerüst über den Namen');
ok(familieVon({ gewerk: 'Küche Umbau' }).key === 'schreiner',        'Küche über den Namen');
ok(familieVon({ gewerk: 'Irgendwas Unbekanntes' }) === null,         'Unbekanntes bleibt ohne Familie');

/* Keine zwei Familien dürfen dieselbe BKP beanspruchen. */
console.log('\n=== Matrix in sich ===');
const gesehen = new Map();
let doppelt = 0;
for (const f of GEWERK_FAMILIEN) for (const pre of f.bkp) {
  if (gesehen.has(pre)) { console.log('  DOPPELT: ' + pre + ' bei ' + gesehen.get(pre) + ' und ' + f.key); doppelt++; }
  gesehen.set(pre, f.key);
}
ok(!doppelt, 'jede BKP-Nummer gehört genau einer Familie');
ok(new Set(GEWERK_FAMILIEN.map(f => f.key)).size === GEWERK_FAMILIEN.length, 'keine doppelten Schlüssel');
ok(GEWERK_FAMILIEN.every(f => /^#[0-9a-f]{6}$/i.test(f.col)), 'alle Farben sind gültige Hex-Werte');

/* Nicht zu kräftig: Sättigung im Zaum, Helligkeit im Mittelfeld. */
function hsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  const s = mx === mn ? 0 : (l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn));
  return { s: s * 100, l: l * 100 };
}
const zuKraeftig = GEWERK_FAMILIEN.filter(f => hsl(f.col).s > 55);
const zuHell     = GEWERK_FAMILIEN.filter(f => hsl(f.col).l > 82 || hsl(f.col).l < 28);
zuKraeftig.forEach(f => console.log('  zu kräftig: ' + f.key + ' ' + f.col + ' (' + hsl(f.col).s.toFixed(0) + ' % Sättigung)'));
zuHell.forEach(f => console.log('  Helligkeit grenzwertig: ' + f.key + ' ' + f.col + ' (' + hsl(f.col).l.toFixed(0) + ' %)'));
ok(!zuKraeftig.length, 'keine Farbe ist zu kräftig (Sättigung ≤ 55 %)');
ok(!zuHell.length, 'alle Farben liegen im lesbaren Helligkeitsband');

/* ---- Und jetzt an den echten Gewerken ---- */
const datei = path.join(__dirname, '..', 'privat', 'Projekte',
  'Umbau EFH Römerstrasse 31', 'Umbau EFH Römerstrasse 31.submit');
if (fs.existsSync(datei)) {
  const p = U.ausMappe(JSON.parse(fs.readFileSync(datei, 'utf8')));
  const vs = (p.vergaben || []).slice().sort((a, b) => String(a.bkp).localeCompare(String(b.bkp), 'de', { numeric: true }));
  console.log('\n=== Die Gewerke des Projekts ===');
  console.log('  BKP       Gewerk                              Handwerk                    Farbe');
  console.log('  ' + '-'.repeat(94));
  let ohne = 0;
  for (const v of vs) {
    const f = familieVon(v);
    if (!f) ohne++;
    console.log('  ' + String(v.bkp || '').padEnd(10)
      + String(v.gewerk || '').slice(0, 34).padEnd(36)
      + (f ? f.label : '— keine Zuordnung —').slice(0, 26).padEnd(28)
      + (f ? f.col : ''));
  }
  console.log('  ' + '-'.repeat(94));
  ok(!ohne, ohne ? ohne + ' Gewerke ohne Farbzuordnung' : 'jedes Gewerk hat eine Farbe');
}

console.log('\n  ' + (geprueft - fehler) + '/' + geprueft + ' geprüft'
  + (fehler ? '   ' + fehler + ' FEHLER' : '   alles grün') + '\n');
process.exit(fehler ? 1 : 0);
