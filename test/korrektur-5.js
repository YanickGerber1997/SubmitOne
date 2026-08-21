// Korrekturen vom 14.08.2026, fünfte Runde.
//
// Aufruf:  node test/korrektur-5.js            (nur zeigen)
//          node test/korrektur-5.js schreiben
//
//   1. 215 Ing. Holzbau entfällt ab revidiertem KV
//      (KV 9'000 bleibt stehen — sonst zeigt die Über-/Unterschreitung
//       die Einsparung nicht)
//   2. 221.6 Türen + Tore ist Metallbau: Bauschlosserei Hermann, nicht Odermatt
//      → Sammelvergabe «Fenster + Türen» auflösen
//      → neue Sammelvergabe Bauschlosserei Hermann: 221.6 + 272
//   3. 273.0 Aussentür Holz: Direktvergabe, Unternehmer noch offen

const fs = require('fs');
const path = require('path');
const U = require('../submit/kern/uebersetzer.js');

const schreiben = process.argv[2] === 'schreiben';
const datei = path.join(__dirname, '..', 'privat', 'Projekte',
  'Umbau EFH Römerstrasse 31', 'Umbau EFH Römerstrasse 31.submit');

const p = U.ausMappe(JSON.parse(fs.readFileSync(datei, 'utf8')));
const finde = bkp => p.vergaben.find(v => (v.bkp || '') === bkp);
const f = n => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2 }).format(n || 0);

/* ---- 1. 215 entfällt ---- */
const ing = finde('215');
if (ing) {
  ing.entfaellt = true;
  ing.entfaelltAb = 'kv-rev';
  ing.beschrieb = 'Im Kostenvoranschlag mit 9 000.00 budgetiert, im revidierten KV entfallen. Leistung ist in 214 enthalten.';
  console.log('\n  215 Ing. Holzbau      entfällt ab revidiertem KV · KV ' + f(ing.schaetzung) + ' bleibt als Vergleich');
}

/* ---- 2. Türen + Tore gehört zum Metallbauer ---- */
const tueren = finde('221.6');
const metall = finde('272');
if (tueren) {
  tueren.firma = 'Bauschlosserei Hermann';
  tueren.beschrieb = 'Metallbau — Aussentüren und Tore. Die neue Holztür läuft separat unter 273.0.';
  (tueren.eingeladene || []).forEach(e => { if (e.firma === 'Odermatt' || e.firma === 'Odermatt Fensterbau') e.firma = 'Bauschlosserei Hermann'; });
}
if (metall) metall.firma = 'Bauschlosserei Hermann';

// Die alte Sammelvergabe «Fenster und Aussentüren» war falsch — auflösen.
p.vergaben.forEach(v => { if (v.sammelId === 'sv_fenster') delete v.sammelId; });
p.sammelvergaben = (p.sammelvergaben || []).filter(s => s.id !== 'sv_fenster');

// Neue Sammelvergabe: Metallbau
if (tueren && metall) {
  if (!p.sammelvergaben.find(s => s.id === 'sv_metallbau')) {
    p.sammelvergaben.push({ id: 'sv_metallbau', name: 'Metallbauarbeiten', firma: 'Bauschlosserei Hermann',
      art: 'werkvertrag', notiz: 'Aussentüren und Tore sowie die allgemeinen Metallbauarbeiten aus einem Auftrag.' });
  }
  tueren.sammelId = 'sv_metallbau';
  metall.sammelId = 'sv_metallbau';
}

/* ---- 3. Holztür ---- */
const holz = finde('273.0');
if (holz) {
  holz.art = 'direkt';
  holz.firma = '';
  holz.beschrieb = 'Neu. Unternehmer noch offen, wird eine Direktvergabe. Montage ein Tag, in der Fensterwoche. Betrag noch offen.';
}

/* ---- Bericht ---- */
const bet = v => v.entfaellt ? 0
  : (v.status === 'vergeben' ? (Number(v.betrag) || 0)
  : (((v.eingeladene || [])[0] && v.eingeladene[0].betrag != null) ? Number(v.eingeladene[0].betrag) : (Number(v.schaetzung) || 0)));

console.log('\n=== Sammelvergaben ===');
(p.sammelvergaben || []).forEach(s => {
  const teile = p.vergaben.filter(v => v.sammelId === s.id);
  console.log('\n  ' + (s.firma || '(offen)') + '  —  ' + s.name);
  teile.forEach(v => console.log('     ' + (v.bkp || '').padEnd(8) + (v.gewerk || '').slice(0, 32).padEnd(34)
    + (v.ausweisen === false ? '  in Hauptvertrag' : f(bet(v)).padStart(13))));
  console.log('     ' + ''.padEnd(42) + f(teile.reduce((a, v) => a + bet(v), 0)).padStart(13));
});

console.log('\n=== Entfallene Positionen ===');
p.vergaben.filter(v => v.entfaellt).forEach(v =>
  console.log('  ' + (v.bkp || '').padEnd(8) + (v.gewerk || '').padEnd(30)
    + 'KV ' + f(v.schaetzung).padStart(11) + '   zählt mit 0.00   Einsparung ' + f(v.schaetzung)));

const inKosten = p.vergaben.filter(v => v.ausweisen !== false);
const summe = inKosten.reduce((a, v) => a + bet(v), 0);
console.log('\n=== Baukostenübersicht ===');
console.log('  Vergabesummen         ' + f(summe) + '    Vorlage 795 077.85   '
  + (Math.abs(summe - 795077.85) < 0.01 ? 'stimmt' : 'ABWEICHUNG ' + f(summe - 795077.85)));

if (schreiben) {
  fs.writeFileSync(datei, JSON.stringify(U.zuMappe(p), null, 1), 'utf8');
  console.log('\n  Geschrieben.\n');
} else {
  console.log('\n  Nur angezeigt. Zum Übernehmen:  node test/korrektur-5.js schreiben\n');
}
