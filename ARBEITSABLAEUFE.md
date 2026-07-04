# SubmitOne — Arbeitsabläufe nach Rolle: „Der Tag eines …"

*Stand: 5. Juli 2026. Ziel: **vom echten Berufsalltag her denken** — nicht „welche Tools haben wir", sondern „wie sieht der Tag eines Bauleiters/Architekten/Sachbearbeiters aus, welche Aufgabe kommt wann, und wie kommt er in SubmitOne zum passenden Werkzeug?". Alle genannten Module/Wege existieren im Code (Router + Projekt-Reiter geprüft). Lücken sind klar als 🔴/🟡 markiert. Ergänzt [VEROEFFENTLICHUNG.md](VEROEFFENTLICHUNG.md) und [PERFEKTIONIERUNG.md](PERFEKTIONIERUNG.md).*

---

## 0. Der Werkzeugkasten (was existiert & wie man hinkommt)

**Drei Apps, ein Ökosystem:**
| App | Wofür | Aufruf |
|---|---|---|
| **SubmitOne Suite** (`/`) | Projektsteuerung: Termine, Kosten, Ausschreibung, Pendenzen, Kontakte | Hauptanwendung |
| **Submit PDF** (`/pdf`) | Pläne ansehen/markieren, Ausschnitte, CAD/BIM, PDF→Paper | oben rechts „Submit PDF ↗" / eigener Ordner-Knopf |
| **Submit Paper** (`/write`) | Briefe, Offerten, Rechnungen, Tabellen (Write/Calc/Slides) | Aus PDF „Als Submit Paper öffnen" oder direkt `/write` |

**Globale Navigation (linke Leiste der Suite):** `Dashboard · Projekte · Kalender · Pendenzen · Planung · Erfassen · Drucken · Kontakte · Dokumente · Einstellungen`

**Innerhalb eines Projekts (Reiter):** `Übersicht · Gewerke · Kalender · Kontakte · Kosten · Rechnungskontrolle · Termine · Pendenzen · Dossier · Auflagen · Protokolle · Nachträge · Optionen · Finanzierung · Zahlungsplan · Eigentümerwünsche · Solar · U-Wert · Honorar`
*Die 6 häufigsten sind als Reiter sichtbar (Übersicht/Gewerke/Kalender/Kontakte/Kosten/Termine), der Rest unter „Mehr ▾". Die Rollen-Matrix blendet nicht gebrauchte Reiter aus.*

**Weg zu jedem Werkzeug (Grundmuster):** `Projekte → Projekt wählen → Reiter`. Ausnahmen: projektübergreifende Sichten (Kalender/Pendenzen/Planung/Kontakte) hängen direkt links; schnelles Notieren über **Erfassen**; Ausgaben über **Drucken**.

---

## 1. 👷 Der Bauleiter (örtliche Bauleitung)

**Wer:** koordiniert die Baustelle, Unternehmer, Termine, Mängel; ist viel unterwegs, oft am Handy.

### Sein Tag
| Zeit | Aufgabe | Werkzeug in SubmitOne | Weg dorthin |
|---|---|---|---|
| **Morgens** | Was ist heute fällig? Offene Punkte über alle Baustellen | **Dashboard** (Fristen/Termine/Pendenzen aller Projekte) | Sidebar → *Dashboard* |
| | Wochenüberblick, Unternehmer-Termine | **Termine (Gantt)** / **Kalender** | Projekt → *Termine* bzw. Sidebar → *Kalender* |
| **Auf der Baustelle** | Mangel/Pendenz notieren (idealerweise mit Foto) | **Erfassen** (Schnellerfassung) → **Pendenzen** | Sidebar → *Erfassen* |
| | Plan ansehen, Stelle markieren | **Submit PDF** (Marker, Kommentar, Ausschnitt) | „Submit PDF ↗" |
| | Kurze Notiz an Unternehmer | **Kontakte** → E-Mail; **Submit Paper** für Briefe | Projekt → *Kontakte* |
| **Sitzung** | Bauprotokoll führen, Pendenzen zuweisen | **Protokolle** (Traktanden → Pendenz, verantwortlich, Frist) | Projekt → *Protokolle* |
| **Nachmittags** | Termine anpassen (Verzug), Gewerke verketten | **Termine (Gantt)** – Ziehen/Snap, Baseline | Projekt → *Termine* |
| | Rapport/Regie prüfen | **Rechnungskontrolle** / **Nachträge** | Projekt → *Mehr ▾ → Rechnungskontrolle* |
| **Abschluss** | Mängelliste drucken/verschicken | **Drucken** / **Submit Paper** (Mängelliste-Vorlage) | Sidebar → *Drucken* |

**Was er braucht (Kern):** Dashboard, Erfassen, Pendenzen, Protokolle, Termine, Submit PDF.
**Lücken für seinen Alltag:**
- 🔴 **Mobile Pendenz + Foto + Planpin** (Baustelle, offline) — geplant (Phase 7), noch nicht real. Das ist die größte echte Lücke für den Bauleiter.
- 🟡 **Pendenz direkt aus Submit PDF** (Marker im Plan → Pendenz im Projekt) — heute getrennt.
- 🟡 **Offline-Robustheit am Handy** (Verbindung weg auf der Baustelle).

---

## 2. 📐 Der Architekt / Projektleiter

**Wer:** führt das Projekt inhaltlich, schreibt aus, vergibt, steuert Kosten & Termine, Ansprechpartner für Bauherr.

### Sein Tag
| Phase | Aufgabe | Werkzeug | Weg dorthin |
|---|---|---|---|
| **Projektstart** | Neues Projekt, Gewerke/Arbeitsbeschriebe anlegen | **Projekte → + Neues Projekt**, **Gewerke** | Sidebar → *Projekte* |
| **Ausschreibung** | Submittenten wählen, einladen, Deckblatt, Fristen | **Kontakte/Listen**, **Vergabe-Detail** (`mailEinladung`, `pdfDeckblatt`), **Auflagen** | Projekt → *Kosten → Vergabe-Detail* |
| | Offerten vergleichen, vergeben | **Kosten** (Prognose/Vergabe, Preisspiegel) | Projekt → *Kosten* |
| **Planung** | Plan prüfen, Details, Mengen | **Submit PDF** (CAD/BIM, Schnitt, Raumbuch, Mengen) | „Submit PDF ↗" |
| **Kostensteuerung** | BKP-Übersicht, Stände sichern & vergleichen | **Kosten** + **Versionen** (`kostenSnapshot`/`kostenDiff`) | Projekt → *Kosten → 📊 Versionen* |
| | Nachträge bewerten | **Nachträge** (genehmigt/offen, Kostenwirkung) | Projekt → *Nachträge* |
| **Kommunikation** | Offerte/Brief an Bauherr, Auswahlpunkte | **Submit Paper** (Angebot/Brief-Vorlage), **Eigentümerwünsche** | Projekt → *Eigentümerwünsche* |
| **Termine** | Grob-/Fein-Terminprogramm, Bauherr-Meilensteine | **Termine (Gantt)** | Projekt → *Termine* |
| **Abgabe** | Kostenschätzung/Bericht drucken | **Drucken**, **Submit Paper** | Sidebar → *Drucken* |

**Was er braucht (Kern):** Projekte, Kosten, Vergabe/Ausschreibung, Termine, Submit PDF, Submit Paper.
**Lücken:**
- 🟡 **Ausschreibung „lückenlos"**: Eingänge/Erinnerungen noch nicht ganz im Fluss (Fristen-Ampel + Erinnerungen existieren).
- 🟡 **PDF→Projekt-Brücke**: aus Submit PDF gemessene Mengen automatisch in die Kostenschätzung.
- 🔴 (nur online) **Rollen/Rechte**: Bauherr/Unternehmer-Sicht sicher trennen (siehe [VEROEFFENTLICHUNG.md](VEROEFFENTLICHUNG.md) B3).

---

## 3. 💰 Der Finanz-/Kostensachbearbeiter

**Wer:** Baukosten, Zahlungen, Honorar, Finanzierung; arbeitet zahlengetrieben, braucht Genauigkeit & Nachvollziehbarkeit.

### Sein Tag
| Aufgabe | Werkzeug | Weg dorthin |
|---|---|---|
| Baukosten pflegen (BKP, Prognose, Vergabesummen) | **Kosten** | Projekt → *Kosten* |
| Monatsabgabe: Stand sichern & mit Vormonat vergleichen | **Kosten → Versionen** (`kostenDiff`: neu/entfallen/geändert) | Projekt → *Kosten → 📊 Versionen* |
| Zahlungsplan führen (Bauherr-Werkverträge **oder** SIA-Honorar) | **Zahlungsplan** (2 Sichten, Termin-Verknüpfung `bauherrPlan`) | Projekt → *Zahlungsplan* |
| Rechnungen prüfen (Anzahl × Ansatz = Betrag), Rückbehalt | **Rechnungskontrolle** | Projekt → *Rechnungskontrolle* |
| Rechnung/Offerte digitalisieren + **auf Rechenfehler prüfen** | **Submit PDF → „Als Submit Paper öffnen"** (rote Fehler-Markierung) | Submit PDF → Dokument-Knopf |
| Nachträge → Kostenwirkung | **Nachträge** | Projekt → *Nachträge* |
| Finanzierung (Eigen-/Fremdkapital, Tranchen) | **Finanzierung** | Projekt → *Finanzierung* |
| Honorar nach SIA-Leistungsprozenten | **Honorar** | Projekt → *Honorar* bzw. Sidebar → *Honorar* |
| Zahlen exportieren/sichern | **Export (Voll-Backup JSON)** / **Drucken** | Sidebar-Fuß → *Export* |

**Was er braucht (Kern):** Kosten, Zahlungsplan, Rechnungskontrolle, Nachträge, Finanzierung, Honorar, Submit PDF↔Paper (Rechnungsprüfung).
**Stärke heute:** genau dieser Bereich ist **am besten test-abgesichert** (Geld/BKP/Zahlungsplan/Rechenkontrolle) → verlässliche Zahlen.
**Lücken:**
- 🟡 **QR-Rechnung erfassen** (Scan → Rechnungskontrolle) — Fluss noch nicht durchgängig.
- 🟡 **Sichtbares Backup/Restore** (Export existiert, aber kein geführter „Sichern/Wiederherstellen"-Fluss — jetzt durch den Datenverlust-Schutz v375 zumindest abgesichert).

---

## 4. 🗂️ Sekretariat / Projekt-Administration

**Wer:** hält Kontakte, Termine, Protokolle, Schriftverkehr zusammen; „Drehscheibe".

| Aufgabe | Werkzeug | Weg dorthin |
|---|---|---|
| Adressen/Firmen pflegen | **Kontakte** | Sidebar → *Kontakte* |
| Einladungen/Serienmails zur Ausschreibung | **Kontakte/Listen** + `mailEinladung` | Projekt → *Kosten → Vergabe* |
| Termine koordinieren, Sitzungen | **Kalender** (global & pro Projekt) | Sidebar → *Kalender* |
| Protokolle schreiben & verteilen | **Protokolle** | Projekt → *Protokolle* |
| Briefe/Serienbriefe | **Submit Paper** (Brief-Vorlage, Firmendaten) | `/write` |
| Unterlagen ablegen/vollständig halten | **Dossier** (Fehlt-Anzeige), **Dokumente** | Projekt → *Dossier* |
| Alles Fällige im Blick | **Pendenzen**, **Dashboard** | Sidebar |

**Lücken:** 🟡 Serienbrief/Seriendruck-Komfort in Submit Paper; 🟡 Firmendaten/Logo automatisch in Vorlagen (Phase 4).

---

## 5. Externe Rollen (nur relevant, wenn online + Rollen scharf)

- **Unternehmer:** sieht *sein* Gewerk, offeriert, meldet Rapporte/Nachträge, lädt Rechnungen hoch. Weg: eingeladene E-Mail → eigene, eingeschränkte Projektsicht.
- **Bauherr:** sieht Zahlungsplan (Bauherr-Sicht), Auswahlpunkte/Eigentümerwünsche, Meilensteine.
> 🔴 **Beide brauchen die Rollen-/Rechte-Trennung** (RLS pro Team), die heute fehlt — siehe [VEROEFFENTLICHUNG.md](VEROEFFENTLICHUNG.md) B3. Bis dahin: intern nutzen, nicht an Externe freigeben.

---

## 6. Schnell-Landkarte: „Ich will … → wohin?"

| Ich will … | Weg |
|---|---|
| heute Fälliges sehen | **Dashboard** |
| schnell etwas notieren | **Erfassen** |
| einen Plan markieren / messen | **Submit PDF** |
| einen Brief/eine Offerte schreiben | **Submit Paper** |
| eine Rechnung auf Rechenfehler prüfen | **Submit PDF → Als Submit Paper öffnen** |
| Kosten/Prognose pflegen | Projekt → **Kosten** |
| zwei Kostenstände vergleichen | Projekt → **Kosten → 📊 Versionen** |
| ausschreiben/einladen | Projekt → **Kosten → Vergabe-Detail** |
| Termine planen/verschieben | Projekt → **Termine** |
| Mängel/offene Punkte führen | Projekt → **Pendenzen** (oder **Erfassen**) |
| Sitzung protokollieren | Projekt → **Protokolle** |
| Zahlungen planen | Projekt → **Zahlungsplan** |
| Daten sichern | Sidebar-Fuß → **Export** |

---

## 7. Der rote Faden: „Wie komme ich zu den Tools?" — Empfehlungen

Der Werkzeugkasten ist **breit und vollständig**. Das eigentliche Alltags-Problem ist nicht *Fehlen*, sondern *Hinfinden & Verketten*. Priorisierte, umsetzbare Verbesserungen:

1. **🟢 Rollen-basierter Einstieg (Onboarding).** Beim ersten Start fragen „Wer bist du?" (Bauleiter/Architekt/Finanz/Sekretariat) → passendes **Start-Dashboard + vorgewählte Reiter** (die Rollen-Matrix `versteckteTabs` existiert schon — nur an eine Rollenwahl koppeln). *Größter Hebel für „wie komme ich zu den Tools".*
2. **🟢 Aufgaben-orientierte Schnellstarts** auf dem Dashboard: „+ Ausschreibung starten", „+ Rechnung prüfen", „+ Pendenz erfassen" — führen direkt in den richtigen Fluss statt „erst Projekt, dann Reiter suchen".
3. **🟡 Werkzeug-Brücken schließen:** Submit PDF ↔ Projekt (Marker→Pendenz, Menge→Kostenschätzung) und Submit Paper ↔ Projekt (Brief/Protokoll ablegen).
4. **🟡 Mobiler Baustellen-Modus** (Bauleiter): Erfassen + Foto + Planpin, offline (Phase 7).
5. **🔴 Rollen/Rechte online** (Unternehmer/Bauherr sicher trennen) — Voraussetzung, um Externe überhaupt hereinzulassen.

**Nächster konkreter Schritt (Vorschlag):** den **rollenbasierten Einstieg (#1)** bauen — er nutzt Vorhandenes (`versteckteTabs`/Rollen-Matrix), ist sichtbar, und beantwortet direkt „wie komme ich zu den Tools". Danach die **Dashboard-Schnellstarts (#2)**.
