// Prüft das gemeinsame Wochenraster — submit/kern/wochenraster.js.
//
// Gezeichnet wird hier nichts; geprüft wird das, was auch ohne Browser
// nachrechenbar ist: die Verteilung überschneidender Blöcke auf Spuren,
// die Zeitdarstellung und dass das Modul für beide Programme bereitsteht.
//
// Die Spurenverteilung ist der Teil, an dem man es merkt: Liegt sie
// falsch, deckt ein Termin den anderen zu — und gerade die Überschneidung
// ist auf einem Wochenplan die Auskunft, die zählt.

const fs = require('fs');
const path = require('path');
const W = require('../submit/kern/wochenraster.js');

let fehler = 0, geprueft = 0;
const ok = (bed, was) => { geprueft++; if (!bed) { fehler++; console.log('  FEHLT: ' + was); } };

console.log('\n=== Das Modul stellt bereit ===');
['zeichne', 'loese', 'spurenVerteilen', 'achseBauen', 'uhr'].forEach(n =>
  ok(typeof W[n] === 'function', n + '()'));
ok(W.KLASSE === 'wr', 'einen eigenen Namensraum für die Klassen');

console.log('\n=== Zeitdarstellung ===');
ok(W.uhr(450) === '07:30', '450 Minuten sind 07:30');
ok(W.uhr(0) === '00:00', 'Mitternacht');
ok(W.uhr(1439) === '23:59', 'die letzte Minute des Tages');

console.log('\n=== Überschneidende Blöcke ===');
const spur = (bloecke) => {
  const m = W.spurenVerteilen(bloecke);
  const aus = {};
  bloecke.forEach(b => { const s = m.get(b.id); aus[b.id] = s ? s.spur + '/' + s.anzahl : '—'; });
  return aus;
};

/* Zwei, die sich nicht berühren: beide über die volle Breite. */
let s = spur([{ id: 'a', von: 480, bis: 600 }, { id: 'b', von: 600, bis: 720 }]);
console.log('  nacheinander      a ' + s.a + '   b ' + s.b);
ok(s.a === '0/1' && s.b === '0/1', 'wer sich nicht überschneidet, bekommt die ganze Spalte');

/* Zwei, die sich überlappen: nebeneinander, je halb. */
s = spur([{ id: 'a', von: 480, bis: 660 }, { id: 'b', von: 600, bis: 720 }]);
console.log('  überlappend       a ' + s.a + '   b ' + s.b);
ok(s.a === '0/2' && s.b === '1/2', 'zwei überlappende teilen sich die Breite');

/* Drei ineinander. */
s = spur([{ id: 'a', von: 480, bis: 720 }, { id: 'b', von: 500, bis: 700 }, { id: 'c', von: 520, bis: 680 }]);
console.log('  drei ineinander   a ' + s.a + '   b ' + s.b + '   c ' + s.c);
ok(s.a === '0/3' && s.b === '1/3' && s.c === '2/3', 'drei ineinander ergeben drei Spuren');

/* Eine Kette: a und b überlappen, c berührt nur b — alle drei bilden
   eine Gruppe, aber a und c dürfen sich eine Spur teilen. */
s = spur([{ id: 'a', von: 480, bis: 600 }, { id: 'b', von: 540, bis: 700 }, { id: 'c', von: 660, bis: 780 }]);
console.log('  Kette             a ' + s.a + '   b ' + s.b + '   c ' + s.c);
ok(s.a.endsWith('/2') && s.b.endsWith('/2') && s.c.endsWith('/2'), 'die Kette bildet eine Gruppe mit zwei Spuren');
ok(s.a.startsWith('0') && s.b.startsWith('1'), 'a und b liegen nebeneinander');
ok(s.c.startsWith('0'), 'c darf a-s Spur wiederverwenden — es überschneidet sich nicht mit a');

/* Ein laufender Eintrag ohne Ende belegt eine Stunde. */
s = spur([{ id: 'a', von: 480 }, { id: 'b', von: 500, bis: 560 }]);
console.log('  ohne Ende         a ' + s.a + '   b ' + s.b);
ok(s.a.endsWith('/2'), 'ein Eintrag ohne Ende belegt trotzdem Platz');

/* =====================================================================
   Die Achse
   ---------------------------------------------------------------------
   Zwei Bauarten. Die gestauchte ist der Grund, weshalb SubZeit den
   ganzen Tag zeigen kann, ohne zu rollen — sie muss beim Zusammenlegen
   erhalten bleiben, sonst wird das gemeinsame Raster zwar gleich, aber
   schlechter als das, was vorher dastand.
   ===================================================================== */

console.log('\n=== Achse: linear ===');
let a = W.achseBauen({ vonStunde: 7, bisStunde: 19, hoeheProStunde: 44 });
ok(a.art === 'linear', 'ohne Angabe linear');
ok(a.anteil(7 * 60) === 0, '07:00 liegt ganz oben');
ok(Math.abs(a.anteil(19 * 60) - 1) < 1e-9, '19:00 liegt ganz unten');
ok(a.hoehe === 12 * 44, '12 Stunden zu 44 Pixeln');
ok(Math.abs(a.anteil(13 * 60) - 0.5) < 1e-9, 'die Mitte liegt in der Mitte');

/* Ein früher Block muss sichtbar sein — sonst zeichnet das Raster
   etwas, das ausserhalb seines eigenen Feldes liegt. */
a = W.achseBauen({ vonStunde: 7, bisStunde: 19, bloecke: [{ von: 5 * 60 + 40, bis: 7 * 60 }] });
ok(a.vonH === 5, 'ein Block um 05:40 zieht das Fenster auf 05:00 herunter');
a = W.achseBauen({ vonStunde: 7, bisStunde: 19, bloecke: [{ von: 20 * 60, bis: 22 * 60 + 30 }] });
ok(a.bisH === 23, 'ein Block bis 22:30 zieht das Fenster auf 23:00 hinunter');

console.log('\n=== Achse: gestaucht (der ganze Tag ohne Rollen) ===');
const g = W.achseBauen({ achse: 'gestaucht', vonStunde: 7, bisStunde: 19, nachtMass: 0.4 });
ok(g.art === 'gestaucht', 'gestaucht, wenn verlangt');
ok(g.anteil(0) === 0, 'Mitternacht ganz oben');
ok(Math.abs(g.anteil(24 * 60) - 1) < 1e-9, 'Mitternacht danach ganz unten');

/* Der springende Punkt: Eine Arbeitsstunde bekommt mehr Platz als eine
   Nachtstunde — sonst wäre nichts gewonnen. */
const arbeit = g.anteil(11 * 60) - g.anteil(10 * 60);
const nacht  = g.anteil(3 * 60) - g.anteil(2 * 60);
console.log('  Arbeitsstunde ' + (arbeit * 100).toFixed(2) + '%   Nachtstunde '
  + (nacht * 100).toFixed(2) + '%   Verhältnis ' + (arbeit / nacht).toFixed(1) + ':1');
ok(arbeit > nacht, 'die Arbeitsstunde bekommt mehr Platz als die Nachtstunde');
ok(Math.abs(arbeit / nacht - 2.5) < 0.01, 'und zwar genau um 1/0.4 = 2.5 mehr');

const fenster = g.anteil(19 * 60) - g.anteil(7 * 60);
console.log('  07–19 Uhr belegen ' + (fenster * 100).toFixed(1) + '% der Fläche');
ok(fenster > 0.65, 'das Arbeitsfenster füllt den grössten Teil des Feldes');

/* Hin und zurück muss dieselbe Minute ergeben — sonst springt ein Block
   beim Anfassen. */
let groessteAbweichung = 0;
for (let m = 0; m <= 24 * 60; m += 7) {
  groessteAbweichung = Math.max(groessteAbweichung, Math.abs(g.minuteBei(g.anteil(m)) - m));
}
console.log('  grösste Abweichung hin und zurück: ' + groessteAbweichung.toFixed(6) + ' Minuten');
ok(groessteAbweichung < 1e-6, 'Minute → Ort → Minute trifft wieder dieselbe Minute');

/* Monoton: später ist immer weiter unten. */
let monoton = true, vorher = -1;
for (let m = 0; m <= 24 * 60; m += 5) { const p = g.anteil(m); if (p < vorher) monoton = false; vorher = p; }
ok(monoton, 'die Achse läuft durchgehend nach unten');

/* Ausserhalb des Arbeitsfensters nur jede zweite Stunde beschriften. */
const leise = g.striche.filter(s => s.leise).map(s => s.stunde);
console.log('  gestauchte Stunden mit Beschriftung: ' + leise.join(', '));
ok(leise.every(h => h % 2 === 0), 'in der gestauchten Nacht klebt keine Zahl auf der anderen');
ok(g.striche.filter(s => !s.leise).length === 12, 'im Arbeitsfenster ist jede Stunde beschriftet');

console.log('\n=== Was beide Programme brauchten, kann es jetzt beides ===');
const quelle = fs.readFileSync(path.join(__dirname, '..', 'submit', 'kern', 'wochenraster.js'), 'utf8');
/* Aus SubZeit: Finger, Abbruch, Tageswechsel im Zug.
   Aus SubmitOne: ganztägiges Band und Fussband. */
[['pointerdown', 'Bedienung mit dem Finger, nicht nur mit der Maus'],
 ['Escape', 'Abbruch mit Escape'],
 ['spalteAn', 'Tageswechsel mitten im Zug'],
 ['hinweis', 'die laufende Zeit am Zeiger'],
 ['ganztags', 'das ganztägige Band'],
 ['o.fuss', 'das Fussband'],
 ['hintergrund', 'Bänder für Feiertag und Absenz'],
 ['beiMenu', 'das Kontextmenü auf einem Block']
].forEach(([was, warum]) => ok(quelle.includes(was), warum));
/* Ohne Kommentare geprüft: Im Text steht `mousedown` genau einmal — in
   der Begründung, weshalb es das hier nicht mehr gibt. */
const ohneKommentare = quelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
ok(!/\bmousedown\b/.test(ohneKommentare), 'und nirgends mehr ein reines Maus-Ereignis');
ok(/mousedown/.test(quelle), 'die Begründung dafür steht als Kommentar dabei');

/* Alles, was das Raster selbst vergibt, trägt sein Kürzel. Ohne diese
   Regel greift eine Regel aus stil.css oder styles.css stumm in das
   gemeinsame Aussehen hinein — genau das passierte am 14.08.2026 mit
   «schemen», das es in SubZeits alter Zeitbahn schon gab. */
console.log('\n=== Kein Klassenname ohne eigenes Kürzel ===');
const eigene = [...quelle.matchAll(/KLASSE\s*\+\s*'-([a-zäöü-]+)/g)].map(m => m[1]);
const zusatz = [...quelle.matchAll(/'\s(fest|durch|laeuft|neu|aktiv|heute|halb|leise|oben|unten|klein)\b/g)]
  .map(m => m[1]);
console.log('  eigene Klassen: wr-' + [...new Set(eigene)].sort().join(', wr-'));
console.log('  Zustände:       ' + [...new Set(zusatz)].sort().join(', '));
ok(eigene.length > 12, 'die Klassen des Rasters hängen alle am Kürzel');
/* Jeder Aufruf von el() bekommt entweder gar keine Klasse oder eine, die
   am Kürzel hängt. Zustände wie `heute` oder `fest` hängen sich immer an
   eine wr-Klasse an — allein stünden sie im Freien und träfen fremde
   Regeln. */
const klassenArgumente = [...quelle.matchAll(/\bel\(\s*'[a-z]+'\s*,\s*([^,\n]+)/g)]
  .map(m => m[1].trim().replace(/\)+$/, ''));
const ohneKuerzel = klassenArgumente.filter(a => a !== 'null' && !a.includes('KLASSE'));
console.log('  el()-Aufrufe mit Klasse: ' + klassenArgumente.length
  + (ohneKuerzel.length ? '   OHNE KÜRZEL: ' + ohneKuerzel.join(' | ') : '   alle am Kürzel'));
ok(ohneKuerzel.length === 0, 'kein Element bekommt eine Klasse ohne das Kürzel');

console.log('\n=== Beide Programme binden es ein ===');
const wurzel = path.join(__dirname, '..');
const seiten = [
  ['SubmitOne', 'index.html'],
  ['SubZeit',   path.join('submit', 'zeit', 'index.html')]
];
seiten.forEach(([name, p]) => {
  const voll = path.join(wurzel, p);
  if (!fs.existsSync(voll)) { ok(false, name + ': ' + p + ' fehlt'); return; }
  const t = fs.readFileSync(voll, 'utf8');
  ok(/wochenraster\.js/.test(t), name + ' lädt wochenraster.js');
  ok(/wochenraster\.css/.test(t), name + ' lädt wochenraster.css');
});

/* Und dass die Gestaltung aus den gemeinsamen Tokens kommt. */
const css = fs.readFileSync(path.join(wurzel, 'ui', 'wochenraster.css'), 'utf8');
const ohneKommentar = css.replace(/\/\*[\s\S]*?\*\//g, '');
const harteFarben = [...ohneKommentar.matchAll(/:\s*(#[0-9a-f]{6})\b/gi)]
  .map(m => m[1]).filter(f => !/^#fff$/i.test(f));
const ohneRueckfall = [...ohneKommentar.matchAll(/(#[0-9a-f]{6})/gi)]
  .filter(m => {
    const vor = ohneKommentar.slice(Math.max(0, m.index - 60), m.index);
    return !/var\(--[a-z0-9-]+,\s*$/.test(vor);
  });
console.log('  Farben ohne Token-Rückfall: ' + ohneRueckfall.length);
ok(ohneRueckfall.length <= 1, 'die Farben kommen aus tokens.css, nicht aus der Rasterdatei');

console.log('\n  ' + (geprueft - fehler) + '/' + geprueft + ' geprüft'
  + (fehler ? '   ' + fehler + ' FEHLER' : '   alles grün') + '\n');
process.exit(fehler ? 1 : 0);
