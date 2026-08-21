// Prüft den Übersetzer zwischen SubmitOne-Projekt und Projektmappe.
// Aufruf:  node test/uebersetzer-node.js     (Exit 0 = alles OK, 2 = Fehler)
//
// Die Zusage, die hier bewiesen wird: Was hineingeht, kommt unverändert
// wieder heraus. Geht das kaputt, verliert ein Kunde beim Speichern Daten —
// und merkt es erst Wochen später.

const U = require('../submit/kern/uebersetzer.js');

/* Das Erstelldatum muss den Umweg über die Datei überleben.
   Bis zum 14.08.2026 tat es das nicht: `ausMappe` gab es nie ans Projekt
   zurück, `zuMappe` erfand beim nächsten Speichern ein neues. Nach einmal
   Öffnen und Sichern stand dort das heutige Datum. */
(function erstelldatumUeberlebt() {
  const alt = '2025-11-27T08:15:00.000Z';
  const m1 = { format: 'submit.mappe', fassung: 1, erstellt: alt, geaendert: alt,
               kopf: { projekt: 'Alt', bauherr: 'B', ort: 'O', bauleitung: 'PL' },
               gewerke: [], module: { one: { id: 'p1' }, vergabe: { vergaben: [] } } };
  const p = U.ausMappe(m1);
  if (p.erstellt !== alt) throw new Error('ausMappe gibt das Erstelldatum nicht zurück');
  const m2 = U.zuMappe(p);
  if (m2.erstellt !== alt) throw new Error('zuMappe erfindet ein neues Erstelldatum: ' + m2.erstellt);
  if (m2.module.one.erstellt !== undefined) throw new Error('Erstelldatum liegt doppelt im Fach one');
  if (m2.geaendert === alt) throw new Error('das Änderungsdatum müsste neu sein');

  /* Und zweimal serialisieren muss denselben Text ergeben — sonst hält der
     Ordner-Adapter eine unveränderte Datei für geändert und schreibt sie. */
  const ohne = t => String(t).replace(/"(geaendert|erstellt)":\s*"[^"]*",?/g, '');
  const a = JSON.stringify(U.zuMappe(p), null, 1);
  const b = JSON.stringify(U.zuMappe(p), null, 1);
  if (ohne(a) !== ohne(b)) throw new Error('zweimal serialisiert ergibt verschiedene Texte');
})();

/* Die Objekt-Nr. gehört in den Kopf, nicht ins Fach `one` — SubTermin und
   SubKosten drucken sie auf ihre Blätter, ohne SubmitOne zu fragen. */
(function objektNummerImKopf() {
  const m = U.zuMappe({ id: 'p1', name: 'Umbau', nummer: '2510', bauherr: 'B', ort: 'O', projektleiter: 'PL', vergaben: [] });
  if (m.kopf.nummer !== '2510') throw new Error('Objekt-Nr. steht nicht im Kopf');
  if (m.module && m.module.one && m.module.one.nummer !== undefined) throw new Error('Objekt-Nr. liegt doppelt im Fach one');
  const p = U.ausMappe(m);
  if (p.nummer !== '2510') throw new Error('Objekt-Nr. kommt nicht zurück');
})();

const R = [];
function pruefe(name, ok, msg) { R.push({ name, ok: !!ok, msg: msg || '' }); }

/* Vergleich, der die Reihenfolge der Feldnamen ignoriert: Der Übersetzer
   baut die Objekte neu auf, dabei ändert sich die Reihenfolge zwangsläufig.
   Bei Listen zählt die Reihenfolge sehr wohl. */
function gleich(a, b, pfad) {
  pfad = pfad || '';
  if (a === b) return null;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return `${pfad || '(Wurzel)'}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${pfad}: Liste gegen Objekt`;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${pfad}: ${a.length} statt ${b.length} Einträge`;
    for (let i = 0; i < a.length; i++) {
      const f = gleich(a[i], b[i], `${pfad}[${i}]`);
      if (f) return f;
    }
    return null;
  }
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join('|') !== kb.join('|')) {
    const fehlt = ka.filter(k => kb.indexOf(k) < 0), zuviel = kb.filter(k => ka.indexOf(k) < 0);
    return `${pfad || '(Wurzel)'}: Felder unterschiedlich`
      + (fehlt.length ? ` — fehlt: ${fehlt.join(', ')}` : '')
      + (zuviel.length ? ` — zu viel: ${zuviel.join(', ')}` : '');
  }
  for (const k of ka) {
    const f = gleich(a[k], b[k], pfad ? `${pfad}.${k}` : k);
    if (f) return f;
  }
  return null;
}


/* =====================================================================
   Ein Projekt, das die wunden Punkte enthält
   ===================================================================== */

function beispielProjekt() {
  return {
    id: 'p_abc123',
    name: 'Umbau EFH Römerstrasse 31',
    ort: 'Bremgarten',
    bauherr: 'Cosima Bader & Ursula Bader',
    projektleiter: 'P. Hefti Bauberatung GmbH',
    phase: 'ausfuehrung',
    start: '2026-06-08', ende: '2026-12-14',
    baustart: '2026-06-08', bezug: '2026-12-14',

    vergaben: [
      {
        id: 'v_1', bkp: '271', gewerk: 'Gipserarbeiten', status: 'vergeben',
        firma: 'Muster Gips AG', betrag: 48500, schaetzung: 52000,
        frist: '2026-07-01', bauStart: '2026-08-03', bauEnde: '2026-09-12',
        eingeladene: [{ id: 'e_1', firma: 'Muster Gips AG', email: 'a@b.ch', betrag: 48500, status: 'offeriert', datumMail: '' }],
        nachtraege: [{ id: 'n_1', text: 'Zusatz Sturz', betrag: 1250 }],
        rapporte: [], vorgaenge: [], rechnungen: [], budgetposten: []
      },
      {
        // wunder Punkt: keine BKP-Nummer
        id: 'v_2', bkp: '', gewerk: 'Baureinigung', status: 'ausschreibung',
        firma: '', betrag: 0, schaetzung: 3000, frist: '', bauStart: '', bauEnde: '',
        eingeladene: [], nachtraege: [], rapporte: [], vorgaenge: [], rechnungen: [], budgetposten: []
      },
      {
        // wunder Punkt: dieselbe BKP wie ein anderes Gewerk
        id: 'v_3', bkp: '271', gewerk: 'Gipser Etappe 2', status: 'ausschreibung',
        firma: '', betrag: 0, schaetzung: 12000, frist: '', bauStart: '', bauEnde: '',
        eingeladene: [], nachtraege: [], rapporte: [], vorgaenge: [], rechnungen: [], budgetposten: []
      }
    ],

    // Pendenzen: gehören in den Stamm, weil SubmitOne UND SubZeit sie ändern
    pendenzen: [
      { id: 'pd_1', art: 'pendenz', text: 'Gipser: Ecke nacharbeiten', verantwortlich: 'Bauleitung', termin: '2026-09-30', erledigt: false, uebertragen: false, geplant: '2026-09-28' },
      { id: 'pd_2', art: 'pendenz', text: 'Muster anfordern', erledigt: true, uebertragen: false }
    ],

    // die Felder, die migrate() anlegt
    protokolle: [{ id: 'pr_1', traktanden: [{ id: 't_1', eintraege: [{ id: 'i_1', text: 'Ecke nacharbeiten', art: 'pendenz', erledigt: false, uebertragen: false }] }] }],
    entscheidungen: [{ id: 'd_1', thema: 'Küche', status: 'gewaehlt', bkp: '258' }],
    bezugsfirmen: [], geschosseListe: [], auflagen: [], mitglieder: [],
    bauteile: [], optionen: [],
    finanz: { land: 250000, honorare: 90000, finanzierung: 0 },
    termine: [{ id: 'tm_1', titel: 'Baustart', datum: '2026-08-03' }],

    // wunder Punkt: ein Feld, das der Übersetzer nicht kennt.
    // Kommt in app.js ein neues hinzu, darf es hier nicht verschwinden.
    irgendwasNeues: { tief: { verschachtelt: [1, 2, { drin: true }] } }
  };
}


/* =====================================================================
   Hin und zurück
   ===================================================================== */

const original = beispielProjekt();
const mappe = U.zuMappe(original);
const zurueck = U.ausMappe(mappe);

/* Ohne `erstellt` verglichen: Das Feld ist neu und soll neu sein — ein
   Projekt, das aus einer Datei kommt, kennt seither sein Anlagedatum.
   Dass es dazukommt, wird gleich darunter eigens geprüft. */
const ohneErstellt = o => { const k = JSON.parse(JSON.stringify(o)); delete k.erstellt; return k; };
pruefe('Hin und zurück verliert nichts',
  gleich(original, ohneErstellt(zurueck)) === null,
  gleich(original, ohneErstellt(zurueck)));

pruefe('Das Projekt lernt sein Erstelldatum aus der Datei',
  typeof zurueck.erstellt === 'string' && zurueck.erstellt === mappe.erstellt,
  'erstellt: ' + zurueck.erstellt + ' vs Mappe: ' + mappe.erstellt);

pruefe('Das Original wurde nicht verändert',
  gleich(original, beispielProjekt()) === null,
  'zuMappe() darf nicht in state hineinschreiben');


/* ---- Der Aufbau der Mappe ---- */

pruefe('Format und Fassung stehen in der Datei',
  mappe.format === 'submit.mappe' && mappe.fassung === 1);

pruefe('Kopf trägt Projekt, Bauherr, Ort, Bauleitung',
  mappe.kopf.projekt === 'Umbau EFH Römerstrasse 31'
  && mappe.kopf.bauherr === 'Cosima Bader & Ursula Bader'
  && mappe.kopf.ort === 'Bremgarten'
  && mappe.kopf.bauleitung === 'P. Hefti Bauberatung GmbH');

pruefe('Gewerke stehen oben, einmal je Vergabe', mappe.gewerke.length === 3);

pruefe('Gewerk trägt BKP und Namen',
  mappe.gewerke[0].bkp === '271' && mappe.gewerke[0].name === 'Gipserarbeiten');

/* ---- Die Termine gehören in den Stamm ----
   Baustart und Bauende brauchen SubmitOne (Gantt), SubKosten (Prognose)
   und SubTermin. Was nur SubTermin braucht, bliebe in module.termin. */

pruefe('Baustart und Bauende stehen am Gewerk',
  mappe.gewerke[0].start === '2026-08-03' && mappe.gewerke[0].ende === '2026-09-12');

pruefe('bauStart/bauEnde stehen NICHT mehr im Vergabefach',
  mappe.module.vergabe.vergaben.every(v => v.bauStart === undefined && v.bauEnde === undefined),
  'sonst gäbe es den Termin zweimal');

pruefe('Gewerk ohne Termine bleibt zulässig',
  mappe.gewerke[1].start === '' && mappe.gewerke[1].ende === '');

// Eine Vergabe, die die Felder gar nicht kennt, darf sie auch nicht zurückbekommen.
const ohneFelder = U.zuMappe({
  id: 'p_k', name: 'Knapp',
  vergaben: [{ id: 'v_k', bkp: '211', gewerk: 'Baumeister' }]
});
const zurueckKnapp = U.ausMappe(ohneFelder);
pruefe('Fehlende Felder entstehen nicht aus dem Nichts',
  !('bauStart' in zurueckKnapp.vergaben[0]) && !('bauEnde' in zurueckKnapp.vergaben[0]),
  JSON.stringify(zurueckKnapp.vergaben[0]));

pruefe('Gewerk ohne BKP bleibt zulässig',
  mappe.gewerke[1].bkp === '' && mappe.gewerke[1].name === 'Baureinigung');

pruefe('Zwei Gewerke mit gleicher BKP bleiben getrennt',
  mappe.gewerke[0].bkp === mappe.gewerke[2].bkp
  && mappe.gewerke[0].id !== mappe.gewerke[2].id);

pruefe('Jedes Gewerk hat eine Farbe',
  mappe.gewerke.every(g => /^#[0-9a-f]{6}$/i.test(g.farbe)));

pruefe('Die Gewerkkennung ist die Vergabekennung',
  mappe.gewerke.map(g => g.id).join(',') === 'v_1,v_2,v_3');

pruefe('Jede Vergabe zeigt per gewerkId auf ihr Gewerk',
  mappe.module.vergabe.vergaben.every((v, i) => v.gewerkId === mappe.gewerke[i].id));

pruefe('bkp und gewerk stehen NICHT mehr im Vergabefach',
  mappe.module.vergabe.vergaben.every(v => v.bkp === undefined && v.gewerk === undefined),
  'sonst gäbe es die Wahrheit zweimal');

pruefe('Die Vergabe behält ihre eigenen Daten',
  mappe.module.vergabe.vergaben[0].firma === 'Muster Gips AG'
  && mappe.module.vergabe.vergaben[0].nachtraege[0].betrag === 1250);

/* ---- Pendenzen gehören in den Stamm ----
   Zwei Programme ändern sie: SubmitOne erfasst und hakt ab, SubZeit plant
   sie auf Tage. Lägen sie in module.one, müsste SubZeit ins fremde Fach. */

pruefe('Pendenzen stehen im Stamm, nicht in einem Fach',
  Array.isArray(mappe.pendenzen) && mappe.pendenzen.length === 2
  && mappe.module.one.pendenzen === undefined,
  JSON.stringify(Object.keys(mappe)));

pruefe('Die Pendenz behält alle Angaben',
  mappe.pendenzen[0].text === 'Gipser: Ecke nacharbeiten'
  && mappe.pendenzen[0].verantwortlich === 'Bauleitung'
  && mappe.pendenzen[0].geplant === '2026-09-28');

pruefe('Protokoll-Pendenzen bleiben im Fach one',
  mappe.module.one.protokolle[0].traktanden[0].eintraege[0].art === 'pendenz',
  'sie gehören zu ihrer Sitzung');

// Ein Projekt ohne Pendenzen darf keine bekommen.
const ohnePend = U.ausMappe(U.zuMappe({ id: 'p_o', name: 'Ohne', vergaben: [] }));
pruefe('Projekt ohne Pendenzen bekommt keine',
  !('pendenzen' in ohnePend), JSON.stringify(Object.keys(ohnePend)));

pruefe('Der Rest des Projekts liegt im Fach one',
  mappe.module.one.phase === 'ausfuehrung'
  && mappe.module.one.protokolle.length === 1
  && mappe.module.one.finanz.land === 250000);

pruefe('Unbekannte Felder überleben die Reise',
  mappe.module.one.irgendwasNeues.tief.verschachtelt[2].drin === true);

pruefe('Kopf-Felder liegen nicht doppelt im Fach one',
  mappe.module.one.name === undefined && mappe.module.one.bauherr === undefined);

pruefe('Die Vergabenliste liegt nicht doppelt im Fach one',
  mappe.module.one.vergaben === undefined);


/* ---- Randfälle ---- */

const ohneVergaben = U.ausMappe(U.zuMappe({ id: 'p_x', name: 'Leer' }));
pruefe('Projekt ohne Vergaben ergibt eine leere Liste',
  Array.isArray(ohneVergaben.vergaben) && ohneVergaben.vergaben.length === 0);

const leereMappe = U.ausMappe({ format: 'submit.mappe', fassung: 1 });
pruefe('Mappe ohne Fächer wirft nicht, sondern gibt ein Projekt',
  leereMappe && Array.isArray(leereMappe.vergaben) && !!leereMappe.id);

let gefangen = '';
try { U.ausMappe({ format: 'submit.zeit', fassung: 1 }); } catch (e) { gefangen = e.message; }
pruefe('Fremdes Format wird abgewiesen', /submit\.zeit/.test(gefangen), gefangen);

gefangen = '';
try { U.ausMappe({ format: 'submit.mappe', fassung: 99 }); } catch (e) { gefangen = e.message; }
pruefe('Neuere Fassung wird abgewiesen', /neueren Fassung/.test(gefangen), gefangen);

gefangen = '';
try { U.ausMappe(null); } catch (e) { gefangen = e.message; }
pruefe('Leere Datei wird abgewiesen', /leer oder unlesbar/.test(gefangen), gefangen);

// Ein Gewerk fehlt in der Mappe (beschädigte Datei) – darf nicht abstürzen
const kaputt = U.zuMappe(beispielProjekt());
kaputt.gewerke.splice(1, 1);
const repariert = U.ausMappe(kaputt);
pruefe('Fehlendes Gewerk stürzt nicht ab, Vergabe bleibt erhalten',
  repariert.vergaben.length === 3
  && repariert.vergaben[1].bkp === '' && repariert.vergaben[1].gewerk === ''
  && repariert.vergaben[1].schaetzung === 3000);

/* Zweimal hin und her muss dasselbe ergeben. Zwei getrennte Läufe legen
   ihr Erstelldatum je selbst an, deshalb ohne dieses Feld verglichen. */
const zweimal = U.ausMappe(U.zuMappe(U.ausMappe(U.zuMappe(beispielProjekt()))));
pruefe('Mehrfaches Hin und Her bleibt stabil',
  gleich(ohneErstellt(zurueck), ohneErstellt(zweimal)) === null,
  gleich(ohneErstellt(zurueck), ohneErstellt(zweimal)));

/* Und das Erstelldatum selbst muss über beliebig viele Runden stehen
   bleiben — das war der Fehler: Es wurde bei jedem Speichern neu erfunden. */
const einmal = U.ausMappe(U.zuMappe(beispielProjekt()));
let gewandert = einmal;
for (let i = 0; i < 5; i++) gewandert = U.ausMappe(U.zuMappe(gewandert));
pruefe('Das Erstelldatum überlebt fünf weitere Runden',
  gewandert.erstellt === einmal.erstellt,
  'erst: ' + einmal.erstellt + '  nach fünf Runden: ' + gewandert.erstellt);


/* =====================================================================
   Ausgabe
   ===================================================================== */

let pass = 0, fail = 0;
console.log('\n=== SUBMIT · Übersetzer Projekt ⇄ Mappe ===');
for (const r of R) {
  console.log((r.ok ? 'OK   ' : 'FAIL ') + '| ' + r.name + (!r.ok && r.msg ? '  → ' + r.msg : ''));
  r.ok ? pass++ : fail++;
}
console.log('------------------------------------------');
console.log(pass + ' OK, ' + fail + ' Fehler\n');
process.exit(fail ? 2 : 0);
