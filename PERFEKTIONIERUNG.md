# SubmitOne — Perfektionierungs-Masterplan (Mehr-Session)

*Stand: 4. Juli 2026. Ziel: das **gesamte** Konstrukt Schritt für Schritt auf Produkt-Reife bringen — nicht durch Big-Bang, sondern in **session-grossen, sofort nutzbaren Etappen**. Baut auf [VISION.md](VISION.md), [ROADMAP.md](ROADMAP.md), [STRUKTUR.md](STRUKTUR.md), [PLANS.md](PLANS.md) auf und aktualisiert sie auf den heutigen Stand.*

> **So liest man diesen Plan:** Jede **Session** ist ein abgeschlossenes Arbeitspaket für einen Arbeitstermin mit klarer **Definition of Done (DoD)**. Du sagst z. B. „mach Session 0.2" und wir bauen genau das. Reihenfolge innerhalb einer Phase ist meist frei; die Phasen bauen locker aufeinander auf.

---

## 1. Gesamtanalyse — was existiert, in welchem Zustand

| Baustein | Ort | Umfang | Reifegrad | Kernproblem für „perfekt" |
|---|---|---|---|---|
| **Suite-Kern** (SubTermin, SubKosten, Ausschreibung, Pendenzen, Kalender, Abo/Auth) | `app.js` | **13'132 Z. / ~1'314 Funktionen** | Funktional reich, aber **monolithisch** | 1 Riesendatei, ~7 Abschnitts-Banner, **keine Tests**, Design teils uneinheitlich |
| **Submit PDF** | `/pdf` (`pdf.js` 7'822) | v586 | **Weit** (Viewer/Editor/CAD/BIM/Text-Edit/PDF→Paper) | Auch monolithisch; nur **1** Headless-Test deckt Kernlogik; Genauigkeit (kanonische Geometrie) offen |
| **Submit Paper** | `/write` (`write.js` 3'262) | v27 | Solide (Write/Calc/Vorlagen) | **Keine Tests**; Calc-Engine + Export-Treue ausbaubar |
| **Desktop (Tauri)** | `/src-tauri` | Gerüst | **Blockiert** | Rust nicht installiert; kein `.exe`-Beweis |
| **Online / SaaS** | `/supabase`, Auth in `app.js` | Auth + Abo + Stripe-Webhook | **Teilweise** | DB-Schema minimal (1.5 KB), **kein Sync-Layer**, keine RLS-Rollen |
| **Marketing-Site** | `/site` | Landing | Basis | Später: an finalen Look/Story angleichen |
| **Signatur/QES** | `/docs` | Konzept | Nur Doku | EES→FES→QES-Fahrplan, SwissSign später |

### Übergreifende Stärken
- Durchdachte **Vision** + **„für-immer-Format"-Prinzip** (JSON, Versionsnummer, Migration).
- **Adapter-Muster** für Speicher (Local aktiv, Cloud andockbar) — gute Grundlage für Online/Desktop.
- Sehr **feature-reich** in allen drei Editoren.
- Bereits **PWA-fähig** (Manifest + Service Worker).

### Übergreifende Schwächen (die „Perfektionierung" adressiert)
1. **Monolithen ohne Sicherheitsnetz:** `app.js`/`pdf.js` sind riesig, **fast ohne automatisierte Tests** (nur `pdf/test/selftest-node.js`). Jede Änderung ist Blindflug.
2. **Design nicht 100 % einheitlich** über die drei Apps (begonnen: PDF↔Paper-Tokens v577/v584).
3. **Kein Sync/Rollen** → SaaS-Versprechen noch nicht eingelöst.
4. **Desktop/Datei-Ablage** (der USP „für immer, dein Ordner") noch nicht real.
5. **Format/Migration** als Bauregel definiert, aber noch nicht durchgängig erzwungen.

---

## 2. Leitprinzipien der Perfektionierung (die Messlatte)
1. **Nicht kaputtbar** — Ansehen-Default, Undo über alles, Autosave + Verlauf, klare Rückfragen.
2. **Für immer lesbar** — JSON + Versionsnummer + automatische Migration in *jeder* Datei.
3. **Ein Design, drei Apps** — gemeinsame Tokens/Komponenten; PDF-Look als Referenz.
4. **Sicherheitsnetz zuerst** — kein Refactor/Feature ohne Headless-Test der Kernlogik.
5. **Kein Regressions-Risiko** — kleine Schritte, `--check` + Test + Commit/Push nach jedem Schritt.
6. **Handling vor Glanz** — flüssig, schnell, offline; Politur danach.

---

## 3. Querschnitt-Themen (gelten für ALLE Module)
Diese laufen als **eigene Sessions** (Phase 0) UND als **Disziplin** in jeder späteren Session mit:
- **A — Struktur:** Monolithen in klare Blöcke/Module gliedern, toten/doppelten Code raus.
- **B — Design-System:** gemeinsame CSS-Tokens + Komponenten (Buttons, Popups, Dialoge, Tabellen) über Suite + PDF + Paper.
- **C — Tests:** Headless-Selbsttests für Kernlogik (Geld/Datum/BKP/Kosten/Gantt/Calc/Konvertierung) — wie `pdf/test`.
- **D — Format + Migration:** ein einheitliches Datei-/Cache-Schema mit Versions-Übersetzer.
- **E — Nicht-kaputtbar:** Ansehen/Bearbeiten, Undo-Audit, Verlauf.
- **F — Performance/Handling:** Render, Scroll, grosse Dateien, mobiles Verhalten.

---

## 4. Der Mehr-Session-Fahrplan

### PHASE 0 — Fundament & Hygiene *(die Perfektionierungs-Basis — zuerst)*
> Ohne diese Basis ist jede spätere Politur riskant. Kurz, sicher, kein Feature-Risiko.

- **✅ S0.1 — Test-Netz Suite-Kern.** *(erledigt 4. Juli 2026)* Node-Headless-Selbsttest (`test/selftest-node.js` im Root, Muster wie `pdf/test`) + `selfTest()` in `app.js`. Deckt **32 Prüfungen**: Geld (chf/money/chfShort), Datum (fmtDate/addDays/isoOf/dayDiff/parseDateFlexible inkl. Monats-/Saison-/Ungültig-Fälle), BKP (parseBkp/bkpBase/bkpCmp), Domäne (teilSumme, gewerkeSorted), UID/esc. **DoD erreicht:** `node test/selftest-node.js` → **54/54 grün** (erweitert 4. Juli 2026 um die **geschäftskritischen Zahlen**: `nachtragSumme` (nur genehmigte), `rapportSumme`, `budgetDelta`, `schlussSumme`, `rp5` (Rappen-Rundung), `isVergeben`, `kostenZeile` (Prognose/Endsumme/Offen), `zahlungsplanCalc` (Raten/Total/kumuliert), `kostenDiff` (Versions-Vergleich changed/new/removed)).
- **✅ S0.2 — Test-Netz Submit Paper.** *(erledigt 4. Juli 2026)* `write/test/selftest-node.js` + `selfTest()` in `write.js` (strippt den `init();`-Autostart, testet DOM-frei). **23 Prüfungen:** A1-Adressierung (colToIdx/idxToCol/cellKey), `toNum`, **Formel-Engine** (Punkt-vor-Strich, Klammern, Potenz, Vergleiche, Passthrough, Zellbezüge A1*B1, SUMME(A1:C1)-Bereich, **Zirkelbezug** #ZIRKEL), `gridToHtml`. **DoD erreicht:** `node write/test/selftest-node.js` → 23/23 grün. *Hinweis: `htmlToGrid` + PDF→Paper-Konvertierung brauchen echtes DOM bzw. liegen in `pdf.js` (dortiges Test-Netz erweitern).*
- **✅ S0.3 — Design-System zentralisieren (PDF + Paper).** *(erledigt 4. Juli 2026)* Gemeinsame **`ui/tokens.css`** (kanonische grün/warme Palette + Schrift) als erstes Stylesheet in `/pdf` und `/write`; die geteilten Tokens aus `pdf.css`/`write.css` entfernt (app-spezifische wie `--bg`/`--paper`/`--shadow`/Layoutmasse bleiben lokal). **Visuell identisch** (Werte deckungsgleich, keine neu aufgelösten Tokens geprüft). Verhindert künftiges Auseinanderdriften von PDF ↔ Paper. **Entscheid:** die **Suite** (`styles.css`, blau/kühl) behält bewusst ihre eigene Identität und nutzt `ui/tokens.css` **nicht**. *Offen (eigene Session, falls gewünscht): Suite auf grün/warm migrieren (Token-Umbenennung `--brand→--accent` in styles.css **und** app.js).*
- **S0.4 — Struktur-Pass `app.js` (Teil 1).** Modul-Banner + Blöcke einziehen (Termine / Kosten / Ausschreibung / Kern), Funktionen je Modul zusammenziehen, offensichtlich toten Code raus. **Ohne** Verhaltensänderung, nach jedem Schritt `--check` + Test. **DoD:** klare Abschnitte, `git diff` nur Umsortierung, alle Tests grün.
- **S0.5 — Versionierung/Cache vereinheitlichen.** Ein Schema für Cache-Buster + Format-Version über alle Module (heute: PDF vXXX, Paper vXX getrennt). **DoD:** ein zentraler Versions-Mechanismus, dokumentiert.

### PHASE 1 — Suite-Kernmodule perfektionieren *(dein Alltag zuerst — M1)*
- **S1.1 — Kosten/Zahlungsplan (2 Sichten + Terminverknüpfung).** Zahlungsplan **Bauherr** und **Bauleitung** als klare Sichten; Tranchen ↔ Bau-Termine verknüpft; Bereich aufräumen. **DoD:** beide Sichten, Verknüpfung sichtbar, Test für die Plan-Rechnung.
- **S1.2 — Ausschreibung end-to-end.** Submittentenliste → Einladung (Deckblatt/Konditionen) → Mailversand → lückenlose Nachkontrolle (Status/Fristen/Eingänge/Erinnerungen). **DoD:** ein Durchlauf komplett klickbar, Status-Logik getestet.
- **S1.3 — Termine/Gantt-Politur.** Handling (Ziehen/Snap/Zoom), Baseline-Vergleich, Druck; Performance bei vielen Gewerken. **DoD:** flüssig bei 100+ Gewerken.
- **S1.4 — Pendenzen/Mängel (Desktop-Teil).** Liste, Status, Zuordnung zu Gewerk; Vorbereitung für Mobile/Planviewer. **DoD:** sauberer Pendenz-Workflow am Desktop.
- **S1.5 — Rechnungen/Nachträge.** QR-Rechnung erfassen, Nachtrags-Fluss, Kosten-Auswirkung; Zahlen getestet. **DoD:** ein Rechnungs-Durchlauf inkl. Summenprüfung.

### PHASE 2 — „Nicht kaputtbar" + Für-immer-Format *(Vertrauensschicht)*
- **S2.1 — Ansehen/Bearbeiten-Modus (global).** Default „Ansehen", bewusster „Bearbeiten"-Schalter; destruktive Aktionen gesperrt/versteckt. **DoD:** in Ansehen kann nichts zerstört werden.
- **S2.2 — Undo/Redo-Audit.** Jede Änderung macht Snapshot; Redo sichtbar; Strg+Z/Y überall. **DoD:** Stichproben-Test „ändern → undo → identisch".
- **S2.3 — Autosave + Verlauf.** Zeitbasierte Wiederherstellungspunkte + „Stand wiederherstellen"-Liste. **DoD:** letzten Stand aus Verlauf zurückholen.
- **S2.4 — Datei-Format + Migration.** Version in jeder Datei, automatischer Übersetzer beim Öffnen; Mini-Beweis „speichern → schliessen → öffnen → identisch". **DoD:** alte Testdatei öffnet migriert und korrekt.

### PHASE 3 — Submit PDF perfektionieren
- **S3.1 — PDF→Paper akkurater (Fortsetzung).** Spalten-/Tabellen-Erkennung härten, Kopf/Briefkopf, Überschriften ohne „:", OCR-Anschluss für gescannte PDFs (optional extern). **DoD:** typische Offerte/Rechnung nahezu layouttreu.
- **S3.2 — Kanonische Geometrie (CAD-Genauigkeit).** EINE 3D-Bauteilgeometrie → Plan/Schnitt/Ansicht/3D/Mengen projiziert (siehe Memory-Plan). **DoD:** Wand-Solids + slicePlane als A/B identisch zur alten Logik.
- **S3.3 — Signatur EES (live).** Einfache elektronische Signatur produktiv (FES/QES später, SwissSign nach Traktion). **DoD:** signieren + verifizieren im Dokument.
- **S3.4 — Performance/Handling Grossformate.** A0/A1-Pläne, Kachel-Vorrender, Speicher. **DoD:** flüssiges Scrollen/Zoomen bei A0.

### PHASE 4 — Submit Paper perfektionieren
- **S4.1 — Calc-Engine.** Mehr Funktionen, Bezüge, Fehlerbilder, robuste Formel-Neuberechnung. **DoD:** Formeln getestet (Headless).
- **S4.2 — Export-Treue.** PDF/DOCX/ODT exakter (Kopf/Fuss, Tabellen, Seitenumbruch). **DoD:** Referenz-Dokument exportiert originalgetreu.
- **S4.3 — Vorlagen-Bibliothek + Firmendaten/Logo.** Vorlagen mit automatischem Absender/Logo; mehr Bau-Vorlagen. **DoD:** neues Dokument trägt Firmendaten automatisch.

### PHASE 5 — Online / SaaS + Rollen *(grösster Block)*
- **S5.1 — Supabase-Projekt + Schema + RLS-Grundgerüst** (EU-Region). **DoD:** Konto anlegen, leeres Projekt in der Cloud.
- **S5.2 — Cloud-Adapter (Daten).** Projektdaten lesen/schreiben über den bestehenden Adapter. **DoD:** ein Projekt online gespeichert + wieder geladen.
- **S5.3 — Sync/Abgleich.** Offline-Cache, Upload bei Verbindung, „einer bearbeitet, Abgleich". **DoD:** offline ändern → online abgeglichen ohne Verlust.
- **S5.4 — 6 Rollen + Rechte-Matrix.** Chef/Planer/Hilfsbauleiter/Sekretärin/Unternehmer/Bauherr via RLS + einstellbare Rechte. **DoD:** Rolle wechseln → passende Ansicht/Rechte.
- **S5.5 — Abo/Stripe scharf.** Webhook + Entitlements produktiv, Free-Tier. **DoD:** Abo lösen schaltet Module frei.

### PHASE 6 — Desktop (Tauri) + Datei-Ablage *(der USP)*
- **S6.1 — Rust/Tauri-Build.** Rust installieren, `.exe` bauen, Icons. **DoD:** doppelklickbares Submit-PDF/Suite-`.exe`.
- **S6.2 — Datei-Verknüpfung + Direkt-Speichern.** `.pdf`/`.subprojekt` per Doppelklick, ohne Download-Umweg. **DoD:** Datei aus Explorer öffnet die App.
- **S6.3 — Ordner-/NAS-Ablage-Adapter.** Ordner wählen, feste Struktur, Index in der App; „keine Verbindung"-Zustand. **DoD:** Rechnung auf Gewerk ziehen → landet im gewählten Ordner.

### PHASE 7 — Mobile / Baustelle
- **S7.1 — Mobile Pendenz-Erfassung + Foto** (offline, Warteschlange). **DoD:** Pendenz+Foto offline → synct später.
- **S7.2 — Planviewer + Pins.** Plan anzeigen, Markierung setzen → Pendenz an der Plan-Stelle. **DoD:** Pin auf Plan erzeugt verortete Pendenz.
- **S7.3 — Mängel-Workflow/Liste** (Mangel → Pendenz → abhaken → Druck). **DoD:** Mängelliste als PDF.

### PHASE 8 — Politur, Onboarding, Launch
- **S8.1 — Fehlerjagd + Rand­fälle** (systematisch, mit den Test-Netzen). 
- **S8.2 — Onboarding** für neue Nutzer/Rollen (geführter Einstieg, „nicht kaputtbar" spürbar).
- **S8.3 — Marketing-Site** an finalen Look/Story angleichen.
- **S8.4 — Release** (M2): Versionen, Changelog, Backup/Export-Sicherheit, „absolut online".

---

## 5. Empfohlene Reihenfolge (verdichtet)
1. **Phase 0 komplett** (Sicherheitsnetz + Struktur + Design) — die Voraussetzung für „perfekt".
2. **Phase 1** (dein Alltag: Kosten/Zahlungsplan → Ausschreibung → Termine) → **Meilenstein M1: intern nutzbar**.
3. **Phase 2** (nicht-kaputtbar + Format) — bevor mehr Leute ran.
4. **Phase 3/4** (PDF/Paper-Perfektion) — laufen teils parallel zu 5.
5. **Phase 5** (Online/Rollen) → **Phase 6** (Desktop/Ablage) → **Phase 7** (Mobile).
6. **Phase 8** → **Meilenstein M2: Release**.

## 6. Qualitäts-Checkliste (bei JEDER Session abhaken)
- [ ] `node --check` / Headless-Test grün (Kernlogik gedeckt).
- [ ] Keine Regression (Stichprobe der berührten Funktion).
- [ ] Design-Tokens statt Einzelwerte; Zustände (Hover/Aktiv/Fokus) konsistent.
- [ ] Undo funktioniert für die neue Aktion; nichts unumkehrbar ohne Rückfrage.
- [ ] Offline lauffähig; grosse Daten/mobil geprüft, wo relevant.
- [ ] Version/Changelog + Commit/Push.

## 7. Risiko-Register
| Risiko | Wirkung | Gegenmassnahme |
|---|---|---|
| Monolith ohne Tests | Blindflug-Regressionen | **Phase 0 zuerst** (Test-Netze) |
| Big-Bang-Refactor | Wochenlanger Stillstand | Nur **kleine** Struktur-Schritte, Verhalten unverändert |
| Sync-Konflikte (Online) | Datenverlust | „einer bearbeitet, Abgleich"; ID/Zeitstempel/Herkunft; feldweiser Merge später |
| Desktop blockiert (Rust) | USP verzögert | S6.1 früh anstossen (unabhängig von Feature-Arbeit) |
| Format-Bruch | „für immer" verletzt | Migration-Pflicht + Format-Test bei jeder Formatänderung |
| Design driftet erneut auseinander | Uneinheitlich | Zentrale Tokens (S0.3), keine lokalen Farb-/Schatten-Werte |

## 8. Sofort-Empfehlung (nächste 1–2 Sessions)
1. **S0.1 + S0.2 — Test-Netze** für Suite-Kern und Paper. Das ist der grösste Hebel: ab dann kann alles Weitere **gefahrlos** perfektioniert werden.
2. Danach **S0.3 — Design-System zentralisieren** (schliesst die begonnene PDF↔Paper-Vereinheitlichung ab und verhindert erneutes Auseinanderdriften).

*Sag „mach Session 0.1" (oder eine andere Nummer) — dann setze ich genau dieses Paket um, mit Test + Commit.*
