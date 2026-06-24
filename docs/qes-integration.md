# QES-Integration — Vorbereitung (Schublade)

Status: **vorbereitet, nicht aktiv.** Erst Nutzer/Traktion aufbauen, dann Anbieter-Vertrag (siehe
`swisssign-partneranfrage.md`). Diese Notiz hält fest, **wie** wir QES anschliessen, damit es später nur „einstecken" ist.

## Prinzip: Remote-Hash-Signing (PAdES) — Datei bleibt lokal
1. Submit baut im PDF einen **Signatur-Platzhalter** (PAdES: `/ByteRange`, leeres `/Contents`).
2. Submit rechnet den **Hash (SHA-256)** über die ByteRange — **nur dieser Hash** geht zum Anbieter.
3. Anbieter (SwissSign/AIS) signiert den Hash mit dem **qualifizierten Schlüssel** (nach Identitäts-Freigabe per SwissID/Mobile ID).
4. Submit **bettet die zurückgegebene Signatur lokal** in `/Contents` ein → fertige, gültige PDF.

→ Das Dokument verlässt das Gerät nie; nur der Fingerabdruck.

## Stufen (eine Codebasis, ein Knopf, drei Ausbaustufen)
- **EES** — sichtbarer Signatur-Block (Name + Datum). **Bereits live** (v54), lokal, gratis.
- **FES** — lokale PAdES-Signatur mit selbst-/günstig-zertifiziertem Schlüssel; „seit Signatur unverändert". **Selbst baubar**, in Acrobat zu verifizieren.
- **QES** — derselbe PAdES-Flow, aber Schritt 3 läuft über **SwissSign** (Hash-Remote). eBau-tauglich.

## Einbau-Punkt in Submit
- Heutiger Signatur-Flow: `openSig()` / `useSig()` / `placeSig()` (sichtbares Bild) + Speichern in `buildPdfBytes()`.
- **Neuer Seam (später):** Funktion `signDocumentPAdES(bytes, signer, level)`:
  - `level='fes'` → lokal signieren (forge/WebCrypto, eigenes Zertifikat).
  - `level='qes'` → Anbieter-Adapter aufrufen: `qesProvider.sign(hashBytes, signer) → signatureBytes`.
- **Anbieter-Adapter** (`qesProvider`) kapselt alles Anbieterspezifische → SwissSign-API nur hier eintragen:
  - `endpoint`, `apiKey/clientCert`, `requestSignature(hashBytes, signerRef)`, Status-Polling, Rückgabe = CMS/PKCS#7.

## Abrechnung (Plattform-Modell)
- Vertrag **zentral auf uns** → Einkauf pro Signatur im Grosshandel.
- In Submit als **Credits/Abo**: „Abo enthält X QES/Monat, darüber Pay-as-you-go".
- Pro erfolgreicher QES: Zähler +1 (für Nutzer-Abrechnung), unabhängig vom lokalen Einbetten.

## Offene Abhängigkeiten (extern)
- SwissSign-Partnervertrag + API-Zugang + Sandbox.
- Identitäts-Flow (SwissID) der Unterzeichnenden.
- PAdES-Platzhalter/ByteRange in JS sauber erzeugen (Bibliothek wählen: forge + eigener Placeholder, oder @signpdf-Portierung) — **in Acrobat verifizieren**.

## Reihenfolge, wenn es so weit ist
1. FES lokal bauen + in Acrobat grün bekommen (beweist die PAdES-Mechanik bei uns).
2. `qesProvider`-Adapter gegen SwissSign-Sandbox.
3. Credits/Abo-Zähler + UI „Rechtsgültig (QES) signieren".
4. Live mit echtem Vertrag.
