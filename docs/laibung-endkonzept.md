# Endkonzept — Öffnung mit vier Laibungen & Prioritäten

Stand der Planung (v434). Ziel: EINE Öffnung (Fenster/Tür) ist EIN Bauteil, aus dem alle
Sichten (Grundriss, Schnitt, Ansicht, 3D, Mengen) abgeleitet werden. Dieses Dokument
beschreibt den **Zielzustand**, gegen den wir stufenweise bauen.

---

## 1. Das Bauteil

```
                 STURZ (oben)
        ┌───────────────────────────┐
        │   │                   │   │
 LAIB-  │   │      GLAS /       │   │  LAIB-
 UNG    │   │      FLÜGEL       │   │  UNG
 links  │   │                   │   │  rechts
        │   │                   │   │
        └───────────────────────────┘
                SCHWELLE (unten)
```

- **Ein Rahmen** + **vier Laibungen**: links, rechts, **Sturz** (oben), **Schwelle** (unten).
- Jede der vier Laibungen hat eine **Innen-** und eine **Außen-Seite** → bis zu **8 Laibungsflächen**.
- Jede Fläche ist **unabhängig frei**: eigene Schichtliste, eigene Lappung, **schräg** möglich.

---

## 2. Koordinaten je Laibungsfläche

Pro Fläche (z. B. „links innen") gibt es zwei Achsen:

- **Tiefe (m):** von der Wandfläche bis zum Rahmen (über die Wanddicke).
- **Lappung (s):** wie weit die Laibung seitlich **auf den Rahmen** ragt (Richtung Öffnung).

```
  Wandfläche                         Rahmen
     │                                 │
     │   ←———— Tiefe (m) ————→         │
     ▼                                 ▼
     ████ Deckschicht (Putz) ██████████│░░  ← lappt voll auf den Rahmen
     ████ Dämmung ███████████████░░░░░░│      (Dämmung tritt um Putzdicke zurück)
                                   ↑    ↑
                            Step-back   1 cm Rahmen sichtbar (boardVis)
```

- **Standard-Lappung** = `Rahmenbreite − boardVis` (Default `boardVis = 1 cm` → 9 cm von 10 cm gedeckt).
- **Schichten stapeln in die Tiefe** (Deckschicht an der Wandfläche zuerst).
- **Step-back:** die Deckschicht lappt voll, dahinterliegende Schichten treten um die Dicke der
  davorliegenden zurück → „Putz reinziehen, Dämmung geht zurück".
- Optionaler **Luft-Abstand** zwischen zwei Schichten.
- **Schräg:** die Tiefen-Achse kann geneigt sein (geneigte Laibung, z. B. Fensterbank-Anlauf).

---

## 3. Prioritäten (der Kern)

Jede Schicht / jedes Bauteil hat eine **Priorität**. Beim Aufeinandertreffen gewinnt die höhere:
sie läuft durch, die **niedrigere endet** an ihr.

Beispiele (vom Nutzer):

1. **Brett quer vor dem Putz:** Brett (Laibung) hat höhere Priorität → der **Putz endet am Brett**.
2. **Schalung außen, Brett quer davor:** das Brett stoppt die Schalung → die **Schalung endet am Brett**.
3. **Keine Sperre:** eine Schicht (z. B. Schalung) läuft **bis max ins Lichte** = bis `1 cm vom Rahmen`.

Regel in einem Satz:
> Eine Schicht füllt in ihre Richtung, bis sie (a) ein höher priorisiertes Bauteil trifft
> oder (b) das Lichtmaß (Rahmen − boardVis) erreicht — was zuerst kommt.

---

## 4. Der Rest der Wand passt sich an

- Wandschichten **enden an der Öffnung/Laibung** — „das Fenster ist in meiner Schicht und
  schneidet sich darum herum aus."
- Technisch sauber: **echtes Boolesches Ausschneiden** der Öffnung aus den Wandschicht-Polygonen
  (statt einer weißen Maske darüber). Dann gibt es keine Überlappungen mehr.
- Die Laibung ist die **Fortsetzung** der Wand-Deckschichten um die Ecke (gleiche Materialien),
  nicht ein zweites, getrenntes System.

---

## 5. Datenmodell (Ziel)

```
opening.reveals = {
  L: { in: [Layer…], out: [Layer…], slope: 0 },   // links
  R: { in: […],      out: […],      slope: 0 },   // rechts
  T: { in: […],      out: […],      slope: 0 },   // Sturz oben
  B: { in: […],      out: […],      slope: 0 },   // Schwelle unten
}
Layer = { mat, t (cm), gap (cm), prio, lap? }       // lap optional, sonst Standard
opening.boardVis = 1        // cm Rahmen sichtbar (Standard-Lappung = frameW − boardVis)
```

- Fehlt eine Kante/Seite → Fallback auf die heutigen `revealLining` / `revealLiningOut`
  (= „gilt für alle Kanten"). Rückwärtskompatibel.
- **Auto-Default:** beim Setzen einer Öffnung übernimmt jede Fläche die passenden
  Wand-Deckschichten (innen: innere Schichten; außen: äußere Schichten inkl. Dämmung),
  Deckschicht zuerst. → Sofort sinnvoll, von dort frei editierbar.

---

## 6. Ableitung der Sichten (eine Quelle)

| Sicht       | Laibung-Quelle                                           |
|-------------|----------------------------------------------------------|
| Grundriss   | links = `reveals.L`, rechts = `reveals.R` (in + out)     |
| Schnitt     | oben = `reveals.T` (Sturz), unten = `reveals.B` (Schwelle)|
| Ansicht     | sichtbare Deckschicht je Kante, Rahmen 1 cm sichtbar     |
| 3D          | Laibungs-Solids je Fläche                                |
| Mengen      | Fläche/Volumen je Material aus den Laibungs-Solids       |

---

## 7. Editor-UX (Detail-Fenster)

- **Kanten-Wahl:** [ Alle · Links · Rechts · Sturz · Schwelle ] → wählt, welche Fläche editiert wird.
- Pro Fläche: **innen / außen**, darunter die **Schichtliste** (Material · Dicke · Abstand · Priorität).
- Dauerhafte Anzeige **„Rahmen 10 cm · davon sichtbar 1 cm · Laibung deckt 9 cm"** + Feld „Rahmen sichtbar".
- **„⇄ Innen/Außen tauschen"** (Wandaufbau spiegeln) — bereits vorhanden.
- Klick auf eine Schicht/Fläche im Bild markiert sie (wie heute Wandschichten).

---

## 8. Bau-Reihenfolge (Vorschlag)

1. **Per-Kante Datenmodell + Editor-Kanten-Picker** (L/R/T/B × innen/außen), Grundriss L/R unabhängig,
   Schnitt Sturz/Schwelle. ← Fundament.
2. **Wand boolesch an Öffnung/Laibung ausschneiden** (behebt Überlappungen).
3. **Prioritäts-Engine** (Schicht-Priorität → Clipping; Schalung bis Lichte, Putz endet am Brett).
4. **Schräge Laibung** (geneigte Fläche).
5. **3D + Mengen** aus den Laibungs-Solids.

> Jede Stufe wird einzeln gebaut, headless geprüft und von dir visuell abgenommen,
> bevor die nächste beginnt.
