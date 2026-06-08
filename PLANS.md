# SubmitOne — Baupläne der grossen Etappen (entscheidungsreif)

*Stand: 9. Juni 2026. Durchgeplant über Nacht als Vorarbeit. **Nichts hiervon ist gebaut** — das sind die grossen Brocken mit echten Design-Entscheidungen (die du dir vorbehalten hast). Umsetzung startet mit deinem Go + den unten markierten Entscheidungen. Gegründet auf dem, was schon im Code steckt.*

---

## A) „Nicht kaputtbar" (Etappe 3)
**Schon da:** Undo/Redo (`snapshotForUndo`, `undo`, `redo`, `updateUndoButtons` + Buttons in der Sidebar), Autosave (`save()`), Versionen (Termin/Kosten).
**Bausteine:**
1. **Ansehen-Modus per Default** + bewusster „Bearbeiten"-Schalter (global). In Ansehen: Eingaben/Ziehen/destruktive Aktionen gesperrt, Edit-Knöpfe versteckt.
2. **Undo/Redo vervollständigen:** sicherstellen, dass **jede** Änderung einen Snapshot macht; Redo sichtbar; Strg+Z/Y überall.
3. **Verlauf / Wiederherstellungspunkte:** automatische Snapshots (zeitbasiert) + „Stand wiederherstellen"-Liste.
4. **Destruktive Aktionen härten:** Löschen/Überschreiben immer mit klarer Rückfrage.

**Offene Entscheidungen (für dich):** Default „Ansehen" für alle oder nur bestimmte Rollen? · Verlauf: wie viele Punkte / wie lange?
**Bau-Schritte:** (a) globaler readonly-Schalter + CSS-Sperren · (b) Undo/Redo-Audit · (c) Verlauf-Liste · (d) Rückfragen-Audit.

---

## B) Online + Konten + Rollen (Etappe 6 — grösster Block)
**Schon da:** Supabase-**Auth** (Login/Logout, Entitlements/**Abo**, `cloudEnabled`, `subscribeCloud`), **Adapter-Pattern** (`LocalAdapter` aktiv, Cloud-Adapter andockbar).
**Bausteine:**
1. **Sync-Layer:** Projektdaten lokal↔Supabase abgleichen („einer bearbeitet, Abgleich"); Offline-Cache, Upload bei Verbindung.
2. **Datenmodell mehrbenutzertauglich:** jedes Objekt ID/Zeitstempel/Herkunft.
3. **6 Rollen via Supabase-RLS:** Chef/Bauleiter · Planer/Architekt · Hilfsbauleiter · Sekretärin · Unternehmer/Handwerker · Bauherr; **Rechte pro Rolle einstellbar** (Rechte-Matrix).
4. **Datei-Ablage (dein Ordner-Modell) anbinden:** Index in Supabase, Bytes im gewählten Ordner (PC/NAS/OneDrive/Dropbox).

**Offene Entscheidungen:** Sync-Granularität (ganzes Projekt vs. pro Datensatz)? · Konflikt-Strategie (sperren vs. feldweise mergen)? · Rollen-Default-Rechte (Startwerte der Matrix)? · Supabase-Projekt + EU-Region aufsetzen.
**Bau-Schritte:** (a) Supabase-Projekt + Schema + RLS · (b) Cloud-Adapter (Daten) · (c) Sync/Abgleich · (d) Rollen + Rechte-Matrix-UI · (e) Datei-Index-Anbindung. → in Unter-Etappen, nicht in einem Rutsch.

---

## C) Handy / Pendenzen / Planviewer / Mängel (Etappe 7)
**Schon da:** Pendenzen (`viewPendenzen`, `offenePendenzen`), Mängel-Status, Bild-Upload-Muster (Logo: Datei→dataURL), **PWA** (mobil installierbar).
**Bausteine:**
1. **Mobile Pendenz-Erfassung:** sehr einfache Maske, offline, **Foto aufnehmen/anhängen**.
2. **Foto-Anhang** an Pendenz/Gewerk (komprimiert), Ablage über dein Ordner-Modell.
3. **Planviewer:** Plan (PDF/Bild) anzeigen, zoomen, **Markierung/Pin setzen** → wird Pendenz **an der Plan-Stelle**.
4. **Mängel-Workflow:** Mangel → Pendenz → abhaken → Status; Mängelliste/Druck.

**Offene Entscheidungen:** Planviewer nur Markieren, oder auch Messen/Ebenen? · Foto-Kompressionsgrad (Qualität vs. Grösse)? · Eigene schlanke **Mobil-Ansicht** (Rolle Hilfsbauleiter) — Umfang?
**Bau-Schritte:** (a) mobile Pendenz-Maske + Foto · (b) Foto-Ablage/Kompression · (c) Planviewer + Pins · (d) Mängel-Workflow/Liste.

---

## Einordnung
Diese drei sind **Etappe 3 / 6 / 7** — sie kommen **nach** den Modul-Durchgängen (Kosten/Zahlungsplan → Ausschreibung → Termine). Hier ist **nur geplant**. Sobald du wach bist: kurz die markierten Entscheidungen, dann bauen wir zügig — die Vorarbeit steht.
