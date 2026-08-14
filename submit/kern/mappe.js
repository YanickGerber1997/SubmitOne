/* =====================================================================
   Submit — die Mappe
   ---------------------------------------------------------------------
   Das Dach über den Werkzeugen. Eine Mappe ist eine Datei, die mehrere
   Modul-Dokumente eines Bauvorhabens zusammenhält — und die Dinge, die
   ihnen allen gemeinsam sind:

     kopf     Projektname, Bauherr, Ort, Bauleitung
     gewerke  die BKP-Positionen — DAS gemeinsame Objekt

   Der Leitsatz aus der Vision: Ein Gewerk ist EIN Ding. SubTermin zeigt
   den Balken, SubKosten die Zahlen, SubZeit die Stunden. Deshalb liegen
   die Gewerke hier und nicht in jedem Modul für sich.

   Ein Modul läuft auch ohne Mappe. Dann fehlt ihm nur der Zusammenhang.
   ===================================================================== */

'use strict';

const Mappe = (function () {

    const FORMAT = 'submit.mappe';
    const FASSUNG = 1;

    /* Die Module, die es geben kann. Neue kommen hier dazu – der Rest
       richtet sich danach, auch die Kachelübersicht. */
    const MODULE = {
        zeit:   { name: 'SubZeit',   satz: 'Zeit erfassen und planen', ordner: 'zeit', da: true },
        termin: { name: 'SubTermin', satz: 'Bauprogramm als Balkenplan', ordner: 'termin', da: false },
        kosten: { name: 'SubKosten', satz: 'Kosten nach BKP', ordner: 'kosten', da: false },
        paper:  { name: 'SubPaper',  satz: 'Rapporte und Protokolle', ordner: 'paper', da: false }
    };

    let griff = null;
    let name = 'Neues Projekt';

    /* =================================================================
       Der Griff überlebt den Seitenwechsel
       ---------------------------------------------------------------
       Ein Dateigriff lässt sich nicht in die Adresse schreiben, wohl aber
       in IndexedDB ablegen. So kann die Mappe ein Modul öffnen, und das
       Modul findet die Datei wieder – ohne dass jemand nochmals auswählt.
       ================================================================= */

    function speicher() {
        return new Promise((ja, nein) => {
            const anfrage = indexedDB.open('submit.mappe', 1);
            anfrage.onupgradeneeded = () => anfrage.result.createObjectStore('griffe');
            anfrage.onsuccess = () => ja(anfrage.result);
            anfrage.onerror = () => nein(anfrage.error);
        });
    }

    async function griffAblegen(g) {
        try {
            const db = await speicher();
            await new Promise((ja, nein) => {
                const t = db.transaction('griffe', 'readwrite');
                t.objectStore('griffe').put(g, 'aktuell');
                t.oncomplete = ja;
                t.onerror = () => nein(t.error);
            });
        } catch (e) { /* ohne IndexedDB geht es auch, nur unbequemer */ }
    }

    async function griffHolen() {
        try {
            const db = await speicher();
            return await new Promise(ja => {
                const t = db.transaction('griffe', 'readonly');
                const a = t.objectStore('griffe').get('aktuell');
                a.onsuccess = () => ja(a.result || null);
                a.onerror = () => ja(null);
            });
        } catch (e) { return null; }
    }

    async function griffVergessen() {
        try {
            const db = await speicher();
            const t = db.transaction('griffe', 'readwrite');
            t.objectStore('griffe').delete('aktuell');
        } catch (e) { /* egal */ }
    }

    /* =================================================================
       Format
       ================================================================= */

    function leer(projektname) {
        return {
            format: FORMAT,
            fassung: FASSUNG,
            erstellt: new Date().toISOString(),
            geaendert: new Date().toISOString(),

            kopf: {
                projekt: projektname || '',
                bauherr: '',
                ort: '',
                bauleitung: ''
            },

            /* Die Gewerke. Sie tragen die BKP-Nummer, an der sich alle
               Module ausrichten – und eine Farbe, damit dasselbe Gewerk
               überall gleich aussieht. */
            gewerke: [],

            /* Je Modul ein Dokument. Fehlt eines, gibt es das Modul in
               dieser Mappe noch nicht. */
            module: {}
        };
    }

    function pruefe(roh) {
        if (!roh || typeof roh !== 'object') throw new Error('Die Datei ist leer oder unlesbar.');
        if (roh.format && roh.format !== FORMAT) {
            throw new Error(`Das ist eine ${roh.format}-Datei, keine Projektmappe.`);
        }
        if ((roh.fassung || 1) > FASSUNG) {
            throw new Error('Die Mappe stammt aus einer neueren Fassung.');
        }

        const vorlage = leer();
        const mappe = Object.assign({}, vorlage, roh);
        mappe.kopf = Object.assign({}, vorlage.kopf, roh.kopf);
        if (!Array.isArray(mappe.gewerke)) mappe.gewerke = [];
        if (!mappe.module || typeof mappe.module !== 'object') mappe.module = {};

        mappe.gewerke.forEach(g => { if (!g.id) g.id = Hilf.id(); });
        mappe.fassung = FASSUNG;
        return mappe;
    }

    /* =================================================================
       Gewerke
       ================================================================= */

    function gewerk(mappe, id) {
        return (mappe.gewerke || []).find(g => g.id === id) || null;
    }

    function gewerkAnlegen(mappe, bkp, gname, farbe) {
        const neu = {
            id: Hilf.id(),
            bkp: String(bkp || '').trim(),
            name: String(gname || '').trim(),
            farbe: farbe || farbeFuer(mappe.gewerke.length)
        };
        mappe.gewerke.push(neu);
        mappe.gewerke.sort((a, b) => a.bkp.localeCompare(b.bkp, 'de', { numeric: true }));
        return neu;
    }

    /* Eine Reihe, die sich auch bei zwanzig Gewerken noch unterscheiden
       lässt – nicht zufällig, sonst sieht jede Mappe anders aus. */
    const FARBEN = ['#7132e3', '#0ea5e9', '#0f7a4a', '#c8871f', '#c02626',
                    '#8455f0', '#1d5fbf', '#0d9488', '#a16207', '#9333ea'];

    function farbeFuer(i) { return FARBEN[i % FARBEN.length]; }

    /**
     * Gleicht Gewerke aus einer eingelesenen Datei mit denen der Mappe ab –
     * nach BKP, sonst nach Namen. Gibt eine Vorschau zurück, damit nichts
     * stillschweigend zusammengeführt wird.
     */
    function abgleich(mappe, fremde) {
        return (fremde || []).map(f => {
            const nachBkp = f.bkp
                ? mappe.gewerke.find(g => g.bkp && g.bkp === f.bkp)
                : null;
            const nachName = nachBkp ? null
                : mappe.gewerke.find(g => g.name.toLowerCase() === String(f.name || '').toLowerCase());

            const treffer = nachBkp || nachName;
            return {
                fremd: f,
                treffer,
                art: treffer ? (nachBkp ? 'bkp' : 'name') : 'neu'
            };
        });
    }

    /* =================================================================
       Öffnen und speichern
       ================================================================= */

    const KANN_DATEI = typeof window.showOpenFilePicker === 'function';

    async function neu(projektname) {
        griff = null;
        await griffVergessen();
        name = projektname || 'Neues Projekt';
        return leer(projektname);
    }

    async function oeffnen() {
        if (!KANN_DATEI) {
            return new Promise(ja => {
                const feld = document.createElement('input');
                feld.type = 'file';
                feld.accept = '.submit,.json,application/json';
                feld.onchange = async () => {
                    const datei = feld.files && feld.files[0];
                    if (!datei) return ja(null);
                    const mappe = pruefe(JSON.parse(await datei.text()));
                    name = datei.name.replace(/\.[^.]+$/, '');
                    griff = null;
                    ja(mappe);
                };
                feld.click();
            });
        }

        const [gewaehlt] = await window.showOpenFilePicker({
            types: [{ description: 'Submit Projektmappe', accept: { 'application/json': ['.submit'] } }],
            multiple: false
        });
        return ausGriff(gewaehlt);
    }

    async function ausGriff(g) {
        const datei = await g.getFile();
        const mappe = pruefe(JSON.parse(await datei.text()));
        griff = g;
        name = datei.name.replace(/\.[^.]+$/, '');
        await griffAblegen(g);
        return mappe;
    }

    /** Versucht, die zuletzt geöffnete Mappe wieder zu öffnen. */
    async function letzteOeffnen() {
        const g = await griffHolen();
        if (!g) return null;

        // Die Erlaubnis kann abgelaufen sein – dann muss der Mensch einmal klicken.
        if (g.queryPermission) {
            const stand = await g.queryPermission({ mode: 'readwrite' });
            if (stand !== 'granted') {
                const neuerStand = await g.requestPermission({ mode: 'readwrite' });
                if (neuerStand !== 'granted') return null;
            }
        }

        try { return await ausGriff(g); }
        catch (e) { await griffVergessen(); return null; }
    }

    async function speichern(mappe) {
        mappe.geaendert = new Date().toISOString();
        const inhalt = JSON.stringify(mappe, null, 1);

        if (griff) {
            const strom = await griff.createWritable();
            await strom.write(inhalt);
            await strom.close();
            return true;
        }
        return speichernUnter(mappe);
    }

    async function speichernUnter(mappe) {
        const dateiname = (mappe.kopf.projekt || name || 'Projekt') + '.submit';
        const inhalt = JSON.stringify(mappe, null, 1);

        if (KANN_DATEI) {
            griff = await window.showSaveFilePicker({
                suggestedName: dateiname,
                types: [{ description: 'Submit Projektmappe', accept: { 'application/json': ['.submit'] } }]
            });
            const strom = await griff.createWritable();
            await strom.write(inhalt);
            await strom.close();
            name = griff.name.replace(/\.[^.]+$/, '');
            await griffAblegen(griff);
            return true;
        }

        const blob = new Blob([inhalt], { type: 'application/json' });
        const verweis = document.createElement('a');
        verweis.href = URL.createObjectURL(blob);
        verweis.download = dateiname;
        verweis.click();
        setTimeout(() => URL.revokeObjectURL(verweis.href), 4000);
        return true;
    }

    /* =================================================================
       Module ein- und aushängen
       ================================================================= */

    /** Löst ein Modul als eigene Datei heraus – zum Versenden. */
    function herausloesen(mappe, schluessel) {
        const dok = mappe.module[schluessel];
        if (!dok) return null;

        // Der Projekt-Kopf und die Gewerke reisen mit: Die Datei muss sich
        // selbst beschreiben, sonst ist sie allein nichts wert.
        const kopie = JSON.parse(JSON.stringify(dok));
        kopie.kopf = Object.assign({}, mappe.kopf);
        kopie.gewerke = JSON.parse(JSON.stringify(mappe.gewerke));

        const blob = new Blob([JSON.stringify(kopie, null, 1)], { type: 'application/json' });
        const verweis = document.createElement('a');
        verweis.href = URL.createObjectURL(blob);
        verweis.download = `${mappe.kopf.projekt || 'Projekt'} — ${MODULE[schluessel].name}.sub${schluessel}`;
        verweis.click();
        setTimeout(() => URL.revokeObjectURL(verweis.href), 4000);
        return true;
    }

    /**
     * Hängt eine Modul-Datei in die Mappe ein. Die Gewerke werden
     * abgeglichen und die fremden Kennungen auf die eigenen umgeschrieben —
     * erst dadurch ist der Balken mit der Kostenzeile verknüpft.
     */
    function einhaengen(mappe, schluessel, fremdesDok) {
        const paare = abgleich(mappe, fremdesDok.gewerke || []);
        const umschreiben = new Map();

        paare.forEach(p => {
            const ziel = p.treffer || gewerkAnlegen(mappe, p.fremd.bkp, p.fremd.name, p.fremd.farbe);
            umschreiben.set(p.fremd.id, ziel.id);
        });

        const dok = JSON.parse(JSON.stringify(fremdesDok));
        delete dok.gewerke;
        delete dok.kopf;

        // Jede Stelle, die auf ein Gewerk zeigt, auf die eigene Kennung bringen.
        JSON.stringify(dok, (schluesselName, wert) => {
            if (schluesselName === 'gewerkId' && umschreiben.has(wert)) return umschreiben.get(wert);
            return wert;
        });

        durchlaufen(dok, (o, k) => {
            if (k === 'gewerkId' && umschreiben.has(o[k])) o[k] = umschreiben.get(o[k]);
        });

        mappe.module[schluessel] = dok;
        return { neue: paare.filter(p => p.art === 'neu').length, verknuepft: paare.length };
    }

    function durchlaufen(o, tat) {
        if (!o || typeof o !== 'object') return;
        Object.keys(o).forEach(k => {
            tat(o, k);
            durchlaufen(o[k], tat);
        });
    }

    return {
        FORMAT, FASSUNG, MODULE, FARBEN,
        get name() { return name; },
        set name(n) { name = n; },
        get hatDatei() { return griff !== null; },
        get kannDatei() { return KANN_DATEI; },

        leer, pruefe, gewerk, gewerkAnlegen, farbeFuer, abgleich,
        neu, oeffnen, ausGriff, letzteOeffnen, speichern, speichernUnter,
        herausloesen, einhaengen,
        griffAblegen, griffHolen, griffVergessen
    };
})();
