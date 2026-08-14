/* =====================================================================
   Schriftskala — Bestandsaufnahme und Umschrift
   ---------------------------------------------------------------------
   SubmitOne kennt 25 verschiedene Schriftgrössen, SubZeit acht. Damit
   beide gleich aussehen, müssen es dieselben acht sein.

   Dieses Werkzeug tut zweierlei:

     node test/schriftskala.js           zählt und zeigt, was passieren würde
     node test/schriftskala.js --setzen  schreibt es

   Die Druckdokumente sind dabei die Schwierigkeit. SubmitOne baut vier
   davon als eigene Fenster (window.open + document.write). Die kennen
   ui/tokens.css nicht — ein var(--t-m) wäre dort ungültig und die Schrift
   fiele auf den geerbten Wert zurück. Und sie gehören einer anderen
   Typografie an: 11px Grundschrift, Blätter in Millimetern, 7.5px
   Kopfzeilen, feste Höhen mit overflow:hidden. Eine Bildschirmskala von
   14px sprengt jedes A4-Blatt, und der Überhang verschwindet lautlos.

   Zwei Fälle, zwei Antworten:

   1. Die Druck-STYLESHEETS erkennt man sicher an ihren Merkmalen (@page,
      page-break, print-color-adjust, mm-Masse, @media print, <!DOCTYPE)
      im selben Zeichenketten-Block. Die bleiben unberührt. Erkannt wird
      am Inhalt, nicht an von Hand gepflegten Zeilennummern, die bei der
      nächsten Änderung nicht mehr stimmen.

   2. Der Druck-INHALT lässt sich nicht sicher erkennen. Er entsteht weit
      verstreut (etwa die Kostentabellen um Zeile 15339 mit 10.5px und
      8.5px) und trägt kein Merkmal — er wandert erst später als «inner»
      in openPrintDoc. Deshalb bekommt in app.js jede Umschrift ihren
      alten Wert als Rückfall mit: font-size:var(--t-xs, 12px).

      Im Programm ist der Rückfall tot, dort gilt die Skala. Im
      Druckfenster, wo es die Tokens nicht gibt, greift er — und das Blatt
      sieht aus wie vorher. Das ist keine Vorsicht, sondern die richtige
      Aussage: die gemeinsame Skala gilt am Bildschirm; das Papier hat
      seine eigene.

   styles.css braucht den Rückfall nicht: Die Druckfenster schreiben ihr
   eigenes <style> und laden styles.css nie.
   ===================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const wurzel = path.join(__dirname, '..');

/* Die acht Stufen aus ui/bausteine.css, in Pixeln bei 16px Wurzel. */
const STUFEN = [
    { name: '--t-2xs', px: 11 },
    { name: '--t-xs', px: 12 },
    { name: '--t-s', px: 13 },
    { name: '--t-m', px: 14 },
    { name: '--t-l', px: 16 },
    { name: '--t-xl', px: 20 },
    { name: '--t-2xl', px: 28 },
    { name: '--t-3xl', px: 36 }
];

/* Zwei Regeln, weil die Skala unten dicht und oben weit ist.

   Bis 14px: aufrunden. Das ist Fliesstext und Bedienelement, und der
   Entscheid lautet «SubmitOne wächst». Die Stufen liegen dort 1px
   auseinander (11·12·13·14), weiter als 2px kann es nie gehen.

   Über 14px: die nächstgelegene Stufe. Dort springt die Skala
   (16·20·28·36), und Aufrunden würde die Hierarchie aufblasen statt sie
   zu übernehmen: Der Projekttitel steht heute auf 23px und wäre mit
   28px grösser als alles, was SubmitOne je hatte. SubZeit setzt h1 auf
   --t-xl, also 20px — genau dorthin führt die nächstgelegene Stufe.
   Bei Gleichstand nach oben. */
function stufeFuer(px) {
    if (px <= 14) { for (const s of STUFEN) if (s.px >= px) return s; }
    let beste = STUFEN[0];
    // <= statt <: bei Gleichstand gewinnt die spätere, also grössere Stufe.
    for (const s of STUFEN) if (Math.abs(s.px - px) <= Math.abs(beste.px - px)) beste = s;
    return beste;
}

/* --- Druckregionen -----------------------------------------------------
   Ein Zeichenketten-Block ist alles zwischen zwei Gravis-Zeichen. Enthält
   er ein Druckmerkmal, bleibt er unberührt. */
const DRUCKMERKMAL = /@page|page-break|print-color-adjust|<!DOCTYPE|@media\s+print|[0-9]mm[;\s)]/i;

function druckregionen(text, bericht) {
    const bereiche = [];
    const zeileVon = pos => text.slice(0, pos).split('\n').length;
    let i = 0;
    while (i < text.length) {
        const auf = text.indexOf('`', i);
        if (auf < 0) break;
        // Ende suchen, entwertete Gravis überspringen.
        let zu = auf + 1;
        while (zu < text.length) {
            if (text[zu] === '\\') { zu += 2; continue; }
            if (text[zu] === '`') break;
            zu++;
        }
        if (zu >= text.length) break;
        const block = text.slice(auf, zu + 1);
        const hatSchrift = /font-size:\s*[0-9]/.test(block);
        if (DRUCKMERKMAL.test(block)) {
            bereiche.push([auf, zu + 1]);
            if (bericht && hatSchrift) bericht.druck.push('Zeile ' + zeileVon(auf) + ': ' + block.slice(1, 70).replace(/\s+/g, ' '));
        } else if (bericht && hatSchrift && block.length > 400) {
            // Grosse Blöcke ohne Druckmerkmal: die will ich sehen, bevor
            // etwas geschrieben wird. Ein übersehener Druckblock faellt
            // sonst erst auf dem Papier auf.
            bericht.verdacht.push('Zeile ' + zeileVon(auf) + ': ' + block.slice(1, 70).replace(/\s+/g, ' '));
        }
        i = zu + 1;
    }
    return bereiche;
}

const imDruck = (bereiche, pos) => bereiche.some(b => pos >= b[0] && pos < b[1]);

/* --- Umschrift --------------------------------------------------------- */

const MUSTER = /font-size:\s*([0-9]+(?:\.[0-9]+)?)px/g;

function bearbeite(datei, setzen, mitRueckfall) {
    const pfad = path.join(wurzel, datei);
    const text = fs.readFileSync(pfad, 'utf8');
    const bericht = { druck: [], verdacht: [] };
    const druck = druckregionen(text, bericht);

    const zaehler = new Map();
    let uebersprungen = 0;

    const neu = text.replace(MUSTER, (treffer, wert, pos) => {
        if (imDruck(druck, pos)) { uebersprungen++; return treffer; }
        const px = parseFloat(wert);
        const stufe = stufeFuer(px);
        const schluessel = px + 'px -> ' + stufe.name + ' (' + stufe.px + 'px)';
        zaehler.set(schluessel, (zaehler.get(schluessel) || 0) + 1);
        return mitRueckfall
            ? 'font-size:var(' + stufe.name + ', ' + wert + 'px)'
            : 'font-size: var(' + stufe.name + ')';
    });

    let summe = 0;
    for (const n of zaehler.values()) summe += n;

    console.log('\n' + datei);
    console.log('  ' + druck.length + ' Druckblöcke erkannt, ' + uebersprungen + ' Schriftgrössen darin unberührt');
    console.log('  ' + summe + ' Schriftgrössen auf die Skala gehoben:');
    [...zaehler.entries()]
        .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
        .forEach(([k, n]) => console.log('     ' + String(n).padStart(4) + '  ' + k));

    if (bericht.druck.length) {
        console.log('\n  Als Druck erkannt und unberührt gelassen:');
        bericht.druck.forEach(z => console.log('     ' + z));
    }
    if (bericht.verdacht.length) {
        console.log('\n  GRÖSSERE BLÖCKE OHNE DRUCKMERKMAL — bitte ansehen:');
        bericht.verdacht.forEach(z => console.log('     ' + z));
    }

    if (setzen && neu !== text) { fs.writeFileSync(pfad, neu); console.log('  geschrieben.'); }
    return { summe, uebersprungen };
}

const setzen = process.argv.includes('--setzen');
console.log('=== Schriftskala' + (setzen ? ' — SCHREIBEN' : ' — nur zeigen (--setzen schreibt)') + ' ===');
let g = { summe: 0, uebersprungen: 0 };
/* app.js mit Rückfall, die Stylesheets ohne — siehe Kopf.

   ui/wochenraster.css ist die geteilte Datei, aus der BEIDE Programme das
   Raster lesen; submit/zeit/stil.css gehört SubZeit selbst. Auch die
   Vorlage rechnete dort noch mit festen Grössen (9px, 9.5px, 10.5px …),
   also mit Werten, die es in ihrer eigenen Skala nicht gibt. Beide
   Dateien haben je einen Druckblock, aber keinen mit Schriftgrössen —
   nachgesehen, nicht angenommen. */
for (const [d, rueckfall] of [['styles.css', false], ['app.js', true],
                              ['ui/wochenraster.css', false],
                              ['submit/zeit/stil.css', false]]) {
    const r = bearbeite(d, setzen, rueckfall);
    g.summe += r.summe; g.uebersprungen += r.uebersprungen;
}
console.log('\nGesamt: ' + g.summe + ' gehoben, ' + g.uebersprungen + ' im Druck unberührt.\n');
