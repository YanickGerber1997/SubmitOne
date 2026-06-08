# SubmitOne — Roadmap / Zeitprogramm

*Stand: 9. Juni 2026. Reihenfolge, in der wir bauen. Grundlage = [VISION.md](VISION.md).*

## Leitlinien
- **Stetig zum Ziel**, aber in **kleinen, sofort nutzbaren Etappen**.
- **Gründlich aufräumen & organisieren** — als **laufende Disziplin** + gezielte Schritte. **Kein** riskanter Big-Bang-Rewrite; wir ordnen, während wir jeden Bereich anfassen.
- **Deine konkreten Bedürfnisse zuerst.**
- Nach jeder Etappe: etwas Sichtbares, das funktioniert.

## Track A (läuft mit): Aufräumen & Organisieren
- Code **nach Modulen** gliedern (Termin / Kosten / Ausschreibung / Zahlungsplan / Pendenzen …) → bereitet die **Suite** vor + macht es wartbar.
- **Toten/doppelten Code raus** (wie beim Ribbon), **konsistente Muster**, gemeinsame Helfer.
- Passiert **in jeder Etappe** im jeweiligen Bereich + ein kurzer Struktur-Pass vorab.

---

## Etappe 0 — Aufräum-Grundlage (kurz, sicher)
Schneller, ungefährlicher Ordnungs-Pass: Code in klare Abschnitte/Module gliedern, toten Code entfernen, Benennung vereinheitlichen. **Ohne** Feature-Änderung. Schafft die Basis fürs Weitere.

## Etappe 1 — Zahlungspläne + Terminverknüpfung  ← *dein 1. Bedürfnis*
- Zahlungsplan **Bauherr** und Zahlungsplan **Bauleitung** als **zwei klare Sichten** (auf bestehendem Zahlungsplan + Versionen aufbauend).
- **Verknüpfung mit dem Terminprogramm**: Zahlungstermine/Tranchen laufen mit den Bau-Terminen mit.
- Zahlungsplan-Bereich dabei aufräumen.

## Etappe 2 — Ausschreibung end-to-end  ← *dein 2. Bedürfnis*
- **Submittentenliste** → **Einladungen** (Deckblatt/Konditionen) → **Mailversand** → **saubere Nachkontrolle** (Status, Fristen, Eingänge lückenlos; Erinnerungen).
- Ausschreibungs-/Listen-Bereich aufräumen.

## Etappe 3 — Fundament „nicht kaputtbar"
Ansehen/Bearbeiten-Modus, Undo/Redo (teils vorhanden), Autosave-Verlauf. Bevor mehr Leute ran.

## Etappe 4 — Dateiformat + Ablage-Ordnermodell
Format + Versionsregel („Übersetzer"); dein **Ordner-Ablage-Modell** (Ordner wählen, feste Struktur, Index in der App).

## Etappe 5 — Tauri-Desktop + Modul-Fokus/Fenster
Echtes `.exe`, voller Ordner-/NAS-Zugriff; Module als eigene Fenster (Modul-Fokus + Vollbild sind schon da).

## Etappe 6 — Online (Supabase) + Konten + Rollen
Abgleich offline↔online, Login, **6 Rollen** via RLS, Abo/Stripe.

## Etappe 7 — Handy / Pendenzen / Planviewer / Mängel
Mobile Erfassung, **Planviewer mit Markierungen**, Foto-/Mängel-Workflow.

## Etappe 8 — Politur & Launch
Fehlerjagd, Onboarding für Neue, „absolut online".

---

## Terminplan mit Daten (Entwicklung bis Release)
*Annahme: stetiges Tempo ab jetzt (KW24 / Juni 2026). Aufwand = grobe Spanne; echte Daten hängen vom Tempo (wie oft wir arbeiten) ab. Anpassbar.*

| Etappe | Aufwand | Ziel-Zeitraum (bei stetigem Tempo) |
|---|---|---|
| **0 · Gründlicher Struktur-Pass** *(zuerst, dein Wunsch)* | ~2–3 Wochen | bis **Ende Juni 2026** |
| **1 · Zahlungspläne + Terminverknüpfung** | ~1–2 Wochen | bis **Mitte Juli 2026** |
| **2 · Ausschreibung end-to-end** | ~1–2 Wochen | bis **Anfang August 2026** |
| 🏁 **Meilenstein M1 — „intern nutzbar für uns"** | | **~Anfang August 2026** |
| 3 · „Nicht kaputtbar" | ~1–2 Wochen | bis Mitte August |
| 4 · Dateiformat + Ordner-Ablage | ~2–3 Wochen | bis Anfang September |
| 5 · Tauri-Desktop + Modul-Fenster | ~2–3 Wochen | bis Ende September |
| 6 · Online + Konten + Rollen *(grösster Block)* | ~3–5 Wochen | bis Ende Oktober |
| 7 · Handy / Pendenzen / Planviewer / Mängel | ~3–4 Wochen | bis Ende November |
| 8 · Politur & Launch | ~2–3 Wochen | bis **Ende 2026** |
| 🏁 **Meilenstein M2 — „Release"** | | **~Dezember 2026** |

**Zwei klare Ziele:**
- **M1 (≈ August 2026):** aufgeräumt + Zahlungspläne + Ausschreibung → **für euch im Alltag nutzbar**.
- **M2 (≈ Dezember 2026):** Desktop + Online + Rollen + Mobile → **Release**.

*Reihenfolge 3–8 ist anpassbar; 0–2 sind gesetzt (Struktur-Pass zuerst + deine Priorität). Daten verschieben sich mit dem Tempo — der Plan zeigt die Abfolge, nicht den Stein.*
