/* =====================================================================
   Submit — Zeitrechnung
   ---------------------------------------------------------------------
   Die Regeln, nach denen Arbeitszeit gerechnet wird: Raster, Feiertage,
   Soll und Ist, Absenzen, Überschneidungen. Ohne Oberfläche, ohne
   globalen Zustand — jede Funktion bekommt das Dokument mitgegeben.

   Warum es diese Datei gibt
   -------------------------
   Bis zum 14.08.2026 stand dieselbe Rechnung zweimal da: in SubZeit
   (fach.js) vollständig, in SubmitOne als vereinfachte Kopie. Die Kopie
   kannte weder Feiertage noch Absenzen noch das Viertelstundenraster.
   Derselbe Donnerstag zeigte in einem Programm 8,50 Stunden Soll und im
   anderen 0 — und niemand konnte sagen, welches recht hatte.

   Jetzt rechnen beide mit diesem Modul. Was hier steht, gilt überall,
   und eine Korrektur wirkt in beiden Programmen.

   Zeiten sind Minuten ab Mitternacht, Daten sind Zeichenketten der Form
   JJJJ-MM-TT — dieselbe Darstellung wie in der Datei.
   ===================================================================== */

(function (global) {

    'use strict';

    /* ---- Kleine Datumshelfer, damit das Modul für sich steht ---- */

    const alsText = d => d.getFullYear() + '-'
        + String(d.getMonth() + 1).padStart(2, '0') + '-'
        + String(d.getDate()).padStart(2, '0');

    /** Wochentag als Zahl, 0 = Sonntag — wie Date.getDay(). */
    const wochentag = iso => new Date(iso + 'T12:00:00').getDay();
    const istWochenende = iso => { const t = wochentag(iso); return t === 0 || t === 6; };

    /* =================================================================
       Das Raster
       Auf die Minute genau rechnet hier niemand. Gerundet wird zur
       nächsten Marke, nicht immer aufwärts – 11:52 ist 11:45.
       ================================================================= */

    const raster = doc => Number((doc && doc.einstellungen && doc.einstellungen.raster)) || 15;

    function runde(doc, minuten) {
        const s = raster(doc);
        return Math.round(minuten / s) * s;
    }

    /** Rundet eine Spanne und sorgt dafür, dass sie nicht auf null fällt. */
    function rundeSpanne(doc, von, bis) {
        const s = raster(doc);
        let a = runde(doc, von), b = runde(doc, bis);
        if (b <= a) b = a + s;
        return [a, b];
    }

    /* =================================================================
       Schweizer Feiertage
       Die beweglichen hängen alle an Ostern. Kantonale sind aufgeführt,
       damit sie nicht bloss «vielleicht» sind – die Kantonsliste bestimmt,
       was vorgeschlagen wird; abwählen kann man jeden.
       ================================================================= */

    const KANTONE = {
        AG: 'Aargau', AI: 'Appenzell Innerrhoden', AR: 'Appenzell Ausserrhoden',
        BE: 'Bern', BL: 'Basel-Landschaft', BS: 'Basel-Stadt', FR: 'Freiburg',
        GE: 'Genf', GL: 'Glarus', GR: 'Graubünden', JU: 'Jura', LU: 'Luzern',
        NE: 'Neuenburg', NW: 'Nidwalden', OW: 'Obwalden', SG: 'St. Gallen',
        SH: 'Schaffhausen', SO: 'Solothurn', SZ: 'Schwyz', TG: 'Thurgau',
        TI: 'Tessin', UR: 'Uri', VD: 'Waadt', VS: 'Wallis', ZG: 'Zug', ZH: 'Zürich'
    };

    /** Ostersonntag nach der gregorianischen Osterformel. */
    function ostern(jahr) {
        const a = jahr % 19, b = Math.floor(jahr / 100), c = jahr % 100;
        const d = Math.floor(b / 4), e = b % 4;
        const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4), k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const monat = Math.floor((h + l - 7 * m + 114) / 31);
        const tg = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(jahr, monat - 1, tg);
    }

    function vonOstern(jahr, tage) {
        const d = ostern(jahr);
        d.setDate(d.getDate() + tage);
        return alsText(d);
    }

    /**
     * Alle Feiertage eines Jahres. `kantone: null` heisst landesweit.
     * Halbe Tage sind als solche gekennzeichnet, weil sie beim Soll zählen.
     */
    function feiertageAlle(jahr) {
        const t = (m, d) => `${jahr}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

        const liste = [
            { datum: t(1, 1),  name: 'Neujahr',           kantone: null },
            { datum: t(1, 2),  name: 'Berchtoldstag',     kantone: ['AG','BE','BL','FR','GL','JU','NE','OW','SH','SO','TG','VD','ZG','ZH'] },
            { datum: t(1, 6),  name: 'Dreikönigstag',     kantone: ['GR','LU','SZ','TI','UR'] },
            { datum: t(3, 19), name: 'Josefstag',         kantone: ['GR','LU','NW','SZ','TI','UR','VS'] },
            { datum: vonOstern(jahr, -2), name: 'Karfreitag',    kantone: ['AG','AI','AR','BE','BL','BS','FR','GE','GL','GR','JU','LU','NE','NW','OW','SG','SH','SO','SZ','TG','UR','VD','ZG','ZH'] },
            { datum: vonOstern(jahr, 1),  name: 'Ostermontag',   kantone: ['AG','AI','AR','BE','BL','BS','FR','GE','GL','GR','JU','LU','NE','NW','OW','SG','SH','SO','SZ','TG','TI','UR','VD','ZG','ZH'] },
            { datum: t(5, 1),  name: 'Tag der Arbeit',    kantone: ['AG','BL','BS','JU','NE','SH','TG','TI','ZH'] },
            { datum: vonOstern(jahr, 39), name: 'Auffahrt',      kantone: null },
            { datum: vonOstern(jahr, 50), name: 'Pfingstmontag', kantone: ['AG','AI','AR','BE','BL','BS','FR','GE','GL','GR','JU','LU','NE','NW','OW','SG','SH','SO','SZ','TG','TI','UR','VD','ZG','ZH'] },
            { datum: vonOstern(jahr, 60), name: 'Fronleichnam',  kantone: ['AG','AI','JU','LU','NW','OW','SZ','TI','UR','VS','ZG'] },
            { datum: t(6, 29), name: 'Peter und Paul',    kantone: ['TI'] },
            { datum: t(8, 1),  name: 'Bundesfeier',       kantone: null },
            { datum: t(8, 15), name: 'Mariä Himmelfahrt', kantone: ['AI','JU','LU','NW','OW','SZ','TI','UR','VS','ZG'] },
            { datum: t(11, 1), name: 'Allerheiligen',     kantone: ['AI','GL','JU','LU','NW','OW','SG','SZ','TI','UR','VS','ZG'] },
            { datum: t(12, 8), name: 'Mariä Empfängnis',  kantone: ['AI','LU','NW','OW','SZ','TI','UR','VS','ZG'] },
            { datum: t(12, 24), name: 'Heiligabend',      kantone: ['AG','BE','BL','BS','FR','GE','JU','NE','SO','TG','VD','ZH'], halb: true },
            { datum: t(12, 25), name: 'Weihnachten',      kantone: null },
            { datum: t(12, 26), name: 'Stephanstag',      kantone: ['AG','AI','AR','BE','BL','BS','FR','GL','GR','LU','NW','OW','SG','SH','SZ','TG','TI','UR','ZG','ZH'] },
            { datum: t(12, 31), name: 'Silvester',        kantone: ['AG','BE','BL','BS','FR','GE','JU','NE','SO','TG','VD','ZH'], halb: true }
        ];

        // Ein paar Kantone haben Eigenes, das sich nicht in ein Muster fügt.
        if (jahr) {
            const sept = new Date(jahr, 8, 1);
            // Genfer Bettag: Donnerstag nach dem ersten Sonntag im September.
            const ersterSonntag = 1 + ((7 - sept.getDay()) % 7);
            liste.push({ datum: t(9, ersterSonntag + 4),  name: 'Genfer Bettag', kantone: ['GE'] });
            // Eidgenössischer Dank-, Buss- und Bettag: dritter Sonntag im September.
            liste.push({ datum: t(9, ersterSonntag + 14), name: 'Bettag', kantone: ['VD'], halb: false });
        }

        return liste.sort((a, b) => a.datum.localeCompare(b.datum));
    }

    /** Die Feiertage, die für dieses Dokument gelten. */
    function feiertage(doc, jahr) {
        const kanton = ((doc.einstellungen && doc.einstellungen.kanton) || '').toUpperCase();
        const abgewaehlt = new Set(doc.abgewaehlteFeiertage || []);

        const aus = feiertageAlle(jahr)
            .filter(f => f.kantone === null || f.kantone.indexOf(kanton) >= 0)
            .filter(f => !abgewaehlt.has(f.datum + '|' + f.name))
            .map(f => ({ datum: f.datum, name: f.name, halb: !!f.halb }));

        (doc.eigeneFeiertage || [])
            .filter(f => String(f.datum).indexOf(String(jahr)) === 0)
            .forEach(f => aus.push({ datum: f.datum, name: f.name, halb: !!f.halb, eigen: true }));

        return aus.sort((a, b) => a.datum.localeCompare(b.datum));
    }

    /* Je Dokument und Jahr einmal gebaut. Der Schlüssel enthält alles, was
       das Ergebnis ändern kann — sonst zeigt der Zwischenspeicher nach einer
       Kantonsumstellung noch die alten Tage. */
    const karten = new Map();

    function feiertagAm(doc, datum) {
        const jahr = String(datum).slice(0, 4);
        const schluessel = jahr + '|' + ((doc.einstellungen && doc.einstellungen.kanton) || '')
            + '|' + (doc.eigeneFeiertage || []).length
            + '|' + (doc.abgewaehlteFeiertage || []).length;

        let karte = karten.get(schluessel);
        if (!karte) {
            karte = new Map();
            feiertage(doc, Number(jahr)).forEach(f => karte.set(f.datum, f));
            if (karten.size > 24) karten.clear();      // klein halten
            karten.set(schluessel, karte);
        }
        return karte.get(datum) || null;
    }

    /** Nach einer Änderung an Kanton oder Feiertagen aufräumen. */
    function vergissFeiertage() { karten.clear(); }

    /* =================================================================
       Absenzen
       ================================================================= */

    function absenzAm(doc, datum) {
        return (doc.absenzen || []).find(a =>
            a.status !== 'abgelehnt' && a.von <= datum && datum <= a.bis) || null;
    }

    /** Wie viel eines Tages die Absenz einnimmt – ganz oder halb. */
    function absenzAnteil(absenz, datum) {
        if (datum === absenz.von && absenz.vonHalb) return 0.5;
        if (datum === absenz.bis && absenz.bisHalb) return 0.5;
        return 1;
    }

    /* =================================================================
       Soll und Ist
       ================================================================= */

    /** Wie viel an diesem Tag zu leisten wäre — nach Feiertag und Absenz. */
    function soll(doc, datum) {
        const proTag = (doc.einstellungen && doc.einstellungen.sollProTag) || {};
        let minuten = Number(proTag[wochentag(datum)] || 0);
        if (minuten <= 0) return 0;

        const feiertag = feiertagAm(doc, datum);
        if (feiertag) minuten = feiertag.halb ? minuten / 2 : 0;
        if (minuten <= 0) return 0;

        const absenz = absenzAm(doc, datum);
        if (absenz) {
            const typ = (doc.absenztypen || []).find(t => t.id === absenz.typId);
            // Eine Absenz, die als Arbeit zählt (Ferien, Krankheit), senkt das
            // Soll. Unbezahlter Urlaub tut das nicht – dort fehlt die Zeit wirklich.
            if (!typ || typ.zaehltAlsArbeit) minuten = Math.round(minuten * (1 - absenzAnteil(absenz, datum)));
        }
        return Math.max(0, minuten);
    }

    /** Netto-Arbeitszeit eines Eintrags. */
    function dauer(eintrag) {
        if (!eintrag || !Number.isFinite(eintrag.bis)) return 0;
        let ende = eintrag.bis;
        if (ende <= eintrag.von) ende += 24 * 60;      // Nachtschicht
        return Math.max(0, ende - eintrag.von - (Number(eintrag.pause) || 0));
    }

    function eintraegeAm(doc, datum) {
        return (doc.eintraege || [])
            .filter(e => e.datum === datum)
            .sort((a, b) => a.von - b.von);
    }

    /** Steht dort schon etwas? Ein laufender Timer belegt 15 Minuten. */
    function ueberschneidung(doc, datum, von, bis, ausser) {
        return eintraegeAm(doc, datum).some(e => {
            if (e.id === ausser) return false;
            const ende = Number.isFinite(e.bis) ? e.bis : e.von + 15;
            return e.von < bis && ende > von;
        });
    }

    /** Alles, was eine Tageszeile braucht. */
    function tag(doc, datum, heute) {
        const eintraege = eintraegeAm(doc, datum);
        const gearbeitet = eintraege.reduce((summe, e) => summe + dauer(e), 0);
        const feiertag = feiertagAm(doc, datum);
        const absenz = absenzAm(doc, datum);
        const sollMin = soll(doc, datum);

        // Absenzstunden zählen mit, sonst wäre ein Ferientag defizitär.
        let absenzMin = 0;
        if (absenz) {
            const typ = (doc.absenztypen || []).find(t => t.id === absenz.typId);
            if (!typ || typ.zaehltAlsArbeit) {
                const proTag = (doc.einstellungen && doc.einstellungen.sollProTag) || {};
                const voll = Number(proTag[wochentag(datum)] || 0);
                absenzMin = Math.round(voll * absenzAnteil(absenz, datum));
                if (feiertag) absenzMin = 0;     // Feiertag geht vor
            }
        }

        return {
            datum, eintraege, gearbeitet,
            soll: sollMin,
            absenzMinuten: absenzMin,
            differenz: gearbeitet + absenzMin - sollMin,
            feiertag, absenz,
            offenerTimer: eintraege.some(e => !Number.isFinite(e.bis)),
            istHeute: heute ? datum === heute : false,
            istWochenende: istWochenende(datum)
        };
    }

    /** Die Bilanz über mehrere Tage. */
    function bereich(doc, tage, heute) {
        const zeilen = tage.map(d => tag(doc, d, heute));
        return {
            zeilen,
            gearbeitet: zeilen.reduce((a, z) => a + z.gearbeitet, 0),
            soll: zeilen.reduce((a, z) => a + z.soll, 0),
            absenzMinuten: zeilen.reduce((a, z) => a + z.absenzMinuten, 0),
            differenz: zeilen.reduce((a, z) => a + z.differenz, 0)
        };
    }

    /* ---- Darstellung, damit beide Programme gleich schreiben ---- */

    const alsUhr = m => Number.isFinite(m)
        ? String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0') : '';
    /** «8,50 h» — mit Komma, wie man es hierzulande schreibt. */
    const alsStunden = m => ((Number(m) || 0) / 60).toFixed(2).replace('.', ',') + ' h';
    /** «07:30» oder «730» oder «7.30» → Minuten ab Mitternacht. */
    function ausUhr(text) {
        const m = /^(\d{1,2})[:.\s]?(\d{2})?$/.exec(String(text || '').trim());
        if (!m) return null;
        const h = Number(m[1]), min = Number(m[2] || 0);
        if (h > 23 || min > 59) return null;
        return h * 60 + min;
    }

    const Zeitrechnung = {
        KANTONE,
        alsText, wochentag, istWochenende,
        raster, runde, rundeSpanne,
        ostern, feiertageAlle, feiertage, feiertagAm, vergissFeiertage,
        absenzAm, absenzAnteil,
        soll, dauer, eintraegeAm, ueberschneidung, tag, bereich,
        alsUhr, ausUhr, alsStunden
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = Zeitrechnung;
    else global.Zeitrechnung = Zeitrechnung;

})(typeof globalThis !== 'undefined' ? globalThis : this);
