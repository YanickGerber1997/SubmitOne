/* =====================================================================
   Submit — Ablage im Browser
   ---------------------------------------------------------------------
   Erfüllt die Ablage-Schnittstelle aus ordner.js mit echten Dateien:

     ordnerListe()                  -> [Ordnername, …]
     dateiListe(ordner)             -> [Dateiname, …]
     lesen(ordner, datei)           -> { text, zeit } | null
     schreiben(ordner, datei, text) -> zeit

   `zeit` ist der Änderungszeitpunkt der Datei. Daran erkennt der Adapter,
   ob jemand anders sie angefasst hat, seit er sie gelesen hat.

   Der Ordnergriff überlebt den Neustart
   -------------------------------------
   Ein Ordnergriff lässt sich nicht in die Adresse schreiben, wohl aber in
   IndexedDB ablegen — dasselbe Verfahren wie in mappe.js. Beim nächsten
   Start ist der Arbeitsordner dadurch sofort wieder da, sofern die Erlaubnis
   noch gilt. Gilt sie nicht mehr, wird NICHT nachgefragt: ein Dialog beim
   Programmstart, den niemand angefordert hat, wird ohnehin weggeklickt.

   Grenze: `showDirectoryPicker` gibt es nur in Chrome und Edge am Rechner.
   In Firefox, Safari und auf dem Handy meldet `kann()` falsch — dort bleibt
   es beim bisherigen Weg. In Tauri tritt später eine eigene Ablage an diese
   Stelle; am Adapter darüber ändert sich dadurch nichts.
   ===================================================================== */

(function (global) {

    'use strict';

    const DB      = 'submit.ordner';
    const LADEN   = 'griffe';
    const KEY     = 'arbeitsordner';

    function kann() {
        return typeof global.showDirectoryPicker === 'function';
    }

    /* =================================================================
       Der Griff in IndexedDB
       ================================================================= */

    function speicher() {
        return new Promise((ja, nein) => {
            const anfrage = global.indexedDB.open(DB, 1);
            anfrage.onupgradeneeded = () => anfrage.result.createObjectStore(LADEN);
            anfrage.onsuccess = () => ja(anfrage.result);
            anfrage.onerror = () => nein(anfrage.error);
        });
    }

    async function merken(griff) {
        try {
            const db = await speicher();
            await new Promise((ja, nein) => {
                const t = db.transaction(LADEN, 'readwrite');
                t.objectStore(LADEN).put(griff, KEY);
                t.oncomplete = ja;
                t.onerror = () => nein(t.error);
            });
        } catch (e) { /* ohne IndexedDB geht es auch, nur unbequemer */ }
    }

    async function gemerkt() {
        try {
            const db = await speicher();
            return await new Promise(ja => {
                const t = db.transaction(LADEN, 'readonly');
                const a = t.objectStore(LADEN).get(KEY);
                a.onsuccess = () => ja(a.result || null);
                a.onerror = () => ja(null);
            });
        } catch (e) { return null; }
    }

    async function vergessen() {
        try {
            const db = await speicher();
            const t = db.transaction(LADEN, 'readwrite');
            t.objectStore(LADEN).delete(KEY);
        } catch (e) { /* egal */ }
    }

    /* =================================================================
       Die Ablage über einem Ordnergriff
       ================================================================= */

    function alsAblage(wurzel) {

        async function ordnerHandle(name, anlegen) {
            if (name === null || name === undefined) return wurzel;
            return wurzel.getDirectoryHandle(name, { create: !!anlegen });
        }

        return {

            async ordnerListe() {
                const namen = [];
                for await (const [name, h] of wurzel.entries()) {
                    if (h.kind === 'directory' && name.charAt(0) !== '.') namen.push(name);
                }
                return namen.sort((a, b) => a.localeCompare(b, 'de'));
            },

            async dateiListe(ordner) {
                const h = await ordnerHandle(ordner, false);
                const namen = [];
                for await (const [name, e] of h.entries()) {
                    if (e.kind === 'file') namen.push(name);
                }
                return namen.sort((a, b) => a.localeCompare(b, 'de'));
            },

            async lesen(ordner, datei) {
                const h = await ordnerHandle(ordner, false);
                const fh = await h.getFileHandle(datei, { create: false });
                const f = await fh.getFile();
                return { text: await f.text(), zeit: f.lastModified };
            },

            async schreiben(ordner, datei, text) {
                const h = await ordnerHandle(ordner, true);
                const fh = await h.getFileHandle(datei, { create: true });
                const strom = await fh.createWritable();
                await strom.write(text);
                await strom.close();
                // Nach dem Schreiben den echten Zeitstempel holen — er ist
                // der Massstab, an dem eine fremde Änderung auffällt.
                const f = await fh.getFile();
                return f.lastModified;
            }
        };
    }

    /* =================================================================
       Wählen und wiederfinden
       ================================================================= */

    /** Fragt nach einem Ordner. Gibt null zurück, wenn abgebrochen wird. */
    async function waehlen() {
        if (!kann()) throw new Error('Dieser Browser kann keine Ordner öffnen. Chrome oder Edge am Rechner verwenden.');
        let griff;
        try {
            griff = await global.showDirectoryPicker({ mode: 'readwrite', id: 'submitone' });
        } catch (e) {
            return null;                       // abgebrochen ist kein Fehler
        }
        return { griff, name: griff.name, ablage: alsAblage(griff) };
    }

    /**
     * Holt den zuletzt gewählten Ordner zurück.
     * @param fragen  false = nur nehmen, wenn die Erlaubnis noch gilt
     */
    async function letzter(fragen) {
        const griff = await gemerkt();
        if (!griff) return null;

        if (typeof griff.queryPermission === 'function') {
            let stand = await griff.queryPermission({ mode: 'readwrite' });
            if (stand !== 'granted') {
                if (!fragen) return null;      // beim Start nicht nachfragen
                stand = await griff.requestPermission({ mode: 'readwrite' });
                if (stand !== 'granted') return null;
            }
        }

        try {
            // Probe: Ist der Ordner überhaupt noch da?
            await griff.entries().next();
            return { griff, name: griff.name, ablage: alsAblage(griff) };
        } catch (e) {
            await vergessen();
            return null;
        }
    }

    const AblageBrowser = { kann, waehlen, letzter, merken, vergessen, alsAblage };

    if (typeof module !== 'undefined' && module.exports) module.exports = AblageBrowser;
    else global.AblageBrowser = AblageBrowser;

})(typeof globalThis !== 'undefined' ? globalThis : this);
