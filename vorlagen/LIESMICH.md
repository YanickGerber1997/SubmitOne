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

| Eingabe | Beispiel | Ergebnis |
|---|---|---|
| **Passcode** (8 Ziffern, unten links auf der Karte) | `43989315` | genau diese Karte |
| **Set-Code**, englisch | `CORI-EN030` | genau diese Auflage, mit ihrem Preis |
| **Name**, englisch | `Dark Magician` | eine Auswahl zum Antippen |

Der Passcode steht auf der **deutschen Karte genauso** wie auf der englischen —
er ist der zuverlässigste Weg. Deutsche Set-Codes (`CORI-DE030`) kennt die
Datenbank dagegen nicht; der Name kommt dann englisch zurück und lässt sich
überschreiben.

**Zum Wert — bitte einmal lesen:**

- Steht die **Auflage fest** (Set-Code eingegeben oder es gibt nur eine), gilt
  der Preis genau dieser Auflage. Das ist die brauchbare Zahl.
- Steht sie **nicht** fest, ist der Wert der **günstigste über alle Auflagen** —
  bei einer alten Rarität um ein Vielfaches zu tief. Das Fenster sagt es dann in
  Gelb dazu, und im Vermerk der Karte steht es auch. Wer es genau will, tippt
  den Set-Code seiner Karte ein.
- Umgerechnet wird mit dem Tageskurs; Kurs, Quelle und Datum stehen im Vermerk.
  Ohne Netz wird mit einem Näherungskurs gerechnet und das ebenfalls vermerkt.
- **Zustand und Auflage kann keine Datenbank wissen.** Der Wert landet deshalb
  in *Marktwert* — was du verlangst, trägst du unter *Angebot* selbst ein.

Quelle ist die offene Datenbank **YGOPRODeck**; das Programm fragt sie direkt
aus dem Browser, ohne Server dazwischen. Fällt sie aus, bleibt die Nummer
stehen und die Karte lässt sich von Hand benennen.

## Nichts geht verloren

Der Einleser **ergänzt**, er ersetzt nicht. Zweimal dieselbe Datei einlesen
legt alles zweimal an — in dem Fall die doppelten Zeilen im Projekt löschen
oder vorher mit *Rückgängig* (Strg+Z) zurück.
