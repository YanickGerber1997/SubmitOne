// Submit PDF — Desktop-Hülle (Tauri v2).
// Die Oberfläche ist die bestehende Web-App in ../pdf. Diese Datei liefert nur die
// nativen Brücken: Datei lesen/schreiben (beliebiger Pfad) und Öffnen per Verknüpfung.

use std::sync::Mutex;
use tauri::Emitter;

// Hält die beim Start übergebene Datei (Datei-Verknüpfung), bis das Frontend sie abholt.
struct StartFile(Mutex<Option<String>>);

// Rohbytes einer Datei lesen (z. B. die per Doppelklick geöffnete PDF).
#[tauri::command]
fn read_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

// Bytes direkt auf die Datei schreiben (echtes „Speichern", kein Download-Umweg).
#[tauri::command]
fn save_file(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &data).map_err(|e| e.to_string())
}

// Frontend holt die Startdatei aktiv ab (vermeidet Timing-Probleme mit Events).
#[tauri::command]
fn take_start_file(state: tauri::State<StartFile>) -> Option<String> {
    state.0.lock().ok().and_then(|mut g| g.take())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Windows/Linux: die per Verknüpfung geöffnete Datei kommt als Startargument.
    let start = std::env::args()
        .skip(1)
        .find(|a| !a.starts_with('-') && std::path::Path::new(a).exists());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(StartFile(Mutex::new(start)))
        .invoke_handler(tauri::generate_handler![read_file, save_file, take_start_file])
        .build(tauri::generate_context!())
        .expect("Fehler beim Aufbau der Tauri-Anwendung")
        .run(|_app, _event| {
            // macOS: Doppelklick auf eine Datei liefert ein Opened-Event zur Laufzeit.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                if let Some(p) = urls.into_iter().find_map(|u| u.to_file_path().ok()) {
                    if let Some(s) = p.to_str() {
                        let _ = _app.emit("open-file", s.to_string());
                    }
                }
            }
        });
}
