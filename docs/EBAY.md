# Karten bei eBay einstellen — was geht, was erlaubt ist, was es kostet

Stand 22.08.2026. Grundlage: die Kartensammlung mit 204 Karten,
Marktwert CHF 349.

---

## 1. Die Rechnung, die alles entscheidet

201 Karten sind noch nicht angeboten. Stellte man **jede einzeln** ein,
bliebe nach Provision, fester Gebühr und Porto:

| Weg | Angebote | bleibt |
|---|---:|---:|
| jede Karte einzeln | 201 | **CHF 180** — davon **102 Karten im Minus** |
| 7 einzeln + 11 Lose | 18 | **CHF 283** |

Der Grund ist keine Meinung, sondern eine Subtraktion. Bei einer Karte
für 40 Rappen:

```
Ware                 0.40
+ Porto              2.00
= Gesamtbetrag       2.40
− Provision 10 %     0.24
− feste Gebühr       0.35
− Porto              2.00
= bleibt            −0.19      ← der Verkauf kostet Geld
```

Ein Los dreht das um: **ein** Porto, **eine** Gebühr, **ein** Käufer.
Die günstigen Karten sind darin nicht Ballast — sie sind der Grund,
warum jemand für das Los mehr zahlt als für die teure Karte allein.
Wer ein Deck baut, will die Umgebung, nicht das Einzelstück.

> Provision (10 %) und feste Gebühr (CHF 0.35) sind **Vorbelegungen**.
> Was eBay in der Schweiz für Sammelkarten wirklich nimmt, steht in der
> Gebührenübersicht des eigenen Kontos und unterscheidet sich für
> private und gewerbliche Verkäufer. Beide Zahlen sind im Programm
> unter **Verkaufseinstellungen** änderbar; die Rechnung folgt sofort.

---

## 2. Dürfen wir automatisieren?

Drei Wege, zwei erlaubt.

### a) Seller Hub → Berichte — **erlaubt, gebaut**

Der frühere «eBay CSV-Manager» / «File Exchange» ist in den **Seller
Hub unter «Berichte»** gewandert. Man lädt eine CSV- oder XLSX-Datei
hoch, eBay macht daraus Angebote. Von eBay selbst vorgesehen.

**Voraussetzungen** (so nennt sie eBay.ch für den CSV-Manager — im
eigenen Konto zu prüfen, sie ändern sich):

- mindestens **90 Tage** eBay-Mitglied
- mindestens **50 Angebote** in drei Monaten
- als **gewerblicher Verkäufer** registriert

**Das letzte ist der Haken.** Wer privat aus der eigenen Sammlung
verkauft, erfüllt es nicht. Dann bleibt der Weg über das normale
Formular — und dafür gibt es im Programm das **eBay-Einstellblatt**:
jedes Feld mit dem Wert, der hineingehört, zum Abschreiben. Das ist
kein Ersatz für den Massenweg, aber es macht aus «zehn Minuten pro
Karte» zwei.

### b) eBay Sell APIs (Inventory API, Feed API) — **erlaubt, aber nicht für heute**

Für das **eigene** Verkäuferkonto sind die Sell-APIs zugänglich
(anders als die Buy-APIs, die eBay-Partnerstatus verlangen). Nötig
sind ein Developer-Konto, App-Schlüssel und OAuth.

Warum wir sie heute nicht nehmen: OAuth-Geheimnisse gehören nicht in
eine Datei, die im Browser läuft, und die Schnittstelle spricht nicht
mit einer Seite ohne Server. Das widerspricht dem Grundsatz dieser
Programme — dateibasiert, kein Backend. Sobald es einen Server gibt,
ist es der bessere Weg: dann liessen sich auch die **Fotos**
mitschicken, was die CSV-Datei nicht kann.

### c) Das Webformular automatisch ausfüllen — **nicht erlaubt**

Die eBay-Nutzungsbedingungen verbieten automatisierte Zugriffe auf die
Website. Es ist auch technisch verbaut: schon ein einfacher Abruf der
Hilfeseite von der Kommandozeile landet auf einer Captcha-Seite. Wir
machen das nicht.

---

## 3. Der Ablauf mit SubmitOne

1. **Verkaufseinstellungen ausfüllen** (Bestand → ⚙ Verkauf).
   Standort, Versand, Rücknahme, Kategorien, Provision. Einmal — gilt
   für jedes Angebot.
2. **Lose planen** (Bestand → 🎁 Lose planen). An vier Zahlen drehen,
   die Rechnung mitlesen, übernehmen.
3. **Fotos machen** — je Karte oder je Los. Katalogbilder gehören uns
   nicht und haben auf einer Verkaufsseite nichts verloren.
4. **eBay-Datei ziehen** (Bestand → ⬇ eBay-Datei). Sie kommt mit der
   Aktion **`VerifyAdd`**: eBay **prüft** die Datei und stellt nichts
   ein. Fehler zeigen sich, bevor 200 Angebote online sind.
5. Fehler beheben, Aktion auf **`Add`** stellen, hochladen.
6. **Fotos von Hand hinzufügen** — siehe unten.

---

## 4. Was an der Schweizer Datei besonders ist

Vier Dinge, die man sonst beim ersten Fehlversuch lernt:

- **Trennzeichen ist das Semikolon**, nicht das Komma. (Die Schweiz
  steht in eBays eigener Liste unter «Semikolon als Trennzeichen».)
- Die Kopfzeile trägt Land, Währung und Fassung im **Feldnamen**:
  `*Action(SiteID=Switzerland|Country=CH|Currency=CHF|Version=745|CC=UTF-8)`
- **Zeilenumbrüche verweigert eBay** in jedem Feld. Mehrzeilige Texte
  brauchen `<br>`. Das Programm übersetzt sie beim Erzeugen.
- Die Versandarten haben **feste Codes**, keine freien Namen:

  | Code | was es ist |
  |---|---|
  | `CH_Writing` | Brief |
  | `CH_StandardDispatchBPost` | Paket B-Post |
  | `CH_StandardDispatchAPost` | Paket A-Post |
  | `CH_InsuredDispatch` | eingeschrieben |
  | `CH_Pickup` | Abholung |
  | `CH_EconomySendungenInternational` | Economy Ausland |
  | `CH_PrioritySendungenInternational` | Priority Ausland |

Weitere Grenzen: **höchstens 1000 Aktionen in 24 Stunden**, und die
Datei kennt **nur ein Bild je Angebot** — und auch das nur als Adresse
im Netz.

---

## 5. Die Fotos

Die CSV-Spalte `PicURL` will eine **Adresse im Netz**. Unsere Fotos
liegen als Daten in der Projektdatei und haben keine. Das Katalogbild
aus der Datenbank hätte eine, aber es gehört nicht uns.

Darum bleibt die Spalte **leer**, und das ist ehrlicher als ein
Verweis, der später Ärger macht. Fotos kommen nach dem Hochladen im
Seller Hub dazu — je Angebot, von Hand. Bei 18 Angeboten ist das
Arbeit von einer halben Stunde; bei 201 wäre es der halbe Tag. Noch
ein Grund für Lose.

---

## 6. Was noch zu prüfen ist

Ehrlich aufgelistet, nicht versteckt — jede dieser Zahlen ist eine
Vorbelegung im Programm und in einem Feld änderbar:

| was | Vorbelegung | wo nachschauen |
|---|---|---|
| Kategorie Einzelkarte | `183454` | eBay-Kategoriecode-Suche |
| Kategorie Los | `183455` | dieselbe |
| ConditionID | 1000 neu / 3000 gebraucht | Artikelmerkmale-Vorlage **der Kategorie** |
| Verkaufsprovision | 10 % | Gebührenübersicht des Kontos |
| feste Gebühr | CHF 0.35 | dieselbe |
| Porto Brief | CHF 2.00 | Preise der Post |
| Porto Paket | CHF 8.50 | dieselbe |
| `Version=` in der Kopfzeile | 745 | die aktuelle Vorlage von eBay |

Die Kategorienummern sind die einzige Stelle, an der ein Fehler teuer
wird: Ein Los zwischen den Einzelkarten findet niemand.

---

## 7. Was das Programm heute kann

- **Verkaufseinstellungen** je Projekt — 20 Felder, einmal ausgefüllt
- **eBay-Einstellblatt** je Karte und je Los — 18 Felder mit dem
  englischen Feldnamen daneben, weil eBays Fehlermeldungen ihn nennen
- **CSV für Seller Hub → Berichte** — Schweizer Fassung, `VerifyAdd`
- **Losplaner** — teure Karten einzeln, der Rest in Lose; getrennt
  nach Spiel, gefüllt nach Satz, mit der Deckungsrechnung daneben.
  Ein Los, das nach Gebühren nichts übrig lässt, entsteht gar nicht
  erst: seine Karten kommen als «übrig» zurück.
