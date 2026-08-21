// Korrekturen vom 14.08.2026, zweite Runde.
//
// Aufruf:  node test/korrektur-2.js            (nur zeigen)
//          node test/korrektur-2.js schreiben
//
//   1. 112 Abbrüche gehört zum Sammelauftrag Fuhrer Masciadri
//   2. Beschaffungsart je Gewerk setzen: Ausschreibung · Direktvergabe · Budget
//   3. 199 Übriges wird eine Budgetposition ohne Unternehmer

const fs = require('fs');
const path = require('path');
const U = require('../submit/kern/uebersetzer.js');

const schreiben = process.argv[2] === 'schreiben';
const datei = path.join(__dirname, '..', 'privat', 'Projekte',
  'Umbau EFH Römerstrasse 31', 'Umbau EFH Römerstrasse 31.submit');

const p = U.ausMappe(JSON.parse(fs.readFileSync(datei, 'utf8')));
const finde = bkp => p.vergaben.find(v => (v.bkp || '') === bkp);

/* ---- 1. Abbrüche zum Baumeister-Auftrag ---- */
const abb = finde('112');
if (abb) { abb.sammelId = 'sv_baumeister'; if (!abb.firma) abb.firma = 'Fuhrer Masciadri'; }

/* ---- 2. Beschaffungsart ----
   budget  = kein Unternehmer, nur ein Betrag für später eintreffende Rechnungen
   direkt  = ohne Wettbewerb vergeben
   sonst     Ausschreibung (Vorgabe, nicht gesetzt) */
const ART = {
  '199':   'budget',   // Übriges — es wird nie einen eigenen Unternehmer geben
  '299.1': 'budget',   // Reserve
  '52':    'budget',   // Baunebenkosten
  '225':   'budget',   // Dichtungen/Dämmungen — in der Vorlage als «Budget» geführt
  '511.0': 'direkt',   // Gebühren und Bewilligungen
  '296':   'direkt',   // Schadstoff-Untersuchung
  '104':   'direkt',   // Baugespann
  '191':   'direkt',   // Architekt Vorbereitung
  '291':   'direkt',   // Honorar Architekt
  '292':   'direkt'    // Ingenieur
};
/* Die revidierten Kostenvoranschläge aus der Baukostenübersicht — sie sind bei
   Budgetpositionen der Budgetbetrag und dürfen nicht verlorengehen. */
const REV = { '199': 0, '225': 5000, '299.1': 20000, '52': 10000 };

Object.entries(ART).forEach(([bkp, art]) => {
  const v = finde(bkp); if (!v) return;
  v.art = art;
  if (art === 'budget') {
    v.firma = ''; v.status = 'ausschreibung';
    // eingeladene NICHT leeren: dort steht der revidierte KV. Fehlt er,
    // fällt die Prognose auf den alten KV zurück (299.1 wären 50'000 statt 20'000).
    if (REV[bkp] !== undefined && !((v.eingeladene || [])[0])) {
      v.eingeladene = [{ id: 'eo_' + bkp.replace('.', '_'), firma: 'Budget', email: '',
                         betrag: REV[bkp], status: 'offeriert', datumMail: '' }];
    }
  }
});

/* ---- 3. 199 als Budgetposition mit einem Posten ----
   Kommt später eine Rechnung, wird sie hier gebucht und der Betrag verteilt. */
const uebriges = finde('199');
if (uebriges) {
  uebriges.beschrieb = 'Kein eigener Unternehmer. Der Betrag steht bereit; eintreffende Rechnungen werden hier gebucht.';
  if (!(uebriges.budgetposten || []).length) {
    uebriges.budgetposten = [{
      id: 'bp_199_1', text: 'Übriges — noch nicht zugeteilt',
      betrag: 500, ist: null
    }];
  }
}

/* ---- 4. 211: kleiner Zusatzauftrag an Kilchherr ----
   Innerhalb des Gewerks, nicht zusätzlich: Die Summe der Teilbeträge bleibt
   die Vergabesumme von 103'397.75. Kilchherrs Anteil ist ANGENOMMEN — die
   Zahlung vom 10.12.25 über 1'179.90 ging vor Fuhrers erstem Akonto ein und
   dürfte sein Auftrag sein. In der Oberfläche unter «Vergabe-Art» änderbar. */
const bau = finde('211');
if (bau) {
  const gesamt = Number(bau.betrag) || 0;
  const kilchherr = 1179.90;
  bau.teilvergaben = [
    { firma: 'Fuhrer Masciadri', betrag: Math.round((gesamt - kilchherr) * 100) / 100 },
    { firma: 'Kilchherr',        betrag: kilchherr }
  ];
  // Die Zahlung dem richtigen Unternehmer zuordnen.
  (bau.rechnungen || []).forEach(r => {
    if (Math.abs((Number(r.betrag) || 0) - kilchherr) < 0.01) { r.firma = 'Kilchherr'; r.text = 'Zusatzauftrag'; }
    else if (!r.firma) r.firma = 'Fuhrer Masciadri';
  });
}

/* ---- Bericht ---- */
const f = n => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2 }).format(n || 0);
const betrag = v => v.status === 'vergeben' ? (Number(v.betrag) || 0)
  : ((v.eingeladene || [])[0] && v.eingeladene[0].betrag != null ? Number(v.eingeladene[0].betrag) : (Number(v.schaetzung) || 0));

console.log('\n=== Beschaffungsart ===');
const nach = { ausschreibung: [], direkt: [], budget: [] };
p.vergaben.forEach(v => nach[v.art && nach[v.art] ? v.art : 'ausschreibung'].push(v));
Object.entries(nach).forEach(([art, liste]) => {
  console.log('\n  ' + art.toUpperCase() + '  (' + liste.length + ')');
  liste.forEach(v => console.log('     ' + (v.bkp || '—').padEnd(8) + (v.gewerk || '').slice(0, 34).padEnd(36)
    + f(betrag(v)).padStart(12) + '   ' + (v.firma || '')));
});

console.log('\n=== Sammelauftrag Fuhrer Masciadri ===');
const teile = p.vergaben.filter(v => v.sammelId === 'sv_baumeister');
teile.forEach(v => console.log('  ' + (v.bkp || '').padEnd(8) + (v.gewerk || '').slice(0, 32).padEnd(34) + f(betrag(v)).padStart(13)));
console.log('  ' + ''.padEnd(42) + f(teile.reduce((a, v) => a + betrag(v), 0)).padStart(13));

if (schreiben) {
  fs.writeFileSync(datei, JSON.stringify(U.zuMappe(p), null, 1), 'utf8');
  console.log('\n  Geschrieben.\n');
} else {
  console.log('\n  Nur angezeigt. Zum Übernehmen:  node test/korrektur-2.js schreiben\n');
}
