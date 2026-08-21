/* =====================================================================
   Submit — Übersetzer
   ---------------------------------------------------------------------
   Zwischen dem Projekt, wie SubmitOne es im Speicher hält, und der
   Projektmappe, wie sie auf der Platte liegt.

   Warum überhaupt übersetzt wird
   ------------------------------
   In app.js trägt jede Vergabe ihre BKP-Nummer und ihren Gewerknamen
   selbst — `v.bkp` und `v.gewerk`. Das ist an rund 300 Stellen so
   verwendet und funktioniert gut. Es umzubauen hiesse, eine Datei mit
   13'000 Zeilen an 300 Stellen anzufassen.

   Nötig ist der Umbau aber gar nicht im Speicher, sondern nur in der
   DATEI: Damit SubZeit, SubTermin und SubKosten auf dasselbe Gewerk
   zeigen können, muss die Gewerkliste dort EINMAL oben stehen und nicht
   in jedem Modul für sich.

   Also bleibt `state` genau wie er ist, und hier wird beim Speichern
   auseinandergenommen und beim Laden wieder zusammengesetzt.

   Der Kniff mit der Kennung
   -------------------------
   Das Gewerk übernimmt die Kennung der Vergabe. Dadurch gilt immer
   `gewerkId === vergabe.id`, es muss nichts umgeschrieben werden, und
   der Weg hin und zurück verliert nichts.

   Leitsatz: Was hier hineingeht, muss unverändert wieder herauskommen.
   Deshalb wandert alles, was nicht ausdrücklich zugeordnet ist, in das
   Fach `module.one` — und nicht in den Papierkorb.
   ===================================================================== */

(function (global) {

    'use strict';

    const FORMAT = 'submit.mappe';
    const FASSUNG = 1;

    /* Dieselbe Reihe wie in mappe.js — nicht zufällig, damit dasselbe
       Gewerk in jeder Mappe gleich aussieht. */
    const FARBEN = ['#7132e3', '#0ea5e9', '#0f7a4a', '#c8871f', '#c02626',
                    '#8455f0', '#1d5fbf', '#0d9488', '#a16207', '#9333ea'];

    /* Die Felder des Projekts, die in den gemeinsamen Kopf gehören.
       Links wie es in app.js heisst, rechts wie es in der Mappe heisst. */
    const KOPF_FELDER = {
        name:          'projekt',
        nummer:        'nummer',        // Objekt-Nr. – steht auf jedem Bauprogramm
        bauherr:       'bauherr',
        ort:           'ort',
        projektleiter: 'bauleitung',
        vorlage:       'vorlage'       // Bau · Sammlung · Unterschriften · IT (siehe app.js, MODUL VORLAGEN)
    };

    /* Die Felder der Vergabe, die in den Stamm gehören: Links wie es in
       app.js heisst, rechts wie es im Gewerk heisst.

       Warum auch die Termine
       ----------------------
       Der Prüfstein ist: Braucht es mehr als ein Programm, gehört es in den
       Stamm. Baustart und Bauende braucht SubmitOne fürs Gantt, SubKosten
       für die Zahlungsprognose und SubTermin ohnehin — also Stamm.

       Was nur SubTermin braucht (Verkettung, Vorgänge, Meilensteine, Puffer),
       bleibt in dessen eigenem Fach `module.termin`. */
    const GEWERK_FELDER = {
        bkp:      'bkp',
        gewerk:   'name',
        bauStart: 'start',
        bauEnde:  'ende'
    };

    /* Felder des Projekts, die in den Stamm gehören statt in ein Modulfach.
       Massstab ist die Entscheidungsleiter aus docs/SPEICHERN.md:

         Brauchen mehrere Programme es zum ÄNDERN?  →  Stamm

       `pendenzen`: SubmitOne erfasst und hakt sie ab, SubZeit plant sie auf
       Tage und hakt sie ebenfalls ab. Zwei Schreiber, also Stamm — sonst
       müsste SubZeit in das Fach von SubmitOne greifen.

       Nicht dabei: Protokolle. Die dort verschachtelten Pendenzen gehören zu
       ihrer Sitzung und bleiben deshalb im Fach `one`. */
    const STAMM_FELDER = ['pendenzen'];

    function kopie(o) { return JSON.parse(JSON.stringify(o)); }

    function farbeFuer(i) { return FARBEN[i % FARBEN.length]; }

    /** Kennung, die auch ohne Server eindeutig ist — wie Hilf.id(). */
    function id() {
        const zufall = new Uint8Array(9);
        if (global.crypto && global.crypto.getRandomValues) {
            global.crypto.getRandomValues(zufall);
        } else {
            for (let i = 0; i < zufall.length; i++) zufall[i] = Math.floor(Math.random() * 256);
        }
        return Array.from(zufall, b => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
    }


    /* =================================================================
       Projekt  →  Mappe
       ================================================================= */

    /**
     * Macht aus einem Projekt von SubmitOne eine Projektmappe.
     *
     * @param projekt  ein Eintrag aus state.projekte
     * @returns        das Mappen-Dokument, bereit zum Schreiben
     */
    function zuMappe(projekt) {
        if (!projekt || typeof projekt !== 'object') {
            throw new Error('Kein Projekt übergeben.');
        }

        const p = kopie(projekt);
        const vergaben = Array.isArray(p.vergaben) ? p.vergaben : [];

        /* ---- Die Gewerke: das gemeinsame Objekt ----
               Ein Feld wandert nur mit, wenn die Vergabe es auch hat —
               sonst entstünde beim Zurückwandeln ein Feld, das es vorher
               nicht gab, und der Weg hin und zurück wäre nicht mehr treu. */
        const gewerke = vergaben.map((v, i) => {
            if (!v.id) v.id = id();               // sollte migrate() erledigt haben
            const g = { id: v.id };               // dieselbe Kennung wie die Vergabe

            Object.keys(GEWERK_FELDER).forEach(feld => {
                if (!(feld in v)) return;
                const wert = v[feld];
                g[GEWERK_FELDER[feld]] = (typeof wert === 'string') ? wert.trim() : wert;
            });

            g.farbe = v.farbe || farbeFuer(i);
            return g;
        });

        /* ---- Das Vergabe-Fach: alles Übrige der Vergabe ---- */
        const vergabeFach = vergaben.map(v => {
            const rest = {};
            Object.keys(v).forEach(k => {
                if (GEWERK_FELDER[k] !== undefined) return;  // steckt jetzt im Gewerk
                rest[k] = v[k];
            });
            rest.gewerkId = v.id;                            // der Rückverweis
            return rest;
        });

        /* ---- Der Kopf ---- */
        const kopf = { projekt: '', bauherr: '', ort: '', bauleitung: '' };
        Object.keys(KOPF_FELDER).forEach(feld => {
            if (p[feld] !== undefined) kopf[KOPF_FELDER[feld]] = p[feld];
        });

        /* ---- Der Rest des Projekts: phase, termine, protokolle, auflagen,
                optionen, finanz und alles, was noch dazukommt. Nichts wird
                aufgezählt, damit ein neues Feld in app.js hier nicht
                stillschweigend verlorengeht. ---- */
        const einsFach = {};
        Object.keys(p).forEach(k => {
            if (k === 'vergaben') return;                    // eigenes Fach
            if (k === 'erstellt') return;                    // steht zuoberst in der Mappe
            if (KOPF_FELDER[k] !== undefined) return;        // steckt im Kopf
            if (STAMM_FELDER.indexOf(k) >= 0) return;        // steht im Stamm
            einsFach[k] = p[k];
        });

        const jetzt = new Date().toISOString();
        const mappe = {
            format:    FORMAT,
            fassung:   FASSUNG,
            erstellt:  projekt.erstellt || jetzt,
            geaendert: jetzt,
            kopf:      kopf,
            gewerke:   gewerke,
            module: {
                one:     einsFach,
                vergabe: { vergaben: vergabeFach }
            }
        };

        // Nur mitnehmen, was das Projekt auch hat – sonst entstünde beim
        // Zurückwandeln ein Feld, das es vorher nicht gab.
        STAMM_FELDER.forEach(feld => { if (feld in p) mappe[feld] = p[feld]; });
        return mappe;
    }


    /* =================================================================
       Mappe  →  Projekt
       ================================================================= */

    /**
     * Macht aus einer Projektmappe wieder ein Projekt für state.projekte.
     * Fehlt ein Fach, entsteht ein leeres Projekt statt eines Absturzes —
     * eine fremde oder beschädigte Datei darf das Programm nie umwerfen.
     */
    function ausMappe(mappe) {
        if (!mappe || typeof mappe !== 'object') {
            throw new Error('Die Datei ist leer oder unlesbar.');
        }
        if (mappe.format && mappe.format !== FORMAT) {
            throw new Error(`Das ist eine ${mappe.format}-Datei, keine Projektmappe.`);
        }
        if ((mappe.fassung || 1) > FASSUNG) {
            throw new Error('Die Mappe stammt aus einer neueren Fassung. Bitte das Programm aktualisieren.');
        }

        const m       = kopie(mappe);
        const module_ = (m.module && typeof m.module === 'object') ? m.module : {};
        const gewerke = Array.isArray(m.gewerke) ? m.gewerke : [];
        const kopf    = (m.kopf && typeof m.kopf === 'object') ? m.kopf : {};

        /* Das Projekt beginnt als das, was im Fach `one` liegt. */
        const p = (module_.one && typeof module_.one === 'object') ? module_.one : {};

        /* Der Kopf zurück auf die Projektfelder. */
        Object.keys(KOPF_FELDER).forEach(feld => {
            const inMappe = kopf[KOPF_FELDER[feld]];
            if (inMappe !== undefined) p[feld] = inMappe;
        });

        /* Und was im Stamm steht, zurück ans Projekt. */
        STAMM_FELDER.forEach(feld => { if (m[feld] !== undefined) p[feld] = m[feld]; });

        /* Das Erstelldatum zurückgeben. Ohne diese Zeile kam es nie beim
           Projekt an, und `zuMappe` erfand beim nächsten Speichern ein
           neues — das echte Anlagedatum war nach einmal Öffnen und Sichern
           verloren. Nebenbei war es der Grund, weshalb der Ordner-Adapter
           Dateien schrieb, an denen sich nichts geändert hatte: Zwei
           Aufrufe in verschiedenen Millisekunden ergaben verschiedene
           Texte. Gefunden am 14.08.2026 durch einen Test, der mal grün
           und mal rot war. */
        if (m.erstellt !== undefined) p.erstellt = m.erstellt;

        /* Die Vergaben wieder zusammensetzen: Fach plus Gewerk. */
        const nachId = new Map(gewerke.map(g => [g.id, g]));
        const fach   = (module_.vergabe && Array.isArray(module_.vergabe.vergaben))
            ? module_.vergabe.vergaben : [];

        p.vergaben = fach.map(eintrag => {
            const v = {};
            Object.keys(eintrag).forEach(k => {
                if (k === 'gewerkId') return;                // war nur der Verweis
                v[k] = eintrag[k];
            });

            const g = nachId.get(eintrag.gewerkId);
            if (g) {
                Object.keys(GEWERK_FELDER).forEach(feld => {
                    const imGewerk = GEWERK_FELDER[feld];
                    if (imGewerk in g) v[feld] = g[imGewerk];
                });
                if (!v.id) v.id = g.id;
            } else {
                // Gewerk fehlt in der Mappe: lieber leere Felder als fehlende.
                if (v.bkp === undefined) v.bkp = '';
                if (v.gewerk === undefined) v.gewerk = '';
            }
            return v;
        });

        if (!p.id) p.id = 'p_' + id();
        return p;
    }


    /* =================================================================
       Nach draussen
       ================================================================= */

    const Uebersetzer = { FORMAT, FASSUNG, FARBEN, farbeFuer, zuMappe, ausMappe };

    if (typeof module !== 'undefined' && module.exports) module.exports = Uebersetzer;
    else global.Uebersetzer = Uebersetzer;

})(typeof globalThis !== 'undefined' ? globalThis : this);
