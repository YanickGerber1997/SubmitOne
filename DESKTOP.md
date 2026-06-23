# Submit PDF — Desktop (Tauri)

Die Desktop-App ist **dieselbe Web-App** (`/pdf`), verpackt in eine schlanke
[Tauri](https://tauri.app)-Hülle. Eine Codebasis → Web, PWA **und** Desktop.

**Was die Desktop-Version zusätzlich kann**
- Echte **Datei-Verknüpfung**: Rechtsklick → „Öffnen mit Submit PDF", `.pdf`/Bilder als Standard.
- **Direktes Speichern** auf die Datei (kein Download-Umweg).
- Große Dateien **von der Platte lesen**, statt sie über den Browser-Upload in den Speicher zu zwingen.
- Eigenes Fenster, offline, ~3–10 MB Installer.

Die native Logik steckt in `src-tauri/` (Rust) + `pdf/tauri-bridge.js`
(im Browser wirkungslos, nur in der Desktop-App aktiv).

---

## Einmalig einrichten (Windows)

1. **Rust installieren** (Toolchain für Tauri): https://rustup.rs → `rustup-init.exe` ausführen, Standard wählen, danach Terminal neu öffnen. Prüfen:
   ```
   rustc --version
   cargo --version
   ```
2. **WebView2** ist auf Windows 11 vorinstalliert (sonst: „Evergreen Bootstrapper" von Microsoft).
3. Im Projektordner die **Tauri-CLI** (über das schon vorhandene Node) nutzen — kein globales Setup nötig.

### Icons erzeugen (einmal)
Aus dem echten Logo alle benötigten Icon-Formate generieren:
```
npx @tauri-apps/cli@latest icon pdf/logo.png
```
Das füllt `src-tauri/icons/` (.ico, .icns, PNGs).

---

## Entwickeln & bauen

**Live testen** (öffnet das Desktop-Fenster, lädt `/pdf`):
```
npx @tauri-apps/cli@latest dev
```

**Installer bauen** (Windows: `.msi`/`.exe`):
```
npx @tauri-apps/cli@latest build
```
Ergebnis unter `src-tauri/target/release/bundle/`.

> Der **erste** Build kompiliert die Rust-Abhängigkeiten und dauert ein paar Minuten.
> Danach ist es schnell.

---

## macOS / Linux / Handy
- **macOS/Linux**: dieselben Befehle (`dev` / `build`) auf dem jeweiligen System.
  Für die Verteilung auf macOS ist **Notarisierung** nötig (Apple Developer, 99 $/Jahr),
  sonst blockt Gatekeeper. Die `Opened`-Datei-Verknüpfung ist in `src-tauri/src/lib.rs` schon vorbereitet.
- **iOS/Android**: Tauri 2 unterstützt Mobil (`tauri ios`/`tauri android`) — optional später;
  der Foto-Teilen-Flow läuft schon über die PWA.

## Signierung (für Auslieferung an andere)
- **Windows**: ohne Code-Signing-Zertifikat warnt SmartScreen. Zertifikat ~200–400 $/Jahr.
- Solange du es nur selbst nutzt, reicht der unsignierte Build.
