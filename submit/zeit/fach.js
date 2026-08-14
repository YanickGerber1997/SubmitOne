/* =====================================================================
   SubZeit — Fachlogik
   ---------------------------------------------------------------------
   Alles, was gerechnet wird, ohne dass eine Oberfläche dabei ist:
   Raster, Feiertage, Soll und Ist, Vorschläge, Ferienkonto.

   Diese Datei kennt keine Elemente und kein CSS. Was hier steht, gilt
   auch dann, wenn die Ansicht morgen anders aussieht.
   ===================================================================== */

'use strict';

const Fach = (function () {

    /* =================================================================
       Gerechnet wird im gemeinsamen Kern
       -----------------------------------------------------------------
       Raster, Feiertage, Soll, Ist, Absenzen und Überschneidungen stehen
       seit dem 14.08.2026 in ../kern/zeitrechnung.js — derselben Datei,
       aus der auch SubmitOne rechnet. Vorher gab es die Regeln zweimal,
       und die Kopie in SubmitOne kannte weder Feiertage noch Absenzen:
       Derselbe Donnerstag zeigte dort 8,50 Stunden Soll und hier 0.

       Was hier bleibt, sind die Aufrufe mit `Daten.doc` — der Kern will
       das Dokument mitgegeben haben, weil er keinen eigenen Zustand hält.
       ================================================================= */

    const Z = (typeof Zeitrechnung !== 'undefined') ? Zeitrechnung
            : (typeof require === 'function' ? require('../kern/zeitrechnung.js') : null);

    const raster       = () => Z.raster(Daten.doc);
    const runde        = m => Z.runde(Daten.doc, m);
    const rundeSpanne  = (von, bis) => Z.rundeSpanne(Daten.doc, von, bis);

    /* ---- Feiertage, Absenzen, Soll und Dauer: alles aus dem Kern ----
       Die Kantonsliste, die Osterformel und die Feiertagstabelle standen
       bis zum 14.08.2026 hier. Sie sind unveraendert nach
       ../kern/zeitrechnung.js gewandert, damit SubmitOne mit denselben
       Tagen rechnet - nicht mit aehnlichen. */

    const KANTONE          = Z.KANTONE;
    const ostern           = Z.ostern;
    const feiertageAlle    = Z.feiertageAlle;
    const feiertage        = jahr => Z.feiertage(Daten.doc, jahr);
    const feiertagAm       = datum => Z.feiertagAm(Daten.doc, datum);
    const vergissFeiertage = Z.vergissFeiertage;
    const soll             = datum => Z.soll(Daten.doc, datum);
    const absenzAm         = datum => Z.absenzAm(Daten.doc, datum);
    const absenzAnteil     = Z.absenzAnteil;
    const dauerVon         = Z.dauer;

    function eintraegeAm(datum) {
        return (Daten.doc.eintraege || [])
            .filter(e => e.datum === datum)
            .sort((a, b) => a.von - b.von);
    }

    /** Alles, was eine Tageszeile braucht - gerechnet im Kern. */
    const tag = datum => Z.tag(Daten.doc, datum, Hilf.heute());

    function zeitraum(von, bis) {
        const tage = [];
        for (let d = von; d <= bis; d = Hilf.plusTage(d, 1)) tage.push(tag(d));

        return {
            tage,
            gearbeitet: tage.reduce((s, t) => s + t.gearbeitet, 0),
            soll: tage.reduce((s, t) => s + t.soll, 0),
            absenzMinuten: tage.reduce((s, t) => s + t.absenzMinuten, 0),
            get differenz() { return this.gearbeitet + this.absenzMinuten - this.soll; }
        };
    }

    /**
     * Gleitzeitsaldo bis und mit dem Datum.
     *
     * Gerechnet wird ab dem ersten Tag, an dem überhaupt etwas erfasst wurde –
     * nicht ab dem 1. Januar. Sonst zeigte eine frisch angelegte Datei im August
     * ein Minus von tausend Stunden für eine Zeit, in der es sie noch gar nicht gab.
     */
    function saldo(bis) {
        const doc = Daten.doc;

        const daten = (doc.eintraege || []).map(e => e.datum)
            .concat((doc.absenzen || []).map(a => a.von));

        if (!daten.length) return 0;

        let start = daten.reduce((a, b) => (a < b ? a : b));

        // Nicht weiter zurück als bis zum Beginn des Arbeitsjahrs.
        const jahresbeginn = `${doc.einstellungen.arbeitsjahr || start.slice(0, 4)}-01-01`;
        if (start < jahresbeginn) start = jahresbeginn;

        if (bis < start) return 0;

        const z = zeitraum(start, bis);
        return z.gearbeitet + z.absenzMinuten - z.soll;
    }

    /* =================================================================
       Ferienkonto
       ================================================================= */

    function ferienkonto(jahr) {
        const doc = Daten.doc;
        const ferienTyp = (doc.absenztypen || []).find(t => t.vomKonto);
        const anspruch = Number(doc.einstellungen.ferienTageProJahr || 0);

        let bezogen = 0, beantragt = 0;

        (doc.absenzen || []).forEach(a => {
            if (!ferienTyp || a.typId !== ferienTyp.id) return;
            if (!a.von.startsWith(String(jahr))) return;

            const tage = arbeitstage(a);
            if (a.status === 'abgelehnt') return;
            if (a.status === 'beantragt') beantragt += tage; else bezogen += tage;
        });

        return { anspruch, bezogen, beantragt, rest: anspruch - bezogen - beantragt };
    }

    /** Arbeitstage einer Absenz – Wochenenden und Feiertage zählen nicht. */
    function arbeitstage(absenz) {
        let tage = 0;
        for (let d = absenz.von; d <= absenz.bis; d = Hilf.plusTage(d, 1)) {
            const wochentagSoll = Number(Daten.doc.einstellungen.sollProTag[Hilf.wochentag(d)] || 0);
            if (wochentagSoll <= 0) continue;
            if (feiertagAm(d)) continue;
            tage += absenzAnteil(absenz, d);
        }
        return tage;
    }

    /* =================================================================
       Vorschläge aus der Vergangenheit
       Gezählt, nicht geschätzt: Jeder Vorschlag kann sagen, worauf er
       beruht – «5× so an einem Montag». Ein Vorschlag ohne Begründung
       wäre bloss ein Rateversuch.
       ================================================================= */

    function vorschlaege(datum) {
        const doc = Daten.doc;
        if (eintraegeAm(datum).length > 0) return [];
        if (soll(datum) <= 0) return [];

        const wochentag = Hilf.wochentag(datum);
        const gruppen = new Map();

        (doc.eintraege || []).forEach(e => {
            if (e.datum >= datum) return;                    // nur Vergangenes
            if (!Number.isFinite(e.bis)) return;
            if (Hilf.wochentag(e.datum) !== wochentag) return;

            const von = runde(e.von), bis = runde(e.bis);
            const schluessel = `${von}|${bis}|${e.projektId || ''}`;

            const treffer = gruppen.get(schluessel) || {
                von, bis, projektId: e.projektId || null,
                taetigkeitId: e.taetigkeitId || null,
                anzahl: 0, zuletzt: ''
            };
            treffer.anzahl++;
            if (e.datum > treffer.zuletzt) treffer.zuletzt = e.datum;
            gruppen.set(schluessel, treffer);
        });

        return Array.from(gruppen.values())
            .filter(v => v.anzahl >= 2)
            .sort((a, b) => b.anzahl - a.anzahl || b.zuletzt.localeCompare(a.zuletzt))
            .slice(0, 4)
            .map(v => Object.assign(v, {
                grund: `${v.anzahl}× so an einem ${Hilf.tagLang(datum)}`,
                projekt: projekt(v.projektId)
            }));
    }

    /** Die meistgenutzten Projekte – für die Leiste neben der Fläche. */
    function haeufigeProjekte(anzahl) {
        const zaehler = new Map();

        (Daten.doc.eintraege || []).forEach(e => {
            if (!e.projektId) return;
            zaehler.set(e.projektId, (zaehler.get(e.projektId) || 0) + 1);
        });

        return (Daten.doc.projekte || [])
            .filter(p => p.aktiv !== false)
            .map(p => ({ projekt: p, anzahl: zaehler.get(p.id) || 0 }))
            .sort((a, b) => b.anzahl - a.anzahl)
            .slice(0, anzahl || 8);
    }

    /** Übliche Arbeitszeiten – bestimmt, welcher Ausschnitt gross dargestellt wird. */
    function uebliches() {
        const eintraege = (Daten.doc.eintraege || []).filter(e => Number.isFinite(e.bis));
        if (eintraege.length < 5) return [7, 19];

        const anfaenge = eintraege.map(e => e.von).sort((a, b) => a - b);
        const enden = eintraege.map(e => e.bis).sort((a, b) => a - b);

        // Nicht das Äusserste nehmen, sondern das zweite Zehntel – ein einziger
        // Nachtdienst soll die Ansicht nicht für immer verziehen.
        const frueh = anfaenge[Math.floor(anfaenge.length * 0.1)];
        const spaet = enden[Math.floor(enden.length * 0.9)];

        return [
            Hilf.klemme(Math.floor(frueh / 60), 0, 14),
            Hilf.klemme(Math.ceil(spaet / 60), 10, 24)
        ];
    }

    /* =================================================================
       Nachschlagen
       ================================================================= */

    function projekt(id) { return (Daten.doc.projekte || []).find(p => p.id === id) || null; }
    function kunde(id) { return (Daten.doc.kunden || []).find(k => k.id === id) || null; }
    function taetigkeit(id) { return (Daten.doc.taetigkeiten || []).find(t => t.id === id) || null; }
    function absenztyp(id) { return (Daten.doc.absenztypen || []).find(t => t.id === id) || null; }

    /* Dieselbe Reihe wie in uebersetzer.js und mappe.js — damit dasselbe
       Bauvorhaben in jedem Programm dieselbe Farbe trägt. */
    const PROJEKTFARBEN = ['#7132e3', '#0ea5e9', '#0f7a4a', '#c8871f', '#c02626',
                           '#8455f0', '#1d5fbf', '#0d9488', '#a16207', '#9333ea'];

    /** Aus einer Kennung eine feste Farbe. Gleiche Kennung, gleiche Farbe —
        immer, überall, unabhängig von der Reihenfolge in irgendeiner Liste. */
    function farbeAusId(id) {
        const s = String(id || '');
        let h = 0;
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return PROJEKTFARBEN[h % PROJEKTFARBEN.length];
    }

    /* Ein Eintrag ohne Projekt ist grau — das ist eine Aussage. Ein
       Eintrag MIT Projekt darf nie grau sein, auch wenn das Projekt
       gerade nicht geladen ist: Am 14.08.2026 sahen alle Blöcke gleich
       aus, weil SubZeit ohne offenen Arbeitsordner keine Projektliste
       hat — die Kennung stand da, das Bauvorhaben nicht. Die Farbe hängt
       deshalb an der Kennung und nicht daran, ob gerade jemand die Liste
       geladen hat. */
    function projektFarbe(id) {
        const p = projekt(id);
        if (p && p.farbe) return p.farbe;
        return id ? farbeAusId(id) : '#94a3b8';
    }

    /* «Ohne Projekt» nur, wenn wirklich keines zugewiesen ist. Steht eine
       Kennung da, ist das Bauvorhaben bloss nicht geladen — dann sagt das
       Blatt genau das, statt eine Zuordnung zu leugnen, die es gibt. */
    function projektName(id) {
        const p = projekt(id);
        if (p) return p.name;
        return id ? 'Projekt nicht geladen' : 'Ohne Projekt';
    }

    /* =================================================================
       Ändern — jede Schreiboperation an einer Stelle
       ================================================================= */

    /** Prüft, ob sich eine Spanne mit einem bestehenden Eintrag beisst. */
    const ueberschneidung = (datum, von, bis, ausser) => Z.ueberschneidung(Daten.doc, datum, von, bis, ausser);

    function neuerEintrag({ datum, von, bis, projektId, taetigkeitId, aufgabeId, notiz }) {
        const [a, b] = rundeSpanne(von, bis);

        if (ueberschneidung(datum, a, b)) {
            return { fehler: 'Hier steht schon ein Eintrag.' };
        }

        const eintrag = {
            id: Hilf.id(),
            datum,
            von: a,
            bis: b,
            pause: pausenvorschlag(b - a),
            projektId: projektId || null,
            taetigkeitId: taetigkeitId || null,
            aufgabeId: aufgabeId || null,
            notiz: notiz || '',
            status: 'entwurf'
        };

        Daten.aendere('Zeit erfasst', d => d.eintraege.push(eintrag));
        return { eintrag };
    }

    function pausenvorschlag(dauerMinuten) {
        const e = Daten.doc.einstellungen;
        return dauerMinuten > (e.pauseAbMinuten || 330) ? (e.pauseMinuten || 30) : 0;
    }

    function verschiebe(id, datum, von, bis) {
        const eintrag = (Daten.doc.eintraege || []).find(e => e.id === id);
        if (!eintrag) return { fehler: 'Der Eintrag ist weg.' };
        if (istGesperrt(eintrag)) return { fehler: 'Genehmigt oder verrechnet — nicht mehr änderbar.' };

        const [a, b] = rundeSpanne(von, bis);
        if (ueberschneidung(datum, a, b, id)) return { fehler: 'Dort steht schon etwas.' };

        Daten.aendere('Zeit verschoben', () => {
            eintrag.datum = datum;
            eintrag.von = a;
            eintrag.bis = b;
        });
        return { eintrag };
    }

    function aendere(id, werte, beschriftung) {
        const eintrag = (Daten.doc.eintraege || []).find(e => e.id === id);
        if (!eintrag) return { fehler: 'Der Eintrag ist weg.' };
        if (istGesperrt(eintrag)) return { fehler: 'Genehmigt oder verrechnet — nicht mehr änderbar.' };

        Daten.aendere(beschriftung || 'Eintrag geändert', () => Object.assign(eintrag, werte));
        return { eintrag };
    }

    function loesche(id) {
        const eintrag = (Daten.doc.eintraege || []).find(e => e.id === id);
        if (!eintrag) return null;
        if (istGesperrt(eintrag)) return { gesperrt: true };

        Daten.aendere('Eintrag gelöscht', d => {
            d.eintraege = d.eintraege.filter(e => e.id !== id);
        });
        return eintrag;
    }

    /* ---- Stempeluhr ---- */

    function laufender() {
        return (Daten.doc.eintraege || []).find(e => !Number.isFinite(e.bis)) || null;
    }

    function starte(projektId, taetigkeitId, notiz) {
        const jetzt = new Date();
        const minuten = runde(jetzt.getHours() * 60 + jetzt.getMinutes());

        const laeuft = laufender();
        if (laeuft) stoppe();

        const eintrag = {
            id: Hilf.id(),
            datum: Hilf.heute(),
            von: minuten,
            bis: null,
            pause: 0,
            projektId: projektId || null,
            taetigkeitId: taetigkeitId || null,
            notiz: notiz || '',
            status: 'entwurf'
        };

        Daten.aendere('Stempeluhr gestartet', d => d.eintraege.push(eintrag));
        return eintrag;
    }

    function stoppe() {
        const eintrag = laufender();
        if (!eintrag) return { fehler: 'Es läuft keine Stempeluhr.' };

        const jetzt = new Date();
        const [von, bis] = rundeSpanne(eintrag.von, jetzt.getHours() * 60 + jetzt.getMinutes());

        Daten.aendere('Stempeluhr gestoppt', () => {
            eintrag.von = von;
            eintrag.bis = bis;
            eintrag.pause = pausenvorschlag(bis - von);
        });
        return { eintrag };
    }

    function verwerfe() {
        const eintrag = laufender();
        if (!eintrag) return false;
        Daten.aendere('Stempeluhr verworfen', d => {
            d.eintraege = d.eintraege.filter(e => e.id !== eintrag.id);
        });
        return true;
    }

    /* ---- Schnellerfassung ----
       «8-12 Sanierung Heizung Notiz» – eine Zeile, ein Eintrag. Wer lieber
       tippt als zieht, soll nicht durch einen Dialog müssen. */

    function ausZeile(datum, zeile) {
        const text = String(zeile).trim();
        if (!text) return { fehler: 'Nichts eingegeben.' };

        // Erst die Zeitangabe: «8-12», «8:15-11:45», «90m», «1.5h»
        let von = null, bis = null, rest = text;

        const spanne = /^(\d{1,2}(?:[:.]\d{2})?)\s*[-–]\s*(\d{1,2}(?:[:.]\d{2})?)\s*(.*)$/.exec(text);
        const dauerAngabe = /^(\d+(?:[.,]\d+)?)\s*(h|std|m|min)\s+(.*)$/i.exec(text);

        if (spanne) {
            von = Hilf.ausUhrzeit(spanne[1]);
            bis = Hilf.ausUhrzeit(spanne[2]);
            rest = spanne[3];
        } else if (dauerAngabe) {
            const menge = Number(dauerAngabe[1].replace(',', '.'));
            const minuten = /^h|std/i.test(dauerAngabe[2]) ? menge * 60 : menge;
            const letzter = eintraegeAm(datum).slice(-1)[0];
            von = letzter && Number.isFinite(letzter.bis) ? letzter.bis : 8 * 60;
            bis = von + minuten;
            rest = dauerAngabe[3];
        } else {
            return { fehler: 'Bitte eine Zeit angeben, etwa «8-12 Projektname».' };
        }

        if (von === null || bis === null) return { fehler: 'Die Zeitangabe ist unklar.' };

        // Dann das Projekt: das erste, dessen Name im Rest vorkommt.
        let projektId = null, notiz = rest.trim();

        const treffer = (Daten.doc.projekte || [])
            .filter(p => p.aktiv !== false)
            .map(p => ({ p, stelle: notiz.toLowerCase().indexOf(p.name.toLowerCase().slice(0, 12)) }))
            .filter(x => x.stelle >= 0 && p_hatNamen(x.p))
            .sort((a, b) => b.p.name.length - a.p.name.length)[0];

        if (treffer) {
            projektId = treffer.p.id;
            const teil = treffer.p.name.slice(0, 12);
            const i = notiz.toLowerCase().indexOf(teil.toLowerCase());
            notiz = (notiz.slice(0, i) + notiz.slice(i + teil.length)).replace(/\s+/g, ' ').trim();
        }

        return neuerEintrag({ datum, von, bis, projektId, notiz });
    }

    function p_hatNamen(p) { return p.name && p.name.length >= 3; }

    /* ---- Woche übernehmen ---- */

    function uebernimmWoche(zielMontag) {
        const quelle = Hilf.plusTage(zielMontag, -7);
        let angelegt = 0;

        Daten.aendere('Vorwoche übernommen', d => {
            for (let i = 0; i < 7; i++) {
                const vonTag = Hilf.plusTage(quelle, i);
                const nachTag = Hilf.plusTage(zielMontag, i);
                if (eintraegeAm(nachTag).length > 0) continue;

                eintraegeAm(vonTag).forEach(e => {
                    if (!Number.isFinite(e.bis)) return;
                    d.eintraege.push(Object.assign({}, e, {
                        id: Hilf.id(), datum: nachTag, status: 'entwurf'
                    }));
                    angelegt++;
                });
            }
        });

        return angelegt;
    }

    /* =================================================================
       Freigaben
       ---------------------------------------------------------------
       Nur auf der Stufe «Firma» sichtbar. Ein genehmigter oder bereits
       verrechneter Eintrag ist gesperrt – sonst verschöbe sich hinterher
       eine Zahl, die längst auf einer Rechnung steht.
       ================================================================= */

    function istGesperrt(eintrag) {
        return eintrag.status === 'genehmigt' || !!eintrag.rechnungId;
    }

    function reicheEin(von, bis) {
        const betroffen = (Daten.doc.eintraege || []).filter(e =>
            e.datum >= von && e.datum <= bis
            && Number.isFinite(e.bis)
            && (e.status || 'entwurf') === 'entwurf');

        if (!betroffen.length) return { fehler: 'Keine offenen Einträge in diesem Zeitraum.' };

        Daten.aendere('Zeiten eingereicht', () => {
            betroffen.forEach(e => { e.status = 'eingereicht'; });
        });
        return { anzahl: betroffen.length };
    }

    function entscheide(ids, genehmigen, kommentar) {
        const menge = new Set(ids);
        let anzahl = 0;

        Daten.aendere(genehmigen ? 'Zeiten genehmigt' : 'Zeiten abgelehnt', d => {
            d.eintraege.forEach(e => {
                if (!menge.has(e.id)) return;
                if (e.rechnungId) return;             // verrechnet bleibt verrechnet
                e.status = genehmigen ? 'genehmigt' : 'abgelehnt';
                e.entschiedenAm = Hilf.heute();
                if (kommentar) e.kommentar = kommentar;
                anzahl++;
            });
        });
        return anzahl;
    }

    function eingereichte() {
        return (Daten.doc.eintraege || [])
            .filter(e => e.status === 'eingereicht')
            .sort((a, b) => a.datum.localeCompare(b.datum) || a.von - b.von);
    }

    /* =================================================================
       Rechnungen
       ---------------------------------------------------------------
       Eine Rechnung entsteht aus erfassten Stunden, nicht aus einem
       leeren Formular. Was einmal auf einer Rechnung steht, wird im
       Eintrag vermerkt – dadurch kann dieselbe Stunde nie zweimal
       verrechnet werden.
       ================================================================= */

    function verrechenbar(eintrag) {
        if (!Number.isFinite(eintrag.bis)) return false;
        if (eintrag.rechnungId) return false;
        if (eintrag.status === 'abgelehnt') return false;

        const p = projekt(eintrag.projektId);
        if (!p || p.verrechenbar === false) return false;

        const t = taetigkeit(eintrag.taetigkeitId);
        // Nicht verrechenbar gewinnt: Interne Arbeit soll nie versehentlich
        // auf einer Rechnung landen.
        return !t || t.verrechenbar !== false;
    }

    function offeneStunden(kundeId, von, bis) {
        return (Daten.doc.eintraege || []).filter(e => {
            if (e.datum < von || e.datum > bis) return false;
            if (!verrechenbar(e)) return false;
            const p = projekt(e.projektId);
            return p && p.kundeId === kundeId;
        });
    }

    function naechsteNummer() {
        const jahr = new Date().getFullYear();
        const bisher = (Daten.doc.rechnungen || [])
            .map(r => Number(String(r.nummer || '').split('-')[1] || 0))
            .filter(Number.isFinite);

        return `${jahr}-${String(Math.max(0, ...bisher) + 1).padStart(3, '0')}`;
    }

    function satzFuer(eintrag) {
        const p = projekt(eintrag.projektId);
        return (p && p.satz) || Daten.doc.einstellungen.stundensatz || 0;
    }

    /** Baut aus den offenen Stunden eines Kunden eine Rechnung im Entwurf. */
    function rechnungAus(kundeId, von, bis) {
        const eintraege = offeneStunden(kundeId, von, bis);
        if (!eintraege.length) return { fehler: 'Keine offenen Stunden in diesem Zeitraum.' };

        // Je Projekt und Tätigkeit eine Position – das ist die Gliederung,
        // die ein Kunde erwartet.
        const gruppen = new Map();

        eintraege.forEach(e => {
            const schluessel = `${e.projektId || ''}|${e.taetigkeitId || ''}`;
            const gruppe = gruppen.get(schluessel) || {
                projektId: e.projektId, taetigkeitId: e.taetigkeitId,
                minuten: 0, satz: satzFuer(e)
            };
            gruppe.minuten += dauerVon(e);
            gruppen.set(schluessel, gruppe);
        });

        const rechnung = {
            id: Hilf.id(),
            nummer: naechsteNummer(),
            kundeId,
            datum: Hilf.heute(),
            faellig: Hilf.plusTage(Hilf.heute(), 30),
            von, bis,
            status: 'entwurf',
            gestelltAm: null,
            bezahltAm: null,
            mwstSatz: 8.1,
            positionen: Array.from(gruppen.values()).map(g => ({
                beschreibung: projektName(g.projektId)
                    + (g.taetigkeitId ? ' · ' + ((taetigkeit(g.taetigkeitId) || {}).name || '') : ''),
                menge: Math.round(Hilf.stunden(g.minuten) * 100) / 100,
                einheit: 'Std.',
                preis: g.satz,
                projektId: g.projektId
            }))
        };

        Daten.aendere('Rechnung erstellt', d => {
            d.rechnungen.push(rechnung);
            eintraege.forEach(e => {
                const eigen = d.eintraege.find(x => x.id === e.id);
                if (eigen) eigen.rechnungId = rechnung.id;
            });
        });

        return { rechnung };
    }

    function rechnungSumme(rechnung) {
        const netto = (rechnung.positionen || [])
            .reduce((s, p) => s + (Number(p.menge) || 0) * (Number(p.preis) || 0), 0);
        const mwst = netto * (Number(rechnung.mwstSatz) || 0) / 100;
        return { netto, mwst, brutto: netto + mwst };
    }

    function rechnungStatus(id, status) {
        const r = (Daten.doc.rechnungen || []).find(x => x.id === id);
        if (!r) return;

        Daten.aendere('Rechnung ' + status, d => {
            r.status = status;
            if (status === 'gestellt') r.gestelltAm = Hilf.heute();
            if (status === 'bezahlt') { r.bezahltAm = Hilf.heute(); if (!r.gestelltAm) r.gestelltAm = Hilf.heute(); }

            if (status === 'storniert') {
                // Die Stunden werden wieder frei – sonst wären sie für immer weg.
                d.eintraege.forEach(e => { if (e.rechnungId === id) e.rechnungId = null; });
            }
        });
    }

    function rechnungLoeschen(id) {
        Daten.aendere('Rechnung gelöscht', d => {
            d.rechnungen = d.rechnungen.filter(r => r.id !== id);
            d.eintraege.forEach(e => { if (e.rechnungId === id) e.rechnungId = null; });
        });
    }

    /**
     * Das Monatsraster: je Projekt eine Zeile, je Monat ein Feld. Auf einen
     * Blick sichtbar, wo etwas offen ist – ohne eine einzige Zahl zu lesen.
     */
    function fakturaraster(monate) {
        const heute = Hilf.heute();
        const spalten = [];

        for (let i = monate - 1; i >= 0; i--) {
            const d = Hilf.alsDatum(heute);
            d.setMonth(d.getMonth() - i, 1);
            spalten.push(Hilf.alsText(d).slice(0, 7));
        }

        const zeilen = (Daten.doc.projekte || [])
            .filter(p => p.aktiv !== false)
            .map(p => ({
                projekt: p,
                felder: spalten.map(monat => {
                    const eintraege = (Daten.doc.eintraege || [])
                        .filter(e => e.projektId === p.id && e.datum.startsWith(monat)
                                     && Number.isFinite(e.bis));

                    if (!eintraege.length) return { monat, zustand: 'nichts', minuten: 0 };

                    const minuten = eintraege.reduce((s, e) => s + dauerVon(e), 0);

                    if (p.verrechenbar === false) return { monat, zustand: 'intern', minuten };

                    const rechnungen = eintraege
                        .map(e => e.rechnungId)
                        .filter(Boolean)
                        .map(id => (Daten.doc.rechnungen || []).find(r => r.id === id))
                        .filter(Boolean);

                    if (!rechnungen.length) return { monat, zustand: 'offen', minuten };

                    if (rechnungen.every(r => r.status === 'bezahlt'))
                        return { monat, zustand: 'bezahlt', minuten, rechnung: rechnungen[0] };

                    if (rechnungen.some(r => r.status === 'gestellt')) {
                        const faellig = rechnungen.find(r => r.status === 'gestellt');
                        const ueberfaellig = faellig && faellig.faellig < heute;
                        return {
                            monat, zustand: ueberfaellig ? 'ueberfaellig' : 'gestellt',
                            minuten, rechnung: faellig
                        };
                    }

                    return { monat, zustand: 'entwurf', minuten, rechnung: rechnungen[0] };
                })
            }));

        return { spalten, zeilen };
    }

    return {
        KANTONE,
        istGesperrt, reicheEin, entscheide, eingereichte,
        verrechenbar, offeneStunden, naechsteNummer, rechnungAus,
        rechnungSumme, rechnungStatus, rechnungLoeschen, fakturaraster,
        raster, runde, rundeSpanne,
        feiertageAlle, feiertage, feiertagAm, vergissFeiertage,
        soll, tag, zeitraum, saldo, dauerVon, eintraegeAm,
        absenzAm, absenzAnteil, arbeitstage, ferienkonto,
        vorschlaege, haeufigeProjekte, uebliches,
        projekt, kunde, taetigkeit, absenztyp, projektFarbe, projektName, farbeAusId,
        ueberschneidung, neuerEintrag, verschiebe, aendere, loesche,
        laufender, starte, stoppe, verwerfe, ausZeile, uebernimmWoche,
        pausenvorschlag
    };
})();
