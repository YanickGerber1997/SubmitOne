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
| `vorlage-depot.csv` | Depot — Krypto, Edelmetalle, Währungen, Aktien |
| `vorlage-unterschriften.csv` | Unterschriftensammlung nach Region |
| `vorlage-it.csv` | IT-Projekt, Arbeitspakete nach Projektstrukturplan |

## Die Spalten (Beispiel Sammlung)

| Spalte | was hineingehört | wo es landet |
|---|---|---|
| **Nr.** | der **Set-Code von der Karte**, z.B. `CORI-EN030` — oder eine eigene Nummer aus dem Katalog (`202` für ein Display) | die Nummer des Postens |
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

**Wie gruppiert wird:** nach dem Satz — `CORI-EN030` und `CORI-EN079` stehen
unter «CORI · Chaos Origins», wie ein Ordner im Regal. Eigene Nummern (`202`)
gruppieren nach ihrer ersten Ziffer («Versiegelte Ware»), und was nur einen
Passcode trägt, sammelt sich unter «Auflage noch offen». Beides geht
nebeneinander in derselben Liste.

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

---

# Depot & Anlagen

Krypto, Edelmetalle und Währungen holt das Programm selbst — geprüft am
21.08.2026, welche Quellen der Browser überhaupt erreicht:

| Quelle | | was |
|---|---|---|
| **CoinGecko** | ✓ | Krypto, direkt in Franken |
| **gold-api** | ✓ | Gold, Silber, Platin, Palladium (USD je Feinunze) |
| **Frankfurter** | ✓ | Währungskurse |
| Yahoo Finance | ✗ | keine CORS-Freigabe |
| Stooq | ✗ | CSV-Endpunkt geschlossen |

**Einzelaktien gehen deshalb nicht automatisch.** Entweder du trägst den Kurs
von Hand ein, oder wir hinterlegen einen kostenlosen Schlüssel (Finnhub). Lieber
keine Aktienkurse als heimlich falsche.

## Erfassen

*Kosten → 🔎 Position nachschlagen* → Kürzel eintippen:

| Eingabe | ergibt |
|---|---|
| `BTC`, `ETH`, `SOL` … | Kurs von CoinGecko, in Franken |
| `XAU` / `Gold`, `XAG`, `XPT`, `XPD` | Kurs je Feinunze, in Franken umgerechnet |
| `USD`, `EUR`, `GBP` … | Währungskurs |
| unbekanntes Kürzel | CoinGecko-Suche, bestplatzierter Treffer |

Dann **Menge und Einheit** eintragen — `0.35 BTC`, `12 g`, `40 Stk`. Der Wert ist
Kurs × Menge, und bei Edelmetallen wird auf Feinunzen umgerechnet:

```
500 g = 16.0754 oz × CHF 55.56 je Feinunze   →   CHF 893.15
```

Diese Zeile steht so unter der Position, damit man sie **nachrechnen** kann.
Eine Zeile, die zum falschen Ergebnis führt, wäre schlechter als keine.

## Auffrischen

*Kosten → ↻ Kurse auffrischen* bewertet alle Positionen mit Kürzel neu. Krypto
geht dabei in **einer** Anfrage — sonst läuft man in die Mengenbegrenzung der
freien Quellen. Kommt trotzdem einmal «Die Kursquelle bremst gerade», eine
Minute warten.

Jede Position trägt danach im Vermerk, woher ihr Wert kommt:

```
CoinGecko, BTC/CHF 61827, Stand 21.08.2026 15:56
gold-api, USD 4585.60 je Feinunze, Kurs 0.7990, Stand 21.08.2026 15:58
Frankfurter, 1 USD = 0.79899 CHF, Stand 20.08.2026
```

## Chargen — jeder Kauf eine Zeile

Eine Anlage ist kein Bestand, sondern viele Käufe: *am 12.03. zwölf Gramm zu
3'758, am 04.07. zwanzig Gramm zu 4'044.* Ein Depot, das je Anlage nur eine
Zeile führt, kann das nicht abbilden — der Einstand wäre ein Durchschnitt, der
nirgends herkommt, und ein Teilverkauf hätte keinen Bezug.

Deshalb: **eine Zeile je Kauf.** Jede Charge trägt ihr Datum, ihre Menge und
ihren eigenen Einstand. Gruppiert wird nach dem Kürzel, das Zwischentotal ist
der Bestand:

```
▸ XAU · Gold
   XAU   12 g = 0.3858 oz × CHF 3'668.48 je Feinunze
         gekauft 12.03.2026 · Einstand CHF 3'758.09 je Feinunze     1'450.00   1'415.33  ▼
   XAU   20 g = 0.643 oz × CHF 3'668.48 je Feinunze
         gekauft 04.07.2026 · Einstand CHF 4'043.72 je Feinunze     2'600.00   2'358.89  ▼
   XAU   1 oz × CHF 3'668.48 je Feinunze
         gekauft 20.11.2025 · Einstand CHF 3'400.00 je Feinunze     3'400.00   3'668.48  ▲
         Zwischentotal (Bestand)                                    7'450.00   7'442.70
```

Der **Einstand je Einheit** steht dabei, nicht bloss die Summe — nur er lässt
sich mit dem heutigen Kurs vergleichen, und nur so sieht man je Charge, ob sie
im Plus oder im Minus liegt (die Spalte `+/−`).

Beim Erfassen: Kürzel eintippen, dann im Kasten **Diese Charge** Menge, Einheit
und Kaufdatum, daneben den Einstand. Für den nächsten Kauf derselben Anlage
dasselbe nochmals — sie stellen sich von selbst untereinander.
