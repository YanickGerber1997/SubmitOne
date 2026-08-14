/* =====================================================================
   Submit — Kern
   ---------------------------------------------------------------------
   Der gemeinsame Unterbau aller Module (Zeit, Termin, Kosten, Paper …).
   Kein Build-Schritt, keine Abhängigkeiten: eine Datei, per <script>
   eingebunden, stellt vier Dinge bereit.

     Hilf     Datum, Zeit, Zahlen, Format
     Daten    das Dokument im Speicher, mit Rückgängig
     Ablage   öffnen und speichern — echte Datei oder Browser
     Ui       Kleinkram, den jedes Modul braucht

   Leitsatz aus der Vision: Das Dokument ist der Star, das Programm der
   Stift. Deshalb ist das Dateiformat lesbarer Text mit Versionsnummer,
   und für jede alte Fassung gibt es einen Übersetzer.
   ===================================================================== */

'use strict';

/* =====================================================================
   1) Hilfen
   ===================================================================== */

const Hilf = (function () {

    const CH = 'de-CH';
    const TAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    const TAGE_KURZ = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
                    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

    /* Ein Datum ist im ganzen Programm die Zeichenfolge 'JJJJ-MM-TT'.
       Kein Date-Objekt in den Daten: Zeitzonen haben in einem Kalender
       nichts verloren, und Text lässt sich vergleichen und sortieren. */

    function heute() { return alsText(new Date()); }

    function alsText(d) {
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const t = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${m}-${t}`;
    }

    function alsDatum(text) {
        const [j, m, t] = String(text).split('-').map(Number);
        return new Date(j, m - 1, t);
    }

    function plusTage(text, tage) {
        const d = alsDatum(text);
        d.setDate(d.getDate() + tage);
        return alsText(d);
    }

    /** Montag der Woche, in der das Datum liegt. */
    function wochenStart(text) {
        const d = alsDatum(text);
        const verschiebung = (d.getDay() + 6) % 7;   // Montag = 0
        d.setDate(d.getDate() - verschiebung);
        return alsText(d);
    }

    function wochentag(text) { return alsDatum(text).getDay(); }
    function istWochenende(text) { const t = wochentag(text); return t === 0 || t === 6; }

    /** Kalenderwoche nach ISO 8601 – die, die in der Schweiz gilt. */
    function kw(text) {
        const d = alsDatum(text);
        // Auf den Donnerstag derselben Woche springen: Er bestimmt das Jahr.
        d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
        const ersterDonnerstag = new Date(d.getFullYear(), 0, 4);
        ersterDonnerstag.setDate(ersterDonnerstag.getDate() + 3 - ((ersterDonnerstag.getDay() + 6) % 7));
        return 1 + Math.round((d - ersterDonnerstag) / (7 * 24 * 3600 * 1000));
    }

    function tagLang(text) { return TAGE[wochentag(text)]; }
    function tagKurz(text) { return TAGE_KURZ[wochentag(text)]; }
    function monatName(nr) { return MONATE[nr]; }

    function datum(text) {
        if (!text) return '';
        const [j, m, t] = text.split('-');
        return `${t}.${m}.${j}`;
    }

    function datumKurz(text) {
        if (!text) return '';
        const [, m, t] = text.split('-');
        return `${t}.${m}.`;
    }

    function spanne(von, bis) {
        if (von === bis) return datum(von);
        const [j1, m1] = von.split('-'), [j2, m2] = bis.split('-');
        if (j1 === j2 && m1 === m2) return `${von.split('-')[2]}. – ${datum(bis)}`;
        if (j1 === j2) return `${datumKurz(von)} – ${datum(bis)}`;
        return `${datum(von)} – ${datum(bis)}`;
    }

    /* ---- Zeit ----
       Eine Uhrzeit ist die Zahl der Minuten seit Mitternacht. Rechnen mit
       Zahlen statt mit Text erspart die halbe Fehlerquelle. */

    function ausUhrzeit(text) {
        const m = /^(\d{1,2})[:.]?(\d{2})?$/.exec(String(text).trim());
        if (!m) return null;
        const std = Number(m[1]), min = Number(m[2] || 0);
        if (std > 23 || min > 59) return null;
        return std * 60 + min;
    }

    function uhrzeit(minuten) {
        const m = Math.max(0, Math.round(minuten));
        return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    }

    /** Dauer als 7:30 – nicht als 7.5, weil niemand in Zehnteln denkt. */
    function dauer(minuten) {
        const negativ = minuten < 0;
        const m = Math.abs(Math.round(minuten));
        return (negativ ? '−' : '') + `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
    }

    function mitVorzeichen(minuten) {
        if (Math.abs(minuten) < 1) return '0:00';
        return (minuten > 0 ? '+' : '−') + dauer(Math.abs(minuten));
    }

    function stunden(minuten) { return Math.round(minuten / 0.6) / 100; }

    function geld(betrag, waehrung) {
        return new Intl.NumberFormat(CH, {
            style: 'currency', currency: waehrung || 'CHF', minimumFractionDigits: 2
        }).format(betrag || 0);
    }

    function zahl(wert, stellen) {
        return new Intl.NumberFormat(CH, {
            minimumFractionDigits: stellen || 0, maximumFractionDigits: stellen || 0
        }).format(wert || 0);
    }

    /** Kennung, die auch ohne Server eindeutig ist. */
    function id() {
        const zufall = new Uint8Array(9);
        crypto.getRandomValues(zufall);
        return Array.from(zufall, b => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
    }

    function klemme(wert, min, max) { return Math.min(max, Math.max(min, wert)); }

    return {
        heute, alsText, alsDatum, plusTage, wochenStart, wochentag, istWochenende, kw,
        tagLang, tagKurz, monatName, datum, datumKurz, spanne,
        ausUhrzeit, uhrzeit, dauer, mitVorzeichen, stunden, geld, zahl, id, klemme
    };
})();


/* =====================================================================
   2) Das Dokument
   ---------------------------------------------------------------------
   Ein einfaches Objekt, das im Speicher liegt. Jede Änderung geht durch
   `Daten.aendere(…)` – dadurch entstehen Rückgängig-Schritte und die
   Oberfläche erfährt davon, ohne dass jemand daran denken muss.
   ===================================================================== */

const Daten = (function () {

    let dok = null;
    let sauber = true;                  // seit dem letzten Speichern unverändert?
    const zurueck = [], vor = [];
    const TIEFE = 60;

    const horcher = new Set();

    function melde(was) {
        horcher.forEach(f => { try { f(was); } catch (e) { console.error(e); } });
    }

    /** Tiefe Kopie – das Dokument ist reiner Text, deshalb genügt das. */
    function kopie(o) { return JSON.parse(JSON.stringify(o)); }

    return {
        get doc() { return dok; },
        get istGeaendert() { return !sauber; },

        setze(neues, alsGespeichert) {
            dok = neues;
            zurueck.length = 0;
            vor.length = 0;
            sauber = alsGespeichert !== false;
            melde('geladen');
        },

        /**
         * Ändert das Dokument und merkt sich den Schritt.
         * @param beschriftung  erscheint im Rückgängig-Hinweis
         * @param arbeit        bekommt das Dokument und verändert es
         */
        aendere(beschriftung, arbeit) {
            if (!dok) return;

            // Der Zustand VOR der Änderung wandert auf den Stapel. Ein
            // Schnappschuss ist grosszügig, aber bei diesen Datenmengen
            // unbedenklich – und er kann nichts übersehen.
            zurueck.push({ beschriftung, stand: kopie(dok) });
            if (zurueck.length > TIEFE) zurueck.shift();
            vor.length = 0;

            arbeit(dok);
            dok.geaendert = new Date().toISOString();
            sauber = false;

            melde('geaendert');
            Ablage.sichereNebenbei();
        },

        /** Änderung ohne Rückgängig-Schritt – für Einstellungen und Ansichtssachen. */
        still(arbeit) {
            if (!dok) return;
            arbeit(dok);
            dok.geaendert = new Date().toISOString();
            sauber = false;
            melde('geaendert');
            Ablage.sichereNebenbei();
        },

        get kannZurueck() { return zurueck.length > 0; },
        get kannVor() { return vor.length > 0; },
        get naechstesZurueck() { return zurueck.length ? zurueck[zurueck.length - 1].beschriftung : null; },

        zurueckNehmen() {
            if (!zurueck.length) return null;
            const schritt = zurueck.pop();
            vor.push({ beschriftung: schritt.beschriftung, stand: kopie(dok) });
            dok = schritt.stand;
            sauber = false;
            melde('geaendert');
            Ablage.sichereNebenbei();
            return schritt.beschriftung;
        },

        wiederholen() {
            if (!vor.length) return null;
            const schritt = vor.pop();
            zurueck.push({ beschriftung: schritt.beschriftung, stand: kopie(dok) });
            dok = schritt.stand;
            sauber = false;
            melde('geaendert');
            Ablage.sichereNebenbei();
            return schritt.beschriftung;
        },

        gespeichert() { sauber = true; melde('gespeichert'); },

        horche(f) { horcher.add(f); return () => horcher.delete(f); },
        melde,
        kopie
    };
})();


/* =====================================================================
   3) Ablage — öffnen und speichern
   ---------------------------------------------------------------------
   Drei Wege, in dieser Reihenfolge:
     1. Echte Datei (Chrome, Edge): öffnen, ändern, in dieselbe Datei zurück
     2. Herunterladen / Hochladen (alle übrigen Browser)
     3. Nebenbei im Browser, als Netz gegen Verlust
   ===================================================================== */

const Ablage = (function () {

    const SCHLUESSEL = 'submit.zeit.entwurf';
    const KANN_DATEI = typeof window.showOpenFilePicker === 'function';

    let griff = null;              // FileSystemFileHandle, falls vorhanden
    let name = 'Meine Zeit';
    let letzteSicherung = 0;

    /* ---- Format ----
       Die Versionsnummer ist die Lebensversicherung: Solange sie in der
       Datei steht, lässt sich jede alte Fassung übersetzen. */

    const FORMAT = 'submit.zeit';
    const FASSUNG = 1;

    function leer(personName) {
        const jahr = new Date().getFullYear();
        return {
            format: FORMAT,
            fassung: FASSUNG,
            erstellt: new Date().toISOString(),
            geaendert: new Date().toISOString(),

            // Der Projekt-Kopf. In der Mappe wird er geteilt; allein ist er
            // hier direkt änderbar – die Datei beschreibt sich selbst.
            kopf: { projekt: '', bauherr: '', ort: '', bauleitung: '' },

            person: { name: personName || '', kuerzel: '' },

            einstellungen: {
                stufe: 'selbstaendig',        // schule | selbstaendig | firma
                kanton: 'BE',
                raster: 15,
                sollProTag: { 1: 510, 2: 510, 3: 510, 4: 510, 5: 480, 6: 0, 0: 0 },
                pauseAbMinuten: 330,
                pauseMinuten: 30,
                ferienTageProJahr: 25,
                waehrung: 'CHF',
                stundensatz: 140,
                arbeitsjahr: jahr
            },

            kunden: [],
            projekte: [],
            taetigkeiten: [
                { id: Hilf.id(), name: 'Arbeit', verrechenbar: true },
                { id: Hilf.id(), name: 'Beratung', verrechenbar: true },
                { id: Hilf.id(), name: 'Reisezeit', verrechenbar: true },
                { id: Hilf.id(), name: 'Interne Arbeit', verrechenbar: false },
                { id: Hilf.id(), name: 'Sitzung', verrechenbar: false }
            ],

            eintraege: [],
            aufgaben: [],
            wochenziele: [],
            absenzen: [],
            absenztypen: [
                { id: Hilf.id(), name: 'Ferien', farbe: '#0ea5e9', zaehltAlsArbeit: true, vomKonto: true },
                { id: Hilf.id(), name: 'Krankheit', farbe: '#f59e0b', zaehltAlsArbeit: true, vomKonto: false },
                { id: Hilf.id(), name: 'Unfall', farbe: '#ef4444', zaehltAlsArbeit: true, vomKonto: false },
                { id: Hilf.id(), name: 'Militär', farbe: '#84cc16', zaehltAlsArbeit: true, vomKonto: false },
                { id: Hilf.id(), name: 'Unbezahlt', farbe: '#94a3b8', zaehltAlsArbeit: false, vomKonto: false }
            ],
            eigeneFeiertage: [],
            abgewaehlteFeiertage: [],
            rechnungen: []
        };
    }

    /**
     * Prüft und repariert, was hereinkommt. Eine kaputte oder fremde Datei
     * darf das Programm nie zum Absturz bringen – und fehlende Felder
     * entstehen einfach neu.
     */
    function pruefe(roh) {
        if (!roh || typeof roh !== 'object') throw new Error('Die Datei ist leer oder unlesbar.');
        if (roh.format && roh.format !== FORMAT) {
            throw new Error(`Das ist eine ${roh.format}-Datei, nicht SubZeit.`);
        }
        if ((roh.fassung || 1) > FASSUNG) {
            throw new Error('Die Datei stammt aus einer neueren Fassung. Bitte das Programm aktualisieren.');
        }

        // Übersetzer für ältere Fassungen kommen hier hinein, aufsteigend.
        // if ((roh.fassung || 1) < 2) { … roh.fassung = 2; }

        const vorlage = leer();
        const doc = Object.assign({}, vorlage, roh);

        // Verschachteltes ergänzen, ohne Vorhandenes zu überschreiben.
        doc.kopf = Object.assign({}, vorlage.kopf, roh.kopf);
        doc.person = Object.assign({}, vorlage.person, roh.person);
        doc.einstellungen = Object.assign({}, vorlage.einstellungen, roh.einstellungen);

        ['kunden', 'projekte', 'taetigkeiten', 'eintraege', 'aufgaben', 'wochenziele',
         'absenzen', 'absenztypen', 'eigeneFeiertage', 'abgewaehlteFeiertage', 'rechnungen']
            .forEach(feld => { if (!Array.isArray(doc[feld])) doc[feld] = vorlage[feld] || []; });

        // Einträge ohne Kennung oder mit unsinnigen Zeiten aussortieren, statt
        // später an hundert Stellen dagegen zu prüfen.
        doc.eintraege = doc.eintraege.filter(e =>
            e && typeof e.datum === 'string' && Number.isFinite(e.von));
        doc.eintraege.forEach(e => { if (!e.id) e.id = Hilf.id(); });

        doc.fassung = FASSUNG;
        return doc;
    }

    /* ---- Nebenbei sichern ----
       Kein Ersatz für die Datei, sondern das Netz darunter: Stürzt der
       Browser ab oder wird der Reiter geschlossen, ist der Stand da. */

    function sichereNebenbei() {
        const jetzt = Date.now();
        if (jetzt - letzteSicherung < 1500) return;
        letzteSicherung = jetzt;

        try {
            localStorage.setItem(SCHLUESSEL, JSON.stringify({
                name: name,
                zeit: new Date().toISOString(),
                doc: Daten.doc
            }));
        } catch (e) {
            // Voller Speicher darf das Arbeiten nicht verhindern.
            console.warn('Zwischenstand konnte nicht abgelegt werden.', e);
        }
    }

    function nebenbeiVorhanden() {
        try {
            const roh = localStorage.getItem(SCHLUESSEL);
            return roh ? JSON.parse(roh) : null;
        } catch (e) { return null; }
    }

    function nebenbeiLoeschen() {
        try { localStorage.removeItem(SCHLUESSEL); } catch (e) { /* egal */ }
    }

    /* ---- Öffnen und speichern ---- */

    async function neu(personName) {
        griff = null;
        name = 'Meine Zeit';
        Daten.setze(leer(personName), false);
        sichereNebenbei();
    }

    async function oeffnen() {
        if (KANN_DATEI) {
            const [gewaehlt] = await window.showOpenFilePicker({
                types: [{ description: 'SubZeit', accept: { 'application/json': ['.submitzeit', '.json'] } }],
                multiple: false
            });
            await ausGriff(gewaehlt);
            return true;
        }

        // Ohne Dateizugriff: gewöhnliches Hochladen.
        return new Promise(aufloesen => {
            const feld = document.createElement('input');
            feld.type = 'file';
            feld.accept = '.submitzeit,.json,application/json';
            feld.onchange = async () => {
                const datei = feld.files && feld.files[0];
                if (!datei) return aufloesen(false);
                const text = await datei.text();
                Daten.setze(pruefe(JSON.parse(text)), true);
                name = datei.name.replace(/\.[^.]+$/, '');
                griff = null;
                aufloesen(true);
            };
            feld.click();
        });
    }

    /** Eine Datei, die uns das Betriebssystem reicht (Doppelklick im Explorer). */
    async function ausGriff(g) {
        const datei = await g.getFile();
        const text = await datei.text();
        Daten.setze(pruefe(JSON.parse(text)), true);
        griff = g;
        name = datei.name.replace(/\.[^.]+$/, '');
    }

    function inhalt() {
        return JSON.stringify(Daten.doc, null, 1);
    }

    async function speichern() {
        if (!Daten.doc) return false;

        if (griff) {
            const strom = await griff.createWritable();
            await strom.write(inhalt());
            await strom.close();
            Daten.gespeichert();
            return true;
        }
        return speichernUnter();
    }

    async function speichernUnter() {
        if (!Daten.doc) return false;

        const dateiname = (name || 'Meine Zeit') + '.submitzeit';

        if (KANN_DATEI) {
            griff = await window.showSaveFilePicker({
                suggestedName: dateiname,
                types: [{ description: 'SubZeit', accept: { 'application/json': ['.submitzeit'] } }]
            });
            const strom = await griff.createWritable();
            await strom.write(inhalt());
            await strom.close();
            name = griff.name.replace(/\.[^.]+$/, '');
            Daten.gespeichert();
            return true;
        }

        // Ohne Dateizugriff bleibt der Weg über den Download-Ordner.
        const blob = new Blob([inhalt()], { type: 'application/json' });
        const verweis = document.createElement('a');
        verweis.href = URL.createObjectURL(blob);
        verweis.download = dateiname;
        verweis.click();
        setTimeout(() => URL.revokeObjectURL(verweis.href), 4000);
        Daten.gespeichert();
        return true;
    }

    return {
        get kannDatei() { return KANN_DATEI; },
        get hatDatei() { return griff !== null; },
        get name() { return name; },
        set name(n) { name = n; },

        leer, pruefe, neu, oeffnen, ausGriff, speichern, speichernUnter,
        sichereNebenbei, nebenbeiVorhanden, nebenbeiLoeschen
    };
})();


/* =====================================================================
   4) Kleinkram für die Oberfläche
   ===================================================================== */

const Ui = (function () {

    /** Element bauen. `Ui.el('div.karte', { onclick }, 'Text', kind)` */
    function el(beschreibung, eigenschaften, ...kinder) {
        const [tag, ...klassen] = beschreibung.split('.');
        const knoten = document.createElement(tag || 'div');
        if (klassen.length) knoten.className = klassen.join(' ');

        for (const [schluessel, wert] of Object.entries(eigenschaften || {})) {
            if (wert === null || wert === undefined || wert === false) continue;

            if (schluessel.startsWith('on') && typeof wert === 'function') {
                knoten.addEventListener(schluessel.slice(2), wert);
            } else if (schluessel === 'stil') {
                Object.assign(knoten.style, wert);
            } else if (schluessel === 'html') {
                knoten.innerHTML = wert;
            } else if (schluessel in knoten && schluessel !== 'list') {
                knoten[schluessel] = wert;
            } else {
                knoten.setAttribute(schluessel, wert === true ? '' : wert);
            }
        }

        kinder.flat(3).forEach(kind => {
            if (kind === null || kind === undefined || kind === false) return;
            knoten.append(kind instanceof Node ? kind : document.createTextNode(String(kind)));
        });

        return knoten;
    }

    function leere(knoten) { while (knoten.firstChild) knoten.removeChild(knoten.firstChild); }

    /* ---- Kurzmeldungen ---- */

    let meldungsfeld = null;

    function meldung(text, art, handlung) {
        if (!meldungsfeld) {
            meldungsfeld = el('div.meldungen');
            document.body.appendChild(meldungsfeld);
        }

        const knoten = el('div.meldung.' + (art || 'info'), {},
            el('span', {}, text),
            handlung ? el('button.meldung-tat', {
                onclick: () => { handlung.tat(); knoten.remove(); }
            }, handlung.text) : null
        );

        meldungsfeld.appendChild(knoten);

        const weg = () => {
            knoten.style.opacity = '0';
            setTimeout(() => knoten.remove(), 250);
        };
        setTimeout(weg, handlung ? 9000 : 4000);
        knoten.addEventListener('click', e => { if (e.target === knoten) weg(); });
    }

    /* ---- Fenster ---- */

    function fenster({ titel, unterzeile, inhalt, knoepfe, breit }) {
        const box = el('div.fenster' + (breit ? '.breit' : ''), { role: 'dialog', 'aria-modal': 'true' },
            el('div.fenster-kopf', {},
                el('div', {},
                    el('h2', {}, titel),
                    unterzeile ? el('p.fenster-unterzeile', {}, unterzeile) : null),
                el('button.fenster-zu', { type: 'button', 'aria-label': 'Schliessen', onclick: () => schliesse() }, '×')),
            el('div.fenster-inhalt', {}, inhalt),
            knoepfe ? el('div.fenster-fuss', {}, knoepfe) : null);

        const schleier = el('div.schleier', {
            onclick: e => { if (e.target === schleier) schliesse(); }
        }, box);

        function schliesse(ergebnis) {
            schleier.remove();
            document.removeEventListener('keydown', beiTaste, true);
            if (aufloesen) aufloesen(ergebnis);
        }

        function beiTaste(e) {
            if (e.key === 'Escape') { e.stopPropagation(); schliesse(); }
        }

        let aufloesen = null;
        const versprechen = new Promise(a => { aufloesen = a; });

        document.body.appendChild(schleier);
        document.addEventListener('keydown', beiTaste, true);

        const erstes = box.querySelector('input, select, textarea, button:not(.fenster-zu)');
        if (erstes) setTimeout(() => erstes.focus(), 40);

        versprechen.schliesse = schliesse;
        return { versprechen, schliesse, box };
    }

    async function frage(text, jaText) {
        const f = fenster({
            titel: 'Sicher?',
            inhalt: el('p', {}, text),
            knoepfe: [
                el('button.knopf.knopf-still', { onclick: () => f.schliesse(false) }, 'Abbrechen'),
                el('button.knopf.knopf-gefahr', { onclick: () => f.schliesse(true) }, jaText || 'Ja, löschen')
            ]
        });
        return f.versprechen;
    }

    /* ---- Felder ---- */

    function feld(beschriftung, element, hinweis) {
        return el('label.feld', {},
            el('span.feld-name', {}, beschriftung, hinweis ? el('em', {}, hinweis) : null),
            element);
    }

    function auswahl(werte, gewaehlt, beiWahl, leerText) {
        const s = el('select.eingabe', { onchange: e => beiWahl(e.target.value || null) });
        if (leerText) s.appendChild(el('option', { value: '' }, leerText));
        werte.forEach(w => s.appendChild(el('option', {
            value: w.id, selected: w.id === gewaehlt
        }, w.name)));
        return s;
    }

    return { el, leere, meldung, fenster, frage, feld, auswahl };
})();
