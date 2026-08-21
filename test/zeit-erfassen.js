// Arbeitszeiten für den 12. und 13.08.2026 erfassen.
//
// Aufruf:  node test/zeit-erfassen.js            (nur zeigen)
//          node test/zeit-erfassen.js schreiben
//
// Die Einträge gehen nach Allgemein.subone unter `zeit` — das ist das
// vollständige SubZeit-Dokument. Beide Programme lesen dieselbe Stelle:
// SubmitOne erfasst, SubZeit zeigt und wertet aus. Es gibt keine zweite
// Wahrheit und nichts abzugleichen.
//
// Zeiten sind Minuten ab Mitternacht — so rechnet SubZeit.

const fs = require('fs');
const path = require('path');

const schreiben = process.argv[2] === 'schreiben';
const basis = path.join(__dirname, '..', 'privat', 'Projekte');
const allgPfad = path.join(basis, 'Allgemein.subone');

const uhr = s => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const std = m => (m / 60).toFixed(2).replace('.', ',') + ' h';
let lfd = 0;
const id = vor => vor + '_' + Date.now().toString(36) + '_' + (lfd++).toString(36);

/* ---- Die Projekte aus dem Arbeitsordner, damit die Zuordnung stimmt ---- */
const projekte = [];
for (const ordner of fs.readdirSync(basis, { withFileTypes: true })) {
  if (!ordner.isDirectory()) continue;
  const d = path.join(basis, ordner.name, ordner.name + '.submit');
  if (!fs.existsSync(d)) continue;
  const m = JSON.parse(fs.readFileSync(d, 'utf8'));
  projekte.push({
    id: (m.module && m.module.one && m.module.one.id) || ordner.name,
    name: (m.kopf && m.kopf.projekt) || ordner.name,
    kunde: (m.kopf && m.kopf.bauherr) || '',
    farbe: (m.module && m.module.one && m.module.one.farbe) || ''
  });
}
const finde = teil => (projekte.find(x => x.name.toLowerCase().includes(teil.toLowerCase())) || {}).id || null;
const ROEM = finde('Römerstrasse');
const KUNO = finde('Kunoweg');

/* ---- Tätigkeiten ---- */
const TAET = [
  { id: id('ta'), name: 'Arbeit',         verrechenbar: true },
  { id: id('ta'), name: 'Beratung',       verrechenbar: true },
  { id: id('ta'), name: 'Reisezeit',      verrechenbar: true },
  { id: id('ta'), name: 'Interne Arbeit', verrechenbar: false },
  { id: id('ta'), name: 'Sitzung',        verrechenbar: false }
];
const tId = n => (TAET.find(t => t.name === n) || {}).id || null;

/* ---- Die Einträge ---- */
const roh = [
  /* Mittwoch, 12.08.2026 — 07:30 bis 17:00, eine Stunde Mittag */
  ['2026-08-12', '07:30', '09:30', KUNO, 'Arbeit',
   'Baukostenbereinigung Kunoweg 20: Nachträge nachgebucht und die Kostenübersicht auf den aktuellen Stand gebracht.'],
  ['2026-08-12', '09:30', '11:30', ROEM, 'Arbeit',
   'Baukostenbereinigung Römerstrasse 31: Nachträge nachgebucht, anschliessend mit der Erfassung der Bauherrenwünsche begonnen.'],
  ['2026-08-12', '11:30', '12:00', ROEM, 'Arbeit',
   'Letzte Aufträge erfasst — ein Teil war bereits versandt, unterzeichnet zurückgekommen und wurde eingetragen.'],
  ['2026-08-12', '13:00', '14:30', ROEM, 'Arbeit',
   'Letzte Vergaben vorbereitet (Parkett und weitere): Leistungsverzeichnis für die Offertanfrage zusammengestellt.'],
  ['2026-08-12', '14:30', '16:00', ROEM, 'Arbeit',
   'Mit dem Zahlungsplan für die Bauherrschaft begonnen.'],
  ['2026-08-12', '16:00', '17:00', null, 'Sitzung',
   'Planungsüberlegungen für die Sitzung bei der Gemeinde angestellt.'],

  /* Donnerstag, 13.08.2026 — 07:30 bis 17:00, eine Stunde Mittag */
  ['2026-08-13', '07:30', '12:00', ROEM, 'Arbeit',
   'Zahlungsplan für die Bauherrschaft erstellt: Werkverträge und Konditionen je Gewerk durchgerechnet, die Zahlungen monatsweise über die Bauzeit verteilt und je Monat nach Kostenposition und Unternehmer aufgeschlüsselt. Zusätzlich die Zahlungspläne der einzelnen Unternehmer aufgebaut.'],
  ['2026-08-13', '13:00', '14:00', null, 'Interne Arbeit',
   'Korrespondenz: Mails bearbeitet und beantwortet.'],
  ['2026-08-13', '14:00', '17:00', ROEM, 'Arbeit',
   'Zahlungsplan fertiggestellt und für die Bauherrschaft aufbereitet: Rechnungslauf und Zahlungsfristen hinterlegt, bereits verrechnete Beträge eingerechnet und das Dokument zum Versand gesetzt.']
];

const eintraege = roh.map(([datum, von, bis, pid, taet, notiz]) => ({
  id: id('ze'), datum, von: uhr(von), bis: uhr(bis), pause: 0,
  projektId: pid, taetigkeitId: tId(taet), aufgabeId: null,
  notiz, status: 'entwurf'
}));

/* ---- Anzeigen ---- */
const projName = pid => (projekte.find(x => x.id === pid) || {}).name || '— ohne Projekt —';
const tage = [...new Set(eintraege.map(e => e.datum))].sort();
const WT = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

console.log('\n=== Projekte im Arbeitsordner ===');
projekte.forEach(p => console.log('  ' + p.name + (p.kunde ? '   (' + p.kunde + ')' : '')));
if (!ROEM) console.log('  ACHTUNG: Römerstrasse nicht gefunden');
if (!KUNO) console.log('  ACHTUNG: Kunoweg nicht gefunden');

let gesamt = 0;
for (const tag of tage) {
  const heute = eintraege.filter(e => e.datum === tag);
  const min = heute.reduce((a, e) => a + (e.bis - e.von - (e.pause || 0)), 0);
  gesamt += min;
  const d = new Date(tag + 'T12:00:00');
  console.log('\n=== ' + WT[d.getDay()] + ', ' + tag.slice(8) + '.' + tag.slice(5, 7) + '.' + tag.slice(0, 4)
    + '   ' + std(min) + ' ===');
  heute.forEach(e => {
    console.log('  ' + hhmm(e.von) + '–' + hhmm(e.bis) + '  ' + std(e.bis - e.von).padStart(8)
      + '  ' + projName(e.projektId).slice(0, 26).padEnd(28)
      + (TAET.find(t => t.id === e.taetigkeitId) || {}).name);
    console.log('      ' + e.notiz);
  });
  // Mittagspause sichtbar machen, wo eine Lücke ist
  for (let i = 1; i < heute.length; i++) {
    const l = heute[i].von - heute[i - 1].bis;
    if (l > 0) console.log('  ' + hhmm(heute[i - 1].bis) + '–' + hhmm(heute[i].von) + '  ' + std(l).padStart(8) + '  Mittagspause');
  }
}
console.log('\n  Zusammen ' + std(gesamt) + ' in ' + eintraege.length + ' Einträgen');

if (!schreiben) { console.log('\n  Zum Übernehmen:  node test/zeit-erfassen.js schreiben\n'); process.exit(0); }

/* ---- Schreiben ---- */
const allg = fs.existsSync(allgPfad) ? JSON.parse(fs.readFileSync(allgPfad, 'utf8')) : { format: 'submit.allgemein', fassung: 1 };
const jahr = 2026;
const z = allg.zeit && typeof allg.zeit === 'object' ? allg.zeit : {};

/* Das Format muss genau so heissen, wie SubZeit es prüft (kern.js: FORMAT).
   Steht dort etwas anderes, wirft pruefe() eine Ausnahme und der Ordner
   lässt sich nicht öffnen — die Seite bleibt einfach hängen. */
allg.zeit = Object.assign({
  format: 'submit.zeit', fassung: 1,
  geaendert: new Date().toISOString(),
  kopf: { projekt: '', bauherr: '', ort: '', bauleitung: '' },
  person: { name: 'Yanick Gerber', kuerzel: 'YG' },
  einstellungen: {
    stufe: 'firma', kanton: 'BE', raster: 15,
    sollProTag: { 1: 510, 2: 510, 3: 510, 4: 510, 5: 480, 6: 0, 0: 0 },
    pauseAbMinuten: 330, pauseMinuten: 30,
    ferienTageProJahr: 25, waehrung: 'CHF', stundensatz: 140, arbeitsjahr: jahr
  },
  kunden: [], aufgaben: [], wochenziele: [], absenzen: [],
  absenztypen: [
    { id: id('ab'), name: 'Ferien',    farbe: '#0ea5e9', zaehltAlsArbeit: true,  vomKonto: true },
    { id: id('ab'), name: 'Krankheit', farbe: '#f59e0b', zaehltAlsArbeit: true,  vomKonto: false },
    { id: id('ab'), name: 'Unfall',    farbe: '#ef4444', zaehltAlsArbeit: true,  vomKonto: false },
    { id: id('ab'), name: 'Militär',   farbe: '#84cc16', zaehltAlsArbeit: true,  vomKonto: false },
    { id: id('ab'), name: 'Unbezahlt', farbe: '#94a3b8', zaehltAlsArbeit: false, vomKonto: false }
  ],
  eigeneFeiertage: [], abgewaehlteFeiertage: [], rechnungen: []
}, z);

/* Die Projektliste gehört dem Ordner, nicht dem Zeitdokument — SubZeit
   spiegelt sie beim Öffnen aus den .submit-Dateien und löscht sie beim
   Speichern wieder heraus (app.js: projekteSpiegeln). Hier stünde sie nur
   doppelt und liefe irgendwann auseinander. */
delete allg.zeit.projekte;
allg.zeit.taetigkeiten = (z.taetigkeiten && z.taetigkeiten.length) ? z.taetigkeiten : TAET;
allg.zeit.eintraege   = (z.eintraege || []).filter(e => !tage.includes(e.datum)).concat(eintraege);
allg.zeit.geaendert   = new Date().toISOString();

fs.writeFileSync(allgPfad, JSON.stringify(allg, null, 1), 'utf8');
console.log('\n  Geschrieben nach Allgemein.subone unter „zeit".');
console.log('  ' + allg.zeit.eintraege.length + ' Einträge insgesamt, ' + projekte.length + ' Projekte verknüpft.\n');
