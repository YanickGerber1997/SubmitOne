// Prüft das Stundenraster in SubmitOne — es ist dasselbe wie in SubZeit.
//
// Warum es diesen Test gibt
// -------------------------
// Bis zum 14.08.2026 war die Stunden-Ansicht eine Liste von sieben
// Kästen mit Textzeilen: Man sah, DASS etwas erfasst ist, aber nicht,
// wann und wie lange — ein Vormittag und ein ganzer Tag sahen gleich
// aus. Jetzt zeichnet submit/kern/wochenraster.js, dieselbe Datei, die
// SubZeits Zeitbahn benutzt.
//
// Geprüft wird, dass die Umstellung wirklich stattgefunden hat, dass
// jeder Aufruf ankommt — und dass die Blöcke die richtige Lage und
// Farbe bekommen.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const wurzel = path.join(__dirname, '..');
const quelle = fs.readFileSync(path.join(wurzel, 'app.js'), 'utf8');

let fehler = 0, geprueft = 0;
const ok = (bed, was) => { geprueft++; if (!bed) { fehler++; console.log('  FEHLT: ' + was); } };

console.log('\n=== Die Ansicht zeichnet nicht mehr selbst ===');
const teil = quelle.slice(quelle.indexOf('function viewStunden'), quelle.indexOf('/** Wo der Tag noch frei ist'));
ok(/Wochenraster\.zeichne\(/.test(quelle), 'sie ruft das gemeinsame Raster');
ok(/id="stundenRaster"/.test(teil), 'und gibt ihm ein Feld');
ok(!/st-tag-liste/.test(teil), 'die alten Textkästen sind weg');
ok(!/class="st-e"/.test(teil), 'und die Textzeilen darin ebenfalls');

console.log('\n=== Dieselben Einstellungen wie SubZeit ===');
const auf = quelle.slice(quelle.indexOf('function stundenRasterZeichnen'), quelle.indexOf('function gewerkFarbeAusId'));
[['achse', "'linear'"], ['hoeheProStunde', '44'], ['vonStunde', '7'], ['bisStunde', '19']]
  .forEach(([k, w]) => ok(new RegExp(k + ':\\s*' + w.replace(/'/g, "'")).test(auf), k + ' = ' + w));
ok(/Zeitrechnung\.raster\(z\)/.test(auf), 'das Zeitraster kommt aus dem gemeinsamen Kern');
['beiNeu', 'beiGeaendert', 'beiKlick', 'beiTagKlick', 'beiKopfKlick']
  .forEach(r => ok(new RegExp(r + ':').test(auf), 'der Rückruf ' + r));

console.log('\n=== Jeder Aufruf trifft etwas ===');
['zeitDoc', 'zSoll', 'zStd', 'zDauer', 'zHhmm', 'zTaetigkeit', 'findProjekt', 'dISO', 'uid', 'save', 'toast']
  .forEach(n => ok(new RegExp('function ' + n + '\\b|const ' + n + '\\s*=').test(quelle), n + '()'));
['stundenAusRaster', 'stundenVerschieben', 'gewerkFarbeAusId', 'stundenRasterZeichnen']
  .forEach(n => ok(new RegExp('function ' + n + '\\b').test(quelle), n + '() ist gebaut'));

console.log('\n=== Anlegen und Verschieben prüfen wie SubZeit ===');
const neu = quelle.slice(quelle.indexOf('function stundenAusRaster'), quelle.indexOf('function stundenVerschieben'));
ok(/Zeitrechnung\.rundeSpanne/.test(neu), 'neu Aufgezogenes wird aufs Raster gerundet');
ok(/Zeitrechnung\.ueberschneidung/.test(neu), 'und auf Überschneidung geprüft');
const vsch = quelle.slice(quelle.indexOf('function stundenVerschieben'));
ok(/Zeitrechnung\.rundeSpanne/.test(vsch.slice(0, 700)), 'Verschobenes ebenso');
ok(/ueberschneidung\(z, datum, a, b, e\.id\)/.test(vsch.slice(0, 700)),
   'und dabei mit sich selbst verglichen — sonst beisst sich jeder Block mit sich');

console.log('\n=== Die Farbe hängt an der Kennung ===');
const ctx = { Math, console };
vm.createContext(ctx);
vm.runInContext(quelle.slice(quelle.indexOf('function gewerkFarbeAusId'),
                             quelle.indexOf('/** Aufgezogen im Raster')), ctx);
const F = vm.runInContext('gewerkFarbeAusId', ctx);
console.log('  p_9wajd62 → ' + F('p_9wajd62') + '   p_9j8mqwx → ' + F('p_9j8mqwx'));
ok(F('p_9wajd62') === F('p_9wajd62'), 'dieselbe Kennung, dieselbe Farbe');
ok(F('p_9wajd62') !== F('p_9j8mqwx'), 'verschiedene Kennungen, verschiedene Farben');
ok(/^#[0-9a-f]{6}$/i.test(F('x')), 'immer eine gültige Farbe');
/* Dieselbe Regel wie in SubZeits fach.js — sonst trüge dasselbe
   Bauvorhaben in den beiden Programmen verschiedene Farben. */
const fachText = fs.readFileSync(path.join(wurzel, 'submit', 'zeit', 'fach.js'), 'utf8');
const zeitCtx = { Math, console };
vm.createContext(zeitCtx);
vm.runInContext(fachText.slice(fachText.indexOf('const PROJEKTFARBEN'),
                               fachText.indexOf('function projektFarbe')), zeitCtx);
const FZ = vm.runInContext('farbeAusId', zeitCtx);
['p_9wajd62', 'p_9j8mqwx', 'p_f69c3gz', 'p_sonnhalde'].forEach(id =>
  ok(F(id) === FZ(id), id + ': SubmitOne und SubZeit geben dieselbe Farbe (' + F(id) + ')'));

console.log('\n=== Das Aussehen kommt aus der gemeinsamen Datei ===');
const css = fs.readFileSync(path.join(wurzel, 'styles.css'), 'utf8');
ok(/#stundenRaster \.wr-spalte\.wochenende/.test(css), 'SubmitOne steuert nur die Arbeitswoche bei');
const seite = fs.readFileSync(path.join(wurzel, 'index.html'), 'utf8');
ok(/wochenraster\.css/.test(seite) && /wochenraster\.js/.test(seite), 'beide Dateien sind eingebunden');

console.log('\n  ' + (geprueft - fehler) + '/' + geprueft + ' geprüft'
  + (fehler ? '   ' + fehler + ' FEHLER' : '   alles grün') + '\n');
process.exit(fehler ? 1 : 0);
