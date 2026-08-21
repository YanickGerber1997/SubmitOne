# Vorlagendateien — eine fertige Liste einlesen

Wer 400 Karten hat, tippt sie nicht ab. Er füllt eine Tabelle aus (oder lässt
sie ausfüllen) und liest sie in einem Zug ein.

> **Für Sammelkarten geht es noch kürzer:** *Kosten → 🔎 Objekt nachschlagen*.
> Dort die achtstellige Nummer von der Karte eintippen, Enter — Name, Kartenart,
> Set, Seltenheit, Bild und Marktwert holt das Programm selbst. Enter nochmals
> übernimmt und das Feld ist wieder leer für die nächste Karte. Siehe unten,
> [Nummer nachschlagen](#nummer-nachschlagen-nur-sammelkarten).

## Der Weg

1. **Projekt anlegen** und ihm unter *Einstellungen → Vorlage* die passende
   Vorlage geben (oder gleich den Standard umstellen, dann erben es alle neuen).
2. Die passende Datei hier öffnen — oder direkt in der Anwendung
   *Einstellungen → Vorlage → ⬇ Vorlagendatei (CSV) speichern*.
3. Ausfüllen. Die Beispielzeilen dürfen stehen bleiben oder weg.
4. Im Projekt auf **Kosten → 📋 Liste einlesen**, Datei wählen, **Prüfen**,
   dann **Übernehmen**.

Geprüft wird vor dem Übernehmen: Die Vorschau zeigt, was hereinkäme. Erst der
zweite Klick legt an.

## Die Dateien

| Datei | für |
|---|---|
| `vorlage-bau.csv` | Bauvorhaben, Gewerke nach BKP |
| `vorlage-sammlung.csv` | Sammlung & Verkauf — Karten, Münzen, Figuren |
| `vorlage-unterschriften.csv` | Unterschriftensammlung nach Region |
| `vorlage-it.csv` | IT-Projekt, Arbeitspakete nach Projektstrukturplan |

## Die Spalten (Beispiel Sammlung)

| Spalte | was hineingehört | wo es landet |
|---|---|---|
| **Nr.** | Kategorie aus dem Katalog, z.B. `101` für Monsterkarten | die Nummer des Postens |
| **Objekt** | die Bezeichnung, z.B. „Blauäugiger weisser Drache, 1. Auflage" | der Name |
| **Einstand** | was du dafür bezahlt hast | Spalte *Einstand* |
| **Marktwert** | was es heute wert ist | Spalte *Marktwert* (zählt als Angebot vom Markt) |
| **Angebot** | für wie viel du es eingestellt hast | Spalte *Angebot* |
| **Angebot bei** | wo es liegt: Cardmarket, Ricardo, eBay, Tutti … | Spalte *Angebot bei* |
| **Erhalten** | was schon gutgeschrieben ist | Spalte *Erhalten*, als bezahlter Eingang |
| **Status** | `Im Bestand`, `Angeboten`, `Verkauft`, `Versand unterwegs` … | der Lebenslauf des Postens |
| **Notiz** | Zustand, Sprache, Auflage — alles Freitext | die Notiz |

Leere Zellen sind in Ordnung. Fehlt der Status, wird er geraten: Steht ein
Angebotspreis und ein Marktplatz da, gilt das Stück als *angeboten*, sonst als
*im Bestand*.

**Trennzeichen** darf Strichpunkt, Komma oder Tabulator sein. **Spaltenfolge**
ist egal — erkannt wird über die Kopfzeile. **Zahlen** dürfen `1'250.50`,
`1.250,50` oder `CHF 30.–` heissen.

## Wenn eine KI die Liste füllen soll

Ein Auftrag, der zu dieser Datei passt:

> Erstelle mir eine CSV-Datei mit Strichpunkt als Trennzeichen und genau
> dieser Kopfzeile:
>
> `Nr.;Objekt;Einstand;Marktwert;Angebot;Angebot bei;Erhalten;Status;Notiz`
>
> Eine Zeile je Yu-Gi-Oh-Karte aus der Liste unten. Für **Nr.** nimm:
> 101 Monsterkarten · 102 Zauberkarten · 103 Fallenkarten · 104 Extra Deck
> (Fusion/Synchro/XYZ/Link) · 105 Pendelkarten · 106 Promo- und Turnierkarten ·
> 107 Fremdsprachige Karten · 108 Bewertet/eingeschweisst · 109 Doubletten ·
> 201 Booster · 202 Displays · 203 Structure Decks · 204 Tins und Boxen.
> **Status** ist eines von: Im Bestand, Angeboten, Anfragen erhalten,
> In Verhandlung, Verkauft, Versand unterwegs, Abgeschlossen.
> Beträge in Schweizer Franken, nur Zahlen ohne Währungszeichen.
> Unbekannte Werte lässt du leer — erfinde nichts.
>
> Hier meine Karten: …

## Nummer nachschlagen (nur Sammelkarten)

*Kosten → 🔎 Objekt nachschlagen.* Erkannt wird dreierlei:

**Am besten den Set-Code unten rechts** — er bestimmt die Auflage und damit
Seltenheit und Wert, ohne Rückfrage.

| Eingabe | Beispiel | wo auf der Karte | Ergebnis |
|---|---|---|---|
| **Set-Code** ⭐ | `CORI-EN030` | unten **rechts**, unter dem Bild | genau diese Auflage, mit ihrem Preis |
| **Passcode** | `43989315` | unten **links**, acht Ziffern | die Karte — Auflage wird nachgefragt |
| **Name**, englisch | `Dark Magician` | — | eine Auswahl zum Antippen |

**Deutsche und französische Karten:** Die Datenbank führt nur die englischen
Set-Codes. `CORI-DE030` wird deshalb automatisch als `CORI-EN030`
nachgeschlagen, `LOB-G001` als `LOB-001` — Sammlung, Nummer und Seltenheit sind
dieselben. Das Fenster sagt es dazu, und im Vermerk steht es auch: **der Preis
ist der der englischen Auflage** und kann für deine abweichen. Japanische Codes
(`-JP`) lassen sich nicht umschreiben; dort hilft der Passcode, der auf jeder
Sprachfassung derselbe ist. Der Name kommt immer englisch zurück und lässt sich
überschreiben.

### Die Seltenheit: warum die Nummer allein nicht reicht

Der Passcode bezeichnet die **Karte**, nicht den **Druck**. Blue-Eyes White
Dragon (`89631139`) gibt es in **78 Auflagen** mit **20 verschiedenen
Seltenheiten** — von Common bis Ghost Rare — und Preisen von USD 2 bis 2999.

Deshalb behauptet das Programm in so einem Fall **gar keine Seltenheit**.
Stattdessen legt es die Auflagen zur Wahl vor, nach Wert sortiert, mit
Set-Code, Seltenheit und Preis. Du tippst die an, die auf deiner Karte steht.

| Eingabe | Ergebnis |
|---|---|
| `LOB-001` (Set-Code) | Ultra Rare, CHF 49.66 — **exakt** |
| `89631139` (Passcode) | keine Seltenheit, Wahl aus 78 Auflagen, ⚑ Merkfahne |
| `43989315` (nur eine Auflage) | Super Rare, CHF 0.25 — **exakt**, keine Rückfrage |

**Wer nicht wählt, wird nicht blockiert:** Die Karte kommt trotzdem herein,
aber mit der Fahne **⚑ prüfen** — sichtbar in der Liste, gezählt in der
Statuszeile („⚑ 12 zu prüfen"), und die Notiz sagt in der ersten Zeile, was
offen ist. So kannst du 400 Karten in einem Rutsch erfassen und die
unklaren nachher in Ruhe durchgehen. Ein Klick auf **✓ geprüft** in der
aufgeklappten Zeile nimmt die Fahne weg.

**Zum Wert:**

- Steht die Auflage fest, gilt der Preis **genau dieser Auflage**.
- Sonst der günstigste über alle Auflagen — bei einer alten Rarität um ein
  Vielfaches zu tief. Steht so im Vermerk und in Gelb im Fenster.
- Umgerechnet wird mit dem Tageskurs; Kurs, Quelle und Datum stehen im Vermerk.
  Ohne Netz wird mit einem Näherungskurs gerechnet und das ebenfalls vermerkt.
- **Zustand kann keine Datenbank wissen.** Der Wert landet deshalb in
  *Marktwert* — was du verlangst, trägst du unter *Angebot* selbst ein.

### Alles von Hand nachbessern

Nichts, was das Nachschlagen einträgt, ist festgeschraubt. In der
Kostenübersicht die Zeile aufklappen → **✎ Bearbeiten**: dort stehen Nummer,
Name, Einstand, Status, die **Notiz** (Seltenheit, Auflage, Zustand — freier
Text) und die Merkfahne als Schalter. Marktwert, Angebot und Marktplatz
ändern sich über die üblichen Felder.

Quelle ist die offene Datenbank **YGOPRODeck**; das Programm fragt sie direkt
aus dem Browser, ohne Server dazwischen. Fällt sie aus, bleibt die Nummer
stehen und die Karte lässt sich von Hand benennen.

## Nichts geht verloren

Der Einleser **ergänzt**, er ersetzt nicht. Zweimal dieselbe Datei einlesen
legt alles zweimal an — in dem Fall die doppelten Zeilen im Projekt löschen
oder vorher mit *Rückgängig* (Strg+Z) zurück.
