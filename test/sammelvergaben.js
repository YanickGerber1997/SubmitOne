// Legt die Sammelvergaben für Umbau EFH Römerstrasse 31 an.
//
// Aufruf:  node test/sammelvergaben.js            (nur zeigen)
//          node test/sammelvergaben.js schreiben
//
// Eine Sammelvergabe ist EIN Auftrag über mehrere BKP-Positionen. Der Betrag
// bleibt je Position — die Kostenübersicht nach BKP stimmt unverändert.
//
// Grundlage: die Vermerke der Baukostenübersicht («Teil aus 211») und die
// Unternehmernamen. Wo dieselbe Firma mehrere Positionen hat, ist es in aller
// Regel eine Offerte.

const fs = require('fs');
const path = require('path');
const U = require('../submit/kern/uebersetzer.js');

const schreiben = process.argv[2] === 'schreiben';
const datei = path.join(__dirname, '..', 'privat', 'Projekte',
  'Umbau EFH Römerstrasse 31', 'Umbau EFH Römerstrasse 31.submit');

const GRUPPEN = [
  { id: 'sv_baumeister', name: 'Baumeisterarbeiten', firma: 'Fuhrer Masciadri',
    bkp: ['211', '121', '289'],
    notiz: 'Laut Kostenübersicht: «Teil in 121 und 289». Ein Werkvertrag, drei BKP-Positionen.' },

  { id: 'sv_gipser', name: 'Gipser- und Fassadenarbeiten', firma: 'Staub + Hostettler',
    bkp: ['226.2', '271'],
    notiz: 'Verputzte Aussenwärmedämmung und Gipserarbeiten aus einer Offerte.' },

  { id: 'sv_haustechnik', name: 'Heizung und Sanitär', firma: 'Eichenberger',
    bkp: ['240', '250'],
    notiz: 'Heizungs- und Sanitäranlagen aus einer Offerte.' },

  { id: 'sv_architekt', name: 'Architektur und Bauleitung', firma: 'P. Hefti Bauberatung',
    bkp: ['191', '291'],
    notiz: 'Vorbereitung und Honorar aus demselben Auftrag.' }
];

const p = U.ausMappe(JSON.parse(fs.readFileSync(datei, 'utf8')));
const f = n => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

/* Betrag einer Position, wie kostenZeile() ihn rechnet: vergeben → WV, sonst
   revidierter KV, sonst KV. */
function betrag(v) {
  if (v.status === 'vergeben') return Number(v.betrag) || 0;
  const o = (v.eingeladene || [])[0];
  if (o && o.betrag != null) return Number(o.betrag) || 0;
  return Number(v.schaetzung) || 0;
}

p.sammelvergaben = [];
p.vergaben.forEach(v => { delete v.sammelId; });

console.log('\n=== Sammelvergaben ===');
for (const g of GRUPPEN) {
  const teile = g.bkp.map(b => p.vergaben.find(v => (v.bkp || '') === b)).filter(Boolean);
  if (teile.length < 2) { console.log('  ' + g.name + ': zu wenige Positionen gefunden — übersprungen'); continue; }

  p.sammelvergaben.push({ id: g.id, name: g.name, firma: g.firma, art: 'werkvertrag', notiz: g.notiz });
  teile.forEach(v => { v.sammelId = g.id; if (!v.firma) v.firma = g.firma; });

  const summe = teile.reduce((a, v) => a + betrag(v), 0);
  console.log('\n  ' + g.firma + '  —  ' + g.name);
  teile.forEach(v => console.log('     ' + (v.bkp || '').padEnd(8) + (v.gewerk || '').slice(0, 34).padEnd(36) + f(betrag(v)).padStart(13)));
  console.log('     ' + ''.padEnd(44) + '─'.repeat(13));
  console.log('     ' + 'ein Auftrag'.padEnd(44) + f(summe).padStart(13));
}

/* ---- Wer bekommt einen eigenen Plan? ---- */
const SCHWELLE = 10000;
const einheiten = new Map();
p.vergaben.forEach(v => {
  const b = betrag(v);
  if (b <= 0) return;
  const key = v.sammelId || ('e:' + v.id);
  if (!einheiten.has(key)) {
    const s = v.sammelId ? p.sammelvergaben.find(x => x.id === v.sammelId) : null;
    einheiten.set(key, { firma: (s && s.firma) || v.firma || '—', name: s ? s.name : (v.gewerk || ''), sammel: !!s, betrag: 0, terminiert: 0 });
  }
  const e = einheiten.get(key);
  e.betrag += b;
  if (v.bauStart && v.bauEnde) e.terminiert += b;
});

const liste = [...einheiten.values()].sort((a, b) => b.betrag - a.betrag);
const gross = liste.filter(e => e.betrag >= SCHWELLE);

console.log('\n\n=== Zahlungspläne ab CHF ' + f(SCHWELLE) + ' ===');
gross.forEach(e => console.log('  ' + (e.firma || '—').slice(0, 24).padEnd(26)
  + f(e.betrag).padStart(13)
  + (e.sammel ? '   Sammelvergabe' : '')
  + (e.terminiert < e.betrag - 0.005 ? '   (' + f(e.betrag - e.terminiert) + ' ohne Termine)' : '')));
console.log('\n  ' + gross.length + ' Pläne · ' + (liste.length - gross.length) + ' Aufträge darunter');

if (schreiben) {
  fs.writeFileSync(datei, JSON.stringify(U.zuMappe(p), null, 1), 'utf8');
  console.log('\n  Geschrieben.\n');
} else {
  console.log('\n  Nur angezeigt. Zum Übernehmen:  node test/sammelvergaben.js schreiben\n');
}
