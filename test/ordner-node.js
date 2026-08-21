// Prüft die Ordner-Ablage: Laden, Speichern, nur Geändertes schreiben, Konflikte erkennen.
// Aufruf:  node test/ordner-node.js     (Exit 0 = alles OK, 2 = Fehler)
//
// Die Dateizugriffe sind hier vorgetäuscht. Geprüft wird die Logik darüber —
// welche Datei wann geschrieben wird und wann eben nicht. Genau dort sitzen
// die Fehler, die stillen Datenverlust erzeugen.

const Ordner = require('../submit/kern/ordner.js');

const R = [];
function pruefe(name, ok, msg) { R.push({ name, ok: !!ok, msg: msg || '' }); }


/* =====================================================================
   Eine Platte im Arbeitsspeicher
   ===================================================================== */

function fakeAblage(anfang) {
  const dateien = new Map();       // "ordner/datei" -> { text, zeit }
  let uhr = 1000;

  function schluessel(o, d) { return (o === null ? '' : o + '/') + d; }

  Object.entries(anfang || {}).forEach(([k, text]) => {
    dateien.set(k, { text, zeit: ++uhr });
  });

  return {
    dateien,
    // von aussen ändern, ohne den Adapter zu fragen — simuliert eine
    // zweite Person, die dieselbe Datei anfasst
    fremdAendern(o, d, text) { dateien.set(schluessel(o, d), { text, zeit: ++uhr }); },

    async ordnerListe() {
      const namen = new Set();
      for (const k of dateien.keys()) {
        const teile = k.split('/');
        if (teile.length > 1) namen.add(teile[0]);
      }
      return [...namen].sort();
    },
    async dateiListe(o) {
      const raus = [];
      for (const k of dateien.keys()) {
        const teile = k.split('/');
        if (teile.length > 1 && teile[0] === o) raus.push(teile[1]);
      }
      return raus.sort();
    },
    async lesen(o, d) {
      const e = dateien.get(schluessel(o, d));
      return e ? { text: e.text, zeit: e.zeit } : null;
    },
    async schreiben(o, d, text) {
      const zeit = ++uhr;
      dateien.set(schluessel(o, d), { text, zeit });
      return zeit;
    }
  };
}

function projekt(id, name, vergaben) {
  return {
    id, name, ort: 'Bremgarten', bauherr: 'Bader', projektleiter: 'Hefti',
    phase: 'ausfuehrung', termine: [], protokolle: [], auflagen: [],
    vergaben: vergaben || [{ id: 'v_' + id, bkp: '271', gewerk: 'Gipser', firma: '', betrag: 0 }]
  };
}

function state(projekte, kontakte) {
  return { projekte: projekte || [], kontakte: kontakte || [], dokumente: [] };
}

async function lauf() {

  /* ---- Leerer Ordner ---- */

  {
    const a = fakeAblage({});
    const geladen = await Ordner.erstelle(a).load();
    pruefe('Leerer Ordner ergibt null (app.js geht seinen Erststart-Weg)', geladen === null);
  }

  /* ---- Anlegen und wieder laden ---- */

  {
    const a = fakeAblage({});
    const adapter = Ordner.erstelle(a);
    const s = state([projekt('p1', 'Sanierung Müller'), projekt('p2', 'Neubau Weber')], [{ id: 'k1', firma: 'Muster AG' }]);

    const bericht = await adapter.save(s);
    pruefe('Zwei Projekte und die Allgemein-Datei werden geschrieben',
      bericht.geschrieben.length === 3, JSON.stringify(bericht.geschrieben));

    pruefe('Je Projekt ein Ordner mit gleichnamiger Datei',
      a.dateien.has('Sanierung Müller/Sanierung Müller.submit')
      && a.dateien.has('Neubau Weber/Neubau Weber.submit'),
      [...a.dateien.keys()].join(' · '));

    pruefe('Die Allgemein-Datei liegt im Arbeitsordner', a.dateien.has('Allgemein.subone'));

    const zurueck = await Ordner.erstelle(a).load();
    pruefe('Geladen kommen beide Projekte zurück',
      zurueck.projekte.length === 2
      && zurueck.projekte.map(p => p.name).sort().join('|') === 'Neubau Weber|Sanierung Müller');

    pruefe('Die Vergabe überlebt mit BKP und Gewerk',
      zurueck.projekte[0].vergaben[0].bkp === '271'
      && zurueck.projekte[0].vergaben[0].gewerk === 'Gipser');

    pruefe('Kontakte kommen aus der Allgemein-Datei zurück',
      zurueck.kontakte.length === 1 && zurueck.kontakte[0].firma === 'Muster AG');
  }

  /* ---- Projektübergreifendes: Planung und Honorar gehören in eine Datei ----
     Sie lagen bis 13.08.2026 nur im Browser: nicht gesichert, nicht teilbar. */

  {
    const a = fakeAblage({});
    const s = state([projekt('p1', 'Sanierung Müller')]);
    s.planung = [{ id: 'pl_1', datum: '2026-08-17', zeit: '08:00', zeitEnde: '12:00', titel: 'Vormittag', color: '#7132e3' }];
    s.honorar = { pct: { vorprojekt: 9 }, summe: 78000 };
    s.planBausteine = [240, 120, 60];
    s.buero = { firma: 'Muster AG', mwst: 8.1, preiseInkl: true };

    await Ordner.erstelle(a).save(s);
    const zurueck = await Ordner.erstelle(a).load();

    pruefe('Arbeitsplanung überlebt Speichern und Laden',
      zurueck.planung && zurueck.planung.length === 1 && zurueck.planung[0].titel === 'Vormittag',
      JSON.stringify(zurueck.planung));

    pruefe('Honorareinstellungen überleben',
      zurueck.honorar && zurueck.honorar.summe === 78000);

    pruefe('Bausteindauern überleben',
      Array.isArray(zurueck.planBausteine) && zurueck.planBausteine[0] === 240);

    // Die Buero-Einstellungen tragen den MwSt-Satz und ob die Betraege netto
    // oder brutto gespeichert sind. Gehen sie verloren, rechnet die ganze
    // Kostenuebersicht falsch.
    pruefe('Büro-Einstellungen überleben (MwSt-Satz, netto/brutto)',
      zurueck.buero && zurueck.buero.mwst === 8.1 && zurueck.buero.preiseInkl === true,
      JSON.stringify(zurueck.buero));

    pruefe('Sie stehen in der Allgemein-Datei, nicht in der Projektdatei',
      a.dateien.get('Allgemein.subone').text.indexOf('Vormittag') > 0
      && a.dateien.get('Sanierung Müller/Sanierung Müller.submit').text.indexOf('Vormittag') < 0,
      'die Planung gehört der Person, nicht dem Bauvorhaben');
  }

  {
    // SubZeit legt sein Zeitdokument in dieselbe Allgemein-Datei: Stunden,
    // Absenzen und Ferien gehören der Person, nicht einem Bauvorhaben.
    const a = fakeAblage({});
    const s = state([projekt('p1', 'Sanierung Müller'), projekt('p2', 'Neubau Weber')]);
    s.zeit = {
      format: 'submit.zeit', fassung: 1,
      eintraege: [{ id: 'e_1', datum: '2026-08-17', von: 480, bis: 720, projektId: 'p1' }],
      absenzen: [{ id: 'a_1', von: '2026-09-01', bis: '2026-09-05' }],
      einstellungen: { stundensatz: 140 }
    };
    await Ordner.erstelle(a).save(s);
    const zurueck = await Ordner.erstelle(a).load();

    pruefe('SubZeits Zeitdokument überlebt Speichern und Laden',
      zurueck.zeit && zurueck.zeit.eintraege.length === 1
      && zurueck.zeit.eintraege[0].projektId === 'p1');

    pruefe('Der Zeiteintrag zeigt auf ein Projekt, das es gibt',
      zurueck.projekte.some(p => p.id === zurueck.zeit.eintraege[0].projektId));

    pruefe('Zeitdaten liegen in Allgemein.subone, nicht in der Projektdatei',
      a.dateien.get('Allgemein.subone').text.indexOf('submit.zeit') > 0
      && a.dateien.get('Sanierung Müller/Sanierung Müller.submit').text.indexOf('submit.zeit') < 0);
  }

  {
    // Nur Planung, keine Projekte: der Ordner ist trotzdem nicht leer.
    const a = fakeAblage({});
    const s = state([]);
    s.planung = [{ id: 'pl_1', datum: '2026-08-17', titel: 'Sitzung' }];
    await Ordner.erstelle(a).save(s);
    const zurueck = await Ordner.erstelle(a).load();
    pruefe('Ordner mit nur Planung gilt nicht als leer',
      zurueck !== null && zurueck.planung.length === 1);
  }

  /* ---- Nur Geändertes schreiben ---- */

  {
    const a = fakeAblage({});
    const adapter = Ordner.erstelle(a);
    const s = state([projekt('p1', 'Sanierung Müller'), projekt('p2', 'Neubau Weber')]);

    await adapter.save(s);
    const zweiter = await adapter.save(s);

    pruefe('Zweites Speichern ohne Änderung schreibt nichts',
      zweiter.geschrieben.length === 0 && zweiter.uebersprungen.length === 3,
      'geschrieben: ' + JSON.stringify(zweiter.geschrieben));

    s.projekte[0].phase = 'abschluss';
    const dritter = await adapter.save(s);

    pruefe('Nach einer Änderung wird genau ein Projekt geschrieben',
      dritter.geschrieben.length === 1 && dritter.geschrieben[0] === 'p1',
      JSON.stringify(dritter.geschrieben));

    pruefe('Das unveränderte Projekt wird übersprungen',
      dritter.uebersprungen.indexOf('p2') >= 0);
  }

  /* ---- Konflikt: jemand anders hat die Datei angefasst ---- */

  {
    const a = fakeAblage({});
    const gemeldet = [];
    const adapter = Ordner.erstelle(a, { beiKonflikt: k => gemeldet.push(...k) });
    const s = state([projekt('p1', 'Sanierung Müller')]);

    await adapter.save(s);
    const vorher = a.dateien.get('Sanierung Müller/Sanierung Müller.submit').text;

    // Zweite Person schreibt dieselbe Datei
    a.fremdAendern('Sanierung Müller', 'Sanierung Müller.submit', '{"format":"submit.mappe","fassung":1,"fremd":true}');

    s.projekte[0].phase = 'abschluss';
    const bericht = await adapter.save(s);

    pruefe('Fremde Änderung wird erkannt', bericht.konflikte.length === 1);
    pruefe('Die fremde Fassung wird NICHT überschrieben',
      a.dateien.get('Sanierung Müller/Sanierung Müller.submit').text.indexOf('"fremd":true') >= 0);
    pruefe('Der Konflikt wird gemeldet, mit beiden Fassungen',
      gemeldet.length === 1 && !!gemeldet[0].fremderText && !!gemeldet[0].eigenerText
      && gemeldet[0].name === 'Sanierung Müller');
    pruefe('Es wurde nichts still verloren', vorher !== null);
  }

  /* ---- Eine kaputte Datei reisst die anderen nicht mit ---- */

  {
    const a = fakeAblage({});
    await Ordner.erstelle(a).save(state([projekt('p1', 'Gut A'), projekt('p2', 'Gut B')]));
    a.fremdAendern('Kaputt', 'Kaputt.submit', '{ das ist kein JSON');

    const fehler = [];
    const geladen = await Ordner.erstelle(a, { beiFehler: f => fehler.push(...f) }).load();

    pruefe('Die zwei heilen Projekte kommen trotzdem', geladen.projekte.length === 2);
    pruefe('Die kaputte Datei wird gemeldet', fehler.length === 1 && fehler[0].ordner === 'Kaputt');
  }

  /* ---- Ordnernamen ---- */

  {
    const a = fakeAblage({});
    await Ordner.erstelle(a).save(state([projekt('p1', 'Umbau: EFH / Nr. 31?')]));
    const gefunden = [...a.dateien.keys()].find(k => k.indexOf('.submit') > 0);
    pruefe('Unzulässige Zeichen im Projektnamen werden ersetzt',
      gefunden && !/[\\/:*?"<>|]/.test(gefunden.split('/')[0]), gefunden);
  }

  {
    const a = fakeAblage({});
    await Ordner.erstelle(a).save(state([projekt('p1', '   ')]));
    pruefe('Projekt ohne Namen bekommt trotzdem einen Ordner',
      a.dateien.has('Projekt/Projekt.submit'), [...a.dateien.keys()].join(' · '));
  }

  /* ---- Andersnamige .submit-Datei im Ordner wird gefunden ---- */

  {
    const a = fakeAblage({});
    await Ordner.erstelle(a).save(state([projekt('p1', 'Sanierung Müller')]));
    const text = a.dateien.get('Sanierung Müller/Sanierung Müller.submit').text;
    a.dateien.delete('Sanierung Müller/Sanierung Müller.submit');
    a.fremdAendern('Sanierung Müller', 'Alter Name.submit', text);

    const geladen = await Ordner.erstelle(a).load();
    pruefe('Auch eine anders benannte .submit-Datei wird gefunden',
      geladen && geladen.projekte.length === 1 && geladen.projekte[0].name === 'Sanierung Müller');
  }

  /* ---- Umbenennen legt keinen zweiten Ordner an ---- */

  {
    const a = fakeAblage({});
    const adapter = Ordner.erstelle(a);
    const s = state([projekt('p1', 'Sanierung Müller')]);
    await adapter.save(s);

    s.projekte[0].name = 'Sanierung Müller (Etappe 2)';
    await adapter.save(s);

    const submits = [...a.dateien.keys()].filter(k => k.endsWith('.submit'));
    pruefe('Umbenennen schreibt in dieselbe Datei, statt eine zweite anzulegen',
      submits.length === 1, submits.join(' · '));
  }

  /* ---- Ausgabe ---- */

  let pass = 0, fail = 0;
  console.log('\n=== SUBMIT · Ordner-Ablage ===');
  for (const r of R) {
    console.log((r.ok ? 'OK   ' : 'FAIL ') + '| ' + r.name + (!r.ok && r.msg ? '  → ' + r.msg : ''));
    r.ok ? pass++ : fail++;
  }
  console.log('------------------------------------------');
  console.log(pass + ' OK, ' + fail + ' Fehler\n');
  process.exit(fail ? 2 : 0);
}

lauf().catch(e => { console.log('ABSTURZ:\n', (e && e.stack) || e); process.exit(1); });
