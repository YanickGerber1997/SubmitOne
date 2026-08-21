# Submit Paper — Bestandesaufnahme

> Stand **v37**, aufgenommen am 21.08.2026. Alle Zahlen sind gemessen,
> nicht geschätzt: `wc -l`, `grep -c`, `node test/selftest-node.js`.
> Ergänzt `ARCHITEKTUR.md` (die Absicht) um den Befund (den Zustand).

## 1. Was dasteht

| | |
|---|---|
| `write.js` | 6'576 Zeilen · 395 KB · **370 Funktionen** · 159 Ereignis-Zuhörer |
| `index.html` | 516 Zeilen · 35 KB |
| `write.css` | 892 Zeilen · 68 KB |
| Fremde Bibliotheken | **null** |
| Netz | `node test/selftest-node.js` → **294 OK, 0 Fehler** |
| Format | `.paper` (früher `.gdoc` — beide werden weiter gelesen) |

**21 Module:** gemeinsames Modell HTML ⇄ Raster · Bibliothek (localStorage) ·
Speichern · Formatierung · Statistik/Gliederung · Dokumentenliste · Export ·
Theme/Fokus · Bilder · Textmarker · Schwebe-Toolbar · Tabellenwerkzeuge ·
Dokumentsuche · Zoom/Ausrichtung · Einfügen-Menü + Inhaltsverzeichnis ·
Rechtsklick-Menü · Schriftstufen/Druckvorschau · **Submit Calc** ·
Rechtschreibprüfung mit eigenem Wörterbuch · Rückgängig/Wiederholen ·
Kopf-/Fusszeilen.

**Rechenkern:** rund 50 Funktionen, deutsch *und* englisch — SUMME/SUM,
MITTELWERT, ZÄHLENWENN, SUMMEWENN, WENN, WENNFEHLER, ARBEITSTAGE, EDATE,
MEDIAN, POTENZ, WURZEL … mit Bereichsbezügen, **Zirkelbezug-Erkennung** und
Fehlerwerten.

**Fremde Formate:** liest und schreibt `.docx`, `.xlsx` und `.odt` mit einem
**selbstgeschriebenen ZIP-Leser und -Schreiber**. Keine Bibliothek. Das sind
echte Office-Formate, nicht HTML mit anderer Endung.

## 2. Was fehlt

Gesucht, nicht geschätzt — `grep` über `write.js` und `index.html`:

| Gegenüber Word | Gegenüber Excel |
|---|---|
| Serienbrief | **Diagramme** |
| Kommentare | Pivot-Tabellen |
| Änderungsverfolgung | Autofilter |
| Fussnoten (nur beiläufig erwähnt) | bedingte Formatierung |
| Literaturverzeichnis | Datenüberprüfung |
| Formulare | Makros |

Bei beiden: gleichzeitiges Arbeiten zu zweit, Versionsverlauf.

**Die schmerzhafteste Lücke sind die Diagramme.** Eine Tabellenkalkulation
ohne Diagramm ist für die meisten Menschen keine Tabellenkalkulation. Und sie
geht ohne Bibliothek — Inline-SVG, wie das Dashboard in SubmitOne es schon
macht.

## 3. Die drei Befunde, die zählen

### 3.1 `execCommand` — 37 Aufrufe

Diese Schnittstelle ist von den Browserherstellern **selbst aufgegeben**
worden: als *deprecated* markiert, nicht einheitlich spezifiziert, in Chrome,
Safari und Firefox unterschiedlich im Verhalten. Das Fundament ist am Tag eins
Altlast.

**Was hilft, ohne alles umzubauen:** die 37 Aufrufe hinter *eine* Stelle legen.
Dann ist der Tag, an dem ein Browser abschaltet, ein Nachmittag Arbeit statt
einer Woche.

### 3.2 Kein Dokumentmodell — die Decke über allem

Das Dokument *ist* das DOM; `contentEditable` an 29 Stellen. Daraus folgt:

- Rückgängig bleibt unzuverlässig, weil der Browser mitmischt.
- **Gemeinsames Arbeiten wird nie gehen.** Google Docs und Word haben ein
  Dokumentmodell *getrennt* von der Darstellung — nur so lassen sich Änderungen
  zweier Leute zusammenführen.

Das ist kein Feature, das man nachrüstet, sondern eine Neuentwicklung. Es
gehört bewusst entschieden, nicht übersehen.

### 3.3 Der Test misst, was leicht zu messen ist

294 grüne Zusicherungen klingen stark. Sie prüfen aber fast ausschliesslich die
**reinen Funktionen**: Formeln, Spaltenumrechnung, Vorlagendesign,
Klassen-Attribute. **Der Editor selbst ist praktisch ungetestet** — weil 81
globale Variablen sich nicht füttern lassen.

Die Zahl sieht stärker aus als die Absicherung. Der Weg dahin ist nicht «alles
umbauen», sondern: den Zustand aus den Globalen in ein Objekt ziehen, damit die
Testsuite ihn setzen kann.

*(Nebenbei: 54 `innerHTML`-Zuweisungen. Es gibt einen Reiniger — gut. Aber die
Fläche ist gross, und ein übersehener Weg ist eine Lücke in einem Dokument, das
jemand geschickt hat.)*

## 4. Der Wettbewerb — richtig gestellt

Der erste Anlauf lautete «gratis ist schon besetzt». Das war zu flach.

**LibreOffice ist kein Gegner.** Gratis und bleibt es auch — LGPL, hinter einer
Stiftung, keine Firma, die es sich anders überlegen kann. Aber niemand *wählt*
es. 350 MB Desktop-Programm mit einer Oberfläche aus einer anderen Zeit ist
kein Wettbewerber für ein Werkzeug im Browser.

**OnlyOffice ist die ernsthafte Vergleichsgrösse — mit zwei Haken:**

| | |
|---|---|
| Community Edition | **AGPL v3**, gratis, **20 gleichzeitige Verbindungen** |
| Enterprise | ab **USD 1'500** für 50 Verbindungen |
| Hersteller | Ascensio System SIA (Lettland), mit kommerzieller Ausgabe |

1. Die freie Ausgabe **braucht einen Server, den man selbst betreibt** — ein
   Produkt für IT-Abteilungen, nicht für ein Büro mit zwei Leuten. Was ein
   Endnutzer gratis bekommt, ist DocSpace: wieder eine Cloud, wieder liegen die
   Daten woanders.
2. **AGPL v3 heisst: gratis zu benutzen, nicht gratis, um darauf zu bauen.**
   Wer AGPL-Code als Dienst anbietet, muss seinen eigenen Quelltext offenlegen.

Und die Sorge, ob es gratis bleibt, ist belegt, nicht paranoid: Redis, Elastic,
Terraform, MongoDB, Docker Desktop — alle haben ihre freie Ausgabe verengt,
sobald der kommerzielle Druck stieg. Wer eine Community Edition *neben* einer
Enterprise Edition führt, hat den Hebel in der Hand.

**Der Satz lautet also richtig:** Gratis und gut ist immer mit einem Haken zu
haben. Entweder liegen die Daten bei Google, oder man braucht einen Server und
jemanden, der ihn betreut, oder dahinter steht eine Firma, die es sich anders
überlegen kann.

| | Daten bei dir | ohne Server | ohne Konto | im Browser | Lizenz sicher |
|---|:---:|:---:|:---:|:---:|:---:|
| Google Docs | ✗ | ✓ | ✗ | ✓ | ✓ |
| Office Web | ✗ | ✓ | ✗ | ✓ | ✓ |
| OnlyOffice Community | ✓ | **✗** | ✓ | ✓ | **?** |
| LibreOffice | ✓ | ✓ | ✓ | **✗** | ✓ |
| **Submit Paper** | ✓ | ✓ | ✓ | ✓ | ✓ |

Diese Zeile ist frei — nicht weil es niemand könnte, sondern weil es für die
anderen kein Geschäft ist.

## 5. Wo Submit Paper wirklich gewinnt

**Nicht «gratis Word».** Sondern:

> Eine `.paper` liegt **im selben Ordner** neben einer `.submit` und gehört
> **zum selben Projekt**.

Ein Bauleiter, der das Protokoll in demselben Werkzeug schreibt, das die
Vergaben und Termine hält — mit Zahlen, die aus dem Projekt kommen statt
abgetippt zu werden. Das kann Word nicht und Google Docs auch nicht. Nicht weil
sie es nicht könnten, sondern weil sie das Projekt nicht kennen.

**Dazu zwei Eigenschaften, die keiner der vier anderen hat:**

- **Keine Lizenzschuld.** Null fremde Bibliotheken heisst null fremde Lizenzen.
  Kein AGPL, kein «ab Version 8 kostet es», kein Paket, das den Besitzer
  wechselt. Der Preis: Diagramme muss man selbst schreiben.
- **Statische Dateien.** Es gibt keinen Server, den man abschalten, keine
  Rechnung, die man stellen, keine Bedingungen, die man ändern kann. Eine
  `.paper` von heute lässt sich 2040 mit der HTML-Datei von einem Stick öffnen.

**Und ein echter konzeptioneller Gewinn:** Bei Submit Paper *ist* ein Write ein
Calc — dasselbe Raster, zwei Ansichten. Word und Excel sind zwei Produkte mit
zwei Datenmodellen; eine Tabelle in Word ist nicht dasselbe wie ein Blatt in
Excel.

## 6. Was als Nächstes zu tun ist

1. **Diagramme in Calc.** Die grösste sichtbare Lücke. Inline-SVG, ohne
   Bibliothek.
2. **Den Editor testbar machen.** Zustand aus den Globalen in ein Objekt — dann
   deckt die Testsuite das ab, was das Produkt ausmacht.
3. **`execCommand` einkapseln.** Nicht ersetzen, nur an *eine* Stelle legen.
4. **Die Verbindung zu SubmitOne ausbauen.** Zahlen aus dem Projekt in ein
   Paper ziehen — das ist der Graben, den niemand sonst hat.

Die Reihenfolge ist bewusst: 1 macht es benutzbar, 2 macht es haltbar, 3
entschärft die Zeitbombe, 4 macht es unersetzlich.
