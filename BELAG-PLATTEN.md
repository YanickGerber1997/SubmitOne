# Submit PDF — Feature „Belag & Platten" (Boden- & Wandbelag mit Plattenspiegel)

*Stand: 5. Juli 2026. Ziel (Wunsch Bauleiter): PDFs ausmessen und **Beläge planen** — Flächen/Räume mit Plattenspiegel (Startpunkt, Plattenmass, Einteilung, Schraffur) und Wände mit Höhe → Wandfläche, alles rechts in der Liste zusammengefasst. Wird **auf dem vorhandenen CAD-Gerüst** aufgebaut (`area`, `wall`, Massstab `docScale`, Anmerkungs-Modell `annos`), nicht daneben.*

---

## Das Ziel in einem Satz
Zwei neue Werkzeuge in Submit PDF:
1. **🟫 Bodenbelag** — Raum/Fläche ziehen → Plattenspiegel planen (Plattenmass, Fuge, Startecke/-punkt, Verlegerichtung) → Schraffur/Raster im Plan + Fläche & Plattenanzahl in der Liste.
2. **🧱 Wandbelag** — Wand messen (Länge) + **Höhe eingeben** → Wandfläche (Länge×Höhe) → gleiche Plattenlogik je Wand → in der Liste unter „Wandflächen" summiert.

---

## Vorhanden (darauf bauen wir)
- **Massstab** `docScale.perPt` (m pro PDF-Punkt) – über die Fusszeile setzbar. Ohne ihn kein m².
- **Flächen-Werkzeug** `area` (`a.pts` Polygon, `a.room`, `a.name`, `areaLabel(pts)` → m²) + Raumbuch-Liste.
- **Geometrie** `polyArea`, `centroid`, `pointInPoly`, `insetPolygon`.
- **Anmerkungs-Modell** `annos` (pro Seite), generisch gespeichert/geladen (neue Felder „reisen" automatisch mit).
- **Rechte Liste** (`list-panel`, `lp2`-Tabs, `computeQuantities`) – dort werden Mengen gruppiert.

## ✅ Schritt 1 — Rechenkern (erledigt, getestet)
Reine, headless-getestete Funktionen in `pdf.js` (pdf selftest 60 → 64):
- `wallFaceAreaM2(lenPts, perPt, heightM)` — Wandfläche.
- `tilePlan(widthM, heightM, tileWcm, tileHcm, jointMm)` → `{cols, rows, count, unitM2}` — Plattenraster.
- `tilesForArea(areaM2, tileWcm, tileHcm, wastePct)` — Netto-Plattenbedarf inkl. Verschnitt.

## Fahrplan (nächste Schritte, je 1 „weiter")
- **S2 — Datenmodell + Belag an Fläche.** `area`-Anmerkung um `belag` erweitern: `{ tileW, tileH, joint, start:[x,y]|'ecke', angle, waste, name, aufbau }`. Default-Werte, migrationssicher (additiv).
- **S3 — Plattenspiegel zeichnen.** Im `area`-Render-Zweig: bei `a.belag` ein Raster (clipPath = Polygon; Linien im Plattenmass ab Startpunkt; optional 45°). Nicht-skalierender Strich, dezent.
- **S4 — Werkzeug „Bodenbelag" + Einstell-Popup.** Neues Toolbar-Symbol; nach dem Aufziehen Popup: Plattenmass (z. B. 60×60), Fuge, Startecke, Richtung, Verschnitt, **Aufbau-Label** (OK FB / OK roher Boden / Bodenaufbau). Live-Vorschau.
- **S5 — Werkzeug „Wandbelag" + Höhe.** Neues Symbol: Wand messen (2 Punkte) → Höhe abfragen → Wandfläche; gleiche Platten-/Aufbau-Optionen (Höhe, Einteilung, Startfuge).
- **S6 — Liste/Mengen.** In `computeQuantities`/Liste zwei Gruppen: **Bodenbeläge** (Raum · m² · Platten Stk · Aufbau) und **Wandflächen** (Wand · L×H · m² · Platten). Summen. Export/Druck.
- **S7 — Feinschliff.** Beschriftung im Plan (Name + m² + „⌗ 60×60"), Muster-/Farbwahl, „ab hier verlegen"-Griff (Startpunkt ziehen), Kopfzeile je Platte.

## Erweiterung „echte Ausschreibung" (Nutzer-Anforderung 5. Juli)
Ziel-Ausgabe ist **Submit Paper**, nicht Excel — als **Ausschreibung** (Spalten: **Pos · Beschrieb · Ausmass · Einheit · Einheitspreis (leer) · Betrag (leer)**) ODER **Mengenauszug** (ohne Preisspalten). Zusätzlich müssen berücksichtigt werden:
- **Anschlüsse** (Längen, lfm), getrennt nach **Anschluss Boden / Wand / Decke** und **Anschlüsse bei Fenstern** (Laibung/Anschlussfugen).
- **Aussparungen** in Belagsflächen: **Schränke, Duschelemente** usw. → von der Fläche abziehen.

- **✅ S8 — Export nach Submit Paper.** `buildBelagTableHtml(floors, walls, price)` (rein, getestet) + `exportBelagToPaper('ausschreibung'|'mengen')`; Übergabe via `submitpaper_import` → `../write/?import=1`. Zwei Knöpfe im „Beläge"-Tab. Pos-Nummern 1.1/1.2 + Zwischentotals.
- **S9 — Anschlüsse.** Neues Werkzeug „Anschluss" (Polylinie = Länge, lfm) mit Kategorie **Boden/Wand/Decke/Fenster**; eigene Gruppen in Liste + Ausschreibung (Einheit lfm). Evtl. auto: Umfang einer Belagsfläche als Anschluss vorschlagen.
- **S10 — Aussparungen.** In einer Belagsfläche Sub-Polygone (Schrank/Dusche) markieren → Netto-Fläche = brutto − Aussparungen; im Plattenspiegel ausgespart; in Liste/Ausschreibung als „abzüglich".

## Leitplanken
- **Nicht-destruktiv & migrationssicher**: neue Felder additiv; alte Dokumente öffnen unverändert.
- **Massstab-Pflicht** für m²/Platten: ohne `docScale` klar hinweisen (wie bei `area`).
- **Jede Kern-Berechnung headless getestet**, bevor UI dazukommt.
- **Reuse vor Neubau**: Boden = erweitertes `area`; Wand = schlankes neues Face-Tool (kein CAD-Solid nötig).
