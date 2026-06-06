/* ============================================================
   SubmitOne – Konfiguration
   ------------------------------------------------------------
   Leer lassen  = lokaler Modus (Daten nur in diesem Browser).
   Ausgefüllt   = Cloud-Modus (Supabase): Login + gemeinsamer
                  Arbeitsbereich, auf allen Computern dieselben Daten.

   Nach dem Anlegen des Supabase-Projekts hier eintragen
   (Supabase → Project Settings → API):
     SUPABASE_URL       = "Project URL"
     SUPABASE_ANON_KEY  = "anon public" key   (darf öffentlich sein)
   ============================================================ */
window.SUBMITONE_CONFIG = {
  SUPABASE_URL: 'https://gxrrbultujwsmzthkqwl.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_WTv4Uwm5HSq3254yGoW-Mg_6go9STTK',

  // Stripe-Zahlungslinks (Payment Links) – später hier eintragen, dann funktioniert „Upgraden"/„freischalten".
  // Die App hängt automatisch ?client_reference_id=<user> an, damit der Webhook das Konto kennt.
  STRIPE_LINKS: {
    // Pakete
    basis: '',
    komplett: '',
    // Einzelne Module (à la carte) – Schlüssel: mod_<modulschlüssel>
    mod_submission: '',
    mod_kosten: '',
    mod_termine: '',
    mod_pendenzen: '',
    mod_protokolle: '',
    mod_kontakte: '',
    mod_dossier: '',
    mod_bauherr: '',
    mod_solar: '',
    mod_honorar: '',
  },
};
