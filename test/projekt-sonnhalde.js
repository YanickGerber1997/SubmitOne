// Projekt Sonnhalde anlegen — Eigenpromotion, Sonnhaldenweg 1A, 3076 Worb.
//
// Aufruf:  node test/projekt-sonnhalde.js            (nur zeigen)
//          node test/projekt-sonnhalde.js schreiben
//
// Legt den Projektordner mit der .submit-Datei an, so wie es der
// Ordner-Adapter erwartet: <Ordnername>\<Ordnername>.submit
//
// Eigenpromotion heisst: Bauherrschaft und Bauleitung sind dasselbe Haus.
// Deshalb steht bei beidem die Firma — und nicht ein erfundener Dritter.

const fs = require('fs');
const path = require('path');
const U = require('../submit/kern/uebersetzer.js');

const schreiben = process.argv[2] === 'schreiben';
const basis = path.join(__dirname, '..', 'privat', 'Projekte');
const allgPfad = path.join(basis, 'Allgemein.subone');

const NAME = 'Sonnhalde';
const ordner = path.join(basis, NAME);
const datei = path.join(ordner, NAME + '.submit');

/* Die Bauleitung steht schon im Büro — nicht abtippen, übernehmen. */
const allg = fs.existsSync(allgPfad) ? JSON.parse(fs.readFileSync(allgPfad, 'utf8')) : {};
const firma = (allg.buero && allg.buero.firma) || 'P. Hefti Bauberatung GmbH';

const projekt = {
  id: 'p_sonnhalde',
  name: NAME,
  ort: '3076 Worb',
  adresse: 'Sonnhaldenweg 1A',
  bauherr: firma + ' (Eigenpromotion)',
  projektleiter: firma,
  phase: 'vorbereitung',
  start: '',
  ende: '',
  farbe: '#8d2a55',              // die Hausfarbe aus dem Signet
  vergaben: [],
  protokolle: [],
  pendenzen: [],
  mitglieder: []
};

console.log('\n=== Projekt Sonnhalde ===');
console.log('  Name           ' + projekt.name);
console.log('  Adresse        ' + projekt.adresse + ', ' + projekt.ort);
console.log('  Bauherrschaft  ' + projekt.bauherr);
console.log('  Bauleitung     ' + projekt.projektleiter);
console.log('  Ordner         privat\\Projekte\\' + NAME + '\\' + NAME + '.submit');

if (fs.existsSync(datei)) {
  console.log('\n  Gibt es bereits — nichts geändert.\n');
  process.exit(0);
}

console.log('\n=== Was noch fehlt ===');
[['Objekt-Nr.',      'wie 2510 bei der Römerstrasse — habt ihr eine?'],
 ['Art des Vorhabens', 'Neubau, Umbau, Aufstockung? Steht dann im Namen: «Neubau Sonnhalde»'],
 ['Anzahl Einheiten', 'bei einer Eigenpromotion meist mehrere Wohnungen — für die Bauherrenauswahl je Einheit'],
 ['Termine',          'Baustart und Bezug, sobald bekannt'],
 ['Kostenvoranschlag','die BKP-Gliederung, dann kann die Kostenübersicht aufgebaut werden']
].forEach(([k, w]) => console.log('  ' + k.padEnd(20) + w));

if (!schreiben) { console.log('\n  Zum Anlegen:  node test/projekt-sonnhalde.js schreiben\n'); process.exit(0); }

if (!fs.existsSync(ordner)) fs.mkdirSync(ordner, { recursive: true });
fs.writeFileSync(datei, JSON.stringify(U.zuMappe(projekt), null, 1), 'utf8');

/* Auch SubZeit soll das Projekt kennen, sonst lässt sich keine Stunde
   darauf buchen. Die Projektliste dort ist ein Abbild des Ordners. */
if (fs.existsSync(allgPfad)) {
  const a = JSON.parse(fs.readFileSync(allgPfad, 'utf8'));
  if (a.zeit && Array.isArray(a.zeit.projekte)) {
    if (!a.zeit.projekte.some(x => x.id === projekt.id)) {
      a.zeit.projekte.push({ id: projekt.id, name: projekt.name, kunde: projekt.bauherr, farbe: projekt.farbe });
      a.zeit.geaendert = new Date().toISOString();
      fs.writeFileSync(allgPfad, JSON.stringify(a, null, 1), 'utf8');
      console.log('\n  In SubZeit als buchbares Projekt ergänzt.');
    }
  }
}

console.log('\n  Angelegt.\n');
