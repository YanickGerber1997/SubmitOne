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

## Die drei Ebenen (Kernmodell)
1. **SubmitOne / Projekt — maximale Bearbeitbarkeit.** Das Dach hält **ganze Projekte** mit **vollem Kontext** (Termin ↔ Kosten ↔ Ausschreibung verknüpft). **Online** (von überall verfügbar) **UND** als **Offline-SubmitOne** (ganze Projekte auch ohne Netz).
2. **Modul-Datei** (`.subtermin`, `.subkosten` …) — **jederzeit ablösbar** aus einem Projekt: eine **portable Datei zum Versenden/Einlesen**, selbstbeschreibend (Stammdaten-Kopf), läuft eigenständig, für immer.
3. **Unterprogramm** (SubTermin …) — fokussierter Editor für eine Modul-Datei. **Standalone bearbeitbar, aber mit reduziertem Kontext** (keine Verknüpfung zu Kosten etc.).

**Leitsatz:** *Maximale Bearbeitbarkeit = im Projekt (voller Kontext). Die abgelöste Datei ist für Transport/Weitergabe — volle Kraft zurück, sobald sie wieder **in ein Projekt eingelesen** ist.*

**SubmitOne = Mappe**, die mehrere Modul-Dateien zu einem Projekt bündelt/verknüpft (wie ZIP/Ordner): ganzes Projekt als ein Stück teilen — oder eine einzelne Modul-Datei für sich.

## Projekt-Stammdaten (auch standalone editierbar)
Jede Modul-Datei trägt einen kleinen **Projekt-Kopf**: **Projektname, Bauherr, Ort, Bauleitung …** → auch in einer **einzelnen** `.subtermin` direkt änderbar (die Datei ist selbstbeschreibend). In der **Mappe** sind die Stammdaten **geteilt** (einmal ändern → alle Module zeigen es); beim Bündeln/Importieren werden sie **abgeglichen**.

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

## Maximale Arbeitsfläche — fokussierte Module (Office-Look)
Ein Hauptgrund für eigene Fenster/PWA: **mehr Platz für den eigentlichen Inhalt** (Baukosten, Gantt). Zwei Platzfresser fallen weg:
- **Browser-Leisten** (Adresszeile/Tabs) → weg dank **PWA-Standalone** (im Manifest schon gesetzt) bzw. Desktop-Fenster.
- **Projekt-Navigation** (Reiter Übersicht/Gewerke/… + Kopf) → im **Modul-Fokus** ausgeblendet: nur die Werkzeugleiste des Moduls + grosse Inhaltsfläche.

Look wie **Word/Excel** (dünne Ribbon-Leiste, riesige Arbeitsfläche). Das Layout-Muster ist **erlaubt**; nur keine Original-Icons/Schrift/Marke kopieren (eigene Icons haben wir schon).

## Module greifen ineinander (die Mappe)
Module sind **verschiedene Werkzeuge auf denselben Projektdaten**. Ein Gewerk (z. B. BKP 211) ist **ein** Ding: SubTermin zeigt den Balken, SubKosten die Zahlen. Beim Öffnen der **Mappe** werden alle Module zusammen geladen → das gewohnte **Rechtsklick-Springen** (z. B. vom Terminbalken „zu Kosten") bleibt 1:1 erhalten. Die einzelne `.subtermin`-Datei ist die portable Kopie; die lebendige Verzahnung lebt in der Mappe.

## Modul-Dateien importieren / einhängen
Ein eigenständig gebautes Modul (z. B. ein `.subtermin`) lässt sich in ein bestehendes Projekt holen. **Beim Import fragt die App, was gemeint ist:**
- **Einhängen** als Modul des Projekts, oder
- **als neue Version** des vorhandenen Moduls (vergleichen/umschalten).

Danach **gleicht sie die Gewerke ab** (nach BKP + Name) und zeigt eine **Vorschau** (passt / neu / ohne Termin) zum Bestätigen → anschliessend sind die Balken mit den Projekt-/Kosten-Gewerken **verknüpft**. **Round-Trip:** ein Modul aus dem Projekt als eigene Datei **herauslösen**, extern bearbeiten, **zurückholen** (gleicher Abgleich). Heute schon teils vorhanden: `.gerber`-Import als neue Version mit Vergleichs-/Achtung-Dialog.

## Online + Offline (Hybrid)
**Beides, bewusst:**
- **Online:** Projekte sind **von überall** verfügbar (Login → meine Projekte da). Bequemlichkeit + Zugriff auf jedem Gerät.
- **Offline:** ein **vollwertiges Offline-SubmitOne** arbeitet an **ganzen Projekten** ohne Netz.
- **Datei-Export** (Modul ablösen) bleibt jederzeit möglich — zum Versenden **und** als **Sicherheit/Langlebigkeit** (kein Lock-in: deine Daten gehen nie nur „in der Cloud" verloren).

So bleibt der **Komfort** (online, überall) **mit** der **Robustheit** (offline + eigene Datei) verbunden. *online haben, offline können, als Datei besitzen.*

**Online-Ablage = Supabase** (Entscheid): managed (wenig Aufwand), skaliert zum **SaaS** (Verkauf an andere Firmen), Konten + **Rollen via RLS**, Echtzeit-Abgleich, Stripe-fähig (Abo schon begonnen). **EU-Region** für Datenschutz. Free-Tier zum Start. **Kein Lock-in**, weil Offline-Modus + Datei-Export bleiben — Supabase ist die bequeme Online-Schicht, nicht der einzige Ort. (Sync-Logik offline↔online ist echte Arbeit, schrittweise gebaut.)

Getrennt davon weiterhin:
- **Dokumente (Rechnungen/Offerten/Fotos) = echte Dateien am frei gewählten Ort** (z. B. **NAS**, lokal, USB) → siehe Ablage.
- **Handy-Aufnahmen** → Transport über die Poststelle/Online-Schicht.

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

## Rollen & vereinfachte Ansichten (zentral!)
Jede Person bekommt eine **passende, vereinfachte Ansicht** — **umschaltbar**. Die Rolle steuert **beides**: *was man sieht* (weniger Knöpfe, nur das Nötige) und *was man darf* (kann nichts kaputtmachen). Die Tabelle zeigt **Standard-Vorgaben** — **die Rechte sind pro Rolle einstellbar** (Rechte-Matrix, vom Chef verwaltet).

| Rolle | Standard: sieht / darf | Ansicht |
|---|---|---|
| **Chef / Bauleiter** | alles, volle Kontrolle; **verwaltet die Rechte der anderen Rollen** | Power-Modus (wie heute) |
| **Planer / Architekt** | Termine, Pendenzen, Entscheide planen/kommentieren; **nicht** Vergabe-/Kosten-Hoheit | Fachplaner-Ansicht |
| **Hilfsbauleiter** | Programm ansehen, Termine **abhaken**, Notiz/Verschiebung, **Pendenz + Foto**; **kein** Struktur-Umbau | schlanke Gantt-Ansicht |
| **Sekretärin** | Kontakte, Submittenten, **Dokumente ablegen** (Drag&Drop), Mail, Fristen; **keine** Terminlogik | Formular-/Listen-Ansicht |
| **Unternehmer / Handwerker** | nur das **eigene Gewerk** (Termine + Pendenzen dazu), Rückmeldung/Status; **kein** Zugriff auf andere/Kosten | Mini-Ansicht (nur sein Gewerk) |
| **Bauherr** | nur **ansehen** (Programm, Kosten-Übersicht, Meilensteine), optional kommentieren/freigeben | Präsentations-/Lese-Ansicht |

- **Rechte pro Rolle einstellbar:** Vorgaben sind sinnvoll voreingestellt; der Chef feintunt je Rolle, was erlaubt ist (vereinfachen **+** schützen, aber flexibel).
- Funktioniert **mit mehreren Konten** (echte Rechte) **UND** **solo umschaltbar** — z. B. der Chef gibt den Laptop dem Hilfsbauleiter im einfachen Modus, oder schaltet zum Präsentieren in die **„Bauherr-Ansicht"**.
- Baut direkt auf **„nicht kaputtbar"** auf: tiefere Rollen sind **sicher per Default** und sehen eine **aufgeräumte** Oberfläche statt der vollen Werkzeugleiste.

## Mehrbenutzer (Abgleich)
Von Anfang an mitgedacht (jedes Objekt mit ID, Zeitstempel, Herkunft). Arbeitsmodell: **einer bearbeitet, andere sehen zu, Änderungen werden zusammengeführt** (kaum Konflikte, voll offline-tauglich). Echtes Live-Gleichzeitig später optional.

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
