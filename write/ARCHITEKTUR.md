# Submit Write — Architektur & Plan

> *„Schreiben ohne Ablenkung."* — Die eleganteste europäische Word-Alternative.
> Teil der **SubmitOne Suite**. Vanilla, dateibasiert, „nicht kaputtbar".

## 1. Grundentscheide (2026-06-21)

| Thema | Entscheid |
|---|---|
| **Stack** | Vanilla HTML/CSS/JS — **wie SubmitOne**, *nicht* Tauri/React. Zero-Dependency, läuft auf GitHub Pages. |
| **Ort** | Eigenes Modul `/write/` im SubmitOne-Repo. Standalone aufrufbar (`…/SubmitOne/write/`), später Suite-Modul. |
| **Dateiendung** | **`.gdoc`** (Gerber Document) — sauber getrennt von `.gerber` (= ganze SubmitOne-Projekte). |
| **Speicherung** | Lokal zuerst: Autosave in `localStorage`, Datei-Export/Import als `.gdoc`. Kein Login/Cloud nötig. |
| **Editor** | `contenteditable` + `execCommand` (dependency-frei). Upgrade-Pfad: ProseMirror/Tiptap-Core, falls nötig. |

## 2. Dateiformat `.gdoc`

Gleiche Envelope-Logik wie `.gerber` (Migrations-Regel: alte `formatVersion` nie fallenlassen):

```json
{
  "format": "gdoc",
  "formatVersion": 1,
  "typ": "dokument",
  "app": "Submit Write v1",
  "exportiert": "2026-06-21T…",
  "meta":  { "titel": "…", "autor": "…", "erstellt": "…", "geaendert": "…", "version": 1 },
  "inhalt": { "html": "…" },
  "einstellungen": { "schriftart": "…", "schriftgroesse": 16, "zeilenabstand": 1.7 }
}
```

## 3. Architektur (Module in write.js)

- **Bibliothek** — `localStorage`-Speicher aller Dokumente (`docs{}`, `order[]`, `currentId`), Autosave (800 ms Debounce).
- **Dokument** — Laden/Anlegen/Wechseln, Einstellungen anwenden.
- **Datei-I/O** — `.gdoc` speichern/öffnen via File System Access API + Download/Upload-Fallback + `launchQueue` (Doppelklick).
- **Formatierung** — Blockformate, Inline-Stile, Farbe, Schriftgrösse, Tabellen, Links.
- **Analyse** — Live-Statistik (Wörter/Zeichen/Absätze/Seiten/Lesezeit), Gliederung (Outline aus Überschriften).
- **Export** — PDF (Druck), HTML, Markdown, DOCX (Beta via Word-HTML).
- **UI-Zustand** — Theme (hell/dunkel), Fokusmodus, Seitenleiste, Inspector.

## 4. UI-Konzept (Schweizer Minimalismus)

```
┌────────────┬─────────────────────────────────┬───────────┐
│  Seiten-   │  Topbar: Titel · Speicherstatus  │ Inspector │
│  leiste    │          · Öffnen/Speichern/Exp. │  (rechts) │
│            ├─────────────────────────────────┤  Gliede-  │
│ + Neu      │  Format-Leiste (schlank)         │  rung     │
│ Dokumente  ├─────────────────────────────────┤  Zeilen-  │
│ Favoriten  │                                  │  abstand  │
│ Zuletzt    │      ███ A4-Blatt (der Held) ███ │  Statistik│
│ Vorlagen   │      weicher Schatten, 80% Fläche│           │
│ Archiv     │                                  │           │
│ Papierkorb ├─────────────────────────────────┤           │
│ ☾ Theme    │  Statusleiste: Wörter · Seiten…  │           │
└────────────┴─────────────────────────────────┴───────────┘
```
**Fokusmodus** blendet alles ausser dem Blatt + Cursor aus (Strg+Umschalt+F / Esc).

## 5. Roadmap bis v1.0

- [x] **v1** — A4-Editor, Formatierung, `.gdoc` Speichern/Öffnen (Roundtrip-Beweis), Autosave, Vorlagen, Fokusmodus, Dark Mode, Statistik, Gliederung, Export (PDF/HTML/MD/DOCX-Beta).
- [ ] **v2** — Bilder einfügen (eingebettet/Base64), Tabellen-Werkzeuge (Zeile/Spalte), Inhaltsverzeichnis-Block, Suche im Dokument.
- [ ] **v3** — `manifest.webmanifest` + `file_handlers` (echtes Doppelklick-Öffnen), Service Worker (offline), PWA-Installierbar.
- [ ] **v4** — Seitenumbruch-Vorschau (echte Mehrseiten-Ansicht), Kopf-/Fusszeilen, Seitenränder einstellbar.
- [ ] **v5** — Versionsverlauf (Snapshots wie SubmitOne), Kommentare.
- [ ] **v1.0** — Politur, Tastatur-Vollabdeckung, professioneller PDF-Export (Seitenränder/Schriften).

## 6. Submit PDF (separates Programm — später)

Eigenständiges Modul `/pdf/`, das **die Formate liest, die hier entstehen**:
- öffnet `.gdoc` (Submit Write) und die Druckausgaben von SubmitOne (`openPrintDoc`),
- Ansicht + Anmerkungen + Zusammenführen/Export als PDF,
- gleiche Vanilla-Bauweise, gleiche Envelope-Philosophie.

## 7. Suite-Anbindung (Vision, schon kompatibel gebaut)

- Ein **`.gerber`-Projekt** (Container, wie ZIP) kann mehrere `.gdoc`-Dateien **referenzieren/bündeln** — siehe Suite-Vision.
- Module greifen über die Projekt-Mappe ineinander (Termin ↔ Kosten ↔ **Dokumente**).
- Online-Hybrid (Supabase) später — `.gdoc` bleibt der portable, langlebige Kern (kein Lock-in).
