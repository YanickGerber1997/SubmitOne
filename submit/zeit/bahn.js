/* =====================================================================
   Submit Time — die Zeitbahn
   ---------------------------------------------------------------------
   Die Fläche, auf der Zeit gezogen statt getippt wird.

   Bis zum 14.08.2026 stand hier alles: Achse, Geometrie, Zieh-Mechanik,
   Zeichnen — 502 Zeilen, von denen SubmitOne kein Wort hatte, obwohl es
   dasselbe konnte. Wer eine Kante verschob, verschob sie in einem
   Programm.

   Seither steht das WIE in submit/kern/wochenraster.js, gemeinsam mit
   SubmitOne. Hier steht nur noch das WAS: welche Blöcke, welche Farben,
   welcher Kopf — und was geschehen soll, wenn jemand zieht.

   Die beiden Entscheidungen, die SubZeit prägen, sind dabei geblieben:

   1. Der ganze Tag ist zu sehen, ohne zu rollen. Das Raster kann das mit
      `achse: 'gestaucht'` — Arbeitsfenster im vollen Massstab, Nacht und
      Abend zusammengedrückt.

   2. Das Ziehen läuft vollständig im Browser. Erst beim Loslassen wird
      etwas geändert — sonst würde jede Zeigerbewegung das Dokument
      anfassen. Das Raster ruft dafür `beiNeu` und `beiGeaendert`.

   Alle Zeiten sind Minuten seit Mitternacht.
   ===================================================================== */

'use strict';

const Bahn = (function () {

    const R = (typeof Wochenraster !== 'undefined') ? Wochenraster
            : (typeof require === 'function' ? require('../kern/wochenraster.js') : null);

    let wurzel = null;            // das Element, in das gezeichnet wird
    let tage = [];                // dargestellte Daten
    let beiAenderung = null;      // Rückruf nach jeder Änderung
    let beiOeffnen = null;        // Auswahl eines Blocks
    let gewaehltesProjekt = null;

    const melde = () => { if (beiAenderung) beiAenderung(); };

    /* Was gerade auf der Fläche liegt — nach Kennung, damit die Rückrufe
       vom Raster (die nur eine Kennung mitbringen) wieder zum Eintrag
       finden. Vorschläge stehen mit `v:` davor und sind keine Einträge. */
    let liegt = new Map();


    /* =================================================================
       Was gezeichnet wird
       ================================================================= */

    function bloecke() {
        const aus = [];
        liegt = new Map();

        tage.forEach(datum => {
            const zeile = Fach.tag(datum);

            zeile.eintraege.forEach(e => {
                const laeuft = !Number.isFinite(e.bis);
                liegt.set(String(e.id), e);
                const t = Fach.taetigkeit(e.taetigkeitId);
                aus.push({
                    id: String(e.id),
                    datum,
                    von: e.von,
                    bis: laeuft ? undefined : e.bis,
                    farbe: Fach.projektFarbe(e.projektId),
                    /* Was der Block aus Platzgründen abschneidet, steht
                       im Titel — dann geht beim Zeigen nichts verloren. */
                    titelVoll: [Fach.projektName(e.projektId),
                                `${Hilf.uhrzeit(e.von)}–${laeuft ? '…' : Hilf.uhrzeit(e.bis)}`,
                                t ? t.name : '', e.notiz || ''].filter(Boolean).join(' · '),
                    eintrag: e
                });
            });

            /* Vorschläge: sichtbar, aber durchlässig. Ein Klick übernimmt
               sie, ein Zug darüber legt eigene Zeit an — deshalb dürfen
               sie den Zeiger nicht abfangen. */
            if (!zeile.feiertag && !zeile.absenz) {
                Fach.vorschlaege(datum).forEach((v, i) => {
                    aus.push({
                        id: 'v:' + datum + ':' + i,
                        datum, von: v.von, bis: v.bis,
                        klasse: 'vorschlag', durchlaessig: true,
                        farbe: Fach.projektFarbe(v.projektId),
                        vorschlag: v,
                        titelVoll: `${Fach.projektName(v.projektId)} · ${v.grund} — anklicken zum Übernehmen`
                    });
                });
            }
        });
        return aus;
    }

    /** Der Inhalt eines Blocks — hier weiss SubZeit, was ein Block ist. */
    function blockInhalt(b) {
        const woche = tage.length > 1;

        if (b.vorschlag) {
            return Ui.el('div.wr-block-inhalt', {},
                Ui.el('span.wr-block-titel', {}, '+ ' + Fach.projektName(b.vorschlag.projektId)),
                woche ? null : Ui.el('span.wr-block-unter', {}, b.vorschlag.grund));
        }

        const e = b.eintrag;
        const laeuft = !Number.isFinite(e.bis);
        const taetigkeit = Fach.taetigkeit(e.taetigkeitId);

        /* Alles Wesentliche steht sofort da: Projekt, Tätigkeit, Notiz.
           Bis zum 14.08.2026 zeigte die Woche nur den Projektnamen und
           der Tag die Notiz erst, wenn eine da war — wer wissen wollte,
           was er getan hat, musste jeden Block anklicken. Ein Wochenplan,
           den man aufklappen muss, um ihn zu lesen, ist keiner.

           Ist der Block zu niedrig, schneidet `overflow:hidden` die
           unterste Zeile ab. Das ist richtig so: Die wichtigste Angabe
           steht oben, und wer mehr sehen will, zieht den Block auf. */
        const unten = [
            taetigkeit ? taetigkeit.name : '',
            e.notiz || '',
            e.pause ? `${e.pause}′ Pause` : ''
        ].filter(Boolean).join(' · ');

        /* Die Klassen des Rasters, nicht die eigenen: Die Schrift auf
           einem Block ist weiss, und das steht in wochenraster.css. */
        return Ui.el('div.wr-block-inhalt', {},
            Ui.el('span.wr-block-titel', {},
                Fach.projektName(e.projektId) === 'Ohne Projekt' && !e.projektId
                    ? 'Projekt zuweisen' : Fach.projektName(e.projektId)),
            Ui.el('span.wr-block-zeit', {},
                `${Hilf.uhrzeit(e.von)}–${laeuft ? '…' : Hilf.uhrzeit(e.bis)} · ${Hilf.dauer(Fach.dauerVon(e))}`),
            unten ? Ui.el('span.wr-block-unter', {}, unten) : null,
            woche ? null : Ui.el('button.wr-block-weg', {
                type: 'button', title: 'Löschen',
                onclick: ev => { ev.stopPropagation(); App.loescheBlock(e.id); }
            }, '×'));
    }

    /** Der Tageskopf: Name, Datum und was an dem Tag zusammenkam. */
    function kopf(datum) {
        const zeile = Fach.tag(datum);
        const woche = tage.length > 1;

        return Ui.el('div.bahn-kopf-inhalt', {
            title: `${Hilf.tagLang(datum)}, ${Hilf.datum(datum)} · KW ${Hilf.kw(datum)}`
        },
            Ui.el('span.bahn-kopf-tag', {},
                Ui.el('span.bahn-kopf-name', {}, tage.length > 5 ? Hilf.tagKurz(datum) : Hilf.tagLang(datum)),
                Ui.el('span.bahn-kopf-datum', {}, woche ? Hilf.datumKurz(datum) : Hilf.datum(datum))),
            Ui.el('span.bahn-kopf-zahlen', {},
                Ui.el('span.bahn-kopf-summe', {}, Hilf.dauer(zeile.gearbeitet)),
                (zeile.soll > 0 || zeile.gearbeitet > 0)
                    ? Ui.el('span.bahn-kopf-differenz.' + (zeile.differenz >= 0 ? 'gut' : 'fehlt'), {},
                        Hilf.mitVorzeichen(zeile.differenz))
                    : null));
    }

    /** Feiertag und Absenz legen sich über den ganzen Arbeitstag. */
    function hintergrund(datum) {
        const zeile = Fach.tag(datum);
        const [von, bis] = Fach.uebliches();

        if (zeile.feiertag) {
            return [{
                von: von * 60, bis: bis * 60, klasse: 'tag', farbe: '#9a6206',
                titel: zeile.feiertag.name + (zeile.feiertag.halb ? ' (halb)' : '')
            }];
        }
        if (zeile.absenz) {
            const typ = Fach.absenztyp(zeile.absenz.typId);
            return [{
                von: von * 60, bis: bis * 60, klasse: 'tag',
                farbe: (typ && typ.farbe) || '#0ea5e9',
                titel: typ ? typ.name : 'Absenz'
            }];
        }
        return [];
    }

    function leer(datum) {
        if (tage.length > 1) return null;
        const zeile = Fach.tag(datum);
        if (zeile.feiertag || zeile.absenz) return null;
        return Ui.el('div', {},
            Ui.el('div.bahn-leer-gross', {}, 'Zeit aufziehen'),
            Ui.el('div.bahn-leer-klein', {}, 'Mit gedrückter Maustaste über die Fläche ziehen — das genügt.'));
    }


    /* =================================================================
       Was bei einer Handlung geschieht
       ================================================================= */

    function neu(datum, von, bis) {
        const ergebnis = Fach.neuerEintrag({ datum, von, bis, projektId: gewaehltesProjekt });
        if (ergebnis.fehler) Ui.meldung(ergebnis.fehler, 'warnung');
        else Ui.meldung(`${Hilf.dauer(bis - von)} erfasst`, 'gut');
        melde();
    }

    function geaendert(id, datum, von, bis) {
        if (String(id).startsWith('v:')) return;      // ein Vorschlag zieht nicht
        const ergebnis = Fach.verschiebe(id, datum, von, bis);
        if (ergebnis.fehler) Ui.meldung(ergebnis.fehler, 'warnung');
        melde();
    }

    /** Klick auf leere Fläche: Deckt dort ein Vorschlag, wird er wahr. */
    function tagKlick(datum, minute) {
        const treffer = Fach.vorschlaege(datum)
            .find(v => minute >= v.von && minute <= v.bis);
        if (!treffer) return;

        const ergebnis = Fach.neuerEintrag({
            datum, von: treffer.von, bis: treffer.bis,
            projektId: treffer.projektId, taetigkeitId: treffer.taetigkeitId
        });
        if (ergebnis.fehler) Ui.meldung(ergebnis.fehler, 'warnung');
        else Ui.meldung('Vorschlag übernommen', 'gut');
        melde();
    }

    function klick(id) {
        if (String(id).startsWith('v:')) return;
        if (beiOeffnen) beiOeffnen(id);
    }

    function menue(id, ereignis) {
        const e = liegt.get(String(id));
        if (e) App.blockMenue(ereignis, e);
    }


    /* =================================================================
       Zeichnen
       ================================================================= */

    function zeichne() {
        if (!wurzel || !R) return;

        const [von, bis] = Fach.uebliches();
        const jetzt = new Date();

        R.zeichne(wurzel, {
            tage,
            /* Dasselbe Raster wie in SubmitOne: gleichmässige Stunden im
               Arbeitsfenster, dazu ein Rollbalken, wenn es nicht aufgeht.
               SubZeit hatte hier bis zum 14.08.2026 eine gestauchte Achse,
               die den ganzen Tag auf eine Fläche brachte. Das Raster kann
               das weiterhin (`achse: 'gestaucht'`) — aber die ruhige,
               gleichmässige Teilung liest sich besser, und beide
               Programme sollen sich gleich anfühlen. */
            achse: 'linear',
            vonStunde: von,
            bisStunde: bis,
            hoeheProStunde: 44,
            raster: Fach.raster(),
            heute: Hilf.heute(),
            jetzt: jetzt.getHours() * 60 + jetzt.getMinutes(),

            bloecke: bloecke(),
            blockInhalt,
            kopf,
            hintergrund,
            leer,

            beiNeu: neu,
            beiGeaendert: geaendert,
            beiKlick: klick,
            beiMenu: menue,
            beiTagKlick: tagKlick,
            beiKopfKlick: datum => App.zeigeTag(datum)
        });

        /* Den Wochenendton trägt SubZeit selbst nach: Das Raster kennt
           keine Schweizer Arbeitswoche, und soll sie auch nicht kennen. */
        tage.forEach((datum, i) => {
            const sp = wurzel.querySelectorAll('.wr-spalte')[i];
            if (sp && Fach.tag(datum).istWochenende) sp.classList.add('wochenende');
        });
    }


    /* =================================================================
       Nach aussen — unverändert, damit app.js nichts merkt
       ================================================================= */

    return {
        /** Hängt die Bahn in ein Element und zeichnet sie. */
        setze(element, daten, optionen) {
            wurzel = element;
            tage = daten;
            beiAenderung = (optionen || {}).beiAenderung || null;
            beiOeffnen = (optionen || {}).beiOeffnen || null;
            zeichne();
        },

        zeichne,

        set projekt(id) { gewaehltesProjekt = id; },
        get projekt() { return gewaehltesProjekt; }
    };
})();
