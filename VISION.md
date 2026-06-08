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

## Module greifen ineinander (die Mappe)
Module sind **verschiedene Werkzeuge auf denselben Projektdaten**. Ein Gewerk (z. B. BKP 211) ist **ein** Ding: SubTermin zeigt den Balken, SubKosten die Zahlen. Beim Öffnen der **Mappe** werden alle Module zusammen geladen → das gewohnte **Rechtsklick-Springen** (z. B. vom Terminbalken „zu Kosten") bleibt 1:1 erhalten. Die einzelne `.subtermin`-Datei ist die portable Kopie; die lebendige Verzahnung lebt in der Mappe.

## Offline-first — keine Cloud als Zwang
**Oberste Regel: alles so weit wie möglich offline nutzbar.** Daten leben auf den eigenen Geräten (lokale Dateien) — das ist die Wahrheit, immer verfügbar.
- **Supabase Free dient nur als „Poststelle"** (kurzer Austausch Handy↔PC, optionaler Abgleich) — **nicht als Archiv**. Fällt sie aus/pausiert, arbeitet man lokal ungestört weiter.
- Fotos werden komprimiert über die Poststelle geschickt und am PC **ins Projekt eingebettet**; die Kopie in der Poststelle kann danach weg (bleibt schlank).
- Cloud/Sync ist immer **optional**, nie Voraussetzung zum Öffnen einer Datei.

## Dokumente per Drag & Drop ablegen
Eingehende Dokumente (Rechnung, Offerte, Nachtrag, Rapport — egal welcher Dateiname) zieht man **auf das Gewerk** (Terminbalken ODER Kostenübersicht, egal wo). Popup fragt **„Was ist das?"** → es wird beim richtigen Gewerk **abgelegt** und gleich das passende **Formular geöffnet** (neue Rechnung → QR-Code scannen oder selbst eingeben). Die Datei wird **im Projekt-Container eingebettet** (reist mit, offline, geht nie verloren).

## Handy / Baustelle
Extrem einfache Bedienung, volle Kontrolle, **offline**. Man nimmt unterwegs eine **Pendenz + Foto** auf → Bild komprimiert, ins Projekt eingebettet, mit Pendenz/Gewerk verknüpft. Austausch zum PC über die **Poststelle** (Supabase Free) oder lokales WLAN.

## Mehrbenutzer & Rollen
Von Anfang an mitgedacht (jedes Objekt mit ID, Zeitstempel, Herkunft). Arbeitsmodell: **einer bearbeitet, andere sehen zu, Änderungen werden zusammengeführt** (kaum Konflikte, voll offline-tauglich). Echtes Live-Gleichzeitig später optional. Rollen kommen sauber dazu: z. B. **Sekretärin = sicher ansehen + Bestimmtes bearbeiten**, ohne etwas kaputtmachen zu können.

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
