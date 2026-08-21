// Korrekturen vom 14.08.2026, vierte Runde.
//
// Aufruf:  node test/korrektur-4.js            (nur zeigen)
//          node test/korrektur-4.js schreiben
//
//   1. 112, 211.3, 211.4, 211.5 in den Sammelauftrag 211 (Fuhrer Masciadri)
//      und «nicht ausweisen»: Sie tragen nur Termine, ihr Geld steckt in 211.
//   2. Holzbauer heisst Horibe, nicht Horobe.

const fs = require('fs');
const path = require('path');
const U = require('../submit/kern/uebersetzer.js');

const schreiben = process.argv[2] === 'schreiben';
const datei = path.join(__dirname, '..', 'privat', 'Projekte',
  'Umbau EFH Römerstrasse 31', 'Umbau EFH Römerstrasse 31.submit');

const p = U.ausMappe(JSON.parse(fs.readFileSync(datei, 'utf8')));
const finde = bkp => p.vergaben.find(v => (v.bkp || '') === bkp);
const f = n => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2 }).format(n || 0);

/* ---- 1. Termin-Positionen des Baumeisters ---- */
const NUR_TERMINE = ['112', '211.3', '211.4', '211.5'];
console.log('\n=== Sammelauftrag 211 · Fuhrer Masciadri ===');
NUR_TERMINE.forEach(bkp => {
  const v = finde(bkp); if (!v) { console.log('  ' + bkp + ' nicht gefunden'); return; }
  v.sammelId = 'sv_baumeister';
  v.ausweisen = false;
  v.firma = '';                       // steht im Hauptvertrag, nicht hier
  v.beschrieb = 'In 211 erfasst. Trägt nur die Termine.';
});

/* ---- 2. Horibe ---- */
let umbenannt = 0;
p.vergaben.forEach(v => {
  if (v.firma === 'Horobe Holzbau') { v.firma = 'Horibe Holzbau'; umbenannt++; }
  (v.eingeladene || []).forEach(e => { if (e.firma === 'Horobe Holzbau') { e.firma = 'Horibe Holzbau'; umbenannt++; } });
  (v.rechnungen || []).forEach(r => { if (r.firma === 'Horobe Holzbau') { r.firma = 'Horibe Holzbau'; umbenannt++; } });
});
(p.sammelvergaben || []).forEach(s => { if (s.firma === 'Horobe Holzbau') { s.firma = 'Horibe Holzbau'; umbenannt++; } });

/* ---- Bericht ---- */
const bet = v => v.status === 'vergeben' ? (Number(v.betrag) || 0)
  : (((v.eingeladene || [])[0] && v.eingeladene[0].betrag != null) ? Number(v.eingeladene[0].betrag) : (Number(v.schaetzung) || 0));

const teile = p.vergaben.filter(v => v.sammelId === 'sv_baumeister');
teile.forEach(v => {
  const zeigt = v.ausweisen !== false;
  console.log('  ' + (v.bkp || '').padEnd(8) + (v.gewerk || '').slice(0, 32).padEnd(34)
    + (zeigt ? f(bet(v)).padStart(13) : '  in 211 erfasst')
    + (v.bauStart ? '   ' + v.bauStart + ' – ' + v.bauEnde : ''));
});
console.log('  ' + ''.padEnd(42) + f(teile.reduce((a, v) => a + bet(v), 0)).padStart(13));

console.log('\n=== Horibe ===');
console.log('  ' + umbenannt + ' Stellen umbenannt');

const inKosten = p.vergaben.filter(v => v.ausweisen !== false);
const summe = inKosten.reduce((a, v) => a + bet(v), 0);
console.log('\n=== Baukostenübersicht ===');
console.log('  Zeilen                ' + inKosten.length + '  (' + (p.vergaben.length - inKosten.length) + ' nur Termine, ausgeblendet)');
console.log('  Vergabesummen         ' + f(summe) + '    Vorlage 795 077.85   '
  + (Math.abs(summe - 795077.85) < 0.01 ? 'stimmt' : 'ABWEICHUNG ' + f(summe - 795077.85)));

console.log('\n=== Nicht ausgewiesen, aber im Bauprogramm ===');
p.vergaben.filter(v => v.ausweisen === false).forEach(v =>
  console.log('  ' + (v.bkp || '').padEnd(8) + (v.gewerk || '').padEnd(30)
    + (v.bauStart ? v.bauStart + ' – ' + v.bauEnde : 'ohne Termine')));

if (schreiben) {
  fs.writeFileSync(datei, JSON.stringify(U.zuMappe(p), null, 1), 'utf8');
  console.log('\n  Geschrieben.\n');
} else {
  console.log('\n  Nur angezeigt. Zum Übernehmen:  node test/korrektur-4.js schreiben\n');
}
