/* =====================================================================
   Submit — Wochenraster
   ---------------------------------------------------------------------
   Das Zeitraster einer Woche: Stundenlinien, Blöcke, Ziehen, Erzeugen,
   Verschieben, Ränder. Ohne Wissen darüber, was ein Block bedeutet —
   ob Zeiteintrag, Termin oder geplantes Zeitfenster, entscheidet die
   aufrufende Anwendung.

   Warum es diese Datei gibt
   -------------------------
   Bis zum 14.08.2026 gab es das Raster zweimal: in SubZeit als `bahn.js`
   (502 Zeilen) und in SubmitOne als `calTimeGrid` samt Ziehlogik. Beide
   konnten dasselbe, sahen aber verschieden aus und mussten doppelt
   gepflegt werden. Wer eine Kante verschob, verschob sie in einem
   Programm.

   Warum es mehr kann, als eines der beiden brauchte
   -------------------------------------------------
   Beim Zusammenlegen am 14.08.2026 zeigte der Vergleich, dass jede Seite
   etwas hatte, das der anderen fehlte: SubZeit die gestauchte Nachtachse,
   den Abbruch mit Escape, den Tageswechsel mitten im Zug und die
   Bedienung mit dem Finger; SubmitOne das ganztägige Band, das
   Aufgabenband und mehrere Projekte nebeneinander.

   Das Raster kann deshalb beides. Hätte es nur den kleinsten gemeinsamen
   Nenner gekonnt, wären beide Programme gleich geworden — aber beide
   schlechter.

   Die Anwendung sagt, WAS gezeichnet wird und was bei einer Handlung
   geschehen soll. Das Raster kümmert sich um das WIE: Geometrie,
   Zeiger, Rasterung, Überschneidungen im Layout.

   Zeiten sind Minuten ab Mitternacht, Daten sind JJJJ-MM-TT — dieselbe
   Darstellung wie in der Datei und in zeitrechnung.js.
   ===================================================================== */

(function (global) {

    'use strict';

    const KLASSE = 'wr';                 // Namensraum aller Klassen
    const TAG    = 24 * 60;

    /* ---- Kleine Helfer ---- */

    function el(tag, klassen, text) {
        const k = document.createElement(tag);
        if (klassen) k.className = klassen;
        if (text != null) k.textContent = text;
        return k;
    }
    const klemme = (x, min, max) => Math.max(min, Math.min(max, x));
    const uhr = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.round(m) % 60).padStart(2, '0');


    /* =================================================================
       Die Achse
       -----------------------------------------------------------------
       Zwei Bauarten, weil die beiden Programme verschieden hinsehen.

       `linear`    — ein Ausschnitt des Tages, jede Stunde gleich hoch.
                     Der Arbeitsplan zeigt sieben bis neunzehn Uhr; was
                     nachts liegt, gibt es dort ohnehin nicht.

       `gestaucht` — der GANZE Tag ohne Rollen. Das geht nur, wenn nicht
                     jede Stunde gleich viel Platz bekommt: Das
                     Arbeitsfenster läuft im vollen Massstab, Nacht und
                     Abend sind zusammengedrückt. Wer um 5:40 anfängt,
                     sieht das — ohne dass die Nacht die Fläche frisst.

       Beide liefern dieselben vier Dinge, deshalb kennt der Rest des
       Rasters den Unterschied nicht:

         anteil(minute) -> 0..1     wo im Feld die Minute liegt
         minuteBei(a)   -> Minute   die Umkehrung
         hoehe                      Vorschlagshöhe in Pixeln
         striche        -> [{minute, stunde, leise}]
       ================================================================= */

    function achseLinear(vonH, bisH, hps) {
        const von = vonH * 60, spanne = (bisH - vonH) * 60;
        const striche = [];
        for (let h = vonH; h <= bisH; h++) striche.push({ minute: h * 60, stunde: h, leise: false });
        return {
            art: 'linear', vonH, bisH,
            hoehe: (bisH - vonH) * hps,
            anteil: m => (m - von) / spanne,
            minuteBei: a => klemme(von + a * spanne, von, von + spanne),
            striche
        };
    }

    function achseGestaucht(vonH, bisH, hps, mass) {
        const von = vonH * 60, bis = bisH * 60;
        const m2 = mass > 0 ? mass : 0.4;

        // Gewicht statt Minuten: Innerhalb des Arbeitsfensters zählt eine
        // Minute voll, davor und danach nur `mass`.
        const gew = m => {
            if (m <= von) return m * m2;
            if (m <= bis) return von * m2 + (m - von);
            return von * m2 + (bis - von) + (m - bis) * m2;
        };
        const vorArbeit  = von * m2;
        const nachArbeit = vorArbeit + (bis - von);
        const zurueck = w => {
            if (w <= vorArbeit)  return w / m2;
            if (w <= nachArbeit) return von + (w - vorArbeit);
            return bis + (w - nachArbeit) / m2;
        };
        const gesamt = gew(TAG);

        /* Ausserhalb des Arbeitsfensters nur jede zweite Stunde
           beschriften — sonst kleben die Zahlen aufeinander. */
        const striche = [];
        for (let h = 0; h < 24; h++) {
            const leise = h < vonH || h >= bisH;
            if (leise && h % 2 !== 0) continue;
            striche.push({ minute: h * 60, stunde: h, leise });
        }

        return {
            art: 'gestaucht', vonH, bisH,
            hoehe: gesamt / 60 * hps,
            anteil: m => gew(klemme(m, 0, TAG)) / gesamt,
            minuteBei: a => klemme(zurueck(klemme(a, 0, 1) * gesamt), 0, TAG),
            striche
        };
    }

    /**
     * Baut die Achse aus den Angaben und dem, was tatsächlich dasteht.
     * Ein Block um sechs Uhr früh darf nicht abgeschnitten werden —
     * deshalb dehnt sich das Arbeitsfenster über die Blöcke.
     */
    function achseBauen(o) {
        const hps = Number(o.hoeheProStunde) || 44;
        let vonH = Number.isFinite(o.vonStunde) ? o.vonStunde : 7;
        let bisH = Number.isFinite(o.bisStunde) ? o.bisStunde : 19;

        (o.bloecke || []).forEach(b => {
            if (!Number.isFinite(b.von)) return;
            vonH = Math.min(vonH, Math.floor(b.von / 60));
            bisH = Math.max(bisH, Math.ceil((Number.isFinite(b.bis) ? b.bis : b.von + 60) / 60));
        });

        vonH = klemme(vonH, 0, 14);
        bisH = klemme(Math.max(bisH, vonH + 6), vonH + 6, 24);

        return (o.achse === 'gestaucht')
            ? achseGestaucht(vonH, bisH, hps, Number(o.nachtMass))
            : achseLinear(vonH, bisH, hps);
    }


    /* =================================================================
       Zeichnen
       ================================================================= */

    /**
     * @param ziel  Element, in das gezeichnet wird (wird geleert)
     * @param o     {
     *   tage:        ['2026-08-10', …]
     *   achse:       'linear' | 'gestaucht'      Vorgabe linear
     *   vonStunde, bisStunde, hoeheProStunde, nachtMass
     *   fuellt:      true = das Raster füllt sein Feld (Höhe aus dem CSS)
     *   raster:      Minuten, auf die gerastet wird (Vorgabe 15)
     *   heute:       'JJJJ-MM-TT'
     *   jetzt:       Minute der Jetzt-Linie
     *   bloecke:     [{id, datum, von, bis, titel, unter, farbe, klasse, fest}]
     *   ganztags:    [{datum, titel, farbe, klasse}]
     *   hintergrund(iso): -> [{von, bis, klasse, farbe, titel}]   optional
     *   kopf(iso):        -> {titel, unter, klasse} | Element      optional
     *   fuss(iso):        -> Element | null                        optional
     *   blockInhalt(b):   -> Element | null    ersetzt Zeit+Titel   optional
     *   beiNeu(datum, von, bis)
     *   beiGeaendert(id, datum, von, bis)
     *   beiKlick(id, ereignis)
     *   beiDoppelklick(id, ereignis)
     *   beiMenu(id, ereignis)
     *   beiTagKlick(datum, minute)
     *   beiFussKlick(datum)
     *   beiKopfKlick(datum)
     * }
     */
    function zeichne(ziel, o) {
        if (!ziel) return null;
        loese(ziel);

        const tage   = o.tage || [];
        const raster = Number(o.raster) || 15;
        const achse  = achseBauen(o);
        const fuellt = !!o.fuellt;

        /* Im füllenden Betrieb rechnet alles in Prozent, sonst in Pixeln.
           So passt sich SubZeit der Fensterhöhe an und der Arbeitsplan
           behält seine feste Stundenhöhe — mit derselben Rechnung. */
        const platz = m => fuellt ? (achse.anteil(m) * 100) + '%' : (achse.anteil(m) * achse.hoehe) + 'px';
        const spanne = (von, bis) => fuellt
            ? ((achse.anteil(bis) - achse.anteil(von)) * 100) + '%'
            : Math.max(16, (achse.anteil(bis) - achse.anteil(von)) * achse.hoehe) + 'px';
        const aufRaster = m => Math.round(m / raster) * raster;

        ziel.innerHTML = '';
        ziel.className = KLASSE
            + (fuellt ? ' fuellt' : '')
            + (tage.length > 5 ? ' dicht' : '')
            + (tage.length > 1 ? ' woche' : ' tag');
        ziel.style.setProperty('--wr-spalten', tage.length);

        const spaltenGitter = () => {
            const s = el('div', KLASSE + '-spalten');
            s.style.gridTemplateColumns = 'repeat(' + tage.length + ',1fr)';
            return s;
        };

        /* ---- Kopfzeile ---- */
        const kopfReihe = el('div', KLASSE + '-kopfreihe');
        kopfReihe.appendChild(el('div', KLASSE + '-rinne'));
        const kopfSpalten = spaltenGitter();
        tage.forEach(iso => {
            const info = o.kopf ? o.kopf(iso) : null;
            const k = el('div', KLASSE + '-kopf' + (iso === o.heute ? ' heute' : ''));
            k.dataset.datum = iso;
            if (info && info.nodeType === 1) {
                k.appendChild(info);
            } else {
                if (info && info.klasse) k.className += ' ' + info.klasse;
                k.appendChild(el('strong', null, (info && info.titel) || iso));
                if (info && info.unter) k.appendChild(el('span', null, info.unter));
                if (info && info.rechts) k.appendChild(el('span', KLASSE + '-kopf-rechts', info.rechts));
            }
            kopfSpalten.appendChild(k);
        });
        kopfReihe.appendChild(kopfSpalten);
        ziel.appendChild(kopfReihe);

        /* ---- Ganztägiges ---- */
        if ((o.ganztags || []).length) {
            const r = el('div', KLASSE + '-ganztagsreihe');
            r.appendChild(el('div', KLASSE + '-rinne klein', 'ganztägig'));
            const s = spaltenGitter();
            tage.forEach(iso => {
                const z = el('div', KLASSE + '-ganztags');
                z.dataset.datum = iso;
                (o.ganztags || []).filter(g => g.datum === iso).forEach(g => {
                    const b = el('div', KLASSE + '-gt' + (g.klasse ? ' ' + g.klasse : ''), g.titel || '');
                    if (g.farbe) b.style.setProperty('--wr-farbe', g.farbe);
                    if (g.titelVoll) b.title = g.titelVoll;
                    z.appendChild(b);
                });
                s.appendChild(z);
            });
            r.appendChild(s);
            ziel.appendChild(r);
        }

        /* ---- Körper ---- */
        const koerper = el('div', KLASSE + '-koerper');

        const rinne = el('div', KLASSE + '-stunden');
        achse.striche.forEach(t => {
            const s = el('div', KLASSE + '-stunde' + (t.leise ? ' leise' : ''),
                String(t.stunde).padStart(2, '0') + ':00');
            s.style.top = platz(t.minute);
            rinne.appendChild(s);
        });
        koerper.appendChild(rinne);

        const spalten = spaltenGitter();

        tage.forEach(iso => {
            const sp = el('div', KLASSE + '-spalte' + (iso === o.heute ? ' heute' : ''));
            sp.dataset.datum = iso;
            if (!fuellt) sp.style.height = achse.hoehe + 'px';

            /* Die gestauchten Randstunden bekommen ihr Band von selbst.
               Das ist keine Sache der Anwendung, sondern der Achse: Wo
               der Massstab wechselt, muss man es sehen — sonst wirkt ein
               Block dort kürzer, als er ist. */
            const baender = [];
            if (achse.art === 'gestaucht') {
                if (achse.vonH > 0)  baender.push({ von: 0, bis: achse.vonH * 60, klasse: 'nacht' });
                if (achse.bisH < 24) baender.push({ von: achse.bisH * 60, bis: TAG, klasse: 'nacht' });
            }

            /* Hintergrundbänder: Feiertag, Absenz — was die Anwendung
               eben unterlegen will. Sie liegen unter allem anderen und
               nehmen keine Zeiger an. */
            baender.concat(o.hintergrund ? (o.hintergrund(iso) || []) : []).forEach(h => {
                const b = el('div', KLASSE + '-band' + (h.klasse ? ' ' + h.klasse : ''));
                b.style.top = platz(h.von);
                b.style.height = spanne(h.von, h.bis);
                if (h.farbe) b.style.setProperty('--wr-farbe', h.farbe);
                if (h.titel) b.appendChild(el('span', null, h.titel));
                sp.appendChild(b);
            });

            achse.striche.forEach(t => {
                const l = el('div', KLASSE + '-linie' + (t.leise ? ' leise' : ''));
                l.style.top = platz(t.minute);
                sp.appendChild(l);
                /* Die halbe Stunde nur im vollen Massstab — in der
                   gestauchten Nacht wäre sie ein Strich auf dem Strich. */
                if (!t.leise && t.minute + 60 <= achse.bisH * 60) {
                    const hl = el('div', KLASSE + '-linie halb');
                    hl.style.top = platz(t.minute + 30);
                    sp.appendChild(hl);
                }
            });

            if (iso === o.heute && o.jetzt != null) {
                const j = el('div', KLASSE + '-jetzt');
                j.style.top = platz(o.jetzt);
                sp.appendChild(j);
            }

            /* Blöcke, nebeneinander wenn sie sich überschneiden. */
            const eigene = (o.bloecke || []).filter(b => b.datum === iso)
                .sort((a, b) => a.von - b.von);
            /* Durchlässige Blöcke — Vorschläge — zählen bei der Aufteilung
               nicht mit. Sonst schrumpfte ein erfasster Eintrag auf die
               halbe Breite, nur weil daneben ein Vorschlag liegt, den man
               gar nicht anfassen kann. */
            const spuren = spurenVerteilen(eigene.filter(b => !b.durchlaessig));
            eigene.forEach(b => {
                const bis = Number.isFinite(b.bis) ? b.bis : b.von + 60;
                const k = el('div', KLASSE + '-block'
                    + (b.klasse ? ' ' + b.klasse : '')
                    + (b.fest ? ' fest' : '')
                    /* Durchlässig: sichtbar, aber der Zeiger geht hindurch.
                       So kann man über einen Vorschlag hinweg eigene Zeit
                       aufziehen, statt ihn anfassen zu müssen. */
                    + (b.durchlaessig ? ' durch' : '')
                    + (Number.isFinite(b.bis) ? '' : ' laeuft'));
                k.dataset.id  = b.id;
                k.dataset.von = b.von;
                k.dataset.bis = bis;
                k.style.top    = platz(b.von);
                k.style.height = spanne(b.von, bis);

                /* Der Einzug von zwei Pixeln lässt die Spaltenlinie
                   durchscheinen — sonst kleben die Blöcke am Rand und
                   man sieht nicht mehr, wo der Tag aufhört. */
                const s = spuren.get(b.id) || { spur: 0, anzahl: 1 };
                k.style.left  = 'calc(' + (s.spur / s.anzahl * 100) + '% + 2px)';
                k.style.width = 'calc(' + (100 / s.anzahl) + '% - 4px)';
                if (b.farbe) k.style.setProperty('--wr-farbe', b.farbe);
                if (b.titelVoll) k.title = b.titelVoll;

                const eigen = o.blockInhalt ? o.blockInhalt(b) : null;
                if (eigen) {
                    k.appendChild(eigen);
                } else {
                    k.appendChild(el('span', KLASSE + '-block-zeit',
                        uhr(b.von) + '–' + (Number.isFinite(b.bis) ? uhr(bis) : '…')));
                    k.appendChild(el('span', KLASSE + '-block-titel', b.titel || ''));
                    if (b.unter) k.appendChild(el('span', KLASSE + '-block-unter', b.unter));
                }
                if (!b.fest) {
                    k.appendChild(el('div', KLASSE + '-griff oben'));
                    k.appendChild(el('div', KLASSE + '-griff unten'));
                }
                sp.appendChild(k);
            });

            /* Eine leere Spalte soll sagen, was man mit ihr tun kann.
               Ein leeres Feld erklärt sich nicht von selbst. */
            if (!eigene.length && o.leer) {
                const hinweis = o.leer(iso);
                if (hinweis) {
                    const h = el('div', KLASSE + '-leer');
                    h.appendChild(hinweis);
                    sp.appendChild(h);
                }
            }

            spalten.appendChild(sp);
        });
        koerper.appendChild(spalten);
        ziel.appendChild(koerper);

        /* ---- Fussband (Aufgaben, Summen …) ---- */
        if (o.fuss) {
            const r = el('div', KLASSE + '-fussreihe');
            r.appendChild(el('div', KLASSE + '-rinne klein', o.fussTitel || ''));
            const s = spaltenGitter();
            tage.forEach(iso => {
                const z = el('div', KLASSE + '-fuss' + (iso === o.heute ? ' heute' : ''));
                z.dataset.datum = iso;
                const inhalt = o.fuss(iso);
                if (inhalt) z.appendChild(inhalt);
                s.appendChild(z);
            });
            r.appendChild(s);
            ziel.appendChild(r);
        }

        binde(ziel, { raster, achse, platz, spanne, aufRaster, fuellt }, o);
        return achse;
    }

    /**
     * Überschneidende Blöcke nebeneinander legen.
     * Ohne das läge ein Termin auf dem anderen und man sähe nur den
     * oberen — auf einem Wochenplan ist gerade die Überschneidung die
     * Information, die zählt.
     */
    function spurenVerteilen(bloecke) {
        const aus = new Map();
        let gruppe = [], gruppenEnde = -1;

        const abschliessen = () => {
            if (!gruppe.length) return;
            const spuren = [];
            gruppe.forEach(b => {
                let i = 0;
                while (spuren[i] != null && spuren[i] > b.von) i++;
                spuren[i] = Number.isFinite(b.bis) ? b.bis : b.von + 60;
                aus.set(b.id, { spur: i, anzahl: 0 });
            });
            gruppe.forEach(b => { const s = aus.get(b.id); if (s) s.anzahl = spuren.length; });
            gruppe = [];
        };

        bloecke.forEach(b => {
            const ende = Number.isFinite(b.bis) ? b.bis : b.von + 60;
            if (gruppe.length && b.von >= gruppenEnde) abschliessen();
            gruppe.push(b);
            gruppenEnde = Math.max(gruppenEnde, ende);
        });
        abschliessen();
        return aus;
    }


    /* =================================================================
       Ziehen: erzeugen, verschieben, Ränder
       -----------------------------------------------------------------
       Eine einzige Zustandsmaschine für alle drei. Ob ein Zug etwas Neues
       anlegt oder Bestehendes ändert, entscheidet sich beim Druck auf die
       Maustaste — danach ist die Rechnung dieselbe.

       Zeiger, nicht Maus: `pointer`-Ereignisse kommen auch vom Finger und
       vom Stift. Mit `mousedown` liesse sich das Raster auf einem Tablet
       nicht bedienen, und genau dort wird Zeit erfasst.
       ================================================================= */

    function binde(wurzel, geo, o) {
        let zug = null;

        const spalteBei = ziel => (ziel && ziel.closest) ? ziel.closest('.' + KLASSE + '-spalte') : null;

        /* Welche Spalte liegt unter dieser x-Stelle? Beim Verschieben darf
           der Block den Tag wechseln — beim Aufziehen und an den Rändern
           nicht, sonst versetzt ein seitlicher Ruck den Termin um einen Tag. */
        function spalteAn(x) {
            const alle = wurzel.querySelectorAll('.' + KLASSE + '-spalte');
            for (const s of alle) {
                const r = s.getBoundingClientRect();
                if (x >= r.left && x <= r.right) return s;
            }
            return null;
        }

        function minuteIn(sp, ev) {
            const r = sp.getBoundingClientRect();
            return geo.aufRaster(geo.achse.minuteBei(klemme((ev.clientY - r.top) / r.height, 0, 1)));
        }

        wurzel.addEventListener('pointerdown', ev => {
            if (ev.button !== 0) return;
            const sp = spalteBei(ev.target);
            if (!sp) return;
            /* Was die Anwendung selbst in den Block gelegt hat — ein
               Löschknopf etwa — soll klicken und nicht ziehen. */
            if (ev.target.closest('button, a, input, select, textarea')) return;

            const block = ev.target.closest ? ev.target.closest('.' + KLASSE + '-block') : null;
            const griff = ev.target.closest ? ev.target.closest('.' + KLASSE + '-griff') : null;
            if (block && block.classList.contains('fest')) return;

            const minute = minuteIn(sp, ev);

            if (block) {
                const von = Number(block.dataset.von);
                const bis = Number(block.dataset.bis);
                zug = {
                    art: griff ? (griff.classList.contains('oben') ? 'oben' : 'unten') : 'schieben',
                    el: block, id: block.dataset.id,
                    spalte: sp, alteSpalte: sp,
                    von, bis, altVon: von, altBis: bis,
                    anker: minute, bewegt: false
                };
                block.classList.add('aktiv');
            } else {
                zug = {
                    art: 'neu', spalte: sp, alteSpalte: sp,
                    von: minute, bis: minute + geo.raster,
                    anker: minute, bewegt: false
                };
                zug.el = el('div', KLASSE + '-block neu aktiv');
                zug.el.appendChild(el('span', KLASSE + '-block-zeit', ''));
                sp.appendChild(zug.el);
            }

            zug.startX = ev.clientX;
            zug.startY = ev.clientY;

            wurzel.classList.add('zieht');
            anhaengen();
            zeigen();
            ev.preventDefault();
        });

        function zeigen() {
            if (!zug || !zug.el) return;
            zug.el.style.top = geo.platz(zug.von);
            zug.el.style.height = geo.spanne(zug.von, zug.bis);
            const z = zug.el.querySelector('.' + KLASSE + '-block-zeit');
            if (z) z.textContent = uhr(zug.von) + '–' + uhr(zug.bis);
            hinweis();
        }

        /* Die laufende Zeit gross am Block: Beim Ziehen schaut man auf den
           Zeiger, nicht auf die Stundenleiste am Rand. */
        function hinweis() {
            if (!zug) return;
            let h = zug.spalte.querySelector('.' + KLASSE + '-hinweis');
            if (!h) { h = el('div', KLASSE + '-hinweis'); zug.spalte.appendChild(h); }
            const dauer = zug.bis - zug.von;
            h.textContent = uhr(zug.von) + ' – ' + uhr(zug.bis) + '  ·  '
                + Math.floor(dauer / 60) + ':' + String(dauer % 60).padStart(2, '0') + ' h';
            h.style.top = geo.platz(zug.von);
        }

        function hinweiseWeg() {
            wurzel.querySelectorAll('.' + KLASSE + '-hinweis').forEach(h => h.remove());
        }

        function bewegen(ev) {
            if (!zug) return;
            ev.preventDefault();
            /* Erst ab drei Pixeln gilt es als Zug. Darunter ist es ein
               Klick mit zittriger Hand, und der soll öffnen, nicht
               verschieben. */
            if (Math.abs(ev.clientY - zug.startY) > 3 || Math.abs(ev.clientX - zug.startX) > 3) {
                zug.bewegt = true;
            }

            if (zug.art === 'schieben') {
                const ziel = spalteAn(ev.clientX);
                if (ziel && ziel !== zug.spalte) {
                    zug.spalte.querySelectorAll('.' + KLASSE + '-hinweis').forEach(h => h.remove());
                    ziel.appendChild(zug.el);
                    zug.spalte = ziel;
                }
            }

            const zeiger = minuteIn(zug.spalte, ev);

            if (zug.art === 'neu') {
                zug.von = Math.min(zug.anker, zeiger);
                zug.bis = Math.max(zug.anker, zeiger);
                if (zug.bis - zug.von < geo.raster) zug.bis = zug.von + geo.raster;

            } else if (zug.art === 'schieben') {
                const laenge = zug.altBis - zug.altVon;
                let von = zug.altVon + (zeiger - zug.anker);
                if (von < 0) von = 0;
                if (von + laenge > TAG) von = TAG - laenge;
                zug.von = von; zug.bis = von + laenge;

            } else if (zug.art === 'oben') {
                zug.von = Math.min(zeiger, zug.altBis - geo.raster);
                zug.bis = zug.altBis;

            } else {
                zug.von = zug.altVon;
                zug.bis = Math.max(zeiger, zug.altVon + geo.raster);
            }
            zeigen();
        }

        function aufraeumen() {
            abhaengen();
            wurzel.classList.remove('zieht');
            hinweiseWeg();
        }

        function loslassen(ev) {
            if (!zug) return;
            const z = zug; zug = null;
            aufraeumen();

            const datum = z.spalte.dataset.datum;

            if (z.art === 'neu') {
                if (z.el && z.el.parentNode) z.el.parentNode.removeChild(z.el);
                if (!z.bewegt) { if (o.beiTagKlick) o.beiTagKlick(datum, z.von); return; }
                if (o.beiNeu) o.beiNeu(datum, z.von, z.bis);
                return;
            }

            if (z.el) z.el.classList.remove('aktiv');

            /* Ein Zug, der auf derselben Viertelstunde endet, ist keiner.
               Ohne diese Prüfung versetzte schon das Zittern beim Klicken
               den Block um eine Rasterstufe. */
            const gleich = z.von === z.altVon && z.bis === z.altBis && z.spalte === z.alteSpalte;
            if (gleich) {
                // Die Ausgangslage aktiv wiederherstellen: Ohne Neuzeichnen
                // fiele ein Block ohne Höhenangabe an den oberen Rand.
                z.el.style.top = geo.platz(z.altVon);
                z.el.style.height = geo.spanne(z.altVon, z.altBis);
                if (o.beiKlick) o.beiKlick(z.id, ev);
                return;
            }
            if (o.beiGeaendert) o.beiGeaendert(z.id, datum, z.von, z.bis);
        }

        /* Escape bricht ab und stellt her, wie es war — wer sich vertut,
           soll nicht rückgängig machen müssen, was noch gar nicht gilt. */
        function beiTaste(ev) {
            if (ev.key !== 'Escape' || !zug) return;
            ev.preventDefault(); ev.stopPropagation();
            const z = zug; zug = null;
            aufraeumen();

            if (z.art === 'neu') {
                if (z.el && z.el.parentNode) z.el.parentNode.removeChild(z.el);
                return;
            }
            if (z.spalte !== z.alteSpalte) z.alteSpalte.appendChild(z.el);
            z.el.classList.remove('aktiv');
            z.el.style.top = geo.platz(z.altVon);
            z.el.style.height = geo.spanne(z.altVon, z.altBis);
        }

        /* Nur während eines Zuges am Dokument hängen. Immer zu lauschen
           hiesse: Jedes Zeichnen legt ein Paar Hörer nach, und irgendwann
           feuert ein einziger Zug vielfach. */
        function anhaengen() {
            document.addEventListener('pointermove', bewegen);
            document.addEventListener('pointerup', loslassen);
            document.addEventListener('pointercancel', beiTaste);
            document.addEventListener('keydown', beiTaste, true);
        }
        function abhaengen() {
            document.removeEventListener('pointermove', bewegen);
            document.removeEventListener('pointerup', loslassen);
            document.removeEventListener('pointercancel', beiTaste);
            document.removeEventListener('keydown', beiTaste, true);
        }

        /* ---- Klicks, die keine Züge sind ---- */

        wurzel.addEventListener('dblclick', ev => {
            const b = ev.target.closest ? ev.target.closest('.' + KLASSE + '-block') : null;
            if (b && o.beiDoppelklick) o.beiDoppelklick(b.dataset.id, ev);
        });

        wurzel.addEventListener('contextmenu', ev => {
            const b = ev.target.closest ? ev.target.closest('.' + KLASSE + '-block') : null;
            if (b && o.beiMenu) { ev.preventDefault(); o.beiMenu(b.dataset.id, ev); }
        });

        wurzel.addEventListener('click', ev => {
            if (ev.target.closest('.' + KLASSE + '-block')) return;
            const f = ev.target.closest ? ev.target.closest('.' + KLASSE + '-fuss') : null;
            if (f && o.beiFussKlick) { o.beiFussKlick(f.dataset.datum); return; }
            const k = ev.target.closest ? ev.target.closest('.' + KLASSE + '-kopf') : null;
            if (k && o.beiKopfKlick) o.beiKopfKlick(k.dataset.datum);
        });

        wurzel._wrLoesen = () => { abhaengen(); zug = null; };
    }

    /** Vor einem erneuten Zeichnen aufrufen. */
    function loese(ziel) {
        if (ziel && typeof ziel._wrLoesen === 'function') { ziel._wrLoesen(); ziel._wrLoesen = null; }
    }

    const Wochenraster = { KLASSE, zeichne, loese, spurenVerteilen, achseBauen, uhr };

    if (typeof module !== 'undefined' && module.exports) module.exports = Wochenraster;
    else global.Wochenraster = Wochenraster;

})(typeof globalThis !== 'undefined' ? globalThis : this);
