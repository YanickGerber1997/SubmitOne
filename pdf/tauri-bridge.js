/* Submit PDF — Brücke zur Desktop-Hülle (Tauri).
   Im Browser/PWA passiert hier NICHTS (window.__TAURI__ fehlt) → die App läuft unverändert.
   In der Desktop-App: native Datei-Dialoge, direktes Lesen/Speichern auf der Platte,
   und Öffnen per Datei-Verknüpfung („Öffnen mit Submit PDF"). */
(function () {
  const T = window.__TAURI__;
  if (!T) return;                                   // Browser/PWA: aussteigen
  const invoke = T.core.invoke;
  const dialog = T.dialog;
  window.SUBMIT_NATIVE = true;
  let currentPath = null;                            // zuletzt geöffnete/gespeicherte Datei

  async function loadPath(path) {
    try {
      const bytes = await invoke('read_file', { path });           // Rust liest die Datei
      const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      currentPath = path;
      if (window.openNativeBytes) window.openNativeBytes(arr, path);
    } catch (e) { console.error('open failed', e); }
  }

  // Datei beim Start (Doppelklick/Verknüpfung, Windows/Linux: Startargument)
  invoke('take_start_file').then(p => { if (p) loadPath(p); }).catch(() => {});
  // macOS / zur Laufzeit geöffnete Datei
  if (T.event && T.event.listen) T.event.listen('open-file', e => { if (e && e.payload) loadPath(e.payload); });

  // Natives Öffnen (ersetzt den Browser-Dateidialog)
  window.nativeOpen = async function () {
    try {
      const sel = await dialog.open({ multiple: false, filters: [{ name: 'PDF / Bild', extensions: ['pdf', 'png', 'jpg', 'jpeg'] }] });
      if (sel) loadPath(typeof sel === 'string' ? sel : sel.path || sel);
    } catch (e) { console.error(e); }
  };

  // Natives Speichern (direkt auf die Datei; beim ersten Mal „Speichern unter")
  window.nativeSave = async function (bytes, suggestedName) {
    try {
      let path = currentPath;
      if (!path) path = await dialog.save({ defaultPath: suggestedName || 'dokument.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (!path) return false;
      await invoke('save_file', { path, data: Array.from(bytes) });
      currentPath = path;
      return true;
    } catch (e) { console.error('save failed', e); return false; }
  };
})();
