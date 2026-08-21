# Über den Bau hinaus

Notiert am 13. August 2026. Eine Richtung, kein Fahrplan — aber eine, die jeden
Entwurfsentscheid ab jetzt mitbestimmt.

## Der Gedanke

SubmitOne ist heute für Bauleitung und Architektur gebaut. Das soll es nicht
bleiben. Das Programm muss so angelegt sein, dass **viele Berufe** damit
arbeiten können.

## Warum das kein Beschriftungsproblem ist

Der Beispielfall zeigt, wie tief es geht:

> **Als Unternehmer gibt es keine BKP-Gewerke.** Stattdessen: Projekte, für die
> man Kunden anwirbt. Kunden, die man mit Offerten und Rapporten bedient.
> Kosten, die aus **Lieferungen** zusammenkommen statt aus Vergaben.

Es ist also nicht «Gewerk» durch «Position» ersetzen. Die *Beziehungen* sind
andere: Beim Bauleiter zeigt die Kostenzeile auf eine Vergabe an einen
Unternehmer. Beim Unternehmer zeigt sie auf eine Lieferung eines Händlers.

Weitere Fälle, die mitgedacht werden sollen: **Detailhandel ·
Immobilienbewirtschaftung · Gastronomie · Schule und Studium.**

## Wo es im Aufbau anschlägt

Der heikelste Punkt ist das **Gewerk mit BKP-Nummer**. Es steht im *Stamm* der
`.submit`-Datei (siehe [SPEICHERN.md](SPEICHERN.md)) und ist damit
strukturprägend — jedes Modul zeigt per `gewerkId` darauf.

Bevor der Gewerk-Begriff weiter ausgebaut wird, sollte geklärt sein, was sein
allgemeines Gegenstück ist. Kandidaten: **Position · Posten · Leistung**. Die
BKP-Nummer wäre dann eine von mehreren möglichen Nummernarten, nicht die
einzige.

## Ein Muster, das es schon gibt

SubZeit kennt bereits eine **Stufe**: `schule | selbstaendig | firma`. Sie
blendet ganze Bereiche ein und aus — in der Schulstufe gibt es keine
Rechnungen, keine Absenzen, keine Freigaben.

Dasselbe Muster könnte SubmitOne tragen: eine Stufe je Branche, die bestimmt,
wie die Positionen heissen, welche Module erscheinen und woher Kosten kommen.

## Warum es sich lohnt

Die Website nennt als Zielmarkt 50'000+ Bauprofis in der Schweiz. Jede weitere
Branche vervielfacht diese Zahl — und für die Investorenargumentation ist der
Unterschied zwischen «ein Werkzeug für Bauleiter» und «eine Grundlage für
projektbasiertes Arbeiten» erheblich.

## Was jetzt zu tun ist

Nichts. Aber bei jedem Entwurfsentscheid die Frage stellen:

> **Schreibt das den Bau-Fall fest?**

Wenn ja, kurz überlegen, ob es sich mit einer Stufe oder einem allgemeineren
Begriff genauso gut bauen lässt. Wenn nicht, weitermachen — verfrühte
Verallgemeinerung ist teurer als eine spätere Umbenennung.

---

# Gebaut am 21. August 2026

Der obige Text bleibt stehen, weil er die Überlegung festhält. Was daraus
geworden ist, steht hier.

## Der Befund, der alles einfach machte

Der Aufbau unter SubmitOne ist gar nicht baulich:

> Ein Vorhaben hat Posten. Jeder Posten hat eine Nummer, einen Namen und
> einen Gegenüber. Um ihn herum laufen Geld, Termine und ein Lebenslauf
> von «erfasst» bis «abgeschlossen».

Eine Yu-Gi-Oh-Karte ist derselbe Datensatz wie ein Gewerk — `bkp` ist ihre
Katalognummer, `gewerk` ihr Name, `firma` der Marktplatz, auf dem sie liegt,
`schaetzung` der Einstand, `betrag` der Angebotspreis, die Rechnungen sind
die Zahlungseingänge. Nichts musste erfunden werden; es hiess bloss anders.

Deshalb wurde **kein zweites Datenmodell** gebaut. Die Vorlage ändert
Wörter, Nummern und welche Kapitel erscheinen — sonst nichts.

## Was es gibt

`MODUL: VORLAGEN` in `app.js`, dazu:

| | |
|---|---|
| **Bau** | wie bisher: Gewerke nach BKP, Vergabe, Werkvertrag |
| **Sammlung & Verkauf** | Karten, Münzen, Figuren — Einstand, Marktwert, Angebot, Erlös |
| **Unterschriftensammlung** | Gebiete nach Sprachregion; zählt Unterschriften statt Franken |
| **IT- und Softwareprojekt** | Arbeitspakete nach Projektstrukturplan, Change Requests |

Je Vorlage: ein **Wörterbuch** (alle Beschriftungen), ein **Nummernkatalog**
statt BKP, eigene **Namen für die 14 Stationen** des Lebenslaufs, und eine
Auswahl, **welche Reiter** ein Projekt zeigt — eine Kartensammlung braucht
keinen U-Wert-Rechner.

## Die drei Entscheide, die es tragen

**Die Vorlage hängt am Projekt, nicht am Programm.** `p.vorlage`. Ein
Bauvorhaben und eine Sammlung stehen nebeneinander; man wechselt nicht um,
man öffnet das andere Projekt. Unter *Einstellungen → Vorlage* steht nur,
was ein **neues** Projekt erbt — und dort lässt sich jedes bestehende
umstellen.

**Der Router setzt den Zusammenhang.** `setVorlageCtx(projekt)` beim
Öffnen. Sonst hätte jede der rund vierzig Anzeigefunktionen das Projekt bis
in die letzte Beschriftung durchreichen müssen — genau die Verkabelung, die
oben als das eigentliche Hindernis benannt ist.

**Jede Lücke fällt auf den Bau-Fall zurück.** `W('posten')` sucht zuerst das
eigene Wort des Nutzers, dann die Vorlage, dann Bau. Eine unvollständige
Vorlage kann nichts kaputtmachen — und der Selbsttest meldet sie trotzdem,
bevor jemand «Werkvertrag» in seiner Kartensammlung liest.

## Eine Liste einlesen

`Kosten → 📋 Liste einlesen` nimmt eine CSV entgegen: Trennzeichen geraten,
Spaltenfolge egal, Kopfzeile auch in den Wörtern der Vorlage erkannt,
Schweizer und deutsche Zahlen. Erst Vorschau, dann Übernahme.

Die passende Vorlagendatei erzeugt derselbe Code, der sie wieder einliest —
und der Selbsttest liest jede der vier wieder ein. Siehe
[../vorlagen/LIESMICH.md](../vorlagen/LIESMICH.md).

## Eine Nummer nachschlagen

Eine Vorlage darf einen **Nachschlagedienst** mitbringen (`nachschlag: 'ygo'`).
Nicht das Programm kennt Yu-Gi-Oh — die Vorlage «Sammlung» tut es. Der Knopf
erscheint nur, wo ein Dienst hinterlegt ist; ein Bauvorhaben sieht ihn nie.
Kommt später eine Vorlage für Bücher, bringt sie ihren ISBN-Dienst mit, und
alles andere bleibt, wie es ist.

Acht Ziffern von der Karte, Enter — Name, Kartenart (daraus die Katalognummer),
Set, Seltenheit, Bild und Marktwert stehen da. Enter nochmals übernimmt, das
Feld ist wieder leer. **Ohne eigenen Server:** die Datenbank antwortet mit
`access-control-allow-origin: *`, der Browser darf also direkt fragen (geprüft
am 21.08.2026, ebenso der Kursdienst).

**Der Fehler, den erst der echte Durchlauf zeigte.** `SDK-001` (Blue-Eyes White
Dragon, Ultra Rare von 2002) kam mit CHF 0.02 zurück. Grund: Der
Cardmarket-Preis der Datenbank ist der **günstigste über alle Auflagen** — und
Blue-Eyes gibt es 59-fach nachgedruckt. Der Preis der gesuchten Auflage stand
daneben: USD 25.60.

Seither gilt: Steht die Auflage fest (Set-Code gesucht oder nur eine
vorhanden), zählt **ihr** Preis. Sonst der Sammelpreis — mit dem Satz «günstigste
von N Auflagen» im Vermerk und einer gelben Zeile im Fenster. Eine falsche Zahl
ohne Warnung wäre schlimmer als gar keine. Der Fall steht als Regressionstest in
`test/vorlagen.js`.

## Was nicht feststeht, wird nicht behauptet

Die Frage, die den Rest nach sich zog: *Stimmt die Seltenheit immer?* Nein —
und zwar grundsätzlich nicht. Der Passcode bezeichnet die **Karte**, nicht den
**Druck**. `89631139` (Blue-Eyes White Dragon) hat **78 Auflagen** mit **20
Seltenheiten**, von Common bis Ghost Rare, USD 2 bis 2999.

Die erste Fassung nahm in diesem Fall `sets[0]` — die alphabetisch erste
Sammlung, also reiner Zufall — und schrieb deren Seltenheit hin. Eine erfundene
Angabe, die wie eine belegte aussah.

Drei Regeln daraus, die über das Nachschlagen hinaus gelten sollten:

1. **Nicht raten.** Steht die Auflage nicht fest, bleiben Set und Seltenheit
   leer statt plausibel gefüllt.
2. **Fragen, nicht blockieren.** Die Auflagen liegen zur Wahl (nach Wert
   sortiert, mit Filter). Wer nicht wählt, bekommt den Posten trotzdem — mit der
   Merkfahne `pruefen`, sichtbar als ⚑ in der Liste, gezählt in der Statuszeile,
   erklärt in der ersten Zeile der Notiz, weg mit einem Klick. So lassen sich
   400 Karten am Stück erfassen und die unklaren danach abarbeiten.
3. **Alles bleibt von Hand änderbar.** Das Bearbeiten-Fenster trägt jetzt die
   Notiz und die Merkfahne — keine Angabe aus dem Netz ist festgeschraubt.

## Was noch Bau spricht

Die **Druckblätter** (Baukostenübersicht, Deckblatt, Submittentenliste)
tragen weiter Bau-Wörter; nur die Gruppen-Überschriften folgen schon dem
Katalog. Ebenso die Seitenleiste des Bauprogramms (`SIDE_LABELS`), die
Ausschreibungs-Kapitel und die Pendenzen. Das ist bewusst: Diese Blätter
sind für den Bau gemacht, und die Vorlagen blenden die Kapitel, die sie
nicht brauchen, ohnehin aus. Wer sie später für eine Vorlage öffnet, nimmt
sie sich einzeln vor — die Wörter dafür stehen schon bereit.

## Prüfen

    node test/selftest-node.js    Logik der Vorlagen (Vollständigkeit, Rückfall, CSV-Rundgang)
    node test/vorlagen.js         das Ganze im Gebrauch: Liste einlesen, nachschlagen, Ansichten zeichnen
