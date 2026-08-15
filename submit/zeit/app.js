/* =====================================================================
   SubZeit — die Oberfläche
   ---------------------------------------------------------------------
   Hält den Zustand der Ansicht (welcher Tag, wie viele Spalten), baut die
   Seiten und verbindet sie mit der Fachlogik. Fachliches gehört nach
   fach.js, die Zieh-Mechanik nach bahn.js — hier steht nur, was man sieht.
   ===================================================================== */

'use strict';

const App = (function () {

    const zustand = {
        seite: 'zeit',
        datum: Hilf.heute(),
        spanne: 5,                     // 1 · 3 · 5 · 7 Tage nebeneinander
        projekt: null,                 // vorgewähltes Projekt für neue Blöcke
        navMonat: null                 // Monat, den der Kalender links zeigt
    };

    let uhrLaeuft = null;

    /* Läuft SubZeit in einer Projektmappe, liegt sie hier. Dann ist das
       Dokument ein Teil der Mappe, und gespeichert wird die Mappe. */
    let mappe = null;

    /* =================================================================
       Gerüst
       ================================================================= */

    /**
     * Start innerhalb einer Projektmappe. Das Zeitdokument steckt darin;
     * die Gewerke und der Projektkopf kommen von dort.
     */
    function inMappe(geladene) {
        mappe = geladene;

        const dok = mappe.module.zeit
            ? Ablage.pruefe(mappe.module.zeit)
            : Ablage.leer('');

        dok.projekte = gewerkeSpiegeln(dok);

        Ablage.name = mappe.kopf.projekt || 'Projekt';
        Daten.setze(dok, true);

        // Jede Änderung wandert zurück in die Mappe, damit sie beim
        // Speichern mitgeht.
        Daten.horche(was => {
            if (was === 'geaendert' && mappe) {
                const kopie = Daten.kopie(Daten.doc);
                // Die Gewerke gehören der Mappe, nicht dem Modul.
                delete kopie.projekte;
                mappe.module.zeit = kopie;
            }
        });

        start();
    }

    /**
     * Die Gewerke der Mappe als Projekte von SubZeit.
     *
     * Es sind keine Kopien: Die Kennung bleibt dieselbe, deshalb weiss auch
     * SubKosten später, welche Stunden zu welcher Kostenzeile gehören.
     *
     * Die Gewerke gehören dem STAMM der Mappe, nicht dem Zeit-Fach. Deshalb
     * wird diese Liste bei jeder Änderung neu aufgebaut und beim Speichern
     * wieder entfernt (`delete kopie.projekte`) — sonst stünde dasselbe
     * Gewerk zweimal in der Datei.
     */
    function gewerkeSpiegeln(dok) {
        const d = dok || Daten.doc;
        return (mappe && mappe.gewerke ? mappe.gewerke : []).map(g => ({
            id: g.id,
            name: g.bkp ? `${g.bkp} ${g.name}` : g.name,
            nummer: g.bkp,
            farbe: g.farbe,
            kundeId: null,
            satz: (d && d.einstellungen) ? d.einstellungen.stundensatz : null,
            ausMappe: true,
            aktiv: true
        }));
    }

    /* =================================================================
       Arbeitsordner — dieselben Bauvorhaben wie SubmitOne
       -----------------------------------------------------------------
       SubZeit ist projektÜBERGREIFEND: Die Stunden einer Woche laufen über
       mehrere Baustellen, Ferien und Absenzen gehören der Person. Deshalb
       öffnet SubZeit nicht eine einzelne Mappe, sondern denselben
       Arbeitsordner wie SubmitOne.

         <Ordner>\<Bauvorhaben>\<Bauvorhaben>.submit    die Projekte
         <Ordner>\Allgemein.subone                      Zeitdokument,
                                                        Adressbuch, Planung

       Die Projektliste gehört dem Ordner, nicht dem Zeitdokument — sie
       wird beim Laden gespiegelt und beim Speichern wieder entfernt,
       genau wie die Gewerke in der Mappe.
       ================================================================= */

    let ordner = null;        // der Ordner-Adapter
    let ordnerStand = null;   // was zuletzt aus dem Ordner kam

    function ordnerMoeglich() {
        return !!(window.AblageBrowser && window.Ordner && window.Uebersetzer && AblageBrowser.kann());
    }

    /** Die Bauvorhaben des Ordners als Projekte von SubZeit. */
    function projekteSpiegeln(dok) {
        const d = dok || Daten.doc;
        return ((ordnerStand && ordnerStand.projekte) || []).map(p => ({
            id: p.id,                       // dieselbe Kennung wie in SubmitOne
            name: p.name || 'Projekt',
            nummer: p.nummer || '',
            /* Die Farbe hängt an der Kennung, nicht an der Listenposition.
               Vorher war es `FARBEN[i % …]`: Ein neues Bauvorhaben schob
               sich dazwischen, und sämtliche Farben verrutschten — der
               Wochenplan sah am Montag anders aus als am Freitag. */
            farbe: p.farbe || Fach.farbeAusId(p.id),
            kundeId: null,
            satz: (d && d.einstellungen) ? d.einstellungen.stundensatz : null,
            ausOrdner: true,
            aktiv: p.phase !== 'abschluss'
        }));
    }

    /** Fragt nach dem Arbeitsordner und übernimmt, was darin liegt. */
    async function imOrdner(stillerVersuch) {
        if (!ordnerMoeglich()) {
            if (!stillerVersuch) Ui.meldung('Einen Ordner öffnen können nur Chrome und Edge am Rechner.', 'warnung');
            return false;
        }

        let gefunden = null;
        try {
            gefunden = stillerVersuch
                ? await AblageBrowser.letzter(false)      // beim Start nicht nachfragen
                : await AblageBrowser.waehlen();
        } catch (f) {
            if (!stillerVersuch && f.name !== 'AbortError') Ui.meldung(f.message, 'warnung');
            return false;
        }
        if (!gefunden) return false;

        const adapter = Ordner.erstelle(gefunden.ablage, {
            beiFehler: fs => fs.forEach(x => Ui.meldung(`«${x.ordner}» ist unlesbar: ${x.grund}`, 'warnung')),
            beiKonflikt: ks => ks.forEach(x => Ui.meldung(`«${x.name}» wurde inzwischen geändert – nicht überschrieben.`, 'warnung'))
        });

        let stand;
        try { stand = await adapter.load(); }
        catch (f) { if (!stillerVersuch) Ui.meldung('Der Ordner liess sich nicht lesen: ' + f.message, 'warnung'); return false; }

        ordner = adapter;
        ordnerStand = stand || { projekte: [] };
        mappe = null;                                     // die beiden schliessen sich aus

        const dok = ordnerStand.zeit ? Ablage.pruefe(ordnerStand.zeit) : Ablage.leer('');
        dok.projekte = projekteSpiegeln(dok);

        Ablage.name = gefunden.name || 'Arbeitsordner';
        Daten.setze(dok, true);

        Daten.horche(was => {
            if (was === 'geaendert' && ordner) {
                const kopie = Daten.kopie(Daten.doc);
                delete kopie.projekte;                    // gehören dem Ordner
                ordnerStand.zeit = kopie;
            }
        });

        await AblageBrowser.merken(gefunden.griff);
        if (!stillerVersuch) {
            Ui.meldung(`${(ordnerStand.projekte || []).length} Bauvorhaben aus «${Ablage.name}» geladen`, 'gut');
        }
        start();
        return true;
    }

    async function ordnerSpeichern() {
        if (!ordner) return false;
        const kopie = Daten.kopie(Daten.doc);
        delete kopie.projekte;
        ordnerStand.zeit = kopie;

        await ordner.save(ordnerStand);
        Daten.gespeichert();
        return true;
    }

    async function mappeSpeichern() {
        if (!mappe) return false;

        const kopie = Daten.kopie(Daten.doc);
        delete kopie.projekte;
        mappe.module.zeit = kopie;

        await Mappe.speichern(mappe);
        Daten.gespeichert();
        return true;
    }

    function start() {
        zeichne();

        Daten.horche(was => {
            if (was === 'geladen') { Fach.vergissFeiertage(); zustand.datum = Hilf.heute(); }
            zeichne();
        });

        tasten();
        uhr();
        setInterval(uhr, 30000);

        window.addEventListener('beforeunload', e => {
            if (!Daten.istGeaendert) return;
            e.preventDefault();
            e.returnValue = '';
        });
    }

    function zeichne() {
        const wurzel = document.getElementById('app');
        Ui.leere(wurzel);

        if (!Daten.doc) { wurzel.appendChild(einstieg()); return; }

        wurzel.appendChild(kopfleiste());
        wurzel.appendChild(Ui.el('div.rumpf', {},
            seitenleiste(),
            Ui.el('main.inhalt', {}, seiteBauen())));
    }

    /* ---- Einstieg: was tun, wenn noch nichts offen ist ---- */

    function einstieg() {
        const entwurf = Ablage.nebenbeiVorhanden();

        return Ui.el('div.einstieg', {},
            Ui.el('div.einstieg-karte', {},
                Ui.el('img.einstieg-marke', { src: '../ui/marke.svg', alt: '', width: 64, height: 64 }),
                Ui.el('h1', {}, 'SubZeit'),
                Ui.el('p.einstieg-satz', {},
                    'Zeit wird gezogen, nicht getippt. Ihre Daten bleiben in Ihrer Datei — ',
                    'auf Ihrem Rechner oder in Ihrem OneDrive.'),

                entwurf ? Ui.el('button.knopf.knopf-haupt', {
                    onclick: () => {
                        Daten.setze(Ablage.pruefe(entwurf.doc), false);
                        Ablage.name = entwurf.name || 'Meine Zeit';
                        Ui.meldung('Zwischenstand wiederhergestellt', 'gut');
                    }
                }, `Weiterarbeiten (${Hilf.datum(entwurf.zeit.slice(0, 10))})`) : null,

                Ui.el('div.einstieg-knoepfe', {},
                    // Der übliche Weg: derselbe Arbeitsordner wie SubmitOne,
                    // damit dieselben Bauvorhaben erscheinen.
                    ordnerMoeglich() ? Ui.el('button.knopf.knopf-haupt', {
                        onclick: () => imOrdner(false)
                    }, 'Arbeitsordner öffnen') : null,
                    Ui.el('button.knopf' + (entwurf || ordnerMoeglich() ? '' : '.knopf-haupt'), {
                        onclick: async () => {
                            await Ablage.neu('');
                            Ui.meldung('Neu angefangen. Nicht vergessen zu speichern.', 'info');
                        }
                    }, 'Neu anfangen'),
                    Ui.el('button.knopf.knopf-still', {
                        onclick: async () => {
                            try { await Ablage.oeffnen(); }
                            catch (f) { if (f.name !== 'AbortError') Ui.meldung(f.message, 'warnung'); }
                        }
                    }, 'Datei öffnen')),

                Ablage.kannDatei
                    ? Ui.el('p.einstieg-klein', {}, 'Ihre Datei wird direkt beschrieben — wie bei Word oder Excel.')
                    : Ui.el('p.einstieg-klein', {},
                        'Dieser Browser kann Dateien nicht direkt beschreiben. ',
                        'Speichern legt eine Kopie im Download-Ordner ab. ',
                        'Mit Chrome oder Edge geht es unmittelbar.')));
    }

    /* ---- Kopfleiste ---- */

    function kopfleiste() {
        const laeuft = Fach.laufender();

        return Ui.el('header.kopfleiste', {},
            Ui.el('div.marke', {},
                Ui.el('img', { src: '../ui/marke.svg', alt: '', width: 26, height: 26 }),
                Ui.el('span', {}, 'SubZeit')),

            mappe ? Ui.el('a.knopf.knopf-still', { href: '../' }, '← Mappe') : null,

            Ui.el('div.datei', {},
                Ui.el('span.datei-name', {}, Ablage.name),
                mappe ? Ui.el('span.datei-mappe', {}, 'in der Mappe') : null,
                Daten.istGeaendert ? Ui.el('span.datei-punkt', { title: 'Nicht gespeichert' }) : null),

            Ui.el('div.abstand'),

            laeuft ? Ui.el('button.knopf.knopf-uhr', {
                onclick: () => { Fach.stoppe(); Ui.meldung('Stempeluhr gestoppt', 'gut'); zeichne(); }
            }, Ui.el('span.uhr-punkt'), 'Läuft seit ' + Hilf.uhrzeit(laeuft.von), ' — stoppen') : null,

            Ui.el('button.knopf.knopf-still', {
                onclick: zurueck, disabled: !Daten.kannZurueck,
                title: Daten.naechstesZurueck ? 'Rückgängig: ' + Daten.naechstesZurueck : 'Rückgängig'
            }, '↶'),
            Ui.el('button.knopf.knopf-still', {
                onclick: wiederholen, disabled: !Daten.kannVor, title: 'Wiederholen'
            }, '↷'),

            Ui.el('button.knopf.knopf-haupt', { onclick: speichern }, 'Speichern'),
            Ui.el('button.knopf.knopf-still', { onclick: dateiMenue, title: 'Datei' }, '···'));
    }

    /**
     * Die Stufe blendet ein und aus. Wer allein lernt, sieht keine Rechnungen
     * und keine Freigaben — es gibt sie in dieser Ansicht schlicht nicht.
     */
    function stufe() { return (Daten.doc.einstellungen.stufe) || 'selbstaendig'; }

    function seitenleiste() {
        const s = stufe();

        /* Vierter Wert: der Kurzname für die untere Leiste auf dem Handy.
           Fünfter: ob die Seite dort einen festen Platz bekommt.

           Auf 390px passen vier Plätze plus «Mehr». «Zeiterfassung» hat
           dreizehn Zeichen — in einer 78px breiten Spalte wird daraus ein
           Umbruch oder ein abgeschnittenes Wort. Deshalb ein eigener,
           kurzer Name statt einer abgeschnittenen Langfassung. */
        const seiten = [
            ['zeit', 'Zeiterfassung', true, 'Zeit', true],
            ['woche', 'Wochenplanung', true, 'Woche', true],
            ['projekte', s === 'schule' ? 'Fächer & Projekte' : 'Projekte & Kunden', true, 'Projekte', true],
            ['rapport', 'Rapport', true, 'Rapport', true],
            ['absenzen', 'Absenzen & Ferien', s !== 'schule', 'Absenzen', false],
            ['rechnungen', 'Rechnungen', s !== 'schule', 'Rechnung', false],
            ['freigaben', 'Freigaben', s === 'firma', 'Freigaben', false],
            ['auswertung', 'Auswertung', true, 'Auswertung', false],
            ['einstellungen', 'Einstellungen', true, 'Einstell.', false]
        ];

        const offen = Fach.eingereichte().length;

        const sichtbar = seiten.filter(([, , zeigen]) => zeigen);
        const geh = schluessel => { zustand.seite = schluessel; zeichne(); };

        const knopf = ([schluessel, name, , kurz, fest]) =>
            Ui.el('button.nav' + (zustand.seite === schluessel ? '.aktiv' : '') + (fest ? '.fest' : ''), {
                onclick: () => geh(schluessel)
            },
                Ui.el('span.nav-lang', {}, name),
                Ui.el('span.nav-kurz', {}, kurz),
                schluessel === 'freigaben' && offen
                    ? Ui.el('span.nav-zahl', {}, String(offen)) : null);

        /* «Mehr» erscheint nur in der unteren Leiste (CSS). Ohne diesen
           Knopf wären auf dem Handy vier von acht Seiten unerreichbar —
           derselbe Fehler, den SubmitOne dort hatte. Das Blatt liest die
           Liste aus derselben Aufstellung, damit sie nicht auseinanderläuft. */
        const mehr = Ui.el('button.nav.nav-mehr', {
            onclick: () => {
                const f = Ui.fenster({
                    titel: 'Bereiche',
                    inhalt: Ui.el('div.navblatt', {},
                        sichtbar.map(([schluessel, name]) =>
                            Ui.el('button.navblatt-punkt' + (zustand.seite === schluessel ? '.aktiv' : ''), {
                                onclick: () => { f.schliesse(); geh(schluessel); }
                            }, name))),
                    knoepfe: [Ui.el('span.abstand'),
                              Ui.el('button.knopf.knopf-still', { onclick: () => f.schliesse() }, 'Schliessen')]
                });
            }
        }, Ui.el('span.nav-kurz', {}, '⋯ Mehr'));

        return Ui.el('nav.seitenleiste', {},
            sichtbar.map(knopf),
            mehr,
            Ui.el('div.abstand'),
            Ui.el('div.stufe-marke', {},
                { schule: 'Schule', selbstaendig: 'Selbständig', firma: 'Firma' }[s]));
    }

    function seiteBauen() {
        switch (zustand.seite) {
            case 'woche':         return seiteWoche();
            case 'projekte':      return seiteProjekte();
            case 'rapport':       return seiteRapport();
            case 'absenzen':      return seiteAbsenzen();
            case 'rechnungen':    return seiteRechnungen();
            case 'freigaben':     return seiteFreigaben();
            case 'auswertung':    return seiteAuswertung();
            case 'einstellungen': return seiteEinstellungen();
            default:              return seiteZeit();
        }
    }

    /* =================================================================
       Rechnungen
       ================================================================= */

    const ZUSTAENDE = {
        nichts:      ['', 'nichts erfasst'],
        intern:      ['intern', 'nicht verrechenbar'],
        offen:       ['offen', 'erfasst, nicht verrechnet'],
        entwurf:     ['entwurf', 'Rechnung im Entwurf'],
        gestellt:    ['gestellt', 'Rechnung gestellt'],
        ueberfaellig:['ueberfaellig', 'überfällig'],
        bezahlt:     ['bezahlt', 'bezahlt']
    };

    function seiteRechnungen() {
        const raster = Fach.fakturaraster(12);
        const rechnungen = (Daten.doc.rechnungen || [])
            .slice().sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));

        return Ui.el('div.seite', {},
            seitenkopf('Rechnungen', `${rechnungen.length} Rechnungen`, [
                Ui.el('button.knopf.knopf-haupt', { onclick: rechnungErstellen }, 'Rechnung erstellen')
            ]),

            // Das Monatsraster zuerst: sehen, nicht lesen.
            Ui.el('div.karte', {},
                Ui.el('div.karte-kopf', {},
                    Ui.el('h3', {}, 'Ein Blick über zwölf Monate'),
                    Ui.el('span.abstand'),
                    Ui.el('div.faktura-legende', {},
                        ['offen', 'entwurf', 'gestellt', 'ueberfaellig', 'bezahlt'].map(z =>
                            Ui.el('span', {}, Ui.el('i.faktura-punkt.' + z), ZUSTAENDE[z][1])))),

                raster.zeilen.length
                    ? Ui.el('div.faktura', {},
                        Ui.el('div.faktura-zeile.faktura-kopf', {},
                            Ui.el('span.faktura-name', {}, 'Projekt'),
                            raster.spalten.map(m => Ui.el('span.faktura-monat', {},
                                Hilf.monatName(Number(m.slice(5, 7)) - 1).slice(0, 3)))),

                        raster.zeilen.map(zeile => Ui.el('div.faktura-zeile', {},
                            Ui.el('span.faktura-name', {},
                                Ui.el('i.punkt', { stil: { background: zeile.projekt.farbe } }),
                                zeile.projekt.name),

                            zeile.felder.map(feld => Ui.el('button.faktura-feld.' + (ZUSTAENDE[feld.zustand][0] || 'nichts'), {
                                title: `${zeile.projekt.name} · ${Hilf.datum(feld.monat + '-01').slice(3)}`
                                    + `\n${ZUSTAENDE[feld.zustand][1]}`
                                    + (feld.minuten ? `\n${Hilf.dauer(feld.minuten)} erfasst` : ''),
                                onclick: () => {
                                    if (feld.rechnung) rechnungAnsehen(feld.rechnung.id);
                                    else if (feld.zustand === 'offen') rechnungErstellen(zeile.projekt.kundeId, feld.monat);
                                }
                            })))))
                    : Ui.el('div.karte-leib', {}, Ui.el('p.leise', {}, 'Noch keine Projekte.'))),

            rechnungen.length
                ? Ui.el('div.karte', {},
                    Ui.el('table.tabelle', {},
                        Ui.el('thead', {}, Ui.el('tr', {},
                            Ui.el('th', {}, 'Nummer'), Ui.el('th', {}, 'Kunde'),
                            Ui.el('th', {}, 'Zeitraum'), Ui.el('th', {}, 'Stand'),
                            Ui.el('th.zahl', {}, 'Betrag'), Ui.el('th', {}, ''))),
                        Ui.el('tbody', {}, rechnungen.map(r => {
                            const summe = Fach.rechnungSumme(r);
                            const ueberfaellig = r.status === 'gestellt' && r.faellig < Hilf.heute();

                            return Ui.el('tr', {},
                                Ui.el('td', {}, Ui.el('strong', {}, r.nummer)),
                                Ui.el('td', {}, (Fach.kunde(r.kundeId) || {}).name || '—'),
                                Ui.el('td', {}, Hilf.spanne(r.von, r.bis)),
                                Ui.el('td', {}, Ui.el('span.stand.' + (ueberfaellig ? 'ueberfaellig' : r.status), {},
                                    ueberfaellig ? 'überfällig' : r.status)),
                                Ui.el('td.zahl', {}, Hilf.geld(summe.brutto)),
                                Ui.el('td.zahl', {},
                                    Ui.el('button.knopf.knopf-winzig', {
                                        onclick: () => rechnungAnsehen(r.id)
                                    }, 'Ansehen')));
                        }))))
                : null);
    }

    function rechnungErstellen(kundeId, monat) {
        const kunden = Daten.doc.kunden || [];
        if (!kunden.length) {
            Ui.meldung('Zuerst einen Kunden anlegen — unter «Projekte & Kunden».', 'warnung');
            return;
        }

        let gewaehlt = kundeId || kunden[0].id;
        const heute = Hilf.heute();
        const vonWert = monat ? monat + '-01' : heute.slice(0, 8) + '01';
        const bisWert = monat
            ? Hilf.plusTage(Hilf.alsText(new Date(Number(monat.slice(0, 4)), Number(monat.slice(5, 7)), 1)), -1)
            : heute;

        const vonFeld = Ui.el('input.eingabe', { type: 'date', value: vonWert });
        const bisFeld = Ui.el('input.eingabe', { type: 'date', value: bisWert });
        const vorschau = Ui.el('div.vorschau');

        function aktualisiere() {
            const eintraege = Fach.offeneStunden(gewaehlt, vonFeld.value, bisFeld.value);
            const minuten = eintraege.reduce((s, e) => s + Fach.dauerVon(e), 0);

            Ui.leere(vorschau);
            vorschau.append(
                Ui.el('div.vorschau-gross', {}, Hilf.dauer(minuten)),
                Ui.el('div.leise.klein', {},
                    `${eintraege.length} Einträge · rund `
                    + Hilf.geld(Hilf.stunden(minuten) * (Daten.doc.einstellungen.stundensatz || 0))));
        }

        const f = Ui.fenster({
            titel: 'Rechnung erstellen',
            unterzeile: 'Aus den erfassten, noch nicht verrechneten Stunden.',
            inhalt: Ui.el('div', {},
                Ui.feld('Kunde', Ui.auswahl(kunden, gewaehlt, w => { gewaehlt = w; aktualisiere(); })),
                Ui.el('div.form-zwei', {}, Ui.feld('Von', vonFeld), Ui.feld('Bis', bisFeld)),
                vorschau),
            knoepfe: [
                Ui.el('span.abstand'),
                Ui.el('button.knopf.knopf-still', { onclick: () => f.schliesse() }, 'Abbrechen'),
                Ui.el('button.knopf.knopf-haupt', {
                    onclick: () => {
                        const ergebnis = Fach.rechnungAus(gewaehlt, vonFeld.value, bisFeld.value);
                        if (ergebnis.fehler) { Ui.meldung(ergebnis.fehler, 'warnung'); return; }
                        f.schliesse();
                        zeichne();
                        rechnungAnsehen(ergebnis.rechnung.id);
                    }
                }, 'Erstellen')
            ]
        });

        vonFeld.addEventListener('change', aktualisiere);
        bisFeld.addEventListener('change', aktualisiere);
        aktualisiere();
    }

    function rechnungAnsehen(id) {
        const r = (Daten.doc.rechnungen || []).find(x => x.id === id);
        if (!r) return;

        const summe = Fach.rechnungSumme(r);
        const kunde = Fach.kunde(r.kundeId);

        const f = Ui.fenster({
            breit: true,
            titel: 'Rechnung ' + r.nummer,
            unterzeile: `${kunde ? kunde.name : 'Ohne Kunde'} · ${Hilf.spanne(r.von, r.bis)}`,
            inhalt: Ui.el('div.rechnung', {},
                Ui.el('table.tabelle', {},
                    Ui.el('thead', {}, Ui.el('tr', {},
                        Ui.el('th', {}, 'Leistung'), Ui.el('th.zahl', {}, 'Menge'),
                        Ui.el('th.zahl', {}, 'Ansatz'), Ui.el('th.zahl', {}, 'Betrag'))),
                    Ui.el('tbody', {}, (r.positionen || []).map(p => Ui.el('tr', {},
                        Ui.el('td', {}, p.beschreibung),
                        Ui.el('td.zahl', {}, Hilf.zahl(p.menge, 2) + ' ' + p.einheit),
                        Ui.el('td.zahl', {}, Hilf.geld(p.preis)),
                        Ui.el('td.zahl', {}, Hilf.geld(p.menge * p.preis)))))),

                Ui.el('div.rechnung-summe', {},
                    Ui.el('div.zeile', {}, Ui.el('span', {}, 'Netto'), Ui.el('span.abstand'),
                        Ui.el('span.zahl', {}, Hilf.geld(summe.netto))),
                    Ui.el('div.zeile', {}, Ui.el('span', {}, `MWST ${r.mwstSatz} %`), Ui.el('span.abstand'),
                        Ui.el('span.zahl', {}, Hilf.geld(summe.mwst))),
                    Ui.el('div.zeile.gross', {}, Ui.el('strong', {}, 'Total'), Ui.el('span.abstand'),
                        Ui.el('strong.zahl', {}, Hilf.geld(summe.brutto)))),

                Ui.el('p.leise.klein', {},
                    `Fällig am ${Hilf.datum(r.faellig)}. `,
                    r.gestelltAm ? `Gestellt am ${Hilf.datum(r.gestelltAm)}. ` : '',
                    r.bezahltAm ? `Bezahlt am ${Hilf.datum(r.bezahltAm)}.` : '')),

            knoepfe: [
                Ui.el('button.knopf.knopf-gefahr-still', {
                    onclick: async () => {
                        if (!await Ui.frage('Rechnung löschen? Die Stunden werden wieder frei.')) return;
                        Fach.rechnungLoeschen(r.id); f.schliesse(); zeichne();
                    }
                }, 'Löschen'),
                Ui.el('span.abstand'),
                Ui.el('button.knopf.knopf-still', { onclick: () => window.print() }, 'Drucken'),

                r.status === 'entwurf' ? Ui.el('button.knopf.knopf-haupt', {
                    onclick: () => { Fach.rechnungStatus(r.id, 'gestellt'); f.schliesse(); zeichne(); }
                }, 'Als gestellt markieren') : null,

                r.status === 'gestellt' ? Ui.el('button.knopf.knopf-haupt', {
                    onclick: () => { Fach.rechnungStatus(r.id, 'bezahlt'); f.schliesse(); zeichne(); }
                }, 'Als bezahlt markieren') : null
            ]
        });
    }

    /* =================================================================
       Freigaben
       ================================================================= */

    function seiteFreigaben() {
        const offen = Fach.eingereichte();
        const gewaehlt = new Set();

        const tabelle = Ui.el('tbody');

        function zeichneListe() {
            Ui.leere(tabelle);
            offen.forEach(e => {
                const haken = Ui.el('input', {
                    type: 'checkbox', checked: gewaehlt.has(e.id),
                    onchange: ev => {
                        ev.target.checked ? gewaehlt.add(e.id) : gewaehlt.delete(e.id);
                    }
                });

                tabelle.appendChild(Ui.el('tr', {},
                    Ui.el('td', {}, haken),
                    Ui.el('td', {}, Hilf.tagKurz(e.datum) + ' ' + Hilf.datum(e.datum)),
                    Ui.el('td', {}, `${Hilf.uhrzeit(e.von)}–${Hilf.uhrzeit(e.bis)}`),
                    Ui.el('td', {}, Fach.projektName(e.projektId)),
                    Ui.el('td', {}, e.notiz || ''),
                    Ui.el('td.zahl', {}, Hilf.dauer(Fach.dauerVon(e)))));
            });
        }
        zeichneListe();

        const montag = Hilf.wochenStart(zustand.datum);

        return Ui.el('div.seite', {},
            seitenkopf('Freigaben', offen.length ? `${offen.length} Einträge warten` : 'Nichts offen', [
                Ui.el('button.knopf.knopf-still', {
                    onclick: () => {
                        const ergebnis = Fach.reicheEin(montag, Hilf.plusTage(montag, 6));
                        if (ergebnis.fehler) Ui.meldung(ergebnis.fehler, 'warnung');
                        else Ui.meldung(`${ergebnis.anzahl} Einträge eingereicht`, 'gut');
                        zeichne();
                    }
                }, 'Diese Woche einreichen')
            ]),

            offen.length
                ? Ui.el('div.karte', {},
                    Ui.el('table.tabelle', {},
                        Ui.el('thead', {}, Ui.el('tr', {},
                            Ui.el('th', {}, Ui.el('input', {
                                type: 'checkbox',
                                onchange: ev => {
                                    offen.forEach(e => ev.target.checked ? gewaehlt.add(e.id) : gewaehlt.delete(e.id));
                                    zeichneListe();
                                }
                            })),
                            Ui.el('th', {}, 'Tag'), Ui.el('th', {}, 'Zeit'),
                            Ui.el('th', {}, 'Projekt'), Ui.el('th', {}, 'Notiz'),
                            Ui.el('th.zahl', {}, 'Dauer'))),
                        tabelle),

                    Ui.el('div.karte-leib.zeile', {},
                        Ui.el('span.leise.klein', {},
                            'Genehmigte Zeiten lassen sich danach nicht mehr ändern.'),
                        Ui.el('span.abstand'),
                        Ui.el('button.knopf.knopf-still', {
                            onclick: () => {
                                if (!gewaehlt.size) { Ui.meldung('Nichts ausgewählt.', 'warnung'); return; }
                                Fach.entscheide([...gewaehlt], false);
                                Ui.meldung('Zurückgewiesen', 'info'); zeichne();
                            }
                        }, 'Zurückweisen'),
                        Ui.el('button.knopf.knopf-haupt', {
                            onclick: () => {
                                if (!gewaehlt.size) { Ui.meldung('Nichts ausgewählt.', 'warnung'); return; }
                                const n = Fach.entscheide([...gewaehlt], true);
                                Ui.meldung(`${n} Einträge genehmigt`, 'gut'); zeichne();
                            }
                        }, 'Genehmigen')))

                : Ui.el('div.karte.leer', {},
                    Ui.el('p', {}, 'Nichts wartet auf eine Entscheidung.'),
                    Ui.el('p.leise', {}, 'Eingereichte Zeiten erscheinen hier — bis dahin ist alles Entwurf und frei änderbar.')));
    }

    /* =================================================================
       Zeiterfassung
       ================================================================= */

    function daten() {
        const start = zustand.spanne >= 5 ? Hilf.wochenStart(zustand.datum) : zustand.datum;
        return Array.from({ length: zustand.spanne }, (_, i) => Hilf.plusTage(start, i));
    }

    function seiteZeit() {
        const tage = daten();
        const bereich = Fach.zeitraum(tage[0], tage[tage.length - 1]);

        const bahn = Ui.el('div.bahn-feld');
        setTimeout(() => Bahn.setze(bahn, tage, {
            beiAenderung: zeichne,
            beiOeffnen: id => eintragBearbeiten(id)
        }), 0);

        return Ui.el('div.seite', {},
            seitenkopf(
                zustand.spanne === 1 ? Hilf.tagLang(zustand.datum) : Hilf.spanne(tage[0], tage[tage.length - 1]),
                zustand.spanne === 1
                    ? `${Hilf.datum(zustand.datum)} · KW ${Hilf.kw(zustand.datum)}`
                    : `${zustand.spanne} Tage · KW ${Hilf.kw(tage[0])}`,
                [spannenWahl(), blaettern()]),

            Ui.el('div.dreispalt', {},
                monatsnavigator(),

                Ui.el('div.mitte', {},
                    schnellerfassung(),
                    Ui.el('div.karte.bahn-karte', {},
                        projektleiste(),
                        bahn)),

                Ui.el('div.rechts', {},
                    stempeluhr(),
                    bilanz(bereich),
                    aufgabenTafel())));
    }

    function seitenkopf(titel, unterzeile, rechts) {
        return Ui.el('div.seitenkopf', {},
            Ui.el('div', {},
                Ui.el('h1', {}, titel),
                unterzeile ? Ui.el('div.seitenkopf-unter', {}, unterzeile) : null),
            Ui.el('div.abstand'),
            rechts);
    }

    function spannenWahl() {
        return Ui.el('div.wahl', { title: 'Wie viele Tage nebeneinander' },
            [1, 3, 5, 7].map(n => Ui.el('button' + (zustand.spanne === n ? '.aktiv' : ''), {
                onclick: () => { zustand.spanne = n; zeichne(); }
            }, String(n))));
    }

    function blaettern() {
        const schritt = zustand.spanne >= 5 ? 7 : zustand.spanne;
        return Ui.el('div.knopfgruppe', {},
            Ui.el('button.knopf.knopf-still', {
                onclick: () => { zustand.datum = Hilf.plusTage(zustand.datum, -schritt); zeichne(); }
            }, '‹'),
            Ui.el('button.knopf.knopf-still', {
                onclick: () => { zustand.datum = Hilf.heute(); zeichne(); }
            }, 'Heute'),
            Ui.el('button.knopf.knopf-still', {
                onclick: () => { zustand.datum = Hilf.plusTage(zustand.datum, schritt); zeichne(); }
            }, '›'));
    }

    function schnellerfassung() {
        const feld = Ui.el('input.schnell-feld', {
            placeholder: 'Schnell erfassen:  8-12 Projektname  ·  oder  90m Sitzung',
            autocomplete: 'off',
            onkeydown: e => {
                if (e.key !== 'Enter') return;
                const ergebnis = Fach.ausZeile(zustand.datum, feld.value);
                if (ergebnis.fehler) { Ui.meldung(ergebnis.fehler, 'warnung'); return; }
                feld.value = '';
                Ui.meldung('Erfasst', 'gut');
                zeichne();
            }
        });

        return Ui.el('div.karte.schnell', {}, Ui.el('span.schnell-zeichen', {}, '+'), feld,
            Ui.el('kbd', {}, '↵'));
    }

    function projektleiste() {
        const haeufig = Fach.haeufigeProjekte(7);

        return Ui.el('div.projektleiste', {},
            Ui.el('div.projektleiste-titel', {}, 'Projekte'),
            haeufig.length
                ? haeufig.map(({ projekt, anzahl }) =>
                    Ui.el('button.projektknopf' + (zustand.projekt === projekt.id ? '.gewaehlt' : ''), {
                        stil: { '--farbe': projekt.farbe || '#94a3b8' },
                        onclick: () => {
                            zustand.projekt = zustand.projekt === projekt.id ? null : projekt.id;
                            Bahn.projekt = zustand.projekt;
                            zeichne();
                        }
                    },
                        Ui.el('span.projektknopf-strich'),
                        Ui.el('span.projektknopf-name', {}, projekt.name),
                        anzahl ? Ui.el('span.projektknopf-zahl', {}, anzahl + '×') : null))
                : Ui.el('p.leise', {}, 'Noch keine Projekte. Unter «Projekte» anlegen.'),

            Ui.el('div.projektleiste-hinweis', {},
                zustand.projekt
                    ? 'Jetzt auf der Fläche eine Zeit aufziehen.'
                    : 'Projekt wählen, dann Zeit aufziehen.'));
    }

    /* ---- Stempeluhr ---- */

    function stempeluhr() {
        const laeuft = Fach.laufender();
        const jetzt = new Date();
        const minuten = laeuft
            ? (jetzt.getHours() * 60 + jetzt.getMinutes()) - laeuft.von
            : 0;

        return Ui.el('div.karte', {},
            Ui.el('div.karte-kopf', {}, Ui.el('h3', {}, 'Stempeluhr')),
            Ui.el('div.karte-leib', {},
                Ui.el('div.uhr-zahl' + (laeuft ? '.laeuft' : ''), {}, Hilf.dauer(Math.max(0, minuten))),

                laeuft
                    ? Ui.el('div.spalte', {},
                        Ui.el('p.leise', {}, 'Seit ' + Hilf.uhrzeit(laeuft.von)
                            + (laeuft.projektId ? ' · ' + Fach.projektName(laeuft.projektId) : '')),
                        Ui.el('button.knopf.knopf-haupt', {
                            onclick: () => { Fach.stoppe(); Ui.meldung('Gestoppt', 'gut'); zeichne(); }
                        }, 'Stoppen'),
                        Ui.el('button.knopf.knopf-still', {
                            onclick: async () => {
                                if (await Ui.frage('Die laufende Zeit verwerfen?', 'Verwerfen')) {
                                    Fach.verwerfe(); zeichne();
                                }
                            }
                        }, 'Verwerfen'))

                    : Ui.el('button.knopf.knopf-haupt', {
                        onclick: () => {
                            Fach.starte(zustand.projekt, null, '');
                            Ui.meldung('Stempeluhr läuft', 'gut');
                            zeichne();
                        }
                    }, 'Starten')));
    }

    function bilanz(bereich) {
        const saldo = Fach.saldo(zustand.datum);

        return Ui.el('div.karte', {},
            Ui.el('div.karte-kopf', {}, Ui.el('h3', {}, 'Bilanz')),
            Ui.el('div.karte-leib', {},
                Ui.el('div.bilanz-gross', {}, Hilf.dauer(bereich.gearbeitet)),
                Ui.el('div.bilanz-von', {}, 'von ' + Hilf.dauer(bereich.soll) + ' Soll'),
                Ui.el('div.balken', {},
                    Ui.el('span', {
                        stil: {
                            width: Hilf.klemme(bereich.soll > 0
                                ? (bereich.gearbeitet + bereich.absenzMinuten) / bereich.soll * 100 : 0, 0, 100) + '%'
                        }
                    })),

                Ui.el('div.zeile', {},
                    Ui.el('span.leise', {}, 'Differenz'),
                    Ui.el('span.abstand'),
                    Ui.el('span.zahl.' + (bereich.differenz >= 0 ? 'gut' : 'fehlt'), {},
                        Hilf.mitVorzeichen(bereich.differenz))),

                Ui.el('div.zeile', {},
                    Ui.el('span.leise', {}, 'Gleitzeit'),
                    Ui.el('span.abstand'),
                    Ui.el('span.zahl.' + (saldo >= 0 ? 'gut' : 'fehlt'), {}, Hilf.mitVorzeichen(saldo)))));
    }

    /* ---- Kalender links ---- */

    function monatsnavigator() {
        const anker = zustand.navMonat || zustand.datum.slice(0, 7) + '-01';
        const monate = [-1, 0, 1].map(v => {
            const d = Hilf.alsDatum(anker);
            d.setMonth(d.getMonth() + v);
            return d;
        });

        const abstandWochen = Math.round(
            (Hilf.alsDatum(Hilf.wochenStart(zustand.datum)) - Hilf.alsDatum(Hilf.wochenStart(Hilf.heute())))
            / (7 * 24 * 3600 * 1000));

        const beschriftung =
            abstandWochen === 0 ? 'Diese Woche'
            : abstandWochen === 1 ? 'Nächste Woche'
            : abstandWochen === -1 ? 'Letzte Woche'
            : abstandWochen > 0 ? `In ${abstandWochen} Wochen`
            : `Vor ${-abstandWochen} Wochen`;

        return Ui.el('div.karte.kalender', {},
            Ui.el('div.karte-kopf', {},
                Ui.el('h3', {}, 'Monate'),
                Ui.el('span.abstand'),
                Ui.el('button.knopf.knopf-winzig', {
                    onclick: () => { zustand.navMonat = verschiebeMonat(anker, -1); zeichne(); }
                }, '‹'),
                Ui.el('button.knopf.knopf-winzig', {
                    onclick: () => { zustand.navMonat = verschiebeMonat(anker, 1); zeichne(); }
                }, '›')),

            Ui.el('button.kalender-abstand' + (abstandWochen === 0 ? '.jetzt' : ''), {
                onclick: () => { zustand.datum = Hilf.heute(); zustand.navMonat = null; zeichne(); },
                title: 'Zur heutigen Woche'
            }, beschriftung, abstandWochen !== 0 ? Ui.el('span.kalender-zurueck', {}, 'heute') : null),

            Ui.el('div.kalender-monate', {}, monate.map(monat)),

            // Einmal am Fuss, nicht unter jedem Monat.
            Ui.el('div.kal-legende', {},
                Ui.el('span', {}, Ui.el('i.punkt.voll'), 'Soll erreicht'),
                Ui.el('span', {}, Ui.el('i.punkt.teil'), 'zu wenig')));
    }

    function verschiebeMonat(anker, um) {
        const d = Hilf.alsDatum(anker);
        d.setMonth(d.getMonth() + um);
        return Hilf.alsText(d);
    }

    function monat(d) {
        const jahr = d.getFullYear(), nr = d.getMonth();
        const erster = new Date(jahr, nr, 1);
        const letzter = new Date(jahr, nr + 1, 0);

        const wochen = [];
        for (let m = Hilf.wochenStart(Hilf.alsText(erster));
             m <= Hilf.wochenStart(Hilf.alsText(letzter));
             m = Hilf.plusTage(m, 7)) {
            wochen.push(m);
        }

        const gewaehlteWoche = Hilf.wochenStart(zustand.datum);

        return Ui.el('section.kal-monat', {},
            Ui.el('div.kal-titel', {},
                Ui.el('span.kal-name', {}, Hilf.monatName(nr)),
                Ui.el('span.kal-jahr', {}, String(jahr))),

            Ui.el('div.kal-raster', {},
                Ui.el('div.kal-zeile.kal-kopf', {},
                    Ui.el('span.kal-kw-kopf', {}, 'KW'),
                    ['M', 'D', 'M', 'D', 'F', 'S', 'S'].map(n => Ui.el('span.kal-wochentag', {}, n))),

                wochen.map(montag => Ui.el('div.kal-zeile' + (montag === gewaehlteWoche ? '.aktuell' : ''), {},
                    Ui.el('button.kal-kw', {
                        onclick: () => { zustand.datum = montag; zeichne(); },
                        title: 'KW ' + Hilf.kw(montag)
                    }, String(Hilf.kw(montag))),

                    Array.from({ length: 7 }, (_, i) => {
                        const tag = Hilf.plusTage(montag, i);
                        const imMonat = Hilf.alsDatum(tag).getMonth() === nr;
                        const zeile = Fach.tag(tag);

                        let ton = '';
                        const erledigt = zeile.gearbeitet + zeile.absenzMinuten;
                        if (erledigt > 0) ton = (zeile.soll <= 0 || erledigt >= zeile.soll - 1) ? '.voll' : '.teil';

                        return Ui.el('button.kal-tag' + ton
                            + (imMonat ? '' : '.fremd')
                            + (Hilf.istWochenende(tag) ? '.wochenende' : '')
                            + (tag === zustand.datum ? '.gewaehlt' : '')
                            + (tag === Hilf.heute() ? '.heute' : ''), {
                            onclick: () => { zustand.datum = tag; zeichne(); },
                            title: `${Hilf.tagLang(tag)}, ${Hilf.datum(tag)}`
                                + (zeile.feiertag ? ' · ' + zeile.feiertag.name : '')
                                + ` · ${Hilf.dauer(zeile.gearbeitet)} von ${Hilf.dauer(zeile.soll)}`
                        }, String(Hilf.alsDatum(tag).getDate()));
                    })))));
    }

    /* ---- Aufgaben ---- */

    function aufgabenTafel() {
        const offen = (Daten.doc.aufgaben || []).filter(a => !a.erledigt);

        return Ui.el('div.karte', {},
            Ui.el('div.karte-kopf', {},
                Ui.el('h3', {}, 'Aufgaben'),
                Ui.el('span.abstand'),
                Ui.el('button.knopf.knopf-winzig', { onclick: () => aufgabeBearbeiten(null) }, '+')),
            Ui.el('div.karte-leib', {},
                offen.length
                    ? offen.slice(0, 12).map(a => Ui.el('div.aufgabe', {},
                        Ui.el('input', {
                            type: 'checkbox',
                            onchange: () => {
                                Daten.aendere('Aufgabe erledigt', () => { a.erledigt = Hilf.heute(); });
                                zeichne();
                            }
                        }),
                        Ui.el('div.aufgabe-text', { onclick: () => aufgabeBearbeiten(a.id) },
                            Ui.el('div.aufgabe-titel', {}, a.titel),
                            Ui.el('div.aufgabe-unter', {},
                                [a.projektId ? Fach.projektName(a.projektId) : null,
                                 a.faellig ? 'bis ' + Hilf.datumKurz(a.faellig) : null]
                                    .filter(Boolean).join(' · ')))))
                    : Ui.el('p.leise', {}, 'Nichts offen.')));
    }

    /* =================================================================
       Wochenplanung
       ================================================================= */

    function seiteWoche() {
        const montag = Hilf.wochenStart(zustand.datum);
        const tage = Array.from({ length: 7 }, (_, i) => Hilf.plusTage(montag, i));
        const ziele = (Daten.doc.wochenziele || []).filter(z => z.woche === montag);

        return Ui.el('div.seite', {},
            seitenkopf('Woche ' + Hilf.kw(montag), Hilf.spanne(montag, tage[6]), [
                Ui.el('button.knopf.knopf-still', {
                    onclick: () => {
                        const n = Fach.uebernimmWoche(montag);
                        Ui.meldung(n ? `${n} Einträge übernommen` : 'Nichts zu übernehmen', n ? 'gut' : 'info');
                        zeichne();
                    }
                }, 'Vorwoche übernehmen'),
                blaettern()
            ]),

            Ui.el('div.zweispalt', {},
                monatsnavigator(),

                Ui.el('div.wochenplan', {},
                    Ui.el('div.wochenplan-tage', {},
                        tage.map(tag => {
                            const zeile = Fach.tag(tag);
                            const aufgaben = (Daten.doc.aufgaben || []).filter(a => a.geplant === tag);

                            return Ui.el('div.wp-tag' + (tag === Hilf.heute() ? '.heute' : ''), {},
                                Ui.el('div.wp-tag-kopf', {},
                                    Ui.el('strong', {}, Hilf.tagLang(tag)),
                                    Ui.el('span.leise', {}, Hilf.datumKurz(tag))),

                                zeile.feiertag ? Ui.el('div.wp-band', {}, zeile.feiertag.name) : null,

                                Ui.el('div.wp-liste', {},
                                    aufgaben.map(a => Ui.el('div.wp-aufgabe' + (a.erledigt ? '.fertig' : ''), {
                                        onclick: () => aufgabeBearbeiten(a.id)
                                    }, a.titel)),
                                    Ui.el('button.wp-plus', {
                                        onclick: () => aufgabeBearbeiten(null, tag)
                                    }, '+ Aufgabe')),

                                Ui.el('div.wp-summe', {}, Hilf.dauer(zeile.gearbeitet)));
                        })),

                    Ui.el('div.karte', {},
                        Ui.el('div.karte-kopf', {}, Ui.el('h3', {}, 'Wochenziele')),
                        Ui.el('div.karte-leib', {},
                            Array.from({ length: 5 }, (_, i) => {
                                const ziel = ziele.find(z => z.position === i);
                                return Ui.el('input.eingabe.ziel', {
                                    value: ziel ? ziel.text : '',
                                    placeholder: `Ziel ${i + 1}`,
                                    onchange: e => {
                                        const text = e.target.value.trim();
                                        Daten.aendere('Wochenziel', d => {
                                            d.wochenziele = d.wochenziele.filter(
                                                z => !(z.woche === montag && z.position === i));
                                            if (text) d.wochenziele.push({ woche: montag, position: i, text });
                                        });
                                    }
                                });
                            }))))));
    }

    /* =================================================================
       Projekte
       ================================================================= */

    function seiteProjekte() {
        const projekte = Daten.doc.projekte || [];

        return Ui.el('div.seite', {},
            seitenkopf('Projekte', `${projekte.length} Projekte · ${(Daten.doc.kunden || []).length} Kunden`, [
                Ui.el('button.knopf.knopf-still', { onclick: () => kundeBearbeiten(null) }, 'Kunde anlegen'),
                Ui.el('button.knopf.knopf-haupt', { onclick: () => projektBearbeiten(null) }, 'Projekt anlegen')
            ]),

            projekte.length
                ? Ui.el('div.karte', {},
                    Ui.el('table.tabelle', {},
                        Ui.el('thead', {}, Ui.el('tr', {},
                            Ui.el('th', {}, ''), Ui.el('th', {}, 'Projekt'), Ui.el('th', {}, 'Kunde'),
                            Ui.el('th.zahl', {}, 'Erfasst'), Ui.el('th.zahl', {}, 'Budget'),
                            Ui.el('th.zahl', {}, 'Satz'), Ui.el('th', {}, ''))),
                        Ui.el('tbody', {}, projekte.map(p => {
                            const minuten = (Daten.doc.eintraege || [])
                                .filter(e => e.projektId === p.id)
                                .reduce((s, e) => s + Fach.dauerVon(e), 0);

                            return Ui.el('tr', {},
                                Ui.el('td', {}, Ui.el('i.punkt', { stil: { background: p.farbe || '#94a3b8' } })),
                                Ui.el('td', {}, Ui.el('strong', {}, p.name),
                                    p.nummer ? Ui.el('div.leise.klein', {}, p.nummer) : null),
                                Ui.el('td', {}, (Fach.kunde(p.kundeId) || {}).name || '—'),
                                Ui.el('td.zahl', {}, Hilf.dauer(minuten)),
                                Ui.el('td.zahl', {}, p.budgetStunden ? p.budgetStunden + ' h' : '—'),
                                Ui.el('td.zahl', {}, p.satz ? Hilf.geld(p.satz) : '—'),
                                Ui.el('td.zahl', {},
                                    Ui.el('button.knopf.knopf-winzig', {
                                        onclick: () => projektBearbeiten(p.id)
                                    }, 'Ändern')));
                        }))))
                : Ui.el('div.karte.leer', {},
                    Ui.el('p', {}, 'Noch keine Projekte.'),
                    Ui.el('p.leise', {}, 'Ohne Projekt lässt sich Zeit erfassen — mit Projekt lässt sie sich auswerten und verrechnen.')));
    }

    /* =================================================================
       Absenzen
       ================================================================= */

    function seiteAbsenzen() {
        const jahr = Number(zustand.datum.slice(0, 4));
        const konto = Fach.ferienkonto(jahr);
        const absenzen = (Daten.doc.absenzen || [])
            .filter(a => a.von.startsWith(String(jahr)))
            .sort((a, b) => a.von.localeCompare(b.von));

        return Ui.el('div.seite', {},
            seitenkopf('Absenzen & Ferien', 'Jahr ' + jahr, [
                Ui.el('button.knopf.knopf-haupt', { onclick: () => absenzBearbeiten(null) }, 'Absenz erfassen')
            ]),

            Ui.el('div.kacheln', {},
                kachel('Anspruch', konto.anspruch + ' Tage', 'pro Jahr'),
                kachel('Bezogen', konto.bezogen + ' Tage', 'bereits genommen'),
                kachel('Geplant', konto.beantragt + ' Tage', 'schon eingetragen'),
                kachel('Rest', konto.rest + ' Tage', 'noch frei', konto.rest < 0 ? 'fehlt' : 'gut')),

            Ui.el('div.zweispalt-breit', {},
                Ui.el('div.karte', {},
                    Ui.el('div.karte-kopf', {}, Ui.el('h3', {}, 'Erfasst')),
                    absenzen.length
                        ? Ui.el('table.tabelle', {},
                            Ui.el('tbody', {}, absenzen.map(a => {
                                const typ = Fach.absenztyp(a.typId);
                                return Ui.el('tr', {},
                                    Ui.el('td', {}, Ui.el('i.punkt', { stil: { background: (typ && typ.farbe) || '#888' } })),
                                    Ui.el('td', {}, Ui.el('strong', {}, typ ? typ.name : 'Absenz'),
                                        a.grund ? Ui.el('div.leise.klein', {}, a.grund) : null),
                                    Ui.el('td', {}, Hilf.spanne(a.von, a.bis)),
                                    Ui.el('td.zahl', {}, Fach.arbeitstage(a) + ' Tage'),
                                    Ui.el('td.zahl', {},
                                        Ui.el('button.knopf.knopf-winzig', {
                                            onclick: () => absenzBearbeiten(a.id)
                                        }, 'Ändern')));
                            })))
                        : Ui.el('div.karte-leib', {}, Ui.el('p.leise', {}, 'Nichts erfasst.'))),

                feiertagsKarte(jahr)));
    }

    function feiertagsKarte(jahr) {
        const kanton = Daten.doc.einstellungen.kanton;
        const alle = Fach.feiertageAlle(jahr);
        const abgewaehlt = new Set(Daten.doc.abgewaehlteFeiertage || []);

        return Ui.el('div.karte', {},
            Ui.el('div.karte-kopf', {},
                Ui.el('h3', {}, 'Feiertage ' + jahr),
                Ui.el('span.abstand'),
                Ui.el('select.eingabe.schmal', {
                    onchange: e => {
                        Daten.still(d => { d.einstellungen.kanton = e.target.value; });
                        Fach.vergissFeiertage();
                        zeichne();
                    }
                }, Object.entries(Fach.KANTONE).map(([kuerzel, name]) =>
                    Ui.el('option', { value: kuerzel, selected: kuerzel === kanton }, `${kuerzel} — ${name}`)))),

            Ui.el('div.karte-leib', {},
                Ui.el('p.leise.klein', {},
                    'Der Kanton wählt vor. Angehakt ist, was für Sie gilt — jeder Tag lässt sich einzeln ändern.'),

                Ui.el('div.feiertagsliste', {}, alle.map(f => {
                    const schluessel = f.datum + '|' + f.name;
                    const gilt = (f.kantone === null || f.kantone.includes(kanton)) && !abgewaehlt.has(schluessel);

                    return Ui.el('label.feiertag' + (gilt ? '.gilt' : ''), {},
                        Ui.el('input', {
                            type: 'checkbox', checked: gilt,
                            onchange: e => {
                                Daten.still(d => {
                                    d.abgewaehlteFeiertage = d.abgewaehlteFeiertage || [];
                                    if (e.target.checked) {
                                        d.abgewaehlteFeiertage = d.abgewaehlteFeiertage.filter(s => s !== schluessel);
                                        // Gilt der Tag im Kanton nicht, wird er zum eigenen.
                                        if (f.kantone !== null && !f.kantone.includes(kanton)) {
                                            d.eigeneFeiertage.push({ datum: f.datum, name: f.name, halb: !!f.halb });
                                        }
                                    } else {
                                        d.abgewaehlteFeiertage.push(schluessel);
                                        d.eigeneFeiertage = d.eigeneFeiertage.filter(x => x.datum !== f.datum);
                                    }
                                });
                                Fach.vergissFeiertage();
                                zeichne();
                            }
                        }),
                        Ui.el('span.feiertag-datum', {}, Hilf.datumKurz(f.datum)),
                        Ui.el('span.feiertag-name', {}, f.name, f.halb ? Ui.el('em', {}, ' halb') : null),
                        Ui.el('span.feiertag-wo', {},
                            f.kantone === null ? 'landesweit'
                                : f.kantone.length > 12 ? f.kantone.length + ' Kantone'
                                : f.kantone.join(' ')));
                }))));
    }

    function kachel(name, wert, hinweis, ton) {
        return Ui.el('div.kachel', {},
            Ui.el('div.kachel-name', {}, name),
            Ui.el('div.kachel-wert' + (ton ? '.' + ton : ''), {}, wert),
            Ui.el('div.kachel-hinweis', {}, hinweis));
    }

    /* =================================================================
       Auswertung
       ================================================================= */

    /* =================================================================
       Rapport
       -----------------------------------------------------------------
       Ein Blatt Stunden — und ausdrücklich keine Rechnung. Es gibt
       verschiedene Anlässe, es zu brauchen, und sie stellen verschiedene
       Fragen an dieselben Einträge:

         «Wie lange habe ich an dieser Sache gearbeitet?»
             → ein Projekt, eine Tätigkeit, nach Tag aufgelistet

         «Was habe ich in den letzten zwei Wochen geleistet?»
             → alle Projekte, zwei Wochen, nach Tag zusammengezogen

       Statt für jeden Anlass ein eigenes Formular gibt es einen Rapport
       mit drei Reglern — Zeitraum, Eingrenzung, Gliederung — und ein
       paar Voreinstellungen, die die üblichen Fälle mit einem Klick
       treffen. Wer etwas anderes braucht, dreht selbst daran.
       ================================================================= */

    function rapportStand() {
        if (!zustand.rapport) {
            const montag = Hilf.wochenStart(Hilf.heute());
            zustand.rapport = {
                von: Hilf.plusTage(montag, -7),          // letzte und diese Woche
                bis: Hilf.plusTage(montag, 6),
                projektId: '', taetigkeitId: '',
                gliederung: 'tag'
            };
        }
        return zustand.rapport;
    }

    /** Die Einträge des Rapports, gefiltert und chronologisch. */
    function rapportZeilen(r) {
        return (Daten.doc.eintraege || [])
            .filter(e => e.datum >= r.von && e.datum <= r.bis)
            .filter(e => !r.projektId || e.projektId === r.projektId)
            .filter(e => !r.taetigkeitId || e.taetigkeitId === r.taetigkeitId)
            .filter(e => Fach.dauerVon(e) > 0)
            .sort((a, b) => a.datum.localeCompare(b.datum) || a.von - b.von);
    }

    /** Nach der gewählten Gliederung bündeln — Reihenfolge bleibt stabil. */
    function rapportGruppen(zeilen, gliederung) {
        const gruppen = new Map();
        zeilen.forEach(e => {
            let schluessel, titel, farbe = '';
            if (gliederung === 'projekt') {
                schluessel = e.projektId || '—';
                titel = e.projektId ? Fach.projektName(e.projektId) : 'Ohne Projekt';
                farbe = e.projektId ? Fach.projektFarbe(e.projektId) : '';
            } else if (gliederung === 'taetigkeit') {
                schluessel = e.taetigkeitId || '—';
                const t = Fach.taetigkeit(e.taetigkeitId);
                titel = t ? t.name : 'Ohne Tätigkeit';
            } else {
                schluessel = e.datum;
                titel = Hilf.tagLang(e.datum) + ', ' + Hilf.datum(e.datum);
            }
            if (!gruppen.has(schluessel)) gruppen.set(schluessel, { titel, farbe, minuten: 0, zeilen: [] });
            const g = gruppen.get(schluessel);
            g.minuten += Fach.dauerVon(e);
            g.zeilen.push(e);
        });
        const liste = [...gruppen.values()];
        /* Nach Tag chronologisch, sonst der grösste Aufwand zuoberst —
           dort schaut man zuerst hin. */
        return gliederung === 'tag' ? liste : liste.sort((a, b) => b.minuten - a.minuten);
    }

    function seiteRapport() {
        const r = rapportStand();
        const zeilen = rapportZeilen(r);
        const gruppen = rapportGruppen(zeilen, r.gliederung);
        const summe = zeilen.reduce((a, e) => a + Fach.dauerVon(e), 0);
        const tage = new Set(zeilen.map(e => e.datum)).size;

        const neu = aenderung => { Object.assign(r, aenderung); zeichne(); };
        const montag = Hilf.wochenStart(Hilf.heute());

        /* ---- Die Voreinstellungen: die zwei, drei Fälle, die es gibt ---- */
        const vorlagen = [
            ['Diese Woche', { von: montag, bis: Hilf.plusTage(montag, 6), gliederung: 'tag' }],
            ['Diese + letzte Woche', { von: Hilf.plusTage(montag, -7), bis: Hilf.plusTage(montag, 6), gliederung: 'tag' }],
            ['Dieser Monat', { von: Hilf.heute().slice(0, 8) + '01', bis: Hilf.heute(), gliederung: 'projekt' }]
        ];
        const passt = w => r.von === w.von && r.bis === w.bis;

        const knopfReihe = (titel, knoepfe) => Ui.el('div.rp-feld', {},
            Ui.el('div.rp-marke', {}, titel),
            Ui.el('div.rp-knoepfe', {}, knoepfe));

        const waehler = (titel, wert, liste, feld) => Ui.el('div.rp-feld', {},
            Ui.el('div.rp-marke', {}, titel),
            Ui.el('select.eingabe', {
                onchange: ev => neu({ [feld]: ev.target.value })
            }, [Ui.el('option', { value: '' }, 'alle'),
                ...liste.map(x => Ui.el('option', { value: x.id, selected: wert === x.id }, x.name))]));

        const steuerung = Ui.el('div.karte.rp-steuer', {},
            Ui.el('div.karte-leib', {},
                Ui.el('div.rp-reihe', {},
                    knopfReihe('Zeitraum', vorlagen.map(([name, w]) =>
                        Ui.el('button.knopf.knopf-klein' + (passt(w) ? '' : '.knopf-still'), {
                            onclick: () => neu(w)
                        }, name))),

                    Ui.el('div.rp-feld', {},
                        Ui.el('div.rp-marke', {}, 'von'),
                        Ui.el('input.eingabe', { type: 'date', value: r.von,
                            onchange: ev => neu({ von: ev.target.value }) })),
                    Ui.el('div.rp-feld', {},
                        Ui.el('div.rp-marke', {}, 'bis'),
                        Ui.el('input.eingabe', { type: 'date', value: r.bis,
                            onchange: ev => neu({ bis: ev.target.value }) }))),

                Ui.el('div.rp-reihe', {},
                    waehler('Projekt', r.projektId, Daten.doc.projekte || [], 'projektId'),
                    waehler('Tätigkeit', r.taetigkeitId, Daten.doc.taetigkeiten || [], 'taetigkeitId'),
                    knopfReihe('Gliederung', [['tag', 'nach Tag'], ['projekt', 'nach Projekt'], ['taetigkeit', 'nach Tätigkeit']]
                        .map(([k, name]) => Ui.el('button.knopf.knopf-klein' + (r.gliederung === k ? '' : '.knopf-still'), {
                            onclick: () => neu({ gliederung: k })
                        }, name))))));

        /* ---- Der Kopf des Blattes: was, für wen, wie lange ---- */
        const b = Daten.doc.einstellungen || {};
        const blattKopf = Ui.el('div.rp-kopf', {},
            Ui.el('div.rp-kopf-l', {},
                Ui.el('div.rp-titel', {}, 'Stundenrapport'),
                Ui.el('div.rp-unter', {},
                    (r.projektId ? Fach.projektName(r.projektId) : 'Alle Projekte')
                    + (r.taetigkeitId ? ' · ' + ((Fach.taetigkeit(r.taetigkeitId) || {}).name || '') : '')),
                Ui.el('div.rp-unter', {}, Hilf.datum(r.von) + ' – ' + Hilf.datum(r.bis)),
                b.person ? Ui.el('div.rp-unter', {}, esc0(b.person)) : null),
            Ui.el('div.rp-kopf-r', {},
                Ui.el('div.rp-marke', {}, 'Total'),
                Ui.el('div.rp-gross', {}, Hilf.dauer(summe)),
                Ui.el('div.rp-unter', {}, Hilf.stunden(summe).toString().replace('.', ',') + ' Stunden'),
                Ui.el('div.rp-unter', {}, tage + (tage === 1 ? ' Tag' : ' Tage') + ' · ' + zeilen.length + ' Einträge')));

        /* ---- Die Gruppen ---- */
        const inhalt = gruppen.length
            ? gruppen.map(g => Ui.el('div.rp-gruppe', {},
                Ui.el('div.rp-gruppe-kopf', {},
                    g.farbe ? Ui.el('i.rp-punkt', { stil: { background: g.farbe } }) : null,
                    Ui.el('span.rp-gruppe-titel', {}, g.titel),
                    Ui.el('span.rp-gruppe-summe', {}, Hilf.dauer(g.minuten))),
                Ui.el('table.rp-tabelle', {}, Ui.el('tbody', {},
                    g.zeilen.map(e => {
                        const t = Fach.taetigkeit(e.taetigkeitId);
                        /* Was in der Gruppenüberschrift schon steht, wird in
                           der Zeile nicht wiederholt — sonst liest man
                           dreimal dasselbe Projekt untereinander. */
                        const was = [
                            r.gliederung !== 'projekt' && e.projektId ? Fach.projektName(e.projektId) : '',
                            r.gliederung !== 'taetigkeit' && t ? t.name : '',
                            e.notiz || ''
                        ].filter(Boolean).join(' · ');
                        return Ui.el('tr', {},
                            Ui.el('td.rp-tag', {}, r.gliederung === 'tag'
                                ? Hilf.uhrzeit(e.von) + '–' + (Number.isFinite(e.bis) ? Hilf.uhrzeit(e.bis) : '…')
                                : Hilf.datumKurz(e.datum)),
                            Ui.el('td.rp-was', {}, was || '—'),
                            Ui.el('td.rp-dauer', {}, Hilf.dauer(Fach.dauerVon(e))));
                    })))))
            : Ui.el('p.leise', {}, 'Für diesen Zeitraum ist nichts erfasst.');

        const blatt = Ui.el('div.karte.rp-blatt', {}, blattKopf, Ui.el('div.rp-leib', {}, inhalt),
            Ui.el('div.rp-fuss', {},
                Ui.el('span', {}, 'Stundenrapport — keine Rechnung.'),
                Ui.el('span', {}, 'Erstellt ' + Hilf.datum(Hilf.heute()))));

        return Ui.el('div.seite.rp-seite', {},
            seitenkopf('Rapport', 'Stunden zusammenstellen und ausgeben', [
                Ui.el('button.knopf.knopf-still', { onclick: () => rapportCsv(r, zeilen) }, 'Als CSV'),
                Ui.el('button.knopf', { onclick: () => window.print() }, 'Drucken')
            ]),
            steuerung, blatt);
    }

    /** Sicher ausgeben — Ui.el setzt Text, nicht HTML, aber Klarheit hilft. */
    function esc0(s) { return String(s == null ? '' : s); }

    function rapportCsv(r, zeilen) {
        const kopf = [['Datum', 'Wochentag', 'Von', 'Bis', 'Stunden', 'Projekt', 'Tätigkeit', 'Notiz']];
        zeilen.forEach(e => kopf.push([
            e.datum, Hilf.tagLang(e.datum), Hilf.uhrzeit(e.von),
            Number.isFinite(e.bis) ? Hilf.uhrzeit(e.bis) : '',
            String(Hilf.stunden(Fach.dauerVon(e))).replace('.', ','),
            Fach.projektName(e.projektId),
            (Fach.taetigkeit(e.taetigkeitId) || {}).name || '',
            e.notiz || ''
        ]));
        const summe = zeilen.reduce((a, e) => a + Fach.dauerVon(e), 0);
        kopf.push([], ['Total', '', '', '', String(Hilf.stunden(summe)).replace('.', ',')]);

        const text = kopf.map(z => z.map(f => `"${String(f).replace(/"/g, '""')}"`).join(';')).join('\r\n');
        const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
        const verweis = Ui.el('a', { href: URL.createObjectURL(blob), download: 'rapport_' + r.von + '_' + r.bis + '.csv' });
        verweis.click();
        setTimeout(() => URL.revokeObjectURL(verweis.href), 4000);
        Ui.meldung('Rapport als CSV ausgegeben', 'gut');
    }

    function seiteAuswertung() {
        const jahr = Number(zustand.datum.slice(0, 4));
        const bereich = Fach.zeitraum(`${jahr}-01-01`, `${jahr}-12-31`);

        const jeProjekt = new Map();
        (Daten.doc.eintraege || []).forEach(e => {
            if (!e.datum.startsWith(String(jahr))) return;
            const schluessel = e.projektId || '—';
            jeProjekt.set(schluessel, (jeProjekt.get(schluessel) || 0) + Fach.dauerVon(e));
        });

        const sortiert = Array.from(jeProjekt.entries()).sort((a, b) => b[1] - a[1]);
        const groesste = Math.max(1, ...sortiert.map(x => x[1]));

        return Ui.el('div.seite', {},
            seitenkopf('Auswertung', 'Jahr ' + jahr, [
                Ui.el('button.knopf.knopf-still', { onclick: exportCsv }, 'Als CSV ausgeben')
            ]),

            Ui.el('div.kacheln', {},
                kachel('Erfasst', Hilf.dauer(bereich.gearbeitet), 'im Jahr'),
                kachel('Soll', Hilf.dauer(bereich.soll), 'nach Abzügen'),
                kachel('Differenz', Hilf.mitVorzeichen(bereich.differenz), 'Über- oder Unterzeit',
                    bereich.differenz >= 0 ? 'gut' : 'fehlt'),
                kachel('Absenzen', Hilf.dauer(bereich.absenzMinuten), 'Ferien, Krankheit')),

            Ui.el('div.karte', {},
                Ui.el('div.karte-kopf', {}, Ui.el('h3', {}, 'Nach Projekt')),
                Ui.el('div.karte-leib', {},
                    sortiert.length
                        ? sortiert.map(([id, minuten]) => Ui.el('div.rang', {},
                            Ui.el('span.rang-name', {}, id === '—' ? 'Ohne Projekt' : Fach.projektName(id)),
                            Ui.el('span.rang-balken', {},
                                Ui.el('i', {
                                    stil: {
                                        width: (minuten / groesste * 100) + '%',
                                        background: id === '—' ? '#94a3b8' : Fach.projektFarbe(id)
                                    }
                                })),
                            Ui.el('span.rang-zahl', {}, Hilf.dauer(minuten))))
                        : Ui.el('p.leise', {}, 'Noch nichts erfasst.'))));
    }

    function exportCsv() {
        const zeilen = [['Datum', 'Wochentag', 'Von', 'Bis', 'Pause', 'Stunden', 'Projekt', 'Tätigkeit', 'Notiz']];

        (Daten.doc.eintraege || [])
            .slice()
            .sort((a, b) => a.datum.localeCompare(b.datum) || a.von - b.von)
            .forEach(e => zeilen.push([
                e.datum, Hilf.tagLang(e.datum), Hilf.uhrzeit(e.von),
                Number.isFinite(e.bis) ? Hilf.uhrzeit(e.bis) : '',
                e.pause || 0,
                String(Hilf.stunden(Fach.dauerVon(e))).replace('.', ','),
                Fach.projektName(e.projektId),
                (Fach.taetigkeit(e.taetigkeitId) || {}).name || '',
                e.notiz || ''
            ]));

        const text = zeilen
            .map(z => z.map(f => `"${String(f).replace(/"/g, '""')}"`).join(';'))
            .join('\r\n');

        // Byte-Marke voran, sonst zeigt Excel die Umlaute falsch.
        const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
        const verweis = Ui.el('a', { href: URL.createObjectURL(blob), download: 'zeiten.csv' });
        verweis.click();
        setTimeout(() => URL.revokeObjectURL(verweis.href), 4000);

        Ui.meldung('CSV ausgegeben', 'gut');
    }

    /* =================================================================
       Einstellungen
       ================================================================= */

    function seiteEinstellungen() {
        const e = Daten.doc.einstellungen;
        const TAGE = [['1','Montag'],['2','Dienstag'],['3','Mittwoch'],['4','Donnerstag'],
                      ['5','Freitag'],['6','Samstag'],['0','Sonntag']];

        return Ui.el('div.seite', {},
            seitenkopf('Einstellungen', 'Gilt für diese Datei', []),

            Ui.el('div.zweispalt-breit', {},
                Ui.el('div.karte', {},
                    Ui.el('div.karte-kopf', {}, Ui.el('h3', {}, 'Stufe')),
                    Ui.el('div.karte-leib', {},
                        Ui.el('p.leise.klein', {},
                            'Die Stufe blendet ein und aus, was Sie brauchen. Wechseln geht jederzeit — es geht nichts verloren.'),
                        [['schule', 'Schule', 'Zeit und Planung. Keine Kunden, keine Rechnungen.'],
                         ['selbstaendig', 'Selbständig', 'Kunden, Projekte, Sätze — ohne Freigaben.'],
                         ['firma', 'Firma', 'Alles, samt Freigaben und Auswertungen.']]
                            .map(([wert, name, satz]) =>
                                Ui.el('label.wahlfeld' + (e.stufe === wert ? '.gewaehlt' : ''), {},
                                    Ui.el('input', {
                                        type: 'radio', name: 'stufe', checked: e.stufe === wert,
                                        onchange: () => { Daten.still(d => { d.einstellungen.stufe = wert; }); zeichne(); }
                                    }),
                                    Ui.el('div', {},
                                        Ui.el('strong', {}, name),
                                        Ui.el('div.leise.klein', {}, satz)))))),

                Ui.el('div.karte', {},
                    Ui.el('div.karte-kopf', {}, Ui.el('h3', {}, 'Arbeitszeit')),
                    Ui.el('div.karte-leib', {},
                        Ui.el('p.leise.klein', {}, 'Sollzeit je Wochentag, in Stunden.'),
                        Ui.el('div.sollraster', {}, TAGE.map(([nr, name]) =>
                            Ui.el('label.soll-tag', {},
                                Ui.el('span', {}, name.slice(0, 2)),
                                Ui.el('input.eingabe', {
                                    type: 'number', step: '0.25', min: '0', max: '14',
                                    value: (Number(e.sollProTag[nr] || 0) / 60).toFixed(2).replace(/\.?0+$/, ''),
                                    onchange: ev => {
                                        Daten.still(d => {
                                            d.einstellungen.sollProTag[nr] = Math.round(Number(ev.target.value || 0) * 60);
                                        });
                                        zeichne();
                                    }
                                })))),

                        Ui.el('div.form-zwei', {},
                            Ui.feld('Pause ab (Std.)', Ui.el('input.eingabe', {
                                type: 'number', step: '0.5', value: (e.pauseAbMinuten / 60),
                                onchange: ev => Daten.still(d => {
                                    d.einstellungen.pauseAbMinuten = Math.round(Number(ev.target.value) * 60);
                                })
                            })),
                            Ui.feld('Pause (Min.)', Ui.el('input.eingabe', {
                                type: 'number', step: '5', value: e.pauseMinuten,
                                onchange: ev => Daten.still(d => {
                                    d.einstellungen.pauseMinuten = Number(ev.target.value);
                                })
                            }))),

                        Ui.el('div.form-zwei', {},
                            Ui.feld('Ferien (Tage/Jahr)', Ui.el('input.eingabe', {
                                type: 'number', value: e.ferienTageProJahr,
                                onchange: ev => { Daten.still(d => {
                                    d.einstellungen.ferienTageProJahr = Number(ev.target.value);
                                }); zeichne(); }
                            })),
                            Ui.feld('Stundensatz', Ui.el('input.eingabe', {
                                type: 'number', value: e.stundensatz,
                                onchange: ev => Daten.still(d => {
                                    d.einstellungen.stundensatz = Number(ev.target.value);
                                })
                            })))))),

            Ui.el('div.karte', {},
                Ui.el('div.karte-kopf', {}, Ui.el('h3', {}, 'Diese Datei')),
                Ui.el('div.karte-leib', {},
                    Ui.feld('Name', Ui.el('input.eingabe', {
                        value: Ablage.name,
                        onchange: ev => { Ablage.name = ev.target.value.trim() || 'Meine Zeit'; zeichne(); }
                    })),
                    Ui.el('p.leise.klein', {},
                        `${(Daten.doc.eintraege || []).length} Einträge · `,
                        `${(Daten.doc.projekte || []).length} Projekte · `,
                        `angelegt ${Hilf.datum(Daten.doc.erstellt.slice(0, 10))}`))));
    }

    /* =================================================================
       Fenster zum Bearbeiten
       ================================================================= */

    function eintragBearbeiten(id) {
        const e = (Daten.doc.eintraege || []).find(x => x.id === id);
        if (!e) return;

        const vonFeld = Ui.el('input.eingabe', { type: 'time', step: 900, value: Hilf.uhrzeit(e.von) });
        const bisFeld = Ui.el('input.eingabe', {
            type: 'time', step: 900, value: Number.isFinite(e.bis) ? Hilf.uhrzeit(e.bis) : ''
        });
        const pauseFeld = Ui.el('input.eingabe', { type: 'number', step: 5, min: 0, value: e.pause || 0 });
        const notizFeld = Ui.el('textarea.eingabe', { rows: 2, value: e.notiz || '' });

        let projektId = e.projektId, taetigkeitId = e.taetigkeitId;

        const f = Ui.fenster({
            titel: 'Zeit bearbeiten',
            unterzeile: `${Hilf.tagLang(e.datum)}, ${Hilf.datum(e.datum)}`,
            inhalt: Ui.el('div', {},
                Ui.el('div.form-zwei', {},
                    Ui.feld('Von', vonFeld),
                    Ui.feld('Bis', bisFeld)),
                Ui.el('div.form-zwei', {},
                    Ui.feld('Pause (Min.)', pauseFeld),
                    Ui.feld('Projekt', Ui.auswahl(Daten.doc.projekte || [], projektId,
                        w => { projektId = w; }, '— Ohne Projekt —'))),
                Ui.feld('Tätigkeit', Ui.auswahl(Daten.doc.taetigkeiten || [], taetigkeitId,
                    w => { taetigkeitId = w; }, '— Keine —')),
                Ui.feld('Notiz', notizFeld)),
            knoepfe: [
                Ui.el('button.knopf.knopf-gefahr-still', {
                    onclick: async () => {
                        f.schliesse();
                        loescheBlock(e.id);
                    }
                }, 'Löschen'),
                Ui.el('span.abstand'),
                Ui.el('button.knopf.knopf-still', { onclick: () => f.schliesse() }, 'Abbrechen'),
                Ui.el('button.knopf.knopf-haupt', {
                    onclick: () => {
                        const von = Hilf.ausUhrzeit(vonFeld.value);
                        const bis = Hilf.ausUhrzeit(bisFeld.value);
                        if (von === null || bis === null) { Ui.meldung('Bitte gültige Zeiten angeben.', 'warnung'); return; }

                        const [a, b] = Fach.rundeSpanne(von, bis);
                        if (Fach.ueberschneidung(e.datum, a, b, e.id)) {
                            Ui.meldung('Das überschneidet sich mit einem anderen Eintrag.', 'warnung');
                            return;
                        }

                        Fach.aendere(e.id, {
                            von: a, bis: b,
                            pause: Number(pauseFeld.value) || 0,
                            projektId, taetigkeitId,
                            notiz: notizFeld.value.trim()
                        });
                        f.schliesse();
                        zeichne();
                    }
                }, 'Speichern')
            ]
        });
    }

    function projektBearbeiten(id) {
        const vorhanden = (Daten.doc.projekte || []).find(p => p.id === id);
        const p = vorhanden || { id: Hilf.id(), name: '', nummer: '', kundeId: null,
                                 farbe: '#7132e3', satz: Daten.doc.einstellungen.stundensatz,
                                 budgetStunden: null, aktiv: true };

        const nameFeld = Ui.el('input.eingabe', { value: p.name, placeholder: 'Sanierung Heizung' });
        const nummerFeld = Ui.el('input.eingabe', { value: p.nummer || '', placeholder: 'P-2401' });
        const farbeFeld = Ui.el('input.eingabe.farbe', { type: 'color', value: p.farbe || '#7132e3' });
        const satzFeld = Ui.el('input.eingabe', { type: 'number', value: p.satz || '' });
        const budgetFeld = Ui.el('input.eingabe', { type: 'number', value: p.budgetStunden || '' });
        let kundeId = p.kundeId;

        const f = Ui.fenster({
            titel: vorhanden ? 'Projekt ändern' : 'Neues Projekt',
            inhalt: Ui.el('div', {},
                Ui.feld('Name', nameFeld),
                Ui.el('div.form-zwei', {},
                    Ui.feld('Nummer', nummerFeld, 'freiwillig'),
                    Ui.feld('Farbe', farbeFeld)),
                Ui.feld('Kunde', Ui.auswahl(Daten.doc.kunden || [], kundeId, w => { kundeId = w; }, '— Ohne Kunde —')),
                Ui.el('div.form-zwei', {},
                    Ui.feld('Stundensatz', satzFeld),
                    Ui.feld('Budget (Std.)', budgetFeld, 'freiwillig'))),
            knoepfe: [
                vorhanden ? Ui.el('button.knopf.knopf-gefahr-still', {
                    onclick: async () => {
                        if (!await Ui.frage('Projekt löschen? Die erfassten Zeiten bleiben, verlieren aber ihr Projekt.')) return;
                        Daten.aendere('Projekt gelöscht', d => {
                            d.projekte = d.projekte.filter(x => x.id !== p.id);
                            d.eintraege.forEach(e => { if (e.projektId === p.id) e.projektId = null; });
                        });
                        f.schliesse(); zeichne();
                    }
                }, 'Löschen') : null,
                Ui.el('span.abstand'),
                Ui.el('button.knopf.knopf-still', { onclick: () => f.schliesse() }, 'Abbrechen'),
                Ui.el('button.knopf.knopf-haupt', {
                    onclick: () => {
                        if (!nameFeld.value.trim()) { Ui.meldung('Ein Name fehlt.', 'warnung'); return; }

                        Daten.aendere(vorhanden ? 'Projekt geändert' : 'Projekt angelegt', d => {
                            const neu = Object.assign({}, p, {
                                name: nameFeld.value.trim(),
                                nummer: nummerFeld.value.trim(),
                                farbe: farbeFeld.value,
                                kundeId,
                                satz: Number(satzFeld.value) || null,
                                budgetStunden: Number(budgetFeld.value) || null
                            });
                            if (vorhanden) Object.assign(vorhanden, neu); else d.projekte.push(neu);
                        });
                        f.schliesse(); zeichne();
                    }
                }, 'Speichern')
            ]
        });
    }

    function kundeBearbeiten(id) {
        const vorhanden = (Daten.doc.kunden || []).find(k => k.id === id);
        const k = vorhanden || { id: Hilf.id(), name: '', ort: '' };

        const nameFeld = Ui.el('input.eingabe', { value: k.name });
        const ortFeld = Ui.el('input.eingabe', { value: k.ort || '' });

        const f = Ui.fenster({
            titel: vorhanden ? 'Kunde ändern' : 'Neuer Kunde',
            inhalt: Ui.el('div', {}, Ui.feld('Name', nameFeld), Ui.feld('Ort', ortFeld, 'freiwillig')),
            knoepfe: [
                Ui.el('span.abstand'),
                Ui.el('button.knopf.knopf-still', { onclick: () => f.schliesse() }, 'Abbrechen'),
                Ui.el('button.knopf.knopf-haupt', {
                    onclick: () => {
                        if (!nameFeld.value.trim()) { Ui.meldung('Ein Name fehlt.', 'warnung'); return; }
                        Daten.aendere(vorhanden ? 'Kunde geändert' : 'Kunde angelegt', d => {
                            const neu = Object.assign({}, k, {
                                name: nameFeld.value.trim(), ort: ortFeld.value.trim()
                            });
                            if (vorhanden) Object.assign(vorhanden, neu); else d.kunden.push(neu);
                        });
                        f.schliesse(); zeichne();
                    }
                }, 'Speichern')
            ]
        });
    }

    function absenzBearbeiten(id) {
        const vorhanden = (Daten.doc.absenzen || []).find(a => a.id === id);
        const a = vorhanden || {
            id: Hilf.id(), typId: (Daten.doc.absenztypen[0] || {}).id,
            von: zustand.datum, bis: zustand.datum,
            vonHalb: false, bisHalb: false, status: 'genehmigt', grund: ''
        };

        const vonFeld = Ui.el('input.eingabe', { type: 'date', value: a.von });
        const bisFeld = Ui.el('input.eingabe', { type: 'date', value: a.bis });
        const grundFeld = Ui.el('input.eingabe', { value: a.grund || '' });
        let typId = a.typId;

        const f = Ui.fenster({
            titel: vorhanden ? 'Absenz ändern' : 'Absenz erfassen',
            inhalt: Ui.el('div', {},
                Ui.feld('Art', Ui.auswahl(Daten.doc.absenztypen || [], typId, w => { typId = w; })),
                Ui.el('div.form-zwei', {}, Ui.feld('Von', vonFeld), Ui.feld('Bis', bisFeld)),
                Ui.feld('Grund', grundFeld, 'freiwillig')),
            knoepfe: [
                vorhanden ? Ui.el('button.knopf.knopf-gefahr-still', {
                    onclick: async () => {
                        if (!await Ui.frage('Absenz löschen?')) return;
                        Daten.aendere('Absenz gelöscht', d => {
                            d.absenzen = d.absenzen.filter(x => x.id !== a.id);
                        });
                        f.schliesse(); zeichne();
                    }
                }, 'Löschen') : null,
                Ui.el('span.abstand'),
                Ui.el('button.knopf.knopf-still', { onclick: () => f.schliesse() }, 'Abbrechen'),
                Ui.el('button.knopf.knopf-haupt', {
                    onclick: () => {
                        const von = vonFeld.value, bis = bisFeld.value;
                        if (!von || !bis || bis < von) { Ui.meldung('Der Zeitraum stimmt nicht.', 'warnung'); return; }

                        Daten.aendere(vorhanden ? 'Absenz geändert' : 'Absenz erfasst', d => {
                            const neu = Object.assign({}, a, { typId, von, bis, grund: grundFeld.value.trim() });
                            if (vorhanden) Object.assign(vorhanden, neu); else d.absenzen.push(neu);
                        });
                        f.schliesse(); zeichne();
                    }
                }, 'Speichern')
            ]
        });
    }

    function aufgabeBearbeiten(id, geplant) {
        const vorhanden = (Daten.doc.aufgaben || []).find(a => a.id === id);
        const a = vorhanden || {
            id: Hilf.id(), titel: '', projektId: null, faellig: '',
            geplant: geplant || '', erledigt: null, aufwand: null
        };

        const titelFeld = Ui.el('input.eingabe', { value: a.titel, placeholder: 'Was ist zu tun?' });
        const faelligFeld = Ui.el('input.eingabe', { type: 'date', value: a.faellig || '' });
        const geplantFeld = Ui.el('input.eingabe', { type: 'date', value: a.geplant || '' });
        let projektId = a.projektId;

        const f = Ui.fenster({
            titel: vorhanden ? 'Aufgabe ändern' : 'Neue Aufgabe',
            inhalt: Ui.el('div', {},
                Ui.feld('Titel', titelFeld),
                Ui.feld('Projekt', Ui.auswahl(Daten.doc.projekte || [], projektId,
                    w => { projektId = w; }, '— Ohne Projekt —')),
                Ui.el('div.form-zwei', {},
                    Ui.feld('Fällig', faelligFeld, 'freiwillig'),
                    Ui.feld('Geplant auf', geplantFeld, 'freiwillig'))),
            knoepfe: [
                vorhanden ? Ui.el('button.knopf.knopf-gefahr-still', {
                    onclick: () => {
                        Daten.aendere('Aufgabe gelöscht', d => {
                            d.aufgaben = d.aufgaben.filter(x => x.id !== a.id);
                        });
                        f.schliesse(); zeichne();
                    }
                }, 'Löschen') : null,
                Ui.el('span.abstand'),
                Ui.el('button.knopf.knopf-still', { onclick: () => f.schliesse() }, 'Abbrechen'),
                Ui.el('button.knopf.knopf-haupt', {
                    onclick: () => {
                        if (!titelFeld.value.trim()) { Ui.meldung('Ein Titel fehlt.', 'warnung'); return; }
                        Daten.aendere(vorhanden ? 'Aufgabe geändert' : 'Aufgabe angelegt', d => {
                            const neu = Object.assign({}, a, {
                                titel: titelFeld.value.trim(), projektId,
                                faellig: faelligFeld.value, geplant: geplantFeld.value
                            });
                            if (vorhanden) Object.assign(vorhanden, neu); else d.aufgaben.push(neu);
                        });
                        f.schliesse(); zeichne();
                    }
                }, 'Speichern')
            ]
        });
    }

    /* =================================================================
       Kontextmenü am Block
       Löschen steht zuoberst: Es ist der häufigste Griff, wenn ein Block
       nicht stimmt — und es lässt sich rückgängig machen.
       ================================================================= */

    function blockMenue(ereignis, eintrag) {
        document.querySelectorAll('.menue, .menue-schleier').forEach(m => m.remove());

        const schliesse = () => document.querySelectorAll('.menue, .menue-schleier').forEach(m => m.remove());

        const punkt = (name, tat, klasse) => Ui.el('button.menue-punkt' + (klasse || ''), {
            onclick: () => { schliesse(); tat(); }
        }, name);

        const menue = Ui.el('div.menue', {
            stil: { left: ereignis.clientX + 'px', top: ereignis.clientY + 'px' }
        },
            Ui.el('div.menue-kopf', {},
                Ui.el('i.punkt', { stil: { background: Fach.projektFarbe(eintrag.projektId) } }),
                Ui.el('div', {},
                    Ui.el('strong', {}, Fach.projektName(eintrag.projektId)),
                    Ui.el('div.leise.klein', {},
                        `${Hilf.uhrzeit(eintrag.von)}–${Number.isFinite(eintrag.bis) ? Hilf.uhrzeit(eintrag.bis) : '…'}`
                        + ` · ${Hilf.dauer(Fach.dauerVon(eintrag))}`))),

            punkt('Löschen', () => loescheBlock(eintrag.id), '.gefahr'),
            Ui.el('div.menue-trenner'),
            punkt('Bearbeiten …', () => eintragBearbeiten(eintrag.id)),
            punkt('Duplizieren', () => {
                const ergebnis = Fach.neuerEintrag({
                    datum: eintrag.datum,
                    von: eintrag.bis, bis: eintrag.bis + (eintrag.bis - eintrag.von),
                    projektId: eintrag.projektId, taetigkeitId: eintrag.taetigkeitId, notiz: eintrag.notiz
                });
                if (ergebnis.fehler) Ui.meldung(ergebnis.fehler, 'warnung');
                zeichne();
            }),
            punkt('Auf morgen kopieren', () => {
                const ergebnis = Fach.neuerEintrag({
                    datum: Hilf.plusTage(eintrag.datum, 1),
                    von: eintrag.von, bis: eintrag.bis,
                    projektId: eintrag.projektId, taetigkeitId: eintrag.taetigkeitId, notiz: eintrag.notiz
                });
                if (ergebnis.fehler) Ui.meldung(ergebnis.fehler, 'warnung');
                zeichne();
            }),

            Ui.el('div.menue-trenner'),
            Ui.el('div.menue-titel', {}, 'Dauer'),
            Ui.el('div.menue-chips', {},
                [30, 60, 90, 120, 240, 480].map(minuten =>
                    Ui.el('button.chip', {
                        onclick: () => {
                            schliesse();
                            const ergebnis = Fach.verschiebe(eintrag.id, eintrag.datum,
                                eintrag.von, eintrag.von + minuten);
                            if (ergebnis.fehler) Ui.meldung(ergebnis.fehler, 'warnung');
                            else Ui.meldung('Dauer auf ' + Hilf.dauer(minuten), 'gut');
                            zeichne();
                        }
                    }, Hilf.dauer(minuten)))),

            Ui.el('div.menue-trenner'),
            Ui.el('div.menue-titel', {}, 'Projekt'),
            Ui.el('div.menue-chips', {},
                (Daten.doc.projekte || []).slice(0, 8).map(p =>
                    Ui.el('button.chip', {
                        stil: { '--farbe': p.farbe },
                        onclick: () => {
                            schliesse();
                            Fach.aendere(eintrag.id, { projektId: p.id }, 'Projekt zugewiesen');
                            zeichne();
                        }
                    }, p.name))));

        const schleier = Ui.el('div.menue-schleier', { onclick: schliesse, oncontextmenu: e => { e.preventDefault(); schliesse(); } });

        document.body.append(schleier, menue);

        // Am Bildrand nach innen schieben.
        const rechteck = menue.getBoundingClientRect();
        if (rechteck.right > innerWidth - 8) menue.style.left = (innerWidth - rechteck.width - 8) + 'px';
        if (rechteck.bottom > innerHeight - 8) menue.style.top = (innerHeight - rechteck.height - 8) + 'px';
    }

    function loescheBlock(id) {
        const eintrag = Fach.loesche(id);
        if (!eintrag) return;

        zeichne();
        Ui.meldung('Eintrag gelöscht', 'info', {
            text: 'Rückgängig',
            tat: () => { Daten.zurueckNehmen(); zeichne(); }
        });
    }

    /* =================================================================
       Datei
       ================================================================= */

    async function speichern() {
        try {
            // Wohin gespeichert wird, hängt an der Betriebsart:
            // Arbeitsordner → die Dateien darin, Mappe → die Mappe, sonst die eigene Datei.
            if (ordner) await ordnerSpeichern();
            else if (mappe) await mappeSpeichern();
            else await Ablage.speichern();
            Ui.meldung('Gespeichert', 'gut');
            zeichne();
        } catch (f) {
            if (f.name !== 'AbortError') Ui.meldung('Nicht gespeichert: ' + f.message, 'warnung');
        }
    }

    function dateiMenue(ereignis) {
        document.querySelectorAll('.menue, .menue-schleier').forEach(m => m.remove());
        const schliesse = () => document.querySelectorAll('.menue, .menue-schleier').forEach(m => m.remove());

        const punkt = (name, tat) => Ui.el('button.menue-punkt', {
            onclick: async () => { schliesse(); await tat(); }
        }, name);

        const menue = Ui.el('div.menue.menue-rechts', {
            stil: { right: '1rem', top: '3.25rem' }
        },
            punkt('Speichern', speichern),
            punkt('Speichern unter …', async () => {
                try { await Ablage.speichernUnter(); Ui.meldung('Gespeichert', 'gut'); zeichne(); }
                catch (f) { if (f.name !== 'AbortError') Ui.meldung(f.message, 'warnung'); }
            }),
            Ui.el('div.menue-trenner'),
            punkt('Datei öffnen …', async () => {
                if (Daten.istGeaendert && !await Ui.frage('Ungespeicherte Änderungen gehen verloren. Trotzdem öffnen?', 'Öffnen')) return;
                try { await Ablage.oeffnen(); }
                catch (f) { if (f.name !== 'AbortError') Ui.meldung(f.message, 'warnung'); }
            }),
            punkt('Neu anfangen', async () => {
                if (Daten.istGeaendert && !await Ui.frage('Ungespeicherte Änderungen gehen verloren. Trotzdem neu?', 'Neu')) return;
                await Ablage.neu('');
            }),
            Ui.el('div.menue-trenner'),
            punkt('Zeiten als CSV', exportCsv),
            punkt('Drucken', () => window.print()));

        const schleier = Ui.el('div.menue-schleier', { onclick: schliesse });
        document.body.append(schleier, menue);
    }

    function zurueck() {
        const was = Daten.zurueckNehmen();
        if (was) Ui.meldung('Zurückgenommen: ' + was, 'info');
        zeichne();
    }

    function wiederholen() {
        const was = Daten.wiederholen();
        if (was) Ui.meldung('Wiederholt: ' + was, 'info');
        zeichne();
    }

    /* =================================================================
       Tasten
       ================================================================= */

    function tasten() {
        document.addEventListener('keydown', e => {
            const imFeld = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault(); speichern(); return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !imFeld) {
                e.preventDefault(); e.shiftKey ? wiederholen() : zurueck(); return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !imFeld) {
                e.preventDefault(); wiederholen(); return;
            }
            /* Strg+P druckt den Rapport — von jeder Seite aus. Sonst
               druckte der Browser die Bildschirmseite mit Seitenleiste
               und Knöpfen, und das ist nie gemeint. Steht man woanders,
               wechselt es zuerst dorthin: Das Blatt ist der Rapport. */
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p' && !imFeld) {
                e.preventDefault();
                if (zustand.seite !== 'rapport') {
                    zustand.seite = 'rapport';
                    zeichne();
                    setTimeout(() => window.print(), 60);   // erst zeichnen, dann drucken
                } else {
                    window.print();
                }
                return;
            }
            if (e.ctrlKey || e.metaKey || e.altKey || imFeld) return;

            const schritt = zustand.spanne >= 5 ? 7 : zustand.spanne;
            if (e.key === 'ArrowLeft')  { zustand.datum = Hilf.plusTage(zustand.datum, -schritt); zeichne(); }
            if (e.key === 'ArrowRight') { zustand.datum = Hilf.plusTage(zustand.datum, schritt); zeichne(); }
            if (e.key === 'h' || e.key === 't') { zustand.datum = Hilf.heute(); zeichne(); }
            if (e.key === 'n') { Fach.starte(zustand.projekt, null, ''); zeichne(); }
        });
    }

    function uhr() {
        if (!Daten.doc) return;
        if (Fach.laufender() && zustand.seite === 'zeit') zeichne();
    }

    function zeigeTag(datum) {
        zustand.datum = datum;
        zustand.spanne = 1;
        zeichne();
    }

    return { start, inMappe, imOrdner, ordnerMoeglich, zeichne, zeigeTag, blockMenue, loescheBlock, zustand };
})();
