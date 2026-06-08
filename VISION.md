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
- **Gestalt vs. Speicher getrennt:** *Wie* man öffnet (Browser / PWA / Desktop-App) ist die **Hülle**; *wo* die Daten liegen (NAS/Datei/Sync) ist der **Speicher**. Beides unabhängig austauschbar.
- **Stand heute:** bereits **PWA-fähig** (manifest + Service Worker); Speicher hängt schon hinter einem **austauschbaren Adapter**. → Weg: **PWA jetzt → Datei/NAS-Adapter → Tauri-Hülle** (echtes `.exe`, voller NAS-Zugriff). Der Wechsel ist **klein**, die Features bleiben unberührt.

## Module greifen ineinander (die Mappe)
Module sind **verschiedene Werkzeuge auf denselben Projektdaten**. Ein Gewerk (z. B. BKP 211) ist **ein** Ding: SubTermin zeigt den Balken, SubKosten die Zahlen. Beim Öffnen der **Mappe** werden alle Module zusammen geladen → das gewohnte **Rechtsklick-Springen** (z. B. vom Terminbalken „zu Kosten") bleibt 1:1 erhalten. Die einzelne `.subtermin`-Datei ist die portable Kopie; die lebendige Verzahnung lebt in der Mappe.

## Modul-Dateien importieren / einhängen
Ein eigenständig gebautes Modul (z. B. ein `.subtermin`) lässt sich in ein bestehendes Projekt holen. **Beim Import fragt die App, was gemeint ist:**
- **Einhängen** als Modul des Projekts, oder
- **als neue Version** des vorhandenen Moduls (vergleichen/umschalten).

Danach **gleicht sie die Gewerke ab** (nach BKP + Name) und zeigt eine **Vorschau** (passt / neu / ohne Termin) zum Bestätigen → anschliessend sind die Balken mit den Projekt-/Kosten-Gewerken **verknüpft**. **Round-Trip:** ein Modul aus dem Projekt als eigene Datei **herauslösen**, extern bearbeiten, **zurückholen** (gleicher Abgleich). Heute schon teils vorhanden: `.gerber`-Import als neue Version mit Vergleichs-/Achtung-Dialog.

## Offline-first — keine Cloud als Zwang
**Oberste Regel: alles so weit wie möglich offline nutzbar.** Daten leben auf den eigenen Geräten (lokale Dateien) — das ist die Wahrheit, immer verfügbar. Cloud/Sync ist immer **optional**, nie Voraussetzung zum Öffnen einer Datei.

Zwei getrennte Wege (bewusst):
- **Dokumente (Rechnungen/Offerten/Fotos) = echte Dateien am frei gewählten Ort** (z. B. **NAS**, lokale Platte, OneDrive, USB) → siehe Ablage.
- **App-Datenabgleich + Handy-Aufnahmen = Supabase-Poststelle** → nur Transport/Abgleich der strukturierten Daten, kein Archiv.

## Speicherort = frei wählbar
Ein Projekt ist eine **Datei/ein Ordner** → man legt es ab, **wohin man will**: **NAS** (bevorzugt: eigene Ablage, im Büro geteilt, eigenes Backup), lokale Platte, USB, OneDrive. Die App fragt nicht „welche Cloud", sondern „welcher Ordner" — wie Word.

## Dokumente ablegen — echte Dateien
**Standard: referenzierte echte Dateien.** Eingehende Dokumente (Rechnung, Offerte, Nachtrag, Rapport — egal welcher Dateiname) zieht man **auf das Gewerk** (Terminbalken ODER Kostenübersicht, egal wo). Popup fragt **„Was ist das?"** → die Datei wird in einen **organisierten Ordner neben dem Projekt** abgelegt und gleich das passende **Formular geöffnet** (neue Rechnung → QR-Code scannen oder selbst eingeben).
- Beispiel: `…/Projekte/Römerstrasse/211 Baumeister/Rechnungen/2026-05_Akonto1.pdf`
- Das Projekt merkt sich nur den **relativen Verweis** → kein Link-Bruch beim Verschieben des Projektordners.
- Liegt der Ordner auf **NAS/OneDrive**, übernimmt der automatisch **Backup + Sync + Zugriff von anderen Geräten** (eigene Ablage, kein fremder Anbieter); Rechnungen bleiben auch **ausserhalb der App** im Explorer auffindbar.
- **Bündeln optional:** zum Archivieren/Teilen lässt sich ein Projekt inkl. aller Dokumente in **eine** selbst-enthaltene Datei packen.

## Handy / Baustelle
Extrem einfache Bedienung, volle Kontrolle, **offline**. Man nimmt unterwegs eine **Pendenz + Foto** auf → Bild komprimiert. Übertragung zum PC-Projekt über die **Supabase-Poststelle** (Transport der strukturierten Aufnahme); am PC wird das Foto als **echte Datei in den Projektordner** (z. B. auf dem NAS) abgelegt und mit Pendenz/Gewerk verknüpft.

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
