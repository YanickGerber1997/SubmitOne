# SubmitOne — Modul-Struktur (Blöcke pro Unterreiter)

*Stand: 9. Juni 2026. Wir organisieren **Code UND Arbeit pro Modul**. Jedes Modul = ein klarer Block; pro Modul: (a) **Aufräumen/Struktur**, (b) **zugeschnittene Arbeit**. Heute ist alles in einer Datei (app.js, ~12'360 Zeilen, 774 Funktionen) verstreut — wir bündeln pro Modul, später eigene Dateien (Suite).*

## Methode (sicher)
1. Pro Modul **Banner + Block** in app.js (Funktionen des Moduls zusammenziehen), in **kleinen, geprüften Schritten** (`node --check` + commit nach jedem).
2. **Toten/doppelten Code** dabei raus.
3. **Gemeinsamer Kern** (state, db, render, router, Helfer, Modal, BKP-Katalog …) bleibt zentral — kein Modul.
4. Später: **Aufteilen in eigene Dateien** je Modul (Vorbereitung Tauri/Suite).

---

## 🟦 MODUL: TERMINE (SubTermin)
**Code (verstreut):** `viewTermine` 2703 · `viewGrobGantt` 2027 · `viewFeinGantt` 2115 · `viewFeinViertel` 2218 · `gBarLabel` 2522 · `rerenderGantt` 2575 · `ganttRibbonTabs` 1961 · `terminSnapshot` 3398 · `gewerkeSorted` 4200 · + Links/Ribbon/Versionen.
- **Aufräumen:** alle Gantt-/Termin-Funktionen in **einen** Block; gemeinsame Gantt-Helfer bündeln; toten Code prüfen.
- **Zugeschnitten:** Verknüpfung **mit Zahlungsplänen** (Tranchen ↔ Bau-Termine); bereits da: Phasen-Hintergrund, Erfüllt/Notiz, Baseline-Vergleich, Jahres-Druck. Künftig: eigenständige `.subtermin`-Datei.

## 🟩 MODUL: KOSTEN (SubKosten, inkl. Zahlungsplan)
**Code (verstreut):** `kostenZeile` 1055 · `kostenSnapshot` 1077 · `kostenDiff` 1083 · `viewKosten` 1731 · `viewRechnungen` 8857 · `actNewNachtrag` 11024 · `actNewRechnung` 11101 · `zahlungsplanOf` 9833 · `bauherrPlan` 9865 · `viewZahlungsplan` 10058.
- **Aufräumen:** Kosten + Rechnungen + Nachträge + Zahlungsplan + Bauherr-Plan in **einen** Block; Versionen/Vergleich konsolidieren.
- **Zugeschnitten (Etappe 1):** Zahlungsplan **Bauherr** + Zahlungsplan **Bauleitung** als zwei klare Sichten; **Verknüpfung mit Terminprogramm**; Kosten-Versionen-Vergleich (da).

## 🟧 MODUL: AUSSCHREIBUNG (SubAusschreibung)
**Code (verstreut):** `viewListen` 4250 · `submTableHtml` 4227 · `mailEinladung` 4119 · `actKonditionen` 6451 · `pdfDeckblatt` 11366 · `pdfSubmittenten` 4591 · `isVergeben` 949 · + Eingeladene/Status.
- **Aufräumen:** Submittenten + Einladung + Konditionen + Deckblatt + Mail in **einen** Block.
- **Zugeschnitten (Etappe 2):** Submittentenliste → Einladungen → **Mailversand** → **saubere Nachkontrolle** (Status, Fristen, Eingänge lückenlos; Erinnerungen).

---

## Weitere Module (später, gleiche Methode)
Pendenzen (+ Planviewer/Mängel) · Kalender · Kontakte · Protokolle · Nachträge · Dossier · Auflagen · Optionen · Finanzierung · Bauherr-Freigabe · Solar · U-Wert · Honorar.

## Gemeinsamer Kern (bleibt zentral, kein Modul)
state/db/save/Undo · render/router · Helfer (Datum/Geld/esc/uid) · Modal/Toast/Kontextmenü · BKP-Katalog · Projekt-Stammdaten · Druck-Grundgerüst · Auth/Sync (später).
