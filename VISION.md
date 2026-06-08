# SubmitOne — Vision (1 Seite)

*Stand: 8. Juni 2026. Dieses Dokument hält fest, WIE das Ganze nachher funktioniert. Es ist die Grundlage für alles Weitere.*

## Die Grundidee — wie Word
**Das Dokument ist der Star, das Programm nur der Stift.**
Man startet ein Werkzeug, baut frei ein Dokument, speichert es als Datei auf dem PC — und kann diese Datei **für immer** wieder öffnen. Wie eine Word-Datei von 2005, die heute noch aufgeht.

## Die Suite
- **SubmitOne** = das Dach (die Projekt-Mappe), das alles zusammenbindet.
- **Module** = eigenständige Werkzeuge, jedes für sich startbar und nutzbar:
  - **SubTermin** — Terminprogramm / Bauprogramm (Gantt) · *heute am weitesten*
  - **SubKosten** — Kostenplanung / Prognose
  - **SubAusschreibung** — Einladungen, Submittenten, Werkverträge
  - **SubKalender** — Termine / Sitzungen
  - **SubMail** — Korrespondenz

## Wie die Dateien geschnitten sind
**Beides — Modul-Dateien + Mappe:**
- Jedes Modul speichert seine **eigene Datei**: `Römerstrasse.subtermin`, `Römerstrasse.subkosten` …
  → Jede läuft **eigenständig**, losgelöst, für immer.
- **SubmitOne** ist eine **Mappe**, die mehrere Modul-Dateien zu einem Projekt **bündelt/verknüpft** (wie ein ZIP/Ordner).
  → Man kann das ganze Projekt als ein Stück teilen — oder eine einzelne Modul-Datei für sich.

## „Für immer nutzbar" — als Bauregel, nicht als Hoffnung
1. **Simples, lesbares Format** (JSON-Text) — kein Geheim-Binärformat; im Notfall sogar mit Notepad lesbar.
2. **Format-Versionsnummer** in jeder Datei.
3. **Alte Versionen werden NIE fallengelassen** — es gibt immer einen automatischen „Übersetzer" (Migration) beim Öffnen.
4. **Immer exportierbar** (PDF/Druck) — der Inhalt überlebt auch ohne die App.
5. **Kein Login/Cloud nötig zum Öffnen** — die Datei liegt lokal und funktioniert offline.

## Desktop-App wie Word
Eine echte Windows-Anwendung: doppelklicken, öffnen/speichern wie gewohnt, mehrere Fenster gleichzeitig, Datei-Verknüpfung (Doppelklick auf `.subtermin` öffnet SubTermin).

## Online — Datei lokal + Cloud-Sync
Die lokale Datei ist das Fundament. Die Cloud ist **Kopie + Verteiler**: Backup, Geräte-Sync, Teilen — aber nie Voraussetzung, um eine Datei zu öffnen.

## Mehrbenutzer & Rollen
Von Anfang an mitgedacht (jedes Objekt mit ID, Zeitstempel, Herkunft). Rollen kommen sauber dazu: z. B. **Sekretärin = sicher ansehen + Bestimmtes bearbeiten**, ohne etwas kaputtmachen zu können.

## „Nicht kaputtbar" — das oberste Produktprinzip
Jemand Neues oder eine Sekretärin muss **gefahrlos klicken** können:
- **Ansehen-Modus per Default**, bewusster „Bearbeiten"-Schalter (nicht „alles sperren").
- **Undo/Redo** (Strg+Z) über alles.
- **Autosave + Verlauf** — jeder Stand wiederherstellbar.
- Kein Klick zerstört etwas; Heikles nur mit klarer Rückfrage.

## Anti-Ziele (was wir bewusst NICHT tun)
- Keine fünf getrennten Codebasen (untragbar zu pflegen) → **ein** Codebase, modular.
- Kein Zwang zu Cloud/Konto, um eigene Dateien zu öffnen.
- Kein proprietäres Binärformat, das in Jahren niemand mehr lesen kann.

## So gehen wir vor (Angst-minimierend)
1. **Diese Vision** festschreiben ✓
2. **Dateiformat + Versionsregel** definieren (das Herz der Ewigkeit)
3. **Desktop-Hülle** wählen (wie es eine echte `.exe` wird)
4. **Mini-Beweis**: SubTermin eigenständig speichern → schliessen → wieder öffnen. Erst wenn das sauber läuft, investieren wir gross.
