# SubmitOne — Veröffentlichungs-Analyse: „Was fehlt noch?"

*Stand: 4. Juli 2026. Ehrliche Bestandsaufnahme aus dem **echten Code** (nicht aus dem Gedächtnis), mit Blick auf einen realen Launch. Ergänzt [PERFEKTIONIERUNG.md](PERFEKTIONIERUNG.md) um die Frage: **Was blockiert die Veröffentlichung — und in welcher Reihenfolge?***

---

## 0. Die entscheidende Vorfrage: WELCHE Veröffentlichung?

Der Code steht heute zwischen zwei Produkten. Das muss **zuerst** entschieden werden, weil es bestimmt, was „fehlt":

| Szenario | Was es ist | Reifegrad heute | Aufwand bis Launch |
|---|---|---|---|
| **A — Lokales Gratis-Tool** | PDF/Paper/Suite laufen im Browser, alles lokal, kein Konto | **~90 % fertig** | **klein** (Recht + Politur) |
| **B — Cloud-SaaS mit Konten + Abo** | Login, geteilter Arbeitsbereich, bezahlte Module | **~55 % fertig** | **groß** (Mandanten, Zahlung, Recht, Support) |

> **Befund:** Die **Marketing-Site** (`site/index.html`) verkauft klar Szenario A („*Kein Konto, kein Tracking, kein Upload. Alles läuft lokal.*"). Die **App** (`app.js`) enthält aber bereits Szenario B: echtes Supabase-Login (`signInWithPassword`/`signUp`), Cloud-Sync (`entities`-Tabelle + Realtime) und eine Abo-/Entitlement-Logik (`isPaid`/`modulAktiv`). **Das passt nicht zusammen** und ist der wichtigste zu klärende Punkt.

**Empfehlung:** **Jetzt Szenario A veröffentlichen** (schnell, ehrlich, geringes Risiko), Szenario B als klar getrennten „Cloud/Team"-Schritt danach. Die Cloud-Teile bleiben im Code (opt-in über `config.js`), werden aber erst beworben, wenn Mandanten-Trennung + Zahlung + Recht stehen.

---

## 1. Was ist FERTIG (Launch-tauglich) ✅

- **Drei funktionsreiche Apps**: Suite (`app.js`), Submit PDF (`pdf/`), Submit Paper (`write/`).
- **Sicherheitsnetz**: 183 Headless-Prüfungen (Suite 90 · Paper 33 · PDF 60) — Geld/Datum/BKP/Kosten/Calc/Konvertierung.
- **PWA**: `manifest.webmanifest` + Service Worker (`sw.js`, `pdf/sw.js`) → installierbar/offline.
- **„Nicht kaputtbar"-Basis**: Undo, 14 Lösch-Rückfragen, Ansehen-Modus (PDF/Paper), additive Migration.
- **Design**: PDF ↔ Paper über `ui/tokens.css` vereinheitlicht.
- **Marketing-Site** (`site/`) existiert als Landing.

---

## 2. LAUNCH-BLOCKER (vor jeder Veröffentlichung) 🔴

### B1 — Rechtstexte fehlen komplett *(gilt für A **und** B)*
Es gibt **kein Impressum, keine echte Datenschutzerklärung, keine AGB**. Der „Datenschutz"-Abschnitt der Site ist ein Marketing-Text, kein Rechtstext.
- **Pflicht in CH/EU**, sobald die Seite öffentlich ist — verschärft, sobald Konten/E-Mails/Zahlungen dazukommen (revDSG + DSGVO).
- **Nötig:** Impressum/Kontakt, Datenschutzerklärung, (bei Abo) AGB + Widerruf.
- **Aufwand:** klein (1 Session) — als eigene Seiten in `site/` + Footer-Links.

### B2 — Positionierung vs. Realität auflösen *(siehe §0)*
Site sagt „kein Konto/kein Upload", App bietet Konto/Upload/Abo. **Vor Launch entscheiden** und Texte + Feature-Sichtbarkeit angleichen. Sonst: Vertrauensbruch + falsche Datenschutz-Aussage.

### B3 *(nur Szenario B)* — Mandanten-Trennung fehlt in der Datenbank
`supabase-schema.sql`: die RLS-Policy erlaubt **jedem angemeldeten Nutzer Lesen/Schreiben/Löschen ALLER Daten** (`auth.role() = 'authenticated'`). Das ist korrekt für **einen** geteilten Team-Arbeitsbereich (ein Supabase-Projekt = eine Firma), aber **untauglich für mehrere Kunden** auf einem Backend → jeder Kunde sähe die Projekte aller anderen.
- **Nötig für echten SaaS:** `org_id`/`team_id` an `entities`, RLS pro Team (Membership-Tabelle).
- **Aufwand:** mittel–groß. **Für Szenario A irrelevant.**

### B4 *(nur Szenario B)* — Zahlung nicht scharf
`config.js` → **alle `STRIPE_LINKS` leer**; „Freischalten/Upgraden" führt ins Leere. Die `entitlements`-Tabelle, auf die `app.js` zugreift (`supa.from('entitlements')`), **fehlt im Schema** (`supabase-schema.sql` enthält nur `entities`). Der Stripe-Webhook (`supabase/functions/stripe-webhook`) ist verdrahtet, aber ohne Links/Tabelle nicht produktiv.
- **Nötig:** Stripe-Produkte/Payment-Links, `entitlements`-Schema + Webhook-Test end-to-end.
- **Aufwand:** mittel. **Für Szenario A irrelevant** (dort ist alles gratis/permissiv).

---

## 3. WICHTIG vor Launch (Qualität/Vertrauen) 🟡

- **W1 — Fehlerverhalten/Robustheit:** Was passiert bei kaputter Datei, vollem `localStorage`, abgebrochenem Cloud-Speichern? (Teilweise da: `toast` bei Cloud-Fehler.) Ein globaler Fehler-Fänger + freundliche Meldungen fehlen.
- **W2 — Datensicherheit lokal:** `localStorage` kann verloren gehen (Browser-Reset). **Export/Backup** existiert (`format:'gerber'`), aber ein sichtbarer „Sichern/Wiederherstellen"-Fluss + Autobackup fehlt (Phase 2, S2.3).
- **W3 — Onboarding:** Erststart ohne Erklärung. Ein kurzer geführter Einstieg / Beispielprojekt senkt Absprung (Phase 8, S8.2).
- **W4 — Mobile/Touch:** Suite/PDF am Handy nur grob geprüft. Mind. „läuft & lesbar" verifizieren.
- **W5 — Cloud-/Auth-/Abo-Logik ungetestet:** Sync-Adapter, `effektivPlan`/`modulAktiv` haben **keine** Headless-Tests (nur reine Logik ist gedeckt). Bei Szenario B nachrüsten.
- **W6 — Performance Grossformate:** A0/A1-Pläne im PDF (Phase 3, S3.4) — für Bau-Zielgruppe relevant.

---

## 4. SPÄTER / nach Launch 🟢

- **Desktop (Tauri)** — blockiert auf Rust-Installation; kein Web-Launch-Blocker (USP „dein Ordner").
- **Signatur EES/FES/QES** — Konzept in `docs/`, SwissSign nach Traktion.
- **Kanonische CAD-Geometrie** — großer PDF-Genauigkeits-Block (S3.2).
- **Mobile Pendenz/Planviewer** (Phase 7).
- **Struktur-Refactor** der Monolithen (`app.js`/`pdf.js`) — reine Hygiene, kein Launch-Blocker.

---

## 5. Empfohlener Pfad zur Veröffentlichung

### 🚀 „Soft Launch" (Szenario A) — realistisch in wenigen Sessions
1. **L1 — Rechtstexte** (B1): Impressum + Datenschutz + (Footer-Links) in `site/`. *← größter, billigster Hebel.*
2. **L2 — Positionierung ehrlich** (B2): Cloud-Teile als „optional/Beta" kennzeichnen oder ausblenden; Site-Claims an die Realität anpassen.
3. **L3 — Robustheit** (W1) + **sichtbares Backup/Restore** (W2).
4. **L4 — Mobile-Check** (W4) + **Onboarding-Minimum** (W3).
5. **L5 — Site-Politur + „installieren"-Fluss** testen (PWA), dann **online stellen**.

### 💳 „Cloud/Team-Launch" (Szenario B) — danach, als eigener Block
6. **Mandanten-Trennung** (B3): `team_id` + RLS + Membership.
7. **Zahlung scharf** (B4): Stripe-Links + `entitlements`-Schema + Webhook-Test.
8. **Cloud-/Abo-Tests** (W5) + Support-/Konto-Verwaltung.

---

## 6. Ampel-Kurzfassung

| Bereich | Ampel | Kernsatz |
|---|---|---|
| Kern-Apps (PDF/Paper/Suite) | 🟢 | Funktionsreich, getestet, offline. |
| Recht (Impressum/DS/AGB) | 🔴 | **Fehlt komplett — harter Blocker.** |
| Positionierung lokal vs. Cloud | 🔴 | Site und App widersprechen sich. |
| Cloud-Mandanten-Trennung | 🔴 (nur B) | Alle Nutzer sehen alle Daten. |
| Zahlung (Stripe) | 🔴 (nur B) | Links leer, `entitlements`-Schema fehlt. |
| Robustheit/Backup | 🟡 | Export da, sichtbarer Sicher-Fluss fehlt. |
| Onboarding/Mobile | 🟡 | Läuft, aber ungeführt/ungeprüft. |
| Desktop/Signatur/CAD | 🟢 später | Kein Web-Launch-Blocker. |

**Kürzester ehrlicher Weg online:** Rechtstexte (L1) + Positionierung (L2) + Robustheit/Backup (L3) → **Szenario A ist launchfähig.** Alles Weitere (Konten, Team, Bezahlung) als klar getrennter zweiter Schritt.
