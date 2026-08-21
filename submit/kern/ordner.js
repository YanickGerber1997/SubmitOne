/* =====================================================================
   Submit — Ordner-Ablage
   ---------------------------------------------------------------------
   Der dritte Adapter für app.js, neben LocalAdapter (localStorage) und
   CloudAdapter (Supabase). Er hält den Zustand nicht in einem Klumpen,
   sondern in einem Ordner:

     Arbeitsordner\
       Sanierung Müller\
         Sanierung Müller.submit      ← ein Bauvorhaben
         Pläne\  Schnitte\            ← Submit PDF arbeitet hier weiter
       Neubau Weber\
         Neubau Weber.submit
       Allgemein.subone               ← Kontakte und Dokumente, projektübergreifend

   Drei Dinge, die er besser macht als der LocalAdapter
   ----------------------------------------------------
   1. Kein 5-MB-Deckel. Der Klumpen in localStorage wächst sonst, bis
      das Speichern stillschweigend fehlschlägt.
   2. Es wird nur geschrieben, was sich geändert hat — nicht alles bei
      jeder Änderung.
   3. Zwei Personen an verschiedenen Projekten fassen verschiedene
      Dateien an. Keine Kollision mehr, wo heute eine wäre.

   Warum die Dateizugriffe hinter einer Schnittstelle liegen
   ---------------------------------------------------------
   `showDirectoryPicker` gibt es nur in Chrome und Edge, in Tauri geht
   es anders, und in einem Test gibt es gar keine Platte. Deshalb kennt
   dieser Adapter nur eine kleine Ablage-Schnittstelle mit drei
   Methoden — wer sie erfüllt, kann ihn tragen:

     ordnerListe()                 -> [Ordnername, …]
     lesen(ordner, datei)          -> { text, zeit } | null
     schreiben(ordner, datei, text)-> zeit

   `ordner === null` meint den Arbeitsordner selbst.
   ===================================================================== */

(function (global) {

    'use strict';

    const Uebersetzer = (typeof require === 'function')
        ? require('./uebersetzer.js')
        : global.Uebersetzer;

    const ENDUNG    = '.submit';
    const ALLGEMEIN = 'Allgemein.subone';

    /* Was quer über alle Projekte gilt und deshalb nicht in eine Projektdatei
       gehört: das Adressbuch, die Dokumentenliste, die persönliche
       Arbeitsplanung und die Honorareinstellungen.

       Die Planung trägt bewusst keinen Projektbezug — sie gehört der Person,
       nicht dem Bauvorhaben. Bis zum 13.08.2026 lag sie nur im Browser und war
       damit weder gesichert noch mit anderen Programmen teilbar. */
    const QUER = ['kontakte', 'dokumente', 'planung', 'honorar', 'planBausteine', 'zeit',
                  'buero', 'ganttColors', 'termine'];

    /** Aus einem Projektnamen einen zulässigen Ordnernamen machen.
        Gleiche Regel wie in pdf.js, damit beide Programme denselben
        Ordner treffen. */
    function alsOrdnername(s) {
        return String(s || '')
            .replace(/[\\/:*?"<>|]+/g, '-')
            .replace(/[.\s]+$/, '')
            .trim() || 'Projekt';
    }

    function erstelle(ablage, einstellungen) {
        const opt = einstellungen || {};

        /* Was zuletzt geschrieben wurde — daran erkennt der Adapter, was
           sich geändert hat, und was inzwischen jemand anders angefasst hat. */
        const geschrieben = new Map();   // projektId -> { ordner, datei, text, zeit }

        /* Wohin ein Projekt gehört. Wird beim Laden gefüllt und beim
           Anlegen ergänzt, damit ein umbenanntes Projekt nicht plötzlich
           in einem zweiten Ordner landet. */
        const ortVon = new Map();        // projektId -> { ordner, datei }

        function merke(projekt, ordner, datei, text, zeit) {
            geschrieben.set(projekt.id, { ordner, datei, text, zeit });
            ortVon.set(projekt.id, { ordner, datei });
        }

        /* -------------------------------------------------------------
           Laden
           ------------------------------------------------------------- */

        async function load() {
            const ordner = await ablage.ordnerListe();
            const projekte = [];
            const fehler = [];
            /* Kennungen, die schon vergeben sind — zwei Ordner dürfen
               nicht auf dasselbe Projekt zeigen. */
            const gesehen = new Set();
            const doppelte = [];

            for (const name of ordner) {
                const gefunden = await mappeImOrdner(name);
                if (!gefunden) continue;

                try {
                    const projekt = Uebersetzer.ausMappe(JSON.parse(gefunden.text));
                    /* Zwei Ordner dürfen nicht auf dasselbe Projekt zeigen.
                       Wer einen Projektordner kopiert, um ein ähnliches
                       Vorhaben zu beginnen — der naheliegendste Weg —, hätte
                       sonst zwei Dateien mit derselben Kennung: Was er im
                       einen ändert, landet beim Speichern im anderen. */
                    if (gesehen.has(projekt.id)) {
                        const alt = projekt.id;
                        projekt.id = 'p_' + Math.random().toString(36).slice(2, 9);
                        doppelte.push({ ordner: name, alt: alt, neu: projekt.id });
                    }
                    gesehen.add(projekt.id);
                    projekte.push(projekt);
                    merke(projekt, name, gefunden.datei, gefunden.text, gefunden.zeit);
                } catch (e) {
                    // Eine unlesbare Datei darf die übrigen Projekte nicht
                    // mitreissen — sonst kostet ein kaputtes Projekt alle.
                    fehler.push({ ordner: name, grund: e.message });
                }
            }

            /* Eine neue Kennung ist kein Fehler, aber eine Änderung an
               der Datei — sie gehört gesagt, sonst rätselt man beim
               nächsten Speichern. */
            if (doppelte.length && typeof opt.beiFehler === 'function') {
                opt.beiFehler(doppelte.map(d => ({ ordner: d.ordner,
                    grund: 'trug dieselbe Kennung wie ein anderes Projekt (' + d.alt + ') und hat eine neue bekommen' })));
            }
            if (fehler.length && typeof opt.beiFehler === 'function') opt.beiFehler(fehler);

            const allgemein = await lesenStill(null, ALLGEMEIN);
            const quer = { kontakte: [], dokumente: [] };
            if (allgemein) {
                try {
                    const a = JSON.parse(allgemein.text);
                    QUER.forEach(feld => { if (a[feld] !== undefined) quer[feld] = a[feld]; });
                    geschrieben.set('__allgemein', { ordner: null, datei: ALLGEMEIN, text: allgemein.text, zeit: allgemein.zeit });
                } catch (e) {
                    if (typeof opt.beiFehler === 'function') opt.beiFehler([{ ordner: ALLGEMEIN, grund: e.message }]);
                }
            }

            // Ein leerer Ordner ist kein Zustand: app.js soll dann seinen
            // Erststart-Weg gehen und nicht ein leeres Projekt anzeigen.
            const etwasQuer = QUER.some(f => {
                const w = quer[f];
                return Array.isArray(w) ? w.length > 0 : (w !== undefined && w !== null);
            });
            if (!projekte.length && !etwasQuer) return null;

            return Object.assign({ projekte }, quer);
        }

        /** Sucht die Mappendatei in einem Projektordner.
            Bevorzugt <Ordnername>.submit, sonst die erste gefundene. */
        async function mappeImOrdner(name) {
            const bevorzugt = name + ENDUNG;
            const treffer = await lesenStill(name, bevorzugt);
            if (treffer) return { datei: bevorzugt, text: treffer.text, zeit: treffer.zeit };

            if (typeof ablage.dateiListe !== 'function') return null;
            const dateien = (await ablage.dateiListe(name)) || [];
            const submit = dateien.filter(d => d.toLowerCase().endsWith(ENDUNG)).sort();
            if (!submit.length) return null;

            const gelesen = await lesenStill(name, submit[0]);
            return gelesen ? { datei: submit[0], text: gelesen.text, zeit: gelesen.zeit } : null;
        }

        async function lesenStill(ordner, datei) {
            try { return await ablage.lesen(ordner, datei); }
            catch (e) { return null; }
        }

        /* -------------------------------------------------------------
           Speichern
           ------------------------------------------------------------- */

        /**
         * Schreibt nur, was sich geändert hat.
         * Hat jemand anders die Datei inzwischen angefasst, wird sie NICHT
         * überschrieben — stattdessen meldet sich `beiKonflikt`.
         *
         * @returns { geschrieben:[…], uebersprungen:[…], konflikte:[…] }
         */
        async function save(state) {
            const s = state || {};
            const bericht = { geschrieben: [], uebersprungen: [], konflikte: [] };

            for (const projekt of (s.projekte || [])) {
                const mappe = Uebersetzer.zuMappe(projekt);
                const text = JSON.stringify(mappe, null, 1);

                const zuletzt = geschrieben.get(projekt.id);
                const ort = ortVon.get(projekt.id) || neuerOrt(projekt);

                // Unverändert? `geaendert` steht in jeder Mappe und wäre
                // bei jedem Vergleich anders — deshalb ohne diesen Stempel.
                if (zuletzt && ohneStempel(zuletzt.text) === ohneStempel(text)) {
                    bericht.uebersprungen.push(projekt.id);
                    continue;
                }

                if (zuletzt) {
                    const jetzt = await lesenStill(ort.ordner, ort.datei);
                    if (jetzt && zuletzt.zeit != null && jetzt.zeit != null && jetzt.zeit !== zuletzt.zeit) {
                        bericht.konflikte.push({
                            projektId: projekt.id,
                            name: projekt.name,
                            ordner: ort.ordner,
                            datei: ort.datei,
                            fremderText: jetzt.text,
                            eigenerText: text
                        });
                        continue;                    // nicht überschreiben
                    }
                }

                const zeit = await ablage.schreiben(ort.ordner, ort.datei, text);
                merke(projekt, ort.ordner, ort.datei, text, zeit);
                bericht.geschrieben.push(projekt.id);
            }

            await allgemeinSchreiben(s, bericht);

            if (bericht.konflikte.length && typeof opt.beiKonflikt === 'function') {
                opt.beiKonflikt(bericht.konflikte);
            }
            return bericht;
        }

        function neuerOrt(projekt) {
            const ordner = alsOrdnername(projekt.name);
            const ort = { ordner, datei: ordner + ENDUNG };
            ortVon.set(projekt.id, ort);
            return ort;
        }

        async function allgemeinSchreiben(s, bericht) {
            const inhalt = { format: 'submit.allgemein', fassung: 1 };
            QUER.forEach(feld => {
                if (s[feld] !== undefined) inhalt[feld] = s[feld];
                else if (feld === 'kontakte' || feld === 'dokumente') inhalt[feld] = [];
            });
            const text = JSON.stringify(inhalt, null, 1);

            const zuletzt = geschrieben.get('__allgemein');
            if (zuletzt && zuletzt.text === text) { bericht.uebersprungen.push('__allgemein'); return; }

            const zeit = await ablage.schreiben(null, ALLGEMEIN, text);
            geschrieben.set('__allgemein', { ordner: null, datei: ALLGEMEIN, text, zeit });
            bericht.geschrieben.push('__allgemein');
        }

        /** Ein Zeitstempel allein ist keine Änderung.
            `erstellt` gehört ausdrücklich dazu: Vor dem 14.08.2026 blendete
            diese Funktion nur `geaendert` aus, und weil das Erstelldatum
            damals bei jedem Serialisieren neu entstand, galt eine Datei
            als geändert, sobald zwei Aufrufe in verschiedene Millisekunden
            fielen. Die Ursache ist behoben; die Prüfung bleibt trotzdem
            unempfindlich gegen beide Stempel. */
        function ohneStempel(text) {
            return String(text).replace(/"(geaendert|erstellt)":\s*"[^"]*",?/g, '');
        }

        /* -------------------------------------------------------------
           Nach draussen — die Schnittstelle, die app.js erwartet
           ------------------------------------------------------------- */

        return {
            name: 'ordner',
            load,
            save,

            // für Oberfläche und Prüfung
            get orte() { return new Map(ortVon); },
            alsOrdnername,
            ENDUNG,
            ALLGEMEIN
        };
    }


    const Ordner = { erstelle, alsOrdnername, ENDUNG, ALLGEMEIN };

    if (typeof module !== 'undefined' && module.exports) module.exports = Ordner;
    else global.Ordner = Ordner;

})(typeof globalThis !== 'undefined' ? globalThis : this);
