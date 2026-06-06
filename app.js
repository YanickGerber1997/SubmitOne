/* ============================================================
   SubmitOne – Submissionsverwaltung · Prototyp
   Vanilla JS · Hash-Router · localStorage
   ============================================================ */

'use strict';

const APP_VERSION = 'v116';   // sichtbarer Build-Indikator (Sidebar-Fuss) – mit sw.js-Cache synchron halten

/* ---------------------------------------------------------------
   1) Domänen-Konstanten
   --------------------------------------------------------------- */

// Phasen eines Bauprojekts (übergeordnet)
const PHASEN = [
  { key: 'planung',      label: 'Planung' },
  { key: 'ausschreibung',label: 'Ausschreibung' },
  { key: 'vergabe',      label: 'Vergabe' },
  { key: 'ausfuehrung',  label: 'Ausführung' },
  { key: 'abschluss',    label: 'Abschluss' },
];

// Lebenszyklus einer einzelnen Vergabe / eines Gewerks
const VERGABE_STATUS = [
  { key: 'ausschreibung',   label: 'Ausschreibung erstellt',         kurz: 'Ausschreibung',   color: 'grey'   },
  { key: 'versendet',       label: 'Ausschreibung versendet',        kurz: 'Versendet',       color: 'blue'   },
  { key: 'offerten',        label: 'Offerten eingegangen',           kurz: 'Offerten',        color: 'blue'   },
  { key: 'angebot_vers',    label: 'Abgebot versendet',              kurz: 'Abgebot vers.',   color: 'blue'   },
  { key: 'angebot_erh',     label: 'Abgebot erhalten',               kurz: 'Abgebot erh.',    color: 'blue'   },
  { key: 'bewertung',       label: 'Offertvergleich zugestellt',     kurz: 'Vergleich',       color: 'amber'  },
  { key: 'verhandlung',     label: 'Vergabeverhandlung organisiert', kurz: 'Verhandlung',     color: 'amber'  },
  { key: 'vergeben',        label: 'Zuschlag erteilt',               kurz: 'Vergeben',        color: 'purple' },
  { key: 'werkvertrag',     label: 'Werkvertrag erstellt',           kurz: 'Werkvertrag',     color: 'purple' },
  { key: 'unterzeichnet',   label: 'Vertrag unterzeichnet',          kurz: 'Unterzeichnet',   color: 'teal'   },
  { key: 'ausfuehrung',     label: 'In Ausführung',                  kurz: 'Ausführung',      color: 'teal'   },
  { key: 'schlussrechnung', label: 'Schlussrechnung in Prüfung',     kurz: 'Schlussrechnung', color: 'amber'  },
  { key: 'maengel',         label: 'Mängel behoben',                 kurz: 'Mängel',          color: 'teal'   },
  { key: 'abgeschlossen',   label: 'Abgeschlossen',                  kurz: 'Abgeschlossen',   color: 'green'  },
];

const STATUS_BY_KEY = Object.fromEntries(VERGABE_STATUS.map((s, i) => [s.key, { ...s, index: i }]));
const PHASE_INDEX   = Object.fromEntries(PHASEN.map((p, i) => [p.key, i]));

/* ---------------------------------------------------------------
   2) State + Persistenz
   --------------------------------------------------------------- */

let state = { projekte: [], kontakte: [], dokumente: [] };

// --- Undo/Redo: Schnappschüsse des ganzen Zustands ---
let undoStack = [], redoStack = [], lastSnap = null, lastSnapAt = 0, undoing = false;

/* ============================================================
   Datenschicht (austauschbar)
   ------------------------------------------------------------
   Die ganze App liest/schreibt NUR über diesen `db`-Layer.
   Heute aktiv: LocalAdapter (Browser-localStorage, 0 €).
   Später Cloud (PocketBase/Supabase/…): einfach einen Adapter mit
   denselben zwei Methoden bereitstellen und db.use(...) aufrufen —
   am Rest der App ändert sich nichts.

   Adapter-Schnittstelle:
     load()        -> state | null     (darf ein Promise sein)
     save(state)   -> void             (darf ein Promise sein; fire-and-forget)
   ============================================================ */

const LocalAdapter = {
  name: 'local',
  key: 'submitone.v1',
  load() {
    const raw = localStorage.getItem(this.key);
    return raw ? JSON.parse(raw) : null;
  },
  save(s) { localStorage.setItem(this.key, JSON.stringify(s)); },
};

/* Beispiel-Skizze für später (NICHT aktiv). So einfach wäre der Wechsel:

const PocketBaseAdapter = {
  name: 'pocketbase',
  base: 'https://dein-server',          // PocketBase-/API-URL
  async load() {
    const r = await fetch(this.base + '/api/state', { headers: authHeader() });
    return r.ok ? await r.json() : null;
  },
  async save(s) {
    await fetch(this.base + '/api/state', { method: 'PUT', headers: authHeader(), body: JSON.stringify(s) });
  },
};
// Aktivieren:  db.use(PocketBaseAdapter);
*/

let dbAdapter = LocalAdapter;

const db = {
  use(adapter) { dbAdapter = adapter; },
  async init() {
    let loaded = null;
    try { loaded = await dbAdapter.load(); } catch (e) { console.warn('Laden fehlgeschlagen:', e); }
    if (loaded) { state = loaded; migrate(); }
    else { state = demoData(); migrate(); db.commit(); }
  },
  commit() {
    try { dbAdapter.save(state); } catch (e) { console.warn('Speichern fehlgeschlagen:', e); }
  },
};

// Kompatibilitäts-Wrapper: bestehende save()-Aufrufe gehen über den Adapter
function save() { snapshotForUndo(); db.commit(); }

// Vor jeder Änderung den vorigen Stand für Undo sichern; schnelle Folgeänderungen (Tippen) werden zu einem Schritt zusammengefasst
function snapshotForUndo() {
  if (undoing || lastSnap === null) return;
  const cur = JSON.stringify(state);
  if (cur === lastSnap) return;
  const t = Date.now();
  if (t - lastSnapAt > 700) { undoStack.push(lastSnap); if (undoStack.length > 40) undoStack.shift(); redoStack = []; }
  lastSnap = cur; lastSnapAt = t;
  updateUndoButtons();
}
function updateUndoButtons() {
  const u = $('#btnUndo'), r = $('#btnRedo');
  if (u) u.disabled = !undoStack.length;
  if (r) { r.disabled = !redoStack.length; r.hidden = !redoStack.length; }
}
function undo() {
  if (!undoStack.length) { toast('Nichts zum Rückgängigmachen', 'info'); return; }
  undoing = true;
  redoStack.push(lastSnap);
  const prev = undoStack.pop();
  state = JSON.parse(prev); lastSnap = prev; lastSnapAt = Date.now();
  db.commit(); undoing = false;
  updateUndoButtons(); router(); toast('Rückgängig gemacht');
}
function redo() {
  if (!redoStack.length) { toast('Nichts zum Wiederholen', 'info'); return; }
  undoing = true;
  undoStack.push(lastSnap);
  const next = redoStack.pop();
  state = JSON.parse(next); lastSnap = next; lastSnapAt = Date.now();
  db.commit(); undoing = false;
  updateUndoButtons(); router(); toast('Wiederhergestellt');
}
function undoKeydown(e) {
  if (e.target && /^(input|textarea|select)$/i.test(e.target.tagName)) return;   // im Eingabefeld: normales Text-Undo
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = (e.key || '').toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
}

/* ============================================================
   Cloud-Modus (Supabase) – aktiv, sobald config.js ausgefüllt ist
   ------------------------------------------------------------
   Speicher-sparend: pro Projekt eine Zeile; beim Speichern werden
   NUR geänderte Einträge gesendet (Delta), gebündelt & entprellt.
   Realtime hält mehrere Computer live synchron.
   ============================================================ */

const CFG = window.SUBMITONE_CONFIG || {};
const cloudEnabled = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase);
const CLIENT_ID = uid('client');
let supa = null;

const CloudAdapter = {
  name: 'supabase',
  _snap: new Map(),   // entityId -> JSON (zuletzt synchronisierter Stand)
  _timer: null,
  _pending: null,

  async load() {
    const { data, error } = await supa.from('entities').select('id,typ,data');
    if (error) throw error;
    const st = { projekte: [], kontakte: [], dokumente: [] };
    this._snap.clear();
    for (const row of (data || [])) {
      this._snap.set(row.id, JSON.stringify(row.data));
      if (row.typ === 'projekt') st.projekte.push(row.data);
      else if (row.typ === 'kontakte') st.kontakte = row.data || [];
      else if (row.typ === 'dokumente') st.dokumente = row.data || [];
    }
    return (data && data.length) ? st : null;
  },

  save(s) {                       // entprellt: erst 1.2s nach der letzten Änderung schreiben
    this._pending = s;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._flush(), 1200);
  },

  async _flush() {
    const s = this._pending; if (!s || !supa) return;
    const ups = [], seen = new Set();
    const changed = (id, obj) => { const j = JSON.stringify(obj); if (this._snap.get(id) !== j) { this._snap.set(id, j); return true; } return false; };
    for (const p of s.projekte) { seen.add(p.id); const payload = projektFuerCloud(p); if (changed(p.id, payload)) ups.push({ id: p.id, typ: 'projekt', data: payload, updated_by: CLIENT_ID }); }
    if (changed('kontakte', s.kontakte)) ups.push({ id: 'kontakte', typ: 'kontakte', data: s.kontakte, updated_by: CLIENT_ID });
    if (changed('dokumente', s.dokumente)) ups.push({ id: 'dokumente', typ: 'dokumente', data: s.dokumente, updated_by: CLIENT_ID });
    const del = [];
    for (const id of this._snap.keys()) { if (id !== 'kontakte' && id !== 'dokumente' && !seen.has(id)) del.push(id); }
    try {
      if (ups.length) { const { error } = await supa.from('entities').upsert(ups); if (error) throw error; }
      for (const id of del) { await supa.from('entities').delete().eq('id', id); this._snap.delete(id); }
    } catch (e) { console.warn('Cloud-Speichern fehlgeschlagen:', e); toast(isPaid() ? 'Speichern fehlgeschlagen – offline?' : '🔒 Zum Speichern ist ein Abo nötig', 'info'); }
  },
};

// Offene Bearbeitungs-Konflikte: projektId -> Fremd-Version (data), solange ungelöst
const cloudConflicts = new Map();

function subscribeCloud() {
  supa.channel('entities-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entities' }, payload => {
      const ev = payload.eventType;
      if (ev === 'DELETE') {
        const id = payload.old.id;
        state.projekte = state.projekte.filter(p => p.id !== id);
        CloudAdapter._snap.delete(id);
        if (cloudConflicts.delete(id)) renderCloudConflictBanner();
        router();
        return;
      }
      const row = payload.new;
      if (!row) return;
      const incomingJson = JSON.stringify(row.data);
      const prevBase = CloudAdapter._snap.get(row.id);   // letzter gemeinsamer Stand – VOR dem Überschreiben merken
      CloudAdapter._snap.set(row.id, incomingJson);
      if (row.updated_by === CLIENT_ID) {                 // eigener Schreibvorgang landete → evtl. Konflikt aufgelöst
        if (cloudConflicts.delete(row.id)) renderCloudConflictBanner();
        return;
      }
      if (row.typ === 'projekt') {
        const i = state.projekte.findIndex(p => p.id === row.id);
        const localObj = i >= 0 ? state.projekte[i] : null;
        // „dirty“ = lokale, noch nicht hochgeladene Änderung am selben Projekt
        const localDirty = localObj && prevBase !== undefined && JSON.stringify(localObj) !== prevBase;
        if (localDirty && JSON.stringify(localObj) !== incomingJson) {
          // KONFLIKT: lokale Bearbeitung würde durch Fremdänderung still überschrieben → stattdessen fragen
          cloudConflicts.set(row.id, row.data);
          renderCloudConflictBanner();
          return;   // lokale Version bleibt unangetastet
        }
        if (i >= 0) state.projekte[i] = row.data; else state.projekte.push(row.data);
      } else if (row.typ === 'kontakte') state.kontakte = row.data || [];
      else if (row.typ === 'dokumente') state.dokumente = row.data || [];
      migrate();
      lastSnap = JSON.stringify(state); lastSnapAt = Date.now();   // Undo-Basis nachführen (Fremdänderung)
      router();
    })
    .subscribe();
}

// Nicht-zerstörerisches Banner: bei gleichzeitiger Bearbeitung entscheidet der Nutzer, statt Arbeit zu verlieren
function renderCloudConflictBanner() {
  let bar = $('#cloudConflictBar');
  if (!cloudConflicts.size) { if (bar) bar.remove(); return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'cloudConflictBar'; bar.className = 'cloud-conflict-bar'; document.body.appendChild(bar); }
  const rows = [...cloudConflicts.entries()].map(([id, remote]) => {
    const local = state.projekte.find(p => p.id === id);
    const name = esc((local && local.name) || (remote && remote.name) || 'Projekt');
    return `<div class="ccf-row">
      <span class="ccf-txt">⚠ <strong>${name}</strong> wurde gerade auch von jemand anderem geändert. Deine Version ist noch nicht gespeichert.</span>
      <span class="ccf-acts">
        <button class="btn sm secondary" data-act="conflict-keep" data-pid="${id}">Meine behalten</button>
        <button class="btn sm" data-act="conflict-take" data-pid="${id}">Andere laden</button>
      </span></div>`;
  }).join('');
  bar.innerHTML = `<div class="ccf-inner">${rows}</div>`;
}

function resolveConflictTake(pid) {
  const remote = cloudConflicts.get(pid); if (!remote) return;
  const i = state.projekte.findIndex(p => p.id === pid);
  if (i >= 0) state.projekte[i] = remote; else state.projekte.push(remote);
  cloudConflicts.delete(pid);
  migrate(); renderCloudConflictBanner(); router();
  toast('Fremde Version geladen');
}

function resolveConflictKeep(pid) {
  cloudConflicts.delete(pid);
  renderCloudConflictBanner();
  save();   // stösst Flush an → eigene Version überschreibt nun bewusst die fremde
  toast('Deine Version bleibt – wird gespeichert');
}

/* ---- Login-Maske (nur Cloud-Modus) ---- */

// Vor-/Nachname → stabile interne Zugangsdaten (Supabase Auth arbeitet mit E-Mail+Passwort)
function nameCreds(vor, nach) {
  const slug = (vor + '.' + nach).trim().toLowerCase().replace(/[^a-z0-9.]+/g, '');
  return { slug, email: slug + '@submitone.local', password: 'so_' + slug + '_pw' };
}

function renderLogin(msg, mode) {
  mode = mode || 'in';   // 'in' = Anmelden, 'up' = Registrieren
  if ($('#loginOverlay')) $('#loginOverlay').remove();
  document.body.insertAdjacentHTML('beforeend', `
    <div id="loginOverlay" class="login-overlay">
      <div class="login-card">
        <div class="logo big" style="justify-content:center;margin:0 auto 16px">
          <span class="logo-word"><span class="lw-a">Submit</span><span class="lw-b">One</span></span>
          <svg class="logo-tick" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" class="end"/><path d="M6.6 12.4 l3.4 3.6 l7-8.6" class="chk"/></svg>
        </div>
        <p class="muted" style="margin:0 0 16px;font-size:13px">${mode === 'up' ? 'Neues Konto erstellen' : 'Mit E-Mail anmelden'}</p>
        ${mode === 'up' ? `<div class="form-row" style="margin-bottom:10px">
          <label class="field">Vorname <input class="input" id="lg_vor" autocapitalize="words" spellcheck="false"></label>
          <label class="field">Nachname <input class="input" id="lg_nach" autocapitalize="words" spellcheck="false"></label>
        </div>` : ''}
        <label class="field">E-Mail <input class="input" id="lg_email" type="email" autocomplete="username" spellcheck="false"></label>
        <label class="field" style="margin-top:10px">Passwort <input class="input" id="lg_pw" type="password" autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}"></label>
        <div id="lg_msg" style="min-height:18px;font-size:12.5px;color:var(--s-red);margin:8px 0">${msg ? esc(msg) : ''}</div>
        <button class="btn" id="lg_go" style="width:100%">${mode === 'up' ? 'Konto erstellen' : 'Anmelden'}</button>
        ${mode === 'in' ? `<button class="btn-ghost-sm" id="lg_forgot" style="width:100%;margin-top:8px">Passwort vergessen?</button>` : ''}
        <div class="muted" style="font-size:12px;margin:14px 0 6px">${mode === 'up' ? 'Schon ein Konto?' : 'Noch kein Konto?'}</div>
        <button class="btn secondary" id="lg_switch" style="width:100%">${mode === 'up' ? 'Zur Anmeldung' : 'Neues Konto erstellen'}</button>
      </div>
    </div>`);
  const email = () => $('#lg_email').value.trim();
  const pw = () => $('#lg_pw').value;
  const setMsg = (m, ok) => { const el = $('#lg_msg'); el.textContent = m; el.style.color = ok ? 'var(--s-green)' : 'var(--s-red)'; };

  $('#lg_switch').onclick = () => renderLogin('', mode === 'up' ? 'in' : 'up');

  $('#lg_go').onclick = async () => {
    if (!email() || !pw()) { setMsg('Bitte E-Mail und Passwort eingeben'); return; }
    if (mode === 'up') {
      const vor = $('#lg_vor').value.trim(), nach = $('#lg_nach').value.trim();
      if (!vor || !nach) { setMsg('Bitte Vor- und Nachname eingeben'); return; }
      setMsg('Konto wird erstellt…', true);
      const r = await supa.auth.signUp({ email: email(), password: pw(), options: { data: { vorname: vor, nachname: nach } } });
      if (r.error) { setMsg(/registered|exist/i.test(r.error.message) ? 'Konto existiert bereits – bitte anmelden.' : r.error.message); return; }
      if (r.data.session) { $('#loginOverlay').remove(); startApp(); }
      else setMsg('Bestätigungs-Mail gesendet. Bitte E-Mail bestätigen, dann anmelden. (Oder in Supabase „Confirm email" ausschalten.)', true);
    } else {
      setMsg('Anmelden…', true);
      const { error } = await supa.auth.signInWithPassword({ email: email(), password: pw() });
      if (error) { setMsg('Anmeldung fehlgeschlagen – E-Mail oder Passwort falsch.'); return; }
      $('#loginOverlay').remove(); startApp();
    }
  };

  if (mode === 'in') $('#lg_forgot').onclick = async () => {
    if (!email()) { setMsg('Zum Zurücksetzen zuerst die E-Mail eingeben'); return; }
    const { error } = await supa.auth.resetPasswordForEmail(email(), { redirectTo: location.origin + location.pathname });
    setMsg(error ? error.message : 'Falls ein Konto existiert, wurde eine E-Mail zum Zurücksetzen gesendet.', !error);
  };

  $('#lg_pw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#lg_go').click(); });
}

async function logout() {
  if (supa) await supa.auth.signOut();
  location.reload();
}

/* ---- Start ---- */

async function boot() {
  if (cloudEnabled) {
    supa = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    db.use(CloudAdapter);
    // Passwort zurücksetzen: nach Klick auf den Reset-Link kommt der Nutzer im Recovery-Modus zurück
    supa.auth.onAuthStateChange(async (event) => {
      if (event === 'PASSWORD_RECOVERY') {
        const np = window.prompt('Neues Passwort eingeben (mindestens 6 Zeichen):');
        if (np && np.length >= 6) {
          const { error } = await supa.auth.updateUser({ password: np });
          toast(error ? ('Fehler: ' + error.message) : 'Passwort geändert – du bist angemeldet.', error ? 'info' : 'ok');
        }
      }
    });
    const { data } = await supa.auth.getSession();
    if (!data.session) { renderLogin(); return; }
  }
  await startApp();
}

/* ---- Berechtigungen / Abo (nur Cloud) – Default permissiv, bis es eine entitlements-Zeile gibt ---- */
let ent = null;   // null = keine Sperre aktiv (Tabelle/Zeile fehlt) → alles erlaubt
let currentUserId = null, currentUserSlug = '', currentUserVor = '', currentUserNach = '', currentUserEmail = '';
// Preis-Pakete (CHF/Monat, anpassbar) – Quelle für die Plan-Ansicht
const PLANS = [
  { key: 'gratis',   name: 'Gratis',   preis: '0',  features: ['Alle Werkzeuge lokal nutzen', 'Drucken & PDF', '✗ kein Cloud-Speichern', '✗ kein Teilen'] },
  { key: 'basis',    name: 'Basic',    preis: '15', features: ['Cloud-Speichern, mehrere Geräte', 'Kontakte · Ausschreibung · Kosten', 'Termine · Kalender · Planung · Protokolle', 'Team-Arbeitsbereich'] },
  { key: 'komplett', name: 'Premium', preis: '25', features: ['Alles aus Basic', '+ Nachträge-Übersicht · Optionen · Finanzierung', '+ Zahlungsplan · Pendenzen · Dossier · Bauherr', '+ Solar · U-Wert · Honorar', '+ Teilen / Veröffentlichen'] },
];
// Einzeln freischaltbare Module (à la carte), CHF/Monat. tier = in welchem Paket enthalten.
// Schlüssel = canModul()-Schlüssel. Einzeln summiert teurer als das jeweilige Paket.
const MODULES = [
  { key: 'kontakte',   name: 'Kontakte',                 tier: 'basic',   inkl: true, feat: ['Adressbuch', 'Handelsregister-Suche (LINDAS)', 'Kategorien / Gewerke', 'E-Mail & Telefon'] },
  { key: 'kalender',   name: 'Kalender',                 tier: 'basic',   inkl: true, feat: ['Projekt- & Gesamtkalender', 'Termine & Fristen', 'Tag / Woche / Monat'] },
  { key: 'planung',    name: 'Arbeitsplanung',           tier: 'basic',   inkl: true, feat: ['Wochen-/Tagesplanung', 'Blöcke & Zuteilung'] },
  { key: 'submission', name: 'Ausschreibung & Vergabe',  tier: 'basic',   preis: '9', feat: ['Ausschreibung erstellen', 'Submittenten einladen + Versand', 'Offertvergleich / Abgebot', 'Vergabeantrag & Werkvertrag', 'Zuschlag / Absage'] },
  { key: 'kosten',     name: 'Kostenführung / Baukosten', tier: 'basic',  preis: '7', feat: ['Kostenschätzung (Positionen, Ausmass)', 'Objektgliederung / Baukosten nach BKP', 'Vergabesummen & Prognose', 'Nachträge & Rapporte je Gewerk', 'Rechnungen, Rückbehalt, QR-Scan'] },
  { key: 'termine',    name: 'Terminprogramm / Gantt',   tier: 'basic',   preis: '5', feat: ['Bauprogramm (Gantt)', 'Verkettung der Gewerke', 'Eingabefristen', 'Arbeitstage / Feiertage'] },
  { key: 'protokolle', name: 'Protokolle',               tier: 'basic',   preis: '5', feat: ['Sitzungsprotokolle', 'Traktanden & Beschlüsse', 'Verteiler', 'Pendenzen aus Sitzung'] },
  { key: 'pendenzen',  name: 'Pendenzen',                tier: 'premium', preis: '5', feat: ['Aufgaben mit Verantwortlichen', 'Termine & Überfällig-Tracking', 'projektübergreifend'] },
  { key: 'nachtraege', name: 'Nachträge-Übersicht (projektweit)', tier: 'premium', preis: '4', feat: ['Alle Nachträge über alle Gewerke', 'Status & Genehmigung zentral', 'Rapporte-Übersicht', 'Summen & Prognose', 'Pflege je Gewerk ist in Kosten enthalten'] },
  { key: 'optionen',   name: 'Optionale Bauteile & Teilprojekte', tier: 'premium', preis: '3', feat: ['Optionen ein-/ausblenden', 'Bauteile / Trakte', 'bereinigte Kostenschätzung'] },
  { key: 'finanz',     name: 'Finanzierung',             tier: 'premium', preis: '3', feat: ['Finanzierungsplan', 'Eigen- / Fremdkapital', 'Tranchen / Zahlungen'] },
  { key: 'zahlungsplan', name: 'Zahlungsplan',           tier: 'premium', preis: '3', feat: ['Bauherr: aus Werkverträgen + Unternehmer-Terminen', 'Honorar: SIA-Leistungsprozente', 'Verteilung auf Monatsrechnungen'] },
  { key: 'dossier',    name: 'Dokumente / Dossier',      tier: 'premium', preis: '3', feat: ['Dossier-Checkliste', 'Dokumentenablage', 'Vorlagen'] },
  { key: 'bauherr',    name: 'Bauherr / Auswahlentscheide', tier: 'premium', preis: '3', feat: ['Bemusterung', 'Auswahlentscheide', 'Wohnungen / Einheiten'] },
  { key: 'solar',      name: 'Solarrechner',             tier: 'premium', preis: '2', feat: ['Ertrag & Eigenverbrauch', 'Wirtschaftlichkeit & EIV', 'PDF-Report'] },
  { key: 'uwert',      name: 'U-Wert-Rechner',           tier: 'premium', preis: '4', feat: ['Bauteil-Schichten & λ-Werte', 'U-Wert-Berechnung', 'grafischer Querschnitt'], neu: true },
  { key: 'honorar',    name: 'Honorar-Rechner (SIA)',    tier: 'premium', preis: '3', feat: ['SIA 102', 'Baukosten → Honorar', 'Leistungsphasen'] },
  { key: 'design',     name: 'Druck-Designs',            tier: 'premium', preis: '3', feat: ['Mehrere PDF-Layouts global wählbar', 'Eleganter Akzent-Kopf', 'damit nicht alles gleich aussieht'] },
];
async function loadEntitlements() {
  if (!cloudEnabled || !supa) { ent = null; return; }
  try {
    const { data, error } = await supa.from('entitlements').select('plan,module,aktiv_bis').maybeSingle();
    ent = error ? null : (data || null);   // Fehler / keine Tabelle / keine Zeile → permissiv
  } catch (_) { ent = null; }
}
function planAktiv() { return !!(ent && ent.plan && ent.plan !== 'free' && (!ent.aktiv_bis || new Date(ent.aktiv_bis) > new Date())); }
function isPaid()    { return !cloudEnabled || ent === null || planAktiv(); }
function modulPreis(key) { const m = MODULES.find(x => x.key === key); return (m && m.preis) ? Number(m.preis) : 0; }
// Fair-Preis: nie mehr zahlen als das Paket. Ab 15.- Basic-Module → Basic; ab 25.- total → Premium (alles inkl.).
function effektivPlan(e) {
  if (!e || !e.plan) return 'free';
  if (e.plan === 'komplett') return 'komplett';
  const mods = Array.isArray(e.module) ? e.module : [];
  const basicSum = mods.filter(k => { const m = MODULES.find(x => x.key === k); return m && m.tier === 'basic' && !m.inkl; }).reduce((a, k) => a + modulPreis(k), 0);
  const totalSum = (e.plan === 'basis' ? 15 : 0) + mods.reduce((a, k) => a + modulPreis(k), 0);
  if (totalSum >= 25) return 'komplett';                 // genug fürs Voll-Paket → alles
  if (e.plan === 'basis' || basicSum >= 15) return 'basis'; // genug Basic-Module → ganzes Basic
  if (e.plan === 'trial') return 'trial';
  if (mods.length) return 'modul';
  return e.plan;
}
function canModul(m) {
  if (!cloudEnabled || ent === null) return true;
  const plan = effektivPlan(ent);                                      // berücksichtigt Fair-Preis-Upgrade
  if (plan === 'komplett' || plan === 'trial') return true;            // Premium/Test = alles
  const mod = MODULES.find(x => x.key === m);
  if (mod && mod.inkl) return isPaid();                                 // gratis sobald irgendein Modul/Plan bezahlt ist
  if (plan === 'basis' && mod && mod.tier === 'basic') return true;
  return (ent.module || []).includes(m);
}
// Module mit EIGENEM, sauber trennbarem Projekt-Feld → können beim Speichern echt weggelassen werden.
const MODUL_FELD = { pendenzen: 'pendenzen', protokolle: 'protokolle', solar: 'solar', uwert: 'uwert', honorar: 'honorar', dossier: 'dossier', bauherr: 'bauherr', optionen: ['optionen', 'bauteile'], finanz: 'finanz', zahlungsplan: ['zahlungsplan', 'zahlungsplaene'] };
// „Gesperrt" = Cloud-Modus mit echten Berechtigungen UND Modul nicht freigeschaltet (lokal/permissiv → nie gesperrt).
function modulGesperrt(key) { return cloudEnabled && ent !== null && !canModul(key); }
// Klon des Projekts fürs Speichern, ohne die Daten gesperrter (nicht gekaufter) Module → ehrlich „nicht gespeichert".
function projektFuerCloud(p) {
  let clone = null;
  const ensure = () => { if (!clone) clone = { ...p }; return clone; };
  for (const key in MODUL_FELD) {
    if (!modulGesperrt(key)) continue;
    [].concat(MODUL_FELD[key]).forEach(feld => { if (p[feld] !== undefined) delete ensure()[feld]; });
  }
  return clone || p;
}
// Dezenter Demo-Hinweis (nur wenn das Modul wirklich gesperrt ist), sonst leer.
// Trennbare Module (eigenes Feld) → „wird nicht gespeichert"; reine Übersichten (Daten liegen woanders) → „Premium-Funktion".
function demoBanner(key) {
  if (!modulGesperrt(key)) return '';
  const m = MODULES.find(x => x.key === key);
  const preis = (m && m.preis) ? ' · CHF ' + m.preis + '/Mt' : '';
  const name = esc(m ? m.name : key);
  const text = (MODUL_FELD[key] !== undefined)
    ? `🔓 <b>Demo:</b> „${name}" ist nicht in deinem Plan – ausprobieren ja, <b>wird aber nicht gespeichert</b>.`
    : `🔓 <b>Premium:</b> „${name}" ist eine Premium-Funktion (die Daten dazu bleiben erhalten).`;
  return `<div class="demo-bar">${text} <button class="btn xs" data-act="abo-open" type="button">Freischalten${preis}</button></div>`;
}
const PLAN_LABELS = { free: 'Free', trial: 'Test', basis: 'Basic', komplett: 'Premium', modul: 'Individuell' };
function planLabel() {
  if (!ent || !ent.plan) return '';
  if (ent.plan === 'trial') { const d = ent.aktiv_bis ? Math.max(0, Math.ceil((new Date(ent.aktiv_bis) - new Date()) / 86400000)) : 0; return 'Test · ' + d + ' Tg'; }
  const p = effektivPlan(ent);
  return PLAN_LABELS[p] || (p.charAt(0).toUpperCase() + p.slice(1));
}
// Aktuelles Tier + Speicher-Status für die dauerhafte Anzeige auf jeder Seite
function tierInfo() {
  if (!cloudEnabled) return { label: 'Lokal', cls: 'grey', save: 'nur lokal', saved: false };
  const p = effektivPlan(ent);
  const hatModule = ent && Array.isArray(ent.module) && ent.module.length;
  if (p === 'trial')    return { label: 'Test',        cls: 'amber',  save: 'gespeichert', saved: true };
  if (p === 'basis')    return { label: 'Basic',       cls: 'silber', save: 'gespeichert', saved: true };
  if (p === 'komplett') return { label: 'Premium',     cls: 'gold',   save: 'gespeichert', saved: true };
  if (p === 'modul' || hatModule) return { label: 'Individuell', cls: 'platin', save: 'gespeichert', saved: true };
  return { label: 'Free', cls: 'bronze', save: 'nicht gespeichert', saved: false };
}
function renderTierBadge() {
  let b = $('#tierBadge');
  if (!b) { b = document.createElement('button'); b.id = 'tierBadge'; b.type = 'button'; b.onclick = actAbo; document.body.appendChild(b); }
  const t = tierInfo();
  b.className = 'tier-badge';
  b.title = 'Plan ansehen & ändern';
  b.innerHTML = `<span class="tier-chip t-${t.cls}">${esc(t.label)}</span><span class="tier-state ${t.saved ? 'ok' : 'warn'}">${esc(t.save)}</span>`;
}

/* ---- Mitglieder & Rollen pro Projekt (Schritt 1: Verwaltung; Sichtbarkeits-Gating folgt) ---- */
const MITGLIED_ROLLEN = [
  { key: 'inhaber', label: 'Inhaber' },
  { key: 'projektleitung', label: 'Projektleitung' },
  { key: 'bauleitung', label: 'Bauleitung' },
  { key: 'administration', label: 'Administration' },
];
function slugVon(vor, nach) { return nameCreds(vor, nach).slug; }
// Rolle des aktuellen Nutzers im Projekt. Lokal/ohne Mitgliederliste = volle Rechte (Inhaber); kein Mitglied = null.
function meineRolle(p) {
  if (!cloudEnabled) return 'inhaber';
  const mit = p.mitglieder || [];
  if (!mit.length) return 'inhaber';
  const m = mit.find(x => (x.email && x.email.toLowerCase() === currentUserEmail) || (x.slug && x.slug === currentUserSlug));
  return m ? m.rolle : null;
}
// Projekte, in denen der aktuelle Nutzer Mitglied ist (alte/leere Liste + lokal = sichtbar)
// Sichtbarkeit: vorerst ALLE Projekte zeigen (client-seitiges Verstecken hat zu Selbst-Aussperrung geführt).
// Die echte, fälschungssichere Pro-Projekt-Sichtbarkeit kommt serverseitig mit RLS (Schritt 4d).
function sichtbareProjekte() { return state.projekte || []; }

// Rechte-Matrix: welche Reiter je Rolle AUSGEBLENDET werden (anpassbar)
const ROLLE_VERSTECKT = {
  inhaber:        [],
  projektleitung: [],
  bauleitung:     ['solar', 'honorar', 'finanz'],
  administration: ['pendenzen', 'termine', 'solar', 'honorar', 'bauherr', 'finanz'],
};
function versteckteTabs(p) { const r = meineRolle(p); return (r && ROLLE_VERSTECKT[r]) ? ROLLE_VERSTECKT[r] : []; }
function istInhaber(p)     { const r = meineRolle(p); return r === 'inhaber' || r === null; }   // null = (noch) nicht gelistet → trotzdem verwalten dürfen (Recovery)
function darfStammdaten(p) { const r = meineRolle(p); return r === null || r === 'inhaber' || r === 'projektleitung'; }
function darfVergeben(p)   { return meineRolle(p) !== 'bauleitung'; }   // alle ausser Bauleitung
const teamKey = m => (m.email || m.slug || '');
function actTeam(pid) {
  const p = findProjekt(pid); if (!p) return;
  const mit = p.mitglieder || [];
  const meKey = currentUserEmail || currentUserSlug;
  const rows = mit.length ? mit.map(m => {
    const nm = ((m.vorname || '') + ' ' + (m.nachname || '')).trim();
    return `<div class="team-row">
      <div style="flex:1"><div style="font-weight:600">${esc(nm || m.email || m.slug)}</div><div class="muted" style="font-size:11px">${esc(m.email || m.slug)}${teamKey(m) === meKey ? ' · du' : ''}</div></div>
      <select class="select team-rolle" data-key="${esc(teamKey(m))}" style="width:160px;padding:5px 8px">${MITGLIED_ROLLEN.map(r => `<option value="${r.key}"${m.rolle === r.key ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}</select>
      <button class="x-btn" data-act="team-rm" data-pid="${pid}" data-key="${esc(teamKey(m))}" title="entfernen">×</button>
    </div>`;
  }).join('') : '<p class="muted" style="font-size:13px;padding:6px 0">Noch keine Mitglieder – unten jemanden einladen.</p>';
  openModal('Team – ' + esc(p.name), `
    <div class="muted" style="font-size:12px;margin:-4px 0 8px">Wer am Projekt mitarbeitet (per E-Mail) und mit welcher Rolle. <b>Hinweis:</b> die Person muss sich mit genau dieser E-Mail registrieren/anmelden, dann sieht sie das Projekt.</div>
    <div id="teamRows">${rows}</div>
    <hr style="border:none;border-top:1px solid var(--border);margin:10px 0 8px">
    <div style="font-weight:600;font-size:13px;margin-bottom:6px">Mitglied einladen</div>
    <label class="field">E-Mail <input class="input" id="tm_email" type="email" placeholder="name@firma.ch"></label>
    <div class="form-row" style="margin-top:6px">
      <label class="field">Vorname <span class="muted" style="font-weight:400;font-size:11px">(optional)</span> <input class="input" id="tm_vor"></label>
      <label class="field">Nachname <span class="muted" style="font-weight:400;font-size:11px">(optional)</span> <input class="input" id="tm_nach"></label>
    </div>
    <div class="form-row">
      <label class="field">Rolle <select class="select" id="tm_rolle">${MITGLIED_ROLLEN.map(r => `<option value="${r.key}"${r.key === 'bauleitung' ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}</select></label>
      <div style="display:flex;align-items:flex-end"><button class="btn" data-act="team-add" data-pid="${pid}" type="button">+ Einladen</button></div>
    </div>
  `, `<button class="btn ghost" data-close="1">Schliessen</button>`);
  $$('.team-rolle').forEach(sel => sel.addEventListener('change', () => teamSetRolle(pid, sel.dataset.key, sel.value)));
}
function teamAdd(pid) {
  const p = findProjekt(pid); if (!p) return;
  const email = ($('#tm_email').value || '').trim().toLowerCase();
  if (!/.+@.+\..+/.test(email)) { toast('Bitte eine gültige E-Mail eingeben', 'info'); return; }
  const vor = $('#tm_vor').value.trim(), nach = $('#tm_nach').value.trim();
  p.mitglieder = p.mitglieder || [];
  // Dich selbst NIE aussperren: wenn die Liste leer ist, zuerst dich als Inhaber eintragen
  if (!p.mitglieder.length && currentUserEmail) p.mitglieder.push({ email: currentUserEmail, vorname: currentUserVor, nachname: currentUserNach, slug: currentUserSlug, rolle: 'inhaber' });
  if (p.mitglieder.some(m => (m.email || '').toLowerCase() === email)) { toast('Diese E-Mail ist bereits Mitglied', 'info'); return; }
  p.mitglieder.push({ email, vorname: vor, nachname: nach, slug: (vor && nach) ? slugVon(vor, nach) : '', rolle: $('#tm_rolle').value });
  save(); actTeam(pid); toast('Mitglied eingeladen');
}
function teamSetRolle(pid, key, rolle) {
  const p = findProjekt(pid); if (!p) return;
  const m = (p.mitglieder || []).find(x => teamKey(x) === key); if (!m) return;
  m.rolle = rolle; save();
}
function teamRemove(pid, key) {
  const p = findProjekt(pid); if (!p) return;
  p.mitglieder = (p.mitglieder || []).filter(x => teamKey(x) !== key);
  save(); actTeam(pid); toast('Mitglied entfernt');
}
function renderPlanBanner() {
  let bar = $('#planBanner');
  if (isPaid()) { if (bar) bar.remove(); return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'planBanner'; bar.className = 'plan-banner'; document.body.appendChild(bar); }
  bar.innerHTML = `<span>🔒 <strong>Speichern gesperrt</strong> – im Gratis-Modus kannst du arbeiten, aber nicht in der Cloud speichern.</span> <button class="btn sm" data-act="abo">Plan ansehen &amp; upgraden</button>`;
}

// Plan-/Abo-Ansicht: aktueller Plan + Pakete + Upgrade
function aktuellerPlan() { return (cloudEnabled && ent && ent.plan) ? ent.plan : (cloudEnabled ? 'gratis' : 'lokal'); }
function actAbo() {
  const plan = aktuellerPlan();
  const istTest = plan === 'trial';
  const status = plan === 'lokal' ? 'Lokaler Modus – ohne Konto, Daten nur in diesem Browser.'
    : istTest ? ('Testphase aktiv – noch ' + planLabel().replace('Test · ', '') + '. Danach ist Speichern gesperrt, bis du upgradest.')
    : plan === 'komplett' ? 'Aktiv: Premium – alle Module, Cloud, Teilen.'
    : plan === 'basis' ? 'Aktiv: Basic – Cloud-Speichern & Kernmodule.'
    : 'Gratis – arbeiten ja, Cloud-Speichern gesperrt.';
  const cards = PLANS.map(pl => {
    const aktiv = (plan === pl.key) || (istTest && pl.key === 'komplett');
    const upgrade = !aktiv && pl.key !== 'gratis' && plan !== 'komplett';
    return `<div class="plan-card${aktiv ? ' aktiv' : ''}">
      <div class="plan-name">${esc(pl.name)}${aktiv ? ' <span class="st green" style="font-size:9.5px;padding:1px 6px">aktiv</span>' : ''}</div>
      <div class="plan-preis">${pl.preis === '0' ? 'gratis' : 'CHF ' + pl.preis + '<span>/Mt</span>'}</div>
      <ul class="plan-feat">${pl.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
      ${upgrade ? `<button class="btn sm" data-act="upgrade" data-plan="${pl.key}">Upgraden</button>` : '<div style="height:4px"></div>'}
    </div>`;
  }).join('');
  const komplett = plan === 'komplett' || istTest;
  const modRows = MODULES.map(m => {
    const hat = komplett || canModul(m.key);
    const head = m.inkl
      ? `<span class="mod-name">${esc(m.name)} <span class="mod-tier mt-inkl">inklusive</span></span>
         <span class="muted" style="font-size:11px;white-space:nowrap">bei jedem Modul dabei</span>`
      : `<span class="mod-name">${esc(m.name)} <span class="mod-tier mt-${m.tier}">${m.tier === 'basic' ? 'Basic' : 'Premium'}</span>${m.neu ? ' <span class="mod-tier mt-neu">neu</span>' : ''}</span>
         <span class="mod-preis">CHF ${esc(m.preis)}<span style="font-size:10px;color:var(--text-soft)">/Mt</span></span>
         ${hat ? '<span class="st green" style="font-size:9.5px;padding:1px 7px">freigeschaltet</span>'
               : `<button class="btn xs" data-act="upgrade" data-plan="mod_${m.key}">freischalten</button>`}`;
    return `<div class="mod-row">
      <div class="mod-head">${head}</div>
      <div class="mod-feat">${(m.feat || []).map(esc).join(' · ')}</div>
    </div>`;
  }).join('');
  openModal('Dein Plan', `
    <div class="muted" style="margin:-4px 0 14px;font-size:13px">${esc(status)}</div>
    <div class="plan-grid">${cards}</div>
    <div style="margin-top:18px">
      <div style="font-weight:700;font-size:13px;margin-bottom:2px">Individuell – nur einzelne Module</div>
      <div class="muted" style="font-size:11.5px;margin-bottom:8px">Alle Module sind im Free benutzbar; bezahlt wird fürs <b>Speichern</b>. Einzeln buchbar – in Summe aber <b>teurer als das passende Paket</b>. <b>Kontakte, Kalender &amp; Arbeitsplanung sind gratis dabei</b>, sobald mindestens ein Modul gebucht ist. „Basic" enthält die Basis-Funktionen, „Premium" alles.</div>
      <div class="muted" style="font-size:11.5px;margin:-2px 0 10px;padding:7px 10px;background:#eefaf2;border:1px solid #bfe6cd;border-radius:8px;color:#1d6b3a">✓ <b>Fair-Preis:</b> Du zahlst nie mehr als das Paket. Ab <b>15.– Basic-Modulen</b> bekommst du automatisch <b>ganz Basic</b>, ab <b>25.– total</b> automatisch <b>Premium (alles)</b>.</div>
      <div class="mod-list">${modRows}</div>
    </div>
    <p class="muted" style="font-size:11.5px;margin:14px 0 0">Preise CHF/Monat (Richtwerte, anpassbar). Bezahlung über Stripe – sobald die Zahlungslinks in config.js eingetragen sind, führt „freischalten" direkt zur Kasse.</p>
  `, `<button class="btn ghost" data-close="1">Schliessen</button>`);
}
function openCheckout(plan) {
  const url = (CFG.STRIPE_LINKS || {})[plan];
  if (!url) { toast('Bezahlung wird in Kürze aktiviert – Zahlungslink noch nicht hinterlegt.', 'info'); return; }
  const sep = url.includes('?') ? '&' : '?';
  const full = currentUserId ? url + sep + 'client_reference_id=' + encodeURIComponent(currentUserId) : url;
  window.open(full, '_blank');
}

async function startApp() {
  await db.init();
  lastSnap = JSON.stringify(state); lastSnapAt = Date.now();   // Undo-Ausgangspunkt
  if (cloudEnabled) await loadEntitlements();
  $('#btnExport')?.addEventListener('click', exportData);
  $('#btnReset')?.addEventListener('click', resetDemo);
  $('#btnUndo')?.addEventListener('click', undo);
  $('#btnRedo')?.addEventListener('click', redo);
  document.addEventListener('keydown', undoKeydown);
  updateUndoButtons();
  initSidebarCollapse();
  initTooltips();
  document.addEventListener('keydown', planKeydown);
  document.addEventListener('mousemove', planDragMove);
  document.addEventListener('mouseup', planDragUp);
  const ver = $('.ver'); if (ver) ver.textContent = 'Prototyp · ' + APP_VERSION;
  renderUserChip();
  renderPlanBanner();
  renderTierBadge();
  window.addEventListener('hashchange', router);
  router();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (cloudEnabled) subscribeCloud();
}

// Angemeldeten Benutzer in der Sidebar-Fusszeile anzeigen (nur Cloud-Modus)
async function renderUserChip() {
  const el = $('#userChip');
  if (!el || !cloudEnabled || !supa) return;
  try {
    const { data } = await supa.auth.getUser();
    const u = data && data.user;
    if (!u) return;
    currentUserId = u.id;
    currentUserEmail = (u.email || '').toLowerCase();
    const m = u.user_metadata || {};
    currentUserVor = m.vorname || ''; currentUserNach = m.nachname || '';
    currentUserSlug = (m.vorname && m.nachname) ? slugVon(m.vorname, m.nachname) : (u.email ? u.email.split('@')[0] : '');
    const name = [m.vorname, m.nachname].filter(Boolean).join(' ').trim()
      || (u.email ? u.email.split('@')[0] : 'Angemeldet');
    const initials = (((m.vorname || '')[0] || '') + ((m.nachname || '')[0] || '')).toUpperCase()
      || name.slice(0, 2).toUpperCase();
    const pl = planLabel();
    el.innerHTML = `<span class="uc-avatar">${esc(initials)}</span><span class="uc-name" title="${esc(name)}">${esc(name)}</span><span class="uc-plan">${esc(pl || 'Plan')}</span>`;
    el.hidden = false;
    el.style.cursor = 'pointer'; el.title = 'Plan ansehen & upgraden';
    el.onclick = actAbo;
    const uv = $('#userVert'); if (uv) { uv.textContent = name; uv.title = name; }
  } catch (_) {}
}

// Sidebar ein-/ausklappen (nur Symbole) – Zustand browser-lokal gemerkt
// Eigener, schönerer Tooltip für die Menü-Symbole (ersetzt den nativen title-Tooltip, v.a. eingeklappt)
function initTooltips() {
  const nav = $('#mainNav'), app = $('#app'); if (!nav || !app) return;
  let tip = null;
  nav.addEventListener('mouseover', e => {
    const a = e.target.closest('a'); if (!a) return;
    const t = a.getAttribute('title'); if (t) { a.dataset.tip = t; a.removeAttribute('title'); }   // nativen Tooltip abschalten
    if (!app.classList.contains('collapsed')) return;   // ausgeklappt: Beschriftung ist sichtbar
    const txt = a.dataset.tip; if (!txt) return;
    if (!tip) { tip = document.createElement('div'); tip.className = 'app-tip'; document.body.appendChild(tip); }
    tip.textContent = txt;
    const r = a.getBoundingClientRect();
    tip.style.display = 'block';
    tip.style.left = (r.right + 12) + 'px';
    tip.style.top = (r.top + r.height / 2) + 'px';
  });
  nav.addEventListener('mouseout', () => { if (tip) tip.style.display = 'none'; });
}

function initSidebarCollapse() {
  const app = $('#app'); const btn = $('#btnCollapse');
  if (!app || !btn) return;
  const apply = on => {
    app.classList.toggle('collapsed', on);
    btn.textContent = on ? '»' : '«';
    btn.title = on ? 'Menü ausklappen' : 'Menü einklappen';
  };
  // Keine gespeicherte Wahl → bei mittlerer Breite (Fenster halb) eingeklappt starten, sonst offen
  let on;
  try { const v = localStorage.getItem('so_sidebar_collapsed'); on = (v === null) ? (window.innerWidth <= 1120) : (v === '1'); }
  catch (_) { on = window.innerWidth <= 1120; }
  apply(on);
  btn.addEventListener('click', () => {
    on = !on;
    apply(on);
    try { localStorage.setItem('so_sidebar_collapsed', on ? '1' : '0'); } catch (_) {}
  });
}

// Migriert ältere Datenstände auf das aktuelle Modell (offerten[] -> eingeladene[])
function migrate() {
  let changed = false;
  if (!Array.isArray(state.projekte)) { state.projekte = []; changed = true; }
  if (!Array.isArray(state.kontakte)) { state.kontakte = []; changed = true; }
  if (!Array.isArray(state.dokumente)) { state.dokumente = []; changed = true; }
  for (const p of state.projekte) {
    if (!p.protokolle) { p.protokolle = []; changed = true; }
    if (!p.entscheidungen) { p.entscheidungen = []; changed = true; }
    if (!p.bezugsfirmen) { p.bezugsfirmen = []; changed = true; }
    if (!p.geschosseListe) { p.geschosseListe = []; changed = true; }
    if (!p.auflagen) { p.auflagen = []; changed = true; }
    if (!p.mitglieder) { p.mitglieder = []; changed = true; }   // Team/Rollen pro Projekt
    if (!p.bauteile) { p.bauteile = []; changed = true; }   // Teilprojekte/Bauteile (Trakt 1–3, Provisorium …)
    if (!p.optionen) { p.optionen = []; changed = true; }    // optionale Bauteile (Erker, Lift …)
    if (!p.finanz) { p.finanz = { land: 0, honorare: 0, finanzierung: 0 }; changed = true; }
    if (!p.termine) { p.termine = []; changed = true; }
    for (const e of (p.entscheidungen || [])) {
      if (e.status === 'entschieden') { e.status = 'gewaehlt'; changed = true; }
      if (!e.bkp) {
        const t = (e.thema || '').toLowerCase();
        const map = [[/küchenger/, '258'], [/küche/, '258'], [/sanitär|bad|apparat|armatur/, '250'], [/fliesen|plätt/, '282.4'], [/parkett|bodenbel|boden/, '281.7'], [/innentür|türen/, '273'], [/schränk|einbau/, '273'], [/wandfarb|anstrich|maler/, '285'], [/beleucht|elektro/, '230'], [/storen|beschatt|sonnenschutz/, '228']];
        const hit = map.find(([re]) => re.test(t));
        if (hit) { e.bkp = hit[1]; changed = true; }
      }
    }
    for (const pr of (p.protokolle || [])) {
      for (const tr of (pr.traktanden || [])) {
        for (const it of (tr.eintraege || [])) {
          if (it.art === undefined) { it.art = (it.verantwortlich || it.termin) ? 'pendenz' : 'info'; changed = true; }
          if (it.erledigt === undefined) { it.erledigt = false; changed = true; }
          if (it.uebertragen === undefined) { it.uebertragen = false; changed = true; }
        }
      }
    }
    for (const v of (p.vergaben || [])) {
      if (!v.eingeladene) {
        v.eingeladene = (v.offerten || []).map(o => ({
          id: uid('e'), firma: o.firma, email: '', betrag: o.betrag ?? null, status: 'offeriert', datumMail: '',
        }));
        delete v.offerten;
        changed = true;
      }
      if (!v.nachtraege) { v.nachtraege = []; changed = true; }
      if (!v.rapporte)   { v.rapporte = [];   changed = true; }
      if (!v.vorgaenge)  { v.vorgaenge = [];  changed = true; }
      if (!v.rechnungen) { v.rechnungen = []; changed = true; }
      if (!v.budgetposten) { v.budgetposten = []; changed = true; }
      if (v.bauStart === undefined) { v.bauStart = ''; changed = true; }
      if (v.bauEnde  === undefined) { v.bauEnde  = ''; changed = true; }
    }
  }
  if (!state.buero) { state.buero = { ...BUERO }; changed = true; }
  if (changed) save();
}

/* ---------------------------------------------------------------
   3) Helfer
   --------------------------------------------------------------- */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function uid(prefix = 'id') { return prefix + '_' + Math.random().toString(36).slice(2, 9); }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function chf(n) {
  if (n == null || n === '') return '–';
  return "CHF " + Number(n).toLocaleString('de-CH', { maximumFractionDigits: 0 });
}

function chfShort(n) {
  if (!n) return '–';
  if (n >= 1e6) return (n / 1e6).toLocaleString('de-CH', { maximumFractionDigits: 1 }) + ' Mio.';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}

function fmtDate(iso) {
  if (!iso) return '–';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function today() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function todayIso() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  return Math.round((d - today()) / 86400000);
}

function dISO(s) { return s ? new Date(s + 'T00:00:00') : null; }
function dayDiff(a, b) { return Math.round((b - a) / 86400000); }
function isoOf(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function addDays(iso, n) { const d = dISO(iso); d.setDate(d.getDate() + n); return isoOf(d); }
function dayDiffISO(a, b) { return dayDiff(dISO(a), dISO(b)); }
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
}
// Schweizer Feiertage (Oster-basiert + fix). Gauss-Algorithmus für Ostersonntag.
function osterSonntag(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
    f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
    h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, mo - 1, da);
}
function feiertageJahr(y) {
  const o = osterSonntag(y), add = (base, n) => { const x = new Date(base); x.setDate(x.getDate() + n); return x; };
  return [
    { d: new Date(y, 0, 1), n: 'Neujahr' }, { d: new Date(y, 0, 2), n: 'Berchtoldstag' },
    { d: add(o, -2), n: 'Karfreitag' }, { d: add(o, 1), n: 'Ostermontag' },
    { d: add(o, 39), n: 'Auffahrt' }, { d: add(o, 50), n: 'Pfingstmontag' },
    { d: new Date(y, 7, 1), n: '1. August' },
    { d: new Date(y, 11, 25), n: 'Weihnachten' }, { d: new Date(y, 11, 26), n: 'Stephanstag' },
  ];
}
function feiertageInRange(start, end) {
  const out = [];
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++)
    feiertageJahr(y).forEach(f => { if (f.d >= start && f.d <= end) out.push(f); });
  return out;
}
function istFeiertag(d) { return feiertageJahr(d.getFullYear()).some(f => f.d.getMonth() === d.getMonth() && f.d.getDate() === d.getDate()); }
function istArbeitstag(d) { const w = d.getDay(); return w !== 0 && w !== 6 && !istFeiertag(d); }
function naechsterArbeitstag(iso) { const d = dISO(iso); while (!istArbeitstag(d)) d.setDate(d.getDate() + 1); return isoOf(d); }
function addArbeitstage(iso, n) { const d = dISO(iso); let c = Math.abs(n), step = n < 0 ? -1 : 1; while (c > 0) { d.setDate(d.getDate() + step); if (istArbeitstag(d)) c--; } return isoOf(d); }

function fristClass(iso, done) {
  if (done) return '';
  const d = daysUntil(iso);
  if (d == null) return '';
  if (d < 0) return 'over';
  if (d <= 7) return 'warn';
  return '';
}

function fristText(iso, done) {
  if (!iso) return '–';
  if (done) return fmtDate(iso);
  const d = daysUntil(iso);
  if (d == null) return fmtDate(iso);
  if (d < 0)  return fmtDate(iso) + ' · ' + Math.abs(d) + 'd überf.';
  if (d === 0) return fmtDate(iso) + ' · heute';
  if (d <= 14) return fmtDate(iso) + ' · in ' + d + 'd';
  return fmtDate(iso);
}

/* ---------------------------------------------------------------
   4) Abgeleitete Werte
   --------------------------------------------------------------- */

function statusIdx(v) { return STATUS_BY_KEY[v.status]?.index ?? 0; }
function isDone(v)    { return v.status === 'abgeschlossen'; }
function isVergeben(v){ return statusIdx(v) >= STATUS_BY_KEY['vergeben'].index; }
function isContract(v){ return statusIdx(v) >= STATUS_BY_KEY['werkvertrag'].index; }

// Fortschritt eines Projekts: Mittelwert der Vergabe-Fortschritte (0..100)
function projektFortschritt(p) {
  if (!p.vergaben || !p.vergaben.length) return 0;
  const max = VERGABE_STATUS.length - 1;
  const sum = p.vergaben.reduce((a, v) => a + statusIdx(v) / max, 0);
  return Math.round((sum / p.vergaben.length) * 100);
}

function projektVolumen(p) {
  // Vergebene Beträge inkl. Nachträge/Rapporte (Schlusssumme), sonst Schätzung
  return (p.vergaben || []).reduce((a, v) => a + (isVergeben(v) ? schlussSumme(v) : (v.schaetzung || 0)), 0);
}

/* --- Offerten & Summen einer Vergabe --- */
// Preisspiegel-Rechnung (wie Vergabeantrag Hefti):
// Brutto − Rabatt% = Z.-Summe − Skonto% = Netto − Allg.Abz% = Z.-Summe; + MwSt 8.1% = Netto inkl. MwSt
function condParts(c) {
  if (!c) return null;
  const b = (c.brutto != null && c.brutto !== '') ? Number(c.brutto) : null;
  if (b == null || isNaN(b)) return null;
  const rabattP = Number(c.rabatt) || 0, skontoP = Number(c.skonto) || 0, allgP = Number(c.weitereAbz) || 0;
  const rabattBetrag = b * (rabattP / 100);
  const zsumme1 = b - rabattBetrag;
  const skontoBetrag = zsumme1 * (skontoP / 100);
  const netto = zsumme1 - skontoBetrag;
  const allgBetrag = netto * (allgP / 100);
  const zsumme2 = netto - allgBetrag;
  const mwst = zsumme2 * 0.081;
  return { brutto: b, rabattP, rabattBetrag, zsumme1, skontoP, skontoBetrag, netto, allgP, allgBetrag, zsumme2, mwst, total: zsumme2 + mwst };
}
// Massgeblicher Netto-Vergleichswert = Z.-Summe nach allen Abzügen (exkl. MwSt)
function condNetto(c) { const r = condParts(c); return r ? r.zsumme2 : null; }
// Netto je Stufe (Fallback: Legacy-Einzelbetrag e.betrag = Offerte)
function eOff(e) { if (e.offerte && e.offerte.brutto != null && e.offerte.brutto !== '') return condNetto(e.offerte); return e.betrag != null ? e.betrag : null; }
function eAbg(e) { return (e.abgebot && e.abgebot.brutto != null && e.abgebot.brutto !== '') ? condNetto(e.abgebot) : null; }
// Betrag + Grundlage (Werkvertrag > Abgebot > Offerte) im Kontext des Gewerks
function eBetragQuelle(v, e) {
  if (isVergeben(v) && v.firma && e.firma === v.firma && (v.betrag != null)) return { betrag: v.betrag, quelle: 'Werkvertrag' };
  const ab = eAbg(e); if (ab != null) return { betrag: ab, quelle: 'Abgebot' };
  if (e.offerte && e.offerte.brutto != null && e.offerte.brutto !== '') return { betrag: condNetto(e.offerte), quelle: 'Offerte' };
  if (e.betrag != null) return { betrag: e.betrag, quelle: 'Offerte' };
  return { betrag: null, quelle: '' };
}
function eVer(e) { return (e.vergabe && e.vergabe.brutto != null && e.vergabe.brutto !== '') ? condNetto(e.vergabe) : null; }
function offertenOf(v)  { return (v.eingeladene || []).filter(e => e.status === 'offeriert' && eOff(e) != null); }
function bestBetrag(v)  { const xs = (v.eingeladene || []).filter(e => e.status !== 'abgesagt').map(eOff).filter(x => x != null); return xs.length ? Math.min(...xs) : null; }
function bestAbgebot(v) { const xs = (v.eingeladene || []).filter(e => e.status !== 'abgesagt').map(eAbg).filter(x => x != null); return xs.length ? Math.min(...xs) : null; }
// Konditionen einer Stufe (Fallback: Legacy-Einzelbetrag e.betrag = Offerte-Brutto)
function vglStageOf(e, stage) {
  if (e[stage] && e[stage].brutto != null && e[stage].brutto !== '') return e[stage];
  if (stage === 'offerte' && e.betrag != null) return { brutto: e.betrag };
  return null;
}
function nachtragSumme(v){ return (v.nachtraege || []).filter(n => n.status === 'genehmigt').reduce((a, n) => a + (n.betrag || 0), 0); }
function rapportSumme(v) { return (v.rapporte || []).reduce((a, r) => a + (r.betrag || 0), 0); }
function budgetSumme(v)  { return (v.budgetposten || []).reduce((a, b) => a + (b.betrag || 0), 0); }
// Budget steckt im WV → nicht aufrechnen. ABER: ist eine Auswahl getroffen (ist gesetzt),
// zählt die Differenz (tatsächlich − Budget): Budget wird durch den echten Betrag ersetzt.
function hatIst(b)        { return b.ist != null && b.ist !== ''; }
function budgetDelta(v)   { return (v.budgetposten || []).reduce((a, b) => a + (hatIst(b) ? (Number(b.ist) || 0) - (b.betrag || 0) : 0), 0); }
function schlussSumme(v)  { return (v.betrag || 0) + nachtragSumme(v) + rapportSumme(v) + budgetDelta(v); }

/* --- Rechnungen / Kostenkontrolle --- */
const RG_ART = { akonto: 'Akonto', schluss: 'Schlussrechnung', gutschrift: 'Gutschrift' };
// Vorzeichenbehafteter Rechnungsbetrag (Gutschrift zählt negativ)
function rgSigned(r)     { const b = Number(r.betrag) || 0; return r.art === 'gutschrift' ? -Math.abs(b) : b; }
function rgSkonto(r)     { return rgSigned(r) * ((Number(r.skontoP) || 0) / 100); }      // Skontoabzug bei Zahlung
function rgRueckbehalt(r){ return rgSigned(r) * ((Number(r.rueckbehaltP) || 0) / 100); } // einbehaltene Garantiesumme
// Tatsächlich ausbezahlt: Brutto − Skonto − (Rückbehalt, solange nicht freigegeben)
function rgAuszahlung(r) { let a = rgSigned(r) - rgSkonto(r); if (!r.rbFrei) a -= rgRueckbehalt(r); return a; }
function rechnungBezahlt(v)        { return (v.rechnungen || []).filter(r => r.bezahlt).reduce((a, r) => a + rgAuszahlung(r), 0); }
function rechnungTotal(v)          { return (v.rechnungen || []).reduce((a, r) => a + rgSigned(r), 0); }
// Noch einbehaltener Garantierückbehalt (bezahlte Rechnungen, Rückbehalt noch nicht freigegeben)
function rechnungRueckbehalt(v)    { return (v.rechnungen || []).filter(r => r.bezahlt && !r.rbFrei).reduce((a, r) => a + rgRueckbehalt(r), 0); }
function kvRev(v)           { return bestBetrag(v); }                 // günstigste Offerte (revidierter KV)

// Eine Kostenzeile einer Vergabe (analog Baukostenübersicht)
function kostenZeile(v) {
  const kv = v.schaetzung || 0;
  const rev = kvRev(v);                                              // kann null sein
  const wv = isVergeben(v) ? (v.betrag || 0) : 0;
  const nt = nachtragSumme(v);
  const rap = rapportSumme(v);
  const budget = budgetSumme(v);   // Info – steckt im WV
  const bdelta = budgetDelta(v);   // wirkt erst, wenn eine Auswahl getroffen wurde (Ist − Budget)
  // Abrechnungsprognose: vergeben → WV + Nachträge + Rapporte; sonst beste bekannte Schätzung; + Budget-Differenz
  const prognose = (isVergeben(v) ? (wv + nt + rap) : (rev != null ? rev : kv)) + bdelta;
  const bezahlt = rechnungBezahlt(v);
  const fakturiert = rechnungTotal(v);
  const offen = prognose - bezahlt;
  return { kv, rev, wv, nt, rap, budget, prognose, bezahlt, fakturiert, offen, vergeben: isVergeben(v) };
}

// BKP-Hauptgruppen (erste Ziffer)
const BKP_GRUPPEN = {
  '0': 'Grundstück', '1': 'Vorbereitungsarbeiten', '2': 'Gebäude', '3': 'Betriebseinrichtungen',
  '4': 'Umgebung', '5': 'Baunebenkosten', '6': 'Reserve', '9': 'Ausstattung',
};

// Schweizer Zahlenformat ohne Währung, 2 Dezimalstellen (wie im BKP-Sheet)
function money(n) {
  if (n == null) return '–';
  return Number(n).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function projektVergebenAnzahl(p) { return (p.vergaben || []).filter(isVergeben).length; }

/* --- Vergabe-Art: Einzelvergabe / ARGE / Teilvergabe --- */
function teilSumme(v) { return (v.teilvergaben || []).reduce((a, t) => a + (Number(t.betrag) || 0), 0); }
// Kopfzeile „Unternehmer: …“ je nach Vergabe-Art
function vergabeFirmaLabel(v) {
  if (v.teilvergaben && v.teilvergaben.length) {
    const firmen = v.teilvergaben.map(t => t.firma).filter(Boolean);
    return 'Teilvergabe an <strong>' + firmen.map(esc).join(', ') + '</strong>';
  }
  if (v.argePartner && v.argePartner.length) {
    return 'ARGE: <strong>' + v.argePartner.map(esc).join(' · ') + '</strong>';
  }
  return v.firma ? 'Unternehmer: <strong>' + esc(v.firma) + '</strong>' : 'Noch kein Unternehmer';
}
// Detail-Karte mit der Aufteilung (nur bei ARGE / Teilvergabe sichtbar)
function vergabeArtCard(v) {
  if (v.teilvergaben && v.teilvergaben.length) {
    return `<div class="card card-pad" style="margin-bottom:18px">
      <h2 style="margin:0 0 8px;font-size:15px">Teilvergabe – ${v.teilvergaben.length} Firma${v.teilvergaben.length === 1 ? '' : 'en'}</h2>
      <table class="grid"><thead><tr><th>Firma</th><th class="num" style="width:160px">Vergabesumme</th></tr></thead><tbody>
        ${v.teilvergaben.map(t => `<tr><td>${esc(t.firma || '—')}</td><td class="num">${chf(t.betrag)}</td></tr>`).join('')}
        <tr><td><b>Total</b></td><td class="num"><b>${chf(teilSumme(v))}</b></td></tr>
      </tbody></table></div>`;
  }
  if (v.argePartner && v.argePartner.length) {
    return `<div class="card card-pad" style="margin-bottom:18px">
      <h2 style="margin:0 0 6px;font-size:15px">ARGE / Bietergemeinschaft</h2>
      <div style="font-size:13.5px">${v.argePartner.map(p => `<span class="st blue" style="margin:0 6px 6px 0;display:inline-block">${esc(p)}</span>`).join('')}</div>
      <p class="muted" style="font-size:12px;margin:6px 0 0">Ein gemeinsamer Werkvertrag, eine Vergabesumme. Federführung: <strong>${esc(v.firma || v.argePartner[0])}</strong></p></div>`;
  }
  return '';
}

/* --- Phasen aus Vergaben-Status ableiten --- */
const PHASE_COLOR = { planung: '#f97316', ausschreibung: '#eab308', vergabe: '#16a34a', ausfuehrung: '#1f6feb', abschluss: '#8a97a8' };

function statusToPhase(status) {
  const idx = STATUS_BY_KEY[status] ? STATUS_BY_KEY[status].index : null;
  if (idx == null) return 'ausschreibung';
  if (idx >= STATUS_BY_KEY['abgeschlossen'].index) return 'abschluss';
  if (idx >= STATUS_BY_KEY['ausfuehrung'].index) return 'ausfuehrung';
  if (idx >= STATUS_BY_KEY['vergeben'].index) return 'vergabe';
  return 'ausschreibung';
}

function phasenVerteilung(p) {
  const counts = { planung: 0, ausschreibung: 0, vergabe: 0, ausfuehrung: 0, abschluss: 0 };
  const vs = p.vergaben || [];
  if (!vs.length) { counts.planung = 1; return { counts, total: 1, empty: true }; }
  vs.forEach(v => counts[statusToPhase(v.status)]++);
  return { counts, total: vs.length, empty: false };
}

// Projektphase = am wenigsten fortgeschrittenes Gewerk (Engpass):
// „Abschluss" erst, wenn ALLE Gewerke abgeschlossen sind – nicht schon bei der Mehrheit.
function dominantPhase(p) {
  const vs = p.vergaben || [];
  if (!vs.length) return 'planung';
  let minIdx = Infinity;
  vs.forEach(v => { minIdx = Math.min(minIdx, PHASE_INDEX[statusToPhase(v.status)]); });
  return PHASEN[minIdx].key;
}

function naechsteFrist(p) {
  const offen = (p.vergaben || []).filter(v => !isDone(v) && v.frist);
  if (!offen.length) return null;
  return offen.map(v => v.frist).sort()[0];
}

function findProjekt(id) { return state.projekte.find(p => p.id === id); }
function findVergabe(p, vid) { return (p.vergaben || []).find(v => v.id === vid); }

/* ---------------------------------------------------------------
   5) Wiederverwendbare UI-Bausteine
   --------------------------------------------------------------- */

function phaseBadge(phaseKey) {
  const p = PHASEN.find(x => x.key === phaseKey) || PHASEN[0];
  return `<span class="phase ${p.key}">${esc(p.label)}</span>`;
}

function statusPill(v) {
  const s = STATUS_BY_KEY[v.status] || VERGABE_STATUS[0];
  return `<span class="st ${s.color}">${esc(s.label)}</span>`;
}

// Optionale Begleit-Markierungen eines Gewerks: erscheinen NUR wenn vorhanden,
// und zeigen ihren Zustand (offen vs. erledigt) – macht sichtbar, was lief.
function vergabeMarken(v) {
  const m = [];
  const nt = v.nachtraege || [];
  if (nt.length) { const offen = nt.filter(n => n.status === 'offen').length; m.push(`<span class="st ${offen ? 'amber' : 'green'}" style="font-size:10px;padding:2px 7px">Nachträge ${nt.length}${offen ? ' · ' + offen + ' offen' : ' · erledigt'}</span>`); }
  const rap = v.rapporte || [];
  if (rap.length) m.push(`<span class="st teal" style="font-size:10px;padding:2px 7px">Regie ${rap.length}</span>`);
  const rg = v.rechnungen || [];
  if (rg.length) { const offen = rg.filter(r => !r.bezahlt).length; m.push(`<span class="st ${offen ? 'amber' : 'green'}" style="font-size:10px;padding:2px 7px">Rechnungen ${rg.length}${offen ? ' · ' + offen + ' offen' : ' · bezahlt'}</span>`); }
  return m.join(' ');
}

// Mini-Pipeline (Balken) für Tabellenzeilen
function miniPipe(v) {
  const cur = statusIdx(v);
  return `<div class="pipe" title="${esc(STATUS_BY_KEY[v.status]?.label || '')}">` +
    VERGABE_STATUS.map((_, i) => {
      const cls = i < cur ? 'on' : (i === cur ? 'cur' : '');
      return `<i class="${cls}"></i>`;
    }).join('') + `</div>`;
}

function progressBar(pct) {
  return `<div class="progress"><span style="width:${pct}%"></span></div>`;
}

function phasenBar(p) {
  const { counts, total } = phasenVerteilung(p);
  const active = PHASEN.filter(ph => counts[ph.key] > 0);
  return `<div class="card card-pad" style="margin-bottom:18px">
    <div class="section-head" style="margin-top:0;margin-bottom:12px"><h2 style="font-size:15px">Phasen-Verteilung</h2><span class="hint">${total} Vergabe${total === 1 ? '' : 'n'}</span></div>
    <div class="phasebar">
      ${active.length ? active.map(ph => `<div class="pb-seg" style="flex:${counts[ph.key]};background:${PHASE_COLOR[ph.key]}" title="${esc(ph.label)}: ${counts[ph.key]}"><span>${counts[ph.key]}</span></div>`).join('') : '<div class="pb-seg" style="flex:1;background:var(--border-2)"></div>'}
    </div>
    <div class="phase-legend">
      ${PHASEN.map(ph => `<span class="${counts[ph.key] ? '' : 'off'}"><i style="background:${PHASE_COLOR[ph.key]}"></i>${esc(ph.label)} <b>${counts[ph.key]}</b></span>`).join('')}
    </div>
  </div>`;
}

function projektTabs(p, active) {
  const openP = offenePendenzen(p).length;
  const pendBadge = openP ? ` <span class="tab-badge">${openP}</span>` : '';
  const items = [
    { key: 'overview', href: `#/projekt/${p.id}`, label: 'Übersicht' },
    { key: 'kalender', href: `#/projekt/${p.id}/kalender`, label: 'Kalender' },
    { key: 'listen', href: `#/projekt/${p.id}/listen`, label: 'Kontakte' },
    { key: 'kosten', href: `#/projekt/${p.id}/kosten`, label: 'Kosten' },
    { key: 'rechnungen', href: `#/projekt/${p.id}/rechnungen`, label: 'Rechnungskontrolle' },
    { key: 'termine', href: `#/projekt/${p.id}/termine`, label: 'Termine / Gantt' },
    { key: 'pendenzen', href: `#/projekt/${p.id}/pendenzen`, label: 'Pendenzen' + pendBadge },
    { key: 'dossier', href: `#/projekt/${p.id}/dossier`, label: 'Dossier' + (dossierFehltCount(p) ? ` <span class="tab-badge">${dossierFehltCount(p)}</span>` : '') },
    { key: 'auflagen', href: `#/projekt/${p.id}/auflagen`, label: 'Auflagen' + ((p.auflagen || []).filter(a => a.status !== 'erledigt').length ? ` <span class="tab-badge">${(p.auflagen || []).filter(a => a.status !== 'erledigt').length}</span>` : '') },
    { key: 'protokolle', href: `#/projekt/${p.id}/protokolle`, label: 'Protokolle' },
    { key: 'nachtraege', href: `#/projekt/${p.id}/nachtraege`, label: 'Nachträge' },
    { key: 'optionen', href: `#/projekt/${p.id}/optionen`, label: 'Optionen' },
    { key: 'finanz', href: `#/projekt/${p.id}/finanz`, label: 'Finanzierung' },
    { key: 'zahlungsplan', href: `#/projekt/${p.id}/zahlungsplan`, label: 'Zahlungsplan' },
    { key: 'bauherr', href: `#/projekt/${p.id}/bauherr`, label: 'Bauherr' },
    { key: 'solar', href: `#/projekt/${p.id}/solar`, label: 'Solar' },
    { key: 'uwert', href: `#/projekt/${p.id}/uwert`, label: 'U-Wert' },
    { key: 'honorar', href: `#/projekt/${p.id}/honorar`, label: 'Honorar' },
  ].filter(it => !versteckteTabs(p).includes(it.key));   // Rollen-Matrix: ausgeblendete Reiter weglassen
  // Unterreiter auch in der Sidebar unter „Projekte" anzeigen (volle Liste)
  const sub = $('#projSubnav');
  if (sub) sub.innerHTML = `<div class="subnav-title" title="${esc(p.name)}">${esc(p.name)}</div>` +
    items.map(it => `<a class="subnav-link ${active === it.key ? 'active' : ''}" href="${it.href}">${it.label}</a>`).join('');
  // In-Page-Reiter: häufige primär, Rest unter „Mehr ▾" (kompakt, halbschirm-tauglich)
  const primary = ['overview', 'kalender', 'listen', 'kosten', 'termine', 'pendenzen'];
  const prim = items.filter(it => primary.includes(it.key));
  const more = items.filter(it => !primary.includes(it.key));
  const moreActive = more.some(it => it.key === active);
  return `<div class="ptabs">
    ${prim.map(it => `<a class="ptab ${active === it.key ? 'active' : ''}" href="${it.href}">${it.label}</a>`).join('')}
    <div class="ptab-more">
      <button class="ptab ${moreActive ? 'active' : ''}" data-act="ptabs-more">${moreActive ? (more.find(it => it.key === active).label + ' ') : 'Mehr '}▾</button>
      <div class="ptab-menu" id="ptabMenu" hidden>${more.map(it => `<a class="${active === it.key ? 'active' : ''}" href="${it.href}">${it.label}</a>`).join('')}</div>
    </div>
  </div>`;
}
function ptabsMoreToggle() {
  const m = document.getElementById('ptabMenu'); if (!m) return;
  const show = m.hidden; m.hidden = !show;
  if (show) { const away = e => { if (!e.target.closest('.ptab-more')) { m.hidden = true; document.removeEventListener('mousedown', away); } }; setTimeout(() => document.addEventListener('mousedown', away), 0); }
}

function emptyState(ico, text) {
  return `<div class="empty"><div class="e-ico">${ico}</div><p>${esc(text)}</p></div>`;
}

/* ---------------------------------------------------------------
   6) Toast + Modal
   --------------------------------------------------------------- */

function toast(msg, type = 'ok') {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `<span>${type === 'ok' ? '✓' : 'ℹ'}</span> ${esc(msg)}`;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; setTimeout(() => el.remove(), 250); }, 2600);
}

function openModal(title, bodyHtml, footHtml) {
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" data-close="1">
      <div class="modal">
        <div class="modal-head"><h3>${esc(title)}</h3><button class="x-btn" data-close="1">×</button></div>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-foot">${footHtml || ''}</div>
      </div>
    </div>`;
  root.querySelector('.modal-backdrop').addEventListener('click', e => {
    if (e.target.dataset.close) closeModal();
  });
}
function closeModal() { $('#modal-root').innerHTML = ''; }

/* ---------------------------------------------------------------
   7) Router
   --------------------------------------------------------------- */

function parseHash() {
  const h = (location.hash || '#/dashboard').slice(2); // entfernt "#/"
  return h.split('/').filter(Boolean);
}

function setActiveNav(key) {
  $$('#mainNav a').forEach(a => a.classList.toggle('active', a.dataset.nav === key));
  // Projekt-Unterreiter leeren – Projekt-Detailansichten füllen sie via projektTabs neu
  const sub = $('#projSubnav'); if (sub) sub.innerHTML = '';
}

let _lastRenderHash = null;
function render(html) {
  $('#view').innerHTML = html;
  // Nur bei echtem Seitenwechsel nach oben scrollen; In-Place-Updates (z.B. Block verschieben) behalten die Position
  if (location.hash !== _lastRenderHash) { window.scrollTo(0, 0); _lastRenderHash = location.hash; }
}

function router() {
  const parts = parseHash();
  const [root, a, sub, b] = parts;

  switch (root) {
    case 'dashboard': setActiveNav('dashboard'); return viewDashboard();
    case 'projekte':  setActiveNav('projekte');  return viewProjekte();
    case 'projekt':
      setActiveNav('projekte');
      if (sub === 'vergabe' && b) return viewVergabeDetail(a, b);
      if (sub === 'termine') return viewTermine(a);
      if (sub === 'kalender') return viewKalender(a);
      if (sub === 'kosten') return viewKosten(a);
      if (sub === 'rechnungen') return viewRechnungen(a);
      if (sub === 'auflagen') return viewAuflagen(a);
      if (sub === 'optionen') return viewOptionen(a);
      if (sub === 'nachtraege') return viewNachtraege(a);
      if (sub === 'solar') return viewSolar(a);
      if (sub === 'uwert') return viewUwert(a);
      if (sub === 'zahlungsplan') return viewZahlungsplan(a);
      if (sub === 'protokolle') return viewProtokolle(a);
      if (sub === 'pendenzen') return viewPendenzen(a);
      if (sub === 'dossier') return viewDossier(a);
      if (sub === 'listen') return viewListen(a);
      if (sub === 'bauherr') return viewBauherr(a);
      if (sub === 'finanz') return viewFinanz(a);
      if (sub === 'honorar') { honorarPid = a; return viewHonorar(); }
      if (sub === 'protokoll' && b) return viewProtokollDetail(a, b);
      return viewProjektDetail(a);
    case 'kalender':      setActiveNav('kalender');      return viewKalenderGlobal();
    case 'pendenzen':     setActiveNav('pendenzen');     return viewPendenzenGlobal();
    case 'planung':       setActiveNav('planung');       return viewPlanung();
    case 'erfassen':      setActiveNav('erfassen');      return viewErfassen();
    case 'drucken':       setActiveNav('drucken');       return viewDrucken();
    case 'honorar':       setActiveNav('honorar'); honorarPid = null; return viewHonorar();
    case 'kontakte':      setActiveNav('kontakte');      return viewKontakte();
    case 'kontakt':       setActiveNav('kontakte');      return viewKontaktDetail(a);
    case 'dokumente':     setActiveNav('dokumente');     return viewDokumente();
    case 'einstellungen': setActiveNav('einstellungen'); return viewEinstellungen();
    default:
      location.hash = '#/dashboard';
  }
}

function go(hash) { location.hash = hash; }

/* ---------------------------------------------------------------
   8) View: Dashboard
   --------------------------------------------------------------- */

function viewDashboard() {
  const projekte = sichtbareProjekte();
  const todayI = todayIso();
  const aktive = projekte.filter(p => p.phase !== 'abschluss');
  const alleVergaben = projekte.flatMap(p => (p.vergaben || []).map(v => ({ v, p })));
  const offeneVergaben = alleVergaben.filter(x => !isDone(x.v));
  const fristTasks = offeneVergaben.filter(x => x.v.frist).sort((a, b) => a.v.frist.localeCompare(b.v.frist));
  const fristig = fristTasks.filter(x => { const d = daysUntil(x.v.frist); return d != null && d >= 0 && d <= 7; });
  const volumen = projekte.reduce((a, p) => a + projektVolumen(p), 0);

  // Anstehende Termine (projektübergreifend, ab heute)
  const events = [];
  projekte.forEach((p, idx) => sammleTermine(p).forEach(e => { if (e.datum >= todayI) events.push({ ...e, p, idx }); }));
  events.sort((a, b) => a.datum.localeCompare(b.datum) || (a.zeit || '').localeCompare(b.zeit || ''));
  const termine = events.slice(0, 7);

  // Offene Pendenzen (projektübergreifend, nach Termin)
  const allPend = [];
  projekte.forEach((p, idx) => offenePendenzen(p).forEach(x => allPend.push({ p, idx, x })));
  allPend.sort((a, b) => (a.x.it.termin || '9999-99-99').localeCompare(b.x.it.termin || '9999-99-99'));
  const pendUeber = allPend.filter(o => o.x.it.termin && daysUntil(o.x.it.termin) < 0).length;

  const kpi = (ico, cls, label, value, foot, footCls) => `<div class="kpi"><div class="k-label"><span class="k-ico ${cls}">${ico}</span>${label}</div><div class="k-value">${value}</div><div class="k-foot"${footCls ? ` style="color:var(--${footCls})"` : ''}>${foot}</div></div>`;
  const kpis = [
    kpi('▤', 'blue', 'Aktive Projekte', aktive.length, projekte.length + ' total'),
    kpi('◷', 'amber', 'Offene Vergaben', offeneVergaben.length, alleVergaben.length + ' gesamt · ' + chfShort(volumen)),
    kpi('☑', 'green', 'Offene Pendenzen', allPend.length, pendUeber ? pendUeber + ' überfällig' : 'alle im Plan', pendUeber ? 's-red' : ''),
    kpi('⚑', 'purple', 'Fristen ≤ 7 Tage', fristig.length, fristig.length ? 'bald fällig' : 'nichts dringend', fristig.length ? 's-red' : ''),
  ].join('');

  const sect = (title, hint) => `<div class="section-head" style="margin:2px 0 12px"><h2>${title}</h2>${hint ? (hint.startsWith('<') ? hint : `<span class="hint">${hint}</span>`) : ''}</div>`;

  // Panel: Nächste Eingabefristen
  const fristPanel = sect('Nächste Eingabefristen', 'Submissionen') + `<div class="card" style="margin-bottom:18px">${fristTasks.length ? `
    <table class="grid">
      <thead><tr><th>Projekt</th><th>Gewerk</th><th>Status</th><th>Frist</th></tr></thead>
      <tbody>${fristTasks.slice(0, 6).map(({ v, p }) => `
        <tr class="clickable" data-goto="#/projekt/${p.id}/vergabe/${v.id}" data-ctx="vergabe" data-pid="${p.id}" data-vid="${v.id}">
          <td>${esc(p.name)}</td>
          <td><span class="bkp-code">${esc(v.bkp || '')}</span> ${esc(v.gewerk || '')}</td>
          <td>${statusPill(v)}</td>
          <td class="frist ${fristClass(v.frist, false)}">${fristText(v.frist, false)}</td>
        </tr>`).join('')}</tbody>
    </table>` : emptyState('✓', 'Keine offenen Eingabefristen.')}</div>`;

  // Panel: Anstehende Termine
  const terminePanel = sect('Anstehende Termine', 'alle Projekte') + `<div class="card card-pad" style="margin-bottom:18px">${termine.length ? `<div class="dash-list">${termine.map(e => `
    <div class="dash-row">
      <i class="cal-dot ${projColor(e.idx, e.p)}"></i>
      <span class="dash-muted" style="min-width:92px;font-size:12px">${fmtDate(e.datum)}${e.zeit ? ' · ' + esc(e.zeit) : ''}</span>
      <span class="dr-main">${esc(e.titel)}<div class="dr-sub">${esc(e.p.name)}</div></span>
    </div>`).join('')}</div>` : '<p class="muted" style="margin:0;font-size:13px">Keine anstehenden Termine.</p>'}</div>`;

  // Panel: Offene Pendenzen
  const pendPanel = sect('Offene Pendenzen', allPend.length ? `${allPend.length}${pendUeber ? ` · ${pendUeber} überfällig` : ''}` : '') + `<div class="card card-pad" style="margin-bottom:18px">${allPend.length ? `<div class="dash-list">${allPend.slice(0, 8).map(({ p, idx, x }) => `
    <div class="dash-row">
      <input type="checkbox" class="pend-check" data-pid="${p.id}" data-prid="${x.pr ? x.pr.id : ''}" data-tid="${x.tr ? x.tr.id : ''}" data-itemid="${x.it.id}" title="erledigt">
      <span class="dr-main">${esc(x.it.text)}${pendFirmenChips(x.it)}<div class="dr-sub"><i class="cal-dot ${projColor(idx, p)}" style="width:7px;height:7px"></i> <a href="#/projekt/${p.id}/pendenzen">${esc(p.name)}</a></div></span>
      <span class="frist ${fristClass(x.it.termin, false)}" style="font-size:11.5px;white-space:nowrap">${x.it.termin ? fristText(x.it.termin, false) : '–'}</span>
    </div>`).join('')}</div>${allPend.length > 8 ? `<a class="hint" href="#/pendenzen" style="display:inline-block;margin-top:10px">Alle ${allPend.length} anzeigen →</a>` : ''}` : emptyState('✓', 'Keine offenen Pendenzen.')}</div>`;

  // Panel: Projekte (kompakt) + Dossier-Vollständigkeit
  const projList = (aktive.length ? aktive : projekte);
  const avgDoc = projList.length ? Math.round(projList.reduce((a, p) => a + dossierPct(p), 0) / projList.length) : 0;
  const docCls = d => d >= 80 ? 's-green' : d >= 40 ? 's-amber' : 's-red';
  const projPanel = sect('Projekte', projList.length ? `Ø Unterlagen ${avgDoc}% · <a class="hint" href="#/projekte" style="color:inherit">alle →</a>` : `<a class="hint" href="#/projekte">alle →</a>`) + `<div class="card card-pad">${projList.length ? `<div class="dash-list">${projList.map(p => { const dp = dossierPct(p); return `
    <div class="dash-row clickable" data-goto="#/projekt/${p.id}" data-ctx="projekt" data-pid="${p.id}">
      <i class="cal-dot ${projColor(projekte.indexOf(p), p)}"></i>
      <span class="dr-main">${esc(p.name)}<div class="dr-sub">${esc(p.ort || '')} · <a href="#/projekt/${p.id}/dossier" onclick="event.stopPropagation()">Unterlagen <span style="color:var(--${docCls(dp)});font-weight:600">${dp}%</span></a></div></span>
      ${phaseBadge(dominantPhase(p))}
      <span class="dash-muted" style="font-size:12px;min-width:32px;text-align:right" title="Bau-Fortschritt">${projektFortschritt(p)}%</span>
    </div>`; }).join('')}</div>` : emptyState('▤', 'Noch keine Projekte.')}</div>`;

  render(`
    <div class="page-head"><div><h1>Dashboard</h1><div class="sub">Überblick · Fristen, Termine &amp; Pendenzen aller Projekte</div></div><button class="btn" data-act="new-projekt">+ Neues Projekt</button></div>
    <div class="kpi-row">${kpis}</div>
    <div class="two-col">
      <div>${fristPanel}${terminePanel}</div>
      <div>${pendPanel}${projPanel}</div>
    </div>
  `);
  $$('.pend-check').forEach(cb => cb.addEventListener('change', () => togglePendenz(cb.dataset.pid, cb.dataset.prid, cb.dataset.tid, cb.dataset.itemid)));
}

function projektCard(p) {
  const pct = projektFortschritt(p);
  const total = (p.vergaben || []).length;
  const vergeben = projektVergebenAnzahl(p);
  const frist = naechsteFrist(p);
  return `
    <div class="proj-card" data-goto="#/projekt/${p.id}" data-ctx="projekt" data-pid="${p.id}">
      <div class="pc-top">
        <div>
          <div class="pc-title">${esc(p.name)}</div>
          <div class="pc-meta">📍 ${esc(p.ort)} · ${esc(p.bauherr)}</div>
        </div>
        ${phaseBadge(dominantPhase(p))}
      </div>
      <div class="pc-bars">
        <div class="progress-wrap">
          <div class="progress-label"><span>Fortschritt</span><b>${pct}%</b></div>
          ${progressBar(pct)}
        </div>
      </div>
      <div class="pc-stats">
        <div class="pc-stat"><span class="v">${vergeben}/${total}</span><span class="l">Zuschlag</span></div>
        <div class="pc-stat"><span class="v">${chfShort(projektVolumen(p))}</span><span class="l">Volumen</span></div>
        <div class="pc-stat"><span class="v">${frist ? fmtDate(frist).slice(0, 6) + '…' : '–'}</span><span class="l">nächste Frist</span></div>
      </div>
    </div>`;
}

/* ---------------------------------------------------------------
   9) View: Projektliste
   --------------------------------------------------------------- */

let projektFilter = { q: '', phase: '' };

function viewProjekte() {
  let list = sichtbareProjekte();
  if (projektFilter.phase) list = list.filter(p => dominantPhase(p) === projektFilter.phase);
  if (projektFilter.q) {
    const q = projektFilter.q.toLowerCase();
    list = list.filter(p => (p.name + p.ort + p.bauherr).toLowerCase().includes(q));
  }

  const html = `
    <div class="page-head">
      <div><h1>Projekte</h1><div class="sub">${sichtbareProjekte().length} Projekte</div></div>
      <button class="btn" data-act="new-projekt">+ Neues Projekt</button>
    </div>

    <div class="toolbar">
      <input class="input search" id="projSearch" placeholder="Projekt, Ort oder Bauherr suchen…" value="${esc(projektFilter.q)}">
      <div class="chips" id="phaseChips">
        <span class="chip ${!projektFilter.phase ? 'active' : ''}" data-phase="">Alle</span>
        ${PHASEN.map(p => `<span class="chip ${projektFilter.phase === p.key ? 'active' : ''}" data-phase="${p.key}">${esc(p.label)}</span>`).join('')}
      </div>
    </div>

    ${list.length ? `<div class="proj-grid">${list.map(projektCard).join('')}</div>`
                  : emptyState('🔍', 'Keine Projekte gefunden.')}
  `;
  render(html);

  const s = $('#projSearch');
  s.addEventListener('input', e => { projektFilter.q = e.target.value; viewProjekte(); });
  // Cursor ans Ende setzen
  s.focus(); s.setSelectionRange(s.value.length, s.value.length);
  $$('#phaseChips .chip').forEach(c => c.addEventListener('click', () => {
    projektFilter.phase = c.dataset.phase; viewProjekte();
  }));
}

/* ---------------------------------------------------------------
   10) View: Projekt-Detail
   --------------------------------------------------------------- */

function viewProjektDetail(id) {
  const p = findProjekt(id);
  if (!p) { render(emptyState('⚠', 'Projekt nicht gefunden.')); return; }

  const pct = projektFortschritt(p);
  const vergaben = (p.vergaben || []).slice().sort((a, b) => (a.bkp || '').localeCompare(b.bkp || ''));

  const html = `
    <div class="breadcrumb"><a href="#/projekte">Projekte</a> › ${esc(p.name)}</div>
    <div class="detail-head">
      <div>
        <h1 style="margin:0;font-size:23px">${esc(p.name)}</h1>
        <div class="sub" style="margin-top:5px">📍 ${esc(p.ort)} · Bauherr: ${esc(p.bauherr)} · Projektleitung: ${esc(p.projektleiter)}</div>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        ${phaseBadge(dominantPhase(p))}
        ${istInhaber(p) ? `<button class="btn secondary" data-act="team" data-pid="${p.id}" title="Mitglieder &amp; Rollen">👥 Team</button>` : ''}
        ${darfStammdaten(p) ? `<button class="btn secondary" data-act="edit-projekt" data-pid="${p.id}" title="Projekt &amp; Gebäudedaten bearbeiten">✎ Bearbeiten</button>` : ''}
        ${darfVergeben(p) ? `<button class="btn" data-act="new-vergabe" data-pid="${p.id}">+ Arbeitsbeschrieb</button>` : ''}
      </div>
    </div>

    ${projektTabs(p, 'overview')}

    ${phasenBar(p)}

    <!-- Kennzahlen -->
    <div class="detail-stats">
      <div class="dstat"><div class="l">Fortschritt</div><div class="v">${pct}%</div>${progressBar(pct)}</div>
      <div class="dstat"><div class="l">Zuschlag erteilt</div><div class="v">${projektVergebenAnzahl(p)} / ${vergaben.length}</div></div>
      <div class="dstat"><div class="l">Volumen (Kosten)</div><div class="v">${chf(projektVolumen(p))}</div></div>
      ${p.wohnungen ? `<div class="dstat"><div class="l">Wohnungen</div><div class="v">${p.wohnungen}</div></div>` : ''}
      ${p.geschosse ? `<div class="dstat"><div class="l">Geschosse</div><div class="v">${p.geschosse}</div></div>` : ''}
      ${p.flaeche ? `<div class="dstat"><div class="l">Fläche</div><div class="v">${p.flaeche.toLocaleString('de-CH')} m²</div></div>` : ''}
      ${p.volumen ? `<div class="dstat"><div class="l">Volumen</div><div class="v">${p.volumen.toLocaleString('de-CH')} m³</div></div>` : ''}
      <div class="dstat"><div class="l">Termin</div><div class="v" style="font-size:15px">${fmtDate(p.start)} – ${fmtDate(p.ende)}</div></div>
    </div>

    ${projektNextStepsCard(p)}

    <!-- Vergaben-Tabelle -->
    <div class="section-head"><h2>Vergaben &amp; Gewerke</h2><div style="display:flex;gap:10px;align-items:center"><span class="hint">Klick = aufklappen mit nächsten Schritten</span>${katToggleBtn()}</div></div>
    <div class="card">
      ${vergaben.length || katOpen ? `
      <table class="grid">
        <thead>
          <tr><th>BKP</th><th>Gewerk</th><th>Unternehmer</th><th>Status</th><th>Fortschritt</th><th class="num">Betrag</th><th>Frist</th></tr>
        </thead>
        <tbody>
          ${vergaben.map(v => `
            <tr class="clickable gw-row${gwOpen.has(v.id) ? ' open' : ''}" data-act="gw-toggle" data-ctx="vergabe" data-pid="${p.id}" data-vid="${v.id}">
              <td><span class="gw-chev">${gwOpen.has(v.id) ? '▾' : '▸'}</span> <span class="bkp-code">${esc(v.bkp)}</span></td>
              <td><strong>${esc(v.gewerk)}</strong></td>
              <td>${v.firma ? `<div class="row-firma">${esc(v.firma)}</div>` : '<span class="muted">noch offen</span>'}</td>
              <td>${statusPill(v)}${vergabeMarken(v) ? `<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${vergabeMarken(v)}</div>` : ''}</td>
              <td>${miniPipe(v)}</td>
              <td class="num">${isVergeben(v) ? chf(v.betrag) : `<span class="muted">~${chfShort(v.schaetzung)}</span>`}</td>
              <td class="frist ${fristClass(v.frist, isDone(v))}">${fristText(v.frist, isDone(v))}</td>
            </tr>${gwOpen.has(v.id) ? `<tr class="gw-detail-row"><td colspan="7">${gewerkPanel(p, v)}</td></tr>` : ''}`).join('')}
          ${bkpGhostRows(p, 7)}
        </tbody>
      </table>` : emptyState('▤', 'Noch keine Vergaben angelegt.')}
    </div>
  `;
  render(html);
}

/* ---------------------------------------------------------------
   10a) View: Kosten / Baukostenübersicht
   --------------------------------------------------------------- */

function viewKosten(id) {
  const p = findProjekt(id);
  if (!p) { render(emptyState('⚠', 'Projekt nicht gefunden.')); return; }
  const vs = (p.vergaben || []).slice().sort((a, b) => (a.bkp || '').localeCompare(b.bkp || ''));

  const head = `
    <div class="breadcrumb"><a href="#/projekte">Projekte</a> › ${esc(p.name)}</div>
    <div class="detail-head">
      <div><h1 style="margin:0;font-size:23px">${esc(p.name)}</h1><div class="sub" style="margin-top:5px">Baukostenübersicht nach BKP · Stand ${fmtDate(todayIso())}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn secondary" data-act="pdf-kostenschaetzung" data-pid="${p.id}">⬇ Kostenschätzung</button>
        <button class="btn secondary" data-act="pdf-baukosten" data-pid="${p.id}">⬇ Baukostenübersicht</button>
        ${katToggleBtn()}
        <button class="btn" data-act="new-vergabe" data-pid="${p.id}">+ Arbeitsbeschrieb</button>
      </div>
    </div>
    ${projektTabs(p, 'kosten')}
  `;
  if (!vs.length) { render(head + emptyState('◫', 'Noch keine Arbeitsbeschriebe / Kostenschätzungen. Mit „+ Arbeitsbeschrieb" erfassen.') + `<div style="text-align:center;margin-top:-10px"><button class="btn" data-act="new-vergabe" data-pid="${p.id}">+ Arbeitsbeschrieb erfassen</button></div>`); return; }

  const groups = {};
  vs.forEach(v => { const g = String(v.bkp || '0').trim()[0] || '0'; (groups[g] = groups[g] || []).push(v); });
  const gKeys = Object.keys(groups).sort();

  const blank = () => ({ kv: 0, rev: 0, wv: 0, nt: 0, prognose: 0, bezahlt: 0, offen: 0 });
  const add = (acc, z) => { acc.kv += z.kv; acc.rev += (z.rev || 0); acc.wv += z.wv; acc.nt += z.nt; acc.prognose += z.prognose; acc.bezahlt += z.bezahlt; acc.offen += z.offen; };
  const dCls = d => d > 0.5 ? 'over' : (d < -0.5 ? 'under' : '');
  const tot = blank();

  let body = '';
  gKeys.forEach(g => {
    const sub = blank();
    let rows = '';
    groups[g].forEach(v => {
      const z = kostenZeile(v); add(sub, z); add(tot, z);
      const d = z.prognose - z.kv;
      const hatBt = (p.bauteile || []).length;
      const btSel = hatBt ? `<div style="margin-top:3px"><select class="bt-gw" data-pid="${p.id}" data-vid="${v.id}" onclick="event.stopPropagation()" title="Teilprojekt" style="font-size:11px;padding:1px 5px;border:1px solid var(--border);border-radius:4px;max-width:200px">${bauteilOptionsHtml(p, v.bauteil)}</select></div>` : '';
      rows += `<tr class="clickable" data-goto="#/projekt/${p.id}/vergabe/${v.id}" data-ctx="vergabe" data-pid="${p.id}" data-vid="${v.id}">
        <td class="bkp-code">${esc(v.bkp)}</td>
        <td><strong>${esc(v.gewerk)}</strong>${btSel}</td>
        <td>${v.firma ? esc(v.firma) : '<span class="muted">nicht vergeben</span>'}</td>
        <td class="num">${money(z.kv)}</td>
        <td class="num">${z.rev != null ? money(z.rev) : '–'}</td>
        <td class="num">${z.vergeben ? money(z.wv) : '–'}</td>
        <td class="num">${z.nt ? money(z.nt) : '–'}</td>
        <td class="num"><strong>${money(z.prognose)}</strong></td>
        <td class="num">${money(z.bezahlt)}</td>
        <td class="num">${z.offen ? money(z.offen) : '–'}</td>
        <td class="num ${dCls(d)}">${d ? money(d) : '–'}</td>
      </tr>`;
      rows += (v.nachtraege || []).map(n => { const nc = n.status === 'genehmigt' ? 'green' : (n.status === 'abgelehnt' ? 'grey' : 'amber'); return `<tr class="rg-sub">
        <td></td>
        <td colspan="5"><span class="muted">↳ Nachtrag${n.nr ? ' ' + esc(n.nr) : ''}:</span> ${esc(n.titel || '')} <span class="st ${nc}" style="font-size:9px;padding:1px 6px">${esc(n.status || 'offen')}</span>${hatBt ? ` · <select class="bt-nt" data-pid="${p.id}" data-vid="${v.id}" data-nid="${n.id}" title="Teilprojekt des Nachtrags" style="font-size:10px;padding:0 3px;border:1px solid var(--border);border-radius:4px">${bauteilOptionsHtml(p, n.bauteil)}</select>` : ''}</td>
        <td class="num">${money(n.betrag)}</td>
        <td colspan="4"></td>
      </tr>`; }).join('');
      rows += (v.rechnungen || []).slice().sort((a, b) => (a.datum || '').localeCompare(b.datum || '')).map(r => `<tr class="rg-sub">
        <td></td>
        <td colspan="6"><span class="muted">↳ ${r.datum ? fmtDate(r.datum) : '—'}</span> ${esc(r.text || (r.art === 'gutschrift' ? 'Gutschrift' : 'Rechnung'))}${r.nr ? ` <span class="muted">${esc(r.nr)}</span>` : ''} · ${money(rgSigned(r))}${hatBt ? ` · <select class="bt-rg" data-pid="${p.id}" data-vid="${v.id}" data-rgid="${r.id}" title="Teilprojekt der Rechnung" style="font-size:10px;padding:0 3px;border:1px solid var(--border);border-radius:4px">${bauteilOptionsHtml(p, r.bauteil !== undefined ? r.bauteil : v.bauteil)}</select>` : ''}</td>
        <td></td>
        <td class="num">${r.bezahlt ? money(rgAuszahlung(r)) : '<span class="muted" style="font-size:10px">offen</span>'}</td>
        <td></td><td></td>
      </tr>`).join('');
    });
    const dSub = sub.prognose - sub.kv;
    body += `<tr class="kgroup"><td>${esc(g)}</td><td colspan="10">${esc(BKP_GRUPPEN[g] || 'Übrige')}</td></tr>
      ${rows}
      ${bkpGhostRows(p, 11, g)}
      <tr class="ksub">
        <td></td><td colspan="2">Zwischentotal</td>
        <td class="num">${money(sub.kv)}</td><td class="num">${money(sub.rev)}</td><td class="num">${money(sub.wv)}</td>
        <td class="num">${money(sub.nt)}</td><td class="num">${money(sub.prognose)}</td><td class="num">${money(sub.bezahlt)}</td>
        <td class="num">${money(sub.offen)}</td><td class="num ${dCls(dSub)}">${money(dSub)}</td>
      </tr>`;
  });
  const dTot = tot.prognose - tot.kv;

  const kpi = (l, v, cls) => `<div class="kpi"><div class="k-label">${l}</div><div class="k-value" style="font-size:21px${cls ? ';color:var(--' + cls + ')' : ''}">${v}</div></div>`;

  render(head + `
    <div class="kpi-row">
      ${kpi('Kostenschätzung (KV)', money(tot.kv))}
      ${kpi('Abrechnungsprognose', money(tot.prognose))}
      ${kpi('Bezahlt', money(tot.bezahlt))}
      ${kpi('Offen', money(tot.offen))}
      ${p.volumen ? kpi('Prognose / m³ (GV)', 'CHF ' + money(tot.prognose / p.volumen)) : ''}
      ${p.flaeche ? kpi('Prognose / m² (BGF)', 'CHF ' + money(tot.prognose / p.flaeche)) : ''}
    </div>
    ${(p.volumen || p.flaeche) ? `<p class="muted" style="font-size:12px;margin:-6px 0 14px">Kubische Kennzahlen für die Kostenschätzungs-Gegenüberstellung${p.volumen ? ` · GV ${p.volumen.toLocaleString('de-CH')} m³` : ''}${p.flaeche ? ` · BGF ${p.flaeche.toLocaleString('de-CH')} m²` : ''}. Gebäudedaten unter „Übersicht → ✎ Bearbeiten".</p>` : ''}
    <div class="card" style="overflow-x:auto">
      <table class="grid ktable">
        <thead><tr>
          <th>BKP</th><th>Arbeitsgattung</th><th>Unternehmer</th>
          <th class="num">KV</th><th class="num">KV rev.</th><th class="num">WV</th>
          <th class="num">Nachträge</th><th class="num">Prognose</th><th class="num">Bezahlt</th><th class="num">Offen</th><th class="num">Δ KV</th>
        </tr></thead>
        <tbody>
          ${body}
          <tr class="ktotal">
            <td></td><td colspan="2">Total Baukosten</td>
            <td class="num">${money(tot.kv)}</td><td class="num">${money(tot.rev)}</td><td class="num">${money(tot.wv)}</td>
            <td class="num">${money(tot.nt)}</td><td class="num">${money(tot.prognose)}</td><td class="num">${money(tot.bezahlt)}</td>
            <td class="num">${money(tot.offen)}</td><td class="num ${dCls(dTot)}">${money(dTot)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    ${optionenCard(p, tot.kv, tot.prognose)}
    ${teilprojektCard(p, tot.prognose)}
    <p class="muted" style="font-size:12.5px;margin-top:10px">KV = Grobkostenschätzung · KV rev. = günstigste Offerte · WV = Werkvertrag/Vergabesumme · Prognose = WV + Nachträge + Rapporte (Budget steckt im WV) · Δ KV = Prognose gegen Schätzung (rot = Überschreitung). Unter jedem Gewerk: Nachträge (mit Status) &amp; Rechnungen; Teilprojekt-Dropdown je Gewerk/Nachtrag. Zeile anklicken → Gewerk-Detail.</p>
  `);
}

/* ---------------------------------------------------------------
   10b) View: Termine / Gantt
   --------------------------------------------------------------- */

let ganttZoom = 'monat';   // 'monat' | 'woche' | 'tag'
let ganttScale = 1;        // stufenloser Breiten-Faktor auf pxPerDay
let ganttChain = true;     // Verkettung: Nachfolger automatisch nachführen
let ganttWorkdays = false; // Abstände/Verkettung in Arbeitstagen (Wochenende/Feiertage überspringen)
let ganttSide = { gewerk: true, firma: false, person: false, natel: false }; // einblendbare Info-Spalte (BKP-Nr. immer)
let ganttPendingScroll = null;  // {left, y} – nach In-Place-Rerender wiederherstellen
// Gantt neu zeichnen ohne Scroll-Sprung (Seite + horizontaler Scroll bleiben)
function rerenderGantt(pid) {
  const gm = document.querySelector('.g-main');
  ganttPendingScroll = { left: gm ? gm.scrollLeft : 0, y: window.scrollY };
  viewTermine(pid);
}
let ganttSort = 'bkp';     // 'bkp' | 'start'
const ZOOM = { monat: { px: 2.4, label: 'Monate' }, woche: { px: 4.6, label: 'Wochen' }, tag: { px: 13, label: 'Tage' } };
// Gantt-Balkenfarbe je Status (über den Lebenszyklus differenziert)
const GANTT_PHASE = {
  ausschreibung: 'rot', versendet: 'orange', offerten: 'orange', angebot_vers: 'orange', angebot_erh: 'orange',
  bewertung: 'gelb', verhandlung: 'gelb', vergeben: 'gelb', werkvertrag: 'gruen', unterzeichnet: 'gruen',
  ausfuehrung: 'blau', schlussrechnung: 'violett', maengel: 'dgrau', abgeschlossen: 'hgrau',
};
const GANTT_COLS = { rot: '#dc2626', orange: '#f97316', gelb: '#eab308', gruen: '#16a34a', blau: '#1f6feb', violett: '#7c3aed', dgrau: '#475569', hgrau: '#cbd5e1' };
const GANTT_LEGEND = [['rot', 'angefragt'], ['orange', 'Offerte / Abgebot'], ['gelb', 'bis Vergabe'], ['gruen', 'Werkvertrag'], ['blau', 'Ausführung'], ['violett', 'Schlussrechnung'], ['dgrau', 'Mängel'], ['hgrau', 'abgeschlossen']];
function ganttColKey(v) { return GANTT_PHASE[v.status] || 'dgrau'; }
function ganttColHex(v) { return GANTT_COLS[ganttColKey(v)]; }
let ganttCtx = null;       // { rangeStartISO, pxPerDay } – für Drag
let ganttPid = null;       // aktuelles Projekt im Gantt (für Verbindungen)

function viewTermine(id) {
  const p = findProjekt(id);
  if (!p) { render(emptyState('⚠', 'Projekt nicht gefunden.')); return; }

  ganttPid = p.id;
  // ALLE Vergaben (auch ohne Termin), sortiert nach BKP/Gewerk ODER nach Baustart
  const vs = (p.vergaben || []).slice().sort((a, b) => ganttSort === 'start'
    ? ((a.bauStart || '9999-99-99').localeCompare(b.bauStart || '9999-99-99') || (a.bkp || '').localeCompare(b.bkp || ''))
    : ((a.bkp || '').localeCompare(b.bkp || '') || (a.gewerk || '').localeCompare(b.gewerk || '')));
  const offene = vs.filter(v => !(v.bauStart && v.bauEnde));

  const sortCtrl = `<div class="g-zoom" title="Sortierung"><button class="${ganttSort === 'bkp' ? 'active' : ''}" data-act="gantt-sort" data-pid="${p.id}" data-kind="bkp">BKP</button><button class="${ganttSort === 'start' ? 'active' : ''}" data-act="gantt-sort" data-pid="${p.id}" data-kind="start">Start</button></div>`;
  const infoCtrl = `<div class="g-zoom" title="Info-Spalte einblenden (BKP-Nr. immer sichtbar)">${[['gewerk', 'Gewerk'], ['firma', 'Firma'], ['person', 'Person'], ['natel', 'Natel']].map(([key, lbl]) => `<button class="${ganttSide[key] ? 'active' : ''}" data-act="gantt-side" data-pid="${p.id}" data-kind="${key}">${lbl}</button>`).join('')}</div>`;
  const zoomCtrl = `<div class="g-zoom">
    ${Object.keys(ZOOM).map(z => `<button class="${ganttZoom === z ? 'active' : ''}" data-act="gantt-zoom" data-pid="${p.id}" data-kind="${z}">${ZOOM[z].label}</button>`).join('')}
  </div>`;
  const scaleCtrl = `<div class="g-zoom" title="Breite feinjustieren">
    <button data-act="gantt-scale" data-pid="${p.id}" data-kind="out" title="schmaler">−</button>
    <button data-act="gantt-scale" data-pid="${p.id}" data-kind="reset" title="Standardbreite" style="min-width:42px">${Math.round(ganttScale * 100)}%</button>
    <button data-act="gantt-scale" data-pid="${p.id}" data-kind="in" title="breiter">+</button>
  </div>`;

  const head = `
    <div class="breadcrumb"><a href="#/projekte">Projekte</a> › ${esc(p.name)}</div>
    <div class="detail-head">
      <div><h1 style="margin:0;font-size:23px">${esc(p.name)}</h1><div class="sub" style="margin-top:5px">Terminprogramm · grob (Monat) bis fein (Tag); Balken ziehen zum Verschieben, Ränder ziehen für Dauer</div></div>
      ${offene.length ? `<span class="tag">${offene.length} ohne Termin</span>` : ''}
    </div>
    ${projektTabs(p, 'termine')}
    <div class="g-toolbar">
      <span class="muted" style="font-size:12px">Sortieren</span>${sortCtrl}<span class="muted" style="font-size:12px">Info</span>${infoCtrl}${zoomCtrl}${scaleCtrl}
      <button class="btn sm secondary" data-act="bauablauf" data-pid="${p.id}" title="Gewerke nach BKP verketten und ab Baustart datieren">⚙ Bauablauf</button>
      <button class="btn sm ${ganttChain ? '' : 'secondary'}" data-act="gantt-chain" data-pid="${p.id}" title="Wenn an: verkettete Nachfolger folgen automatisch beim Verschieben">🔗 Verkettung ${ganttChain ? 'an' : 'aus'}</button>
      <button class="btn sm ${ganttWorkdays ? '' : 'secondary'}" data-act="gantt-workdays" data-pid="${p.id}" title="Abstände in Arbeitstagen (Wochenende + Feiertage überspringen)">Arbeitstage ${ganttWorkdays ? 'an' : 'aus'}</button>
      <button class="btn sm secondary" data-act="pdf-gantt" data-pid="${p.id}" style="margin-left:auto">⬇ Drucken / PDF</button>
    </div>
  `;

  if (!vs.length) {
    render(head + emptyState('🗓', 'Noch keine Vergaben angelegt. Lege im Tab „Übersicht" Vergaben an.'));
    return;
  }

  // Zeitspanne aus vorhandenen Terminen; Fallback auf Projektdaten / 12 Monate
  const allDates = [];
  vs.forEach(v => {
    if (v.bauStart) allDates.push(v.bauStart);
    if (v.bauEnde) allDates.push(v.bauEnde);
    if (v.bauStart && Number(v.bestellfrist) > 0) { const d = dISO(v.bauStart); d.setDate(d.getDate() - Number(v.bestellfrist)); allDates.push(isoOf(d)); }
    (v.vorgaenge || []).forEach(o => { if (o.start) allDates.push(o.start); if (o.ende) allDates.push(o.ende); });
  });
  if (p.start) allDates.push(p.start);
  if (p.ende) allDates.push(p.ende);
  if (p.baustart) allDates.push(p.baustart);
  if (p.bezug) allDates.push(p.bezug);

  let minS, maxS;
  if (allDates.length) {
    minS = allDates.reduce((a, b) => a < b ? a : b);
    maxS = allDates.reduce((a, b) => a > b ? a : b);
  } else {
    minS = p.start || todayIso();
    const d = dISO(minS); maxS = `${d.getFullYear() + 1}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }
  const min = dISO(minS), max = dISO(maxS);
  const rangeStart = new Date(min.getFullYear(), min.getMonth(), 1);
  let rangeEnd = new Date(max.getFullYear(), max.getMonth() + 1, 0);
  const minEnd = new Date(rangeStart.getFullYear(), rangeStart.getMonth() + 4, 0);
  if (rangeEnd < minEnd) rangeEnd = minEnd;
  const rangeStartISO = isoOf(rangeStart);
  const totalDays = dayDiff(rangeStart, rangeEnd) + 1;

  const pxPerDay = ZOOM[ganttZoom].px * ganttScale;
  const innerW = Math.round(totalDays * pxPerDay);
  ganttCtx = { rangeStartISO, pxPerDay };

  const leftPx = iso => Math.round(dayDiffISO(rangeStartISO, iso) * pxPerDay);
  const widthPx = (s, e) => Math.max(Math.round((dayDiffISO(s, e) + 1) * pxPerDay), 3);

  // --- Kopfzeile: oben Monate, optional darunter Wochen/Tage ---
  const months = [];
  let cur = new Date(rangeStart);
  while (cur <= rangeEnd) {
    const mEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    months.push({ label: cur.toLocaleDateString('de-CH', { month: 'short' }) + ' ' + String(cur.getFullYear()).slice(2), w: (dayDiff(cur, mEnd) + 1) * pxPerDay });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  const monthCells = months.map(m => `<div class="g-cell" style="width:${m.w}px">${m.label}</div>`).join('');

  // Wochen-Zeile (KW), für Woche- und Tag-Ansicht
  let weekCells = '';
  const buildWeeks = () => {
    let s = '', d = new Date(rangeStart);
    while (d <= rangeEnd) {
      const wEnd = new Date(d); wEnd.setDate(d.getDate() + (7 - ((d.getDay() + 6) % 7)) - 1);
      const segEnd = wEnd > rangeEnd ? rangeEnd : wEnd;
      const w = (dayDiff(d, segEnd) + 1) * pxPerDay;
      s += `<div class="g-cell" style="width:${w}px">${isoWeek(d)}</div>`;
      d = new Date(segEnd); d.setDate(d.getDate() + 1);
    }
    return s;
  };
  // Hintergrund-Gitter (vertikale Rasterlinien) – passend zum Zoom mitgebaut
  const monthBg = months.map(m => `<div class="g-cell" style="width:${m.w}px"></div>`).join('');
  let subCells = '', bgCells = monthBg;
  if (ganttZoom === 'woche') {
    subCells = buildWeeks(); bgCells = '';
    let d = new Date(rangeStart);
    while (d <= rangeEnd) {
      const wEnd = new Date(d); wEnd.setDate(d.getDate() + (7 - ((d.getDay() + 6) % 7)) - 1);
      const segEnd = wEnd > rangeEnd ? rangeEnd : wEnd;
      const w = (dayDiff(d, segEnd) + 1) * pxPerDay;
      bgCells  += `<div class="g-cell" style="width:${w}px"></div>`;
      d = new Date(segEnd); d.setDate(d.getDate() + 1);
    }
  } else if (ganttZoom === 'tag') {
    weekCells = buildWeeks();
    subCells = ''; bgCells = '';
    let d = new Date(rangeStart);
    while (d <= rangeEnd) {
      const dow = (d.getDay() + 6) % 7;                       // 0 = Mo … 6 = So
      const we = dow >= 5, mon = dow === 0;
      // Adaptiv: bei viel Platz jeder Tag, sonst nur Mo+Fr, ganz schmal nur Mo
      let lbl = '';
      if (pxPerDay >= 11) lbl = d.getDate();
      else if (pxPerDay >= 5) { if (dow === 0 || dow === 4) lbl = d.getDate(); }
      else if (pxPerDay >= 2.2) { if (mon) lbl = d.getDate(); }
      subCells += `<div class="g-cell day${we ? ' we' : ''}${mon ? ' mon' : ''}" style="width:${pxPerDay}px">${lbl}</div>`;
      bgCells  += `<div class="g-cell day${we ? ' we' : ''}${mon ? ' mon' : ''}" style="width:${pxPerDay}px"></div>`;
      d.setDate(d.getDate() + 1);
    }
  }
  const headH = ganttZoom === 'tag' ? 74 : (subCells ? 56 : 38);

  const t = today();
  const todayLeft = (t >= rangeStart && t <= rangeEnd) ? dayDiff(rangeStart, t) * pxPerDay : null;

  // Feiertage als Bänder mit Label (Woche: mit Datum). Label nur, wenn genug Abstand → keine Überlappung
  const holLabel = f => ganttZoom === 'woche' ? `${f.n} ${f.d.getDate()}.${f.d.getMonth() + 1}.` : f.n;
  let lastHolLblX = -Infinity;
  const holBands = feiertageInRange(rangeStart, rangeEnd).map(f => {
    const x = dayDiff(rangeStart, f.d) * pxPerDay;
    const showLbl = x - lastHolLblX >= 11;
    if (showLbl) lastHolLblX = x;
    return `<div class="g-holiday" style="left:${x}px;width:${Math.max(pxPerDay, 2)}px" title="${esc(f.n)} ${fmtDate(isoOf(f.d))}">${showLbl ? `<span>${esc(holLabel(f))}</span>` : ''}</div>`;
  }).join('');

  // Projekt-Meilensteine: Baustart & Bezugstermin
  const projMarks = [];
  if (p.baustart) projMarks.push({ iso: p.baustart, n: 'Baustart', cls: 'start' });
  if (p.bezug) projMarks.push({ iso: p.bezug, n: 'Bezug', cls: 'bezug' });
  const markBands = projMarks.filter(m => { const d = dISO(m.iso); return d >= rangeStart && d <= rangeEnd; }).map(m =>
    `<div class="g-mark ${m.cls}" style="left:${dayDiff(rangeStart, dISO(m.iso)) * pxPerDay}px" title="${m.n}: ${fmtDate(m.iso)}"><span>${m.n} ${fmtDate(m.iso)}</span></div>`).join('');

  // Warnung: gleiche Firma in überlappenden Gewerken (Ressourcenkonflikt)
  const firmaMap = {};
  vs.filter(v => v.firma && v.bauStart && v.bauEnde).forEach(v => { (firmaMap[v.firma] = firmaMap[v.firma] || []).push(v); });
  const conflicts = [];
  Object.keys(firmaMap).forEach(firma => {
    const list = firmaMap[firma].slice().sort((a, b) => a.bauStart < b.bauStart ? -1 : 1);
    for (let i = 1; i < list.length; i++) if (list[i].bauStart <= list[i - 1].bauEnde) conflicts.push(`<b>${esc(firma)}</b>: „${esc(list[i - 1].gewerk)}" ↔ „${esc(list[i].gewerk)}"`);
  });
  const warnBanner = conflicts.length ? `<div class="g-warn">⚠ Überschneidung – gleiche Firma gleichzeitig: ${conflicts.join(' · ')}</div>` : '';

  const ROW_H = 38;
  const kontaktByFirma = f => (state.kontakte || []).find(k => k.firma === f);
  let sideRows = '', barRows = '', rowIdx = 0; const barMeta = {};
  vs.forEach(v => {
    const colKey = ganttColKey(v), colHex = ganttColHex(v), light = colKey === 'hgrau' ? ' g-light' : '';
    const hatTermin = v.bauStart && v.bauEnde;
    const k = (ganttSide.person || ganttSide.natel) && v.firma ? kontaktByFirma(v.firma) : null;
    const extra = [];
    if (ganttSide.firma && v.firma) extra.push(`<span class="g-si firma">${esc(v.firma)}</span>`);
    if (ganttSide.person && k && k.person) extra.push(`<span class="g-si">${esc(k.person)}</span>`);
    if (ganttSide.natel && k && k.telefon) extra.push(`<span class="g-si">☎ ${esc(k.telefon)}</span>`);
    sideRows += `<div class="g-side-row${hatTermin ? '' : ' offen'}">
      <span class="g-edit" data-act="edit-termin" data-ctx="vergabe" data-pid="${p.id}" data-vid="${v.id}" title="${esc((v.bkp ? v.bkp + ' ' : '') + v.gewerk)} – Termine bearbeiten (Rechtsklick: Menü)">
        <span class="bkp-code">${esc(v.bkp)}</span>${ganttSide.gewerk ? ` <span class="gewerk">${esc(v.gewerk)}</span>` : ''}${extra.length ? `<span class="g-si-wrap">${extra.join('<span class="g-si-sep">·</span>')}</span>` : ''}
      </span>
      ${hatTermin ? `<button class="btn sm ghost add-vg" title="Vorgang hinzufügen" data-act="new-vorgang" data-pid="${p.id}" data-vid="${v.id}">＋</button>` : ''}
    </div>`;
    if (hatTermin) {
      barMeta[v.id] = { row: rowIdx, left: leftPx(v.bauStart), width: widthPx(v.bauStart, v.bauEnde) };
      let bestellBar = '';
      if (Number(v.bestellfrist) > 0) {
        const d = dISO(v.bauStart); d.setDate(d.getDate() - Number(v.bestellfrist)); const bsISO = isoOf(d);
        const bl = leftPx(bsISO), bw = Math.max(leftPx(v.bauStart) - bl, 3);
        bestellBar = `<div class="g-bestell" data-pid="${p.id}" data-vid="${v.id}" data-ctx="gantt" data-right="${leftPx(v.bauStart)}" style="left:${bl}px;width:${bw}px" title="Bestellfrist ${v.bestellfrist} Tage – bestellen bis ${fmtDate(bsISO)}, Einbau ab ${fmtDate(v.bauStart)} · ziehen = Vorlauf ändern · Klick = bearbeiten · Rechtsklick = Menü"><span>🛒 ${v.bestellfrist}T</span></div>`;
      }
      barRows += `<div class="g-row">${bestellBar}<div class="g-bar${light}" style="left:${leftPx(v.bauStart)}px;width:${widthPx(v.bauStart, v.bauEnde)}px;background:${colHex}"
        title="${esc(v.gewerk)}: ${fmtDate(v.bauStart)} – ${fmtDate(v.bauEnde)} · ${STATUS_BY_KEY[v.status]?.label || ''}"
        data-pid="${p.id}" data-vid="${v.id}" data-key="${v.id}" data-ctx="gantt" data-start="${v.bauStart}" data-ende="${v.bauEnde}">
        <span class="g-h l"></span><span class="g-lbl">${esc(v.gewerk)}</span><span class="g-h r"></span><span class="g-link-dot" data-key="${v.id}" title="Verbindung ziehen"></span></div></div>`;
    } else {
      barRows += `<div class="g-row"><button class="g-set" data-act="edit-termin" data-pid="${p.id}" data-vid="${v.id}">＋ Termin setzen</button></div>`;
    }
    rowIdx++;
    (v.vorgaenge || []).filter(o => o.start && o.ende).forEach(o => {
      const key = v.id + '/' + o.id;
      barMeta[key] = { row: rowIdx, left: leftPx(o.start), width: widthPx(o.start, o.ende) };
      sideRows += `<div class="g-side-row sub"><span class="gewerk" style="font-weight:500">${esc(o.titel)}</span>
        <button class="x-btn" title="Vorgang löschen" data-act="rm-vorgang" data-pid="${p.id}" data-vid="${v.id}" data-oid="${o.id}">×</button></div>`;
      barRows += `<div class="g-row"><div class="g-bar sub${light}" style="left:${leftPx(o.start)}px;width:${widthPx(o.start, o.ende)}px;background:${colHex}"
        title="${esc(o.titel)}: ${fmtDate(o.start)} – ${fmtDate(o.ende)}"
        data-pid="${p.id}" data-vid="${v.id}" data-oid="${o.id}" data-key="${key}" data-ctx="gantt" data-start="${o.start}" data-ende="${o.ende}">
        <span class="g-h l"></span><span class="g-lbl">${esc(o.titel)}</span><span class="g-h r"></span><span class="g-link-dot" data-key="${key}" title="Verbindung ziehen"></span></div></div>`;
      rowIdx++;
    });
  });
  // Verbindungen (Abhängigkeiten) als SVG-Overlay
  const linkPaths = (p.ganttLinks || []).map(lk => {
    const a = barMeta[lk.from], b = barMeta[lk.to]; if (!a || !b) return '';
    const ax = a.left + a.width, ay = a.row * ROW_H + 19, bx = b.left, by = b.row * ROW_H + 19;
    const mx = bx + (lk.dx != null ? lk.dx : -16);
    const d = `M ${ax} ${ay} H ${mx} V ${by} H ${bx}`;
    return `<g class="g-link" data-lid="${lk.id}">
      <path class="g-link-hit" d="${d}"></path>
      <path class="g-link-line" d="${d}"></path>
      <path class="g-link-arrow" d="M ${bx - 7} ${by - 4} L ${bx} ${by} L ${bx - 7} ${by + 4} Z"></path>
      <rect class="g-link-grip" data-lid="${lk.id}" data-ax="${ax}" data-ay="${ay}" data-bx="${bx}" data-by="${by}" x="${mx - 4}" y="${(ay + by) / 2 - 7}" width="8" height="14"></rect>
    </g>`;
  }).join('');
  const linkSvg = `<svg class="g-links" width="${innerW}" height="${rowIdx * ROW_H}">${linkPaths}</svg>`;

  const sideExtras = (ganttSide.firma ? 1 : 0) + (ganttSide.person ? 1 : 0) + (ganttSide.natel ? 1 : 0);
  let sideW = ganttSide.gewerk ? 200 : 66;
  if (sideExtras) sideW = Math.min(480, (ganttSide.gewerk ? 200 : 92) + sideExtras * 96);

  render(head + `
    ${warnBanner}
    <div class="gantt">
      <div class="g-side" style="width:${sideW}px"><div class="g-corner" style="height:${headH}px"></div>${sideRows}</div>
      <div class="g-main"><div class="g-inner" style="width:${innerW}px">
        <div class="g-head" style="height:${headH}px">
          <div class="g-headrow">${monthCells}</div>
          ${weekCells ? `<div class="g-headrow wk">${weekCells}</div>` : ''}
          ${subCells ? `<div class="g-headrow sub">${subCells}</div>` : ''}
        </div>
        <div class="g-rows">
          <div class="g-bg">${bgCells}</div>
          ${holBands}
          ${todayLeft != null ? `<div class="g-today" style="left:${todayLeft}px"></div>` : ''}
          ${markBands}
          ${barRows}
          ${linkSvg}
        </div>
      </div></div>
    </div>
    <div class="g-legend">
      ${GANTT_LEGEND.map(([k, l]) => `<span><i style="background:${GANTT_COLS[k]}"></i>${l}</span>`).join('')}
    </div>
    <p class="muted" style="font-size:12.5px;margin-top:10px">Balken <b>ziehen</b> = verschieben · <b>Ränder</b> = Dauer · vom <b>Punkt am Balkenende</b> auf einen anderen Balken ziehen = <b>Verbindung</b> · Rechtsklick → <b>Nachfolger verketten</b> hängt ein Gewerk direkt an · bei <b>🔗 Verkettung an</b> folgen verkettete Nachfolger automatisch · Knick der Linie <b>seitlich ziehen</b> zum Entzerren · Klick auf die Linie löscht sie · <b>Strg + Mausrad</b> zoomt an der Cursor-Position · mit <b>Info</b> (Gewerk/Firma/Person/Natel) blendest du die Seitenspalte ein – die BKP-Nr. bleibt immer.</p>
    ${bestellListeHtml(p)}
  `);

  $$('.g-bar').forEach(b => b.addEventListener('mousedown', onBarMouseDown));
  $$('.g-bestell').forEach(b => b.addEventListener('mousedown', onBestellDown));
  $$('.g-link-dot').forEach(d => d.addEventListener('mousedown', onLinkDotDown));
  $$('.g-link-grip').forEach(g => g.addEventListener('mousedown', onLinkGripDown));
  $$('.g-link-hit').forEach(h => h.addEventListener('click', e => { const g = e.target.closest('.g-link'); if (g) removeGanttLink(ganttPid, g.dataset.lid); }));
  $$('.g-link').forEach(g => g.addEventListener('contextmenu', e => { e.preventDefault(); linkMenu(e, ganttPid, g.dataset.lid); }));

  // Scroll nach In-Place-Rerender wiederherstellen (kein Sprung beim Resizen/Zoomen)
  if (ganttPendingScroll) {
    const ps = ganttPendingScroll; ganttPendingScroll = null;
    const gm0 = document.querySelector('.g-main'); if (gm0) gm0.scrollLeft = ps.left;
    window.scrollTo(0, ps.y);
  }
  // Cursor-Zoom: Strg + Mausrad zoomt dorthin, wo der Zeiger steht
  const gMain = document.querySelector('.g-main');
  if (gMain) gMain.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const rect = gMain.getBoundingClientRect();
    const viewX = e.clientX - rect.left;
    const dayAtCursor = (gMain.scrollLeft + viewX) / pxPerDay;
    const ns = Math.min(4, Math.max(0.1, +(ganttScale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)).toFixed(3)));
    if (ns === ganttScale) return;
    ganttScale = ns;
    viewTermine(p.id);
    const g2 = document.querySelector('.g-main');
    if (g2) g2.scrollLeft = dayAtCursor * (ZOOM[ganttZoom].px * ganttScale) - viewX;
  }, { passive: false });
}
/* --- Gantt: Verbindungen (Abhängigkeiten) --- */
let ganttLink = null, ganttGrip = null;
function onLinkDotDown(e) {
  if (e.button !== 0) return;
  e.stopPropagation(); e.preventDefault();
  const fromKey = e.currentTarget.dataset.key;
  const rows = e.currentTarget.closest('.g-rows'); const svg = rows.querySelector('.g-links');
  const rect = rows.getBoundingClientRect(); const brect = e.currentTarget.closest('.g-bar').getBoundingClientRect();
  const temp = document.createElementNS('http://www.w3.org/2000/svg', 'path'); temp.setAttribute('class', 'g-link-temp'); svg.appendChild(temp);
  ganttLink = { fromKey, rows, temp, fx: brect.right - rect.left, fy: brect.top - rect.top + brect.height / 2 };
  document.addEventListener('mousemove', onLinkMove); document.addEventListener('mouseup', onLinkUp);
}
function onLinkMove(e) {
  const g = ganttLink; if (!g) return;
  const r = g.rows.getBoundingClientRect();
  g.temp.setAttribute('d', `M ${g.fx} ${g.fy} L ${e.clientX - r.left} ${e.clientY - r.top}`);
}
function onLinkUp(e) {
  const g = ganttLink; ganttLink = null;
  document.removeEventListener('mousemove', onLinkMove); document.removeEventListener('mouseup', onLinkUp);
  if (g.temp) g.temp.remove();
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const bar = el && el.closest ? el.closest('.g-bar') : null;
  const toKey = bar && bar.dataset.key;
  if (toKey && toKey !== g.fromKey) addGanttLink(ganttPid, g.fromKey, toKey);
}
function onLinkGripDown(e) {
  e.stopPropagation(); e.preventDefault();
  const grip = e.currentTarget; const lid = grip.dataset.lid;
  const gEl = grip.closest('.g-link'); const rows = grip.closest('.g-rows'); const rect = rows.getBoundingClientRect();
  const ax = +grip.dataset.ax, ay = +grip.dataset.ay, bx = +grip.dataset.bx, by = +grip.dataset.by;
  ganttGrip = { lid, gEl, rect, ax, ay, bx, by, dx: 0 };
  document.addEventListener('mousemove', onGripMove); document.addEventListener('mouseup', onGripUp);
}
function onGripMove(e) {
  const g = ganttGrip; if (!g) return;
  const mx = Math.round(e.clientX - g.rect.left); g.dx = mx - g.bx;
  const d = `M ${g.ax} ${g.ay} H ${mx} V ${g.by} H ${g.bx}`;
  g.gEl.querySelector('.g-link-hit').setAttribute('d', d);
  g.gEl.querySelector('.g-link-line').setAttribute('d', d);
  g.gEl.querySelector('.g-link-grip').setAttribute('x', mx - 4);
}
function onGripUp() {
  const g = ganttGrip; ganttGrip = null;
  document.removeEventListener('mousemove', onGripMove); document.removeEventListener('mouseup', onGripUp);
  const p = findProjekt(ganttPid); const lk = p && (p.ganttLinks || []).find(l => l.id === g.lid);
  if (lk) { lk.dx = g.dx; save(); }
}
function addGanttLink(pid, from, to) {
  const p = findProjekt(pid); if (!p) return;
  if (!p.ganttLinks) p.ganttLinks = [];
  if (from === to || p.ganttLinks.some(l => l.from === from && l.to === to)) return;
  const fr = ganttBarRef(p, from), tr = ganttBarRef(p, to);
  const lag = (fr && tr) ? dayDiffISO(fr.e, tr.s) : 1;   // aktuellen Abstand merken (keine Verschiebung beim Erstellen)
  p.ganttLinks.push({ id: uid('gl'), from, to, dx: null, lag });
  save(); viewTermine(pid); toast('Verbindung erstellt', 'info');
}
function removeGanttLink(pid, lid) {
  const p = findProjekt(pid); if (!p) return;
  p.ganttLinks = (p.ganttLinks || []).filter(l => l.id !== lid);
  save(); viewTermine(pid); toast('Verbindung entfernt', 'info');
}
/* --- Generisches Kontextmenü (Rechtsklick) --- */
function openContextMenu(e, items) {
  closeContextMenu(); e.preventDefault();
  const menu = document.createElement('div'); menu.className = 'ctx-menu'; menu.id = 'ctxMenu';
  menu.innerHTML = items.map((it, i) => it.sep ? '<div class="ctx-sep"></div>'
    : `<button class="ctx-item${it.danger ? ' danger' : ''}" data-i="${i}"><span class="ctx-ico">${it.icon || ''}</span>${esc(it.label)}</button>`).join('');
  document.body.appendChild(menu);
  let x = e.clientX, y = e.clientY;
  if (x + menu.offsetWidth > window.innerWidth - 6) x = window.innerWidth - menu.offsetWidth - 6;
  if (y + menu.offsetHeight > window.innerHeight - 6) y = window.innerHeight - menu.offsetHeight - 6;
  menu.style.left = Math.max(6, x) + 'px'; menu.style.top = Math.max(6, y) + 'px';
  menu.querySelectorAll('.ctx-item').forEach(btn => btn.addEventListener('click', () => { const it = items[+btn.dataset.i]; closeContextMenu(); if (it && it.act) it.act(); }));
  setTimeout(() => { document.addEventListener('mousedown', ctxAway); document.addEventListener('keydown', ctxEsc); document.addEventListener('scroll', closeContextMenu, true); }, 0);
}
function ctxAway(e) { if (!e.target.closest('#ctxMenu')) closeContextMenu(); }
function ctxEsc(e) { if (e.key === 'Escape') closeContextMenu(); }
function closeContextMenu() { const m = $('#ctxMenu'); if (m) m.remove(); document.removeEventListener('mousedown', ctxAway); document.removeEventListener('keydown', ctxEsc); document.removeEventListener('scroll', closeContextMenu, true); }
// Globales Rechtsklick-System: jedes Element mit data-ctx bekommt sein Menü
function onGlobalContext(e) {
  const el = e.target.closest('[data-ctx]'); if (!el) return;
  const c = el.dataset.ctx;
  if (c === 'vergabe') vergabeMenu(e, el.dataset.pid, el.dataset.vid);
  else if (c === 'gantt') ganttBarMenu(e, el);
  else if (c === 'pendenz') pendenzMenu(e, el.dataset.pid, el.dataset.itemid);
  else if (c === 'projekt') projektMenu(e, el.dataset.pid);
  else if (c === 'protokoll') protokollMenu(e, el.dataset.pid, el.dataset.prid);
  else if (c === 'inv') invMenu(e, el.dataset.pid, el.dataset.vid, el.dataset.eid);
  else if (c === 'termin') terminMenu(e, el.dataset.pid, el.dataset.tid);
  else if (c === 'planblock') planBlockMenu(e, el.dataset.bid);
  else if (c === 'kontakt') kontaktMenu(e, el.dataset.kid);
}
// Menü für ein Gewerk/Vergabe (Übersicht, Kosten, Gantt-Label …)
function vergabeMenu(e, pid, vid, extraTop) {
  const p = findProjekt(pid); const v = p && findVergabe(p, vid); if (!v) return;
  const items = [{ icon: '↗', label: 'Gewerk öffnen', act: () => go('#/projekt/' + pid + '/vergabe/' + vid) }];
  if (extraTop) items.push(...extraTop);
  items.push(
    { icon: '🗓', label: 'Termine / Gantt', act: () => go('#/projekt/' + pid + '/termine') },
  );
  if (v.bauStart && v.bauEnde) items.push({ icon: '🔗', label: 'Nachfolger verketten …', act: () => actLinkSuccessor(pid, vid) });
  items.push(
    { icon: '→', label: 'Status: nächster Schritt', act: () => advanceVergabe(pid, vid) },
    { sep: true },
    { icon: '✉', label: 'Offertanfrage / Einladung senden', act: () => mailEinladung(pid, vid) },
  );
  if (isVergeben(v)) items.push(
    { icon: '✉', label: 'Zuschlag-Mail an ' + (v.firma || 'Gewinner'), act: () => mailZuschlag(pid, vid) },
    { icon: '✉', label: 'Absage an Unterlegene', act: () => mailAbsage(pid, vid) },
  );
  items.push(
    { sep: true },
    { icon: '💰', label: 'Kosten / Rechnungen', act: () => go('#/projekt/' + pid + '/kosten') },
    { icon: '🧾', label: '＋ Rechnung erfassen', act: () => actNewRechnung(pid, vid) },
    { icon: '📐', label: '＋ Nachtrag erfassen', act: () => actNewNachtrag(pid, vid) },
    { sep: true },
    { icon: '✎', label: 'Stammdaten bearbeiten', act: () => actEditVergabe(pid, vid) },
    { icon: '🗑', label: 'Gewerk löschen', danger: true, act: () => rmVergabe(pid, vid) },
  );
  openContextMenu(e, items);
}
// Rechtsklick auf einen Gantt-Balken (Vorgang oder Gewerk)
function ganttBarMenu(e, bar) {
  const pid = bar.dataset.pid, vid = bar.dataset.vid, oid = bar.dataset.oid || null;
  const p = findProjekt(pid); const v = p && findVergabe(p, vid); if (!v) return;
  if (oid) { openContextMenu(e, [{ icon: '↗', label: 'Gewerk öffnen', act: () => go('#/projekt/' + pid + '/vergabe/' + vid) }, { sep: true }, { icon: '🗓', label: 'Termin bearbeiten', act: () => actEditTermin(pid, vid) }, { icon: '✕', label: 'Vorgang löschen', danger: true, act: () => removeVorgang(pid, vid, oid) }]); return; }
  vergabeMenu(e, pid, vid, [{ icon: '🗓', label: 'Termin bearbeiten', act: () => actEditTermin(pid, vid) }, { icon: '＋', label: 'Vorgang hinzufügen', act: () => actNewVorgang(pid, vid) }]);
}
function pendenzMenu(e, pid, itemid) {
  const p = findProjekt(pid); const it = p && (p.pendenzen || []).find(x => x.id === itemid); if (!it) return;
  const items = [
    { icon: it.erledigt ? '↩' : '✓', label: it.erledigt ? 'Wieder offen' : 'Als erledigt markieren', act: () => togglePendenz(pid, '', '', itemid) },
    { icon: '✎', label: 'Bearbeiten', act: () => actPendenz(pid, itemid) },
  ];
  if ((it.firmen || []).length) items.push({ icon: '✉', label: 'Als E-Mail an Firmen', act: () => actPendenzMail(pid, itemid) });
  items.push({ sep: true }, { icon: '🗑', label: 'Löschen', danger: true, act: () => rmPendenz(pid, itemid) });
  openContextMenu(e, items);
}
function projektMenu(e, pid) {
  const p = findProjekt(pid); if (!p) return;
  openContextMenu(e, [
    { icon: '↗', label: 'Projekt öffnen', act: () => go('#/projekt/' + pid) },
    { icon: '🗂', label: 'Dossier', act: () => go('#/projekt/' + pid + '/dossier') },
    { icon: '🗓', label: 'Termine / Gantt', act: () => go('#/projekt/' + pid + '/termine') },
    { icon: '💰', label: 'Kosten', act: () => go('#/projekt/' + pid + '/kosten') },
    { icon: '📋', label: 'Pendenzen', act: () => go('#/projekt/' + pid + '/pendenzen') },
    { sep: true },
    { icon: '＋', label: 'Arbeitsbeschrieb erfassen', act: () => actNewVergabe(pid) },
    { icon: '✎', label: 'Projekt bearbeiten', act: () => actEditProjekt(pid) },
  ]);
}
function protokollMenu(e, pid, prid) {
  const p = findProjekt(pid); const pr = p && findProtokoll(p, prid); if (!pr) return;
  openContextMenu(e, [
    { icon: '↗', label: 'Protokoll öffnen', act: () => go('#/projekt/' + pid + '/protokoll/' + prid) },
    { icon: '⬇', label: 'PDF erzeugen', act: () => pdfProtokoll(pid, prid) },
    { icon: '✉', label: 'An Verteiler senden', act: () => mailProtokoll(pid, prid) },
    { icon: '⧉', label: 'Kopieren (nächste Sitzung)', act: () => actCopyProtokoll(pid, prid) },
    { sep: true },
    { icon: '🗑', label: 'Löschen', danger: true, act: () => delProtokoll(pid, prid) },
  ]);
}
function invMenu(e, pid, vid, eid) {
  const p = findProjekt(pid); const v = p && findVergabe(p, vid); const en = v && (v.eingeladene || []).find(x => x.id === eid); if (!en) return;
  openContextMenu(e, [
    { icon: '✎', label: 'Konditionen erfassen', act: () => actKonditionen(pid, vid, eid) },
    { icon: '📄', label: 'Deckblatt Einladung', act: () => pdfDeckblatt(pid, vid, eid, 'einladung') },
    { icon: '📑', label: 'Deckblatt Konditionen', act: () => pdfDeckblatt(pid, vid, eid, 'offerte') },
    { sep: true },
    { icon: '✕', label: 'Aus Liste entfernen', danger: true, act: () => removeInvite(pid, vid, eid) },
  ]);
}
function terminMenu(e, pid, tid) {
  openContextMenu(e, [
    { icon: '✎', label: 'Termin bearbeiten', act: () => actKalTermin(pid, tid) },
    { sep: true },
    { icon: '🗑', label: 'Termin löschen', danger: true, act: () => removeKalTermin(pid, tid) },
  ]);
}
function planBlockMenu(e, bid) {
  const b = loadPlanung().find(x => x.id === bid); if (!b) return;
  openContextMenu(e, [
    { icon: '✎', label: 'Bearbeiten', act: () => actPlanBlock(bid) },
    { icon: '⧉', label: 'Kopieren', act: () => { planClip = { ...b }; toast('Block kopiert'); } },
    { sep: true },
    { icon: '🗑', label: 'Löschen', danger: true, act: () => { planungData = loadPlanung().filter(x => x.id !== bid); savePlanung(); planSel = null; viewPlanung(); } },
  ]);
}
function rmKontakt(kid) {
  const k = (state.kontakte || []).find(x => x.id === kid); if (!k) return;
  if (!confirm(`Kontakt „${k.firma}" wirklich löschen?`)) return;
  state.kontakte = state.kontakte.filter(x => x.id !== kid); save(); closeModal();
  if (location.hash.startsWith('#/kontakt/')) location.hash = '#/kontakte'; else viewKontakte();
  toast('Kontakt gelöscht');
}
function kontaktMenu(e, kid) {
  const k = (state.kontakte || []).find(x => x.id === kid); if (!k) return;
  const items = [
    { icon: '↗', label: 'Kontakt öffnen', act: () => go('#/kontakt/' + kid) },
    { icon: '✎', label: 'Bearbeiten', act: () => actKontakt(kid) },
    { sep: true },
  ];
  if (k.email) items.push({ icon: '✉', label: 'E-Mail schreiben', act: () => { window.location.href = 'mailto:' + k.email; } });
  if (k.telefon) items.push({ icon: '☎', label: 'Anrufen', act: () => { window.location.href = 'tel:' + k.telefon.replace(/\s/g, ''); } });
  if (items.length) items.push({ sep: true });
  items.push({ icon: '🗑', label: 'Kontakt löschen', danger: true, act: () => rmKontakt(kid) });
  openContextMenu(e, items);
}

/* --- Gantt Drag & Drop --- */

let ganttDrag = null;

function onBarMouseDown(e) {
  if (!ganttCtx || e.button !== 0) return;
  const bar = e.currentTarget;
  const isHandle = e.target.classList.contains('g-h');
  const mode = isHandle ? (e.target.classList.contains('l') ? 'resize-l' : 'resize-r') : 'move';
  ganttDrag = {
    bar, mode, moved: false, startX: e.clientX,
    origLeft: parseFloat(bar.style.left) || 0, origWidth: parseFloat(bar.style.width) || 0,
    pid: bar.dataset.pid, vid: bar.dataset.vid, oid: bar.dataset.oid || null,
    origStart: bar.dataset.start, origEnde: bar.dataset.ende,
    newStart: bar.dataset.start, newEnde: bar.dataset.ende,
  };
  bar.classList.add('dragging');
  document.body.style.userSelect = 'none';
  e.preventDefault();
}

// Bestellfrist-Balken: linke Kante ziehen = Vorlauf ändern (rechte Kante = Ausführungsbeginn, fix); ohne Bewegung = bearbeiten
function onBestellDown(e) {
  if (e.button !== 0 || !ganttCtx) return;
  e.preventDefault(); e.stopPropagation();
  const el = e.currentTarget, pid = el.dataset.pid, vid = el.dataset.vid;
  const p = findProjekt(pid); const v = p && findVergabe(p, vid); if (!v) return;
  const startX = e.clientX, origFrist = Number(v.bestellfrist) || 0, px = ganttCtx.pxPerDay, right = Number(el.dataset.right) || 0;
  let frist = origFrist, moved = false;
  const onMove = ev => {
    const dx = ev.clientX - startX; if (Math.abs(dx) > 2) moved = true;
    frist = Math.max(0, origFrist - Math.round(dx / px));       // nach links ziehen = mehr Vorlauf
    const w = Math.max(frist * px, 1); el.style.width = w + 'px'; el.style.left = (right - w) + 'px';
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
    document.body.style.userSelect = '';
    if (!moved) { actEditTermin(pid, vid); return; }
    if (frist !== origFrist) { v.bestellfrist = frist; save(); }
    rerenderGantt(pid);
  };
  document.body.style.userSelect = 'none';
  document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
}

function onGanttMove(e) {
  const d = ganttDrag; if (!d) return;
  const dxPx = e.clientX - d.startX;
  if (Math.abs(dxPx) > 2) d.moved = true;
  const dDays = Math.round(dxPx / ganttCtx.pxPerDay);   // für die Tage erst beim Loslassen gesnappt
  let s = d.origStart, en = d.origEnde;
  // Visuell pixelgenau folgen (flüssig), Tage erst beim Commit snappen
  if (d.mode === 'move') {
    s = addDays(d.origStart, dDays); en = addDays(d.origEnde, dDays);
    d.bar.style.left = (d.origLeft + dxPx) + 'px';
  } else if (d.mode === 'resize-l') {
    s = addDays(d.origStart, dDays); if (s > en) s = en;
    d.bar.style.left = (d.origLeft + dxPx) + 'px';
    d.bar.style.width = Math.max(d.origWidth - dxPx, 3) + 'px';
  } else {
    en = addDays(d.origEnde, dDays); if (en < s) en = s;
    d.bar.style.width = Math.max(d.origWidth + dxPx, 3) + 'px';
  }
  d.newStart = s; d.newEnde = en;
  d.bar.title = `${fmtDate(s)} – ${fmtDate(en)}`;
}

function onGanttUp() {
  const d = ganttDrag; if (!d) return;
  ganttDrag = null;
  document.body.style.userSelect = '';
  d.bar.classList.remove('dragging');
  if (d.moved && (d.newStart !== d.origStart || d.newEnde !== d.origEnde)) {
    commitBarDates(d.pid, d.vid, d.oid, d.newStart, d.newEnde);
  } else if (!d.oid) {
    actEditTermin(d.pid, d.vid); // reiner Klick auf Vergabe-Balken öffnet Dialog
  }
}

function commitBarDates(pid, vid, oid, s, en) {
  const p = findProjekt(pid); const v = findVergabe(p, vid); if (!v) return;
  if (oid) { const o = (v.vorgaenge || []).find(x => x.id === oid); if (o) { o.start = s; o.ende = en; } }
  else { v.bauStart = s; v.bauEnde = en; }
  let moved = 0;
  if (ganttChain) moved = rescheduleChain(p, oid ? vid + '/' + oid : vid);
  save(); rerenderGantt(pid);
  toast('Termin: ' + fmtDate(s) + ' – ' + fmtDate(en) + (moved ? ` · ${moved} Nachfolger nachgeführt` : ''), 'info');
}
// Referenz auf die Termine eines Balkens (Vergabe oder Vorgang) per Schlüssel
function ganttBarRef(p, key) {
  if (key.indexOf('/') >= 0) {
    const [vid, oid] = key.split('/');
    const v = findVergabe(p, vid); const o = v && (v.vorgaenge || []).find(x => x.id === oid);
    if (!o || !o.start || !o.ende) return null;
    return { get s() { return o.start; }, get e() { return o.ende; }, set: (s, e) => { o.start = s; o.ende = e; } };
  }
  const v = findVergabe(p, key);
  if (!v || !v.bauStart || !v.bauEnde) return null;
  return { get s() { return v.bauStart; }, get e() { return v.bauEnde; }, set: (s, e) => { v.bauStart = s; v.bauEnde = e; } };
}
// Verkettung nachführen: Nachfolger startet (Vorgänger-Ende + lag), Dauer bleibt erhalten
function rescheduleChain(p, key, seen) {
  seen = seen || new Set(); if (seen.has(key)) return 0; seen.add(key);
  const from = ganttBarRef(p, key); if (!from) return 0;
  let n = 0;
  (p.ganttLinks || []).filter(l => l.from === key).forEach(l => {
    const to = ganttBarRef(p, l.to); if (!to) return;
    const lag = l.lag != null ? l.lag : 1;
    const dur = dayDiffISO(to.s, to.e);
    // lag = Tage von Vorgänger-Ende bis Nachfolger-Start (1 = nächster Tag)
    const ns = ganttWorkdays ? addArbeitstage(from.e, Math.max(1, lag)) : addDays(from.e, lag);
    if (ns !== to.s) { to.set(ns, addDays(ns, dur)); n++; }
    n += rescheduleChain(p, l.to, seen);
  });
  return n;
}
// 1-Klick-Bauablauf: terminierte Gewerke nach BKP verketten & ab Baustart sequenziell datieren
function actBauablauf(pid) {
  const p = findProjekt(pid); if (!p) return;
  const term = (p.vergaben || []).filter(v => v.bauStart && v.bauEnde).length;
  if (term < 2) { toast('Mindestens zwei terminierte Gewerke nötig', 'info'); return; }
  const startIso = p.baustart || '';
  openModal('Bauablauf erstellen', `
    <p style="font-size:13px;margin-top:0">Die <b>${term} terminierten Gewerke</b> werden nach <b>BKP-Reihenfolge</b> verkettet und ab <b>${startIso ? fmtDate(startIso) : 'dem frühesten Termin'}</b> nacheinander datiert (Dauer je Gewerk bleibt erhalten).</p>
    <p class="muted" style="font-size:12.5px">Bestehende Verbindungen werden durch die neue Kette ersetzt. Danach kannst du einzelne Balken verschieben – die Nachfolger laufen automatisch mit. Du kannst alles anschliessend frei anpassen.</p>
    <label class="field" style="font-size:13px">Abstand zwischen den Gewerken
      <select class="input" id="ba_lag">
        <option value="1" selected>direkt anschliessend (nächster Tag)</option>
        <option value="3">+3 Tage</option>
        <option value="7">+1 Woche</option>
      </select>
    </label>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="bauablauf-go" data-pid="${pid}">Bauablauf erstellen</button>`);
}
function applyBauablauf(pid) {
  const p = findProjekt(pid); if (!p) return;
  const lag = Math.max(1, parseInt(($('#ba_lag') || {}).value, 10) || 1);
  const ordered = (p.vergaben || []).filter(v => v.bauStart && v.bauEnde).sort((a, b) => (a.bkp || '').localeCompare(b.bkp || '') || (a.bauStart < b.bauStart ? -1 : 1));
  if (ordered.length < 2) return;
  let cursor = p.baustart || ordered.reduce((m, v) => v.bauStart < m ? v.bauStart : m, ordered[0].bauStart);
  if (ganttWorkdays) cursor = naechsterArbeitstag(cursor);
  p.ganttLinks = [];
  let prev = null;
  ordered.forEach(v => {
    const dur = dayDiffISO(v.bauStart, v.bauEnde);
    v.bauStart = cursor; v.bauEnde = addDays(cursor, dur);
    if (prev) p.ganttLinks.push({ id: uid('gl'), from: prev.id, to: v.id, dx: null, lag });
    prev = v;
    cursor = ganttWorkdays ? addArbeitstage(v.bauEnde, lag) : addDays(v.bauEnde, lag);
  });
  save(); closeModal(); viewTermine(pid);
  toast('Bauablauf erstellt · ' + ordered.length + ' Gewerke verkettet', 'ok');
}
// Rechtsklick auf eine Verbindung: Abstand (Lag) setzen / löschen
function linkMenu(e, pid, lid) {
  const p = findProjekt(pid); const l = p && (p.ganttLinks || []).find(x => x.id === lid); if (!l) return;
  const setLag = days => { l.lag = days; rescheduleChain(p, l.from); save(); viewTermine(pid); toast('Abstand: ' + days + (ganttWorkdays ? ' Arbeitstage' : ' Tage'), 'info'); };
  openContextMenu(e, [
    { icon: '⏱', label: 'Direkt anschliessend (nächster Tag)', act: () => setLag(1) },
    { icon: '⏱', label: '+1 Woche', act: () => setLag(7) },
    { icon: '⏱', label: '+2 Wochen (z.B. Lieferfrist)', act: () => setLag(14) },
    { icon: '⏱', label: '+4 Wochen', act: () => setLag(28) },
    { icon: '✎', label: 'Benutzerdefiniert …', act: () => { const v = prompt('Abstand in Tagen (Vorgänger-Ende → Nachfolger-Start, 1 = nächster Tag):', l.lag != null ? l.lag : 1); if (v != null && v.trim() !== '' && !isNaN(+v)) setLag(Math.max(0, Math.round(+v))); } },
    { sep: true },
    { icon: '🗑', label: 'Verbindung löschen', danger: true, act: () => removeGanttLink(pid, lid) },
  ]);
}
// Gewerk als Nachfolger anhängen (Rechtsklick → „Nachfolger verketten")
function actLinkSuccessor(pid, vid) {
  const p = findProjekt(pid); const v = p && findVergabe(p, vid); if (!v) return;
  if (!(v.bauStart && v.bauEnde)) { toast('Dieses Gewerk hat noch keine Termine', 'info'); return; }
  const others = gewerkeSorted(p).filter(x => x.id !== vid && x.bauStart && x.bauEnde && !(p.ganttLinks || []).some(l => l.from === vid && l.to === x.id));
  if (!others.length) { toast('Keine weiteren terminierten Gewerke vorhanden', 'info'); return; }
  openModal('Nachfolger verketten', `
    <p class="muted" style="font-size:13px;margin-top:0">Welches Gewerk soll direkt nach <b>${esc(v.gewerk)}</b> starten? Es wird ans Ende angehängt und folgt künftig automatisch, wenn du <b>${esc(v.gewerk)}</b> verschiebst.</p>
    <div style="display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow:auto">
      ${others.map(x => `<button class="btn secondary" style="justify-content:flex-start" data-act="link-succ-pick" data-pid="${pid}" data-vid="${vid}" data-tvid="${x.id}"><span class="bkp-code">${esc(x.bkp || '')}</span>&nbsp;${esc(x.gewerk)}</button>`).join('')}
    </div>
  `, `<button class="btn ghost" data-close="1">Schliessen</button>`);
}
function linkSuccessorPick(pid, vid, tvid) {
  const p = findProjekt(pid); const from = ganttBarRef(p, vid), to = ganttBarRef(p, tvid); if (!from || !to) return;
  if (!p.ganttLinks) p.ganttLinks = [];
  if (!p.ganttLinks.some(l => l.from === vid && l.to === tvid)) p.ganttLinks.push({ id: uid('gl'), from: vid, to: tvid, dx: null, lag: 1 });
  const dur = dayDiffISO(to.s, to.e); const ns = addDays(from.e, 1);
  to.set(ns, addDays(ns, dur));
  rescheduleChain(p, vid);
  save(); closeModal(); viewTermine(pid);
  toast('Verkettet · „' + (findVergabe(p, tvid).gewerk) + '" folgt jetzt', 'info');
}

/* ---------------------------------------------------------------
   10c) Protokolle & Aktennotizen
   --------------------------------------------------------------- */

const PROT_TYP = {
  sitzung:    { label: 'Sitzungsprotokoll', kurz: 'Sitzung',    voll: 'Bausitzung', color: 'blue'  },
  aktennotiz: { label: 'Aktennotiz',        kurz: 'Aktennotiz', voll: 'Aktennotiz', color: 'amber' },
};
const PERSON_FELD = { anwesend: 'teilnehmer', abwesend: 'abwesende', verteiler: 'verteiler' };

function findProtokoll(p, prid) { return (p.protokolle || []).find(x => x.id === prid); }
function protokollTitel(pr) {
  if (pr.titel && pr.titel.trim()) return pr.titel;
  return `${PROT_TYP[pr.typ].voll} Nr. ${pr.nr}`;
}
function nextProtNr(p, typ) {
  const ns = (p.protokolle || []).filter(x => x.typ === typ).map(x => x.nr || 0);
  return (ns.length ? Math.max(...ns) : 0) + 1;
}

// E-Mail einer Firma: aus den Offert-Einladungen (eingeladene) oder den Kontakten
function firmaEmailOf(p, firma) {
  for (const v of (p.vergaben || [])) { const e = (v.eingeladene || []).find(x => x.firma === firma && x.email); if (e) return e.email; }
  const k = (state.kontakte || []).find(k => k.firma === firma);
  return (k && k.email) || '';
}
// Firmen mit Vertrag (Werkvertrag erstellt oder später) – zuweisbar für Pendenzen/Mail
function vertragsFirmen(p) {
  const seen = new Map();
  (p.vergaben || []).forEach(v => { if (isContract(v) && v.firma && !seen.has(v.firma)) seen.set(v.firma, { firma: v.firma, email: firmaEmailOf(p, v.firma), gewerk: v.gewerk, bkp: v.bkp }); });
  return [...seen.values()];
}
function pendFirmenHtml(p, selected) {
  selected = selected || [];
  const fs = p ? vertragsFirmen(p) : [];
  if (!fs.length) return '<p class="muted" style="font-size:12px;margin:0">Keine Firmen mit Vertrag in diesem Projekt.</p>';
  return fs.map(f => `<label class="pd-firma"><input type="checkbox" class="pd-firma-cb" value="${esc(f.firma)}"${selected.includes(f.firma) ? ' checked' : ''}> <span>${esc(f.firma)}</span><span class="muted" style="font-size:11px">${esc((f.bkp ? f.bkp + ' ' : '') + (f.gewerk || ''))}${f.email ? '' : ' · ⚠ keine Mail'}</span></label>`).join('');
}
function pendFirmenChips(it) {
  const fs = (it && it.firmen) || [];
  return fs.length ? ' ' + fs.map(f => `<span class="tag" style="font-size:10px;padding:1px 6px">${esc(f)}</span>`).join(' ') : '';
}

// Alle offenen Pendenzen eines Projekts (Protokolle + direkt erfasste), nach Termin sortiert
function offenePendenzen(p) {
  const out = [];
  (p.protokolle || []).forEach(pr => (pr.traktanden || []).forEach(tr => (tr.eintraege || []).forEach(it => {
    if (it.art === 'pendenz' && !it.erledigt && !it.uebertragen) out.push({ it, pr, tr });
  })));
  (p.pendenzen || []).forEach(it => { if (!it.erledigt && !it.uebertragen) out.push({ it, pr: null, tr: null }); });
  out.sort((a, b) => (a.it.termin || '9999-99-99').localeCompare(b.it.termin || '9999-99-99'));
  return out;
}

function eintragBadge(it) {
  return it.art === 'pendenz'
    ? `<span class="st amber" style="padding:2px 8px;font-size:10.5px">Pendenz</span>`
    : `<span class="tag">Info</span>`;
}

// Alle erledigten (nicht übertragenen) Pendenzen projektweit – für den Pendenzen-Reiter
function erledigtePendenzen(p) {
  const out = [];
  (p.protokolle || []).forEach(pr => (pr.traktanden || []).forEach(tr => (tr.eintraege || []).forEach(it => {
    if (it.art === 'pendenz' && it.erledigt && !it.uebertragen) out.push({ it, pr, tr });
  })));
  (p.pendenzen || []).forEach(it => { if (it.erledigt && !it.uebertragen) out.push({ it, pr: null, tr: null }); });
  out.sort((a, b) => ((b.pr && b.pr.datum) || (b.it.erfasst) || '').localeCompare((a.pr && a.pr.datum) || (a.it.erfasst) || ''));
  return out;
}

function viewPendenzen(pid) {
  const p = findProjekt(pid);
  if (!p) { render(emptyState('⚠', 'Projekt nicht gefunden.')); return; }
  const offen = offenePendenzen(p);
  const erledigt = erledigtePendenzen(p);
  const ueberfaellig = offen.filter(x => x.it.termin && daysUntil(x.it.termin) < 0).length;

  const kpi = (l, v, cls) => `<div class="kpi"><div class="k-label">${l}</div><div class="k-value" style="font-size:21px${cls ? ';color:var(--' + cls + ')' : ''}">${v}</div></div>`;
  const herkunft = x => x.pr
    ? `<a href="#/projekt/${p.id}/protokoll/${x.pr.id}">${esc(protokollTitel(x.pr))} · ${fmtDate(x.pr.datum)}</a>`
    : '<span class="muted">direkt erfasst</span>';
  const pendActs = x => x.pr ? '' : `${(x.it.firmen || []).length ? `<button class="ic-btn" data-act="pend-mail" data-pid="${p.id}" data-itemid="${x.it.id}" title="Als E-Mail an Firmen">✉</button>` : ''}<button class="ic-btn" data-act="pend-edit" data-pid="${p.id}" data-itemid="${x.it.id}" title="Bearbeiten">✎</button><button class="ic-btn" data-act="pend-del" data-pid="${p.id}" data-itemid="${x.it.id}" title="Löschen">✕</button>`;

  const offenTable = offen.length ? `
    <table class="grid">
      <thead><tr><th style="width:36px"></th><th>Pendenz</th><th>Verantwortlich</th><th>Termin</th><th>Herkunft</th><th style="width:62px"></th></tr></thead>
      <tbody>
        ${offen.map(x => `
          <tr${x.pr ? '' : ` data-ctx="pendenz" data-pid="${p.id}" data-itemid="${x.it.id}"`}>
            <td><input type="checkbox" class="pend-check" data-pid="${p.id}" data-prid="${x.pr ? x.pr.id : ''}" data-tid="${x.tr ? x.tr.id : ''}" data-itemid="${x.it.id}" title="erledigt"></td>
            <td>${esc(x.it.text)}${pendFirmenChips(x.it)}</td>
            <td>${esc(x.it.verantwortlich || '–')}</td>
            <td class="muted frist ${fristClass(x.it.termin, false)}">${x.it.termin ? fristText(x.it.termin, false) : '–'}</td>
            <td class="muted">${herkunft(x)}</td>
            <td class="row-act">${pendActs(x)}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : emptyState('✓', 'Keine offenen Pendenzen — mit „+ Pendenz" erfassen.');

  const erledigtTable = erledigt.length ? `
    <div class="section-head" style="margin-top:26px"><h2>Erledigt</h2><span class="hint">${erledigt.length} · Häkchen entfernen = wieder offen</span></div>
    <div class="card">
      <table class="grid">
        <thead><tr><th style="width:36px"></th><th>Pendenz</th><th>Verantwortlich</th><th>Termin</th><th>Herkunft</th><th style="width:62px"></th></tr></thead>
        <tbody>
          ${erledigt.map(x => `
            <tr class="done-row"${x.pr ? '' : ` data-ctx="pendenz" data-pid="${p.id}" data-itemid="${x.it.id}"`}>
              <td><input type="checkbox" class="pend-check" checked data-pid="${p.id}" data-prid="${x.pr ? x.pr.id : ''}" data-tid="${x.tr ? x.tr.id : ''}" data-itemid="${x.it.id}" title="wieder offen"></td>
              <td>${esc(x.it.text)}${pendFirmenChips(x.it)}</td>
              <td>${esc(x.it.verantwortlich || '–')}</td>
              <td class="muted">${x.it.termin ? fmtDate(x.it.termin) : '–'}</td>
              <td class="muted">${herkunft(x)}</td>
              <td class="row-act">${pendActs(x)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '';

  render(`
    <div class="breadcrumb"><a href="#/projekte">Projekte</a> › ${esc(p.name)}</div>
    <div class="detail-head">
      <div><h1 style="margin:0;font-size:23px">${esc(p.name)}</h1><div class="sub" style="margin-top:5px">Pendenzen · projektweit aus allen Protokollen</div></div>
    </div>
    ${projektTabs(p, 'pendenzen')}
    ${demoBanner('pendenzen')}

    <div class="kpi-row">
      ${kpi('Offen', offen.length)}
      ${kpi('Überfällig', ueberfaellig, ueberfaellig ? 's-red' : '')}
      ${kpi('Erledigt', erledigt.length)}
    </div>

    <div class="section-head"><h2>Offene Pendenzen</h2><div style="display:flex;align-items:center;gap:12px"><span class="hint">nach Termin sortiert · abhaken = erledigt</span><button class="btn sm" data-act="pend-add" data-pid="${p.id}">+ Pendenz</button></div></div>
    <div class="card">${offenTable}</div>
    ${erledigtTable}
  `);

  $$('.pend-check').forEach(cb => cb.addEventListener('change', () => togglePendenz(cb.dataset.pid, cb.dataset.prid, cb.dataset.tid, cb.dataset.itemid)));
}
// Direkt erfasste Pendenz anlegen/bearbeiten (unabhängig von Protokollen)
// pid leer = projektübergreifend (mit Projektauswahl im Dialog)
function actPendenz(pid, itemid) {
  const p = pid ? findProjekt(pid) : null;
  if (pid && !p) return;
  const it = (p && itemid) ? (p.pendenzen || []).find(x => x.id === itemid) : null;
  const projekte = sichtbareProjekte();
  const projField = !pid ? `<label class="field">Projekt <select class="select" id="pd_pid">${projekte.map(pr => `<option value="${pr.id}">${esc(pr.name)}</option>`).join('')}</select></label>` : '';
  const firmProj = p || projekte[0] || null;
  openModal(it ? 'Pendenz bearbeiten' : 'Neue Pendenz', `
    ${projField}
    <label class="field">Pendenz / Aufgabe <input class="input" id="pd_text" value="${it ? esc(it.text || '') : ''}" placeholder="z.B. Mangel Fenster EG beheben"></label>
    <div class="form-row">
      <label class="field">Verantwortlich <input class="input" id="pd_verant" value="${it ? esc(it.verantwortlich || '') : ''}" placeholder="optional"></label>
      <label class="field">Termin <input class="input" type="date" id="pd_termin" value="${it ? esc(it.termin || '') : ''}"></label>
    </div>
    <label class="field" style="margin-bottom:4px">Firmen mit Vertrag <span class="muted" style="font-weight:400;font-size:11.5px">– zuweisen für Mail</span></label>
    <div id="pd_firmen" class="pd-firmen">${pendFirmenHtml(firmProj, it && it.firmen)}</div>
  `, `${it ? `<button class="btn danger" data-act="pend-del" data-pid="${pid}" data-itemid="${itemid}">Löschen</button>` : '<button class="btn ghost" data-close="1">Abbrechen</button>'}<button class="btn" data-act="pend-save" data-pid="${pid || ''}"${it ? ` data-itemid="${itemid}"` : ''}>${it ? 'Speichern' : 'Hinzufügen'}</button>`);
  const ps = $('#pd_pid'); if (ps) ps.addEventListener('change', () => { const cont = $('#pd_firmen'); if (cont) cont.innerHTML = pendFirmenHtml(findProjekt(ps.value), []); });
}
function savePendenz(pid, itemid) {
  pid = pid || ($('#pd_pid') && $('#pd_pid').value);
  const p = findProjekt(pid); if (!p) { toast('Bitte ein Projekt wählen', 'info'); return; }
  const text = $('#pd_text').value.trim();
  if (!text) { toast('Bitte einen Text eingeben', 'info'); return; }
  const firmen = $$('#pd_firmen .pd-firma-cb').filter(cb => cb.checked).map(cb => cb.value);
  const data = { text, verantwortlich: $('#pd_verant').value.trim(), termin: $('#pd_termin').value || '', firmen };
  if (!p.pendenzen) p.pendenzen = [];
  const it = itemid ? p.pendenzen.find(x => x.id === itemid) : null;
  if (it) Object.assign(it, data);
  else p.pendenzen.unshift({ id: uid('pd'), art: 'pendenz', erledigt: false, uebertragen: false, erfasst: todayIso(), ...data });
  save(); closeModal(); router(); toast(it ? 'Pendenz gespeichert' : 'Pendenz erfasst');
}
// Zentraler Mail-Dialog – überall genutzt (Pendenz, Einladung, Zuschlag, Absage …)
// opts: { title, to (Array|String), subject, body, hint, onSend }
let _mailOnSend = null;
function mailCompose(opts) {
  _mailOnSend = opts.onSend || null;
  const to = (Array.isArray(opts.to) ? opts.to.filter(Boolean).join(', ') : (opts.to || ''));
  const sigText = (state.buero && state.buero.signatur || '').trim() || 'Freundliche Grüsse';
  const sigOn = !(state.buero && state.buero.signaturAuto === false);
  openModal(opts.title || 'E-Mail', `
    <label class="field">An <input class="input" id="pm_to" value="${esc(to)}" placeholder="empfaenger@firma.ch"></label>
    <label class="field">Betreff <input class="input" id="pm_subj" value="${esc(opts.subject || '')}"></label>
    <label class="field">Nachricht <textarea class="input" id="pm_body" rows="11">${esc(opts.body || '')}</textarea></label>
    <label style="display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer;margin-top:2px"><input type="checkbox" id="pm_sig" ${sigOn ? 'checked' : ''}> Signatur anhängen <span class="muted" style="font-size:11.5px">(aus → du fügst sie selbst im Mail ein)</span></label>
    ${opts.hint ? `<p class="muted" style="font-size:11.5px;margin:8px 0 0">${opts.hint}</p>` : ''}
  `, `<button class="btn ghost" data-act="pend-mail-copy">Text kopieren</button><button class="btn" data-act="pend-mail-open">Im Mail-Programm öffnen</button>`);
  const sigBlock = '\n\n' + sigText;
  const applySig = on => { const ta = $('#pm_body'); if (!ta) return; let v = ta.value; if (v.endsWith(sigBlock)) v = v.slice(0, -sigBlock.length); if (on) v += sigBlock; ta.value = v; };
  const cb = $('#pm_sig'); if (cb) cb.addEventListener('change', () => applySig(cb.checked));
  applySig(sigOn);
}
// Aus einer Pendenz eine E-Mail an die zugewiesenen Firmen
function actPendenzMail(pid, itemid) {
  const p = findProjekt(pid); if (!p) return;
  const it = (p.pendenzen || []).find(x => x.id === itemid); if (!it) return;
  const firmen = it.firmen || [];
  const emails = firmen.map(f => firmaEmailOf(p, f)).filter(Boolean);
  const ohneMail = firmen.filter(f => !firmaEmailOf(p, f));
  const L = ['Guten Tag', '', `betreffend das Projekt „${p.name}"${p.ort ? ', ' + p.ort : ''} bitten wir Sie um Folgendes:`, '', '• ' + it.text];
  if (it.termin) L.push('  Termin bis: ' + fmtDate(it.termin));
  L.push('', 'Bitte um kurze Rückmeldung. Besten Dank.');
  mailCompose({ title: 'Pendenz als E-Mail', to: emails, subject: `Pendenz – ${p.name}: ${it.text.slice(0, 60)}`, body: L.join('\n'), hint: ohneMail.length ? `Ohne hinterlegte Mail: ${esc(ohneMail.join(', '))}` : '' });
}
// Submissions-Mails
function mailEinladung(pid, vid) {
  const p = findProjekt(pid); const v = p && findVergabe(p, vid); if (!v) return;
  const offen = (v.eingeladene || []).filter(e => e.status === 'eingeladen');
  const target = offen.length ? offen : (v.eingeladene || []).filter(e => e.status !== 'abgesagt');
  if (!target.length) { toast('Keine Empfänger', 'info'); return; }
  const body = `Sehr geehrte Damen und Herren\n\nfür das Bauvorhaben „${p.name}"${p.ort ? ' in ' + p.ort : ''} laden wir Sie ein, eine Offerte für folgendes Gewerk einzureichen:\n\n  Gewerk:        ${v.bkp || ''} ${v.gewerk || ''}\n  Eingabefrist:  ${v.frist ? fmtDate(v.frist) : '—'}\n\nDie Ausschreibungsunterlagen erhalten Sie im Anhang.`;
  mailCompose({
    title: 'Submissionseinladung', to: target.map(e => e.email).filter(Boolean),
    subject: `Submissionseinladung – BKP ${v.bkp || ''} ${v.gewerk || ''} / ${p.name}`, body,
    hint: 'Tipp: Einladungs-/Konditionen-Deckblatt als PDF erzeugen und dem Mail anhängen.',
    onSend: () => { (v.eingeladene || []).forEach(e => { if (e.status === 'eingeladen') { e.status = 'angefragt'; e.datumMail = todayIso(); } }); save(); router(); },
  });
}
function mailZuschlag(pid, vid) {
  const p = findProjekt(pid); const v = p && findVergabe(p, vid); if (!v || !v.firma) return;
  const body = `Sehr geehrte Damen und Herren\n\nfür das Bauvorhaben „${p.name}"${p.ort ? ' in ' + p.ort : ''} freut es uns, Ihnen den Zuschlag für folgendes Gewerk zu erteilen:\n\n  Gewerk:        ${v.bkp || ''} ${v.gewerk || ''}\n  Vergabesumme:  ${chf(v.betrag)} (exkl. MwSt)\n\nDer Werkvertrag folgt separat. Wir freuen uns auf die Zusammenarbeit.`;
  mailCompose({ title: 'Zuschlag', to: [firmaEmailOf(p, v.firma)].filter(Boolean), subject: `Zuschlag – BKP ${v.bkp || ''} ${v.gewerk || ''} / ${p.name}`, body });
}
function mailAbsage(pid, vid) {
  const p = findProjekt(pid); const v = p && findVergabe(p, vid); if (!v) return;
  const unter = (v.eingeladene || []).filter(e => e.firma !== v.firma && e.status !== 'abgesagt' && eOff(e) != null);
  if (!unter.length) { toast('Keine unterlegenen Offerten', 'info'); return; }
  const body = `Sehr geehrte Damen und Herren\n\nbesten Dank für Ihre Offerte zum Gewerk ${v.bkp || ''} ${v.gewerk || ''} beim Bauvorhaben „${p.name}".\nNach sorgfältiger Prüfung haben wir den Auftrag an einen anderen Anbieter vergeben.\n\nWir danken Ihnen für Ihre Bemühungen und Ihr Interesse.`;
  mailCompose({
    title: 'Absage an Unterlegene', to: unter.map(e => firmaEmailOf(p, e.firma) || e.email).filter(Boolean),
    subject: `Submission – BKP ${v.bkp || ''} ${v.gewerk || ''} / ${p.name}`, body,
    onSend: () => { unter.forEach(e => { e.status = 'abgesagt'; }); save(); router(); },
  });
}
// Mail-Adresse zu einem Personen-/Firmennamen aus den Kontakten
function personEmail(name) {
  const n = (name || '').trim().toLowerCase(); if (!n) return '';
  const ks = state.kontakte || [];
  const k = ks.find(k => (k.person || '').toLowerCase() === n || (k.firma || '').toLowerCase() === n)
    || ks.find(k => ((k.person || '').toLowerCase().includes(n) || (k.firma || '').toLowerCase().includes(n)) && k.email);
  return (k && k.email) || '';
}
function mailProtokoll(pid, prid) {
  const p = findProjekt(pid); const pr = p && findProtokoll(p, prid); if (!pr) return;
  const seen = new Set();
  const list = [...(pr.verteiler || []), ...(pr.teilnehmer || [])].filter(n => { const k = (n || '').toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  const withMail = list.map(n => ({ n, m: personEmail(n) }));
  const emails = withMail.map(x => x.m).filter(Boolean);
  const ohne = withMail.filter(x => !x.m).map(x => x.n);
  const titel = protokollTitel(pr);
  const body = `Guten Tag\n\nanbei das Protokoll „${titel}" vom ${fmtDate(pr.datum)} zum Projekt „${p.name}"${p.ort ? ', ' + p.ort : ''}.\n\nDas vollständige Protokoll finden Sie im Anhang (PDF).${pr.naechste ? '\n\nNächste Sitzung: ' + fmtDate(pr.naechste) : ''}`;
  mailCompose({ title: 'Protokoll an Verteiler', to: emails, subject: `${titel} – ${p.name}`, body, hint: (ohne.length ? `Ohne hinterlegte Mail: ${esc(ohne.join(', '))} · ` : '') + 'Tipp: Protokoll-PDF erzeugen und anhängen.' });
}
function pendMailOpen() {
  const to = ($('#pm_to').value || '').split(/[,;]\s*/).map(s => s.trim()).filter(Boolean).join(',');
  const subj = $('#pm_subj').value || '';
  const body = $('#pm_body').value || '';
  window.location.href = `mailto:${to}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
  const after = _mailOnSend; _mailOnSend = null;
  closeModal();
  if (after) after();
}
function pendMailCopy() {
  const t = $('#pm_body').value || '';
  if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast('Text kopiert'), () => toast('Kopieren nicht möglich', 'info'));
  else toast('Kopieren nicht möglich', 'info');
}
function rmPendenz(pid, itemid) {
  const p = findProjekt(pid); if (!p) return;
  if (!confirm('Diese Pendenz wirklich löschen?')) return;
  p.pendenzen = (p.pendenzen || []).filter(x => x.id !== itemid);
  save(); closeModal(); router(); toast('Pendenz gelöscht');
}

/* ---------------------------------------------------------------
   Listen: Submittentenliste (vertraulich) + Unternehmerliste (Baustelle)
   --------------------------------------------------------------- */

function gewerkeSorted(p) {
  return (p.vergaben || []).slice().sort((a, b) =>
    (a.bkp || '').localeCompare(b.bkp || '') || (a.gewerk || '').localeCompare(b.gewerk || ''));
}

function kontaktByFirma(firma) {
  return (state.kontakte || []).find(k => k.firma === firma) || null;
}

function viewListen(pid) {
  const p = findProjekt(pid);
  if (!p) { render(emptyState('⚠', 'Projekt nicht gefunden.')); return; }
  const gw = gewerkeSorted(p);

  const submBlocks = gw.length ? gw.map(v => {
    const eing = (v.eingeladene || []);
    const rows = eing.length ? eing.map(e => `
      <tr>
        <td>${esc(e.firma)}</td>
        <td><span class="st ${INV_STATUS[e.status]?.color || 'grey'}" style="padding:2px 8px;font-size:10.5px">${INV_STATUS[e.status]?.label || esc(e.status)}</span></td>
        <td class="num">${eOff(e) != null ? chf(eOff(e)) : '–'}</td>
      </tr>`).join('') : `<tr><td colspan="3" class="muted">noch niemand eingeladen</td></tr>`;
    return `
      <div style="margin-bottom:14px">
        <div style="font-weight:600;margin-bottom:5px"><span class="bkp-code">${esc(v.bkp)}</span> ${esc(v.gewerk)}</div>
        <table class="grid"><thead><tr><th>Firma</th><th style="width:120px">Status</th><th class="num" style="width:130px">Betrag</th></tr></thead>
          <tbody>${rows}</tbody></table>
      </div>`;
  }).join('') : emptyState('◫', 'Keine Gewerke angelegt.');

  const untRows = gw.map(v => {
    const vergeben = isVergeben(v) && v.firma;
    const k = vergeben ? kontaktByFirma(v.firma) : null;
    return `<tr>
      <td><span class="bkp-code">${esc(v.bkp)}</span></td>
      <td>${esc(v.gewerk)}</td>
      <td>${vergeben ? `<strong>${esc(v.firma)}</strong>` : '<span class="muted">noch nicht vergeben</span>'}</td>
      <td class="muted">${vergeben && k ? esc([k.person, k.telefon].filter(Boolean).join(' · ')) : ''}</td>
    </tr>`;
  }).join('');

  render(`
    <div class="breadcrumb"><a href="#/projekte">Projekte</a> › ${esc(p.name)}</div>
    <div class="detail-head">
      <div><h1 style="margin:0;font-size:23px">${esc(p.name)}</h1><div class="sub" style="margin-top:5px">Listen · zum Drucken / als PDF</div></div>
    </div>
    ${projektTabs(p, 'listen')}

    <div class="section-head"><h2>Submittentenliste <span class="st red" style="font-size:10.5px;padding:2px 8px;vertical-align:middle">vertraulich</span></h2>
      <button class="btn sm" data-act="pdf-submittenten" data-pid="${p.id}">⬇ Drucken / PDF</button></div>
    <p class="muted" style="font-size:12.5px;margin:-4px 0 10px">Alle eingeladenen Firmen je Gewerk – nur intern, <strong>nicht</strong> an die Baustelle.</p>
    <div class="card card-pad">${submBlocks}</div>

    <div class="section-head" style="margin-top:26px"><h2>Unternehmerliste <span class="tag">für Baustelle</span></h2>
      <button class="btn sm" data-act="pdf-unternehmer" data-pid="${p.id}">⬇ Drucken / PDF</button></div>
    <p class="muted" style="font-size:12.5px;margin:-4px 0 10px">Alle Gewerke mit vergebenem Unternehmer; offene zeigen „noch nicht vergeben" (verrät keine Submittenten).</p>
    <div class="card">${gw.length ? `
      <table class="grid"><thead><tr><th style="width:60px">BKP</th><th>Gewerk</th><th>Unternehmer</th><th>Kontakt</th></tr></thead>
        <tbody>${untRows}</tbody></table>` : emptyState('◫', 'Keine Gewerke angelegt.')}</div>
  `);
}

// Gemeinsamer Druck-/PDF-Wrapper mit Büro-Briefkopf
function druckDesign() {
  const b = state.buero || BUERO;
  let d = (b.druckDesign === 'modern') ? 'modern' : 'standard';
  if (d === 'modern' && cloudEnabled && ent !== null && !canModul('design')) d = 'standard';   // Premium-Gating
  return d;
}
function openPrintDoc(title, subtitleHtml, inner, opts) {
  opts = opts || {};
  const b = state.buero || BUERO;
  const design = druckDesign();
  const logo = b.logo
    ? `<img src="${b.logo}" class="lg-img" style="max-height:54px;max-width:220px;display:block">`
    : `<div class="lg-name">${esc(b.firma || 'submit one')}</div>`;
  const addr = [b.firma, b.strasse, b.plzort, b.tel ? 'Tel. ' + b.tel : '', b.email].filter(Boolean).map(esc).join(' · ');
  const pg = `@page{size:${opts.landscape ? 'A4 landscape' : 'A4'};margin:14mm;}`;
  const styleStandard = `
    *{box-sizing:border-box;} html,body{margin:0;padding:0;}
    body{font-family:'Helvetica Neue','Segoe UI',Arial,sans-serif;color:#222b36;font-size:12px;line-height:1.45;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .page{padding:26px 30px;}
    .lh{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:2px solid #7c1d2c;padding-bottom:12px;}
    .lh .meta{text-align:right;font-size:10px;color:#6b7480;max-width:54%;line-height:1.5;} .lg-name{font-weight:800;font-size:18px;color:#1b2533;letter-spacing:.3px;}
    h1{font-size:20px;margin:18px 0 0;letter-spacing:.2px;color:#1b2533;}
    h1::after{content:"";display:block;width:44px;height:3px;background:#7c1d2c;margin-top:6px;border-radius:2px;}
    .sub{color:#6b7480;font-size:11.5px;margin:9px 0 16px;}
    table.t{width:100%;border-collapse:collapse;margin-bottom:10px;}
    table.t th{background:#f3f5f9;text-align:left;padding:7px 9px;font-size:10.5px;font-weight:700;color:#46505e;border-bottom:1.5px solid #c9d2de;}
    table.t td{padding:6px 9px;border-bottom:1px solid #e7ebf1;vertical-align:top;}
    table.t td.num,table.t th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
    .gw{font-weight:700;margin:15px 0 5px;font-size:13px;color:#1b2533;}
    .muted{color:#9aa4b1;}
    .conf{display:inline-block;background:#fbe9ea;color:#a01b2b;border:1px solid #e7b3ba;border-radius:5px;padding:2px 8px;font-size:10px;font-weight:700;}
    .ft{margin-top:22px;border-top:1px solid #e7ebf1;padding-top:8px;color:#9aa4b1;font-size:9.5px;display:flex;justify-content:space-between;}
    @media print{.page{padding:0;}${pg}}`;
  // „Modern" (Premium): edel & ruhig – Serifen-Typografie, Haarlinien, viel Weissraum, dezenter Akzentstreifen
  const styleModern = `
    *{box-sizing:border-box;} html,body{margin:0;padding:0;}
    body{font-family:'Helvetica Neue','Segoe UI',Arial,sans-serif;color:#33373d;font-size:11px;line-height:1.6;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .page{padding:0;}
    .accent-top{height:3px;background:#7c1d2c;margin:-14mm -14mm 20px;}
    .lh{display:flex;justify-content:space-between;align-items:flex-end;gap:22px;padding-bottom:15px;border-bottom:1px solid #e3d6d9;}
    .lg-name{font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:23px;color:#1b2230;letter-spacing:1.4px;}
    .lg-img{max-height:50px;}
    .lh .meta{text-align:right;font-size:8.5px;color:#8d949d;line-height:1.85;letter-spacing:.5px;text-transform:uppercase;}
    h1{font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:27px;margin:30px 0 0;letter-spacing:.6px;color:#1b2230;}
    h1::after{content:"";display:block;width:40px;height:1.5px;background:#7c1d2c;margin-top:11px;}
    .sub{color:#8d949d;font-size:11px;margin:11px 0 24px;letter-spacing:.3px;}
    table.t{width:100%;border-collapse:collapse;margin-bottom:20px;}
    table.t th{text-align:left;padding:9px 11px;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:1.1px;color:#7c1d2c;border-bottom:1px solid #7c1d2c;}
    table.t td{padding:9px 11px;border-bottom:1px solid #ededed;vertical-align:top;}
    table.t td.num,table.t th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
    .gw{font-family:Georgia,'Times New Roman',serif;font-weight:400;margin:24px 0 9px;font-size:14.5px;color:#1b2230;letter-spacing:.5px;}
    .gw::before{content:"";display:inline-block;width:16px;height:1.5px;background:#7c1d2c;vertical-align:middle;margin-right:9px;margin-bottom:3px;}
    .muted{color:#b4bac1;}
    .conf{display:inline-block;border:1px solid #7c1d2c;color:#7c1d2c;border-radius:2px;padding:2px 10px;font-size:8.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;}
    .ft{margin-top:36px;border-top:1px solid #e6e9ed;padding-top:11px;color:#aab2bd;font-size:8.5px;display:flex;justify-content:space-between;letter-spacing:.5px;text-transform:uppercase;}
    @media print{${pg}}`;
  const footer = design === 'modern'
    ? `<div class="ft"><span><b>${esc(b.firma || '')}</b>${b.email ? ' · ' + esc(b.email) : ''}</span><span>${fmtDate(todayIso())}</span></div>`
    : `<div class="ft"><span>${esc(b.firma || 'submit one')}</span><span>Erstellt mit submit one · ${fmtDate(todayIso())}</span></div>`;
  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>${design === 'modern' ? styleModern : styleStandard}${opts.extraCss || ''}</style></head><body><div class="page">
    ${design === 'modern' ? '<div class="accent-top"></div>' : ''}
    <div class="lh"><div class="logo">${logo}</div><div class="meta">${addr}</div></div>
    <h1>${esc(title)}</h1>
    <div class="sub">${subtitleHtml}</div>
    ${inner}
    ${footer}
  </div>
  <script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast('Bitte Popups für PDF erlauben', 'info'); return; }
  w.document.write(html); w.document.close();
}

function pdfSubmittenten(pid) {
  const p = findProjekt(pid); if (!p) return;
  const gw = gewerkeSorted(p);
  const inner = gw.length ? gw.map(v => {
    const eing = (v.eingeladene || []);
    const rows = eing.length ? eing.map(e => {
      const bq = eBetragQuelle(v, e);
      return `<tr><td>${esc(e.firma)}</td><td>${INV_STATUS[e.status]?.label || esc(e.status)}</td><td>${bq.quelle || '–'}</td><td class="num">${bq.betrag != null ? chf(bq.betrag) : '–'}</td></tr>`;
    }).join('')
      : `<tr><td colspan="4" class="muted">noch niemand eingeladen</td></tr>`;
    return `<div class="gw">BKP ${esc(v.bkp)} – ${esc(v.gewerk)}</div>
      <table class="t"><thead><tr><th>Firma</th><th style="width:120px">Status</th><th style="width:110px">Grundlage</th><th class="num" style="width:140px">Betrag</th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join('') : '<p class="muted">Keine Gewerke angelegt.</p>';
  const sub = `${esc(p.name)} · ${esc(p.ort)} · Bauherr: ${esc(p.bauherr)} &nbsp; <span class="conf">VERTRAULICH – nicht an die Baustelle</span>`;
  openPrintDoc('Submittentenliste', sub, inner);
}

function pdfUnternehmer(pid) {
  const p = findProjekt(pid); if (!p) return;
  const gw = gewerkeSorted(p);
  const rows = gw.length ? gw.map(v => {
    const vergeben = isVergeben(v) && v.firma;
    const k = vergeben ? kontaktByFirma(v.firma) : null;
    const kontakt = vergeben && k ? esc([k.person, k.telefon].filter(Boolean).join(' · ')) : '';
    return `<tr><td>${esc(v.bkp)}</td><td>${esc(v.gewerk)}</td><td>${vergeben ? '<b>' + esc(v.firma) + '</b>' : '<span class="muted">noch nicht vergeben</span>'}</td><td>${kontakt}</td></tr>`;
  }).join('') : '<tr><td colspan="4" class="muted">Keine Gewerke angelegt.</td></tr>';
  const sub = `${esc(p.name)} · ${esc(p.ort)} · Bauherr: ${esc(p.bauherr)} · Stand ${fmtDate(todayIso())}`;
  openPrintDoc('Unternehmerliste', sub,
    `<table class="t"><thead><tr><th style="width:60px">BKP</th><th>Gewerk</th><th>Unternehmer</th><th>Kontakt</th></tr></thead><tbody>${rows}</tbody></table>`);
}

/* ---------------------------------------------------------------
   Honorar-Rechner (Architektenhonorar nach Baukosten, SIA 102:2003)
   --------------------------------------------------------------- */

const HONORAR_PHASEN = [
  { key: 'vorprojekt',    label: 'Vorprojekt',                    pct: 9 },
  { key: 'bauprojekt',    label: 'Bauprojekt',                    pct: 21 },
  { key: 'bewilligung',   label: 'Bewilligungsverfahren',         pct: 2 },
  { key: 'ausschreibung', label: 'Ausschreibung / Vergabe',       pct: 18 },
  { key: 'ausfplanung',   label: 'Ausführungsplanung',            pct: 16 },
  { key: 'ausfuehrung',   label: 'Ausführung / Bauleitung',       pct: 30 },
  { key: 'abschluss',     label: 'Inbetriebnahme, Abschluss',     pct: 4 },
];

function n2(x) { return Number(String(x ?? '').replace(/['’\s]/g, '').replace(',', '.')) || 0; }

let honorarData = null;
let honorarDetail = false;
let honorarPid = null;   // gesetzt = Honorar des Projekts (p.honorar), sonst globaler Rechner (localStorage)
function honorarDefaults() {
  const pct = {}; HONORAR_PHASEN.forEach(p => pct[p.key] = p.pct);
  return { projekt: '', B: '', Z1: 0.062, Z2: 10.30, n: 1, r: 1, i: 1, s: 1, h: 135, mwst: 8.1, pct };
}
function loadHonorar() {
  if (honorarPid) {
    const p = findProjekt(honorarPid);
    if (p) { if (!p.honorar) { p.honorar = honorarDefaults(); p.honorar.projekt = p.name; } if (!p.honorar.pct) p.honorar.pct = honorarDefaults().pct; return p.honorar; }
  }
  if (!honorarData) { try { honorarData = JSON.parse(localStorage.getItem('so_honorar') || 'null'); } catch (_) {} }
  if (!honorarData) honorarData = honorarDefaults();
  if (!honorarData.pct) honorarData.pct = honorarDefaults().pct;
  return honorarData;
}
function saveHonorarData() {
  if (honorarPid) { save(); return; }
  try { localStorage.setItem('so_honorar', JSON.stringify(honorarData)); } catch (_) {}
}

function computeHonorar(d) {
  const B = n2(d.B);
  const p = B > 0 ? (n2(d.Z1) + n2(d.Z2) / Math.cbrt(B)) : 0;
  const n = n2(d.n), r = n2(d.r), i = n2(d.i), s = n2(d.s), h = n2(d.h);
  const rows = HONORAR_PHASEN.map(ph => {
    const pct = n2(d.pct[ph.key]);
    const Tp = B * (p / 100) * n * (pct / 100) * r * i;   // prognostizierter Zeitaufwand (inkl. Teamfaktor)
    return { key: ph.key, label: ph.label, pct, Tp, H: Tp * h * s };
  });
  const q = rows.reduce((a, x) => a + x.pct, 0);
  const Tp = rows.reduce((a, x) => a + x.Tp, 0);
  const H = rows.reduce((a, x) => a + x.H, 0);
  const mwst = n2(d.mwst);
  return { p, q, rows, Tp, H, mwst, Hmwst: H * (1 + mwst / 100) };
}

function viewHonorar() {
  const d = loadHonorar();
  const fld = (id, label, val, hint = '') => `<label class="field">${label}
    <input class="input hon-in" id="${id}" value="${esc(String(val))}" inputmode="decimal">
    ${hint ? `<span class="muted" style="font-size:11px;font-weight:400;display:block;margin-top:3px;line-height:1.4">${hint}</span>` : ''}</label>`;
  const phaseRows = HONORAR_PHASEN.map(ph => `
    <tr>
      <td>${esc(ph.label)}</td>
      <td class="num"><input class="input hon-in" id="h_pct_${ph.key}" value="${esc(String(d.pct[ph.key] ?? ph.pct))}" inputmode="decimal" style="width:72px;text-align:right;padding:4px 6px"></td>
      <td class="num" id="hon_tp_${ph.key}">–</td>
      <td class="num" id="hon_h_${ph.key}">–</td>
    </tr>`).join('');

  const pj = honorarPid ? findProjekt(honorarPid) : null;
  const head = pj
    ? `<div class="breadcrumb"><a href="#/projekte">Projekte</a> › ${esc(pj.name)}</div>
       <div class="detail-head"><div><h1 style="margin:0;font-size:23px">${esc(pj.name)}</h1><div class="sub" style="margin-top:5px">Honorar-Rechner · SIA 102 (2003)</div></div>
         <button class="btn" data-act="pdf-honorar">⬇ PDF</button></div>
       ${projektTabs(pj, 'honorar')}`
    : `<div class="page-head"><div><h1>Honorar-Rechner</h1><div class="sub">Architektenhonorar nach Baukosten · SIA 102 (2003)</div></div>
         <button class="btn" data-act="pdf-honorar">⬇ PDF</button></div>`;
  render(`
    ${head}
    ${demoBanner('honorar')}

    <div class="card card-pad" style="max-width:780px;margin-bottom:16px;background:var(--brand-soft);border-color:transparent">
      <h2 style="margin-top:0;font-size:15px">In 3 Schritten zum Honorar</h2>
      <ol style="margin:0;padding-left:18px;font-size:13px;line-height:1.8">
        <li>Ungefähre <strong>Baukosten</strong> eingeben.</li>
        <li><strong>Schwierigkeit</strong> wählen (meistens „normal").</li>
        <li><strong>Stundenansatz</strong> deines Büros eingeben (z.B. 140 CHF/h).</li>
      </ol>
      <p style="margin:10px 0 0;font-size:13px">→ Das Honorar erscheint sofort unten. Mehr musst du nicht tun. Alles andere ist bereits sinnvoll voreingestellt.</p>
    </div>

    <details style="max-width:780px;margin-bottom:16px">
      <summary style="cursor:pointer;font-weight:600;font-size:13.5px;padding:6px 0">❓ Was bedeuten diese Fachbegriffe? (kurz erklärt)</summary>
      <div class="card card-pad" style="font-size:13px;line-height:1.6;margin-top:8px">
        <p style="margin:0 0 10px"><strong>Baukosten:</strong> Wie viel der Bau ungefähr kostet (ohne MwSt). Das Honorar wird als Anteil davon berechnet – grössere Bauten = mehr Arbeit = höheres Honorar.</p>
        <p style="margin:0 0 10px"><strong>Schwierigkeit (Schwierigkeitsgrad):</strong> Wie aufwändig der Bau ist. Eine einfache Lagerhalle macht weniger Arbeit als eine anspruchsvolle Villa. Für die meisten Wohn- und Geschäftshäuser passt <strong>„normal"</strong>.</p>
        <p style="margin:0 0 10px"><strong>SIA-Koeffizienten (Z1/Z2):</strong> Zwei feste Zahlen, die der Schweizer Architektenverband (SIA) jedes Jahr herausgibt. Sie sorgen dafür, dass das Honorar zur Teuerung passt. <strong>Für eine Schätzung lässt du die Standardwerte einfach stehen.</strong> Für eine exakte Abrechnung trägst du (unter „Detaileinstellungen") die aktuellen Werte des Jahres ein – die bekommst du beim SIA bzw. der KBOB.</p>
        <p style="margin:0 0 10px"><strong>Anpassungs-, Team- und Sonderleistungs-Faktor:</strong> Feinjustierungen für Spezialfälle. <strong>Wenn du unsicher bist: nicht anfassen</strong> – sie stehen auf 1.0 und ändern dann nichts am Ergebnis.</p>
        <p style="margin:0"><strong>Stundenansatz:</strong> Was dein Büro pro Arbeitsstunde verrechnet (oft 130–160 CHF/h).</p>
      </div>
    </details>

    <div class="card card-pad" style="max-width:780px;margin-bottom:16px">
      <h2 style="margin-top:0;font-size:15px">Deine Eingaben</h2>
      <label class="field">Projekt / Bezeichnung
        <input class="input hon-in" id="h_projekt" value="${esc(d.projekt)}" placeholder="z.B. Neubau MFH Bärenmätteli">
      </label>
      <label class="field">1. Baukosten (CHF)
        <input class="input hon-in" id="h_B" value="${esc(String(d.B))}" inputmode="decimal" placeholder="z.B. 3350000">
        <span class="muted" style="font-size:11px;font-weight:400;display:block;margin-top:3px;line-height:1.4">Wie viel kostet der Bau ungefähr? (ohne MwSt)</span>
      </label>
      <label class="field">2. Schwierigkeit
        <select class="select hon-in" id="h_n">
          <option value="0.85"${n2(d.n) === 0.85 ? ' selected' : ''}>einfach – z.B. Lager-/Zweckbau</option>
          <option value="1"${n2(d.n) !== 0.85 && n2(d.n) !== 1.15 ? ' selected' : ''}>normal – z.B. Wohn-/Geschäftshaus</option>
          <option value="1.15"${n2(d.n) === 1.15 ? ' selected' : ''}>anspruchsvoll – z.B. aufwändiger Umbau / Villa</option>
        </select>
        <span class="muted" style="font-size:11px;font-weight:400;display:block;margin-top:3px;line-height:1.4">Im Zweifel „normal" wählen.</span>
      </label>
      <label class="field">3. Stundenansatz (CHF pro Stunde)
        <input class="input hon-in" id="h_h" value="${esc(String(d.h))}" inputmode="decimal" placeholder="z.B. 140">
        <span class="muted" style="font-size:11px;font-weight:400;display:block;margin-top:3px;line-height:1.4">Was dein Büro pro Arbeitsstunde verrechnet (oft 130–160).</span>
      </label>
    </div>

    <div style="max-width:780px;margin-bottom:16px">
      <button class="btn secondary sm" data-act="honorar-detail">${honorarDetail ? '▲ Detaileinstellungen ausblenden' : '▼ Detaileinstellungen (SIA-Koeffizienten, Faktoren, Phasen) – optional'}</button>
    </div>

    ${honorarDetail ? `
    <div class="card card-pad" style="max-width:780px;margin-bottom:16px">
      <h2 style="margin-top:0;font-size:15px">Detaileinstellungen <span class="muted" style="font-size:12px;font-weight:400">– nur für genaue Abrechnung, sonst so lassen</span></h2>
      <div class="form-row">
        ${fld('h_Z1', 'SIA-Koeffizient Z1', d.Z1, 'Jährlicher SIA-/KBOB-Wert.')}
        ${fld('h_Z2', 'SIA-Koeffizient Z2', d.Z2, 'Jährlicher SIA-/KBOB-Wert.')}
      </div>
      <p class="muted" style="font-size:11.5px;margin:-2px 0 12px">Grundfaktor <strong>p = Z1 + Z2 / ∛B</strong>. Aktuelle Werte des Jahres beim SIA/KBOB nachschlagen.</p>
      <div class="form-row">
        ${fld('h_r', 'Anpassungsfaktor r', d.r, 'Besondere Umstände. Standard 1.0.')}
        ${fld('h_i', 'Teamfaktor i', d.i, 'Büro-/Teamgrösse. Standard 1.0.')}
      </div>
      <div class="form-row">
        ${fld('h_s', 'Sonderleistungen s', d.s, 'Zuschlag Sonderleistungen. Standard 1.0.')}
        ${fld('h_mwst', 'MwSt %', d.mwst, 'CH zurzeit 8.1 %.')}
      </div>
      <h3 style="font-size:13.5px;margin:18px 0 6px">Leistungsphasen · Anteile</h3>
      <table class="grid">
        <thead><tr><th>Phase</th><th class="num" style="width:90px">Anteil %</th><th class="num" style="width:120px">Stunden</th><th class="num" style="width:150px">Honorar</th></tr></thead>
        <tbody>${phaseRows}</tbody>
      </table>
      <p class="muted" style="font-size:11.5px;margin:8px 0 0">Standard = volle Grundleistungen (100 %). Anteile reduzieren, falls Phasen entfallen (z.B. Vorprojekt durch anderes Büro).</p>
    </div>` : ''}

    <div class="card card-pad" style="max-width:780px" id="hon_out"></div>
  `);

  $$('.hon-in').forEach(el => el.addEventListener('input', honorarOnInput));
  honorarRenderResult();
}

function honorarOnInput() {
  const d = loadHonorar();
  // nur vorhandene Felder übernehmen (Detailfelder können ausgeblendet sein)
  const set = (k, id) => { const el = $('#' + id); if (el) d[k] = el.value; };
  set('projekt', 'h_projekt'); set('B', 'h_B'); set('Z1', 'h_Z1'); set('Z2', 'h_Z2');
  set('n', 'h_n'); set('r', 'h_r'); set('i', 'h_i'); set('s', 'h_s'); set('h', 'h_h'); set('mwst', 'h_mwst');
  HONORAR_PHASEN.forEach(ph => { const el = $('#h_pct_' + ph.key); if (el) d.pct[ph.key] = el.value; });
  saveHonorarData();
  honorarRenderResult();
}

function honorarRenderResult() {
  const d = loadHonorar();
  const c = computeHonorar(d);
  c.rows.forEach(row => {
    const tp = $('#hon_tp_' + row.key), hh = $('#hon_h_' + row.key);
    if (tp) tp.textContent = row.Tp ? row.Tp.toLocaleString('de-CH', { maximumFractionDigits: 0 }) + ' h' : '–';
    if (hh) hh.textContent = chf(row.H);
  });
  const out = $('#hon_out'); if (!out) return;
  const fmt = (x, dec = 0) => (x || 0).toLocaleString('de-CH', { maximumFractionDigits: dec });
  const B = n2(d.B), cb = B > 0 ? Math.cbrt(B) : 0;

  if (B <= 0 || n2(d.h) <= 0) {
    out.innerHTML = `<h2 style="margin-top:0;font-size:15px">Dein Honorar</h2>
      <p class="muted" style="margin:0">Gib oben die <strong>Baukosten</strong> und den <strong>Stundenansatz</strong> ein – das Honorar erscheint dann automatisch hier.</p>`;
    return;
  }
  const pctOfB = c.H / B * 100;
  out.innerHTML = `
    <h2 style="margin-top:0;font-size:15px">Dein Honorar</h2>
    <div class="kpi-row" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi"><div class="k-label">Honorar inkl. MwSt</div><div class="k-value" style="font-size:21px">${chf(c.Hmwst)}</div></div>
      <div class="kpi"><div class="k-label">Honorar exkl. MwSt</div><div class="k-value" style="font-size:20px">${chf(c.H)}</div></div>
      <div class="kpi"><div class="k-label">Geschätzte Stunden</div><div class="k-value" style="font-size:20px">${fmt(c.Tp)} h</div></div>
      <div class="kpi"><div class="k-label">≈ Anteil der Baukosten</div><div class="k-value" style="font-size:20px">${pctOfB.toFixed(1)} %</div></div>
    </div>
    <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
      <h3 style="font-size:13.5px;margin:0 0 8px">So kommt diese Zahl zustande</h3>
      <div style="font-size:13px;line-height:1.85">
        <div><strong>1.</strong> Aus Baukosten und Schwierigkeit ergeben sich die geschätzten <strong>Arbeitsstunden: ≈ ${fmt(c.Tp)} h</strong>.</div>
        <div><strong>2.</strong> Stunden × Stundenansatz: ${fmt(c.Tp)} h × ${esc(String(d.h))} CHF = <strong>${chf(c.H)}</strong> (ohne MwSt).</div>
        <div><strong>3.</strong> + MwSt ${c.mwst} % = <strong>${chf(c.Hmwst)}</strong> &nbsp;← Endbetrag.</div>
      </div>
      <details style="margin-top:10px">
        <summary style="cursor:pointer;font-size:12px;color:var(--text-soft)">Genaue SIA-Formel anzeigen</summary>
        <div style="font-size:12px;line-height:1.9;font-variant-numeric:tabular-nums;margin-top:6px">
          Grundfaktor p = Z1 + Z2 ∕ ∛B = ${esc(String(d.Z1))} + ${esc(String(d.Z2))} ∕ ${fmt(cb)} = ${c.p.toFixed(4)}<br>
          Stunden = Baukosten · p∕100 · Schwierigkeit · Leistungsanteil(${c.q}%)∕100 · r · i = ${fmt(c.Tp)} h<br>
          Honorar = Stunden · Stundenansatz · s = ${chf(c.H)}
        </div>
      </details>
    </div>`;
}

function pdfHonorar() {
  const d = loadHonorar(); const c = computeHonorar(d);
  const rows = c.rows.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${r.pct} %</td><td class="num">${r.Tp.toLocaleString('de-CH', { maximumFractionDigits: 0 })}</td><td class="num">${chf(r.H)}</td></tr>`).join('');
  const inner = `
    <table class="t" style="margin-bottom:14px">
      <tr><td>Aufwandbestimmende Baukosten B</td><td class="num">${chf(n2(d.B))}</td></tr>
      <tr><td>Grundfaktor p = Z1 + Z2 / ∛B&nbsp; (Z1 = ${esc(String(d.Z1))}, Z2 = ${esc(String(d.Z2))})</td><td class="num">${c.p.toFixed(4)}</td></tr>
      <tr><td>Schwierigkeitsgrad n · Anpassung r · Team i · Sonderleist. s</td><td class="num">${esc(String(d.n))} · ${esc(String(d.r))} · ${esc(String(d.i))} · ${esc(String(d.s))}</td></tr>
      <tr><td>Stundenansatz h</td><td class="num">CHF ${esc(String(d.h))}/h</td></tr>
    </table>
    <table class="t">
      <thead><tr><th>Leistungsphase</th><th class="num" style="width:80px">Anteil</th><th class="num" style="width:100px">Stunden</th><th class="num" style="width:140px">Honorar</th></tr></thead>
      <tbody>${rows}
        <tr><td><b>Total Grundleistungen</b></td><td class="num"><b>${c.q} %</b></td><td class="num"><b>${c.Tp.toLocaleString('de-CH', { maximumFractionDigits: 0 })}</b></td><td class="num"><b>${chf(c.H)}</b></td></tr>
      </tbody>
    </table>
    <table class="t" style="margin-top:12px;width:60%;margin-left:auto">
      <tr><td>Honorar exkl. MwSt</td><td class="num">${chf(c.H)}</td></tr>
      <tr><td>MwSt ${esc(String(d.mwst))} %</td><td class="num">${chf(c.Hmwst - c.H)}</td></tr>
      <tr><td><b>Total inkl. MwSt</b></td><td class="num"><b>${chf(c.Hmwst)}</b></td></tr>
    </table>
    <p class="muted" style="margin-top:14px;font-size:10.5px">Berechnung nach Baukosten gemäss Ordnung SIA 102 (2003). Z1/Z2 = SIA-Koeffizienten des gewählten Jahres. Ohne Gewähr.</p>`;
  const sub = `${d.projekt ? esc(d.projekt) + ' · ' : ''}Architektenhonorar nach Baukosten · SIA 102 (2003) · Stand ${fmtDate(todayIso())}`;
  openPrintDoc('Honorarberechnung', sub, inner);
}

/* ---------------------------------------------------------------
   Bauherr: Entscheidungsliste + Auswahl-Firmen (Bemusterung)
   --------------------------------------------------------------- */

const ENTSCHEID_BEREICHE = ['Allgemein', 'Küche', 'Bad / Sanitär', 'Böden / Fliesen', 'Wände / Farben', 'Fenster / Türen', 'Elektro / Beleuchtung', 'Heizung / Lüftung', 'Aussenanlage', 'Material / Bemusterung'];
const BEZUG_KATEGORIEN = ['Küche', 'Küchengeräte', 'Bad- / Sanitärapparate', 'Fliesen / Plättli', 'Parkett / Bodenbeläge', 'Teppich / Bodenbeläge', 'Innentüren', 'Beleuchtung', 'Storen / Beschattung', 'Garten / Aussenanlage'];

// Standard-Bemusterungspunkte mit BKP (das, was die Bauherrschaft typischerweise aussucht)
const BEMUSTERUNG_STANDARD = [
  { thema: 'Küche', bkp: '258' },
  { thema: 'Sanitärapparate & Armaturen', bkp: '250' },
  { thema: 'Fliesen / Plättli', bkp: '282.4' },
  { thema: 'Parkett / Bodenbeläge', bkp: '281.7' },
  { thema: 'Innentüren', bkp: '273' },
  { thema: 'Schränke / Einbauten', bkp: '273' },
  { thema: 'Wandfarben / Anstrich', bkp: '285' },
  { thema: 'Beleuchtung / Elektro', bkp: '230' },
  { thema: 'Storen / Beschattung', bkp: '228' },
];
const ENT_STATUS = {
  offen:     { label: 'offen',   color: 'amber' },
  gewaehlt:  { label: 'gewählt', color: 'green' },
  entfaellt: { label: 'entfällt', color: 'grey' },
};
const entStatus = e => (e.status === 'entschieden' ? 'gewaehlt' : (ENT_STATUS[e.status] ? e.status : 'offen'));

function dl(id, items) { return `<datalist id="${id}">${items.map(x => `<option value="${esc(x)}">`).join('')}</datalist>`; }

// BKP-Katalog (Gebäude, BKP 2) – durchsuchbares Dropdown
const BKP_KATALOG = [
  ['20', 'Baugrube'], ['201', 'Baugrubenaushub'],
  ['21', 'Rohbau 1'], ['211', 'Baumeisterarbeiten'], ['211.1', 'Gerüste'],
  ['212', 'Montagebau in Beton / vorfab. Mauerwerk'], ['213', 'Montagebau in Stahl'], ['214', 'Montagebau in Holz'],
  ['215', 'Montagebau Leichtkonstruktionen'], ['216', 'Natur- und Kunststeinarbeiten'], ['217', 'Schutzraumabschlüsse'],
  ['22', 'Rohbau 2'], ['221', 'Fenster, Aussentüren, Tore'], ['222', 'Spenglerarbeiten'], ['223', 'Blitzschutz'],
  ['224', 'Bedachungsarbeiten'], ['225', 'Spezielle Dichtungen und Dämmungen'], ['226', 'Fassadenputze'],
  ['227', 'Äussere Oberflächenbehandlungen'], ['228', 'Äussere Abschlüsse, Sonnenschutz / Storen'],
  ['23', 'Elektroanlagen'], ['231', 'Apparate Starkstrom'], ['232', 'Starkstrominstallationen'], ['233', 'Leuchten und Lampen'],
  ['234', 'Energieverbraucher'], ['235', 'Apparate Schwachstrom'], ['236', 'Schwachstrominstallationen'], ['237', 'Gebäudeautomation'], ['238', 'Bauprovisorien'],
  ['24', 'Heizungs-, Lüftungs-, Klimaanlagen'], ['241', 'Zulieferung Energieträger, Lagerung'], ['242', 'Wärmeerzeugung'], ['243', 'Wärmeverteilung'],
  ['244', 'Lüftungsanlagen'], ['245', 'Klimaanlagen'], ['246', 'Kälteanlagen'], ['247', 'Spezialanlagen'], ['248', 'Dämmungen HLK-Installationen'],
  ['25', 'Sanitäranlagen'], ['251', 'Allgemeine Sanitärapparate'], ['252', 'Spezielle Sanitärapparate'], ['253', 'Sanitäre Ver-/Entsorgungsapparate'],
  ['254', 'Sanitärleitungen'], ['255', 'Dämmungen Sanitärinstallationen'], ['256', 'Sanitärinstallationselemente'], ['257', 'Elektro- und Pneumatiktafeln'], ['258', 'Kücheneinrichtungen'],
  ['26', 'Transportanlagen'], ['261', 'Aufzüge'], ['262', 'Fahrtreppen, Fahrsteige'], ['263', 'Fassadenreinigungsanlagen'], ['264', 'Sonstige Förderanlagen'], ['265', 'Hebeeinrichtungen'], ['266', 'Parkieranlagen'],
  ['27', 'Ausbau 1'], ['271', 'Gipserarbeiten'], ['272', 'Metallbauarbeiten'], ['273', 'Schreinerarbeiten'], ['274', 'Spezialverglasungen (innen)'], ['275', 'Schliessanlagen'], ['276', 'Innere Abschlüsse'], ['277', 'Elementwände'],
  ['28', 'Ausbau 2'], ['281', 'Bodenbeläge'], ['281.0', 'Unterlagsböden'], ['281.1', 'Fugenlose Bodenbeläge'], ['281.2', 'Bodenbeläge Kunststoff/Textil'], ['281.4', 'Bodenbeläge Naturstein'], ['281.5', 'Bodenbeläge Kunststein'], ['281.6', 'Bodenbeläge Plattenarbeiten'], ['281.7', 'Bodenbeläge in Holz / Parkett'], ['281.8', 'Doppelböden'],
  ['282', 'Wandbeläge, Wandbekleidungen'], ['282.0', 'Fugenlose Wandbeläge'], ['282.1', 'Tapezierarbeiten'], ['282.2', 'Wandverkleidung Naturstein'], ['282.3', 'Wandverkleidung Kunststein'], ['282.4', 'Wandbeläge Plattenarbeiten / Fliesen'], ['282.5', 'Wandverkleidung Holz'], ['282.6', 'Wandverkleidung Kunststoff/Textil'],
  ['283', 'Deckenbekleidungen'], ['284', 'Hafnerarbeiten'], ['285', 'Innere Oberflächenbehandlungen / Maler'], ['286', 'Bauaustrocknung'], ['287', 'Baureinigung'], ['288', 'Gärtnerarbeiten (Gebäude)'],
  ['29', 'Honorare'], ['291', 'Architekt'], ['292', 'Bauingenieur'], ['293', 'Elektroingenieur'], ['294', 'HLK-Ingenieur'], ['295', 'Sanitäringenieur'], ['296', 'Spezialisten'], ['296.2', 'Innenarchitekt'], ['298', 'Gebäudeautomationsingenieur'],
].map(([code, label]) => ({ code, label }));

function bkpDatalist(id) { return `<datalist id="${id}">${BKP_KATALOG.map(b => `<option value="${esc(b.code + ' ' + b.label)}">`).join('')}</datalist>`; }
// Durchsuchbarer Katalog zum Anklicken (Hauptgruppen als Überschrift, Positionen als Buttons)
function bkpCatRows(filter) {
  const q = (filter || '').trim().toLowerCase();
  const rows = BKP_KATALOG.filter(b => !q || (b.code + ' ' + b.label).toLowerCase().includes(q)).map(b => {
    if (/^\d{2}$/.test(b.code)) return `<div class="bkp-cat-grp">${esc(b.code)} · ${esc(b.label)}</div>`;
    return `<button type="button" class="bkp-cat-item" data-code="${esc(b.code)}" data-label="${esc(b.label)}"><span class="bkp-code">${esc(b.code)}</span> ${esc(b.label)}</button>`;
  }).join('');
  return rows || '<div class="muted" style="padding:8px;font-size:12.5px">Kein Treffer.</div>';
}
function bkpKatalogPanel() {
  return `<details id="bkpCat" style="margin-top:6px">
    <summary style="cursor:pointer;font-weight:600;font-size:13px;padding:4px 0">📖 Kompletten BKP-Katalog durchsuchen &amp; auswählen</summary>
    <input class="input" id="bkpCatSearch" placeholder="Code oder Gewerk filtern… (z.B. „Maler" oder „28")" style="margin:6px 0 4px" autocomplete="off">
    <div id="bkpCatList" class="bkp-cat-list">${bkpCatRows('')}</div>
  </details>`;
}
// Such-/Klick-Verhalten des Katalogs an die angegebenen Felder binden
function wireBkpKatalog(bkpId, gewerkId) {
  bkpId = bkpId || 'f_bkp'; gewerkId = gewerkId || 'f_gewerk';
  const s = $('#bkpCatSearch'), list = $('#bkpCatList'); if (!list) return;
  if (s) s.addEventListener('input', () => { list.innerHTML = bkpCatRows(s.value); });
  list.addEventListener('click', e => {
    const it = e.target.closest('.bkp-cat-item'); if (!it) return;
    const bkp = document.getElementById(bkpId), g = document.getElementById(gewerkId);
    if (bkp) bkp.value = it.dataset.code + ' ' + it.dataset.label;
    if (g) g.value = it.dataset.label;
    const det = $('#bkpCat'); if (det) det.open = false;
    toast(it.dataset.code + ' ' + it.dataset.label + ' übernommen', 'info');
  });
}
function parseBkp(val) {
  const m = String(val || '').trim().match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  return m ? { code: m[1], label: (m[2] || '').trim() } : { code: String(val || '').trim(), label: '' };
}
function bkpLabel(code) { const b = BKP_KATALOG.find(x => x.code === String(code)); return b ? b.label : ''; }

let katOpen = false;  // BKP-Katalog als Geister-Zeilen in der Liste ausgefahren
// Schalter für die Liste
function katToggleBtn() { return `<button class="btn sm ${katOpen ? '' : 'secondary'}" data-act="kat-toggle">📖 BKP-Katalog ${katOpen ? 'ausblenden' : 'einblenden'}</button>`; }
// Geister-Zeilen: alle noch nicht erfassten BKP-Positionen (aufgehellt, klickbar = erfassen)
function bkpGhostRows(p, totalCols, prefix) {
  if (!katOpen) return '';
  const have = new Set((p.vergaben || []).map(v => String(v.bkp)));
  return BKP_KATALOG.filter(b => !/^\d{2}$/.test(b.code) && !have.has(b.code) && (!prefix || b.code.startsWith(prefix))).map(b =>
    `<tr class="bkp-ghost" data-act="quickadd-bkp" data-pid="${p.id}" data-code="${esc(b.code)}" data-label="${esc(b.label)}" title="Klick = erfassen">
      <td><span class="bkp-code">${esc(b.code)}</span></td>
      <td>${esc(b.label)}</td>
      <td colspan="${totalCols - 2}" class="ghost-add">＋ erfassen</td>
    </tr>`).join('');
}
function quickAddVergabe(pid, code, label) {
  const p = findProjekt(pid); if (!p) return;
  (p.vergaben = p.vergaben || []).push({ id: uid('v'), bkp: code, gewerk: label, status: 'ausschreibung', firma: '', betrag: 0, schaetzung: 0, frist: '', eingeladene: [], nachtraege: [], rapporte: [], vorgaenge: [] });
  save(); router(); toast(code + ' ' + label + ' erfasst', 'ok');
}

/* --- Geführtes Inline-Panel je Gewerk (phasengerechte nächste Schritte) --- */
let gwOpen = new Set();
function gewerkHatBeschrieb(v) { return !!((v.beschrieb && v.beschrieb.trim()) || (v.ksPositionen && v.ksPositionen.length) || v.schaetzung > 0); }
// Phasengerechte nächste Schritte eines Gewerks: { hint, acts:[{action,label,primary}] }
function gewerkSteps(v) {
  const A = (action, label, primary) => ({ action, label, primary: !!primary });
  const s = v.status; let hint = '', acts = [];
  if (s === 'ausschreibung') {
    if (!gewerkHatBeschrieb(v)) { hint = 'Noch kein Baubeschrieb / keine Kostenschätzung – jetzt erfassen.'; acts = [A('ks', '✎ Beschrieb &amp; Kostenschätzung erfassen', true)]; }
    else if (!v.beschriebOk) { hint = 'Beschrieb &amp; Schätzung stehen – vom Bauherrn genehmigen lassen.'; acts = [A('genehmigt', '✓ Als genehmigt markieren', true), A('ks', '✎ bearbeiten')]; }
    else { hint = 'Genehmigt – Ausschreibung an die Submittenten versenden.'; acts = [A('ausschreiben', '✉ Ausschreibung versenden', true), A('advance', '→ Status: versendet')]; }
  } else if (['versendet', 'offerten', 'angebot_vers', 'angebot_erh'].includes(s)) {
    hint = 'Offerten / Abgebote erfassen und vergleichen.'; acts = [A('vergabeantrag', '📄 Offertvergleich / Vergabeantrag', true), A('advance', '→ nächster Schritt')];
  } else if (s === 'bewertung' || s === 'verhandlung') {
    hint = 'Offertvergleich vorhanden – Zuschlag vorbereiten.'; acts = [A('advance', '→ Zuschlag erteilen', true), A('vergabeantrag', '📄 Vergabeantrag')];
  } else if (s === 'vergeben') {
    hint = 'Zuschlag erteilt – Firmen informieren, dann Werkvertrag.'; acts = [A('zuschlag', '✉ Zuschlag-Mail', true), A('absage', '✉ Absage Unterlegene'), A('advance', '→ Werkvertrag')];
  } else if (s === 'werkvertrag' || s === 'unterzeichnet') {
    hint = 'Werkvertrag – bei Baustart in Ausführung setzen.'; acts = [A('advance', '→ In Ausführung', true)];
  } else if (s === 'ausfuehrung') {
    hint = 'In Ausführung – Rechnungen &amp; Nachträge laufend erfassen.'; acts = [A('rechnung', '🧾 Rechnung erfassen', true), A('nachtrag', '📐 Nachtrag'), A('advance', '→ Schlussrechnung')];
  } else if (s === 'schlussrechnung') {
    hint = 'Schlussrechnung in Prüfung.'; acts = [A('advance', '→ weiter', true), A('rechnung', '🧾 Rechnung')];
  } else if (s === 'maengel') {
    hint = 'Mängelbehebung – danach abschliessen.'; acts = [A('advance', '→ Abschliessen', true)];
  } else { hint = 'Gewerk abgeschlossen.'; }
  return { hint, acts };
}
function gewerkPanel(p, v) {
  const st = STATUS_BY_KEY[v.status] || {};
  const { hint, acts } = gewerkSteps(v);
  const btns = acts.map(a => `<button class="btn sm ${a.primary ? '' : 'secondary'}" data-act="gw-action" data-pid="${p.id}" data-vid="${v.id}" data-action="${a.action}">${a.label}</button>`).join('');
  return `<div class="gw-panel">
    <div class="gw-panel-top"><span class="st ${st.color || 'grey'}">${esc(st.label || v.status)}</span><span class="gw-hint">${hint}</span><a class="gw-open" href="#/projekt/${p.id}/vergabe/${v.id}">Vollständiges Detail öffnen ↗</a></div>
    ${btns ? `<div class="gw-actions">${btns}</div>` : ''}
  </div>`;
}
// Projekt-Board: pro Gewerk die wichtigste anstehende Aktion (sortiert nach Phase)
function projektNextStepsCard(p) {
  const items = (p.vergaben || []).map(v => ({ v, st: gewerkSteps(v) })).filter(x => x.st.acts.length && x.v.status !== 'abgeschlossen');
  if (!items.length) return '';
  items.sort((a, b) => statusIdx(a.v) - statusIdx(b.v));
  const rows = items.slice(0, 8).map(({ v, st }) => {
    const a = st.acts.find(x => x.primary) || st.acts[0];
    const stt = STATUS_BY_KEY[v.status] || {};
    return `<div class="ns-row">
      <span class="bkp-code">${esc(v.bkp)}</span>
      <span class="ns-gewerk">${esc(v.gewerk)}</span>
      <span class="st ${stt.color || 'grey'} ns-st">${esc(stt.kurz || v.status)}</span>
      <span class="ns-hint muted">${st.hint}</span>
      <button class="btn sm" data-act="gw-action" data-pid="${p.id}" data-vid="${v.id}" data-action="${a.action}">${a.label}</button>
    </div>`;
  }).join('');
  return `<div class="section-head"><h2>Nächste Schritte</h2><span class="hint">${items.length} offen · sortiert nach Phase</span></div>
    <div class="card card-pad ns-board">${rows}${items.length > 8 ? `<div class="muted" style="font-size:12px;margin-top:8px">+${items.length - 8} weitere – siehe Liste unten</div>` : ''}</div>`;
}
function gewerkAction(pid, vid, action) {
  const p = findProjekt(pid); const v = p && findVergabe(p, vid); if (!v) return;
  switch (action) {
    case 'ks': return actKostenschaetzung(pid, vid);
    case 'genehmigt': v.beschriebOk = true; save(); { const y = window.scrollY; router(); window.scrollTo(0, y); } toast('Beschrieb als genehmigt markiert', 'ok'); return;
    case 'ausschreiben': return mailEinladung(pid, vid);
    case 'advance': return advanceVergabe(pid, vid);
    case 'vergabeantrag': return pdfVergabeantrag(pid, vid);
    case 'zuschlag': return mailZuschlag(pid, vid);
    case 'absage': return mailAbsage(pid, vid);
    case 'rechnung': return actNewRechnung(pid, vid);
    case 'nachtrag': return actNewNachtrag(pid, vid);
  }
}

// Vergabe zu einem BKP-Code finden (exakt → 3-stellig → 2-stellige Gruppe)
function matchVergabeByBkp(p, bkp) {
  if (!bkp) return null;
  const code = String(bkp); const vs = p.vergaben || [];
  let v = vs.find(x => String(x.bkp || '') === code); if (v) return v;
  const three = code.split('.')[0];
  v = vs.find(x => String(x.bkp || '').split('.')[0] === three); if (v) return v;
  const two = three.slice(0, 2);
  return vs.find(x => String(x.bkp || '').slice(0, 2) === two && two.length === 2) || null;
}
// Beste Vergabe für einen Auswahlpunkt: explizit (vid) → BKP → Stichwort
function vergabeForEnt(p, e) {
  if (e.vid) { const v = findVergabe(p, e.vid); if (v) return v; }
  if (e.bkp) { const v = matchVergabeByBkp(p, e.bkp); if (v) return v; }
  return matchVergabe(p, e.thema);
}

// Auswahlpunkt → passendes Gewerk/Unternehmer im Projekt automatisch vorschlagen
const GEWERK_HINTS = {
  'küche': ['küche', 'küchen'], 'küchengeräte': ['küche', 'apparate', 'elektro'],
  'plättli': ['platten', 'plätt', 'fliesen', 'keramik'], 'fliesen': ['platten', 'plätt', 'fliesen', 'keramik'],
  'parkett': ['parkett', 'boden'], 'bodenbeläge': ['parkett', 'boden', 'bodenbel'], 'boden': ['parkett', 'boden', 'bodenbel'],
  'bad': ['sanitär', 'sanitaer', 'apparate'], 'sanitär': ['sanitär', 'sanitaer'], 'apparate': ['sanitär', 'apparate'], 'armatur': ['sanitär'],
  'türen': ['schreiner', 'türen', 'holz'], 'innentüren': ['schreiner', 'türen', 'holz'],
  'beleuchtung': ['elektro', 'beleucht'], 'elektro': ['elektro'],
  'farben': ['maler', 'farb'], 'wandfarben': ['maler', 'farb', 'gips'],
  'storen': ['storen', 'beschatt', 'sonnenschutz', 'metallbau'], 'schränke': ['schreiner', 'möbel', 'einbau'],
};
function matchVergabe(p, thema) {
  const t = (thema || '').toLowerCase(); if (!t) return null;
  const vs = p.vergaben || [];
  for (const key in GEWERK_HINTS) {
    if (t.includes(key)) { const hit = vs.find(v => GEWERK_HINTS[key].some(h => (v.gewerk || '').toLowerCase().includes(h))); if (hit) return hit; }
  }
  return vs.find(v => { const g = (v.gewerk || '').toLowerCase().split(/[ /]/)[0]; return g.length > 3 && t.includes(g); }) || null;
}
function vergabeLabel(v) { return `${v.bkp ? 'BKP ' + v.bkp + ' ' : ''}${v.gewerk || ''}${v.firma ? ' – ' + v.firma : (isVergeben(v) ? '' : ' (offen)')}`; }

// Generische Live-Suche in Kontakten (für mehrere Dialoge)
function kontaktPickButton(k) {
  return `<button type="button" data-id="${k.id}" class="ks-hit" style="display:block;width:100%;text-align:left;padding:7px 9px;border:1px solid var(--border);border-radius:7px;margin-bottom:5px;background:var(--surface);cursor:pointer;font-size:13px"><strong>${esc(k.firma)}</strong>${k.kategorie ? ` <span class="muted">· ${esc(k.kategorie)}</span>` : ''}${k.ort ? ` <span class="muted">· ${esc(k.ort)}</span>` : ''}</button>`;
}
function attachKontaktSuche(searchId, resultsId, onPick) {
  const sr = $('#' + searchId); if (!sr) return;
  sr.addEventListener('input', () => {
    const q = sr.value.trim().toLowerCase(); const box = $('#' + resultsId); if (!box) return;
    if (!q) { box.innerHTML = ''; return; }
    const hits = (state.kontakte || []).filter(k => (k.firma || '').toLowerCase().includes(q) || (k.kategorie || '').toLowerCase().includes(q) || (k.ort || '').toLowerCase().includes(q)).slice(0, 8);
    box.innerHTML = hits.length ? hits.map(kontaktPickButton).join('') : '<div class="muted" style="font-size:12px;padding:2px 4px">Keine Treffer in den Kontakten.</div>';
    box.querySelectorAll('.ks-hit').forEach(b => b.addEventListener('click', () => { const k = (state.kontakte || []).find(x => x.id === b.dataset.id); if (k) onPick(k, box); }));
  });
}

let bauherrWohnung = 'alle';   // Wohnungs-Filter im Bauherr-Tab

function viewBauherr(pid) {
  const p = findProjekt(pid);
  if (!p) { render(emptyState('⚠', 'Projekt nicht gefunden.')); return; }
  // Standard-Auswahlliste von Anfang an einblenden (einmalig, wenn noch leer)
  if (!(p.entscheidungen || []).length) {
    p.entscheidungen = BEMUSTERUNG_STANDARD.map(s => {
      const v = matchVergabeByBkp(p, s.bkp);
      return { id: uid('en'), datum: '', bereich: 'Bemusterung', thema: s.thema, bkp: s.bkp, entscheid: '', status: 'offen', vid: v ? v.id : '', ausstellung: null, wohnung: '' };
    });
    save();
  }
  const vergOf = e => vergabeForEnt(p, e);
  const bkpOf = e => e.bkp || (vergOf(e) && vergOf(e).bkp) || 'zzz';
  const allEnts = (p.entscheidungen || []).slice().sort((a, b) => bkpOf(a).localeCompare(bkpOf(b)) || (a.thema || '').localeCompare(b.thema || ''));
  const offen = allEnts.filter(e => entStatus(e) === 'offen').length;

  // Wohnungs-Filter – an die ECHTEN Einheiten geknüpft (EG links 70m² …), nicht an generische Nummern
  const einheiten = alleEinheiten(p);
  const hasWhg = einheiten.length >= 1;
  const selW = hasWhg ? bauherrWohnung : 'alle';
  const ents = selW === 'alle' ? allEnts : allEnts.filter(e => String(e.wohnung || '') === selW);
  const whgLabel = w => einheitName(p, w);
  const whgChips = hasWhg ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px">
    <span class="chip ${selW === 'alle' ? 'active' : ''}" data-act="bauherr-wohnung" data-pid="${p.id}" data-kind="alle">Alle</span>
    <span class="chip ${selW === '' ? 'active' : ''}" data-act="bauherr-wohnung" data-pid="${p.id}" data-kind="">Allgemein</span>
    ${einheiten.map(x => `<span class="chip ${selW === x.u.id ? 'active' : ''}" data-act="bauherr-wohnung" data-pid="${p.id}" data-kind="${x.u.id}">${esc(x.u.name || 'Wohnung')}${x.u.m2 ? ` · ${Number(x.u.m2)}m²` : ''}</span>`).join('')}
  </div>` : '';
  const firms = (p.bezugsfirmen || []);
  const byKat = {};
  firms.forEach(f => { const k = f.kategorie || 'Übrige'; (byKat[k] = byKat[k] || []).push(f); });
  const katKeys = Object.keys(byKat).sort((a, b) => a.localeCompare(b));

  const entsTable = ents.length ? `
    <table class="grid">
      <thead><tr><th style="width:52px">BKP</th>${hasWhg ? '<th style="width:78px">Wohnung</th>' : ''}<th style="width:112px">Status</th><th>Auswahlpunkt / Entscheid</th><th class="num" style="width:96px">Budget</th><th style="width:96px"></th></tr></thead>
      <tbody>${ents.map(e => { const v = vergOf(e); const bp = v ? (v.budgetposten || []).find(x => (x.text || '').toLowerCase() === (e.thema || '').toLowerCase()) : null; return `
        <tr class="${entStatus(e) !== 'offen' ? 'done-row' : ''}">
          <td class="muted">${e.bkp ? esc(e.bkp) : (v && v.bkp ? esc(v.bkp) : '–')}</td>
          ${hasWhg ? `<td class="muted" style="font-size:12px">${esc(whgLabel(e.wohnung || ''))}</td>` : ''}
          <td><select class="select ent-status" data-pid="${p.id}" data-eid="${e.id}" style="padding:3px 6px;font-size:12px">
            ${Object.keys(ENT_STATUS).map(k => `<option value="${k}"${entStatus(e) === k ? ' selected' : ''}>${ENT_STATUS[k].label}</option>`).join('')}
          </select></td>
          <td>${e.bereich ? `<span class="tag">${esc(e.bereich)}</span> ` : ''}<strong>${esc(e.thema || '')}</strong>${e.entscheid ? `<div class="muted" style="font-size:12.5px;margin-top:2px">${entStatus(e) === 'entfaellt' ? 'Grund: ' : ''}${esc(e.entscheid)}</div>` : ''}</td>
          <td class="num">${bp ? chf(bp.betrag) + (hatIst(bp) ? `<div class="muted" style="font-size:11.5px">Ist ${chf(Number(bp.ist) || 0)}</div>` : '') : '<span class="muted">–</span>'}</td>
          <td>
            <button class="x-btn" data-act="budget-auswahl" data-pid="${p.id}" data-eid="${e.id}" title="Budget erfassen/bearbeiten">💰</button>
            <button class="x-btn" data-act="edit-entscheidung" data-pid="${p.id}" data-eid="${e.id}" title="Bearbeiten">✏</button>
            <button class="x-btn" data-act="rm-entscheidung" data-pid="${p.id}" data-eid="${e.id}">×</button>
          </td>
        </tr>`; }).join('')}</tbody>
    </table>` : `<div class="card-pad" style="text-align:center">${emptyState('📋', 'Noch keine Auswahlpunkte erfasst.')}<button class="btn" data-act="standard-bemusterung" data-pid="${p.id}">＋ Standard-Auswahlliste einfügen</button></div>`;

  const firmsHtml = katKeys.length ? katKeys.map(k => `
    <div style="margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:5px">${esc(k)}</div>
      <table class="grid"><thead><tr><th>Firma</th><th style="width:120px">Ort</th><th style="width:180px">Kontakt</th><th style="width:170px">Web / Adresse</th><th style="width:40px"></th></tr></thead>
        <tbody>${byKat[k].map(f => `
          <tr>
            <td><strong>${esc(f.firma)}</strong>${f.notiz ? `<div class="muted" style="font-size:12px">${esc(f.notiz)}</div>` : ''}</td>
            <td>${esc(f.ort || '')}</td>
            <td>${esc([f.kontakt, f.telefon].filter(Boolean).join(' · '))}</td>
            <td class="muted">${esc(f.web || '')}</td>
            <td><button class="x-btn" data-act="rm-bezugsfirma" data-pid="${p.id}" data-fid="${f.id}">×</button></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`).join('') : emptyState('🏬', 'Noch keine Firmen erfasst.');

  const meldenRows = ents.map(e => {
    const v = vergabeForEnt(p, e);
    const k = v && v.firma ? kontaktByFirma(v.firma) : null;
    const untTxt = v
      ? `${esc(v.gewerk || '')}${v.firma ? `: <strong>${esc(v.firma)}</strong>` : ' <span class="muted">(noch nicht vergeben)</span>'}${k && (k.person || k.telefon) ? `<div class="muted" style="font-size:12px">${esc([k.person, k.telefon].filter(Boolean).join(' · '))}</div>` : ''}`
      : '<span class="muted">–</span>';
    const a = e.ausstellung;
    const ausTxt = a && a.firma
      ? `<strong>${esc(a.firma)}</strong>${a.ort ? ` · ${esc(a.ort)}` : ''}${a.telefon ? `<div class="muted" style="font-size:12px">${esc(a.telefon)}</div>` : ''}`
      : '<span class="muted">–</span>';
    return `<tr><td class="muted">${e.bkp ? esc(e.bkp) : (v && v.bkp ? esc(v.bkp) : '–')}</td>${hasWhg ? `<td class="muted" style="font-size:12px">${esc(whgLabel(e.wohnung || ''))}</td>` : ''}<td><strong>${esc(e.thema || '')}</strong></td><td>${untTxt}</td><td>${ausTxt}</td><td><span class="st ${ENT_STATUS[entStatus(e)].color}" style="font-size:10.5px;padding:2px 8px">${ENT_STATUS[entStatus(e)].label}</span></td></tr>`;
  }).join('');

  render(`
    <div class="breadcrumb"><a href="#/projekte">Projekte</a> › ${esc(p.name)}</div>
    <div class="detail-head"><div><h1 style="margin:0;font-size:23px">${esc(p.name)}</h1><div class="sub" style="margin-top:5px">Bauherr · Entscheide &amp; Auswahl-Firmen${hasWhg ? ` · ${p.wohnungen} Wohnungen` : ''}</div></div></div>
    ${projektTabs(p, 'bauherr')}
    ${demoBanner('bauherr')}
    ${whgChips}

    <div class="section-head"><h2>Auswahl &amp; Entscheidungen${offen ? ` <span class="tab-badge">${offen} offen</span>` : ''}</h2>
      <div style="display:flex;gap:6px">
        <button class="btn sm ghost" data-act="standard-bemusterung" data-pid="${p.id}" title="Übliche Auswahlpunkte ergänzen">＋ Standardliste</button>
        <button class="btn sm secondary" data-act="pdf-entscheidungen" data-pid="${p.id}">⬇ PDF</button>
        <button class="btn sm" data-act="new-entscheidung" data-pid="${p.id}">+ Eintrag</button>
      </div></div>
    <p class="muted" style="font-size:12.5px;margin:-4px 0 10px">Alle Auswahlpunkte vollständig führen. Jeder Punkt: <strong>offen</strong> → <strong>gewählt</strong>, oder <strong>entfällt</strong> (mit Grund). „Standardliste" ergänzt die üblichen Punkte.</p>
    <div class="card">${entsTable}</div>

    <div class="section-head" style="margin-top:26px"><h2>Bei wem melden <span class="muted" style="font-size:12px;font-weight:400">· Spiegelbild der Auswahlpunkte</span></h2>
      <button class="btn sm secondary" data-act="pdf-melden" data-pid="${p.id}">⬇ PDF</button></div>
    <p class="muted" style="font-size:12.5px;margin:-4px 0 10px">Pro Auswahlpunkt: ausführender Unternehmer (Werkvertrag, automatisch verknüpft) und – falls separat – die Ausstellung für die Materialauswahl.</p>
    <div class="card">${ents.length ? `<table class="grid"><thead><tr><th style="width:52px">BKP</th>${hasWhg ? '<th style="width:78px">Wohnung</th>' : ''}<th>Auswahlpunkt</th><th>Unternehmer (Werkvertrag)</th><th>Ausstellung / Materialauswahl</th><th style="width:88px">Status</th></tr></thead><tbody>${meldenRows}</tbody></table>` : emptyState('🔗', 'Noch keine Auswahlpunkte – oben anlegen.')}</div>

    <div class="section-head" style="margin-top:26px"><h2>Auswahl-Firmen (Bemusterung)</h2>
      <div style="display:flex;gap:6px">
        <button class="btn sm secondary" data-act="pdf-bezugsfirmen" data-pid="${p.id}">⬇ PDF</button>
        <button class="btn sm" data-act="new-bezugsfirma" data-pid="${p.id}">+ Firma</button>
      </div></div>
    <p class="muted" style="font-size:12.5px;margin:-4px 0 10px">Firmen / Ausstellungen, bei denen die Bauherrschaft auswählen kann (Küche, Bad, Fliesen, Parkett …) – zum Mitgeben.</p>
    <div class="card card-pad">${firmsHtml}</div>
  `);
  $$('.ent-status').forEach(sel => sel.addEventListener('change', () => setEntscheidungStatus(sel.dataset.pid, sel.dataset.eid, sel.value)));
}

function actNewEntscheidung(pid, eid) {
  const p = findProjekt(pid); const e = eid ? (p.entscheidungen || []).find(x => x.id === eid) : null;
  const curVid = e ? (e.vid || '') : '';
  const vopts = `<option value="">— kein / noch offen —</option>` + (p.vergaben || []).map(v => `<option value="${v.id}"${curVid === v.id ? ' selected' : ''}>${esc(vergabeLabel(v))}</option>`).join('');
  const aus = (e && e.ausstellung) || {};
  const curW = e ? String(e.wohnung || '') : (bauherrWohnung === 'alle' ? '' : bauherrWohnung);
  const einhListe = alleEinheiten(p);
  const wohnungSelect = einhListe.length >= 1 ? `<label class="field">Wohnung
      <select class="select" id="en_wohnung"><option value=""${curW === '' ? ' selected' : ''}>Allgemein (alle)</option>${einhListe.map(x => `<option value="${x.u.id}"${curW === x.u.id ? ' selected' : ''}>${esc(x.u.name || 'Wohnung')}${x.u.m2 ? ` · ${Number(x.u.m2)} m²` : ''}</option>`).join('')}</select>
    </label>` : '';
  openModal(e ? 'Auswahlpunkt bearbeiten' : 'Neuer Auswahlpunkt', `
    <label class="field">BKP <input class="input" id="en_bkp" list="dl_enbkp" value="${e ? esc(e.bkp || '') : ''}" placeholder="tippen: z.B. 282 oder „Fliesen“ …">${bkpDatalist('dl_enbkp')}</label>
    <div class="form-row">
      <label class="field">Auswahlpunkt / Thema <input class="input" id="en_thema" value="${e ? esc(e.thema || '') : ''}" placeholder="z.B. Plättli Bad"></label>
      <label class="field">Datum <input class="input" type="date" id="en_datum" value="${e ? esc(e.datum || '') : ''}"></label>
    </div>
    <label class="field">Auswahl / Beschreibung / Grund (falls entfällt) <textarea class="input" id="en_text" rows="2" placeholder="Was wurde gewählt? Oder: warum entfällt es?">${e ? esc(e.entscheid || '') : ''}</textarea></label>
    <div class="form-row">
      <label class="field">Status <select class="select" id="en_status">${Object.keys(ENT_STATUS).map(k => `<option value="${k}"${(e ? entStatus(e) : 'offen') === k ? ' selected' : ''}>${ENT_STATUS[k].label}</option>`).join('')}</select></label>
      ${wohnungSelect || '<label class="field">&nbsp;</label>'}
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:14px 0 10px">
    <label class="field">Unternehmer aus Projekt (Werkvertrag)
      <select class="select" id="en_vid">${vopts}</select>
      <span class="muted" style="font-size:11px;font-weight:400;display:block;margin-top:3px">Wer dieses Gewerk ausführt – erscheint im Spiegelbild „Bei wem melden".</span>
    </label>
    <label class="field">Ausstellung / Materialauswahl bei (optional) <input class="input" id="en_aussearch" placeholder="🔎 in Kontakten suchen…" autocomplete="off"></label>
    <div id="en_ausresults" style="margin:-4px 0 8px"></div>
    <div class="form-row">
      <label class="field">Ausstellung-Firma <input class="input" id="en_ausfirma" value="${esc(aus.firma || '')}" placeholder="z.B. Plättli-Ausstellung XY"></label>
      <label class="field">Ort <input class="input" id="en_ausort" value="${esc(aus.ort || '')}"></label>
    </div>
    <label class="field">Telefon Ausstellung <input class="input" id="en_austel" value="${esc(aus.telefon || '')}"></label>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="${e ? 'update-entscheidung' : 'save-entscheidung'}" data-pid="${pid}"${e ? ` data-eid="${eid}"` : ''}>${e ? 'Speichern' : 'Hinzufügen'}</button>`);
  attachKontaktSuche('en_aussearch', 'en_ausresults', (k, box) => {
    const set = (fid, val) => { const el = $('#' + fid); if (el && val != null) el.value = val; };
    set('en_ausfirma', k.firma); set('en_ausort', k.ort); set('en_austel', k.telefon);
    box.innerHTML = '<div class="muted" style="font-size:12px;padding:2px 4px">✓ aus Kontakt übernommen.</div>';
  });
  // BKP gewählt → Thema vorschlagen, falls noch leer
  const bkpEl = $('#en_bkp');
  if (bkpEl) bkpEl.addEventListener('change', () => {
    const { label } = parseBkp(bkpEl.value);
    const th = $('#en_thema');
    if (th && !th.value.trim() && label) th.value = label;
  });
}
function readEntscheidung() {
  const ausFirma = $('#en_ausfirma') ? $('#en_ausfirma').value.trim() : '';
  return {
    datum: $('#en_datum').value,
    bkp: $('#en_bkp') ? parseBkp($('#en_bkp').value).code : '',
    thema: $('#en_thema').value.trim(), entscheid: $('#en_text').value.trim(),
    status: $('#en_status').value,
    vid: $('#en_vid') ? $('#en_vid').value : '',
    wohnung: $('#en_wohnung') ? $('#en_wohnung').value : '',
    ausstellung: ausFirma ? { firma: ausFirma, ort: $('#en_ausort').value.trim(), telefon: $('#en_austel').value.trim() } : null,
  };
}
function saveEntscheidung(pid) {
  const p = findProjekt(pid); const d = readEntscheidung();
  if (!d.thema) { toast('Bitte ein Thema eingeben', 'info'); return; }
  (p.entscheidungen = p.entscheidungen || []).push({ id: uid('en'), ...d });
  save(); closeModal(); router(); toast('Entscheidung erfasst');
}
function updateEntscheidung(pid, eid) {
  const p = findProjekt(pid); const e = (p.entscheidungen || []).find(x => x.id === eid); if (!e) return;
  Object.assign(e, readEntscheidung()); save(); closeModal(); router(); toast('Gespeichert');
}
function setEntscheidungStatus(pid, eid, status) {
  const p = findProjekt(pid); const e = (p.entscheidungen || []).find(x => x.id === eid); if (!e) return;
  e.status = status;
  if (status === 'entfaellt' && !e.entscheid) {
    const grund = prompt('Grund, warum dieser Punkt entfällt:');
    if (grund) e.entscheid = grund.trim();
  }
  save(); router();
}

// Übliche Bemusterungspunkte ergänzen (nur fehlende, anhand des Themas)
function addStandardBemusterung(pid) {
  const p = findProjekt(pid);
  p.entscheidungen = p.entscheidungen || [];
  const w = bauherrWohnung === 'alle' ? '' : bauherrWohnung;
  const vorhanden = new Set(p.entscheidungen.map(e => (e.thema || '').toLowerCase().trim() + '|' + (e.wohnung || '')));
  let n = 0;
  BEMUSTERUNG_STANDARD.forEach(s => {
    if (!vorhanden.has(s.thema.toLowerCase() + '|' + w)) {
      const v = matchVergabeByBkp(p, s.bkp);
      p.entscheidungen.push({ id: uid('en'), datum: '', bereich: 'Bemusterung', thema: s.thema, bkp: s.bkp, entscheid: '', status: 'offen', vid: v ? v.id : '', ausstellung: null, wohnung: w });
      n++;
    }
  });
  save(); router();
  toast(n ? `${n} Auswahlpunkte ergänzt${w ? ' (Whg ' + w + ')' : ''}` : 'Alle Standardpunkte bereits vorhanden', 'info');
}
function removeEntscheidung(pid, eid) {
  const p = findProjekt(pid); p.entscheidungen = (p.entscheidungen || []).filter(x => x.id !== eid); save(); router();
}

function actNewBezugsfirma(pid) {
  openModal('Auswahl-Firma hinzufügen', `
    <label class="field">🔎 Aus Kontakten suchen <input class="input" id="bz_search" placeholder="Firmenname / Kategorie / Ort tippen…" autocomplete="off"></label>
    <div id="bz_results" style="margin:-4px 0 12px"></div>
    <label class="field">Kategorie <input class="input" id="bz_kat" list="dl_bzkat" placeholder="z.B. Küche">${dl('dl_bzkat', BEZUG_KATEGORIEN)}</label>
    <div class="form-row">
      <label class="field">Firma <input class="input" id="bz_firma" placeholder="Firmenname"></label>
      <label class="field">Ort <input class="input" id="bz_ort"></label>
    </div>
    <div class="form-row">
      <label class="field">Ansprechperson <input class="input" id="bz_kontakt"></label>
      <label class="field">Telefon <input class="input" id="bz_tel"></label>
    </div>
    <label class="field">Web / Adresse <input class="input" id="bz_web" placeholder="www… oder Strasse / Ort"></label>
    <label class="field">Notiz <input class="input" id="bz_notiz" placeholder="z.B. Ausstellung nach Vereinbarung"></label>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-bezugsfirma" data-pid="${pid}">Hinzufügen</button>`);
  attachKontaktSuche('bz_search', 'bz_results', (k, box) => {
    const set = (fid, val) => { const el = $('#' + fid); if (el && val != null) el.value = val; };
    set('bz_firma', k.firma); set('bz_ort', k.ort); set('bz_kontakt', k.person); set('bz_tel', k.telefon);
    if (k.email) set('bz_web', k.email);
    if (k.kategorie && $('#bz_kat') && !$('#bz_kat').value) set('bz_kat', k.kategorie);
    box.innerHTML = '<div class="muted" style="font-size:12px;padding:2px 4px">✓ aus Kontakt übernommen – unten prüfen &amp; speichern.</div>';
  });
}
function saveBezugsfirma(pid) {
  const p = findProjekt(pid); const firma = $('#bz_firma').value.trim();
  if (!firma) { toast('Bitte einen Firmennamen eingeben', 'info'); return; }
  (p.bezugsfirmen = p.bezugsfirmen || []).push({
    id: uid('bz'), kategorie: $('#bz_kat').value.trim() || 'Übrige', firma,
    ort: $('#bz_ort').value.trim(), kontakt: $('#bz_kontakt').value.trim(),
    telefon: $('#bz_tel').value.trim(), web: $('#bz_web').value.trim(), notiz: $('#bz_notiz').value.trim(),
  });
  save(); closeModal(); router(); toast('Firma hinzugefügt');
}
function removeBezugsfirma(pid, fid) {
  const p = findProjekt(pid); p.bezugsfirmen = (p.bezugsfirmen || []).filter(x => x.id !== fid); save(); router();
}

function pdfEntscheidungen(pid) {
  const p = findProjekt(pid); if (!p) return;
  const ents = (p.entscheidungen || []).slice().sort((a, b) => (a.datum || '').localeCompare(b.datum || ''));
  const rows = ents.length ? ents.map(e => `<tr><td>${e.datum ? fmtDate(e.datum) : ''}</td><td>${e.wohnung ? '<b>[Whg ' + esc(e.wohnung) + ']</b> ' : ''}${esc(e.thema || e.bereich || '')}</td><td>${e.entscheid ? esc(e.entscheid) : ''}</td><td>${ENT_STATUS[entStatus(e)].label}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">Keine Auswahlpunkte erfasst.</td></tr>';
  openPrintDoc('Entscheidungsliste', `${esc(p.name)} · ${esc(p.ort)} · Bauherr: ${esc(p.bauherr)} · Stand ${fmtDate(todayIso())}`,
    `<table class="t"><thead><tr><th style="width:90px">Datum</th><th style="width:170px">Auswahlpunkt</th><th>Auswahl / Entscheid / Grund</th><th style="width:90px">Status</th></tr></thead><tbody>${rows}</tbody></table>`);
}

function pdfMelden(pid) {
  const p = findProjekt(pid); if (!p) return;
  const ents = (p.entscheidungen || []);
  const rows = ents.length ? ents.map(e => {
    const v = e.vid ? findVergabe(p, e.vid) : matchVergabe(p, e.thema);
    const k = v && v.firma ? kontaktByFirma(v.firma) : null;
    const unt = v ? `${esc(v.gewerk || '')}${v.firma ? ': <b>' + esc(v.firma) + '</b>' : ' (noch nicht vergeben)'}${k && (k.person || k.telefon) ? '<br>' + esc([k.person, k.telefon].filter(Boolean).join(' · ')) : ''}` : '';
    const a = e.ausstellung;
    const aus = a && a.firma ? `<b>${esc(a.firma)}</b>${a.ort ? ' · ' + esc(a.ort) : ''}${a.telefon ? '<br>' + esc(a.telefon) : ''}` : '';
    return `<tr><td>${e.wohnung ? '<b>[Whg ' + esc(e.wohnung) + ']</b> ' : ''}<b>${esc(e.thema || '')}</b></td><td>${unt}</td><td>${aus}</td><td>${ENT_STATUS[entStatus(e)].label}</td></tr>`;
  }).join('') : '<tr><td colspan="4" class="muted">Keine Auswahlpunkte erfasst.</td></tr>';
  openPrintDoc('Bemusterung – bei wem melden', `${esc(p.name)} · ${esc(p.ort)} · für die Bauherrschaft`,
    `<table class="t"><thead><tr><th style="width:160px">Auswahlpunkt</th><th>Unternehmer (Werkvertrag)</th><th>Ausstellung / Materialauswahl</th><th style="width:80px">Status</th></tr></thead><tbody>${rows}</tbody></table>`);
}

function pdfBezugsfirmen(pid) {
  const p = findProjekt(pid); if (!p) return;
  const firms = (p.bezugsfirmen || []); const byKat = {};
  firms.forEach(f => { const k = f.kategorie || 'Übrige'; (byKat[k] = byKat[k] || []).push(f); });
  const keys = Object.keys(byKat).sort((a, b) => a.localeCompare(b));
  const inner = keys.length ? keys.map(k => `<div class="gw">${esc(k)}</div>
    <table class="t"><thead><tr><th>Firma</th><th style="width:120px">Ort</th><th style="width:180px">Kontakt</th><th style="width:170px">Web / Adresse</th></tr></thead>
      <tbody>${byKat[k].map(f => `<tr><td><b>${esc(f.firma)}</b>${f.notiz ? '<br><span style="color:#777">' + esc(f.notiz) + '</span>' : ''}</td><td>${esc(f.ort || '')}</td><td>${esc([f.kontakt, f.telefon].filter(Boolean).join(' · '))}</td><td>${esc(f.web || '')}</td></tr>`).join('')}</tbody></table>`).join('') : '<p class="muted">Keine Firmen erfasst.</p>';
  openPrintDoc('Auswahl-Firmen für die Bauherrschaft', `${esc(p.name)} · ${esc(p.ort)} · Bemusterung / Materialauswahl`, inner);
}

let protokollFilter = '';

function viewProtokolle(pid) {
  const p = findProjekt(pid);
  if (!p) { render(emptyState('⚠', 'Projekt nicht gefunden.')); return; }
  let list = (p.protokolle || []).slice().sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
  if (protokollFilter) list = list.filter(x => x.typ === protokollFilter);

  render(`
    <div class="breadcrumb"><a href="#/projekte">Projekte</a> › ${esc(p.name)}</div>
    <div class="detail-head">
      <div><h1 style="margin:0;font-size:23px">${esc(p.name)}</h1><div class="sub" style="margin-top:5px">Protokolle &amp; Aktennotizen</div></div>
      <div style="display:flex;gap:10px">
        <button class="btn secondary" data-act="new-protokoll" data-pid="${p.id}" data-kind="aktennotiz">+ Aktennotiz</button>
        <button class="btn" data-act="new-protokoll" data-pid="${p.id}" data-kind="sitzung">+ Sitzungsprotokoll</button>
      </div>
    </div>
    ${projektTabs(p, 'protokolle')}
    ${demoBanner('protokolle')}
    <div class="toolbar">
      <div class="chips">
        <span class="chip ${!protokollFilter ? 'active' : ''}" data-act="filter-prot" data-pid="${p.id}" data-kind="">Alle</span>
        <span class="chip ${protokollFilter === 'sitzung' ? 'active' : ''}" data-act="filter-prot" data-pid="${p.id}" data-kind="sitzung">Sitzungen</span>
        <span class="chip ${protokollFilter === 'aktennotiz' ? 'active' : ''}" data-act="filter-prot" data-pid="${p.id}" data-kind="aktennotiz">Aktennotizen</span>
      </div>
    </div>
    <div class="card">
      ${list.length ? `
      <table class="grid">
        <thead><tr><th>Typ</th><th>Titel</th><th>Datum</th><th class="num">Traktanden</th><th class="num">Teiln.</th><th></th></tr></thead>
        <tbody>
          ${list.map(pr => `
            <tr class="clickable" data-goto="#/projekt/${p.id}/protokoll/${pr.id}" data-ctx="protokoll" data-pid="${p.id}" data-prid="${pr.id}">
              <td><span class="st ${PROT_TYP[pr.typ].color}">${PROT_TYP[pr.typ].kurz}</span></td>
              <td><strong>${esc(protokollTitel(pr))}</strong></td>
              <td class="muted">${fmtDate(pr.datum)}</td>
              <td class="num">${(pr.traktanden || []).length}</td>
              <td class="num">${(pr.teilnehmer || []).length}</td>
              <td style="white-space:nowrap;text-align:right">
                <button class="btn sm ghost" data-act="copy-protokoll" data-pid="${p.id}" data-prid="${pr.id}">⧉ Kopieren</button>
                <button class="btn sm secondary" data-act="pdf-protokoll" data-pid="${p.id}" data-prid="${pr.id}">PDF</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>` : emptyState('🗒', 'Noch keine Protokolle. Erstelle ein Sitzungsprotokoll oder eine Aktennotiz.')}
    </div>
  `);
}

function personCard(label, kind, items, pid, prid) {
  return `<div class="dstat">
    <div class="l">${label} (${(items || []).length})</div>
    <div class="pchips">
      ${(items || []).map((nm, i) => `<span class="pchip">${esc(nm)}<button class="x-btn" data-act="rm-person" data-pid="${pid}" data-prid="${prid}" data-kind="${kind}" data-idx="${i}">×</button></span>`).join('') || '<span class="muted" style="font-size:12px">—</span>'}
    </div>
    <div class="chip-add">
      <input class="input" id="add_${kind}" placeholder="Name + Enter…" autocomplete="off">
      <button class="btn sm secondary" data-act="add-person" data-pid="${pid}" data-prid="${prid}" data-kind="${kind}">+</button>
      <button class="btn sm ghost" data-act="pick-personen" data-pid="${pid}" data-prid="${prid}" data-kind="${kind}" title="Aus Kontakten wählen">☎</button>
    </div>
  </div>`;
}

function traktandumCard(tr, pid, prid) {
  return `<div class="card" style="margin-bottom:14px">
    <div class="card-pad" style="display:flex;justify-content:space-between;align-items:center;padding-bottom:10px">
      <h3 style="margin:0;font-size:15px">${esc(tr.nr)}. ${esc(tr.titel)}</h3>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn sm ghost" data-act="new-eintrag" data-pid="${pid}" data-prid="${prid}" data-tid="${tr.id}">+ Eintrag</button>
        <button class="x-btn" data-act="rm-traktandum" data-pid="${pid}" data-prid="${prid}" data-tid="${tr.id}">×</button>
      </div>
    </div>
    ${(tr.eintraege || []).length ? `
    <table class="grid">
      <thead><tr><th style="width:36px"></th><th>Eintrag / Beschluss / Pendenz</th><th>Verantwortlich</th><th>Termin</th><th></th></tr></thead>
      <tbody>
        ${tr.eintraege.map(it => {
          const moved = it.art === 'pendenz' && it.uebertragen;
          return `
          <tr class="${(it.art === 'pendenz' && it.erledigt) || moved ? 'done-row' : ''}">
            <td>${it.art === 'pendenz' && !moved
                ? `<input type="checkbox" class="pend-check" ${it.erledigt ? 'checked' : ''} data-pid="${pid}" data-prid="${prid}" data-tid="${tr.id}" data-itemid="${it.id}" title="Pendenz erledigt">`
                : ''}</td>
            <td><span class="etext">${esc(it.text)}</span> ${eintragBadge(it)}${moved ? ' <span class="tag">→ übertragen</span>' : ''}</td>
            <td>${it.art === 'pendenz' ? esc(it.verantwortlich || '–') : '<span class="muted">–</span>'}</td>
            <td class="muted frist ${it.art === 'pendenz' && !it.erledigt ? fristClass(it.termin, false) : ''}">${it.termin ? fmtDate(it.termin) : '–'}</td>
            <td><button class="x-btn" data-act="rm-eintrag" data-pid="${pid}" data-prid="${prid}" data-tid="${tr.id}" data-itemid="${it.id}">×</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>` : `<div style="padding:0 16px 14px" class="muted">Keine Einträge.</div>`}
  </div>`;
}

function viewProtokollDetail(pid, prid) {
  const p = findProjekt(pid);
  const pr = p && findProtokoll(p, prid);
  if (!pr) { render(emptyState('⚠', 'Protokoll nicht gefunden.')); return; }
  const t = PROT_TYP[pr.typ];
  const pend = offenePendenzen(p);

  render(`
    <div class="breadcrumb">
      <a href="#/projekte">Projekte</a> › <a href="#/projekt/${p.id}">${esc(p.name)}</a> ›
      <a href="#/projekt/${p.id}/protokolle">Protokolle</a> › ${esc(protokollTitel(pr))}
    </div>
    <div class="detail-head">
      <div>
        <h1 style="margin:0;font-size:22px">${esc(protokollTitel(pr))} <span class="st ${t.color}" style="vertical-align:middle">${t.kurz}</span></h1>
        <div class="sub" style="margin-top:5px">${fmtDate(pr.datum)}${pr.zeit ? ' · ' + esc(pr.zeit) : ''}${pr.ort ? ' · ' + esc(pr.ort) : ''}${pr.leitung ? ' · Leitung: ' + esc(pr.leitung) : ''}</div>
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn secondary" data-act="copy-protokoll" data-pid="${p.id}" data-prid="${pr.id}">⧉ Kopieren</button>
        <button class="btn secondary" data-act="edit-protokoll" data-pid="${p.id}" data-prid="${pr.id}">Kopfdaten</button>
        <button class="btn secondary" data-act="mail-protokoll" data-pid="${p.id}" data-prid="${pr.id}" title="Protokoll an Verteiler senden">✉ Verteiler</button>
        <button class="btn secondary" data-act="pdf-protokoll" data-pid="${p.id}" data-prid="${pr.id}">⬇ PDF</button>
        <button class="btn" data-act="new-traktandum" data-pid="${p.id}" data-prid="${pr.id}">+ Traktandum</button>
      </div>
    </div>
    ${projektTabs(p, 'protokolle')}
    ${demoBanner('protokolle')}

    <div class="detail-stats" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr))">
      ${personCard('Anwesend', 'anwesend', pr.teilnehmer, p.id, pr.id)}
      ${personCard('Abwesend / entschuldigt', 'abwesend', pr.abwesende, p.id, pr.id)}
      ${personCard('Verteiler', 'verteiler', pr.verteiler, p.id, pr.id)}
    </div>

    <div class="section-head"><h2>Traktanden</h2><span class="hint">Einträge = Beschlüsse / Pendenzen mit Verantwortlichem &amp; Termin</span></div>
    ${(pr.traktanden || []).length ? pr.traktanden.map(tr => traktandumCard(tr, p.id, pr.id)).join('') : `<div class="card">${emptyState('📋', 'Noch keine Traktanden. Mit „+ Traktandum" beginnen.')}</div>`}

    ${pr.naechste ? `<p class="muted" style="margin-top:16px">Nächste Sitzung: <strong>${fmtDate(pr.naechste)}</strong></p>` : ''}

    <div class="section-head" style="margin-top:26px"><h2>Offene Pendenzen</h2><span class="hint">projektweit gesammelt · wird dem Protokoll/PDF angehängt</span></div>
    <div class="card">
      ${pend.length ? `
      <table class="grid">
        <thead><tr><th style="width:36px"></th><th>Pendenz</th><th>Verantwortlich</th><th>Termin</th><th>Herkunft</th></tr></thead>
        <tbody>
          ${pend.map(x => `
            <tr>
              <td><input type="checkbox" class="pend-check" data-pid="${p.id}" data-prid="${x.pr ? x.pr.id : ''}" data-tid="${x.tr ? x.tr.id : ''}" data-itemid="${x.it.id}" title="erledigt"></td>
              <td>${esc(x.it.text)}${pendFirmenChips(x.it)}</td>
              <td>${esc(x.it.verantwortlich || '–')}</td>
              <td class="muted frist ${fristClass(x.it.termin, false)}">${x.it.termin ? fristText(x.it.termin, false) : '–'}</td>
              <td class="muted">${x.pr ? esc(protokollTitel(x.pr)) + ' · ' + fmtDate(x.pr.datum) : 'direkt erfasst'}</td>
            </tr>`).join('')}
        </tbody>
      </table>` : emptyState('✓', 'Keine offenen Pendenzen — alles erledigt.')}
    </div>
  `);

  // Enter im Namensfeld fügt Person hinzu
  Object.keys(PERSON_FELD).forEach(k => {
    const el = $('#add_' + k);
    if (el) el.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); addPerson(pid, prid, k); } });
  });
  // Pendenzen abhaken (in Traktanden & in der Sammelliste)
  $$('.pend-check').forEach(cb => cb.addEventListener('change', () => togglePendenz(cb.dataset.pid, cb.dataset.prid, cb.dataset.tid, cb.dataset.itemid)));
}

/* --- Protokoll-Aktionen --- */

function actNewProtokoll(pid, typ) {
  typ = (typ === 'aktennotiz') ? 'aktennotiz' : 'sitzung';
  const p = findProjekt(pid);
  const t = PROT_TYP[typ];
  openModal('Neu: ' + t.label, `
    <input type="hidden" id="pr_typ" value="${typ}">
    <label class="field">Titel <span class="muted">(optional, sonst „${t.voll} Nr. ${nextProtNr(p, typ)}")</span>
      <input class="input" id="pr_titel" placeholder="${typ === 'sitzung' ? 'z.B. Bausitzung' : 'z.B. Absprache Fassadenfarbe'}"></label>
    <div class="form-row">
      <label class="field">Datum <input class="input" type="date" id="pr_datum" value="${todayIso()}"></label>
      <label class="field">Zeit <input class="input" id="pr_zeit" placeholder="14:00–15:30"></label>
    </div>
    <div class="form-row">
      <label class="field">Ort <input class="input" id="pr_ort" placeholder="Baubüro / vor Ort"></label>
      <label class="field">Leitung <input class="input" id="pr_leitung" value="${esc(p.projektleiter || '')}"></label>
    </div>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-protokoll" data-pid="${pid}">Erstellen</button>`);
}

function saveProtokoll(pid) {
  const p = findProjekt(pid);
  const typ = $('#pr_typ').value;
  const pr = {
    id: uid('pr'), typ, nr: nextProtNr(p, typ),
    titel: $('#pr_titel').value.trim(),
    datum: $('#pr_datum').value || todayIso(),
    zeit: $('#pr_zeit').value.trim(), ort: $('#pr_ort').value.trim(), leitung: $('#pr_leitung').value.trim(),
    teilnehmer: [], abwesende: [], verteiler: [], traktanden: [], naechste: '',
  };
  (p.protokolle = p.protokolle || []).push(pr);
  save(); closeModal(); go(`#/projekt/${p.id}/protokoll/${pr.id}`);
  toast(PROT_TYP[typ].label + ' erstellt');
}

function actEditProtokoll(pid, prid) {
  const p = findProjekt(pid); const pr = findProtokoll(p, prid);
  openModal('Kopfdaten bearbeiten', `
    <label class="field">Titel <input class="input" id="pr_titel" value="${esc(pr.titel || '')}"></label>
    <div class="form-row">
      <label class="field">Datum <input class="input" type="date" id="pr_datum" value="${esc(pr.datum || '')}"></label>
      <label class="field">Zeit <input class="input" id="pr_zeit" value="${esc(pr.zeit || '')}"></label>
    </div>
    <div class="form-row">
      <label class="field">Ort <input class="input" id="pr_ort" value="${esc(pr.ort || '')}"></label>
      <label class="field">Leitung <input class="input" id="pr_leitung" value="${esc(pr.leitung || '')}"></label>
    </div>
    <label class="field">Nächste Sitzung <input class="input" type="date" id="pr_naechste" value="${esc(pr.naechste || '')}"></label>
  `, `<button class="btn danger" data-act="del-protokoll" data-pid="${pid}" data-prid="${prid}">Löschen</button>
      <div class="spacer"></div>
      <button class="btn ghost" data-close="1">Abbrechen</button>
      <button class="btn" data-act="update-protokoll" data-pid="${pid}" data-prid="${prid}">Speichern</button>`);
}

function updateProtokoll(pid, prid) {
  const p = findProjekt(pid); const pr = findProtokoll(p, prid);
  pr.titel = $('#pr_titel').value.trim();
  pr.datum = $('#pr_datum').value; pr.zeit = $('#pr_zeit').value.trim();
  pr.ort = $('#pr_ort').value.trim(); pr.leitung = $('#pr_leitung').value.trim();
  pr.naechste = $('#pr_naechste').value;
  save(); closeModal(); router(); toast('Kopfdaten gespeichert');
}

function delProtokoll(pid, prid) {
  const p = findProjekt(pid);
  p.protokolle = (p.protokolle || []).filter(x => x.id !== prid);
  save(); closeModal(); go(`#/projekt/${pid}/protokolle`); toast('Protokoll gelöscht', 'info');
}

function actCopyProtokoll(pid, prid) {
  const p = findProjekt(pid); const src = findProtokoll(p, prid);
  const t = PROT_TYP[src.typ];
  const cb = (id, label, checked) => `<label style="display:flex;align-items:center;gap:9px;font-size:13px;cursor:pointer">
    <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--brand)"> ${label}</label>`;
  openModal('Protokoll kopieren', `
    <p style="margin:0;font-size:13px">Neue Kopie von <strong>${esc(protokollTitel(src))}</strong> als ${t.label} <strong>Nr. ${nextProtNr(p, src.typ)}</strong> (Datum: heute).</p>
    <div style="display:flex;flex-direction:column;gap:11px;margin-top:4px">
      ${cb('cp_personen', 'Teilnehmer / Abwesende / Verteiler übernehmen', true)}
      ${cb('cp_traktanden', 'Traktanden übernehmen (Titel)', true)}
      ${cb('cp_eintraege', 'Alle Einträge mitkopieren', false)}
      ${cb('cp_pendenzen', 'Offene Pendenzen übertragen (als Traktandum „Pendenzen aus letzter Sitzung")', true)}
    </div>
    <p class="muted" style="font-size:12px;margin:0">Tipp: Für die nächste Sitzung Teilnehmer + Traktanden übernehmen und offene Pendenzen übertragen — die Originale gelten dann als weitergezogen.</p>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-copy" data-pid="${pid}" data-prid="${prid}">Kopie erstellen</button>`);
}

function doCopyProtokoll(pid, prid) {
  const p = findProjekt(pid); const src = findProtokoll(p, prid);
  const withPers = $('#cp_personen').checked;
  const withTrakt = $('#cp_traktanden').checked;
  const withEintr = $('#cp_eintraege').checked;
  const withPend = $('#cp_pendenzen').checked;

  // Offene Pendenzen VOR dem Kopieren erfassen (sonst zählt die Kopie mit)
  const pend = withPend ? offenePendenzen(p) : [];

  const traktanden = withTrakt ? (src.traktanden || []).map(tr => ({
    id: uid('t'), nr: tr.nr, titel: tr.titel,
    eintraege: withEintr ? (tr.eintraege || []).map(it => ({
      id: uid('it'), art: it.art || 'info', text: it.text, verantwortlich: it.verantwortlich, termin: it.termin, erledigt: false, uebertragen: false,
    })) : [],
  })) : [];

  // Pendenzen-Übertrag: eigenes Traktandum zuoberst
  if (pend.length) {
    traktanden.unshift({
      id: uid('t'), nr: 0, titel: 'Pendenzen aus letzter Sitzung',
      eintraege: pend.map(x => ({
        id: uid('it'), art: 'pendenz', text: x.it.text, verantwortlich: x.it.verantwortlich, termin: x.it.termin, erledigt: false, uebertragen: false,
      })),
    });
    // Originale als weitergezogen markieren → erscheinen nicht mehr in der Sammelliste
    pend.forEach(x => { x.it.uebertragen = true; });
  }
  traktanden.forEach((tr, i) => tr.nr = i + 1);

  const copy = {
    id: uid('pr'), typ: src.typ, nr: nextProtNr(p, src.typ),
    titel: src.titel ? src.titel + ' (Kopie)' : '',
    datum: todayIso(), zeit: src.zeit, ort: src.ort, leitung: src.leitung,
    teilnehmer: withPers ? [...(src.teilnehmer || [])] : [],
    abwesende: withPers ? [...(src.abwesende || [])] : [],
    verteiler: withPers ? [...(src.verteiler || [])] : [],
    naechste: '',
    traktanden,
  };
  (p.protokolle = p.protokolle || []).push(copy);
  save(); closeModal(); go(`#/projekt/${pid}/protokoll/${copy.id}`);
  toast(pend.length ? `Kopiert · ${pend.length} Pendenzen übertragen` : 'Protokoll kopiert');
}

function addPerson(pid, prid, kind) {
  const p = findProjekt(pid); const pr = findProtokoll(p, prid);
  const inp = $('#add_' + kind); const val = inp.value.trim();
  if (!val) return;
  (pr[PERSON_FELD[kind]] = pr[PERSON_FELD[kind]] || []).push(val);
  save(); router();
}

function rmPerson(pid, prid, kind, idx) {
  const p = findProjekt(pid); const pr = findProtokoll(p, prid);
  pr[PERSON_FELD[kind]].splice(+idx, 1); save(); router();
}

function personLabel(k) { return k.person ? `${k.person} (${k.firma})` : k.firma; }

function actPickPersonen(pid, prid, kind) {
  const p = findProjekt(pid); const pr = findProtokoll(p, prid);
  const vorhanden = new Set(pr[PERSON_FELD[kind]] || []);
  const titel = kind === 'verteiler' ? 'Verteiler' : (kind === 'abwesend' ? 'Abwesende' : 'Anwesende');
  const list = state.kontakte.slice().sort((a, b) => a.firma.localeCompare(b.firma));
  openModal(titel + ' aus Kontakten', `
    <input class="input" id="pickSearch" placeholder="Kontakte filtern…" autocomplete="off">
    <div id="pickList" style="max-height:300px;overflow:auto;display:flex;flex-direction:column;gap:2px;margin:-2px 0">
      ${list.length ? list.map(k => {
        const label = personLabel(k);
        const dis = vorhanden.has(label);
        return `<label class="inv-pick" data-search="${esc((k.firma + ' ' + (k.person || '') + ' ' + k.kategorie + ' ' + (k.ort || '')).toLowerCase())}" style="${dis ? 'opacity:.45' : ''}">
          <input type="checkbox" data-val="${esc(label)}" ${dis ? 'disabled' : ''}>
          <div><div style="font-weight:600">${esc(label)}</div><div class="muted" style="font-size:12px">${esc(k.kategorie)}${k.ort ? ' · ' + esc(k.ort) : ''}</div></div>
        </label>`;
      }).join('') : '<p class="muted" style="padding:8px">Keine Kontakte vorhanden.</p>'}
    </div>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-personen" data-pid="${pid}" data-prid="${prid}" data-kind="${kind}">Übernehmen</button>`);
  $('#pickSearch')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    $$('#pickList .inv-pick').forEach(row => { row.style.display = row.dataset.search.includes(q) ? '' : 'none'; });
  });
}

function savePersonen(pid, prid, kind) {
  const p = findProjekt(pid); const pr = findProtokoll(p, prid);
  const feld = PERSON_FELD[kind];
  const existing = new Set(pr[feld] || []);
  let n = 0;
  $$('#pickList input[type=checkbox]:checked').forEach(cb => {
    const v = cb.dataset.val;
    if (!existing.has(v)) { (pr[feld] = pr[feld] || []).push(v); existing.add(v); n++; }
  });
  save(); closeModal(); router();
  if (n) toast(n + ' aus Kontakten übernommen');
}

function actNewTraktandum(pid, prid) {
  openModal('Neues Traktandum', `
    <label class="field">Titel <input class="input" id="tr_titel" placeholder="z.B. Stand Rohbau / Termine / Pendenzen"></label>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-traktandum" data-pid="${pid}" data-prid="${prid}">Hinzufügen</button>`);
}

function saveTraktandum(pid, prid) {
  const p = findProjekt(pid); const pr = findProtokoll(p, prid);
  const titel = $('#tr_titel').value.trim();
  if (!titel) { toast('Bitte einen Titel eingeben', 'info'); return; }
  (pr.traktanden = pr.traktanden || []).push({ id: uid('t'), nr: pr.traktanden.length + 1, titel, eintraege: [] });
  save(); closeModal(); router(); toast('Traktandum hinzugefügt');
}

function rmTraktandum(pid, prid, tid) {
  const p = findProjekt(pid); const pr = findProtokoll(p, prid);
  pr.traktanden = (pr.traktanden || []).filter(x => x.id !== tid);
  pr.traktanden.forEach((t, i) => t.nr = i + 1);
  save(); router();
}

function actNewEintrag(pid, prid, tid) {
  openModal('Neuer Eintrag', `
    <label class="field">Art
      <select class="select" id="it_art">
        <option value="pendenz">Pendenz – zugewiesen, mit Termin, wird gesammelt</option>
        <option value="info">Info / Beschluss – nur zur Kenntnis</option>
      </select>
    </label>
    <label class="field">Eintrag / Beschluss / Pendenz
      <textarea class="input" id="it_text" rows="3" style="resize:vertical;font-family:inherit" placeholder="Was wurde besprochen / beschlossen?"></textarea></label>
    <div class="form-row">
      <label class="field">Verantwortlich <input class="input" id="it_verant" placeholder="Person oder Firma"></label>
      <label class="field">Termin <input class="input" type="date" id="it_termin"></label>
    </div>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-eintrag" data-pid="${pid}" data-prid="${prid}" data-tid="${tid}">Hinzufügen</button>`);
}

function saveEintrag(pid, prid, tid) {
  const p = findProjekt(pid); const pr = findProtokoll(p, prid);
  const tr = (pr.traktanden || []).find(x => x.id === tid);
  const text = $('#it_text').value.trim();
  if (!text) { toast('Bitte einen Text eingeben', 'info'); return; }
  (tr.eintraege = tr.eintraege || []).push({
    id: uid('it'), art: $('#it_art').value, text,
    verantwortlich: $('#it_verant').value.trim(), termin: $('#it_termin').value, erledigt: false,
  });
  save(); closeModal(); router(); toast('Eintrag hinzugefügt');
}

function togglePendenz(pid, prid, tid, itemid) {
  const p = findProjekt(pid); if (!p) return;
  let it;
  if (prid) {
    const pr = findProtokoll(p, prid);
    const tr = pr && (pr.traktanden || []).find(x => x.id === tid);
    it = tr && (tr.eintraege || []).find(x => x.id === itemid);
  } else {
    it = (p.pendenzen || []).find(x => x.id === itemid);
  }
  if (!it) return;
  it.erledigt = !it.erledigt;
  save(); router();
  toast(it.erledigt ? 'Pendenz erledigt' : 'Pendenz wieder offen', 'info');
}

function rmEintrag(pid, prid, tid, itemid) {
  const p = findProjekt(pid); const pr = findProtokoll(p, prid);
  const tr = (pr.traktanden || []).find(x => x.id === tid);
  tr.eintraege = (tr.eintraege || []).filter(x => x.id !== itemid);
  save(); router();
}

function pdfProtokoll(pid, prid) {
  const p = findProjekt(pid); const pr = findProtokoll(p, prid); const t = PROT_TYP[pr.typ];
  const join = arr => (arr || []).map(esc).join(', ') || '–';
  const trakt = (pr.traktanden || []).map(tr => {
    const body = (tr.eintraege || []).length
      ? tr.eintraege.map(it => `<tr><td>${esc(it.text)}</td><td>${esc(it.verantwortlich || '')}</td><td>${it.termin ? fmtDate(it.termin) : ''}</td></tr>`).join('')
      : `<tr><td colspan="3" style="color:#999">—</td></tr>`;
    return `<h3>${esc(tr.nr)}. ${esc(tr.titel)}</h3>
      <table class="t"><thead><tr><th style="width:58%">Eintrag / Beschluss / Pendenz</th><th style="width:27%">Verantwortlich</th><th>Termin</th></tr></thead><tbody>${body}</tbody></table>`;
  }).join('');

  const pend = offenePendenzen(p);
  const pendHtml = pend.length ? `
    <h3 style="margin-top:22px">Offene Pendenzen (projektweit)</h3>
    <table class="t"><thead><tr><th style="width:50%">Pendenz</th><th>Verantwortlich</th><th>Termin</th><th>Herkunft</th></tr></thead>
    <tbody>${pend.map(x => `<tr><td>${esc(x.it.text)}</td><td>${esc(x.it.verantwortlich || '')}</td><td>${x.it.termin ? fmtDate(x.it.termin) : ''}</td><td>${x.pr ? esc(protokollTitel(x.pr)) + ' · ' + fmtDate(x.pr.datum) : 'direkt erfasst'}</td></tr>`).join('')}</tbody></table>` : '';

  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>${esc(protokollTitel(pr))} – ${esc(p.name)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1b2533; margin: 32px 36px; font-size: 12px; }
    .hd { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1f6feb; padding-bottom: 10px; margin-bottom: 16px; }
    .hd h1 { margin: 0; font-size: 21px; letter-spacing: .5px; }
    .hd .proj { color: #5a6678; margin-top: 3px; font-size: 13px; }
    .hd .logo { font-weight: 700; color: #1f6feb; font-size: 16px; }
    table.meta { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    table.meta td { padding: 4px 0; font-size: 12px; }
    .people { background: #f4f6f9; border: 1px solid #e4e8ee; border-radius: 6px; padding: 10px 12px; margin-bottom: 16px; }
    .people b { color: #1b2533; }
    h3 { font-size: 13.5px; margin: 18px 0 6px; color: #1f6feb; }
    table.t { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
    table.t th { background: #eef2f8; text-align: left; padding: 6px 9px; font-size: 11px; border: 1px solid #d4dae3; }
    table.t td { padding: 6px 9px; border: 1px solid #e4e8ee; vertical-align: top; }
    .ft { margin-top: 26px; border-top: 1px solid #e4e8ee; padding-top: 8px; color: #94a0b1; font-size: 10px; }
    .vt { margin-top: 14px; font-size: 11px; color: #5a6678; }
    @media print { body { margin: 14mm; } }
  </style></head><body>
    <div class="hd">
      <div><h1>${t.label.toUpperCase()}</h1><div class="proj">${esc(p.name)} · ${esc(p.ort)} · Bauherr: ${esc(p.bauherr)}</div></div>
      <div class="logo">SubmitOne</div>
    </div>
    <table class="meta">
      <tr><td><b>${esc(protokollTitel(pr))}</b></td><td style="text-align:right">Datum: <b>${fmtDate(pr.datum)}</b>${pr.zeit ? ' · ' + esc(pr.zeit) : ''}</td></tr>
      <tr><td>Ort: ${esc(pr.ort || '–')}</td><td style="text-align:right">Leitung: ${esc(pr.leitung || '–')}</td></tr>
    </table>
    <div class="people">
      <b>Anwesend:</b> ${join(pr.teilnehmer)}<br>
      <b>Abwesend / entschuldigt:</b> ${join(pr.abwesende)}
    </div>
    ${trakt || '<p>Keine Traktanden erfasst.</p>'}
    ${pendHtml}
    ${pr.naechste ? `<p style="margin-top:14px"><b>Nächste Sitzung:</b> ${fmtDate(pr.naechste)}</p>` : ''}
    <p class="vt"><b>Verteiler:</b> ${join(pr.verteiler)}</p>
    <div class="ft">Erstellt mit SubmitOne · ${fmtDate(todayIso())} · Prototyp</div>
    <script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { toast('Bitte Popups für PDF erlauben', 'info'); return; }
  w.document.write(html); w.document.close();
}

/* ---------------------------------------------------------------
   11) View: Vergabe-Detail
   --------------------------------------------------------------- */

const INV_STATUS = {
  eingeladen: { label: 'Einzuladen',  color: 'grey'  },
  angefragt:  { label: 'Angefragt',   color: 'blue'  },
  offeriert:  { label: 'Offeriert',   color: 'green' },
  abgesagt:   { label: 'Abgesagt',    color: 'red'   },
};

function viewVergabeDetail(pid, vid) {
  const p = findProjekt(pid);
  const v = p && findVergabe(p, vid);
  if (!v) { render(emptyState('⚠', 'Vergabe nicht gefunden.')); return; }

  const cur = statusIdx(v);
  const last = cur >= VERGABE_STATUS.length - 1;
  const eingeladene = (v.eingeladene || []);
  const offs = offertenOf(v);
  const best = bestBetrag(v);
  const ungesendet = eingeladene.filter(e => e.status === 'eingeladen');
  const hasContract = isContract(v);

  // Gewerk-Umschalter: direkt zwischen den Gewerken des Projekts springen
  const gwList = gewerkeSorted(p);
  const gIdx = gwList.findIndex(x => x.id === v.id);
  const gPrev = gIdx > 0 ? gwList[gIdx - 1] : null;
  const gNext = gIdx >= 0 && gIdx < gwList.length - 1 ? gwList[gIdx + 1] : null;
  const gwSwitch = `<div class="gw-switch">
    ${gPrev ? `<a class="gw-nav" href="#/projekt/${p.id}/vergabe/${gPrev.id}" title="${esc((gPrev.bkp ? gPrev.bkp + ' ' : '') + gPrev.gewerk)}">‹</a>` : '<span class="gw-nav disabled">‹</span>'}
    <select class="select gewerk-switch" data-pid="${p.id}" title="Gewerk wechseln">${gwList.map(g => `<option value="${g.id}"${g.id === v.id ? ' selected' : ''}>${esc((g.bkp ? g.bkp + ' ' : '') + g.gewerk)}</option>`).join('')}</select>
    ${gNext ? `<a class="gw-nav" href="#/projekt/${p.id}/vergabe/${gNext.id}" title="${esc((gNext.bkp ? gNext.bkp + ' ' : '') + gNext.gewerk)}">›</a>` : '<span class="gw-nav disabled">›</span>'}
    <span class="muted" style="font-size:12px">${gIdx + 1} / ${gwList.length}</span>
  </div>`;

  const html = `
    <div class="breadcrumb" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span><a href="#/projekte">Projekte</a> › <a href="#/projekt/${p.id}">${esc(p.name)}</a> › ${esc(v.gewerk)}</span>
      ${gwSwitch}
    </div>
    <div class="detail-head">
      <div>
        <h1 style="margin:0;font-size:22px"><span class="bkp-code" style="font-size:16px">${esc(v.bkp)}</span> ${esc(v.gewerk)}</h1>
        <div class="sub" style="margin-top:5px">${vergabeFirmaLabel(v)}${grobLabel(v) ? ' · Ausführung ' + esc(grobLabel(v)) : ''}${posTagChips(p, v)}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
        ${vergabeMarken(v)}
        <select class="select vergabe-status-sel" data-pid="${p.id}" data-vid="${v.id}" title="Status setzen" style="padding:7px 10px">${VERGABE_STATUS.map(s => `<option value="${s.key}"${v.status === s.key ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
        <button class="btn secondary" data-act="vergabe-art" data-pid="${p.id}" data-vid="${v.id}" title="Einzelvergabe / ARGE / Teilvergabe an mehrere Firmen">👥 Vergabe-Art</button>
        <button class="btn secondary" data-act="edit-vergabe" data-pid="${p.id}" data-vid="${v.id}" title="Stammdaten bearbeiten (BKP, Gewerk, Frist, Schätzung)">✎ Bearbeiten</button>
        ${last ? '' : `<button class="btn" data-act="advance" data-pid="${p.id}" data-vid="${v.id}">Nächster Schritt →</button>`}
      </div>
    </div>
    ${projektTabs(p, 'overview')}

    <div class="detail-stats">
      <div class="dstat"><div class="l">Kostenschätzung</div><div class="v">${chf(v.schaetzung)}</div></div>
      <div class="dstat"><div class="l">günstigste Offerte</div><div class="v">${bestBetrag(v) != null ? chf(bestBetrag(v)) : '<span class="muted" style="font-size:14px">–</span>'}</div></div>
      <div class="dstat"><div class="l">nach Abgebot</div><div class="v">${bestAbgebot(v) != null ? chf(bestAbgebot(v)) : '<span class="muted" style="font-size:14px">–</span>'}</div></div>
      <div class="dstat"><div class="l">Vergabesumme (n. Verhandlung)</div><div class="v">${isVergeben(v) ? chf(v.betrag) : '<span class="muted" style="font-size:14px">offen</span>'}</div></div>
      <div class="dstat" style="border-color:var(--brand)"><div class="l">Auftragssumme inkl. NT/Regie</div><div class="v" style="color:var(--brand)">${isVergeben(v) ? chf(schlussSumme(v)) : '~' + chf(bestBetrag(v) != null ? bestBetrag(v) : (v.schaetzung || 0))}</div></div>
      <div class="dstat"><div class="l">Bezahlt</div><div class="v">${chf(rechnungBezahlt(v))}</div></div>
      ${rechnungRueckbehalt(v) ? `<div class="dstat"><div class="l">Rückbehalt einbehalten</div><div class="v">${chf(rechnungRueckbehalt(v))}</div></div>` : ''}
      <div class="dstat"><div class="l">Offen</div><div class="v">${chf((isVergeben(v) ? schlussSumme(v) : 0) - rechnungBezahlt(v) - rechnungRueckbehalt(v))}</div></div>
    </div>

    ${vergabeArtCard(v)}

    <div class="card card-pad" style="margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <h2 style="margin:0;font-size:15px">Beschrieb &amp; Kostenschätzung</h2>
        <button class="btn sm" data-act="ks-edit" data-pid="${p.id}" data-vid="${v.id}">✎ Kostenschätzung</button>
      </div>
      ${v.beschrieb ? `<p style="margin:8px 0 0;font-size:13.5px;white-space:pre-wrap">${esc(v.beschrieb)}</p>` : '<p class="muted" style="margin:8px 0 0;font-size:13px">Noch kein Beschrieb. Mit „✎ Kostenschätzung" erfassen (Beschrieb + Positionen).</p>'}
      ${(v.ksPositionen && v.ksPositionen.length) ? `<table class="grid" style="margin-top:10px"><thead><tr><th>Position</th><th class="num" style="width:140px">Kosten</th></tr></thead><tbody>
        ${v.ksPositionen.map(pos => { const info = kalkInfo(pos.kalk); return `<tr><td>${esc(pos.text || 'Position')}${posTagChips(p, pos)}${info ? `<div class="muted" style="font-size:11.5px">${info}</div>` : ''}</td><td class="num">${chf(pos.betrag)}</td></tr>`; }).join('')}
        <tr><td><b>Total Kostenschätzung</b></td><td class="num"><b>${chf(v.schaetzung)}</b></td></tr></tbody></table>` : ''}
    </div>

    <div class="two-col">
      <!-- Pipeline -->
      <div class="card card-pad">
        <div class="section-head" style="margin-top:0"><h2>Ablauf</h2></div>
        <div class="vpipe">
          ${VERGABE_STATUS.map((s, i) => {
            const cls = i < cur ? 'done' : (i === cur ? 'current' : '');
            const mark = i < cur ? '✓' : (i + 1);
            const line = i < VERGABE_STATUS.length - 1 ? '<div class="vp-line"></div>' : '';
            let sub = '';
            if (i < cur) sub = 'erledigt';
            else if (i === cur) sub = 'aktueller Schritt';
            return `
              <div class="vp-step ${cls}">
                <div class="vp-rail"><div class="vp-dot">${mark}</div>${line}</div>
                <div class="vp-body"><div class="vp-title">${esc(s.label)}</div>${sub ? `<div class="vp-sub">${sub}</div>` : ''}</div>
              </div>`;
          }).join('')}
        </div>
      </div>

      <!-- Eingeladene Unternehmer + Offerten -->
      <div class="card card-pad">
        <div class="section-head" style="margin-top:0">
          <h2>Unternehmer</h2>
          <div style="display:flex;gap:6px">
            <button class="btn sm secondary" data-act="deckblatt-leer" data-pid="${p.id}" data-vid="${v.id}" title="Leeres Einladungs-Deckblatt (PDF)">📄 Einladung</button>
            <button class="btn sm secondary" data-act="deckblatt-offerte-leer" data-pid="${p.id}" data-vid="${v.id}" title="Leeres Deckblatt „Äusserste Konditionen“ (PDF)">📑 Konditionen</button>
            ${eingeladene.length ? `<button class="btn sm secondary" data-act="ruecklese" data-pid="${p.id}" data-vid="${v.id}" title="Offertbeträge nacheinander erfassen / scannen / bestätigen">📋 Rücklese</button>` : ''}
            <button class="btn sm" data-act="invite" data-pid="${p.id}" data-vid="${v.id}">+ Einladen</button>
          </div>
        </div>
        <div class="muted" style="font-size:12.5px;margin-bottom:12px">
          ${eingeladene.length} eingeladen · ${offs.length} Offerte${offs.length === 1 ? '' : 'n'} erhalten
        </div>
        ${ungesendet.length ? `<button class="btn secondary sm" style="width:100%;margin-bottom:10px" data-act="sendmail" data-pid="${p.id}" data-vid="${v.id}">✉ Einladung an ${ungesendet.length} Unternehmer versenden</button>` : ''}
        ${isVergeben(v) && v.firma ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
          <button class="btn sm secondary" data-act="mail-zuschlag" data-pid="${p.id}" data-vid="${v.id}">✉ Zuschlag an ${esc(v.firma)}</button>
          ${(v.eingeladene || []).some(e => e.firma !== v.firma && e.status !== 'abgesagt' && eOff(e) != null) ? `<button class="btn sm secondary" data-act="mail-absage" data-pid="${p.id}" data-vid="${v.id}">✉ Absage an Unterlegene</button>` : ''}
        </div>` : ''}
        ${eingeladene.length ? eingeladene.map(e => `
          <div class="inv-item" data-ctx="inv" data-pid="${p.id}" data-vid="${v.id}" data-eid="${e.id}">
            <div class="inv-info">
              <div class="inv-firma">
                ${esc(e.firma)}
                <span class="st ${INV_STATUS[e.status]?.color || 'grey'}" style="padding:2px 8px;font-size:10.5px">${INV_STATUS[e.status]?.label || e.status}</span>
                ${eOff(e) != null && eOff(e) === best && offs.length > 1 ? '<span class="off-best">★ günstigste</span>' : ''}
              </div>
              ${e.email ? `<div class="inv-mail muted">${esc(e.email)}</div>` : ''}
            </div>
            <div class="inv-action">
              ${e.status === 'abgesagt'
                ? `<span class="muted" style="font-size:12.5px">abgesagt</span>`
                : `<div class="inv-conds">${eOff(e) != null ? `<span title="Offerte (Netto)">O ${chfShort(eOff(e))}</span>` : ''}${eAbg(e) != null ? `<span title="Abgebot (Netto)">A ${chfShort(eAbg(e))}</span>` : ''}${eVer(e) != null ? `<span title="Vergabe (Netto)">V ${chfShort(eVer(e))}</span>` : ''}</div>
                   <button class="btn sm secondary" data-act="konditionen" data-pid="${p.id}" data-vid="${v.id}" data-eid="${e.id}">✎ Konditionen</button>`}
              <button class="x-btn" title="Deckblatt: Submissionseinladung" data-act="deckblatt" data-pid="${p.id}" data-vid="${v.id}" data-eid="${e.id}">📄</button>
              <button class="x-btn" title="Deckblatt: Äusserste Konditionen" data-act="deckblatt-offerte" data-pid="${p.id}" data-vid="${v.id}" data-eid="${e.id}">📑</button>
              <button class="x-btn" title="Entfernen" data-act="rm-inv" data-pid="${p.id}" data-vid="${v.id}" data-eid="${e.id}">×</button>
            </div>
          </div>`).join('') : emptyState('☎', 'Noch keine Unternehmer eingeladen.')}
      </div>
    </div>

    <!-- Offertvergleich / Vergabeantrag (Firmen als Spalten, 3 Stufen) -->
    <div class="section-head" style="margin-top:26px"><h2>Offertvergleich / Vergabeantrag</h2><div style="display:flex;gap:8px;align-items:center"><span class="hint">direkt in der Tabelle erfassen – Summen rechnen live</span><button class="btn sm secondary" data-act="pdf-vergabeantrag" data-pid="${p.id}" data-vid="${v.id}">⬇ PDF</button></div></div>
    <div class="card card-pad va-screen" style="overflow-x:auto;margin-bottom:8px">${vergabeAntragTable(p, v, true)}</div>

    <!-- Budgetpositionen -->
    <div class="section-head" style="margin-top:26px">
      <h2>Budgetpositionen</h2>
      <span class="hint">Budget steckt im WV (nicht aufgerechnet) · nach Auswahl zählt die Differenz (Ist − Budget)</span>
    </div>
    <div class="card">
      <div class="card-pad" style="display:flex;justify-content:space-between;align-items:center;padding-bottom:0">
        <h2 style="margin:0;font-size:15px">${(v.budgetposten || []).length} Position${(v.budgetposten || []).length === 1 ? '' : 'en'}</h2>
        <button class="btn sm secondary" data-act="new-budget" data-pid="${p.id}" data-vid="${v.id}">+ Budgetposition</button>
      </div>
      ${(v.budgetposten || []).length ? `
      <table class="grid" style="margin-top:12px">
        <thead><tr><th>Bezeichnung</th><th class="num">Budget (im WV)</th><th class="num">Tatsächlich</th><th class="num">Δ Baukosten</th><th style="width:62px"></th></tr></thead>
        <tbody>
          ${v.budgetposten.map(b => { const ist = hatIst(b); const d = ist ? (Number(b.ist) || 0) - (b.betrag || 0) : 0; return `
            <tr>
              <td><strong>${esc(b.text || 'Budgetposition')}</strong></td>
              <td class="num">${chf(b.betrag)}</td>
              <td class="num">${ist ? chf(Number(b.ist) || 0) : '<span class="muted">offen</span>'}</td>
              <td class="num" style="${d > 0 ? 'color:var(--s-red)' : (d < 0 ? 'color:var(--s-green)' : '')}">${ist ? (d > 0 ? '+' : '') + chf(d) : '–'}</td>
              <td><button class="x-btn" data-act="new-budget" data-pid="${p.id}" data-vid="${v.id}" data-bid="${b.id}" title="Bearbeiten">✏</button><button class="x-btn" data-act="rm-budget" data-pid="${p.id}" data-vid="${v.id}" data-bid="${b.id}">×</button></td>
            </tr>`; }).join('')}
        </tbody>
      </table>
      <div class="card-pad" style="display:flex;justify-content:space-between;border-top:1px solid var(--border)">
        <span class="muted">Budget total ${chf(budgetSumme(v))} (im WV) · wirksame Differenz in Baukosten</span>
        <strong style="${budgetDelta(v) > 0 ? 'color:var(--s-red)' : (budgetDelta(v) < 0 ? 'color:var(--s-green)' : '')}">${(budgetDelta(v) > 0 ? '+' : '') + chf(budgetDelta(v))}</strong>
      </div>` : `<div style="padding:0 0 8px">${emptyState('💰', 'Keine Budgetpositionen erfasst.')}</div>`}
    </div>

    <!-- Nachträge & Rapporte (Ausführungsphase) -->
    <div class="section-head" style="margin-top:26px">
      <h2>Nachträge &amp; Rapporte</h2>
      <span class="hint">${hasContract ? 'Bestellungsänderungen und Regiearbeiten zur Vergabe' : 'verfügbar ab Werkvertrag'}</span>
    </div>
    <div class="two-col">
      <!-- Nachträge -->
      <div class="card">
        <div class="card-pad" style="display:flex;justify-content:space-between;align-items:center;padding-bottom:0">
          <h2 style="margin:0;font-size:15px">Nachträge / Bestellungsänderungen</h2>
          <button class="btn sm secondary" data-act="new-nachtrag" data-pid="${p.id}" data-vid="${v.id}">+ Nachtrag</button>
        </div>
        ${(v.nachtraege || []).length ? `
        <table class="grid" style="margin-top:12px">
          <thead><tr><th>Bezeichnung</th><th>Datum</th><th>Status</th><th class="num">Betrag</th><th></th></tr></thead>
          <tbody>
            ${v.nachtraege.map(n => `
              <tr>
                <td><strong>${esc(n.titel)}</strong>${n.nr ? ` <span class="muted">${esc(n.nr)}</span>` : ''}</td>
                <td class="muted">${fmtDate(n.datum)}</td>
                <td>
                  <select class="select sm-select" data-act="nachtrag-status" data-pid="${p.id}" data-vid="${v.id}" data-nid="${n.id}" style="padding:4px 8px;font-size:12px">
                    <option value="offen" ${n.status === 'offen' ? 'selected' : ''}>Offen</option>
                    <option value="genehmigt" ${n.status === 'genehmigt' ? 'selected' : ''}>Genehmigt</option>
                    <option value="abgelehnt" ${n.status === 'abgelehnt' ? 'selected' : ''}>Abgelehnt</option>
                  </select>
                </td>
                <td class="num ${n.status === 'abgelehnt' ? 'muted' : ''}">${chf(n.betrag)}</td>
                <td><button class="x-btn" data-act="rm-nachtrag" data-pid="${p.id}" data-vid="${v.id}" data-nid="${n.id}">×</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div class="card-pad" style="display:flex;justify-content:space-between;border-top:1px solid var(--border)">
          <span class="muted">Genehmigt total</span>
          <strong>${chf(nachtragSumme(v))}</strong>
        </div>` : `<div style="padding:0 0 8px">${emptyState('＋', 'Keine Nachträge erfasst.')}</div>`}
      </div>

      <!-- Rapporte -->
      <div class="card">
        <div class="card-pad" style="display:flex;justify-content:space-between;align-items:center;padding-bottom:0">
          <h2 style="margin:0;font-size:15px">Rapporte / Regiearbeiten</h2>
          <button class="btn sm secondary" data-act="new-rapport" data-pid="${p.id}" data-vid="${v.id}">+ Rapport</button>
        </div>
        ${(v.rapporte || []).length ? `
        <table class="grid" style="margin-top:12px">
          <thead><tr><th>Bezeichnung</th><th>Datum</th><th class="num">Std.</th><th class="num">Betrag</th><th></th></tr></thead>
          <tbody>
            ${v.rapporte.map(r => `
              <tr>
                <td><strong>${esc(r.titel)}</strong></td>
                <td class="muted">${fmtDate(r.datum)}</td>
                <td class="num">${r.stunden || '–'}</td>
                <td class="num">${chf(r.betrag)}</td>
                <td><button class="x-btn" data-act="rm-rapport" data-pid="${p.id}" data-vid="${v.id}" data-rid="${r.id}">×</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div class="card-pad" style="display:flex;justify-content:space-between;border-top:1px solid var(--border)">
          <span class="muted">Rapporte total</span>
          <strong>${chf(rapportSumme(v))}</strong>
        </div>` : `<div style="padding:0 0 8px">${emptyState('🕒', 'Keine Rapporte erfasst.')}</div>`}
      </div>
    </div>

    <!-- Rechnungen / Zahlungen -->
    <div class="section-head" style="margin-top:26px">
      <h2>Rechnungen / Zahlungen</h2>
      <span class="hint">Teilrechnungen erfassen · Häkchen = bezahlt</span>
    </div>
    <div class="card">
      <div class="card-pad" style="display:flex;justify-content:space-between;align-items:center;padding-bottom:0">
        <h2 style="margin:0;font-size:15px">${(v.rechnungen || []).length} Rechnung${(v.rechnungen || []).length === 1 ? '' : 'en'}</h2>
        <div style="display:flex;gap:6px">
          <button class="btn sm secondary" data-act="scan-qr" data-pid="${p.id}" data-vid="${v.id}" title="Swiss-QR-Code aus Bild/PDF einlesen">🔎 QR scannen</button>
          <button class="btn sm secondary" data-act="new-rechnung" data-pid="${p.id}" data-vid="${v.id}">+ Rechnung</button>
        </div>
      </div>
      ${(v.rechnungen || []).length ? `
      <table class="grid" style="margin-top:12px">
        <thead><tr><th style="width:36px"></th><th>Bezeichnung</th><th>Art</th><th>Datum</th><th class="num">Betrag</th><th class="num">Rückbehalt</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${(v.rechnungen || []).slice().sort((a, b) => (a.datum || '').localeCompare(b.datum || '')).map(r => {
            const rb = rgRueckbehalt(r);
            return `
            <tr class="${r.bezahlt ? 'done-row' : ''}">
              <td><input type="checkbox" class="rg-check" ${r.bezahlt ? 'checked' : ''} data-pid="${p.id}" data-vid="${v.id}" data-rgid="${r.id}" title="bezahlt"></td>
              <td><span class="etext">${esc(r.text || 'Rechnung')}</span>${r.nr ? ` <span class="muted">${esc(r.nr)}</span>` : ''}${(r.skontoP ? ` <span class="muted" title="Skonto">−${r.skontoP}%</span>` : '')}</td>
              <td class="muted">${RG_ART[r.art] || 'Rechnung'}</td>
              <td class="muted">${fmtDate(r.datum)}</td>
              <td class="num">${chf(rgSigned(r))}</td>
              <td class="num">${rb ? (r.rbFrei
                  ? `<span class="muted" title="freigegeben">${chf(rb)} ✓</span>`
                  : `${chf(rb)}${r.bezahlt ? ` <button class="btn xs secondary" data-act="rb-frei" data-pid="${p.id}" data-vid="${v.id}" data-rgid="${r.id}" title="Garantierückbehalt freigeben / auszahlen">freigeben</button>` : ''}`)
                : '<span class="muted">–</span>'}</td>
              <td>${r.bezahlt ? '<span class="st green">bezahlt</span>' : '<span class="st amber">offen</span>'}</td>
              <td><button class="x-btn" data-act="rm-rechnung" data-pid="${p.id}" data-vid="${v.id}" data-rgid="${r.id}">×</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div class="card-pad" style="display:flex;justify-content:space-between;border-top:1px solid var(--border);flex-wrap:wrap;gap:6px">
        <span class="muted">Fakturiert ${chf(rechnungTotal(v))}${rechnungRueckbehalt(v) ? ` · Rückbehalt einbehalten ${chf(rechnungRueckbehalt(v))}` : ''} · ausbezahlt</span>
        <strong>${chf(rechnungBezahlt(v))}</strong>
      </div>` : `<div style="padding:0 0 8px">${emptyState('🧾', 'Noch keine Rechnungen erfasst.')}</div>`}
    </div>
  `;
  render(html);

  // Rechnungs-Häkchen verdrahten
  $$('.rg-check').forEach(cb => cb.addEventListener('change', () => toggleRechnung(cb.dataset.pid, cb.dataset.vid, cb.dataset.rgid)));
  // Nachtrag-Status-Dropdowns
  $$('.sm-select[data-act="nachtrag-status"]').forEach(sel => sel.addEventListener('change', () => {
    setNachtragStatus(sel.dataset.pid, sel.dataset.vid, sel.dataset.nid, sel.value);
  }));
  $$('.vergabe-status-sel').forEach(sel => sel.addEventListener('change', () => setVergabeStatus(sel.dataset.pid, sel.dataset.vid, sel.value)));
  $$('.gewerk-switch').forEach(sel => sel.addEventListener('change', () => go('#/projekt/' + sel.dataset.pid + '/vergabe/' + sel.value)));
  bindVergabeAntrag(p, v);
}

// Preisspiegel-Konditionen je Unternehmer: Offerte / Abgebot / Vergabe (Brutto → Netto)
function actKonditionen(pid, vid, eid) {
  const p = findProjekt(pid); const v = p && findVergabe(p, vid); const e = v && (v.eingeladene || []).find(x => x.id === eid);
  if (!e) return;
  const stages = [['offerte', 'Offerte'], ['abgebot', 'Abgebot'], ['vergabe', 'Vergabe / Werkvertrag']];
  const val = (key, f) => { const c = e[key] || (key === 'offerte' && e.betrag != null ? { brutto: e.betrag } : {}); return c[f] != null ? c[f] : ''; };
  const stageHtml = stages.map(([key, label]) => `
    <div class="kond-stage">
      <div class="kond-h">${label}</div>
      <div class="kond-grid">
        <label class="field">Brutto (CHF)<input class="input kond-in" data-stage="${key}" data-f="brutto" type="number" value="${val(key, 'brutto')}"></label>
        <label class="field">Rabatt (%)<input class="input kond-in" data-stage="${key}" data-f="rabatt" type="number" value="${val(key, 'rabatt')}"></label>
        <label class="field">Skonto (%)<input class="input kond-in" data-stage="${key}" data-f="skonto" type="number" value="${val(key, 'skonto')}"></label>
        <label class="field">Allg. Abz. (%)<input class="input kond-in" data-stage="${key}" data-f="weitereAbz" type="number" value="${val(key, 'weitereAbz')}"></label>
      </div>
      <div class="kond-res" id="kond_res_${key}"></div>
    </div>`).join('');
  openModal(`Konditionen – ${esc(e.firma)}`, `<div class="kond-wrap">${stageHtml}</div>`, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="konditionen-save" data-pid="${pid}" data-vid="${vid}" data-eid="${eid}">Speichern</button>`);
  const recompute = () => stages.forEach(([key]) => { const r = condParts(kondReadStage(key)); const el = $('#kond_res_' + key); if (el) el.innerHTML = r ? `Netto <strong>${chf(r.zsumme2)}</strong> &nbsp;·&nbsp; MwSt 8.1% ${chf(r.mwst)} &nbsp;·&nbsp; inkl. ${chf(r.total)}` : '<span class="muted">Brutto eingeben für Berechnung</span>'; });
  $$('.kond-in').forEach(i => i.addEventListener('input', recompute));
  recompute();
}
function kondReadStage(key) { const o = {}; $$('.kond-in[data-stage="' + key + '"]').forEach(i => { o[i.dataset.f] = i.value === '' ? null : Number(i.value); }); return o; }
function saveKonditionen(pid, vid, eid) {
  const p = findProjekt(pid); const v = p && findVergabe(p, vid); const e = v && (v.eingeladene || []).find(x => x.id === eid);
  if (!e) return;
  ['offerte', 'abgebot', 'vergabe'].forEach(key => { const o = kondReadStage(key); e[key] = (o.brutto != null) ? o : null; });
  if (e.offerte && e.offerte.brutto != null) {
    e.betrag = condNetto(e.offerte);
    if (e.status !== 'abgesagt') e.status = 'offeriert';
    if (statusIdx(v) < STATUS_BY_KEY['offerten'].index) v.status = 'offerten';
  }
  if (v.firma && e.firma === v.firma) { const ver = eVer(e); const fall = ver != null ? ver : (eAbg(e) != null ? eAbg(e) : eOff(e)); if (fall != null) v.betrag = fall; }
  save(); closeModal(); router(); toast('Konditionen gespeichert');
}
// Offertvergleich-Tabelle (Bildschirm) für eine Stufe
// Vergabeantrag / Offertvergleich: Firmen als SPALTEN, 3 Stufen untereinander
function firmaKontakt(p, firma, eMail) {
  const k = (state.kontakte || []).find(k => k.firma === firma) || {};
  return { person: k.person || '', telefon: k.telefon || '', email: eMail || k.email || '' };
}
function vergabeAntragTable(p, v, editable) {
  const firms = v.eingeladene || [];
  if (!firms.length) return '<p class="muted" style="margin:0">Noch keine Unternehmer eingeladen – mit „+ Einladen" erfassen.</p>';
  const stages = [['offerte', 'Offerte'], ['abgebot', 'Abgebot'], ['vergabe', 'Verhandelt / Vergabe']];
  const nf = n => (n == null || isNaN(n)) ? '' : Number(n).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pf = n => Number(n || 0).toLocaleString('de-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  const cols = firms.length;
  const headRow = (lbl, fn) => `<tr><td class="va-l">${lbl}</td>${firms.map(fn).join('')}</tr>`;
  const valOf = (e, key, f) => { const c = e[key] || (key === 'offerte' && e.betrag != null ? { brutto: e.betrag } : {}); return c[f] != null ? c[f] : ''; };
  let html = `<table class="va"><tr class="va-firms"><td class="va-l"></td>${firms.map(e => `<td>${esc(e.firma)}${v.firma === e.firma ? '<div class="va-fav">Favorit / Vergabe</div>' : ''}</td>`).join('')}</tr>`;
  html += headRow('Sachbearbeiter', e => `<td>${esc(firmaKontakt(p, e.firma, e.email).person)}</td>`);
  html += headRow('Tel.', e => `<td>${esc(firmaKontakt(p, e.firma, e.email).telefon)}</td>`);
  html += headRow('E-Mail', e => `<td class="va-mail">${esc(firmaKontakt(p, e.firma, e.email).email)}</td>`);
  stages.forEach(([key, label]) => {
    html += `<tr class="va-stage"><td class="va-l" colspan="${cols + 1}">${label}</td></tr>`;
    if (editable) {
      const bruttoRow = `<tr class="va-brutto"><td class="va-l">Offertsumme brutto</td>${firms.map(e => `<td class="num"><input class="va-in" type="number" step="0.01" data-va="${e.id}|${key}|brutto" value="${valOf(e, key, 'brutto')}"></td>`).join('')}</tr>`;
      const pctRow = (lbl, f, bCell) => `<tr><td class="va-l">${lbl}</td>${firms.map(e => `<td class="num"><span class="va-inp"><input class="va-in va-pctin" type="number" step="0.01" data-va="${e.id}|${key}|${f}" value="${valOf(e, key, f)}"><span class="va-pctsign">%</span></span> <span class="va-c" data-vc="${e.id}|${key}|${bCell}"></span></td>`).join('')}</tr>`;
      const compRow = (lbl, cell, cls) => `<tr${cls ? ` class="${cls}"` : ''}><td class="va-l">${lbl}</td>${firms.map(e => `<td class="num"><span class="va-c" data-vc="${e.id}|${key}|${cell}"></span></td>`).join('')}</tr>`;
      html += bruttoRow;
      html += pctRow('Rabatt', 'rabatt', 'rabattBetrag');
      html += compRow('Z.-Summe', 'zsumme1');
      html += pctRow('Skonto', 'skonto', 'skontoBetrag');
      html += compRow('Netto', 'netto');
      html += pctRow('Allg. Abz.', 'weitereAbz', 'allgBetrag');
      html += compRow('Z.-Summe', 'zsumme2');
      html += compRow('MWST 8.1%', 'mwst');
      html += compRow('Netto inkl. MWST', 'total', 'va-total');
      html += `<tr class="va-diff"><td class="va-l">Diff. zum günstigsten</td>${firms.map(e => `<td class="num"><span class="va-c" data-vd="${key}|${e.id}"></span></td>`).join('')}</tr>`;
    } else {
      const parts = firms.map(e => condParts(vglStageOf(e, key)));
      const totals = parts.map(x => x ? x.total : null).filter(x => x != null);
      const minT = totals.length ? Math.min(...totals) : null;
      const numRow = (lbl, fn, cls) => `<tr${cls ? ` class="${cls}"` : ''}><td class="va-l">${lbl}</td>${parts.map(x => `<td class="num">${x ? fn(x) : ''}</td>`).join('')}</tr>`;
      const pctRow = (lbl, pFld, bFld) => `<tr><td class="va-l">${lbl}</td>${parts.map(x => `<td class="num">${x ? `<span class="va-pct">${pf(x[pFld])}</span> ${nf(x[bFld])}` : ''}</td>`).join('')}</tr>`;
      html += numRow('Offertsumme brutto', x => nf(x.brutto), 'va-brutto');
      html += pctRow('Rabatt', 'rabattP', 'rabattBetrag');
      html += numRow('Z.-Summe', x => nf(x.zsumme1));
      html += pctRow('Skonto', 'skontoP', 'skontoBetrag');
      html += numRow('Netto', x => nf(x.netto));
      html += pctRow('Allg. Abz.', 'allgP', 'allgBetrag');
      html += numRow('Z.-Summe', x => nf(x.zsumme2));
      html += numRow('MWST 8.1%', x => nf(x.mwst));
      html += numRow('Netto inkl. MWST', x => nf(x.total), 'va-total');
      html += `<tr class="va-diff"><td class="va-l">Diff. zum günstigsten</td>${parts.map(x => `<td class="num">${(x && minT != null) ? (minT ? ((x.total - minT) / minT * 100) : 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%' : ''}</td>`).join('')}</tr>`;
    }
  });
  return html + `</table>`;
}
// Live-Berechnung der editierbaren Vergabeantrag-Tabelle (Bildschirm)
function bindVergabeAntrag(p, v) {
  const firms = v.eingeladene || [];
  const stages = ['offerte', 'abgebot', 'vergabe'];
  const nf = n => (n == null || isNaN(n)) ? '' : Number(n).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const readC = (eid, stage) => { const g = f => { const el = document.querySelector(`[data-va="${eid}|${stage}|${f}"]`); return (el && el.value !== '') ? Number(el.value) : null; }; return { brutto: g('brutto'), rabatt: g('rabatt'), skonto: g('skonto'), weitereAbz: g('weitereAbz') }; };
  const recalcRow = (eid, stage) => {
    const r = condParts(readC(eid, stage));
    ['rabattBetrag', 'zsumme1', 'skontoBetrag', 'netto', 'allgBetrag', 'zsumme2', 'mwst', 'total'].forEach(cell => {
      const el = document.querySelector(`[data-vc="${eid}|${stage}|${cell}"]`); if (el) el.textContent = r ? nf(r[cell]) : '';
    });
  };
  const recalcDiff = stage => {
    const totals = firms.map(e => { const r = condParts(readC(e.id, stage)); return r ? r.total : null; });
    const valid = totals.filter(x => x != null); const min = valid.length ? Math.min(...valid) : null;
    firms.forEach((e, i) => { const el = document.querySelector(`[data-vd="${stage}|${e.id}"]`); if (el) el.textContent = (totals[i] != null && min != null) ? (min ? ((totals[i] - min) / min * 100) : 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%' : ''; });
  };
  const commit = (eid, stage) => {
    const e = firms.find(x => x.id === eid); if (!e) return;
    const c = readC(eid, stage);
    e[stage] = (c.brutto != null) ? c : null;
    if (stage === 'offerte' && e.offerte && e.offerte.brutto != null) { e.betrag = condNetto(e.offerte); if (e.status !== 'abgesagt') e.status = 'offeriert'; if (statusIdx(v) < STATUS_BY_KEY['offerten'].index) v.status = 'offerten'; }
    if (v.firma && e.firma === v.firma) { const ver = eVer(e); const fall = ver != null ? ver : (eAbg(e) != null ? eAbg(e) : eOff(e)); if (fall != null) v.betrag = fall; }
    save();
  };
  firms.forEach(e => stages.forEach(s => recalcRow(e.id, s)));
  stages.forEach(s => recalcDiff(s));
  $$('.va-in').forEach(inp => {
    const parts = inp.dataset.va.split('|'); const eid = parts[0], stage = parts[1];
    inp.addEventListener('input', () => { recalcRow(eid, stage); recalcDiff(stage); });
    inp.addEventListener('change', () => commit(eid, stage));
  });
}
// Kompakte Druckregeln: passt auf EIN Blatt (A4 quer), nicht umbrechen
const VA_PRINT_CSS = `
  @page{size:A4 landscape;margin:8mm 10mm;}
  .lh{padding-bottom:6px;}
  h1{font-size:14px;margin:6px 0 0;}
  h1::after{display:none;}
  .sub{margin:3px 0 6px;font-size:9.5px;}
  .ft{display:none;}
  table.va{width:100%;border-collapse:collapse;font-size:8.5px;font-variant-numeric:tabular-nums;page-break-inside:avoid;table-layout:fixed;}
  table.va td{border:1px solid #c9d2de;padding:1px 4px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  table.va td.va-l{text-align:left;width:120px;color:#46505e;}
  table.va .va-firms td{font-weight:700;text-align:center;background:#eef1f6;font-size:9px;white-space:normal;}
  table.va .va-mail{font-size:7px;}
  table.va .va-pct{color:#8a97a8;font-size:7px;margin-right:3px;}
  table.va .va-stage td{background:#dfe6f5;font-weight:700;text-align:left;color:#1b2533;}
  table.va .va-brutto td{font-weight:600;}
  table.va .va-total td{font-weight:700;background:#f3f5f9;}
  table.va .va-diff td{font-style:italic;color:#6b7480;}
  table.va .va-fav{font-size:7px;font-weight:700;color:#a01b2b;}`;
function pdfVergabeantrag(pid, vid) {
  const p = findProjekt(pid); const v = p && findVergabe(p, vid); if (!v) return;
  const sub = `Objekt: ${esc(p.name)}${p.ort ? ', ' + esc(p.ort) : ''} · BKP ${esc(v.bkp || '')} ${esc(v.gewerk || '')} · Eingabefrist ${v.frist ? fmtDate(v.frist) : '—'} · Kostenschätzung ${chf(v.schaetzung)}`;
  openPrintDoc('Offertvergleich / Vergabeantrag', sub, vergabeAntragTable(p, v), { landscape: true, extraCss: VA_PRINT_CSS });
}
function pdfVergabeantragAlle(pid) {
  const p = findProjekt(pid); if (!p) return;
  const gw = (p.vergaben || []).filter(v => (v.eingeladene || []).length);
  if (!gw.length) { toast('Noch keine Unternehmer/Konditionen erfasst', 'info'); return; }
  const inner = gw.map(v => `<div class="gw" style="margin-top:14px">BKP ${esc(v.bkp || '')} ${esc(v.gewerk || '')} · Eingabefrist ${v.frist ? fmtDate(v.frist) : '—'} · KV ${chf(v.schaetzung)}</div>${vergabeAntragTable(p, v)}`).join('');
  openPrintDoc('Offertvergleich / Vergabeantrag – alle Gewerke', `${esc(p.name)}${p.ort ? ' · ' + esc(p.ort) : ''}`, inner, { landscape: true, extraCss: VA_PRINT_CSS });
}

/* ---------------------------------------------------------------
   12) View: Kontakte
   --------------------------------------------------------------- */

let kontaktFilter = '', kontaktKat = '';

// Beteiligung einer Firma über alle Projekte (eingeladen / offeriert / vergeben)
function kontaktBeteiligung(firma) {
  const out = [];
  (state.projekte || []).forEach(p => (p.vergaben || []).forEach(v => {
    const e = (v.eingeladene || []).find(x => x.firma === firma);
    if (e) out.push({ p, v, e, won: v.firma === firma });
  }));
  return out;
}
function kontaktProjekte(firma) { return new Set(kontaktBeteiligung(firma).map(x => x.p.id)).size; }
function kategorieDatalist(id) { const cats = [...new Set((state.kontakte || []).map(k => k.kategorie).filter(c => c && c !== '–'))].sort(); return `<datalist id="${id}">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>`; }

function viewKontakte() {
  const kats = [...new Set((state.kontakte || []).map(k => k.kategorie).filter(c => c && c !== '–'))].sort();
  let list = (state.kontakte || []).slice().sort((a, b) => (a.firma || '').localeCompare(b.firma || ''));
  if (kontaktKat) list = list.filter(k => k.kategorie === kontaktKat);
  if (kontaktFilter) { const q = kontaktFilter.toLowerCase(); list = list.filter(k => (k.firma + k.kategorie + (k.ort || '') + (k.person || '') + (k.uid_nr || '')).toLowerCase().includes(q)); }

  const chips = `<span class="chip ${kontaktKat ? '' : 'active'}" data-act="kontakt-kat" data-kind="">Alle</span>` +
    kats.map(c => `<span class="chip ${kontaktKat === c ? 'active' : ''}" data-act="kontakt-kat" data-kind="${esc(c)}">${esc(c)}</span>`).join('');

  render(`
    <div class="page-head">
      <div><h1>Kontakte</h1><div class="sub">${(state.kontakte || []).length} Unternehmer &amp; Partner · ${kats.length} Kategorien</div></div>
      <button class="btn" data-act="new-kontakt">+ Neuer Kontakt</button>
    </div>
    <div class="toolbar"><input class="input search" id="kSearch" placeholder="Firma, Gewerk, Person oder Ort suchen…" value="${esc(kontaktFilter)}"></div>
    ${kats.length ? `<div class="chips" style="margin-bottom:14px">${chips}</div>` : ''}
    <div class="card">
      ${list.length ? `
      <table class="grid">
        <thead><tr><th>Firma</th><th>Kategorie</th><th>Ansprechperson</th><th>Ort</th><th>Kontakt</th><th class="num">Projekte</th></tr></thead>
        <tbody>
          ${list.map(k => { const n = kontaktProjekte(k.firma); return `
            <tr class="clickable" data-goto="#/kontakt/${k.id}" data-ctx="kontakt" data-kid="${k.id}">
              <td><div class="row-firma"><strong>${esc(k.firma)}</strong>${k.uid_nr ? `<span class="sub">${esc(k.uid_nr)}${k.rechtsform ? ' · ' + esc(k.rechtsform) : ''}</span>` : ''}</div></td>
              <td>${k.kategorie && k.kategorie !== '–' ? `<span class="tag">${esc(k.kategorie)}</span>` : '<span class="muted">–</span>'}</td>
              <td>${esc(k.person || '–')}${k.funktion ? `<div class="muted" style="font-size:11.5px">${esc(k.funktion)}</div>` : ''}</td>
              <td>${k.plz ? esc(k.plz) + ' ' : ''}${esc(k.ort || '–')}</td>
              <td class="muted">${esc(k.email || k.telefon || '–')}</td>
              <td class="num">${n ? `<span class="tag">${n}</span>` : '<span class="muted">–</span>'}</td>
            </tr>`; }).join('')}
        </tbody>
      </table>` : emptyState('☎', 'Keine Kontakte gefunden.')}
    </div>
  `);
  const s = $('#kSearch');
  s.addEventListener('input', e => { kontaktFilter = e.target.value; viewKontakte(); });
  s.focus(); s.setSelectionRange(s.value.length, s.value.length);
}
function viewKontaktDetail(kid) {
  const k = (state.kontakte || []).find(x => x.id === kid);
  if (!k) { render(emptyState('⚠', 'Kontakt nicht gefunden.')); return; }
  const bet = kontaktBeteiligung(k.firma).sort((a, b) => (a.p.name || '').localeCompare(b.p.name || ''));
  const offerten = bet.filter(x => eOff(x.e) != null);
  const zuschlaege = bet.filter(x => x.won);
  const volumen = zuschlaege.reduce((a, x) => a + (isVergeben(x.v) ? schlussSumme(x.v) : (x.v.betrag || 0)), 0);
  const kpi = (l, v) => `<div class="kpi"><div class="k-label">${l}</div><div class="k-value" style="font-size:21px">${v}</div></div>`;
  const adresse = [k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const stamm = [
    ['Adresse', adresse || '–'],
    ['UID', k.uid_nr || '–'],
    ['Rechtsform', k.rechtsform || '–'],
    ['Ansprechperson', (k.person || '–') + (k.funktion ? ' · ' + esc(k.funktion) : '')],
    ['E-Mail', k.email ? `<a href="mailto:${esc(k.email)}">${esc(k.email)}</a>` : '–'],
    ['Telefon', k.telefon ? `<a href="tel:${esc(k.telefon.replace(/\s/g, ''))}">${esc(k.telefon)}</a>` : '–'],
    ['Website', k.website ? `<a href="${esc(k.website)}" target="_blank" rel="noopener">${esc(k.website)}</a>` : '–'],
  ];
  const betTable = bet.length ? `<table class="grid">
    <thead><tr><th>Projekt</th><th>Gewerk</th><th>Status</th><th class="num">Offerte</th><th></th></tr></thead>
    <tbody>${bet.map(x => `
      <tr class="clickable" data-goto="#/projekt/${x.p.id}/vergabe/${x.v.id}">
        <td>${esc(x.p.name)}</td>
        <td><span class="bkp-code">${esc(x.v.bkp || '')}</span> ${esc(x.v.gewerk || '')}</td>
        <td>${x.won ? '<span class="st green" style="font-size:10.5px;padding:2px 8px">★ Zuschlag</span>' : `<span class="st ${INV_STATUS[x.e.status]?.color || 'grey'}" style="font-size:10.5px;padding:2px 8px">${INV_STATUS[x.e.status]?.label || esc(x.e.status)}</span>`}</td>
        <td class="num">${eOff(x.e) != null ? chf(eOff(x.e)) : '–'}</td>
        <td class="muted">›</td>
      </tr>`).join('')}</tbody></table>` : emptyState('▤', 'Diese Firma ist noch keinem Gewerk zugeordnet.');

  render(`
    <div class="breadcrumb"><a href="#/kontakte">Kontakte</a> › ${esc(k.firma)}</div>
    <div class="detail-head">
      <div><h1 style="margin:0;font-size:23px">${esc(k.firma)}</h1><div class="sub" style="margin-top:5px">${k.kategorie && k.kategorie !== '–' ? esc(k.kategorie) : 'Kontakt'}${k.ort ? ' · ' + (k.plz ? esc(k.plz) + ' ' : '') + esc(k.ort) : ''}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        ${k.email ? `<a class="btn secondary" href="mailto:${esc(k.email)}">✉ Mail</a>` : ''}
        ${k.telefon ? `<a class="btn secondary" href="tel:${esc(k.telefon.replace(/\s/g, ''))}">☎ Anrufen</a>` : ''}
        <button class="btn" data-act="edit-kontakt" data-kid="${kid}">✎ Bearbeiten</button>
      </div>
    </div>
    <div class="kpi-row">
      ${kpi('Angefragt', bet.length)}
      ${kpi('Offerten', offerten.length)}
      ${kpi('Zuschläge', zuschlaege.length)}
      ${kpi('Auftragsvolumen', chfShort(volumen))}
    </div>
    <div class="two-col">
      <div>
        <div class="section-head"><h2>Beteiligung an Projekten</h2><span class="hint">über alle Projekte</span></div>
        <div class="card">${betTable}</div>
      </div>
      <div>
        <div class="section-head"><h2>Stammdaten</h2></div>
        <div class="card card-pad">${stamm.map(([l, v]) => `<div style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px"><span class="muted" style="min-width:110px">${l}</span><span style="flex:1">${v}</span></div>`).join('')}${k.notiz ? `<div style="padding:10px 0 0;font-size:13px"><span class="muted">Notiz</span><div style="margin-top:3px;white-space:pre-wrap">${esc(k.notiz)}</div></div>` : ''}</div>
      </div>
    </div>
  `);
}

/* ---------------------------------------------------------------
   13) View: Dokumente
   --------------------------------------------------------------- */

function viewDokumente() {
  const docs = state.dokumente;
  const html = `
    <div class="page-head">
      <div><h1>Dokumente</h1><div class="sub">Vorlagen &amp; generierte Dokumente</div></div>
    </div>
    <div class="card">
      ${docs.length ? `
      <table class="grid">
        <thead><tr><th>Dokument</th><th>Typ</th><th>Projekt</th><th>Datum</th></tr></thead>
        <tbody>
          ${docs.map(d => {
            const p = findProjekt(d.projektId);
            return `<tr>
              <td>📄 <strong>${esc(d.name)}</strong></td>
              <td><span class="tag">${esc(d.typ)}</span></td>
              <td>${p ? esc(p.name) : '<span class="muted">–</span>'}</td>
              <td class="muted">${fmtDate(d.datum)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>` : emptyState('✉', 'Noch keine Dokumente.')}
    </div>
  `;
  render(html);
}

/* ---------------------------------------------------------------
   Dossier: Projekt-Lebenszyklus (6 Phasen) – pro Position eigenes Verhalten
   - quelle 'modul': von der App abgedeckt → Status AUTOMATISCH erkannt + „→ öffnen"
   - quelle 'sammeln' (Standard): extern → Status/Verweis/Notiz manuell erfassen
   --------------------------------------------------------------- */
const DOS_ROUTE = { kosten: '/kosten', termine: '/termine', protokolle: '/protokolle', pendenzen: '/pendenzen', vergaben: '' };
const DOS_STATUS = [['offen', 'Offen', 'fehlt'], ['inArbeit', 'In Arbeit', 'teil'], ['vorhanden', 'Vorhanden', 'ok'], ['abgegeben', 'Abgegeben', 'ok'], ['entfaellt', 'Entfällt', 'entf']];
// Automatische Vollständigkeits-Erkennung je Thema (jedes anders)
const DOS_CHECK = {
  kostenschaetzung: p => { const vs = p.vergaben || []; if (!vs.some(v => v.schaetzung)) return 'fehlt'; return vs.every(v => v.schaetzung) ? 'ok' : 'teil'; },
  termine:          p => { const vs = p.vergaben || []; const has = v => v.frist || v.bauStart || (v.vorgaenge || []).length; if (!vs.length) return (p.termine || []).length ? 'ok' : 'fehlt'; if (vs.every(has)) return 'ok'; return (vs.some(has) || (p.termine || []).length) ? 'teil' : 'fehlt'; },
  protokolle:       p => (p.protokolle || []).length ? 'ok' : 'fehlt',
  pendenzen:        p => ((p.pendenzen || []).length || (p.protokolle || []).some(pr => (pr.traktanden || []).some(t => (t.eintraege || []).some(it => it.art === 'pendenz')))) ? 'ok' : 'fehlt',
  kostenkontrolle:  p => { const vs = p.vergaben || []; if (vs.some(v => (v.rechnungen || []).length)) return 'ok'; return vs.some(v => v.schaetzung) ? 'teil' : 'fehlt'; },
  nachtraege:       p => (p.vergaben || []).some(v => (v.nachtraege || []).length) ? 'ok' : 'fehlt',
  rechnungen:       p => { const all = (p.vergaben || []).flatMap(v => v.rechnungen || []); if (!all.length) return 'fehlt'; return all.every(r => r.bezahlt) ? 'ok' : 'teil'; },
  ausschreibung:    p => (p.vergaben || []).length ? 'ok' : 'fehlt',
  offerten:         p => { const vs = p.vergaben || []; if (!vs.some(v => (v.eingeladene || []).length)) return 'fehlt'; return vs.some(v => (v.eingeladene || []).some(e => e.status === 'offeriert')) ? 'ok' : 'teil'; },
  zuschlag:         p => { const vs = p.vergaben || []; if (vs.some(v => statusIdx(v) >= STATUS_BY_KEY['vergeben'].index)) return 'ok'; return vs.some(v => ['bewertung', 'verhandlung'].includes(v.status)) ? 'teil' : 'fehlt'; },
  vertraege:        p => { const vs = p.vergaben || []; if (vs.some(v => statusIdx(v) >= STATUS_BY_KEY['unterzeichnet'].index)) return 'ok'; return vs.some(v => ['vergeben', 'werkvertrag'].includes(v.status)) ? 'teil' : 'fehlt'; },
};
const DOSSIER_VORLAGE = [
  { key: 'g1', label: '1 · Grundlagen', kategorien: [
    { label: 'Projekt', positionen: [
      { id: 'projektbeschrieb', label: 'Projektbeschrieb' }, { id: 'machbarkeit', label: 'Machbarkeitsstudie' },
      { id: 'beduerfnis', label: 'Bedürfnisanalyse' }, { id: 'standort', label: 'Standortanalyse' }, { id: 'risiko', label: 'Risikoanalyse' },
    ] },
    { label: 'Kosten & Termine', positionen: [
      { id: 'kostenschaetzung', label: 'Kostenschätzung', modul: 'kosten', auto: 'kostenschaetzung', create: 'vergabe' },
      { id: 'grobtermin', label: 'Terminplanung (Grobterminplan)', modul: 'termine', auto: 'termine' },
      { id: 'finanzierung', label: 'Finanzierungsnachweis' },
    ] },
    { label: 'Grundstück', positionen: [
      { id: 'grundbuch', label: 'Grundbuchauszug' }, { id: 'kataster', label: 'Katasterplan' }, { id: 'dienstbarkeiten', label: 'Dienstbarkeiten' },
    ] },
  ] },
  { key: 'g2', label: '2 · Planung', kategorien: [
    { label: 'Architektur', positionen: [
      { id: 'vorprojekt', label: 'Vorprojektpläne' }, { id: 'entwurf', label: 'Entwurfspläne' }, { id: 'bauprojekt', label: 'Bauprojektpläne' },
      { id: 'ausfuehrungsplaene', label: 'Ausführungspläne' }, { id: 'detailplaene', label: 'Detailpläne' }, { id: 'bim', label: '3D- / BIM-Modelle' },
    ] },
    { label: 'Fachplaner', positionen: [
      { id: 'statik', label: 'Statikberechnungen' }, { id: 'tragwerk', label: 'Tragwerkspläne' }, { id: 'elektro', label: 'Elektroplanung' },
      { id: 'sanitaer', label: 'Sanitärplanung' }, { id: 'heizung', label: 'Heizungsplanung' }, { id: 'lueftung', label: 'Lüftungsplanung' },
      { id: 'brandschutz', label: 'Brandschutzkonzept' }, { id: 'energie', label: 'Energienachweis' },
      { id: 'schallschutz', label: 'Schallschutznachweis' }, { id: 'waermeschutz', label: 'Wärmeschutznachweis' },
    ] },
  ] },
  { key: 'g3', label: '3 · Bewilligungsverfahren', kategorien: [
    { label: 'Baugesuch', positionen: [
      { id: 'baugesuch', label: 'Baugesuch' }, { id: 'baugesuchsplaene', label: 'Baugesuchspläne' }, { id: 'baubeschrieb', label: 'Baubeschrieb' },
      { id: 'situationsplan', label: 'Situationsplan' }, { id: 'nachweise_beh', label: 'Nachweise für Behörden' },
    ] },
    { label: 'Gutachten & Bewilligung', positionen: [
      { id: 'umweltgutachten', label: 'Umweltgutachten (falls nötig)' }, { id: 'verkehrsgutachten', label: 'Verkehrsgutachten (falls nötig)' },
      { id: 'stellungnahmen', label: 'Stellungnahmen Fachstellen' }, { id: 'baubewilligung', label: 'Baubewilligung' },
    ] },
  ] },
  { key: 'g4', label: '4 · Ausschreibung & Vergabe', kategorien: [
    { label: 'Vergabe (→ Vergaben-Modul)', positionen: [
      { id: 'lv', label: 'Leistungsverzeichnisse & Ausschreibungsunterlagen', modul: 'vergaben', auto: 'ausschreibung', create: 'vergabe' },
      { id: 'offertanfragen', label: 'Offertanfragen & Unternehmerofferten', modul: 'vergaben', auto: 'offerten' },
      { id: 'offertvergleich', label: 'Offertvergleich & Vergabeantrag', modul: 'vergaben', auto: 'zuschlag' },
      { id: 'werkvertraege', label: 'Werk- & Lieferantenverträge', modul: 'vergaben', auto: 'vertraege' },
    ] },
  ] },
  { key: 'g5', label: '5 · Ausführung', kategorien: [
    { label: 'Organisation', positionen: [
      { id: 'baustellenorg', label: 'Baustellenorganisation' }, { id: 'sicherheit', label: 'Sicherheitskonzept' },
      { id: 'qm', label: 'Qualitätsmanagement-Dokumente' }, { id: 'journal', label: 'Baustellenjournal' },
    ] },
    { label: 'Technische Unterlagen', positionen: [
      { id: 'werkplaene', label: 'Werkpläne' }, { id: 'montageplaene', label: 'Montagepläne' }, { id: 'revisionsplaene', label: 'Revisionspläne (laufend)' },
      { id: 'materialfreigaben', label: 'Materialfreigaben' }, { id: 'pruefberichte', label: 'Prüfberichte' }, { id: 'kontrollberichte', label: 'Kontrollberichte' },
    ] },
    { label: 'Sitzungen & Kosten', positionen: [
      { id: 'sitzungsprotokolle', label: 'Sitzungs- / Baustellenprotokolle', modul: 'protokolle', auto: 'protokolle', create: 'protokoll' },
      { id: 'kostenkontrolle', label: 'Kostenkontrolle', modul: 'kosten', auto: 'kostenkontrolle' },
      { id: 'nachtrag', label: 'Nachtragsmanagement', modul: 'kosten', auto: 'nachtraege' },
      { id: 'rechnungen', label: 'Rechnungen & Zahlungsfreigaben', modul: 'kosten', auto: 'rechnungen' },
      { id: 'budgetberichte', label: 'Budgetberichte', modul: 'kosten', auto: 'kostenkontrolle' },
    ] },
  ] },
  { key: 'g6', label: '6 · Bauabnahme', kategorien: [
    { label: 'Abnahme', positionen: [
      { id: 'abnahmeprotokolle', label: 'Abnahmeprotokolle' },
      { id: 'maengelliste', label: 'Mängelliste (Pendenzen)', modul: 'pendenzen', auto: 'pendenzen', create: 'pendenz' },
      { id: 'funktionspruefung', label: 'Funktionsprüfungen' }, { id: 'inbetriebnahme', label: 'Inbetriebnahmeprotokolle' },
      { id: 'behoerdenabnahme', label: 'Behördenabnahmen' }, { id: 'schlussabnahme', label: 'Schlussabnahme' },
    ] },
  ] },
];
const DOS_INDEX = {};
DOSSIER_VORLAGE.forEach(ph => ph.kategorien.forEach(k => k.positionen.forEach(pos => { DOS_INDEX[pos.id] = pos; })));

function dossierState(p, pos) {
  if (pos.modul) { const b = DOS_CHECK[pos.auto] ? DOS_CHECK[pos.auto](p) : 'fehlt'; return { bucket: b, label: b === 'ok' ? 'Vorhanden' : b === 'teil' ? 'Teilweise' : 'Fehlt' }; }
  const rec = (p.dossier || {})[pos.id] || {};
  const def = DOS_STATUS.find(s => s[0] === (rec.status || 'offen')) || DOS_STATUS[0];
  return { bucket: def[2], label: def[1], verweis: rec.verweis || '', notiz: rec.notiz || '' };
}
function dossierStats(p) {
  const s = { ok: 0, teil: 0, fehlt: 0, entf: 0 };
  DOSSIER_VORLAGE.forEach(ph => ph.kategorien.forEach(k => k.positionen.forEach(pos => { s[dossierState(p, pos).bucket]++; })));
  (p.dossierCustom || []).forEach(pos => { s[dossierState(p, pos).bucket]++; });
  return s;
}
function dossierFehltCount(p) { return dossierStats(p).fehlt; }
function dossierPct(p) { const s = dossierStats(p); const tot = s.ok + s.teil + s.fehlt; return tot ? Math.round((s.ok + s.teil * 0.5) / tot * 100) : 0; }
function dosBadge(bucket, label) {
  const cls = bucket === 'ok' ? 'green' : bucket === 'teil' ? 'amber' : bucket === 'entf' ? 'grey' : 'red';
  const ico = bucket === 'ok' ? '✓' : bucket === 'teil' ? '◐' : bucket === 'entf' ? '–' : '○';
  return `<span class="st ${cls}" style="font-size:10.5px;padding:2px 8px">${ico} ${label}</span>`;
}
function viewDossier(pid) {
  const p = findProjekt(pid);
  if (!p) { render(emptyState('⚠', 'Projekt nicht gefunden.')); return; }
  const s = dossierStats(p);
  const kpi = (l, v, cls) => `<div class="kpi"><div class="k-label">${l}</div><div class="k-value" style="font-size:21px${cls ? ';color:var(--' + cls + ')' : ''}">${v}</div></div>`;

  const phasenHtml = DOSSIER_VORLAGE.map(ph => {
    let ok = 0, tot = 0;
    const renderRow = (pos, isCustom) => {
      const d = dossierState(p, pos);
      if (d.bucket !== 'entf') { tot++; if (d.bucket === 'ok') ok++; }
      const action = pos.modul
        ? ((d.bucket === 'fehlt' && pos.create)
            ? `<button class="btn sm" data-act="dossier-create" data-pid="${p.id}" data-kind="${pos.create}">＋ erstellen</button>`
            : `<a class="btn sm secondary" href="#/projekt/${p.id}${DOS_ROUTE[pos.modul]}">→ öffnen</a>`)
        : `<button class="btn sm secondary" data-act="dossier-edit" data-pid="${p.id}" data-did="${pos.id}">erfassen</button>`;
      const sub = [];
      if (d.verweis) sub.push(/^https?:\/\//i.test(d.verweis) ? `<a href="${esc(d.verweis)}" target="_blank" rel="noopener">🔗 ${esc(d.verweis)}</a>` : '📎 ' + esc(d.verweis));
      if (d.notiz) sub.push(esc(d.notiz));
      const del = isCustom ? `<button class="ic-btn" data-act="dossier-del" data-pid="${p.id}" data-did="${pos.id}" title="Position entfernen">✕</button>` : '';
      return `<div class="dos-row">
        <span class="dos-badge">${dosBadge(d.bucket, d.label)}</span>
        <span class="dos-name">${esc(pos.label)}${pos.modul ? ' <span class="dos-auto">auto</span>' : ''}${sub.length ? `<div class="dos-sub">${sub.join(' · ')}</div>` : ''}</span>
        ${action}${del}
      </div>`;
    };
    const kats = ph.kategorien.map(kat => `<div class="dos-kat"><div class="dos-kat-h">${esc(kat.label)}</div>${kat.positionen.map(pos => renderRow(pos, false)).join('')}</div>`).join('');
    const custom = (p.dossierCustom || []).filter(c => c.phase === ph.key);
    const customKat = custom.length ? `<div class="dos-kat"><div class="dos-kat-h">Weitere</div>${custom.map(pos => renderRow(pos, true)).join('')}</div>` : '';
    const pct = tot ? Math.round(ok / tot * 100) : 0;
    return `<div class="card" style="margin-bottom:14px">
      <div class="dos-phase-h"><span class="dos-phase-t">${esc(ph.label)}</span><span class="dos-phase-p">${ok}/${tot} ${progressBar(pct)}</span></div>
      <div style="padding:4px 16px 14px">${kats}${customKat}<div style="margin-top:10px"><button class="btn sm secondary" data-act="dossier-add" data-pid="${p.id}" data-kind="${ph.key}">＋ Eigene Position</button></div></div>
    </div>`;
  }).join('');

  render(`
    <div class="breadcrumb"><a href="#/projekte">Projekte</a> › ${esc(p.name)}</div>
    <div class="detail-head">
      <div><h1 style="margin:0;font-size:23px">${esc(p.name)}</h1><div class="sub" style="margin-top:5px">Dossier · vollständige Projektunterlagen über alle Phasen</div></div>
      <button class="btn secondary" data-act="pdf-dossier" data-pid="${p.id}" title="Statusbericht als PDF">⬇ PDF</button>
    </div>
    ${projektTabs(p, 'dossier')}
    ${demoBanner('dossier')}
    <div class="kpi-row">
      ${kpi('Vorhanden', s.ok, s.ok ? 's-green' : '')}
      ${kpi('In Arbeit', s.teil)}
      ${kpi('Offen / fehlt', s.fehlt, s.fehlt ? 's-red' : '')}
      ${kpi('Entfällt', s.entf)}
    </div>
    <p class="muted" style="font-size:12px;margin:0 0 16px"><span class="dos-auto">auto</span> = wird von der App automatisch erkannt (öffnen zum Bearbeiten) · übrige Positionen erfasst du extern (Status, Datei-Name/Link, Notiz).</p>
    ${dossierZahlungsplanCard(p)}
    ${phasenHtml}
  `);
}
// Zahlungsplan-Status fürs Dossier (Versionen + abgeschlossen/in Arbeit) – ohne den Plan zu erzwingen
function dossierZahlungsplanCard(p) {
  const zpL = Array.isArray(p.zahlungsplaene) ? p.zahlungsplaene : (p.zahlungsplan ? [Object.assign({ name: 'Version 1' }, p.zahlungsplan)] : []);
  const aktivIdx = zpL.findIndex(z => z.id === p.zpAktiv);
  const status = !zpL.length ? '<span class="st grey" style="font-size:9.5px;padding:1px 7px">noch nicht erstellt</span>'
    : zpL.map((z, i) => `${esc(z.name || ('Version ' + (i + 1)))} ${z.gesperrt ? '<span class="st green" style="font-size:9px;padding:1px 6px">abgeschlossen</span>' : '<span class="st amber" style="font-size:9px;padding:1px 6px">in Arbeit</span>'}`).join(' &nbsp;·&nbsp; ');
  const head = zpL.length > 1 ? `Zahlungsplan – aktuell <b>Version ${aktivIdx >= 0 ? aktivIdx + 1 : zpL.length}</b> von ${zpL.length}` : 'Zahlungsplan';
  return `<div class="card card-pad" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <div><strong>💰 ${head}</strong><div class="muted" style="font-size:12px;margin-top:3px">${status}</div></div>
      <a class="btn sm secondary" href="#/projekt/${p.id}/zahlungsplan">öffnen ↗</a>
    </div>`;
}
// Direkt aus dem Dossier das passende Modul-Objekt anlegen
function dossierCreate(pid, kind) {
  if (kind === 'vergabe') return actNewVergabe(pid);
  if (kind === 'protokoll') return actNewProtokoll(pid, 'sitzung');
  if (kind === 'pendenz') return actPendenz(pid);
}
function pdfDossier(pid) {
  const p = findProjekt(pid); if (!p) return;
  const s = dossierStats(p);
  const col = { ok: '#16a34a', teil: '#e0930f', fehlt: '#dc2626', entf: '#9aa4b1' };
  const cell = d => `<span style="color:${col[d.bucket]};font-weight:700">${d.label}</span>`;
  const refTxt = d => [d.verweis ? '🔗 ' + d.verweis : '', d.notiz || ''].filter(Boolean).join(' · ');
  const phasen = DOSSIER_VORLAGE.map(ph => {
    let ok = 0, tot = 0; const rows = [];
    const add = (katLabel, pos, isCustom) => {
      const d = dossierState(p, pos);
      if (d.bucket !== 'entf') { tot++; if (d.bucket === 'ok') ok++; }
      rows.push(`<tr><td>${esc(katLabel)}</td><td>${esc(pos.label)}${pos.modul ? ' <span class="muted">(auto)</span>' : ''}</td><td>${cell(d)}</td><td class="muted">${esc(refTxt(d))}</td></tr>`);
    };
    ph.kategorien.forEach(kat => kat.positionen.forEach(pos => add(kat.label, pos, false)));
    (p.dossierCustom || []).filter(c => c.phase === ph.key).forEach(pos => add('Weitere', pos, true));
    const pct = tot ? Math.round(ok / tot * 100) : 0;
    return `<div class="gw">${esc(ph.label)} — ${ok}/${tot} (${pct}%)</div>
      <table class="t"><thead><tr><th style="width:150px">Kategorie</th><th>Position</th><th style="width:96px">Status</th><th>Verweis / Notiz</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }).join('');
  const sub = `${esc(p.name)} · ${esc(p.ort || '')}${p.bauherr ? ' · Bauherr: ' + esc(p.bauherr) : ''} &nbsp; Vollständigkeit <strong>${dossierPct(p)}%</strong> · Vorhanden ${s.ok} · Teilweise ${s.teil} · Offen ${s.fehlt} · Entfällt ${s.entf}`;
  openPrintDoc('Dossier – Unterlagenstatus', sub, phasen);
}
function actDossierAdd(pid, phase) {
  openModal('Eigene Position', `
    <label class="field">Bezeichnung <input class="input" id="dc_label" placeholder="z.B. Baugrundgutachten / Vermessung"></label>
    <p class="muted" style="font-size:12px;margin:0">Wird der gewählten Phase hinzugefügt und wie die übrigen Positionen erfasst (Status, Link, Notiz).</p>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="dossier-add-save" data-pid="${pid}" data-kind="${phase}">Hinzufügen</button>`);
}
function saveDossierAdd(pid, phase) {
  const p = findProjekt(pid); if (!p) return;
  const label = $('#dc_label').value.trim(); if (!label) { toast('Bitte eine Bezeichnung eingeben', 'info'); return; }
  if (!p.dossierCustom) p.dossierCustom = [];
  p.dossierCustom.push({ id: uid('dc'), phase, label });
  save(); closeModal(); router(); toast('Position hinzugefügt');
}
function rmDossierCustom(pid, did) {
  const p = findProjekt(pid); if (!p) return;
  p.dossierCustom = (p.dossierCustom || []).filter(x => x.id !== did);
  if (p.dossier) delete p.dossier[did];
  save(); router(); toast('Position entfernt');
}
function actDossier(pid, did) {
  const p = findProjekt(pid); const pos = DOS_INDEX[did] || (p && (p.dossierCustom || []).find(x => x.id === did)); if (!p || !pos) return;
  const rec = (p.dossier || {})[did] || {};
  openModal(pos.label, `
    <label class="field">Status <select class="select" id="ds_status">${DOS_STATUS.filter(s => s[0] !== undefined).map(s => `<option value="${s[0]}"${(rec.status || 'offen') === s[0] ? ' selected' : ''}>${s[1]}</option>`).join('')}</select></label>
    <label class="field">Datei-Name / Link <input class="input" id="ds_verweis" value="${esc(rec.verweis || '')}" placeholder="z.B. Grundbuchauszug.pdf oder https://…"></label>
    <div class="form-row">
      <label class="field">Datum <input class="input" type="date" id="ds_datum" value="${esc(rec.datum || '')}"></label>
      <label class="field">Verantwortlich <input class="input" id="ds_verant" value="${esc(rec.verant || '')}" placeholder="optional"></label>
    </div>
    <label class="field">Notiz <input class="input" id="ds_notiz" value="${esc(rec.notiz || '')}" placeholder="optional"></label>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="dossier-save" data-pid="${pid}" data-did="${did}">Speichern</button>`);
}
function saveDossier(pid, did) {
  const p = findProjekt(pid); if (!p) return;
  if (!p.dossier) p.dossier = {};
  p.dossier[did] = { status: $('#ds_status').value, verweis: $('#ds_verweis').value.trim(), datum: $('#ds_datum').value, verant: $('#ds_verant').value.trim(), notiz: $('#ds_notiz').value.trim() };
  save(); closeModal(); router(); toast('Dossier aktualisiert');
}

/* ---------------------------------------------------------------
   14) View: Einstellungen
   --------------------------------------------------------------- */

function viewEinstellungen() {
  const b = state.buero || BUERO;
  const html = `
    <div class="page-head"><div><h1>Einstellungen</h1><div class="sub">Prototyp-Konfiguration</div></div></div>
    <div class="card card-pad" style="max-width:560px;margin-bottom:18px">
      <h2 style="margin-top:0;font-size:15px">Büro / Absender</h2>
      <p class="muted" style="font-size:13px">Erscheint als Briefkopf und Eingabeadresse auf dem Deckblatt (Ausschreibung).</p>
      <label class="field">Logo
        <div style="display:flex;align-items:center;gap:12px;margin-top:4px">
          ${b.logo
            ? `<img src="${b.logo}" alt="Logo" style="max-height:54px;max-width:180px;border:1px solid var(--border);border-radius:6px;padding:4px;background:#fff">
               <button class="btn sm ghost" data-act="rm-logo">Logo entfernen</button>`
            : `<span class="muted" style="font-size:13px">Kein Logo</span>`}
          <input type="file" id="b_logo" accept="image/*" style="font-size:13px">
        </div>
      </label>
      <label class="field">Firma <input class="input" id="b_firma" value="${esc(b.firma)}" placeholder="Muster Bauadministration GmbH"></label>
      <label class="field">Strasse <input class="input" id="b_strasse" value="${esc(b.strasse)}" placeholder="Musterstrasse 1"></label>
      <label class="field">PLZ / Ort <input class="input" id="b_plzort" value="${esc(b.plzort)}" placeholder="6000 Luzern"></label>
      <div class="form-row">
        <label class="field">Telefon <input class="input" id="b_tel" value="${esc(b.tel)}" placeholder="041 000 00 00"></label>
        <label class="field">E-Mail <input class="input" id="b_email" value="${esc(b.email)}" placeholder="info@…"></label>
      </div>
      <label class="field">E-Mail-Signatur <span class="muted" style="font-weight:400;font-size:11.5px">– wird unter Pendenz-Mails angehängt</span> · <button type="button" class="btn-ghost-sm" data-act="sig-from-buero" style="font-size:11px;text-decoration:underline">↻ aus Büro-Daten erzeugen</button>
        <textarea class="input" id="b_signatur" rows="4" placeholder="Freundliche Grüsse&#10;P. Hefti Bauberatung GmbH&#10;Bernstrasse 40, 3076 Worb · 031 839 00 77">${esc(b.signatur || '')}</textarea>
      </label>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer;margin-top:6px"><input type="checkbox" id="b_sig_auto" ${b.signaturAuto === false ? '' : 'checked'}> Signatur standardmässig an Mails anhängen</label>
      <label class="field" style="margin-top:12px">Druck-Design <span class="muted" style="font-weight:400;font-size:11.5px">– Layout aller PDFs / Drucke</span>
        <select class="select" id="b_design">
          <option value="standard"${(b.druckDesign === 'modern') ? '' : ' selected'}>Standard (klassisch)</option>
          <option value="modern"${(b.druckDesign === 'modern') ? ' selected' : ''}>Modern – eleganter Akzent-Kopf (Premium)</option>
        </select>
      </label>
      <div style="margin-top:12px"><button class="btn" data-act="save-buero">Büro speichern</button></div>
    </div>
    <div class="card card-pad" style="max-width:560px">
      <h2 style="margin-top:0;font-size:15px">Daten</h2>
      <p class="muted" style="font-size:13px">${cloudEnabled
        ? '☁ <strong>Cloud-Modus (Supabase)</strong> – gemeinsamer Arbeitsbereich, auf allen Geräten synchron.'
        : '💾 <strong>Lokaler Modus</strong> – Daten nur in diesem Browser. Cloud aktivierst du in <code>config.js</code>.'}</p>
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
        <button class="btn secondary" data-act="export">⬇ Daten exportieren (JSON)</button>
        <button class="btn secondary" data-act="reset">↻ Demo-Daten neu laden</button>
        ${cloudEnabled ? '<button class="btn secondary" data-act="logout">⎋ Abmelden</button>' : ''}
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:22px 0">
      <h2 style="font-size:15px">Über</h2>
      <p class="muted" style="font-size:13px">
        SubmitOne Prototyp · v0.1<br>
        Workflow-Test für die spätere Integration ins bkptool.<br>
        Status-Modell: ${VERGABE_STATUS.map(s => s.kurz).join(' → ')}
      </p>
    </div>
  `;
  render(html);
  $('#b_logo')?.addEventListener('change', e => onLogoPick(e.target));
}

function saveBuero() {
  const cur = state.buero || {};
  state.buero = {
    ...cur,
    firma:   $('#b_firma').value.trim(),
    strasse: $('#b_strasse').value.trim(),
    plzort:  $('#b_plzort').value.trim(),
    tel:     $('#b_tel').value.trim(),
    email:   $('#b_email').value.trim(),
    signatur: $('#b_signatur') ? $('#b_signatur').value : (cur.signatur || ''),
    signaturAuto: $('#b_sig_auto') ? $('#b_sig_auto').checked : (cur.signaturAuto !== false),
    druckDesign: $('#b_design') ? $('#b_design').value : (cur.druckDesign || 'standard'),
  };
  save();
  toast('Büro-Daten gespeichert');
}

// Logo: hochladen → auf max. 600px Breite skalieren → als PNG-DataURL in state.buero.logo
function onLogoPick(input) {
  const f = input.files && input.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    const img = new Image();
    img.onload = () => {
      const maxW = 600;
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      state.buero = { ...(state.buero || {}), logo: c.toDataURL('image/png') };
      save();
      toast('Logo gesetzt');
      viewEinstellungen();
    };
    img.onerror = () => toast('Bild konnte nicht gelesen werden', 'info');
    img.src = rd.result;
  };
  rd.readAsDataURL(f);
}

/* ---------------------------------------------------------------
   15) Aktionen (Modals / Mutationen)
   --------------------------------------------------------------- */

/* ---------------------------------------------------------------
   Kalender (Outlook-ähnlich): manuelle Termine + automatische Ereignisse
   --------------------------------------------------------------- */

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const DOW = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const TERMIN_KATEGORIEN = ['Besprechung', 'Bauherrensitzung', 'Bausitzung', 'Baustellenbegehung', 'Abgabe / Frist', 'Bemusterung', 'Sonstiges'];
let calY = null, calM = null, calView = 'monat', calRefIso = null;
const CAL_SH = 5, CAL_EH = 20, CAL_HH = 56;   // Tag/Woche: Stunden-Raster (Zeilenhöhe px)

function weekDates(iso) {
  const d = dISO(iso || todayIso()); const lead = (d.getDay() + 6) % 7;
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - lead);
  return Array.from({ length: 7 }, (_, i) => isoOf(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i)));
}
// Relative Distanz zu heute (für „in 2 Wochen / vor 1 Tag …")
function relTxt(n, sing, plurDat) { if (!n) return ''; const a = Math.abs(n); return (n > 0 ? 'in ' : 'vor ') + a + ' ' + (a === 1 ? sing : plurDat); }
function relDays(iso) { const a = dISO(iso); const b = today(); return Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000); }
function relWeeks(iso) { const a = dISO(weekDates(iso)[0]); const b = dISO(weekDates(todayIso())[0]); return Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / (7 * 86400000)); }
function relMonths(y, m) { const t = today(); return (y - t.getFullYear()) * 12 + (m - t.getMonth()); }
function relBadge(kind, ref) {
  let n, none, sing, plur;
  if (kind === 'tag') { n = relDays(ref); none = 'heute'; sing = 'Tag'; plur = 'Tagen'; }
  else if (kind === 'monat') { n = relMonths(ref[0], ref[1]); none = 'aktueller Monat'; sing = 'Monat'; plur = 'Monaten'; }
  else { n = relWeeks(ref); none = 'diese Woche'; sing = 'Woche'; plur = 'Wochen'; }
  const txt = n === 0 ? none : relTxt(n, sing, plur);
  return `<span class="cal-rel${n === 0 ? ' now' : ''}">${txt}</span>`;
}
// Tages-/Wochen-Raster mit Stunden (Outlook-Stil). events: [{datum,zeit,zeitEnde,titel,color,manual,id,pid}], addPid='' = global
function calTimeGrid(events, dates, todayI, add) {
  const byDay = {};
  events.forEach(e => { (byDay[e.datum] = byDay[e.datum] || []).push(e); });
  const dowF = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const pidAttr = add === 'plan' ? ' data-plan="1"' : (add ? ` data-pid="${add}"` : '');
  const evEdit = e => e.plan ? ` data-bid="${e.id}" data-ctx="planblock" draggable="true"` : (e.manual && e.pid ? ` data-act="kal-edit" data-ctx="termin" data-pid="${e.pid}" data-tid="${e.id}"` : '');
  const dayAct = add === 'plan' ? `data-act="plan-day"` : (add ? `data-act="kal-day" data-pid="${add}"` : `data-act="gcal-day"`);
  const colHead = dates.map(iso => { const d = dISO(iso); return `<div class="cal-colhead${iso === todayI ? ' today' : ''}" ${dayAct} data-kind="${iso}">${dowF[(d.getDay() + 6) % 7]} ${d.getDate()}.${d.getMonth() + 1}.</div>`; }).join('');
  const adRow = dates.map(iso => { const ad = (byDay[iso] || []).filter(e => !e.zeit); return `<div class="cal-ad-cell" data-iso="${iso}"${pidAttr}>${ad.map(e => `<div class="cal-ev ${e.color}"${evEdit(e)} title="${esc(e.titel)}">${esc(e.titel)}</div>`).join('')}</div>`; }).join('');
  let hours = ''; for (let h = CAL_SH; h <= CAL_EH; h++) hours += `<div class="cal-hour" style="height:${CAL_HH}px">${String(h).padStart(2, '0')}:00</div>`;
  const toMin = s => { const [a, b] = String(s).split(':').map(Number); return a * 60 + (b || 0); };
  const cols = dates.map(iso => {
    let lines = ''; for (let h = CAL_SH; h <= CAL_EH; h++) { lines += `<div class="hl" style="top:${(h - CAL_SH) * CAL_HH}px"></div>`; if (h < CAL_EH) lines += `<div class="hl half" style="top:${(h - CAL_SH) * CAL_HH + CAL_HH / 2}px"></div>`; }
    const tev = (byDay[iso] || []).filter(e => e.zeit).map(e => {
      const sMin = toMin(e.zeit); let eMin = e.zeitEnde ? toMin(e.zeitEnde) : sMin + 60; if (eMin <= sMin) eMin = sMin + 60;
      const top = Math.max(0, (sMin - CAL_SH * 60) / 60 * CAL_HH); const h = Math.max((eMin - sMin) / 60 * CAL_HH, 20);
      const rz = e.plan ? '<span class="cal-rz top"></span><span class="cal-rz bottom"></span>' : '';
      return `<div class="cal-tev ${e.color}${e.plan ? ' plan' : ''}"${evEdit(e)} style="top:${top}px;height:${h}px" title="${esc(e.zeit + ' ' + e.titel)}">${rz}<span class="cal-tev-lbl">${esc(e.zeit)} ${esc(e.titel)}</span></div>`;
    }).join('');
    return `<div class="cal-col${iso === todayI ? ' today' : ''}" data-iso="${iso}"${pidAttr} style="height:${(CAL_EH - CAL_SH) * CAL_HH}px">${lines}${tev}</div>`;
  }).join('');
  const cstyle = `grid-template-columns:repeat(${dates.length},1fr)`;
  return `<div class="cal-tg">
    <div class="cal-tg-headrow"><div class="cal-tg-gutter"></div><div class="cal-tg-cols" style="${cstyle}">${colHead}</div></div>
    <div class="cal-tg-adrow"><div class="cal-tg-gutter ad">ganztägig</div><div class="cal-tg-cols" style="${cstyle}">${adRow}</div></div>
    <div class="cal-tg-body"><div class="cal-hours">${hours}</div><div class="cal-tg-cols" style="${cstyle}">${cols}</div></div>
  </div>`;
}
// Klick auf Spalte/Stunde → Termin mit Startzeit; auf ganztägig-Zelle → ohne Zeit
function bindCalCols() {
  $$('.cal-col').forEach(col => col.addEventListener('click', e => {
    if (col.dataset.plan) return;   // Planung nutzt Drag-to-create (bindPlanDragCreate)
    if (e.target.closest('.cal-tev')) return;
    const iso = col.dataset.iso, pid = col.dataset.pid;
    const y = e.clientY - col.getBoundingClientRect().top;
    let hour = CAL_SH + Math.floor(y / CAL_HH); hour = Math.max(CAL_SH, Math.min(CAL_EH, hour));
    const zeit = String(hour).padStart(2, '0') + ':00';
    if (col.dataset.plan) planSlotClick(iso, zeit);
    else if (pid) actKalTermin(pid, null, iso, zeit); else actGlobalTermin(iso, zeit);
  }));
  $$('.cal-ad-cell').forEach(cell => cell.addEventListener('click', e => {
    if (e.target.closest('.cal-ev')) return;
    const iso = cell.dataset.iso, pid = cell.dataset.pid;
    if (cell.dataset.plan) planSlotClick(iso, '');
    else if (pid) actKalTermin(pid, null, iso); else actGlobalTermin(iso);
  }));
}

// Alle Termine eines Projekts (manuell + abgeleitet)
function sammleTermine(p) {
  const ev = [];
  (p.termine || []).forEach(t => ev.push({ datum: t.datum, zeit: t.zeit || '', zeitEnde: t.zeitEnde || '', titel: t.titel || 'Termin', color: 'blue', manual: true, id: t.id }));
  (p.vergaben || []).forEach(v => {
    if (v.frist) ev.push({ datum: v.frist, titel: `Eingabefrist ${v.bkp || ''} ${v.gewerk || ''}`.trim(), color: 'red' });
    if (v.bauStart) ev.push({ datum: v.bauStart, titel: `▶ ${v.gewerk || ''} (Start)`, color: 'teal' });
    if (v.bauEnde) ev.push({ datum: v.bauEnde, titel: `■ ${v.gewerk || ''} (Ende)`, color: 'teal' });
    (v.vorgaenge || []).forEach(o => { if (o.start) ev.push({ datum: o.start, titel: `▶ ${o.titel || ''}`, color: 'teal' }); });
  });
  (p.protokolle || []).forEach(pr => {
    if (pr.datum) ev.push({ datum: pr.datum, titel: protokollTitel(pr), color: 'green' });
    if (pr.naechste) ev.push({ datum: pr.naechste, titel: 'Nächste Sitzung', color: 'green' });
  });
  offenePendenzen(p).forEach(x => { if (x.it.termin) ev.push({ datum: x.it.termin, titel: 'Pendenz: ' + (x.it.text || '').slice(0, 40), color: 'amber' }); });
  if (p.start) ev.push({ datum: p.start, titel: 'Projektstart', color: 'grey' });
  if (p.ende) ev.push({ datum: p.ende, titel: 'Projektende', color: 'grey' });
  return ev.filter(e => e.datum);
}

function viewKalender(pid) {
  const p = findProjekt(pid); if (!p) { render(emptyState('⚠', 'Projekt nicht gefunden.')); return; }
  const t = today(); const todayI = todayIso();
  if (calY == null) { calY = t.getFullYear(); calM = t.getMonth(); }
  if (calRefIso == null) calRefIso = todayI;
  const events = sammleTermine(p);
  const byDay = {};
  events.forEach(e => { (byDay[e.datum] = byDay[e.datum] || []).push(e); });

  let label = '', body = '';
  if (calView === 'monat') {
    const first = new Date(calY, calM, 1);
    const lead = (first.getDay() + 6) % 7;
    const start = new Date(calY, calM, 1 - lead);
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const iso = isoOf(d); const other = d.getMonth() !== calM; const dayEv = byDay[iso] || [];
      if (i % 7 === 0) cells += `<div class="cal-kw">${isoWeek(d)}</div>`;
      const chips = dayEv.slice(0, 4).map(e => `<div class="cal-ev ${e.color}"${e.manual ? ` data-act="kal-edit" data-ctx="termin" data-pid="${p.id}" data-tid="${e.id}"` : ''} title="${esc((e.zeit ? e.zeit + ' ' : '') + e.titel)}">${e.zeit ? esc(e.zeit) + ' ' : ''}${esc(e.titel)}</div>`).join('');
      const more = dayEv.length > 4 ? `<div class="cal-more">+${dayEv.length - 4} mehr</div>` : '';
      cells += `<div class="cal-day${other ? ' other' : ''}${iso === todayI ? ' today' : ''}" data-act="kal-add" data-pid="${p.id}" data-kind="${iso}"><div class="d">${d.getDate()}</div>${chips}${more}</div>`;
    }
    label = `${MONATE[calM]} ${calY}`;
    body = `<div class="cal"><div class="cal-dow">KW</div>${DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}${cells}</div>`;
  } else if (calView === 'woche') {
    const wd = weekDates(calRefIso); const a = dISO(wd[0]);
    label = `KW ${isoWeek(a)} · ${fmtDate(wd[0])} – ${fmtDate(wd[6])}`;
    body = calTimeGrid(events.map(e => ({ ...e, pid: p.id })), wd, todayI, p.id);
  } else {
    const d = dISO(calRefIso); label = `${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'][(d.getDay() + 6) % 7]}, ${fmtDate(calRefIso)}`;
    body = calTimeGrid(events.map(e => ({ ...e, pid: p.id })), [calRefIso], todayI, p.id);
  }
  const vb = (v, t2) => `<button class="btn sm ${calView === v ? '' : 'secondary'}" data-act="kal-view" data-pid="${p.id}" data-kind="${v}">${t2}</button>`;
  const addDate = calView === 'monat' ? todayI : calRefIso;

  const upcoming = events.filter(e => e.datum >= todayI).sort((a, b) => a.datum.localeCompare(b.datum) || (a.zeit || '').localeCompare(b.zeit || '')).slice(0, 12);
  const agenda = upcoming.length ? upcoming.map(e => `<div style="display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
    <i class="cal-dot ${e.color}"></i>
    <span class="muted" style="min-width:118px;font-size:12.5px">${fmtDate(e.datum)}${e.zeit ? ' · ' + esc(e.zeit) : ''}</span>
    <span style="font-size:13px">${esc(e.titel)}</span></div>`).join('') : '<p class="muted" style="margin:0">Keine kommenden Termine.</p>';

  render(`
    <div class="breadcrumb"><a href="#/projekte">Projekte</a> › ${esc(p.name)}</div>
    <div class="detail-head"><div><h1 style="margin:0;font-size:23px">${esc(p.name)}</h1><div class="sub" style="margin-top:5px">Kalender · alle Termine, Fristen &amp; Bauprogramm</div></div>
      <button class="btn" data-act="kal-add" data-pid="${p.id}" data-kind="${addDate}">+ Termin</button></div>
    ${projektTabs(p, 'kalender')}

    <div class="cal-head">
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn sm secondary" data-act="kal-prev" data-pid="${p.id}" title="zurück">‹</button>
        <button class="btn sm secondary" data-act="kal-today" data-pid="${p.id}">Heute</button>
        <button class="btn sm secondary" data-act="kal-next" data-pid="${p.id}" title="vor">›</button>
        <h2 style="margin:0 0 0 8px;font-size:16px">${label}</h2>
      </div>
      <div style="display:flex;gap:5px">${vb('tag', 'Tag')}${vb('woche', 'Woche')}${vb('monat', 'Monat')}</div>
    </div>

    ${body}
    <p class="muted" style="font-size:12px;margin:8px 0 0">Klick auf Tag/Spalte = Termin erfassen · farbige Termine anklicken = bearbeiten.</p>

    <div class="section-head" style="margin-top:24px"><h2>Agenda</h2><span class="hint">nächste Termine</span></div>
    <div class="card card-pad">${agenda}</div>
  `);
  if (calView !== 'monat') bindCalCols();
}

function actKalTermin(pid, tid, datum, zeit) {
  const p = findProjekt(pid); const t = tid ? (p.termine || []).find(x => x.id === tid) : null;
  openModal(t ? 'Termin bearbeiten' : 'Neuer Termin', `
    <label class="field">Titel <input class="input" id="kt_titel" value="${t ? esc(t.titel || '') : ''}" placeholder="z.B. Bauherrensitzung"></label>
    <div class="form-row">
      <label class="field">Datum <input class="input" type="date" id="kt_datum" value="${t ? esc(t.datum || '') : esc(datum || todayIso())}"></label>
      <label class="field">Kategorie <input class="input" id="kt_kat" list="dl_ktkat" value="${t ? esc(t.kategorie || '') : ''}" placeholder="Besprechung">${dl('dl_ktkat', TERMIN_KATEGORIEN)}</label>
    </div>
    <div class="form-row">
      <label class="field">Von <input class="input" type="time" id="kt_zeit" value="${t ? esc(t.zeit || '') : esc(zeit || '')}"></label>
      <label class="field">Bis <input class="input" type="time" id="kt_ende" value="${t ? esc(t.zeitEnde || '') : ''}"></label>
    </div>
    <label class="field">Ort <input class="input" id="kt_ort" value="${t ? esc(t.ort || '') : ''}" placeholder="z.B. Baustelle / Büro"></label>
    <label class="field">Notiz <textarea class="input" id="kt_notiz" rows="2">${t ? esc(t.notiz || '') : ''}</textarea></label>
  `, `${t ? `<button class="btn danger" data-act="kal-del" data-pid="${pid}" data-tid="${tid}">Löschen</button>` : '<button class="btn ghost" data-close="1">Abbrechen</button>'}<button class="btn" data-act="kal-save" data-pid="${pid}"${t ? ` data-tid="${tid}"` : ''}>${t ? 'Speichern' : 'Hinzufügen'}</button>`);
}
function saveKalTermin(pid, tid) {
  const p = findProjekt(pid);
  const titel = $('#kt_titel').value.trim();
  const datum = $('#kt_datum').value;
  if (!titel) { toast('Bitte einen Titel eingeben', 'info'); return; }
  if (!datum) { toast('Bitte ein Datum wählen', 'info'); return; }
  const data = { titel, datum, kategorie: $('#kt_kat').value.trim(), zeit: $('#kt_zeit').value, zeitEnde: $('#kt_ende').value, ort: $('#kt_ort').value.trim(), notiz: $('#kt_notiz').value.trim() };
  p.termine = p.termine || [];
  const t = tid ? p.termine.find(x => x.id === tid) : null;
  if (t) Object.assign(t, data); else p.termine.push({ id: uid('kt'), ...data });
  save(); closeModal(); router(); toast('Termin gespeichert');
}
function removeKalTermin(pid, tid) {
  const p = findProjekt(pid); p.termine = (p.termine || []).filter(x => x.id !== tid);
  save(); closeModal(); router();
}
function kalNav(pid, delta) {
  if (delta === 0) { const t = today(); calY = t.getFullYear(); calM = t.getMonth(); calRefIso = todayIso(); }
  else if (calView === 'monat') { calM += delta; if (calM < 0) { calM = 11; calY--; } else if (calM > 11) { calM = 0; calY++; } }
  else {
    const step = calView === 'woche' ? 7 : 1; const d = dISO(calRefIso || todayIso());
    const nd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta * step);
    calRefIso = isoOf(nd); calY = nd.getFullYear(); calM = nd.getMonth();
  }
  viewKalender(pid);
}
function kalSetView(pid, v) { calView = v; if (!calRefIso) calRefIso = todayIso(); viewKalender(pid); }
function kalDay(pid, iso) { calView = 'tag'; calRefIso = iso; viewKalender(pid); }

/* --- Globaler Kalender (alle Projekte, ein-/ausblendbar) --- */
// Frei wählbare Projektfarben (Key, Label) – Hex in CSS als --pc-<key>
const PROJ_FARBEN = [
  ['gelb', 'Gelb'], ['hellgruen', 'Hellgrün'], ['dunkelgruen', 'Dunkelgrün'],
  ['hellblau', 'Hellblau'], ['dunkelblau', 'Dunkelblau'], ['violett', 'Violett'],
  ['rot', 'Rot'], ['bordeaux', 'Bordeaux'], ['tuerkis', 'Türkis'],
  ['orange', 'Orange'], ['grau', 'Grau'],
];
// Reihenfolge der automatischen Vergabe (erste Projekte möglichst kontrastreich)
const PROJ_PALETTE = ['dunkelblau', 'rot', 'dunkelgruen', 'orange', 'violett', 'tuerkis', 'gelb', 'bordeaux', 'hellblau', 'hellgruen', 'grau'];
const PROJ_FARB_KEYS = new Set(PROJ_FARBEN.map(f => f[0]));
let calGY = null, calGM = null, calHidden = null, pendHidden = null;
// Projektfarbe: gewählte Farbe (p.farbe) oder automatisch nach Index
function projColor(idx, p) { if (p && p.farbe && PROJ_FARB_KEYS.has(p.farbe)) return p.farbe; return PROJ_PALETTE[idx % PROJ_PALETTE.length]; }
function farbePickerHtml(sel) {
  return `<input type="hidden" id="f_farbe" value="${sel || ''}"><div class="farbe-row">${PROJ_FARBEN.map(([k, l]) => `<button type="button" class="farbe-sw${sel === k ? ' sel' : ''}" data-act="farbe-pick" data-k="${k}" title="${l}" style="background:var(--pc-${k})"></button>`).join('')}</div>`;
}
// Farb-Popover an der Legende
function openFarbePopover(pid, anchor) {
  closeFarbePopover();
  const p = findProjekt(pid); if (!p) return;
  const cur = p.farbe || projColor(state.projekte.indexOf(p));
  const pop = document.createElement('div'); pop.className = 'farbe-pop'; pop.id = 'farbePop';
  pop.innerHTML = PROJ_FARBEN.map(([k, l]) => `<button type="button" class="farbe-sw${cur === k ? ' sel' : ''}" data-act="proj-farbe-set" data-pid="${pid}" data-k="${k}" title="${l}" style="background:var(--pc-${k})"></button>`).join('');
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = (r.bottom + window.scrollY + 6) + 'px';
  let left = r.left + window.scrollX;
  const maxL = window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8;
  pop.style.left = Math.max(8, Math.min(left, maxL)) + 'px';
  setTimeout(() => document.addEventListener('mousedown', farbePopAway), 0);
}
function farbePopAway(e) { if (!e.target.closest('#farbePop')) closeFarbePopover(); }
function closeFarbePopover() { const el = $('#farbePop'); if (el) el.remove(); document.removeEventListener('mousedown', farbePopAway); }
function setProjFarbe(pid, k) { const p = findProjekt(pid); if (!p) return; p.farbe = k; save(); closeFarbePopover(); router(); }
function pendProjToggle(pid) { if (pendHidden == null) pendHidden = new Set(); if (pendHidden.has(pid)) pendHidden.delete(pid); else pendHidden.add(pid); try { localStorage.setItem('so_pend_hidden', JSON.stringify([...pendHidden])); } catch (_) {} router(); }
// Projektübergreifender Pendenzen-Reiter (oberste Ebene)
function viewPendenzenGlobal() {
  const projekte = sichtbareProjekte();
  if (pendHidden == null) { try { pendHidden = new Set(JSON.parse(localStorage.getItem('so_pend_hidden') || '[]')); } catch (_) { pendHidden = new Set(); } }
  const sel = projekte.filter(p => !pendHidden.has(p.id));
  const idxOf = p => projekte.indexOf(p);

  const offen = [], erledigt = [];
  sel.forEach(p => { offenePendenzen(p).forEach(x => offen.push({ p, x })); erledigtePendenzen(p).forEach(x => erledigt.push({ p, x })); });
  offen.sort((a, b) => (a.x.it.termin || '9999-99-99').localeCompare(b.x.it.termin || '9999-99-99'));
  const ueber = offen.filter(o => o.x.it.termin && daysUntil(o.x.it.termin) < 0).length;

  const kpi = (l, v, cls) => `<div class="kpi"><div class="k-label">${l}</div><div class="k-value" style="font-size:21px${cls ? ';color:var(--' + cls + ')' : ''}">${v}</div></div>`;
  const chips = projekte.length ? projekte.map((p, idx) => `<span class="chip ${pendHidden.has(p.id) ? '' : 'active'}" data-act="pend-proj-toggle" data-pid="${p.id}"><button type="button" class="cal-dot-btn" data-act="proj-farbe" data-pid="${p.id}" title="Farbe ändern"><i class="cal-dot ${projColor(idx, p)}"></i></button>${esc(p.name)}</span>`).join('') : '<span class="muted" style="font-size:12.5px">Noch keine Projekte.</span>';

  const projZelle = p => `<i class="cal-dot ${projColor(idxOf(p), p)}" style="margin-right:6px;vertical-align:middle"></i><a href="#/projekt/${p.id}/pendenzen">${esc(p.name)}</a>`;
  const herk = (p, x) => x.pr ? `<a href="#/projekt/${p.id}/protokoll/${x.pr.id}">${esc(protokollTitel(x.pr))}</a>` : '<span class="muted">direkt erfasst</span>';
  const acts = (p, x) => x.pr ? '' : `${(x.it.firmen || []).length ? `<button class="ic-btn" data-act="pend-mail" data-pid="${p.id}" data-itemid="${x.it.id}" title="Als E-Mail an Firmen">✉</button>` : ''}<button class="ic-btn" data-act="pend-edit" data-pid="${p.id}" data-itemid="${x.it.id}" title="Bearbeiten">✎</button><button class="ic-btn" data-act="pend-del" data-pid="${p.id}" data-itemid="${x.it.id}" title="Löschen">✕</button>`;

  const offenTable = offen.length ? `
    <table class="grid">
      <thead><tr><th style="width:36px"></th><th>Projekt</th><th>Pendenz</th><th>Verantwortlich</th><th>Termin</th><th>Herkunft</th><th style="width:62px"></th></tr></thead>
      <tbody>${offen.map(({ p, x }) => `
        <tr${x.pr ? '' : ` data-ctx="pendenz" data-pid="${p.id}" data-itemid="${x.it.id}"`}>
          <td><input type="checkbox" class="pend-check" data-pid="${p.id}" data-prid="${x.pr ? x.pr.id : ''}" data-tid="${x.tr ? x.tr.id : ''}" data-itemid="${x.it.id}" title="erledigt"></td>
          <td>${projZelle(p)}</td>
          <td>${esc(x.it.text)}${pendFirmenChips(x.it)}</td>
          <td>${esc(x.it.verantwortlich || '–')}</td>
          <td class="muted frist ${fristClass(x.it.termin, false)}">${x.it.termin ? fristText(x.it.termin, false) : '–'}</td>
          <td class="muted">${herk(p, x)}</td>
          <td class="row-act">${acts(p, x)}</td>
        </tr>`).join('')}</tbody>
    </table>` : emptyState('✓', sel.length ? 'Keine offenen Pendenzen — mit „+ Pendenz" erfassen.' : 'Keine Projekte gewählt.');

  const erledigtTable = erledigt.length ? `
    <div class="section-head" style="margin-top:26px"><h2>Erledigt</h2><span class="hint">${erledigt.length} · Häkchen entfernen = wieder offen</span></div>
    <div class="card"><table class="grid">
      <thead><tr><th style="width:36px"></th><th>Projekt</th><th>Pendenz</th><th>Verantwortlich</th><th>Termin</th><th>Herkunft</th><th style="width:62px"></th></tr></thead>
      <tbody>${erledigt.map(({ p, x }) => `
        <tr class="done-row"${x.pr ? '' : ` data-ctx="pendenz" data-pid="${p.id}" data-itemid="${x.it.id}"`}>
          <td><input type="checkbox" class="pend-check" checked data-pid="${p.id}" data-prid="${x.pr ? x.pr.id : ''}" data-tid="${x.tr ? x.tr.id : ''}" data-itemid="${x.it.id}" title="wieder offen"></td>
          <td>${projZelle(p)}</td>
          <td>${esc(x.it.text)}${pendFirmenChips(x.it)}</td>
          <td>${esc(x.it.verantwortlich || '–')}</td>
          <td class="muted">${x.it.termin ? fmtDate(x.it.termin) : '–'}</td>
          <td class="muted">${herk(p, x)}</td>
          <td class="row-act">${acts(p, x)}</td>
        </tr>`).join('')}</tbody>
    </table></div>` : '';

  render(`
    <div class="page-head"><div><h1>Pendenzen</h1><div class="sub">Projektübergreifend · offene Aufgaben der gewählten Projekte</div></div>${projekte.length ? '<button class="btn" data-act="pend-add">+ Pendenz</button>' : ''}</div>
    ${projekte.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">${chips}</div>` : ''}
    <div class="kpi-row">
      ${kpi('Offen', offen.length)}
      ${kpi('Überfällig', ueber, ueber ? 's-red' : '')}
      ${kpi('Erledigt', erledigt.length)}
    </div>
    <div class="section-head"><h2>Offene Pendenzen</h2><span class="hint">nach Termin · abhaken = erledigt</span></div>
    <div class="card">${offenTable}</div>
    ${erledigtTable}
  `);
  $$('.pend-check').forEach(cb => cb.addEventListener('change', () => togglePendenz(cb.dataset.pid, cb.dataset.prid, cb.dataset.tid, cb.dataset.itemid)));
}

function viewKalenderGlobal() {
  const t = today();
  if (calGY == null) { calGY = t.getFullYear(); calGM = t.getMonth(); }
  if (calRefIso == null) calRefIso = todayIso();
  if (calHidden == null) { try { calHidden = new Set(JSON.parse(localStorage.getItem('so_cal_hidden') || '[]')); } catch (_) { calHidden = new Set(); } }
  const projects = sichtbareProjekte();
  const todayI = todayIso();

  const events = [];
  projects.forEach((p, idx) => {
    if (calHidden.has(p.id)) return;
    const col = projColor(idx, p);
    sammleTermine(p).forEach(e => events.push({ ...e, color: col, pid: p.id, projekt: p.name }));
  });
  const byDay = {};
  events.forEach(e => { (byDay[e.datum] = byDay[e.datum] || []).push(e); });

  const first = new Date(calGY, calGM, 1);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(calGY, calGM, 1 - lead);
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = isoOf(d);
    const other = d.getMonth() !== calGM;
    const dayEv = byDay[iso] || [];
    if (i % 7 === 0) cells += `<div class="cal-kw">${isoWeek(d)}</div>`;
    const chips = dayEv.slice(0, 4).map(e => `<div class="cal-ev ${e.color}"${e.manual ? ` data-act="kal-edit" data-ctx="termin" data-pid="${e.pid}" data-tid="${e.id}"` : ''} title="${esc(e.projekt + ' · ' + (e.zeit ? e.zeit + ' ' : '') + e.titel)}">${e.zeit ? esc(e.zeit) + ' ' : ''}${esc(e.titel)}</div>`).join('');
    const more = dayEv.length > 4 ? `<div class="cal-more">+${dayEv.length - 4} mehr</div>` : '';
    cells += `<div class="cal-day${other ? ' other' : ''}${iso === todayI ? ' today' : ''}" data-act="gcal-add" data-kind="${iso}"><div class="d">${d.getDate()}</div>${chips}${more}</div>`;
  }

  let gLabel = `${MONATE[calGM]} ${calGY}`;
  let gBody = `<div class="cal"><div class="cal-dow">KW</div>${DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}${cells}</div>`;
  if (calView === 'woche') { const wd = weekDates(calRefIso); gLabel = `KW ${isoWeek(dISO(wd[0]))} · ${fmtDate(wd[0])} – ${fmtDate(wd[6])}`; gBody = calTimeGrid(events, wd, todayI, ''); }
  else if (calView === 'tag') { const d = dISO(calRefIso); gLabel = `${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'][(d.getDay() + 6) % 7]}, ${fmtDate(calRefIso)}`; gBody = calTimeGrid(events, [calRefIso], todayI, ''); }
  const gvb = (v, t2) => `<button class="btn sm ${calView === v ? '' : 'secondary'}" data-act="gcal-view" data-kind="${v}">${t2}</button>`;
  const gAddDate = calView === 'monat' ? todayI : calRefIso;

  const toggles = projects.length ? projects.map((p, idx) => `<span class="chip ${calHidden.has(p.id) ? '' : 'active'}" data-act="gcal-toggle" data-pid="${p.id}"><button type="button" class="cal-dot-btn" data-act="proj-farbe" data-pid="${p.id}" title="Farbe ändern"><i class="cal-dot ${projColor(idx, p)}"></i></button>${esc(p.name)}</span>`).join('') : '<span class="muted" style="font-size:12.5px">Keine Projekte.</span>';

  const upcoming = events.filter(e => e.datum >= todayI).sort((a, b) => a.datum.localeCompare(b.datum) || (a.zeit || '').localeCompare(b.zeit || '')).slice(0, 15);
  const agenda = upcoming.length ? upcoming.map(e => `<div style="display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
    <i class="cal-dot ${e.color}"></i>
    <span class="muted" style="min-width:118px;font-size:12.5px">${fmtDate(e.datum)}${e.zeit ? ' · ' + esc(e.zeit) : ''}</span>
    <span style="font-size:13px">${esc(e.titel)}</span><span class="muted" style="font-size:11.5px;margin-left:auto">${esc(e.projekt)}</span></div>`).join('') : '<p class="muted" style="margin:0">Keine kommenden Termine.</p>';

  render(`
    <div class="page-head"><div><h1>Kalender</h1><div class="sub">Alle Projekte · Termine, Fristen &amp; Bauprogramm</div></div>
      <button class="btn" data-act="gcal-add" data-kind="${gAddDate}">+ Termin</button></div>

    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">${toggles}</div>

    <div class="cal-head">
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn sm secondary" data-act="gcal-prev" title="zurück">‹</button>
        <button class="btn sm secondary" data-act="gcal-today">Heute</button>
        <button class="btn sm secondary" data-act="gcal-next" title="vor">›</button>
        <h2 style="margin:0 0 0 8px;font-size:16px">${gLabel}</h2>
        ${relBadge(calView, calView === 'monat' ? [calGY, calGM] : calRefIso)}
      </div>
      <div style="display:flex;gap:5px">${gvb('tag', 'Tag')}${gvb('woche', 'Woche')}${gvb('monat', 'Monat')}</div>
    </div>

    ${gBody}
    <p class="muted" style="font-size:12px;margin:8px 0 0">Farbe = Projekt · Chips zum Ein-/Ausblenden · Klick = Termin erfassen (Projekt wählen) · Termin anklicken = bearbeiten.</p>

    <div class="section-head" style="margin-top:24px"><h2>Agenda</h2><span class="hint">nächste Termine über alle Projekte</span></div>
    <div class="card card-pad">${agenda}</div>
  `);
  if (calView !== 'monat') bindCalCols();
}

function actGlobalTermin(datum, zeit) {
  const projects = sichtbareProjekte();
  if (!projects.length) { toast('Zuerst ein Projekt anlegen', 'info'); return; }
  openModal('Neuer Termin', `
    <label class="field">Projekt <select class="select" id="kt_pid">${projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
    <label class="field">Titel <input class="input" id="kt_titel" placeholder="z.B. Bauherrensitzung"></label>
    <div class="form-row">
      <label class="field">Datum <input class="input" type="date" id="kt_datum" value="${esc(datum || todayIso())}"></label>
      <label class="field">Kategorie <input class="input" id="kt_kat" list="dl_ktkat" placeholder="Besprechung">${dl('dl_ktkat', TERMIN_KATEGORIEN)}</label>
    </div>
    <div class="form-row">
      <label class="field">Von <input class="input" type="time" id="kt_zeit" value="${esc(zeit || '')}"></label>
      <label class="field">Bis <input class="input" type="time" id="kt_ende"></label>
    </div>
    <label class="field">Ort <input class="input" id="kt_ort" placeholder="z.B. Baustelle / Büro"></label>
    <label class="field">Notiz <textarea class="input" id="kt_notiz" rows="2"></textarea></label>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="gkal-save">Hinzufügen</button>`);
}
function saveGlobalTermin() {
  const pid = $('#kt_pid').value; const p = findProjekt(pid); if (!p) return;
  const titel = $('#kt_titel').value.trim(); const datum = $('#kt_datum').value;
  if (!titel) { toast('Bitte einen Titel eingeben', 'info'); return; }
  if (!datum) { toast('Bitte ein Datum wählen', 'info'); return; }
  p.termine = p.termine || [];
  p.termine.push({ id: uid('kt'), titel, datum, kategorie: $('#kt_kat').value.trim(), zeit: $('#kt_zeit').value, zeitEnde: $('#kt_ende').value, ort: $('#kt_ort').value.trim(), notiz: $('#kt_notiz').value.trim() });
  save(); closeModal(); viewKalenderGlobal(); toast('Termin gespeichert');
}
function gcalNav(delta) {
  if (delta === 0) { const t = today(); calGY = t.getFullYear(); calGM = t.getMonth(); calRefIso = todayIso(); }
  else if (calView === 'monat') { calGM += delta; if (calGM < 0) { calGM = 11; calGY--; } else if (calGM > 11) { calGM = 0; calGY++; } }
  else { const step = calView === 'woche' ? 7 : 1; const d = dISO(calRefIso || todayIso()); const nd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta * step); calRefIso = isoOf(nd); calGY = nd.getFullYear(); calGM = nd.getMonth(); }
  viewKalenderGlobal();
}
function gcalSetView(v) { calView = v; if (!calRefIso) calRefIso = todayIso(); viewKalenderGlobal(); }
function gcalDay(iso) { calView = 'tag'; calRefIso = iso; viewKalenderGlobal(); }

/* --- Arbeitsplanung: persönlicher Tages-/Wochenplaner (browser-lokal) --- */
const PLAN_TEMPLATES = [
  { label: 'Büro / Admin', dauer: 120, color: 'grey' },
  { label: 'Baustelle', dauer: 180, color: 'teal' },
  { label: 'Sitzung', dauer: 60, color: 'green' },
  { label: 'Telefon / Mail', dauer: 30, color: 'blue' },
  { label: 'Bemusterung', dauer: 90, color: 'purple' },
  { label: 'Pause / Mittag', dauer: 60, color: 'amber' },
];
const PLAN_FARBEN = [['blue', 'Blau'], ['teal', 'Petrol'], ['green', 'Grün'], ['amber', 'Gelb'], ['purple', 'Lila'], ['grey', 'Grau'], ['red', 'Rot']];
let planView = 'woche', planRefIso = null, planArmed = null, planungData = null, planSel = null, planClip = null, planPend = [];
function loadPlanung() { if (planungData) return planungData; try { planungData = JSON.parse(localStorage.getItem('so_planung') || '[]'); } catch (_) { planungData = []; } return planungData; }
function savePlanung() { try { localStorage.setItem('so_planung', JSON.stringify(planungData)); } catch (_) {} }
// Vordefinierte Zeitfenster-Dauern (per +/- in 30-Min-Schritten anpassbar, gespeichert)
function loadPlanTplDur() { try { const a = JSON.parse(localStorage.getItem('so_plan_tpldur') || 'null'); if (Array.isArray(a)) a.forEach((d, i) => { if (PLAN_TEMPLATES[i] && d >= 30) PLAN_TEMPLATES[i].dauer = Math.max(30, Math.floor(d / 30) * 30); }); } catch (_) {} }
function savePlanTplDur() { try { localStorage.setItem('so_plan_tpldur', JSON.stringify(PLAN_TEMPLATES.map(t => t.dauer))); } catch (_) {} }
function planDurStep(i, delta) { const tp = PLAN_TEMPLATES[i]; if (!tp) return; tp.dauer = Math.max(30, Math.min(720, tp.dauer + delta * 30)); savePlanTplDur(); viewPlanung(); }
function planDurTxt(d) { if (d < 60) return d + 'min'; const h = Math.floor(d / 60), m = d % 60; return h + 'h' + (m ? m : ''); }
function min2hhmm(m) { m = Math.max(0, Math.min(24 * 60, Math.round(m))); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }

function viewPlanung() {
  const t = today(); const todayI = todayIso();
  loadPlanTplDur();
  if (planRefIso == null) planRefIso = todayI;
  if (calHidden == null) { try { calHidden = new Set(JSON.parse(localStorage.getItem('so_cal_hidden') || '[]')); } catch (_) { calHidden = new Set(); } }
  const projects = sichtbareProjekte();
  const blocks = loadPlanung();

  // Events: Projekt-Termine (sichtbar) + persönliche Plan-Blöcke
  const events = [];
  projects.forEach((p, idx) => { if (calHidden.has(p.id)) return; const col = projColor(idx, p); sammleTermine(p).forEach(e => events.push({ ...e, color: col, pid: p.id, projekt: p.name })); });
  blocks.forEach(b => events.push({ datum: b.datum, zeit: b.zeit, zeitEnde: b.zeitEnde, titel: b.titel, color: b.color || 'purple', plan: true, id: b.id }));

  const dates = planView === 'tag' ? [planRefIso] : weekDates(planRefIso);
  const label = planView === 'tag'
    ? (() => { const d = dISO(planRefIso); return `${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'][(d.getDay() + 6) % 7]}, ${fmtDate(planRefIso)}`; })()
    : `KW ${isoWeek(dISO(dates[0]))} · ${fmtDate(dates[0])} – ${fmtDate(dates[6])}`;
  const body = calTimeGrid(events, dates, todayI, 'plan');
  const pvb = (v, t2) => `<button class="btn sm ${planView === v ? '' : 'secondary'}" data-act="plan-view" data-kind="${v}">${t2}</button>`;
  const toggles = projects.length ? projects.map((p, idx) => `<span class="chip ${calHidden.has(p.id) ? '' : 'active'}" data-act="plan-toggle" data-pid="${p.id}"><button type="button" class="cal-dot-btn" data-act="proj-farbe" data-pid="${p.id}" title="Farbe ändern"><i class="cal-dot ${projColor(idx, p)}"></i></button>${esc(p.name)}</span>`).join('') : '';
  const palette = PLAN_TEMPLATES.map((tp, i) => `<div class="chip plan-tpl ${planArmed === i ? 'active' : ''}"><span class="plan-tpl-grip" draggable="true" data-tpl="${i}" data-act="plan-arm" data-idx="${i}" title="Klicken oder in den Kalender ziehen"><i class="cal-dot ${tp.color}"></i>${esc(tp.label)} · ${planDurTxt(tp.dauer)}</span><span class="plan-tpl-step"><button class="plan-step" data-act="plan-dur" data-idx="${i}" data-d="-1" title="30 Min kürzer">−</button><button class="plan-step" data-act="plan-dur" data-idx="${i}" data-d="1" title="30 Min länger">+</button></span></div>`).join('');

  // offene Pendenzen als „To-do"-Vorrat (in den Kalender ziehbar)
  const pend = [];
  projects.forEach((p, idx) => { if (calHidden.has(p.id)) return; offenePendenzen(p).forEach(x => pend.push({ p, idx, it: x.it })); });
  planPend = pend.map(x => ({ titel: x.it.text || 'Pendenz', color: projColor(x.idx, x.p) }));
  const pendHtml = pend.length ? pend.map((x, i) => `<div class="plan-pend-item" draggable="true" data-pend="${i}" title="In den Kalender ziehen"><i class="cal-dot ${projColor(x.idx, x.p)}"></i><span style="flex:1">${esc(x.it.text || '')}</span><span class="muted" style="font-size:11px">${x.it.termin ? fmtDate(x.it.termin) : ''}</span></div>`).join('') : '<p class="muted" style="margin:0;font-size:12.5px">Keine offenen Pendenzen.</p>';

  render(`
    <div class="page-head"><div><h1>Arbeitsplanung</h1><div class="sub">Tag &amp; Woche · Termine der gewählten Projekte + eigene Zeitfenster</div></div></div>
    ${projects.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">${toggles}</div>` : ''}

    <div class="cal-head">
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn sm secondary" data-act="plan-prev" title="zurück">‹</button>
        <button class="btn sm secondary" data-act="plan-today">Heute</button>
        <button class="btn sm secondary" data-act="plan-next" title="vor">›</button>
        <h2 style="margin:0 0 0 8px;font-size:16px">${label}</h2>
        ${relBadge(planView, planRefIso)}
      </div>
      <div style="display:flex;gap:5px">${pvb('tag', 'Tag')}${pvb('woche', 'Woche')}</div>
    </div>

    <div class="plan-layout" id="planLayout">
      <aside class="plan-rail plan-rail-left" id="planRailL">
        <div class="plan-rail-title">Zeitfenster ${planArmed != null ? '<span class="muted" style="font-weight:400">– in Kalender klicken</span>' : ''}</div>
        <div class="plan-pal">${palette}<button class="chip" data-act="plan-add" data-kind="${planRefIso}">+ eigener Block</button></div>
        <p class="plan-rail-hint">In den Kalender <strong>ziehen</strong> oder anklicken &amp; platzieren. Block: 1× klick = auswählen (Entf löschen, Strg+C/V kopieren), ziehen = verschieben, <strong>Ränder ziehen = Dauer ändern</strong>, Doppelklick = bearbeiten.</p>
      </aside>
      <div class="plan-splitter" data-rail="left" title="Breite ziehen"></div>

      <div class="plan-center">${body}</div>

      <div class="plan-splitter" data-rail="right" title="Breite ziehen"></div>
      <aside class="plan-rail plan-rail-right" id="planRailR">
        <div class="plan-rail-title">Offene Pendenzen <span class="muted" style="font-weight:400">– in Kalender ziehen</span></div>
        <div class="plan-pend">${pendHtml}</div>
      </aside>
    </div>
  `);
  bindCalCols();
  bindPlanDnd();
  bindPlanDragCreate();
  bindPlanResize();
  bindPlanRails();
}
function planSlotClick(iso, zeit) {
  const tpl = planArmed != null ? PLAN_TEMPLATES[planArmed] : null;
  if (tpl) { placePlanBlock(iso, zeit, tpl); planArmed = null; }
  else if (planSel) { planSel = null; viewPlanung(); }   // leeres Klicken = Auswahl aufheben
}
function placePlanBlock(iso, zeit, tpl) {
  const [h, m] = (zeit || '08:00').split(':').map(Number); const start = h * 60 + (m || 0);
  const b = { id: uid('pl'), datum: iso, zeit: zeit || '08:00', zeitEnde: min2hhmm(start + tpl.dauer), titel: tpl.label, color: tpl.color };
  loadPlanung().push(b); savePlanung(); planSel = b.id; viewPlanung(); toast('Zeitfenster platziert');
}
function movePlanBlock(bid, iso, zeit) {
  const b = loadPlanung().find(x => x.id === bid); if (!b) return;
  const dur = (() => { const s = b.zeit ? b.zeit.split(':').map(Number) : [8, 0]; const e = b.zeitEnde ? b.zeitEnde.split(':').map(Number) : [s[0] + 1, s[1]]; return (e[0] * 60 + e[1]) - (s[0] * 60 + s[1]) || 60; })();
  const [h, m] = (zeit || '08:00').split(':').map(Number); const start = h * 60 + (m || 0);
  b.datum = iso; b.zeit = zeit || '08:00'; b.zeitEnde = min2hhmm(start + dur);
  savePlanung(); planSel = b.id; viewPlanung();
}
function planSelect(bid) { planSel = bid; viewPlanung(); }
function planDelete() { if (!planSel) return; planungData = loadPlanung().filter(x => x.id !== planSel); savePlanung(); planSel = null; viewPlanung(); }
function planCopy() { if (!planSel) return; const b = loadPlanung().find(x => x.id === planSel); if (b) { planClip = { ...b }; toast('Block kopiert'); } }
function planPaste() {
  if (!planClip) return;
  const s = planClip.zeit ? planClip.zeit.split(':').map(Number) : [8, 0];
  const e = planClip.zeitEnde ? planClip.zeitEnde.split(':').map(Number) : [s[0] + 1, s[1]];
  const dur = (e[0] * 60 + e[1]) - (s[0] * 60 + s[1]) || 60;
  const start = s[0] * 60 + s[1] + 30;   // 30 Min versetzt eingefügt
  const b = { id: uid('pl'), datum: planClip.datum, zeit: min2hhmm(start), zeitEnde: min2hhmm(start + dur), titel: planClip.titel, color: planClip.color };
  loadPlanung().push(b); savePlanung(); planSel = b.id; viewPlanung(); toast('Eingefügt');
}
// Drag-and-Drop + Auswahl-Klicks im Planungsraster
// Live-Vorschau-Block, der beim Ziehen Grösse & Zeitspanne im Kalender zeigt
let planDrag = null, planGhostEl = null;
function planGhostShow(col, e) {
  if (!planDrag) return;
  const y = e.clientY - col.getBoundingClientRect().top;
  const startMin = planDrag.kind === 'blk'
    ? snap30abs(CAL_SH * 60 + (y / CAL_HH * 60) - dragBlockOffsetMin)
    : snap30(y);
  const dur = planDrag.dur || 60;
  const a = startMin, b = Math.min(CAL_EH * 60, startMin + dur);
  if (!planGhostEl) planGhostEl = document.createElement('div');
  planGhostEl.className = 'cal-tev plan ghost ' + (planDrag.color || 'blue');
  planGhostEl.style.top = (a - CAL_SH * 60) / 60 * CAL_HH + 'px';
  planGhostEl.style.height = Math.max((b - a) / 60 * CAL_HH, CAL_HH / 2) + 'px';
  planGhostEl.textContent = min2hhmm(a) + '–' + min2hhmm(b) + (planDrag.label ? '  ' + planDrag.label : '');
  if (planGhostEl.parentElement !== col) col.appendChild(planGhostEl);
}
function planGhostHide() { if (planGhostEl) planGhostEl.remove(); planGhostEl = null; planDrag = null; $$('.cal-tev.dragging').forEach(x => x.classList.remove('dragging')); }
function bindPlanDnd() {
  $$('[data-tpl]').forEach(c => { c.addEventListener('dragstart', e => { dragBlockOffsetMin = 0; const tp = PLAN_TEMPLATES[+c.dataset.tpl]; planDrag = { kind: 'tpl', dur: tp.dauer, color: tp.color, label: tp.label }; e.dataTransfer.setData('text/plain', 'tpl:' + c.dataset.tpl); }); c.addEventListener('dragend', planGhostHide); });
  $$('[data-pend]').forEach(c => { c.addEventListener('dragstart', e => { dragBlockOffsetMin = 0; const pp = planPend[+c.dataset.pend]; planDrag = pp ? { kind: 'pend', dur: 60, color: pp.color, label: pp.titel } : null; e.dataTransfer.setData('text/plain', 'pend:' + c.dataset.pend); }); c.addEventListener('dragend', planGhostHide); });
  $$('.cal-tev.plan').forEach(el => {
    if (el.dataset.bid === planSel) el.classList.add('sel');
    el.addEventListener('dragstart', e => { e.stopPropagation(); dragBlockOffsetMin = (e.offsetY || 0) / CAL_HH * 60; const b = loadPlanung().find(x => x.id === el.dataset.bid); if (b) { const s = b.zeit ? b.zeit.split(':').map(Number) : [8, 0]; const en = b.zeitEnde ? b.zeitEnde.split(':').map(Number) : [s[0] + 1, s[1]]; planDrag = { kind: 'blk', dur: (en[0] * 60 + en[1]) - (s[0] * 60 + s[1]) || 60, color: b.color, label: b.titel }; } setTimeout(() => el.classList.add('dragging'), 0); e.dataTransfer.setData('text/plain', 'blk:' + el.dataset.bid); });
    el.addEventListener('dragend', planGhostHide);
    el.addEventListener('click', e => { e.stopPropagation(); planSelect(el.dataset.bid); });
    el.addEventListener('dblclick', e => { e.stopPropagation(); actPlanBlock(el.dataset.bid); });
  });
  $$('.cal-col').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); planGhostShow(col, e); });
    col.addEventListener('drop', e => {
      e.preventDefault(); planGhostHide(); const d = e.dataTransfer.getData('text/plain'); if (!d) return;
      const iso = col.dataset.iso; const y = e.clientY - col.getBoundingClientRect().top;
      if (d.startsWith('tpl:')) placePlanBlock(iso, min2hhmm(snap30(y)), PLAN_TEMPLATES[+d.slice(4)]);
      else if (d.startsWith('pend:')) { const pp = planPend[+d.slice(5)]; if (pp) placePlanBlock(iso, min2hhmm(snap30(y)), { label: pp.titel, dauer: 60, color: pp.color }); }
      else if (d.startsWith('blk:')) { const absMin = CAL_SH * 60 + (y / CAL_HH * 60) - dragBlockOffsetMin; movePlanBlock(d.slice(4), iso, min2hhmm(snap30abs(absMin))); }
    });
  });
}
// Block-Ränder ziehen → Start-/Endzeit verlängern/kürzen (rastet auf 30 Min)
function bindPlanResize() {
  $$('.cal-tev.plan .cal-rz').forEach(h => h.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    const el = h.closest('.cal-tev.plan'); const col = el.closest('.cal-col'); if (!col) return;
    const b = loadPlanung().find(x => x.id === el.dataset.bid); if (!b) return;
    const rect = col.getBoundingClientRect();
    const edge = h.classList.contains('top') ? 'top' : 'bottom';
    const s = b.zeit ? b.zeit.split(':').map(Number) : [8, 0];
    const en = b.zeitEnde ? b.zeitEnde.split(':').map(Number) : [s[0] + 1, s[1]];
    let startMin = s[0] * 60 + s[1], endMin = en[0] * 60 + en[1];
    const lbl = el.querySelector('.cal-tev-lbl');
    el.draggable = false; el.classList.add('resizing');
    document.body.style.userSelect = 'none'; document.body.style.cursor = 'ns-resize';
    const onMove = ev => {
      const m = snap30(ev.clientY - rect.top);
      if (edge === 'top') startMin = Math.min(m, endMin - 30); else endMin = Math.max(m, startMin + 30);
      el.style.top = (startMin - CAL_SH * 60) / 60 * CAL_HH + 'px';
      el.style.height = (endMin - startMin) / 60 * CAL_HH + 'px';
      if (lbl) lbl.textContent = min2hhmm(startMin) + '–' + min2hhmm(endMin) + ' ' + (b.titel || '');
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = ''; document.body.style.cursor = '';
      b.zeit = min2hhmm(startMin); b.zeitEnde = min2hhmm(endMin);
      savePlanung(); planSel = b.id; viewPlanung();
    };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  }));
}
// Ziehbare Seitenleisten (Breite je gespeichert) – nur im breiten Layout aktiv
function bindPlanRails() {
  const L = $('#planRailL'), R = $('#planRailR');
  try {
    const lw = localStorage.getItem('so_plan_railL'); if (lw && L) L.style.width = lw + 'px';
    const rw = localStorage.getItem('so_plan_railR'); if (rw && R) R.style.width = rw + 'px';
  } catch (_) {}
  $$('.plan-splitter').forEach(sp => sp.addEventListener('mousedown', e => {
    e.preventDefault();
    const side = sp.dataset.rail; const rail = side === 'left' ? L : R; if (!rail) return;
    const startX = e.clientX, startW = rail.getBoundingClientRect().width;
    sp.classList.add('drag'); document.body.style.userSelect = 'none'; document.body.style.cursor = 'col-resize';
    const onMove = ev => { const dx = ev.clientX - startX; let w = side === 'left' ? startW + dx : startW - dx; rail.style.width = Math.max(140, Math.min(480, w)) + 'px'; };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
      sp.classList.remove('drag'); document.body.style.userSelect = ''; document.body.style.cursor = '';
      try { localStorage.setItem(side === 'left' ? 'so_plan_railL' : 'so_plan_railR', String(Math.round(rail.getBoundingClientRect().width))); } catch (_) {}
    };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  }));
}
// Outlook-Stil: in Spalte drücken & ziehen (30-Min-Raster) → Zeitspanne → Modal/Platzieren
let dragCreate = null, dragBlockOffsetMin = 0;
function snap30(y) { let m = CAL_SH * 60 + Math.round((y / CAL_HH * 60) / 30) * 30; return Math.max(CAL_SH * 60, Math.min(CAL_EH * 60, m)); }
function snap30abs(absMin) { let m = CAL_SH * 60 + Math.round((absMin - CAL_SH * 60) / 30) * 30; return Math.max(CAL_SH * 60, Math.min(CAL_EH * 60, m)); }
function bindPlanDragCreate() {
  $$('.cal-col[data-plan]').forEach(col => col.addEventListener('mousedown', e => {
    if (e.target.closest('.cal-tev')) return;   // auf Block → Auswahl/Drag, nicht create
    e.preventDefault();
    const rect = col.getBoundingClientRect();
    const startMin = snap30(e.clientY - rect.top);
    const sel = document.createElement('div'); sel.className = 'cal-tev sel-create';
    col.appendChild(sel);
    dragCreate = { iso: col.dataset.iso, rect, startMin, curMin: startMin, el: sel, moved: false };
    document.body.style.userSelect = 'none';
    planDragRender();
  }));
}
function planDragRender() {
  const d = dragCreate; if (!d || !d.el) return;
  const a = Math.min(d.startMin, d.curMin), b = Math.max(d.startMin, d.curMin);
  d.el.style.top = (a - CAL_SH * 60) / 60 * CAL_HH + 'px';
  d.el.style.height = Math.max((b - a) / 60 * CAL_HH, CAL_HH / 2) + 'px';
  d.el.textContent = min2hhmm(a) + ' – ' + min2hhmm(b);
}
function planDragMove(e) {
  const d = dragCreate; if (!d) return;
  const m = snap30(e.clientY - d.rect.top);
  if (m !== d.curMin) { d.curMin = m; d.moved = true; planDragRender(); }
}
function planDragUp() {
  const d = dragCreate; if (!d) return;
  dragCreate = null; document.body.style.userSelect = '';
  if (d.el) d.el.remove();
  let a = Math.min(d.startMin, d.curMin), b = Math.max(d.startMin, d.curMin);
  if (planArmed != null) { placePlanBlock(d.iso, min2hhmm(a), PLAN_TEMPLATES[planArmed]); planArmed = null; return; }
  // gezogen → Spanne; reiner Klick → 30-Min-Termin an der Halbstunde
  const ende = (d.moved && b - a >= 30) ? b : a + 30;
  actPlanBlock(null, d.iso, min2hhmm(a), min2hhmm(ende));
}
function planKeydown(e) {
  if (location.hash !== '#/planung') return;
  const tag = (e.target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'Escape' && planSel) { planSel = null; viewPlanung(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && planSel) { e.preventDefault(); planDelete(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { planCopy(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); planPaste(); }
}
function actPlanBlock(bid, datum, zeit, zeitEnde) {
  const b = bid ? loadPlanung().find(x => x.id === bid) : null;
  openModal(b ? 'Block bearbeiten' : 'Eigener Zeitblock', `
    <label class="field">Titel <input class="input" id="pb_titel" value="${b ? esc(b.titel || '') : ''}" placeholder="z.B. Devis prüfen"></label>
    <div class="form-row">
      <label class="field">Datum <input class="input" type="date" id="pb_datum" value="${b ? esc(b.datum || '') : esc(datum || todayIso())}"></label>
      <label class="field">Farbe <select class="select" id="pb_color">${PLAN_FARBEN.map(([k, l]) => `<option value="${k}"${b && b.color === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div class="form-row">
      <label class="field">Von <input class="input" type="time" id="pb_zeit" value="${b ? esc(b.zeit || '') : esc(zeit || '08:00')}"></label>
      <label class="field">Bis <input class="input" type="time" id="pb_ende" value="${b ? esc(b.zeitEnde || '') : esc(zeitEnde || '')}"></label>
    </div>
  `, `${b ? `<button class="btn danger" data-act="plan-del" data-bid="${bid}">Löschen</button>` : '<button class="btn ghost" data-close="1">Abbrechen</button>'}<button class="btn" data-act="plan-save"${b ? ` data-bid="${bid}"` : ''}>${b ? 'Speichern' : 'Hinzufügen'}</button>`);
}
function savePlanBlock(bid) {
  const titel = $('#pb_titel').value.trim(); const datum = $('#pb_datum').value;
  if (!titel) { toast('Bitte einen Titel eingeben', 'info'); return; }
  if (!datum) { toast('Bitte ein Datum wählen', 'info'); return; }
  let zeit = $('#pb_zeit').value || '08:00'; let ende = $('#pb_ende').value;
  if (!ende) { const [h, m] = zeit.split(':').map(Number); ende = min2hhmm(h * 60 + (m || 0) + 60); }
  const data = { datum, zeit, zeitEnde: ende, titel, color: $('#pb_color').value };
  const list = loadPlanung(); const b = bid ? list.find(x => x.id === bid) : null;
  if (b) Object.assign(b, data); else list.push({ id: uid('pl'), ...data });
  savePlanung(); closeModal(); viewPlanung(); toast('Block gespeichert');
}
function removePlanBlock(bid) { planungData = loadPlanung().filter(x => x.id !== bid); savePlanung(); closeModal(); viewPlanung(); }
function planNav(delta) {
  if (delta === 0) { planRefIso = todayIso(); }
  else { const step = planView === 'woche' ? 7 : 1; const d = dISO(planRefIso || todayIso()); planRefIso = isoOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta * step)); }
  viewPlanung();
}
function planSetView(v) { planView = v; viewPlanung(); }
function planToggle(pid) { if (calHidden == null) calHidden = new Set(); if (calHidden.has(pid)) calHidden.delete(pid); else calHidden.add(pid); try { localStorage.setItem('so_cal_hidden', JSON.stringify([...calHidden])); } catch (_) {} viewPlanung(); }
function planArm(i) { planArmed = (planArmed === i) ? null : i; viewPlanung(); }
function gcalToggle(pid) {
  if (calHidden == null) calHidden = new Set();
  if (calHidden.has(pid)) calHidden.delete(pid); else calHidden.add(pid);
  try { localStorage.setItem('so_cal_hidden', JSON.stringify([...calHidden])); } catch (_) {}
  viewKalenderGlobal();
}

/* --- Drucken: alle Dokumente direkt als PDF (Hauptreiter) --- */
let druckPid = null;
function viewDrucken() {
  const projects = sichtbareProjekte();
  if (druckPid == null || !findProjekt(druckPid)) druckPid = projects.length ? projects[0].id : '';
  const p = findProjekt(druckPid);
  const card = (act, label, desc) => `<button class="btn secondary" data-act="${act}" data-pid="${druckPid}" style="display:flex;flex-direction:column;align-items:flex-start;gap:3px;text-align:left;height:auto;padding:13px 15px;white-space:normal"><span style="font-weight:700;font-size:13.5px">⬇ ${label}</span><span class="muted" style="font-size:11.5px;font-weight:400">${desc}</span></button>`;
  render(`
    <div class="page-head"><div><h1>Drucken</h1><div class="sub">Alle Dokumente – ein Klick, direkt als PDF</div></div></div>
    ${projects.length ? `
    <label class="field" style="max-width:440px">Projekt
      <select class="select" id="druck_pid">${projects.map(x => `<option value="${x.id}"${x.id === druckPid ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
    </label>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px;margin-top:16px">
      ${card('pdf-dossier', 'Dossier / Unterlagenstatus', 'Alle 6 Phasen · Status je Position · Vollständigkeit')}
      ${card('pdf-vergabeantrag-alle', 'Offertvergleich / Vergabeantrag', 'Preisspiegel aller Gewerke (Firmen-Spalten, 3 Stufen)')}
      ${card('pdf-kostenschaetzung', 'Kostenschätzung', 'Beschrieb · BKP · Kosten · Gesamttotal')}
      ${card('pdf-baukosten', 'Baukostenübersicht', 'Volle BKP-Tabelle (KV/WV/Prognose)')}
      ${card('pdf-rechnungen', 'Rechnungskontrolle', 'Pro BKP: vergeben · verrechnet · bezahlt · Platz')}
      ${card('pdf-zahlungsplan', 'Zahlungsplan', 'SIA-Phasen + Monatsrechnungen')}
      ${card('pdf-gantt', 'Bauprogramm', 'Termin-/Gantt-Raster (Querformat, 1 Seite)')}
      ${card('pdf-honorar', 'Honorar-Berechnung', 'SIA 102 · Phasen · Stundenansatz')}
      ${card('pdf-solar', 'Solar-Bericht', 'Ertrag · Eigenverbrauch · Wirtschaftlichkeit')}
      ${card('pdf-submittenten', 'Submittentenliste', 'Vertraulich · alle Eingeladenen je Gewerk')}
      ${card('pdf-unternehmer', 'Unternehmerliste', 'Für die Baustelle · vergebene Unternehmer')}
      ${card('pdf-entscheidungen', 'Entscheidungsliste', 'Bauherren-/Auswahlentscheide')}
      ${card('pdf-melden', 'Bei wem melden', 'Bemusterung · Unternehmer + Ausstellung')}
      ${card('pdf-bezugsfirmen', 'Auswahl-Firmen', 'Bemusterungs-/Bezugsfirmen je Kategorie')}
    </div>
    <p class="muted" style="font-size:12px;margin-top:14px">Deckblätter (pro Firma) und Protokoll-PDFs erstellst du direkt beim jeweiligen Gewerk bzw. Protokoll.</p>
    ` : '<p class="muted" style="margin-top:14px">Noch kein Projekt vorhanden.</p>'}
  `);
  const sel = $('#druck_pid'); if (sel) sel.addEventListener('change', () => { druckPid = sel.value; viewDrucken(); });
}

/* --- Erfassen: zentraler Schnell-Erfassungs-Reiter (Gegenstück zu Drucken) --- */
function viewErfassen() {
  const card = (kind, ico, label, desc) => `<button class="btn secondary" data-act="erfassen" data-kind="${kind}" style="display:flex;flex-direction:column;align-items:flex-start;gap:3px;text-align:left;height:auto;padding:13px 15px;white-space:normal"><span style="font-weight:700;font-size:13.5px">${ico} ${label}</span><span class="muted" style="font-size:11.5px;font-weight:400">${desc}</span></button>`;
  render(`
    <div class="page-head"><div><h1>Erfassen</h1><div class="sub">Schnell festhalten – Art wählen, Projekt angeben, fertig</div></div></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;margin-top:6px">
      ${card('pendenz', '📋', 'Pendenz', 'Aufgabe / To-do für ein Projekt')}
      ${card('termin', '📅', 'Termin', 'Kalendereintrag mit Datum & Zeit')}
      ${card('rechnung', '🧾', 'Rechnung', 'Teil-/Schlussrechnung zu einem Gewerk')}
      ${card('protokoll', '📝', 'Protokoll / Aktennotiz', 'Sitzung oder Notiz festhalten')}
      ${card('vergabe', '◫', 'Arbeitsbeschrieb', 'Gewerk / Kostenschätzung anlegen')}
      ${card('kontakt', '👤', 'Kontakt', 'Firma / Person zur Adressliste')}
      ${card('projekt', '➕', 'Neues Projekt', 'Bauprojekt anlegen')}
    </div>
    <p class="muted" style="font-size:12px;margin-top:14px">„Pendenz", „Termin" &amp; „Rechnung" fragen zuerst nach dem Projekt – so landet alles am richtigen Ort.</p>
  `);
}
function vergabeOpts(p) {
  const vs = (p && p.vergaben) || [];
  if (!vs.length) return '<option value="">– noch keine Gewerke –</option>';
  return vs.map(v => `<option value="${v.id}">${esc((v.bkp ? v.bkp + ' ' : '') + (v.gewerk || 'Gewerk'))}</option>`).join('');
}
function erfassen(kind) {
  const projekte = sichtbareProjekte();
  const needsProj = ['pendenz', 'termin', 'rechnung', 'protokoll', 'vergabe'].includes(kind);
  if (needsProj && !projekte.length) { toast('Zuerst ein Projekt anlegen', 'info'); return actNewProjekt(); }
  switch (kind) {
    case 'pendenz': return actPendenz();
    case 'projekt': return actNewProjekt();
    case 'kontakt': return actKontakt();
    case 'termin': case 'protokoll': case 'rechnung': case 'vergabe': return erfassenPick(kind);
  }
}
// Projekt (+ ggf. Gewerk/Art) wählen, dann an den richtigen Ort führen und Erfassen-Dialog öffnen
function erfassenPick(kind) {
  const projekte = sichtbareProjekte();
  const first = projekte[0];
  const titel = { termin: 'Termin erfassen', protokoll: 'Protokoll / Aktennotiz', rechnung: 'Rechnung erfassen', vergabe: 'Arbeitsbeschrieb erfassen' }[kind];
  const typSel = kind === 'protokoll' ? `<label class="field">Art <select class="select" id="ef_typ"><option value="sitzung">Sitzungsprotokoll</option><option value="aktennotiz">Aktennotiz</option></select></label>` : '';
  const gewSel = kind === 'rechnung' ? `<label class="field">Gewerk / Arbeitsbeschrieb <select class="select" id="ef_vid">${vergabeOpts(first)}</select></label>` : '';
  openModal(titel, `
    <p class="muted" style="margin:0 0 10px;font-size:12.5px">Für welches Projekt?</p>
    <label class="field">Projekt <select class="select" id="ef_pid">${projekte.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
    ${typSel}${gewSel}
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="erfassen-go" data-kind="${kind}">Weiter</button>`);
  if (kind === 'rechnung') { const ps = $('#ef_pid'); if (ps) ps.addEventListener('change', () => { const vsel = $('#ef_vid'); if (vsel) vsel.innerHTML = vergabeOpts(findProjekt(ps.value)); }); }
}
function erfassenGo(kind) {
  const pid = $('#ef_pid') && $('#ef_pid').value;
  if (!pid) { toast('Bitte ein Projekt wählen', 'info'); return; }
  const typ = $('#ef_typ') && $('#ef_typ').value;
  const vid = $('#ef_vid') && $('#ef_vid').value;
  closeModal();
  if (kind === 'termin') { go('#/projekt/' + pid + '/kalender'); actKalTermin(pid); }
  else if (kind === 'protokoll') { go('#/projekt/' + pid + '/protokolle'); actNewProtokoll(pid, typ); }
  else if (kind === 'vergabe') { go('#/projekt/' + pid); actNewVergabe(pid); }
  else if (kind === 'rechnung') {
    if (!vid) { toast('Dieses Projekt hat noch kein Gewerk – zuerst Arbeitsbeschrieb erfassen', 'info'); go('#/projekt/' + pid); return actNewVergabe(pid); }
    go('#/projekt/' + pid + '/kosten'); actNewRechnung(pid, vid);
  }
}

/* ---------------------------------------------------------------
   Finanzierung: Gebäudestruktur + Rentabilität (Miete & Verkauf)
   --------------------------------------------------------------- */

const GESCHOSS_TYPEN = ['Untergeschoss / Keller', 'Einstellhalle', 'Erdgeschoss', 'Obergeschoss', 'Attika', 'Dachgeschoss'];

function finanzData(p) { p.finanz = p.finanz || { land: 0, honorare: 0, finanzierung: 0 }; return p.finanz; }
function alleEinheiten(p) { return (p.geschosseListe || []).flatMap(g => (g.einheiten || []).map(u => ({ u, g }))); }
// Wohnungs-/Einheiten-Label: löst eine Einheit-ID zur echten Bezeichnung auf (Rückwärtskompat: alte Nummern → „Whg N")
function einheitName(p, id) {
  if (!id) return 'Allgemein';
  const hit = alleEinheiten(p).find(x => x.u.id === id);
  return hit ? (hit.u.name || 'Wohnung') : ('Whg ' + id);
}
function baukostenTotal(p) { return (p.vergaben || []).reduce((a, v) => a + kostenZeile(v).prognose, 0); }
function flaecheTotalStruktur(p) { return alleEinheiten(p).reduce((a, x) => a + (Number(x.u.m2) || 0), 0); }
function anlagekosten(p) { const f = finanzData(p); return (Number(f.land) || 0) + baukostenTotal(p) + (Number(f.honorare) || 0) + (Number(f.finanzierung) || 0); }
function syncGebaeude(p) { const e = alleEinheiten(p); if (e.length) { p.wohnungen = e.length; const fl = flaecheTotalStruktur(p); if (fl) p.flaeche = fl; } }

function viewFinanz(pid) {
  const p = findProjekt(pid); if (!p) { render(emptyState('⚠', 'Projekt nicht gefunden.')); return; }
  const f = finanzData(p);
  const einh = alleEinheiten(p);
  const flTot = flaecheTotalStruktur(p);
  const bauk = baukostenTotal(p);
  const anlage = anlagekosten(p);
  const jahresMiete = einh.reduce((a, x) => a + (Number(x.u.miete) || 0), 0) * 12;
  const verkaufTotal = einh.reduce((a, x) => a + (Number(x.u.verkauf) || 0), 0);
  const bruttoRendite = anlage > 0 ? jahresMiete / anlage * 100 : 0;
  const gewinn = verkaufTotal - anlage;
  const margeKost = anlage > 0 ? gewinn / anlage * 100 : 0;
  const kpiF = (l, v) => `<div class="kpi"><div class="k-label">${l}</div><div class="k-value" style="font-size:20px">${v}</div></div>`;

  const strukturHtml = (p.geschosseListe || []).length ? (p.geschosseListe).map(g => `
    <div class="card card-pad" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div><strong>${esc(g.name || 'Geschoss')}</strong>${g.typ ? ` <span class="tag">${esc(g.typ)}</span>` : ''}</div>
        <div style="display:flex;gap:6px">
          <button class="btn sm secondary" data-act="new-einheit" data-pid="${p.id}" data-gid="${g.id}">+ Einheit</button>
          <button class="x-btn" data-act="edit-geschoss" data-pid="${p.id}" data-gid="${g.id}" title="Geschoss bearbeiten">✏</button>
          <button class="x-btn" data-act="rm-geschoss" data-pid="${p.id}" data-gid="${g.id}" title="Geschoss löschen">×</button>
        </div>
      </div>
      ${(g.einheiten || []).length ? `<table class="grid"><thead><tr><th>Einheit</th><th class="num">Zimmer</th><th class="num">m²</th><th class="num">Miete/Mt</th><th class="num">Verkaufspreis</th><th style="width:60px"></th></tr></thead>
        <tbody>${g.einheiten.map(u => `<tr>
          <td><strong>${esc(u.name || '')}</strong></td>
          <td class="num">${u.zimmer ? esc(String(u.zimmer)) : '–'}</td>
          <td class="num">${u.m2 ? Number(u.m2).toLocaleString('de-CH') : '–'}</td>
          <td class="num">${u.miete ? chf(u.miete) : '–'}</td>
          <td class="num">${u.verkauf ? chf(u.verkauf) : '–'}</td>
          <td><button class="x-btn" data-act="edit-einheit" data-pid="${p.id}" data-gid="${g.id}" data-eid="${u.id}">✏</button><button class="x-btn" data-act="rm-einheit" data-pid="${p.id}" data-gid="${g.id}" data-eid="${u.id}">×</button></td>
        </tr>`).join('')}</tbody></table>` : `<div class="muted" style="font-size:12.5px">Noch keine Einheiten – „+ Einheit".</div>`}
    </div>`).join('') : emptyState('🏢', 'Noch keine Geschosse – oben „+ Geschoss".');

  const unitRows = einh.map(x => {
    const u = x.u; const m2 = Number(u.m2) || 0;
    const anteil = flTot > 0 ? anlage * (m2 / flTot) : 0;
    const rend = anteil > 0 ? (Number(u.miete) || 0) * 12 / anteil * 100 : 0;
    const gew = (Number(u.verkauf) || 0) - anteil;
    return `<tr><td><strong>${esc(u.name || '')}</strong><div class="muted" style="font-size:11.5px">${esc(x.g.name || '')}</div></td>
      <td class="num">${m2 ? m2.toLocaleString('de-CH') : '–'}</td>
      <td class="num">${chf(anteil)}</td>
      <td class="num">${u.miete ? chf(u.miete) : '–'}</td>
      <td class="num">${u.miete ? rend.toFixed(1) + '%' : '–'}</td>
      <td class="num">${u.verkauf ? chf(u.verkauf) : '–'}</td>
      <td class="num" style="${u.verkauf ? (gew >= 0 ? 'color:var(--s-green)' : 'color:var(--s-red)') : ''}">${u.verkauf ? chf(gew) : '–'}</td></tr>`;
  }).join('');

  const fin = (id, label, val) => `<label class="field">${label} <input class="input finanz-in" id="${id}" type="number" value="${val || ''}" inputmode="decimal"></label>`;

  render(`
    <div class="breadcrumb"><a href="#/projekte">Projekte</a> › ${esc(p.name)}</div>
    <div class="detail-head"><div><h1 style="margin:0;font-size:23px">${esc(p.name)}</h1><div class="sub" style="margin-top:5px">Finanzierung &amp; Rentabilität</div></div>
      <button class="btn" data-act="new-geschoss" data-pid="${p.id}">+ Geschoss</button></div>
    ${projektTabs(p, 'finanz')}
    ${demoBanner('finanz')}

    <div class="kpi-row">
      ${kpiF('Anlagekosten', chf(anlage))}
      ${kpiF('Wohnungen / m²', einh.length + ' / ' + flTot.toLocaleString('de-CH'))}
      ${kpiF('Bruttorendite (Miete)', anlage > 0 ? bruttoRendite.toFixed(2) + ' %' : '–')}
      ${kpiF('Gewinn (Verkauf)', verkaufTotal > 0 ? chf(gewinn) : '–')}
    </div>

    <div class="section-head"><h2>Gebäudestruktur</h2><span class="hint">Geschosse → Wohnungen/Einheiten mit Zimmer, m², Miete &amp; Verkaufspreis</span></div>
    ${strukturHtml}

    <div class="section-head" style="margin-top:26px"><h2>Anlagekosten (vollumfänglich)</h2></div>
    <div class="card card-pad" style="max-width:560px">
      ${fin('fz_land', 'Landkosten / Grundstück (CHF)', f.land)}
      <label class="field">Baukosten <span class="muted" style="font-weight:400;font-size:11px">(automatisch aus Kosten-Tab)</span> <input class="input" value="${chf(bauk)}" disabled></label>
      ${fin('fz_honorare', 'Honorare / Baunebenkosten (CHF)', f.honorare)}
      ${fin('fz_finanzierung', 'Finanzierung / Reserve (CHF)', f.finanzierung)}
      <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:10px;margin-top:8px"><strong>Anlagekosten total</strong><strong>${chf(anlage)}</strong></div>
    </div>

    <div class="section-head" style="margin-top:26px"><h2>Rentabilität – Vergleich</h2></div>
    <div class="two-col">
      <div class="card card-pad">
        <h3 style="margin:0 0 8px;font-size:14px">📈 Vermietung</h3>
        <div style="display:flex;justify-content:space-between;font-size:13.5px;line-height:2.1"><span>Jahresmiete (Soll)</span><strong>${chf(jahresMiete)}</strong></div>
        <div style="display:flex;justify-content:space-between;font-size:13.5px;line-height:2.1"><span>Bruttorendite</span><strong>${anlage > 0 ? bruttoRendite.toFixed(2) + ' %' : '–'}</strong></div>
      </div>
      <div class="card card-pad">
        <h3 style="margin:0 0 8px;font-size:14px">🏷 Verkauf (Eigentum)</h3>
        <div style="display:flex;justify-content:space-between;font-size:13.5px;line-height:2.1"><span>Verkaufstotal</span><strong>${chf(verkaufTotal)}</strong></div>
        <div style="display:flex;justify-content:space-between;font-size:13.5px;line-height:2.1"><span>Gewinn / Marge</span><strong style="${gewinn >= 0 ? 'color:var(--s-green)' : 'color:var(--s-red)'}">${verkaufTotal > 0 ? chf(gewinn) + ' (' + margeKost.toFixed(1) + '%)' : '–'}</strong></div>
      </div>
    </div>

    <div class="section-head" style="margin-top:26px"><h2>Pro Wohnung</h2><span class="hint">Kostenanteil nach m²-Anteil</span></div>
    <div class="card">${einh.length ? `<table class="grid"><thead><tr><th>Wohnung</th><th class="num">m²</th><th class="num">Kostenanteil</th><th class="num">Miete/Mt</th><th class="num">Rendite</th><th class="num">Verkauf</th><th class="num">Gewinn</th></tr></thead><tbody>${unitRows}</tbody></table>` : emptyState('🏠', 'Noch keine Einheiten erfasst.')}</div>
  `);
  $$('.finanz-in').forEach(inp => inp.addEventListener('change', () => {
    const fd = finanzData(p);
    fd.land = Number($('#fz_land').value) || 0;
    fd.honorare = Number($('#fz_honorare').value) || 0;
    fd.finanzierung = Number($('#fz_finanzierung').value) || 0;
    save(); viewFinanz(pid);
  }));
}

function actNewGeschoss(pid, gid) {
  const p = findProjekt(pid); const g = gid ? (p.geschosseListe || []).find(x => x.id === gid) : null;
  openModal(g ? 'Geschoss bearbeiten' : 'Neues Geschoss', `
    <div class="form-row">
      <label class="field">Bezeichnung <input class="input" id="g_name" value="${g ? esc(g.name || '') : ''}" placeholder="z.B. EG, 1. OG, UG"></label>
      <label class="field">Typ <input class="input" id="g_typ" list="dl_gtyp" value="${g ? esc(g.typ || '') : ''}" placeholder="z.B. Erdgeschoss">${dl('dl_gtyp', GESCHOSS_TYPEN)}</label>
    </div>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-geschoss" data-pid="${pid}"${g ? ` data-gid="${gid}"` : ''}>${g ? 'Speichern' : 'Hinzufügen'}</button>`);
}
function saveGeschoss(pid, gid) {
  const p = findProjekt(pid); p.geschosseListe = p.geschosseListe || [];
  const name = $('#g_name').value.trim() || 'Geschoss'; const typ = $('#g_typ').value.trim();
  const g = gid ? p.geschosseListe.find(x => x.id === gid) : null;
  if (g) { g.name = name; g.typ = typ; } else p.geschosseListe.push({ id: uid('g'), name, typ, einheiten: [] });
  save(); closeModal(); router();
}
function removeGeschoss(pid, gid) {
  const p = findProjekt(pid); p.geschosseListe = (p.geschosseListe || []).filter(x => x.id !== gid);
  syncGebaeude(p); save(); router();
}
function actNewEinheit(pid, gid, eid) {
  const p = findProjekt(pid); const g = (p.geschosseListe || []).find(x => x.id === gid); if (!g) return;
  const u = eid ? (g.einheiten || []).find(x => x.id === eid) : null;
  openModal(u ? 'Einheit bearbeiten' : 'Neue Einheit / Wohnung', `
    <div class="form-row">
      <label class="field">Bezeichnung <input class="input" id="u_name" value="${u ? esc(u.name || '') : ''}" placeholder="z.B. Whg A, 3.5 Zi"></label>
      <label class="field">Zimmer <input class="input" type="number" step="0.5" id="u_zimmer" value="${u ? (u.zimmer ?? '') : ''}" placeholder="3.5"></label>
    </div>
    <div class="form-row">
      <label class="field">Fläche m² <input class="input" type="number" id="u_m2" value="${u ? (u.m2 ?? '') : ''}" placeholder="95"></label>
      <label class="field">Mietzins / Monat (CHF) <input class="input" type="number" id="u_miete" value="${u ? (u.miete ?? '') : ''}" placeholder="2200"></label>
    </div>
    <label class="field">Verkaufspreis (CHF) <input class="input" type="number" id="u_verkauf" value="${u ? (u.verkauf ?? '') : ''}" placeholder="850000"></label>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-einheit" data-pid="${pid}" data-gid="${gid}"${u ? ` data-eid="${eid}"` : ''}>${u ? 'Speichern' : 'Hinzufügen'}</button>`);
}
function saveEinheit(pid, gid, eid) {
  const p = findProjekt(pid); const g = (p.geschosseListe || []).find(x => x.id === gid); if (!g) return;
  g.einheiten = g.einheiten || [];
  const data = { name: $('#u_name').value.trim() || 'Einheit', zimmer: Number($('#u_zimmer').value) || 0, m2: Number($('#u_m2').value) || 0, miete: Number($('#u_miete').value) || 0, verkauf: Number($('#u_verkauf').value) || 0 };
  const u = eid ? g.einheiten.find(x => x.id === eid) : null;
  if (u) Object.assign(u, data); else g.einheiten.push({ id: uid('u'), ...data });
  syncGebaeude(p); save(); closeModal(); router();
}
function removeEinheit(pid, gid, eid) {
  const p = findProjekt(pid); const g = (p.geschosseListe || []).find(x => x.id === gid); if (!g) return;
  g.einheiten = (g.einheiten || []).filter(x => x.id !== eid);
  syncGebaeude(p); save(); router();
}

// Gebäudedaten-Felder (gemeinsam für Anlegen/Bearbeiten)
function gebaeudeFelder(p) {
  p = p || {};
  return `
    <div class="form-row">
      <label class="field">Anzahl Wohnungen <input class="input" type="number" id="f_wohnungen" value="${p.wohnungen ?? ''}" placeholder="z.B. 6"></label>
      <label class="field">Anzahl Geschosse <input class="input" type="number" id="f_geschosse" value="${p.geschosse ?? ''}" placeholder="z.B. 4"></label>
    </div>
    <div class="form-row">
      <label class="field">Fläche m² (BGF) <input class="input" type="number" id="f_flaeche" value="${p.flaeche ?? ''}" placeholder="z.B. 1200"></label>
      <label class="field">Volumen m³ (GV) <input class="input" type="number" id="f_volumen" value="${p.volumen ?? ''}" placeholder="z.B. 4200"></label>
    </div>`;
}
function readGebaeude(p) {
  p.wohnungen = Number($('#f_wohnungen').value) || 0;
  p.geschosse = Number($('#f_geschosse').value) || 0;
  p.flaeche = Number($('#f_flaeche').value) || 0;
  p.volumen = Number($('#f_volumen').value) || 0;
}

function actNewProjekt() {
  openModal('Neues Projekt', `
    <label class="field">Projektname <input class="input" id="f_name" placeholder="z.B. Neubau MFH Sonnenhof"></label>
    <div class="form-row">
      <label class="field">Ort <input class="input" id="f_ort" placeholder="Luzern"></label>
      <label class="field">Bauherr <input class="input" id="f_bauherr" placeholder="…"></label>
    </div>
    <div class="form-row">
      <label class="field">Projektleitung <input class="input" id="f_pl" placeholder="…"></label>
      <label class="field">Phase
        <select class="select" id="f_phase">${PHASEN.map(p => `<option value="${p.key}">${esc(p.label)}</option>`).join('')}</select>
      </label>
    </div>
    <div class="form-row">
      <label class="field">Start <input class="input" type="date" id="f_start"></label>
      <label class="field">Ende <input class="input" type="date" id="f_ende"></label>
    </div>
    <label class="field" style="margin-bottom:2px">Projektfarbe (Kalender &amp; Planung)</label>
    ${farbePickerHtml(projColor(state.projekte.length))}
    <hr style="border:none;border-top:1px solid var(--border);margin:8px 0 4px"><div class="muted" style="font-size:12px;margin-bottom:6px">Gebäudedaten (optional)</div>
    ${gebaeudeFelder(null)}
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-projekt">Projekt anlegen</button>`);
}

function saveProjekt() {
  const name = $('#f_name').value.trim();
  if (!name) { toast('Bitte einen Projektnamen eingeben', 'info'); return; }
  const p = {
    id: uid('p'),
    name,
    ort: $('#f_ort').value.trim() || '–',
    bauherr: $('#f_bauherr').value.trim() || '–',
    projektleiter: $('#f_pl').value.trim() || '–',
    phase: $('#f_phase').value,
    start: $('#f_start').value || '',
    ende: $('#f_ende').value || '',
    farbe: ($('#f_farbe') && $('#f_farbe').value) || '',
    vergaben: [],
    protokolle: [],
    mitglieder: currentUserEmail ? [{ email: currentUserEmail, vorname: currentUserVor, nachname: currentUserNach, slug: currentUserSlug, rolle: 'inhaber' }] : [],
  };
  readGebaeude(p);
  state.projekte.unshift(p);
  save(); closeModal(); go('#/projekt/' + p.id);
  toast('Projekt angelegt');
}

function actEditProjekt(pid) {
  const p = findProjekt(pid); if (!p) return;
  openModal('Projekt bearbeiten', `
    <label class="field">Projektname <input class="input" id="f_name" value="${esc(p.name)}"></label>
    <div class="form-row">
      <label class="field">Ort <input class="input" id="f_ort" value="${esc(p.ort || '')}"></label>
      <label class="field">Bauherr <input class="input" id="f_bauherr" value="${esc(p.bauherr || '')}"></label>
    </div>
    <div class="form-row">
      <label class="field">Projektleitung <input class="input" id="f_pl" value="${esc(p.projektleiter || '')}"></label>
      <label class="field">&nbsp;</label>
    </div>
    <div class="form-row">
      <label class="field">Start <input class="input" type="date" id="f_start" value="${esc(p.start || '')}"></label>
      <label class="field">Ende <input class="input" type="date" id="f_ende" value="${esc(p.ende || '')}"></label>
    </div>
    <div class="form-row">
      <label class="field">Baustart <span class="muted" style="font-weight:400;font-size:11px">(Meilenstein im Gantt)</span> <input class="input" type="date" id="f_baustart" value="${esc(p.baustart || '')}"></label>
      <label class="field">Bezugstermin <span class="muted" style="font-weight:400;font-size:11px">(Meilenstein im Gantt)</span> <input class="input" type="date" id="f_bezug" value="${esc(p.bezug || '')}"></label>
    </div>
    <label class="field" style="margin-bottom:2px">Projektfarbe (Kalender &amp; Planung)</label>
    ${farbePickerHtml(p.farbe || projColor(state.projekte.indexOf(p)))}
    <hr style="border:none;border-top:1px solid var(--border);margin:8px 0 4px"><div class="muted" style="font-size:12px;margin-bottom:6px">Gebäudedaten</div>
    ${gebaeudeFelder(p)}
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-projekt-edit" data-pid="${pid}">Speichern</button>`);
}
function saveProjektEdit(pid) {
  const p = findProjekt(pid); if (!p) return;
  const name = $('#f_name').value.trim(); if (!name) { toast('Bitte einen Projektnamen eingeben', 'info'); return; }
  p.name = name;
  p.ort = $('#f_ort').value.trim() || '–';
  p.bauherr = $('#f_bauherr').value.trim() || '–';
  p.projektleiter = $('#f_pl').value.trim() || '–';
  p.start = $('#f_start').value || '';
  p.ende = $('#f_ende').value || '';
  p.baustart = $('#f_baustart').value || '';
  p.bezug = $('#f_bezug').value || '';
  if ($('#f_farbe')) p.farbe = $('#f_farbe').value || '';
  readGebaeude(p);
  save(); closeModal(); router(); toast('Projekt gespeichert');
}

// Grobe Saison-Termine ("Frühling 26 – Herbst 26") ↔ konkrete Daten (für Gantt/Kalender)
const SAISONEN = [['fruehling', 'Frühling'], ['sommer', 'Sommer'], ['herbst', 'Herbst'], ['winter', 'Winter']];
const SAISON_LABEL = Object.fromEntries(SAISONEN);
function saisonToIso(saison, jahr, ende) {
  const y = Number(jahr); if (!saison || !y) return '';
  if (saison === 'winter') return ende ? isoOf(new Date(y + 1, 2, 0)) : isoOf(new Date(y, 11, 1));
  const sm = { fruehling: 2, sommer: 5, herbst: 8 }[saison];
  const em = { fruehling: 4, sommer: 7, herbst: 10 }[saison];
  if (sm == null) return '';
  return ende ? isoOf(new Date(y, em + 1, 0)) : isoOf(new Date(y, sm, 1));
}
function grobLabel(v) {
  const f = g => g && g.saison ? (SAISON_LABEL[g.saison] || g.saison) + ' ' + g.jahr : '';
  const a = f(v.grobVon), b = f(v.grobBis);
  if (a && b) return a + ' – ' + b;
  if (a) return 'ab ' + a;
  if (b) return 'bis ' + b;
  return '';
}

function actNewVergabe(pid) {
  const yr = today().getFullYear();
  const saisonSel = id => `<div style="display:flex;gap:6px">
    <select class="select" id="${id}_s"><option value="">–</option>${SAISONEN.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
    <select class="select" id="${id}_j">${[0, 1, 2, 3].map(o => `<option value="${yr + o}">${yr + o}</option>`).join('')}</select></div>`;
  openModal('Arbeitsbeschrieb / Kostenschätzung', `
    <div class="form-row">
      <label class="field">BKP-Nr. <input class="input" id="f_bkp" list="dl_fbkp" placeholder="tippen: 211 oder Gewerk…">${bkpDatalist('dl_fbkp')}</label>
      <label class="field">Gewerk / Arbeitsbeschrieb <input class="input" id="f_gewerk" placeholder="z.B. Baumeisterarbeiten"></label>
    </div>
    ${bkpKatalogPanel()}
    <label class="field" style="margin-top:8px">Kostenschätzung (CHF) <input class="input" type="number" id="f_schaetzung" placeholder="250000"></label>
    <label class="field" style="margin-bottom:2px">Grober Baubeginn</label>
    ${saisonSel('f_grobvon')}
    <details style="margin-top:12px">
      <summary style="cursor:pointer;font-weight:600;font-size:13px;padding:4px 0">＋ Details &amp; Submittenten (optional, Power-User)</summary>
      <div style="margin-top:8px">
        <div class="form-row">
          <label class="field">Status <select class="select" id="f_status">${VERGABE_STATUS.map(s => `<option value="${s.key}">${esc(s.label)}</option>`).join('')}</select></label>
          <label class="field">Eingabefrist <input class="input" type="date" id="f_frist"></label>
        </div>
        <div class="form-row">
          <label class="field">Ausführung von (exakt) <input class="input" type="date" id="f_baustart"></label>
          <label class="field">bis (exakt) <input class="input" type="date" id="f_bauende"></label>
        </div>
        <p class="muted" style="font-size:11.5px;margin:0 0 10px">Exakte Daten überschreiben die grobe Saison-Angabe.</p>
        <div class="form-row">
          <label class="field">Direktvergabe an (fixer Unternehmer) <input class="input" id="f_fix" placeholder="leer = Ausschreibung"></label>
          <label class="field">Vergabesumme (CHF) <input class="input" type="number" id="f_fixbetrag"></label>
        </div>
        <label class="field">Submittenten einladen <span class="muted" style="font-weight:400;font-size:11px">(eine Firma pro Zeile)</span>
          <textarea class="input" id="f_subs" rows="3" placeholder="Hugentobler Bau AG&#10;Steiner & Co.&#10;BauKern AG"></textarea>
        </label>
      </div>
    </details>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-vergabe" data-pid="${pid}">Erfassen</button>`);
  const bkpEl = $('#f_bkp');
  if (bkpEl) bkpEl.addEventListener('change', () => {
    const { label } = parseBkp(bkpEl.value);
    const g = $('#f_gewerk');
    if (g && !g.value.trim() && label) g.value = label;
  });
  wireBkpKatalog();
}

function saveVergabe(pid) {
  const p = findProjekt(pid);
  if (!p) return;
  const val = id => { const el = $('#' + id); return el ? el.value : ''; };
  const bkpParsed = parseBkp(val('f_bkp'));
  const gewerk = $('#f_gewerk').value.trim() || bkpParsed.label;
  if (!gewerk) { toast('Bitte ein Gewerk / einen Arbeitsbeschrieb eingeben', 'info'); return; }

  // Grober Baubeginn (Saison) → Datum (exakte Daten haben Vorrang)
  const gvS = val('f_grobvon_s'), gvJ = val('f_grobvon_j');
  const grobVon = gvS ? { saison: gvS, jahr: Number(gvJ) } : null;
  const grobBis = null;
  const bauStart = val('f_baustart') || (grobVon ? saisonToIso(gvS, gvJ, false) : '');
  const bauEnde = val('f_bauende') || '';

  let status = val('f_status') || 'ausschreibung';
  const fix = val('f_fix').trim();
  const subs = val('f_subs').split('\n').map(s => s.trim()).filter(Boolean);
  const mailOf = firma => (state.kontakte || []).find(k => k.firma === firma) || {};
  const eingeladene = subs.map(firma => ({ id: uid('e'), firma, email: mailOf(firma).email || '', betrag: null, status: 'eingeladen', datumMail: '' }));
  let firma = '', betrag = 0;
  if (fix) { firma = fix; betrag = Number(val('f_fixbetrag')) || 0; if (status === 'ausschreibung') status = 'vergeben'; }

  const v = {
    id: uid('v'), bkp: bkpParsed.code || '000', gewerk,
    schaetzung: Number($('#f_schaetzung').value) || 0, frist: val('f_frist') || '',
    status, firma, betrag, bauStart, bauEnde, grobVon, grobBis,
    eingeladene, nachtraege: [], rapporte: [], vorgaenge: [], rechnungen: [], budgetposten: [],
  };
  p.vergaben.push(v);
  save(); closeModal(); go('#/projekt/' + p.id + '/vergabe/' + v.id);
  toast('Arbeitsbeschrieb erfasst');
}

/* --- Kostenschätzungs-Tool (Beschrieb + interne Kalkulation) --- */
// Einheiten für die Ausmass-Kalkulation (Menge × Einheitspreis)
const KALK_EINHEITEN = ['', 'm³', 'm²', 'm¹', 'lfm', 'Stk', 'kg', 't', 'h', 'pausch.'];
function kalkTotal(k) {
  if (!k) return 0;
  const menge = (Number(k.menge) || 0) * (Number(k.einheitspreis) || 0);   // Ausmass: Menge × EP
  const std = (Number(k.mann) || 0) * (Number(k.tage) || 0) * (Number(k.stdTag) || 0);
  const arbeit = std * (Number(k.ansatz) || 0);
  const sub = menge + arbeit + (Number(k.material) || 0);
  return Math.round(sub * (1 + (Number(k.zuschlag) || 0) / 100));
}
function readKalk() {
  const sv = id => { const el = $('#' + id); return el ? el.value : ''; };
  return {
    menge: Number(sv('ks_menge')) || 0, einheit: sv('ks_einheit') || '', einheitspreis: Number(sv('ks_ep')) || 0,
    mann: Number(sv('ks_mann')) || 0, tage: Number(sv('ks_tage')) || 0,
    stdTag: Number(sv('ks_stdtag')) || 0, ansatz: Number(sv('ks_ansatz')) || 0,
    material: Number(sv('ks_material')) || 0, zuschlag: Number(sv('ks_zuschlag')) || 0,
  };
}
let ksCtx = null;   // Arbeits-Entwurf der Positionen während der Dialog offen ist
function ksReadInputs() {
  if (!ksCtx) return;
  const bel = $('#ks_beschrieb'); if (bel) ksCtx.beschrieb = bel.value;
  ksCtx.positionen.forEach(pos => {
    const t = $('#ks_t_' + pos.id), b = $('#ks_b_' + pos.id); if (t) pos.text = t.value; if (b) pos.betrag = Number(b.value) || 0;
    const bt = $('#ks_bt_' + pos.id), op = $('#ks_op_' + pos.id);
    if (bt && bt.value !== '__new') pos.bauteil = bt.value;
    if (op && op.value !== '__new') pos.option = op.value;
  });
  if ($('#ks_mann')) ksCtx.calc = readKalk();
}
function ksTotal() { return (ksCtx ? ksCtx.positionen : []).reduce((a, p) => a + (Number(p.betrag) || 0), 0); }

function actKostenschaetzung(pid, vid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid); if (!v) return;
  let positionen = (v.ksPositionen || []).map(x => ({ ...x }));
  if (!positionen.length) {   // aus Altdaten / leer migrieren
    positionen = ((v.schaetzung || 0) > 0 || v.beschrieb)
      ? [{ id: uid('ks'), text: v.gewerk || 'Position 1', betrag: v.schaetzung || 0, kalk: v.kalk || null }]
      : [{ id: uid('ks'), text: '', betrag: 0 }];
  }
  ksCtx = { pid, vid, beschrieb: v.beschrieb || '', positionen, calc: v.kalk || {} };
  ksRender();
}
function ksRender() {
  const c = ksCtx; if (!c) return;
  const p = findProjekt(c.pid);
  const v = findVergabe(p, c.vid);
  const k = c.calc || {};
  const tagSel = (pos, f, label, list, newLabel) => `<select class="select ks-tag" id="ks_${f === 'bauteil' ? 'bt' : 'op'}_${pos.id}" data-pos="${pos.id}" data-f="${f}" style="font-size:12px;padding:5px 8px;flex:1">
      <option value="">${label} –</option>
      ${(list || []).map(o => `<option value="${o.id}"${pos[f] === o.id ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}
      <option value="__new">${newLabel}</option>
    </select>`;
  const rows = c.positionen.map((pos, i) => `<div style="margin-bottom:9px">
    <div class="form-row" style="gap:6px;align-items:center">
      <input class="input ks-pos-t" id="ks_t_${pos.id}" value="${esc(pos.text || '')}" placeholder="Position (z.B. Aushub, Fundamente, Mauerwerk)" style="flex:2">
      <input class="input ks-pos-b" id="ks_b_${pos.id}" type="number" value="${pos.betrag || ''}" placeholder="CHF" style="flex:1;max-width:130px">
      <button class="x-btn" data-act="ks-pos-del" data-idx="${i}" title="Position entfernen">×</button>
    </div>
    <div style="display:flex;gap:6px;margin-top:4px">
      ${tagSel(pos, 'bauteil', 'Bauteil', p.bauteile, '➕ neues Bauteil…')}
      ${tagSel(pos, 'option', 'Option', p.optionen, '➕ neue Option…')}
    </div>
  </div>`).join('');
  openModal('Kostenschätzung – ' + esc(v && v.gewerk || ''), `
    <label class="field">Beschrieb (gesamtes Gewerk) <textarea class="input" id="ks_beschrieb" rows="2" placeholder="Was umfasst dieses Gewerk? – erscheint im Kostenschätzungs-PDF">${esc(c.beschrieb)}</textarea></label>
    <div class="muted" style="font-size:12px;margin:10px 0 5px"><strong>Positionen</strong> – mehrere möglich (z.B. Baumeister: Aushub, Fundamente, Mauerwerk …)</div>
    <div id="ks_pos">${rows}</div>
    <button class="btn sm secondary" data-act="ks-pos-add" type="button" style="margin-top:2px">+ Position</button>
    <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:9px;margin-top:11px;font-size:15px"><strong>Total Kostenschätzung (KV)</strong><strong id="ks_postotal">${chf(ksTotal())}</strong></div>
    <details style="margin-top:12px"><summary style="cursor:pointer;font-weight:600;font-size:13px;padding:4px 0">🧮 Kalkulationshilfe → als Position übernehmen</summary>
      <div style="margin-top:8px">
        <label class="field">Bezeichnung <input class="input" id="ks_cname" placeholder="z.B. Beton Fundament / Aushub"></label>
        <div class="muted" style="font-size:11.5px;margin:9px 0 3px"><strong>Ausmass</strong> – Menge × Einheitspreis (z.B. 120 m³ × 210.–)</div>
        <div class="form-row">
          <label class="field">Menge <input class="input ks-calc" type="number" id="ks_menge" value="${k.menge ?? ''}"></label>
          <label class="field">Einheit <select class="select ks-calc" id="ks_einheit">${KALK_EINHEITEN.map(u => `<option value="${u}"${(k.einheit || '') === u ? ' selected' : ''}>${u || '–'}</option>`).join('')}</select></label>
          <label class="field">Einheitspreis (CHF) <input class="input ks-calc" type="number" id="ks_ep" value="${k.einheitspreis ?? ''}"></label>
        </div>
        <div class="muted" style="font-size:11.5px;margin:10px 0 3px"><strong>Arbeit</strong> – Stundenkalkulation (optional, wird addiert)</div>
        <div class="form-row"><label class="field">Anzahl Mann <input class="input ks-calc" type="number" id="ks_mann" value="${k.mann ?? ''}"></label><label class="field">Dauer (Tage) <input class="input ks-calc" type="number" id="ks_tage" value="${k.tage ?? ''}"></label></div>
        <div class="form-row"><label class="field">Stunden/Tag <input class="input ks-calc" type="number" id="ks_stdtag" value="${k.stdTag ?? 8}"></label><label class="field">Stundenansatz (CHF) <input class="input ks-calc" type="number" id="ks_ansatz" value="${k.ansatz ?? ''}"></label></div>
        <div class="form-row"><label class="field">Material (CHF, zusätzl.) <input class="input ks-calc" type="number" id="ks_material" value="${k.material ?? ''}"></label><label class="field">Zuschlag % <input class="input ks-calc" type="number" id="ks_zuschlag" value="${k.zuschlag ?? ''}"></label></div>
        <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:8px;margin-top:8px;font-size:14px"><strong>Berechnet</strong><strong id="ks_calctotal">–</strong></div>
        <button class="btn sm" data-act="ks-calc-add" type="button" style="margin-top:9px">→ als Position übernehmen</button>
      </div>
    </details>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-ks" data-pid="${c.pid}" data-vid="${c.vid}">Speichern</button>`);
  $$('.ks-pos-b').forEach(i => i.addEventListener('input', () => { let s = 0; $$('.ks-pos-b').forEach(x => s += Number(x.value) || 0); const el = $('#ks_postotal'); if (el) el.textContent = chf(s); }));
  const cupd = () => { const t = kalkTotal(readKalk()); const el = $('#ks_calctotal'); if (el) el.textContent = t ? chf(t) : '–'; };
  $$('.ks-calc').forEach(i => i.addEventListener('input', cupd)); cupd();
  $$('.ks-tag').forEach(sel => sel.addEventListener('change', () => onKsTag(sel.dataset.pos, sel.dataset.f, sel.value)));
}

// Position einem Bauteil/einer Option zuordnen – „➕ neu" legt direkt ein neues an
function onKsTag(posId, f, val) {
  if (!ksCtx) return;
  const pos = ksCtx.positionen.find(x => x.id === posId); if (!pos) return;
  ksReadInputs();   // andere Eingaben sichern, bevor neu gerendert wird
  if (val === '__new') {
    const isBt = f === 'bauteil';
    const name = (window.prompt(isBt ? 'Name des Bauteils (z.B. Trakt 1, Provisorium):' : 'Name der Option (z.B. Erker, Lift):') || '').trim();
    if (name) {
      const p = findProjekt(ksCtx.pid);
      const id = uid(isBt ? 'bt' : 'op');
      if (isBt) (p.bauteile = p.bauteile || []).push({ id, name });
      else (p.optionen = p.optionen || []).push({ id, name, bauteilId: '', gruppe: '' });
      pos[f] = id; save();
    }
  } else {
    pos[f] = val;
  }
  ksRender();
}
function ksPosAdd() { ksReadInputs(); ksCtx.positionen.push({ id: uid('ks'), text: '', betrag: 0 }); ksRender(); }
function ksPosDel(idx) { ksReadInputs(); ksCtx.positionen.splice(idx, 1); if (!ksCtx.positionen.length) ksCtx.positionen.push({ id: uid('ks'), text: '', betrag: 0 }); ksRender(); }
function ksCalcAdd() {
  ksReadInputs(); const k = ksCtx.calc; const t = kalkTotal(k);
  if (!t) { toast('Kalkulation ergibt 0', 'info'); return; }
  let name = ($('#ks_cname') ? $('#ks_cname').value.trim() : '');
  if (!name) name = (k.menge && k.einheit) ? `${k.menge} ${k.einheit}` : 'Position';
  ksCtx.positionen.push({ id: uid('ks'), text: name, betrag: t, kalk: { ...k } });
  ksCtx.calc = {}; ksRender(); toast('Position aus Kalkulation hinzugefügt');
}
// Bauteil-/Options-Etikett einer Position als kleine Chips (für die Anzeige)
function posTagChips(p, pos) {
  if (!p || !pos) return '';
  const bt = pos.bauteil && (p.bauteile || []).find(b => b.id === pos.bauteil);
  const op = pos.option && (p.optionen || []).find(o => o.id === pos.option);
  let out = '';
  if (bt) out += `<span class="st grey" style="font-size:10px;padding:1px 6px;margin-left:6px">${esc(bt.name)}</span>`;
  if (op) out += `<span class="st amber" style="font-size:10px;padding:1px 6px;margin-left:6px">opt: ${esc(op.name)}</span>`;
  return out;
}
// Kurzbeschrieb der Ausmass-/Arbeitskalkulation einer Position (für die Anzeige)
function kalkInfo(k) {
  if (!k) return '';
  const teile = [];
  if (k.menge && k.einheitspreis) teile.push(`${k.menge} ${esc(k.einheit || '')} × ${chf(k.einheitspreis)}`);
  if (k.mann && k.tage) teile.push(`${k.mann} Mann · ${k.tage} T Arbeit`);
  if (k.zuschlag) teile.push(`+${k.zuschlag}%`);
  return teile.join(' · ');
}
function saveKostenschaetzung(pid, vid) {
  ksReadInputs();
  const p = findProjekt(pid); const v = findVergabe(p, vid); if (!v || !ksCtx) return;
  v.beschrieb = (ksCtx.beschrieb || '').trim();
  v.ksPositionen = ksCtx.positionen.filter(pos => (pos.text && pos.text.trim()) || pos.betrag);
  if (v.ksPositionen.length) v.schaetzung = v.ksPositionen.reduce((a, pos) => a + (Number(pos.betrag) || 0), 0);
  v.kalk = null;
  ksCtx = null; save(); closeModal(); router(); toast('Kostenschätzung gespeichert');
}

/* ============================================================
   Optionen & Bauteile – Auswertung (B2) + Verwaltung
   ------------------------------------------------------------
   Optionen sind standardmässig EINGERECHNET; Ausblenden = Abzug.
   Achsen: option (Add-on, ein-/ausblendbar bzw. Varianten-Gruppe),
           bauteil (Teilprojekt-Partition, reines Auswertungs-Etikett).
   ============================================================ */
let optSel = { pid: null, aus: new Set(), grp: {} };   // Auswahl-Zustand der Auswertung
function optEnsure(p) { if (p && optSel.pid !== p.id) optSel = { pid: p.id, aus: new Set(), grp: {} }; }

// Summe aller einer Option zugeordneten Kostenpositionen (über alle Gewerke)
function optionSumme(p, optId) {
  let s = 0;
  (p.vergaben || []).forEach(v => {
    const pos = v.ksPositionen || [];
    pos.forEach(x => { if (x.option === optId) s += Number(x.betrag) || 0; });
    if (v.option === optId && !pos.length) s += Number(v.schaetzung) || 0;   // Gewerk-Fallback
  });
  return s;
}
function bauteilSumme(p, btId) {
  let s = 0;
  (p.vergaben || []).forEach(v => {
    const pos = v.ksPositionen || [];
    pos.forEach(x => { if (x.bauteil === btId) s += Number(x.betrag) || 0; });
    if (v.bauteil === btId && !pos.length) s += Number(v.schaetzung) || 0;
  });
  return s;
}
// Teilprojekt-Name (leer/unbekannt = Default „Hauptgebäude")
function bauteilName(p, id) { if (!id) return 'Hauptgebäude'; const b = (p.bauteile || []).find(x => x.id === id); return b ? b.name : 'Hauptgebäude'; }
// <option>-Liste mit „Hauptgebäude" als Default zuoberst
function bauteilOptionsHtml(p, sel) { return `<option value=""${!sel ? ' selected' : ''}>Hauptgebäude</option>` + (p.bauteile || []).map(b => `<option value="${b.id}"${sel === b.id ? ' selected' : ''}>${esc(b.name)}</option>`).join(''); }
// Prognose je Teilprojekt (Gewerk → sein Bauteil = „Hauptgebäude" wenn leer; Nachträge mit eigenem Bauteil zählen dort)
function teilprojektSummary(p) {
  const map = {}; const add = (bt, x) => { const k = bt || ''; map[k] = (map[k] || 0) + x; };
  (p.vergaben || []).forEach(v => {
    const z = kostenZeile(v); let base = z.prognose;
    (v.nachtraege || []).forEach(n => { if (n.status === 'genehmigt' && n.bauteil) { const b = Number(n.betrag) || 0; base -= b; add(n.bauteil, b); } });
    add(v.bauteil, base);
  });
  return map;
}
// Bezahlt je Teilprojekt (Rechnung → eigenes Bauteil, sonst das des Gewerks)
function teilprojektBezahlt(p) {
  const map = {}; const add = (bt, x) => { const k = bt || ''; map[k] = (map[k] || 0) + x; };
  (p.vergaben || []).forEach(v => (v.rechnungen || []).filter(r => r.bezahlt).forEach(r => add(r.bauteil !== undefined ? r.bauteil : v.bauteil, rgAuszahlung(r))));
  return map;
}
function teilprojektCard(p, prognoseTotal) {
  if (!(p.bauteile || []).length) return '';
  const mapP = teilprojektSummary(p), mapB = teilprojektBezahlt(p);
  const list = [{ id: '', name: 'Hauptgebäude', std: true }].concat((p.bauteile || []).map(b => ({ id: b.id, name: b.name })));
  const rows = list.map(t => `<tr><td>${esc(t.name)}${t.std ? ' <span class="muted" style="font-size:11px">(Standard)</span>' : ''}</td><td class="num">${money(mapP[t.id] || 0)}</td><td class="num">${money(mapB[t.id] || 0)}</td></tr>`).join('');
  const totB = Object.values(mapB).reduce((a, b) => a + b, 0);
  return `<div class="card card-pad" style="margin-top:18px;max-width:620px">
    <h2 style="margin:0 0 8px;font-size:16px">Kosten je Teilprojekt</h2>
    <table class="grid"><thead><tr><th>Teilprojekt</th><th class="num">Prognose</th><th class="num">Bezahlt</th></tr></thead><tbody>
      ${rows}
      <tr class="ksub"><td><b>Total</b></td><td class="num"><b>${money(prognoseTotal)}</b></td><td class="num"><b>${money(totB)}</b></td></tr>
    </tbody></table>
  </div>`;
}
function setGewerkBauteil(pid, vid, btId) { const p = findProjekt(pid); const v = p && findVergabe(p, vid); if (!v) return; v.bauteil = btId; save(); if (location.hash.includes('/kosten')) viewKosten(pid); }
function setNachtragBauteil(pid, vid, nid, btId) { const p = findProjekt(pid); const v = p && findVergabe(p, vid); const n = v && (v.nachtraege || []).find(x => x.id === nid); if (!n) return; n.bauteil = btId; save(); if (location.hash.includes('/kosten')) viewKosten(pid); }
function setRechnungBauteil(pid, vid, rgid, btId) { const p = findProjekt(pid); const v = p && findVergabe(p, vid); const r = v && (v.rechnungen || []).find(x => x.id === rgid); if (!r) return; r.bauteil = btId; save(); if (location.hash.includes('/kosten')) viewKosten(pid); }
function optGruppenListe(p) {
  const order = [], map = {};
  (p.optionen || []).forEach(o => { const g = o.gruppe || ''; if (g) { if (!map[g]) { map[g] = []; order.push(g); } map[g].push(o); } });
  return order.map(g => ({ gruppe: g, optionen: map[g] }));
}
function optAktivVariante(p, gruppe) {
  if (Object.prototype.hasOwnProperty.call(optSel.grp, gruppe)) return optSel.grp[gruppe];
  const list = (p.optionen || []).filter(o => (o.gruppe || '') === gruppe);
  return list.length ? list[0].id : '';   // Default: erste Variante aktiv
}
// Ist eine Option in der aktuellen Auswahl ausgeblendet/inaktiv?
function optAusgeblendet(p, o) {
  return o.gruppe ? (o.id !== optAktivVariante(p, o.gruppe)) : optSel.aus.has(o.id);
}
// Vertraglicher Abzug einer Option (Eventualposition; Fallback = Schätzwert der Positionen)
function optAbzugVertrag(p, o) {
  return (o.vertragsAbzug != null && o.vertragsAbzug !== '') ? (Number(o.vertragsAbzug) || 0) : optionSumme(p, o.id);
}
// Abzug gegenüber „alles eingerechnet" – auf Schätzungs-Basis (KV)
function optDelta(p) {
  let adj = 0;
  (p.optionen || []).forEach(o => { if (optAusgeblendet(p, o)) adj -= optionSumme(p, o.id); });
  return adj;
}
// dito auf Vertrags-/Prognose-Basis (Offerte/Abgebot/WV)
function optDeltaVertrag(p) {
  let adj = 0;
  (p.optionen || []).forEach(o => { if (optAusgeblendet(p, o)) adj -= optAbzugVertrag(p, o); });
  return adj;
}

function optionenCard(p, kvTotal, prognoseTotal) {
  if (!(p.optionen || []).length) return '';
  optEnsure(p);
  const btName = id => { const b = (p.bauteile || []).find(x => x.id === id); return b ? b.name : ''; };
  const indep = (p.optionen || []).filter(o => !o.gruppe);
  const gruppen = optGruppenListe(p);
  // Vertrags-Abzug-Hinweis je Option, wenn er vom Schätzwert abweicht
  const vNote = o => { const est = optionSumme(p, o.id); const v = optAbzugVertrag(p, o); return (o.vertragsAbzug != null && o.vertragsAbzug !== '' && v !== est) ? ` <span class="muted" style="font-size:10.5px">Vertrag ${money(v)}</span>` : ''; };
  let rows = '';
  if (indep.length) {
    rows += `<div class="muted" style="font-size:12px;margin:4px 0 2px"><strong>Optionen</strong> – Häkchen = eingerechnet, Klick blendet aus</div>`;
    rows += indep.map(o => {
      const on = !optSel.aus.has(o.id), sum = optionSumme(p, o.id);
      return `<div class="opt-row" data-act="opt-toggle" data-pid="${p.id}" data-optid="${o.id}">
        <span style="font-size:16px">${on ? '☑' : '☐'}</span>
        <span style="flex:1">${esc(o.name)}${o.bauteilId ? ` <span class="st grey" style="font-size:10px;padding:1px 6px">${esc(btName(o.bauteilId))}</span>` : ''}${vNote(o)}</span>
        <span class="num" style="${on ? '' : 'opacity:.4;text-decoration:line-through'}">${money(sum)}</span>
      </div>`;
    }).join('');
  }
  gruppen.forEach(g => {
    const active = optAktivVariante(p, g.gruppe);
    rows += `<div class="muted" style="font-size:12px;margin:12px 0 2px"><strong>Variante: ${esc(g.gruppe)}</strong> – genau eine wählen</div>`;
    rows += g.optionen.map(o => {
      const on = o.id === active, sum = optionSumme(p, o.id);
      return `<div class="opt-row" data-act="opt-variante" data-pid="${p.id}" data-grp="${esc(g.gruppe)}" data-optid="${o.id}">
        <span style="font-size:15px">${on ? '◉' : '○'}</span><span style="flex:1">${esc(o.name)}${vNote(o)}</span>
        <span class="num" style="${on ? '' : 'opacity:.4'}">${money(sum)}</span></div>`;
    }).join('');
    rows += `<div class="opt-row" data-act="opt-variante" data-pid="${p.id}" data-grp="${esc(g.gruppe)}" data-optid="" style="color:var(--text-soft)">
      <span style="font-size:15px">${active === '' ? '◉' : '○'}</span><span style="flex:1">keine</span><span class="num">–</span></div>`;
  });
  const delta = optDelta(p), bereinigt = kvTotal + delta;
  const deltaV = optDeltaVertrag(p), bereinigtV = (prognoseTotal || 0) + deltaV;
  const zeigeVertrag = (prognoseTotal != null) && (deltaV !== 0 || prognoseTotal !== kvTotal);
  return `<div class="card card-pad" style="margin-top:18px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:4px">
      <h2 style="margin:0;font-size:16px">Optionen &amp; Varianten</h2>
      <button class="btn sm secondary" data-act="opt-manage" data-pid="${p.id}">⚙ Verwalten</button>
    </div>
    ${rows}
    <div style="border-top:2px solid var(--border);margin-top:10px;padding-top:10px">
      <div class="opt-sum"><span>Kostenschätzung inkl. aller Optionen</span><span class="num">${money(kvTotal)}</span></div>
      <div class="opt-sum"><span>Optionen-Auswahl (Schätzung)</span><span class="num">${delta ? money(delta) : '–'}</span></div>
      <div class="opt-sum" style="font-size:16px;font-weight:700;margin-top:4px"><span>Bereinigte Kostenschätzung</span><span class="num">${money(bereinigt)}</span></div>
      ${zeigeVertrag ? `<div style="border-top:1px dashed var(--border);margin-top:10px;padding-top:10px">
        <div class="opt-sum"><span>Abrechnungsprognose inkl. aller Optionen</span><span class="num">${money(prognoseTotal)}</span></div>
        <div class="opt-sum"><span>Optionen-Auswahl (Vertrag/Offerte)</span><span class="num">${deltaV ? money(deltaV) : '–'}</span></div>
        <div class="opt-sum" style="font-size:16px;font-weight:700;margin-top:4px;color:var(--brand)"><span>Bereinigte Prognose</span><span class="num">${money(bereinigtV)}</span></div>
      </div>` : ''}
    </div>
  </div>`;
}

function bauteilCard(p, kvTotal) {
  if (!(p.bauteile || []).length) return '';
  let zugeordnet = 0;
  const rows = (p.bauteile || []).map(b => { const s = bauteilSumme(p, b.id); zugeordnet += s; return `<tr><td>${esc(b.name)}</td><td class="num">${money(s)}</td></tr>`; }).join('');
  const rest = kvTotal - zugeordnet;
  return `<div class="card card-pad" style="margin-top:18px">
    <h2 style="margin:0 0 8px;font-size:16px">Kosten je Bauteil / Teilprojekt</h2>
    <table class="grid"><thead><tr><th>Bauteil</th><th class="num" style="width:170px">Kostenschätzung</th></tr></thead><tbody>
      <tr><td>Hauptgebäude <span class="muted" style="font-size:11px">(Standard)</span></td><td class="num">${money(rest)}</td></tr>
      ${rows}
      <tr class="ksub"><td><b>Total</b></td><td class="num"><b>${money(kvTotal)}</b></td></tr>
    </tbody></table>
  </div>`;
}

// Rechnungskontrolle: pro BKP/Gewerk Soll (Vergabe) vs. verrechnet vs. bezahlt + „Platz" + Überschreitung.
/* ============================================================
   Baubewilligungsauflagen – Standard-Auflagen + Spezielles tracken
   ============================================================ */
const AUFLAGE_STATUS = {
  offen:       { label: 'offen',       color: 'grey' },
  arbeit:      { label: 'in Arbeit',   color: 'amber' },
  eingereicht: { label: 'eingereicht', color: 'blue' },
  erledigt:    { label: 'erledigt',    color: 'green' },
};
const AUFLAGEN_PHASEN = ['vor Baubeginn', 'während Bau', 'vor Bezug', 'sonstige'];
// Smarte Standard-Auflagen (CH-typisch). „immer" = praktisch jedes Projekt.
const AUFLAGEN_STANDARD = [
  { titel: 'Baubeginn melden (Baustartanzeige an Gemeinde)', kat: 'Meldung',    phase: 'vor Baubeginn' },
  { titel: 'Schnurgerüst / Gebäudeprofil abstecken (Geometer)', kat: 'Abnahme', phase: 'vor Baubeginn' },
  { titel: 'Baugespann entfernen',                          kat: 'Meldung',    phase: 'vor Baubeginn' },
  { titel: 'Energie-/Wärmedämmnachweis einreichen',         kat: 'Nachweis',   phase: 'vor Baubeginn' },
  { titel: 'Schadstoff-/Asbestabklärung (bei Umbau)',       kat: 'Schadstoffe',phase: 'vor Baubeginn' },
  { titel: 'Entsorgungsnachweis Aushub / Altlasten',        kat: 'Umwelt',     phase: 'während Bau' },
  { titel: 'Kanalisations-/Werkleitungsabnahme',            kat: 'Abnahme',    phase: 'während Bau' },
  { titel: 'Rohbau-/Schnurgerüstabnahme',                   kat: 'Abnahme',    phase: 'während Bau' },
  { titel: 'Brandschutzabnahme (Feuerpolizei)',             kat: 'Abnahme',    phase: 'vor Bezug' },
  { titel: 'Schutzraum-/Zivilschutzabnahme',                kat: 'Abnahme',    phase: 'vor Bezug' },
  { titel: 'Schlussabnahme / Bezugsbewilligung',            kat: 'Abnahme',    phase: 'vor Bezug' },
  { titel: 'Umgebung / Baumschutz, Ersatzpflanzungen',      kat: 'Umwelt',     phase: 'vor Bezug' },
];
function viewAuflagen(pid) {
  const p = findProjekt(pid); if (!p) { render(emptyState('⚠', 'Projekt nicht gefunden.')); return; }
  const list = p.auflagen || [];
  const offen = list.filter(a => a.status !== 'erledigt').length;
  const stOpt = s => Object.keys(AUFLAGE_STATUS).map(k => `<option value="${k}"${s === k ? ' selected' : ''}>${AUFLAGE_STATUS[k].label}</option>`).join('');
  const row = a => `<tr>
      <td><strong>${esc(a.titel)}</strong>${a.bemerkung ? `<div class="muted" style="font-size:11px">${esc(a.bemerkung)}</div>` : ''}</td>
      <td>${a.kat ? `<span class="tag">${esc(a.kat)}</span>` : '–'}</td>
      <td class="muted">${a.termin ? fmtDate(a.termin) : '–'}</td>
      <td class="muted">${esc(a.zustaendig || '–')}</td>
      <td><select class="select au-status" data-pid="${p.id}" data-aid="${a.id}" style="padding:4px 8px;min-width:120px">${stOpt(a.status || 'offen')}</select></td>
      <td style="white-space:nowrap"><button class="x-btn" data-act="edit-auflage" data-pid="${p.id}" data-aid="${a.id}" title="bearbeiten">✏</button><button class="x-btn" data-act="rm-auflage" data-pid="${p.id}" data-aid="${a.id}" title="löschen">×</button></td>
    </tr>`;
  const sections = AUFLAGEN_PHASEN.map(ph => {
    const items = list.filter(a => (a.phase || 'sonstige') === ph);
    if (!items.length) return '';
    return `<div class="section-head" style="margin-top:18px"><h2>${esc(ph)}</h2><span class="hint">${items.filter(a => a.status !== 'erledigt').length} offen</span></div>
      <div class="card" style="overflow-x:auto"><table class="grid"><thead><tr><th>Auflage</th><th>Kategorie</th><th>Frist</th><th>Zuständig</th><th style="width:130px">Status</th><th></th></tr></thead><tbody>${items.map(row).join('')}</tbody></table></div>`;
  }).join('');
  render(`
    <div class="breadcrumb"><a href="#/projekte">Projekte</a> › <a href="#/projekt/${p.id}">${esc(p.name)}</a> › Auflagen</div>
    <div class="detail-head">
      <div><h1 style="margin:0;font-size:23px">Baubewilligungsauflagen</h1><div class="sub" style="margin-top:5px">Auflagen aus der Baubewilligung tracken${list.length ? ` · ${offen} offen` : ''}</div></div>
      <div style="display:flex;gap:8px">${list.length ? '' : `<button class="btn secondary" data-act="auflage-standard" data-pid="${p.id}">★ Standard-Auflagen einfügen</button>`}<button class="btn" data-act="new-auflage" data-pid="${p.id}">+ Auflage</button></div>
    </div>
    ${projektTabs(p, 'auflagen')}
    ${list.length ? sections + `<div style="margin-top:16px"><button class="btn sm secondary" data-act="auflage-standard" data-pid="${p.id}">★ Standard-Auflagen ergänzen</button></div>`
      : emptyState('📋', 'Noch keine Auflagen. „★ Standard-Auflagen einfügen" legt die üblichen an (Baustartmeldung, Abnahmen, Energienachweis …) – Spezielles wie Schadstoffe ergänzt du mit „+ Auflage".')}
    <p class="muted" style="font-size:11.5px;margin-top:12px">Tipp: Frist setzen + „Zuständig" eintragen; Status von „offen" über „eingereicht" bis „erledigt" führen. Offene Auflagen erscheinen oben in der Zählung.</p>
  `);
  $$('.au-status').forEach(sel => sel.addEventListener('change', () => setAuflageStatus(sel.dataset.pid, sel.dataset.aid, sel.value)));
}
function actNewAuflage(pid, aid) {
  const p = findProjekt(pid); const a = aid ? (p.auflagen || []).find(x => x.id === aid) : null;
  openModal(a ? 'Auflage bearbeiten' : 'Neue Auflage', `
    <label class="field">Auflage / Bezeichnung <input class="input" id="au_titel" value="${a ? esc(a.titel || '') : ''}" placeholder="z.B. Schadstoffsanierungskonzept einreichen"></label>
    <div class="form-row">
      <label class="field">Kategorie <input class="input" id="au_kat" list="dl_aukat" value="${a ? esc(a.kat || '') : ''}" placeholder="z.B. Abnahme">
        <datalist id="dl_aukat"><option>Meldung</option><option>Abnahme</option><option>Nachweis</option><option>Schadstoffe</option><option>Umwelt</option><option>Gewässerschutz</option><option>Brandschutz</option></datalist></label>
      <label class="field">Phase <select class="select" id="au_phase">${AUFLAGEN_PHASEN.map(ph => `<option value="${ph}"${(a ? a.phase : 'vor Baubeginn') === ph ? ' selected' : ''}>${esc(ph)}</option>`).join('')}</select></label>
    </div>
    <div class="form-row">
      <label class="field">Frist / Termin <input class="input" type="date" id="au_termin" value="${a ? esc(a.termin || '') : ''}"></label>
      <label class="field">Zuständig <input class="input" id="au_zust" value="${a ? esc(a.zustaendig || '') : ''}" placeholder="z.B. Bauleitung / Geometer"></label>
    </div>
    <label class="field">Status <select class="select" id="au_status">${Object.keys(AUFLAGE_STATUS).map(k => `<option value="${k}"${(a ? a.status : 'offen') === k ? ' selected' : ''}>${AUFLAGE_STATUS[k].label}</option>`).join('')}</select></label>
    <label class="field">Bemerkung <textarea class="input" id="au_bem" rows="2" placeholder="Bezug zu Bewilligungs-Ziffer, Nachweis, Behörde …">${a ? esc(a.bemerkung || '') : ''}</textarea></label>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-auflage" data-pid="${pid}"${a ? ` data-aid="${aid}"` : ''}>${a ? 'Speichern' : 'Hinzufügen'}</button>`);
}
function saveAuflage(pid, aid) {
  const p = findProjekt(pid); p.auflagen = p.auflagen || [];
  const data = { titel: $('#au_titel').value.trim() || 'Auflage', kat: $('#au_kat').value.trim(), phase: $('#au_phase').value, termin: $('#au_termin').value, zustaendig: $('#au_zust').value.trim(), status: $('#au_status').value, bemerkung: $('#au_bem').value.trim() };
  const a = aid ? p.auflagen.find(x => x.id === aid) : null;
  if (a) Object.assign(a, data); else p.auflagen.push({ id: uid('au'), ...data });
  save(); closeModal(); router();
}
function setAuflageStatus(pid, aid, status) {
  const p = findProjekt(pid); const a = (p.auflagen || []).find(x => x.id === aid); if (!a) return;
  a.status = status; save();
}
function removeAuflage(pid, aid) {
  const p = findProjekt(pid); p.auflagen = (p.auflagen || []).filter(x => x.id !== aid); save(); router();
}
function addStandardAuflagen(pid) {
  const p = findProjekt(pid); p.auflagen = p.auflagen || [];
  const vorhanden = new Set(p.auflagen.map(a => a.titel));
  let n = 0;
  AUFLAGEN_STANDARD.forEach(s => { if (!vorhanden.has(s.titel)) { p.auflagen.push({ id: uid('au'), titel: s.titel, kat: s.kat, phase: s.phase, termin: '', zustaendig: '', status: 'offen', bemerkung: '' }); n++; } });
  save(); router(); toast(n ? n + ' Standard-Auflagen eingefügt' : 'Alle Standard-Auflagen bereits vorhanden');
}

function viewRechnungen(pid) {
  const p = findProjekt(pid); if (!p) { render(emptyState('⚠', 'Projekt nicht gefunden.')); return; }
  const gw = gewerkeSorted(p).filter(v => isVergeben(v) || (v.rechnungen || []).length);
  let tSoll = 0, tFak = 0, tBez = 0, tPlatz = 0;
  const rows = gw.map(v => {
    const z = kostenZeile(v);
    const platz = z.prognose - z.fakturiert;
    const over = z.fakturiert > z.prognose + 0.5;
    tSoll += z.prognose; tFak += z.fakturiert; tBez += z.bezahlt; tPlatz += platz;
    const offenRg = (v.rechnungen || []).filter(r => !r.bezahlt).length;
    const chip = over ? '<span class="st amber">⚠ überschritten</span>'
      : (Math.abs(platz) < 0.5 && z.fakturiert > 0 ? '<span class="st green">fakturiert</span>'
        : (z.fakturiert > 0 ? '<span class="st blue">in Abrechnung</span>' : '<span class="st grey">offen</span>'));
    const mainRow = `<tr class="clickable" data-goto="#/projekt/${p.id}/vergabe/${v.id}">
      <td><span class="bkp-code">${esc(v.bkp || '')}</span></td>
      <td>${esc(v.gewerk)}<div class="muted" style="font-size:11px">${esc(v.firma || '—')}${offenRg ? ` · ${offenRg} offen` : ''}</div></td>
      <td class="num">${chf(z.prognose)}</td>
      <td class="num">${chf(z.fakturiert)}</td>
      <td class="num">${chf(z.bezahlt)}</td>
      <td class="num" style="font-weight:600;color:${over ? 'var(--s-red)' : (platz < 0.5 ? 'var(--text-soft)' : 'var(--s-green)')}">${chf(platz)}</td>
      <td>${chip}</td>
    </tr>`;
    const rgSub = (v.rechnungen || []).slice().sort((a, b) => (a.datum || '').localeCompare(b.datum || '')).map(r => `<tr class="rg-sub">
      <td></td>
      <td><span class="muted">↳ ${r.datum ? fmtDate(r.datum) : '—'}</span> ${esc(r.text || (r.art === 'gutschrift' ? 'Gutschrift' : 'Rechnung'))}${r.nr ? ` <span class="muted">${esc(r.nr)}</span>` : ''}${r.firma ? ` <span class="muted">· ${esc(r.firma)}</span>` : ''}</td>
      <td></td>
      <td class="num">${chf(rgSigned(r))}</td>
      <td class="num">${r.bezahlt ? chf(rgAuszahlung(r)) : '–'}</td>
      <td></td>
      <td>${r.bezahlt ? '<span class="st green" style="font-size:9px;padding:1px 6px">bezahlt</span>' : '<span class="st amber" style="font-size:9px;padding:1px 6px">offen</span>'}</td>
    </tr>`).join('');
    return mainRow + rgSub;
  }).join('') || '<tr><td colspan="7" class="muted" style="padding:12px">Noch keine vergebenen Gewerke / Rechnungen.</td></tr>';
  render(`
    <div class="breadcrumb"><a href="#/projekte">Projekte</a> › <a href="#/projekt/${p.id}">${esc(p.name)}</a> › Rechnungskontrolle</div>
    <div class="detail-head">
      <div><h1 style="margin:0;font-size:23px">Rechnungskontrolle</h1><div class="sub" style="margin-top:5px">Pro BKP: vergeben · verrechnet · bezahlt · noch „Platz"</div></div>
      <div style="display:flex;gap:8px"><button class="btn secondary" data-act="pdf-rechnungen" data-pid="${p.id}">⬇ PDF</button><button class="btn" data-act="sammelrg" data-pid="${p.id}">+ Sammelrechnung (mehrere BKP)</button></div>
    </div>
    ${projektTabs(p, 'rechnungen')}
    <div class="card" style="overflow-x:auto">
      <table class="grid"><thead><tr><th>BKP</th><th>Gewerk / Firma</th><th class="num">Vergabe (Soll)</th><th class="num">Verrechnet</th><th class="num">Bezahlt</th><th class="num">Platz</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="border-top:2px solid var(--border)"><td colspan="2"><b>Total</b></td><td class="num"><b>${chf(tSoll)}</b></td><td class="num"><b>${chf(tFak)}</b></td><td class="num"><b>${chf(tBez)}</b></td><td class="num"><b style="color:${tPlatz < -0.5 ? 'var(--s-red)' : 'inherit'}">${chf(tPlatz)}</b></td><td></td></tr></tfoot>
      </table>
    </div>
    <p class="muted" style="font-size:11.5px;margin-top:10px"><b>Platz</b> = Vergabe-Soll (WV + genehmigte Nachträge) − bereits verrechnet. Negativ/rot = Überschreitung (Rechnung hat keinen Platz mehr). Zeile anklicken → Gewerk mit allen Rechnungen. „Sammelrechnung" verteilt eine Rechnung (z.B. Maler = auch Gipser) auf mehrere BKP.</p>
  `);
}
// Eine Rechnung auf mehrere BKP/Gewerke aufteilen (z.B. Maler/Gipser)
function actSammelrechnung(pid) {
  const p = findProjekt(pid); if (!p) return;
  const gw = gewerkeSorted(p).filter(isVergeben);
  if (!gw.length) { toast('Keine vergebenen Gewerke vorhanden', 'info'); return; }
  openModal('Sammelrechnung – auf mehrere BKP aufteilen', `
    <div class="form-row">
      <label class="field">Lieferant / Firma <input class="input" id="sr_firma" placeholder="z.B. Farbwerk Maler AG"></label>
      <label class="field">Rechnungs-Nr. <input class="input" id="sr_nr" placeholder="optional"></label>
    </div>
    <div class="form-row">
      <label class="field">Bezeichnung <input class="input" id="sr_text" placeholder="z.B. Maler & Gipser SR1"></label>
      <label class="field">Datum <input class="input" type="date" id="sr_datum" value="${todayIso()}"></label>
    </div>
    <div class="muted" style="font-size:12px;margin:8px 0 4px">Betrag je BKP eintragen – nur Beträge &gt; 0 werden verbucht. „Platz" = noch nicht verrechnet.</div>
    <div style="max-height:300px;overflow:auto">
      ${gw.map(v => { const z = kostenZeile(v); const platz = z.prognose - z.fakturiert; return `<div class="form-row" style="align-items:center;gap:8px;margin-bottom:4px">
        <span style="flex:1;font-size:13px;min-width:0"><span class="bkp-code">${esc(v.bkp || '')}</span> ${esc(v.gewerk)} <span class="muted">· Platz ${chf(platz)}</span></span>
        <input class="input sr-betrag" data-vid="${v.id}" type="number" placeholder="0" style="max-width:120px">
      </div>`; }).join('')}
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:10px;font-weight:700;border-top:1px solid var(--border);padding-top:8px"><span>Summe Rechnung</span><span id="sr_sum">CHF 0</span></div>
    <label class="field" style="margin-top:8px">Status <select class="select" id="sr_bezahlt"><option value="0">offen</option><option value="1">bezahlt</option></select></label>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-sammelrg" data-pid="${pid}">Verbuchen</button>`);
  $$('.sr-betrag').forEach(el => el.addEventListener('input', () => { const s = $$('.sr-betrag').reduce((a, e) => a + (Number(e.value) || 0), 0); $('#sr_sum').textContent = chf(s); }));
}
function saveSammelrechnung(pid) {
  const p = findProjekt(pid); if (!p) return;
  const firma = $('#sr_firma').value.trim(), nr = $('#sr_nr').value.trim(), datum = $('#sr_datum').value;
  const text = $('#sr_text').value.trim() || ('Sammelrechnung' + (firma ? ' ' + firma : ''));
  const bezahlt = $('#sr_bezahlt').value === '1';
  const gruppe = uid('srg');
  let n = 0, summe = 0;
  $$('.sr-betrag').forEach(el => {
    const betrag = Number(el.value) || 0; if (betrag <= 0) return;
    const v = (p.vergaben || []).find(x => x.id === el.dataset.vid); if (!v) return;
    v.rechnungen = v.rechnungen || [];
    v.rechnungen.push({ id: uid('rg'), gruppe, firma, text, nr, art: 'akonto', betrag, datum, bezahlt });
    n++; summe += betrag;
  });
  if (!n) { toast('Bitte mindestens einen Betrag eingeben', 'info'); return; }
  save(); closeModal(); router(); toast(`Sammelrechnung ${chf(summe)} auf ${n} BKP verbucht`);
}

// Eigener Reiter: Optionale Bauteile & Teilprojekte sauber pflegen + Auswertung
function viewOptionen(pid) {
  const p = findProjekt(pid);
  if (!p) { render(emptyState('⚠', 'Projekt nicht gefunden.')); return; }
  let kv = 0, prog = 0;
  (p.vergaben || []).forEach(v => { const z = kostenZeile(v); kv += z.kv; prog += z.prognose; });
  const leer = !(p.optionen || []).length && !(p.bauteile || []).length;
  render(`
    <div class="breadcrumb"><a href="#/projekte">Projekte</a> › <a href="#/projekt/${p.id}">${esc(p.name)}</a> › Optionen</div>
    <div class="detail-head">
      <div><h1 style="margin:0;font-size:23px">Optionen &amp; Bauteile</h1><div class="sub" style="margin-top:5px">Optionale Bauteile (ein-/ausblenden) &amp; Teilprojekte (Trakt 1–3, Provisorium …)</div></div>
      <div><button class="btn" data-act="opt-manage" data-pid="${p.id}">⚙ Verwalten</button></div>
    </div>
    ${projektTabs(p, 'optionen')}
    ${demoBanner('optionen')}
    ${leer ? emptyState('🧩', 'Noch keine Optionen oder Bauteile angelegt. Mit „⚙ Verwalten" beginnen – danach im jeweiligen Gewerk (Reiter „Kosten" → Gewerk → „✎ Kostenschätzung") die Positionen mit Bauteil/Option etikettieren.') : ''}
    ${optionenCard(p, kv, prog)}
    ${bauteilCard(p, kv)}
    ${leer ? '' : '<p class="muted" style="font-size:12px;margin-top:14px">Positionen etikettierst du im Gewerk („✎ Kostenschätzung"); hier siehst du die Auswertung und kannst Optionen ein-/ausblenden.</p>'}
  `);
}

// Eigener Reiter: alle Nachträge & Rapporte projektweit (über alle Gewerke)
function viewNachtraege(pid) {
  const p = findProjekt(pid);
  if (!p) { render(emptyState('⚠', 'Projekt nicht gefunden.')); return; }
  const gw = gewerkeSorted(p);
  const nts = [], raps = [];
  gw.forEach(v => { (v.nachtraege || []).forEach(n => nts.push({ v, n })); (v.rapporte || []).forEach(r => raps.push({ v, r })); });
  nts.sort((a, b) => (a.n.datum || '').localeCompare(b.n.datum || ''));
  raps.sort((a, b) => (a.r.datum || '').localeCompare(b.r.datum || ''));
  const ntGen = nts.filter(x => x.n.status === 'genehmigt').reduce((a, x) => a + (x.n.betrag || 0), 0);
  const ntAll = nts.reduce((a, x) => a + (x.n.betrag || 0), 0);
  const rapSum = raps.reduce((a, x) => a + (x.r.betrag || 0), 0);
  const rapStd = raps.reduce((a, x) => a + (Number(x.r.stunden) || 0), 0);
  const stOpt = s => ['offen', 'genehmigt', 'abgelehnt'].map(o => `<option value="${o}"${s === o ? ' selected' : ''}>${o.charAt(0).toUpperCase() + o.slice(1)}</option>`).join('');
  const ntRows = nts.length ? nts.map(({ v, n }) => `<tr>
      <td><span class="bkp-code">${esc(v.bkp || '')}</span> ${esc(v.gewerk)}</td>
      <td><strong>${esc(n.titel || 'Nachtrag')}</strong>${n.nr ? ` <span class="muted">${esc(n.nr)}</span>` : ''}</td>
      <td class="muted">${fmtDate(n.datum)}</td>
      <td class="num">${chf(n.betrag)}</td>
      <td><select class="sm-select nt-status" data-pid="${pid}" data-vid="${v.id}" data-nid="${n.id}">${stOpt(n.status)}</select></td>
      <td><button class="x-btn" data-act="rm-nachtrag" data-pid="${pid}" data-vid="${v.id}" data-nid="${n.id}">×</button></td>
    </tr>`).join('') : '<tr><td colspan="6" class="muted" style="padding:10px">Keine Nachträge erfasst.</td></tr>';
  const rapRows = raps.length ? raps.map(({ v, r }) => `<tr>
      <td><span class="bkp-code">${esc(v.bkp || '')}</span> ${esc(v.gewerk)}</td>
      <td><strong>${esc(r.titel || 'Rapport')}</strong></td>
      <td class="muted">${fmtDate(r.datum)}</td>
      <td class="num">${r.stunden ? esc(r.stunden) + ' h' : '–'}</td>
      <td class="num">${chf(r.betrag)}</td>
      <td><button class="x-btn" data-act="rm-rapport" data-pid="${pid}" data-vid="${v.id}" data-rid="${r.id}">×</button></td>
    </tr>`).join('') : '<tr><td colspan="6" class="muted" style="padding:10px">Keine Rapporte erfasst.</td></tr>';
  render(`
    <div class="breadcrumb"><a href="#/projekte">Projekte</a> › <a href="#/projekt/${p.id}">${esc(p.name)}</a> › Nachträge</div>
    <div class="detail-head">
      <div><h1 style="margin:0;font-size:23px">Nachträge &amp; Rapporte</h1><div class="sub" style="margin-top:5px">Projektweite Übersicht über alle Gewerke</div></div>
      <div style="display:flex;gap:8px">
        <button class="btn secondary" data-act="nt-pick" data-pid="${p.id}" data-kind="rapport">+ Rapport</button>
        <button class="btn" data-act="nt-pick" data-pid="${p.id}" data-kind="nachtrag">+ Nachtrag</button>
      </div>
    </div>
    ${projektTabs(p, 'nachtraege')}
    ${demoBanner('nachtraege')}

    <div class="section-head"><h2>Nachträge</h2><span class="hint">Nur genehmigte zählen in die Abrechnungsprognose</span></div>
    <div class="card" style="overflow-x:auto">
      <table class="grid"><thead><tr><th>Gewerk</th><th>Bezeichnung</th><th>Datum</th><th class="num">Betrag</th><th style="width:130px">Status</th><th></th></tr></thead>
        <tbody>${ntRows}</tbody></table>
      <div class="card-pad" style="display:flex;justify-content:space-between;border-top:1px solid var(--border)"><span class="muted">erfasst total ${chf(ntAll)} · davon genehmigt</span><strong>${chf(ntGen)}</strong></div>
    </div>

    <div class="section-head" style="margin-top:22px"><h2>Rapporte / Regie</h2></div>
    <div class="card" style="overflow-x:auto">
      <table class="grid"><thead><tr><th>Gewerk</th><th>Bezeichnung</th><th>Datum</th><th class="num">Stunden</th><th class="num">Betrag</th><th></th></tr></thead>
        <tbody>${rapRows}</tbody></table>
      <div class="card-pad" style="display:flex;justify-content:space-between;border-top:1px solid var(--border)"><span class="muted">${rapStd ? rapStd + ' Std · ' : ''}total</span><strong>${chf(rapSum)}</strong></div>
    </div>
  `);
  $$('.nt-status').forEach(sel => sel.addEventListener('change', () => setNachtragStatus(sel.dataset.pid, sel.dataset.vid, sel.dataset.nid, sel.value)));
}
// Gewerk wählen, dann Nachtrag/Rapport dort erfassen
function actNachtragPick(pid, kind) {
  const p = findProjekt(pid); if (!p) return;
  const gw = gewerkeSorted(p);
  if (!gw.length) { toast('Zuerst ein Gewerk anlegen', 'info'); return; }
  openModal((kind === 'rapport' ? 'Rapport' : 'Nachtrag') + ' – für welches Gewerk?', `
    <div style="display:flex;flex-direction:column;gap:3px;max-height:360px;overflow:auto">
      ${gw.map(v => `<button class="btn ghost" style="justify-content:flex-start;text-align:left" data-act="${kind === 'rapport' ? 'np-rapport' : 'np-nachtrag'}" data-pid="${pid}" data-vid="${v.id}" type="button"><span class="bkp-code">${esc(v.bkp || '')}</span>&nbsp; ${esc(v.gewerk)}</button>`).join('')}
    </div>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button>`);
}

/* --- Verwaltung Bauteile & Optionen --- */
function obtRow(b) {
  return `<div class="bt-row form-row" data-id="${b ? b.id : ''}" style="margin-bottom:6px;align-items:center">
    <input class="input bt-name" placeholder="Bauteil (z.B. Trakt 1, Provisorium)" value="${b ? esc(b.name) : ''}">
    <button class="x-btn" data-act="row-del" type="button" title="entfernen">×</button>
  </div>`;
}
function oopRow(p, o) {
  const bts = (p.bauteile || []);
  return `<div class="op-row form-row" data-id="${o ? o.id : ''}" style="margin-bottom:6px;align-items:center;gap:6px">
    <input class="input op-name" placeholder="Option (z.B. Erker, Lift)" value="${o ? esc(o.name) : ''}" style="flex:2">
    <select class="select op-bt" style="flex:1"><option value="">– Bauteil –</option>${bts.map(b => `<option value="${b.id}"${o && o.bauteilId === b.id ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
    <input class="input op-grp" placeholder="Variante (opt.)" value="${o ? esc(o.gruppe || '') : ''}" style="flex:1" title="Gleicher Variantenname = sich ausschliessende Gruppe">
    <input class="input op-abz" type="number" placeholder="Abzug Vertrag" value="${o && o.vertragsAbzug != null ? o.vertragsAbzug : ''}" style="flex:1;max-width:120px" title="Vertraglicher Abzug von Offert-/WV-Summe (Eventualposition). Leer = Schätzwert.">
    <button class="x-btn" data-act="row-del" type="button" title="entfernen">×</button>
  </div>`;
}
function actBauteileOptionen(pid) {
  const p = findProjekt(pid); if (!p) return;
  openModal('Bauteile &amp; Optionen verwalten', `
    <div class="muted" style="font-size:12px;margin-bottom:6px"><strong>Bauteile / Teilprojekte</strong> – z.B. Trakt 1–3, Provisorium</div>
    <div id="bt_rows">${(p.bauteile || []).map(obtRow).join('')}</div>
    <button class="btn sm secondary" data-act="bt-add" data-pid="${pid}" type="button" style="margin-bottom:16px">+ Bauteil</button>
    <div class="muted" style="font-size:12px;margin-bottom:6px"><strong>Optionen</strong> – z.B. Erker, Lift. „Variante" füllen = sich ausschliessende Gruppe.</div>
    <div id="op_rows">${(p.optionen || []).map(o => oopRow(p, o)).join('')}</div>
    <button class="btn sm secondary" data-act="op-add" data-pid="${pid}" type="button">+ Option</button>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-bt-opt" data-pid="${pid}">Speichern</button>`);
}
function saveBtOpt(pid) {
  const p = findProjekt(pid); if (!p) return;
  const bts = $$('#bt_rows .bt-row').map(r => { const name = r.querySelector('.bt-name').value.trim(); return name ? { id: r.dataset.id || uid('bt'), name } : null; }).filter(Boolean);
  const ops = $$('#op_rows .op-row').map(r => {
    const name = r.querySelector('.op-name').value.trim();
    if (!name) return null;
    const abzEl = r.querySelector('.op-abz'); const abz = abzEl && abzEl.value !== '' ? Number(abzEl.value) : null;
    return { id: r.dataset.id || uid('op'), name, bauteilId: r.querySelector('.op-bt').value || '', gruppe: r.querySelector('.op-grp').value.trim(), vertragsAbzug: abz };
  }).filter(Boolean);
  p.bauteile = bts; p.optionen = ops;
  optSel = { pid: null, aus: new Set(), grp: {} };   // Auswahl-Zustand zurücksetzen (IDs könnten weg sein)
  save(); closeModal(); router(); toast('Bauteile & Optionen gespeichert');
}

/* ============================================================
   Solarrechner (PV) – pro Projekt (A)
   ------------------------------------------------------------
   Richtwerte Schweiz. Förderung (Pronovo EIV) als editierbare
   Defaults – aktuelle Tarife ändern sich, daher anpassbar.
   ============================================================ */
const SOLAR_ORIENT = { sued: ['Süd', 1.0], suedost: ['Südost', 0.96], suedwest: ['Südwest', 0.96], ost: ['Ost', 0.85], west: ['West', 0.85], nordost: ['Nordost', 0.72], nordwest: ['Nordwest', 0.72], nord: ['Nord', 0.6] };
// Neigung als Grad-Eingabe → Ertragsfaktor (Süd-Referenz, linear interpoliert)
const SOLAR_NEIGUNG_ALT = { flach: 5, opt: 30, steil: 45, sehrsteil: 60, fassade: 90 };   // Migration alter Auswahl
function solarTiltFactor(deg) {
  const pts = [[0, 0.88], [10, 0.93], [20, 0.97], [30, 1.0], [35, 1.0], [45, 0.99], [60, 0.94], [75, 0.85], [90, 0.72]];
  if (deg <= 0) return pts[0][1];
  for (let i = 1; i < pts.length; i++) { if (deg <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (deg - a[0]) / (b[0] - a[0]); } }
  return pts[pts.length - 1][1];
}
const SOLAR_DEFAULT = { flaeche: 50, belegung: 80, wpm2: 200, ertrag: 950, orient: 'sued', neigung: 30, verbrauch: 4500, eigenanteil: '', strompreis: 30, einspeise: 10, anlagekosten: '', speicher: '', speicherKosten: '', eivManual: '', bauseite: [], wp: false, eauto: false, boiler: false };
// Personen im Haushalt → geschätzter Grund-Stromverbrauch (ohne WP/E-Auto/Boiler)
const SOLAR_PERSONS = [1, 2, 3, 4, 5];
function solarHaushalt(pers) { return 1400 + 800 * (Number(pers) || 0); }
// Zusatzverbraucher als Schalter (an/aus), kWh/Jahr je
const SOLAR_LOADS = [{ key: 'wp', label: 'Wärmepumpe', kwh: 5000 }, { key: 'eauto', label: 'E-Auto', kwh: 2500 }, { key: 'boiler', label: 'Boiler / Warmwasser', kwh: 3000 }];
function solarZusatz(s) { return SOLAR_LOADS.reduce((a, l) => a + (s[l.key] ? l.kwh : 0), 0); }
// KLEIV-Förderung (Pronovo) mit Leistungsstufen – an offiziellen Werten kalibriert
// (14.25 kWp → ~5'700, 19.3 kWp → ~6'965)
function solarKLEIV(kwp) {
  const tiers = [[15, 380], [15, 250], [Infinity, 170]];   // [kWp-Breite, CHF/kWp]
  let beitrag = 0, rem = kwp;
  for (const [w, rate] of tiers) { const t = Math.min(rem, w); beitrag += t * rate; rem -= t; if (rem <= 0) break; }
  return Math.round(200 + beitrag);                        // 200 = Grundbeitrag
}
// Eigenverbrauchsanteil automatisch: sinkt bei überdimensionierter Anlage, steigt mit Speicher
function solarEVQ(produktion, verbrauch, batteryKwh) {
  if (!produktion || !verbrauch) return 0.30;
  const r = produktion / verbrauch;                        // PV-zu-Verbrauch-Verhältnis
  const evqBase = Math.min(0.92, Math.max(0.04, 0.30 / Math.pow(r, 0.6)));
  const eigen = produktion * evqBase;
  const surplus = produktion - eigen;
  const restload = Math.max(0, verbrauch - eigen);
  const shift = Math.min((Number(batteryKwh) || 0) * 250, surplus, restload) / Math.max(1, r);
  return Math.min(0.92, (eigen + shift) / produktion);
}
// Standort/Lage → spezifischer Ertrag (kWh pro kWp und Jahr)
const SOLAR_REGIONS = [{ label: 'Mittelland', v: 1000 }, { label: 'oft Nebel/Voralpen', v: 900 }, { label: 'sonnig/Berge/Tessin', v: 1100 }, { label: 'eher schattig', v: 850 }];
// Batteriegrösse → kWh + empfohlener Eigenverbrauchsanteil (Nutzen)
const SOLAR_BATTERIES = [{ key: '0', label: 'kein', kwh: 0, eigen: 30 }, { key: '5', label: 'klein ~5 kWh', kwh: 5, eigen: 50 }, { key: '10', label: 'mittel ~10 kWh', kwh: 10, eigen: 62 }, { key: '15', label: 'gross ~15 kWh', kwh: 15, eigen: 70 }];
// Bauseitige Zusatzarbeiten als Schnellauswahl (Richtwerte CHF)
const SOLAR_BAUSEITE = [{ label: 'Baumeister', chf: 2000 }, { label: 'Gerüst', chf: 5000 }, { label: 'Elektriker', chf: 2000 }, { label: 'Spengler', chf: 2000 }];
// Richtwerte für die Automatik (an realer CH-Offerte kalibriert) – immer überschreibbar
const SOLAR_CHF_KWP = 2000;   // Anlagekosten pro kWp (brutto, inkl. Ausführung)
const SOLAR_CHF_KWH = 450;    // Speicherkosten pro kWh

function solarOf(p) {
  const s = Object.assign({}, SOLAR_DEFAULT, p.solar || {});
  // Migration alter Stände (kWp direkt) → Dachfläche
  if ((s.flaeche === '' || s.flaeche == null) && p.solar && p.solar.kwp) {
    const w = Number(s.wpm2) || 200; s.flaeche = Math.round(Number(p.solar.kwp) * 1000 / w);
  }
  if (typeof s.neigung === 'string' && SOLAR_NEIGUNG_ALT[s.neigung] != null) s.neigung = SOLAR_NEIGUNG_ALT[s.neigung];   // alte Auswahl → Grad
  if (!Array.isArray(s.bauseite)) s.bauseite = [];
  return s;
}
function solarCalc(s) {
  const n = x => Number(x) || 0;
  const flaeche = n(s.flaeche), wpm2 = n(s.wpm2);
  const belegung = (s.belegung === '' || s.belegung == null) ? 100 : Math.min(100, Math.max(0, n(s.belegung)));
  const modulflaeche = flaeche * belegung / 100;                          // tatsächlich mit Modulen belegte Fläche
  const kwp = modulflaeche * wpm2 / 1000;                                  // Modulfläche × Modulleistung → kWp
  const tilt = n(s.neigung);
  const nf = solarTiltFactor(tilt);                                       // Neigungsfaktor (interpoliert)
  const oRaw = (SOLAR_ORIENT[s.orient] || SOLAR_ORIENT.sued)[1];
  const of = 1 - (1 - oRaw) * Math.min(1, tilt / 35);                     // Ausrichtung wirkt erst mit zunehmender Neigung
  const produktion = Math.round(kwp * n(s.ertrag) * nf * of);              // kWh/Jahr
  const verbrauchBasis = n(s.verbrauch);                                  // Haushalt ohne Zusatzverbraucher
  const zusatz = solarZusatz(s);                                          // Wärmepumpe/E-Auto/Boiler (Schalter)
  const verbrauch = verbrauchBasis + zusatz;
  const speicher = n(s.speicher);                                         // kWh
  // Eigenverbrauchsanteil: leer = automatisch (aus Verbrauch/Produktion + Speicher)
  const anteilAuto = (s.eigenanteil === '' || s.eigenanteil == null);
  const anteil = anteilAuto ? solarEVQ(produktion, verbrauch, speicher) : Math.min(100, Math.max(0, n(s.eigenanteil))) / 100;
  let eigenverbrauch = Math.round(produktion * anteil);
  const gedeckelt = verbrauch && eigenverbrauch > verbrauch;
  if (gedeckelt) eigenverbrauch = verbrauch;                              // nicht mehr nutzen als verbraucht
  const einspeisung = Math.max(0, produktion - eigenverbrauch);
  const autarkie = verbrauch ? Math.round(eigenverbrauch / verbrauch * 100) : null;
  const sparBezug = eigenverbrauch * n(s.strompreis) / 100;               // CHF (Rp → CHF)
  const verguetung = einspeisung * n(s.einspeise) / 100;
  const ertragJahr = Math.round(sparBezug + verguetung);
  // Stromkosten heute (ohne PV) vs. mit PV
  const stromkostenJetzt = Math.round(verbrauch * n(s.strompreis) / 100);
  const reststrombezug = Math.max(0, verbrauch - eigenverbrauch);          // kWh weiterhin ab Netz
  const stromkostenNeu = Math.round(reststrombezug * n(s.strompreis) / 100 - verguetung);
  // Automatik: leere Felder werden aus kWp / kWh geschätzt (immer überschreibbar)
  const anlageAuto = !(s.anlagekosten !== '' && s.anlagekosten != null);
  const anlage = anlageAuto ? Math.round(kwp * SOLAR_CHF_KWP) : n(s.anlagekosten);
  const speicherAuto = !(s.speicherKosten !== '' && s.speicherKosten != null);
  const speicherKosten = speicherAuto ? Math.round(speicher * SOLAR_CHF_KWH) : n(s.speicherKosten);
  const bauseiteSum = (s.bauseite || []).reduce((a, b) => a + (Number(b.betrag) || 0), 0);
  const invest = anlage + speicherKosten + bauseiteSum;
  const eivAuto = (s.eivManual === '' || s.eivManual == null);
  const eiv = eivAuto ? solarKLEIV(kwp) : n(s.eivManual);                 // KLEIV mit Stufen (Auto) oder manuell
  const netto = Math.max(0, invest - eiv);
  const amort = ertragJahr > 0 ? netto / ertragJahr : null;               // Jahre
  const rendite = netto > 0 ? ertragJahr / netto * 100 : null;            // %/Jahr
  const co2 = Math.round(produktion * 0.128);                            // kg CO₂/Jahr (verdrängter Strommix, Richtwert)
  return { flaeche, belegung, modulflaeche, wpm2, kwp, tilt, of, nf, produktion, verbrauchBasis, zusatz, verbrauch, anteil, anteilAuto, gedeckelt, eigenverbrauch, einspeisung, autarkie, sparBezug, verguetung, ertragJahr, stromkostenJetzt, reststrombezug, stromkostenNeu, anlage, anlageAuto, speicher, speicherKosten, speicherAuto, bauseiteSum, invest, eiv, eivAuto, netto, amort, rendite, co2 };
}

function solarRead() {
  const g = id => { const el = $('#' + id); return el ? el.value : ''; };
  const bauseite = $$('#s_bauseite .bsr').map(r => ({ text: r.querySelector('.bs-text').value.trim(), betrag: Number(r.querySelector('.bs-betrag').value) || 0 })).filter(b => b.text || b.betrag);
  return { flaeche: g('s_flaeche'), belegung: g('s_belegung'), wpm2: g('s_wpm2'), ertrag: g('s_ertrag'), orient: g('s_orient'), neigung: g('s_neigung'), verbrauch: g('s_verbrauch'), eigenanteil: g('s_eigen'), strompreis: g('s_preis'), einspeise: g('s_einsp'), anlagekosten: g('s_anlage'), speicher: g('s_speicher'), speicherKosten: g('s_speicherk'), eivManual: g('s_eivm'), bauseite };
}
// Felder aus dem DOM lesen, Schalter-Zustände (Wärmepumpe …) aus p.solar erhalten
function solarPreserve(p) {
  const prev = p.solar || {};
  const s = solarRead();
  SOLAR_LOADS.forEach(l => { s[l.key] = !!prev[l.key]; });
  return s;
}
function solarUpdate(pid) {
  const p = findProjekt(pid); if (!p) return;
  p.solar = solarPreserve(p); save();
  const r = solarCalc(p.solar);
  const out = $('#solarOut'); if (out) out.innerHTML = solarOutHtml(r, p.solar);
  const box = $('#solarInvestBox'); if (box) box.innerHTML = solarInvestHtml(r);
}
function solarToggle(pid, key) {
  const p = findProjekt(pid); if (!p) return;
  const s = solarPreserve(p);
  s[key] = !s[key];
  p.solar = s; save(); viewSolar(pid);   // neu rendern: Schalter-Optik + Gesamtverbrauch
}
// Batteriegrösse wählen: setzt kWh, Kosten zurück auf Auto, und hebt Eigenverbrauch (Nutzen)
function solarBattery(pid, key) {
  const b = SOLAR_BATTERIES.find(x => x.key === key); if (!b) return;
  const p = findProjekt(pid); if (!p) return;
  const s = solarPreserve(p);
  s.speicher = b.kwh || ''; s.speicherKosten = '';   // Eigenverbrauch wird automatisch berechnet
  p.solar = s; save(); viewSolar(pid);
}
function solarRegion(pid, v) {
  const p = findProjekt(pid); if (!p) return;
  const s = solarPreserve(p); s.ertrag = v;
  p.solar = s; save(); viewSolar(pid);
}
// Bauseitige Zusatzarbeit an-/abwählen (wie Verbraucher-Schalter)
function solarBauseite(pid, label, chf) {
  const p = findProjekt(pid); if (!p) return;
  const s = solarPreserve(p); s.bauseite = s.bauseite || [];
  const i = s.bauseite.findIndex(b => (b.text || '').toLowerCase() === label.toLowerCase());
  if (i >= 0) s.bauseite.splice(i, 1); else s.bauseite.push({ text: label, betrag: chf });
  p.solar = s; save(); viewSolar(pid);
}
// Live-Box „Investition & Förderung" unter den Eingaben
function solarInvestHtml(r) {
  const fr = x => 'CHF ' + Math.round(x).toLocaleString('de-CH');
  const f1 = x => (Math.round(x * 10) / 10).toLocaleString('de-CH');
  return `<div class="opt-sum"><span>Anlagenleistung</span><span class="num">${f1(r.kwp)} kWp</span></div>
    <div class="opt-sum"><span>Investition total${r.anlageAuto ? ' (geschätzt)' : ''}</span><span class="num">${fr(r.invest)}</span></div>
    <div class="opt-sum"><span>− Förderung EIV${r.eivAuto ? ' (geschätzt)' : ''}</span><span class="num">− ${fr(r.eiv)}</span></div>
    <div class="opt-sum" style="font-size:15px;font-weight:700;color:var(--brand)"><span>Netto-Investition</span><span class="num">${fr(r.netto)}</span></div>
    <div class="opt-sum"><span>Amortisation</span><span class="num">${r.amort != null ? f1(r.amort) + ' Jahre' : '–'}</span></div>`;
}
function solarOutHtml(r, s) {
  const kwh = x => Math.round(x).toLocaleString('de-CH');
  const f1 = x => (Math.round(x * 10) / 10).toLocaleString('de-CH');
  const kpi = (l, v, sub, cls) => `<div class="kpi"><div class="k-label">${l}</div><div class="k-value" style="font-size:20px${cls ? ';color:var(--' + cls + ')' : ''}">${v}</div>${sub ? `<div class="muted" style="font-size:11.5px;margin-top:2px">${sub}</div>` : ''}</div>`;
  return `
    <div class="solar-hl">
      <div class="solar-hl-item"><div class="k-label">Erwarteter Ertrag</div><div class="solar-hl-v">${kwh(r.produktion)} kWh<span class="solar-hl-u">/Jahr</span></div></div>
      <div class="solar-hl-item"><div class="k-label">Stromkosten heute</div><div class="solar-hl-v">CHF ${kwh(r.stromkostenJetzt)}<span class="solar-hl-u">/Jahr</span></div></div>
      <div class="solar-hl-item"><div class="k-label">Stromkosten mit PV</div><div class="solar-hl-v" style="color:var(--s-green)">CHF ${kwh(r.stromkostenNeu)}<span class="solar-hl-u">/Jahr</span></div></div>
    </div>
    <p class="muted" style="font-size:12px;margin:8px 0 14px">Ersparnis <b>CHF ${kwh(r.ertragJahr)}/Jahr</b> = Stromkosten heute ${kwh(r.stromkostenJetzt)} − mit PV ${kwh(r.stromkostenNeu)} (Eigenverbrauch gespart + Überschuss vergütet).</p>
    <div class="kpi-row">
      ${kpi('Anlagenleistung', f1(r.kwp) + ' kWp', f1(r.flaeche) + ' m² Dach')}
      ${kpi('Eigenverbrauchsanteil', Math.round(r.anteil * 100) + ' %', kwh(r.eigenverbrauch) + ' kWh' + (r.autarkie != null ? ' · Autarkie ' + r.autarkie + '%' : ''))}
      ${kpi('Einspeisung', kwh(r.einspeisung) + ' kWh', 'ins Netz')}
      ${kpi('CO₂ vermieden', kwh(r.co2) + ' kg', 'pro Jahr')}
    </div>
    <div class="kpi-row" style="margin-top:12px">
      ${kpi('Ertrag pro Jahr', 'CHF ' + kwh(r.ertragJahr), 'Ersparnis + Vergütung', 's-green')}
      ${kpi('Investition', 'CHF ' + kwh(r.invest), 'netto ' + kwh(r.netto) + ' n. Förderung')}
      ${kpi('Amortisation', r.amort != null ? f1(r.amort) + ' Jahre' : '–', 'bis bezahlt', 'brand')}
      ${kpi('Rendite', r.rendite != null ? f1(r.rendite) + ' %' : '–', 'pro Jahr')}
    </div>
    ${solarRechenweg(r, s)}`;
}
function solarRechenweg(r, s) {
  const kwh = x => Math.round(x).toLocaleString('de-CH');
  const f1 = x => (Math.round(x * 10) / 10).toLocaleString('de-CH');
  const fr = x => 'CHF ' + Math.round(x).toLocaleString('de-CH');
  const oL = (SOLAR_ORIENT[s.orient] || SOLAR_ORIENT.sued);
  const row = (f, e) => `<div class="rw-row"><span class="rw-f">${f}</span><span class="rw-e">${e}</span></div>`;
  return `<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px">
    <div style="font-weight:600;font-size:13px;margin-bottom:8px">Rechenweg – Schritt für Schritt</div>
    ${row(`Dachfläche ${f1(r.flaeche)} m² × ${Math.round(r.belegung)} % belegt = ${f1(r.modulflaeche)} m² × ${kwh(r.wpm2)} Wp/m²`, '<b>' + f1(r.kwp) + ' kWp</b>')}
    ${row(`${f1(r.kwp)} kWp × ${kwh(s.ertrag)} kWh/kWp × ${oL[0]} (${r.of.toFixed(2)}) × ${f1(r.tilt)}° Neigung (${r.nf.toFixed(2)})`, '<b>' + kwh(r.produktion) + ' kWh/a</b>')}
    ${r.zusatz ? row(`Verbrauch: Haushalt ${kwh(r.verbrauchBasis)} + Zusatz ${kwh(r.zusatz)}`, '<b>' + kwh(r.verbrauch) + ' kWh</b>') : ''}
    ${row(`Eigenverbrauch: ${kwh(r.produktion)} × ${Math.round(r.anteil * 100)} %${r.anteilAuto ? ' (autom.)' : ''}${r.gedeckelt ? ` → auf Verbrauch ${kwh(r.verbrauch)} begrenzt` : ''}`, kwh(r.eigenverbrauch) + ' kWh')}
    ${row(`Einspeisung: ${kwh(r.produktion)} − ${kwh(r.eigenverbrauch)}`, kwh(r.einspeisung) + ' kWh')}
    ${row(`Ersparnis: ${kwh(r.eigenverbrauch)} kWh × ${s.strompreis} Rp`, fr(r.sparBezug))}
    ${row(`Einspeise-Vergütung: ${kwh(r.einspeisung)} kWh × ${s.einspeise} Rp`, fr(r.verguetung))}
    ${row(`<b>Ertrag pro Jahr</b>`, '<b>' + fr(r.ertragJahr) + '</b>')}
    <div style="height:6px"></div>
    ${row(`PV-Anlagekosten${r.anlageAuto ? ` (${f1(r.kwp)} kWp × ${SOLAR_CHF_KWP}, automatisch)` : ''}`, fr(r.anlage))}
    ${r.speicherKosten ? row(`+ Batteriespeicher${r.speicher ? ` (${f1(r.speicher)} kWh${r.speicherAuto ? ' × ' + SOLAR_CHF_KWH : ''})` : ''}`, fr(r.speicherKosten)) : ''}
    ${r.bauseiteSum ? row(`+ Bauseitige Kosten (Gerüst, Spengler …)`, fr(r.bauseiteSum)) : ''}
    ${row(`= Investition total`, '<b>' + fr(r.invest) + '</b>')}
    ${row(`− Förderung EIV${r.eivAuto ? ' (automatisch)' : ''}`, '− ' + fr(r.eiv))}
    ${row(`<b>= Netto-Investition</b>`, '<b>' + fr(r.netto) + '</b>')}
    <div style="height:6px"></div>
    ${row(`Amortisation: ${fr(r.netto)} ÷ ${fr(r.ertragJahr)}/Jahr`, '<b>' + (r.amort != null ? f1(r.amort) + ' Jahre' : '–') + '</b>')}
  </div>`;
}
function bsRow(pid, text = '', betrag = '') {
  return `<div class="bsr form-row" style="margin-bottom:6px;align-items:center;gap:6px">
    <input class="input bs-text" placeholder="z.B. Gerüst, Elektriker, Netzanschluss" value="${esc(text)}" style="flex:2">
    <input class="input bs-betrag" type="number" placeholder="CHF" value="${betrag !== '' && betrag != null ? betrag : ''}" style="flex:1;max-width:130px">
    <button class="x-btn" data-act="solar-bs-del" data-pid="${pid}" type="button" title="entfernen">×</button>
  </div>`;
}

function viewSolar(pid) {
  const p = findProjekt(pid);
  if (!p) { render(emptyState('⚠', 'Projekt nicht gefunden.')); return; }
  const s = solarOf(p);
  const sel = (id, map, cur) => `<select class="select" id="${id}">${Object.entries(map).map(([k, v]) => `<option value="${k}"${cur === k ? ' selected' : ''}>${esc(v[0])}</option>`).join('')}</select>`;
  // Feld mit Erklär-Zeile (wie Honorarrechner)
  const fld = (id, label, val, unit, hint, ph) => `<label class="field">${label}${unit ? ` <span class="muted" style="font-weight:400;font-size:11px">(${unit})</span>` : ''}
    <input class="input" type="number" id="${id}" value="${val !== '' && val != null ? val : ''}"${ph ? ` placeholder="${ph}"` : ''}>
    ${hint ? `<span class="muted" style="font-size:11px;font-weight:400;display:block;margin-top:3px;line-height:1.4">${hint}</span>` : ''}</label>`;
  const gesamtVerbrauch = (Number(s.verbrauch) || 0) + solarZusatz(s);
  const loadBtns = SOLAR_LOADS.map(l => `<button class="btn xs ${s[l.key] ? '' : 'secondary'}" data-act="solar-load" data-pid="${p.id}" data-load="${l.key}" type="button">${s[l.key] ? '✓ ' : '+ '}${esc(l.label)} ${l.kwh.toLocaleString('de-CH')}</button>`).join('');
  const regBtns = SOLAR_REGIONS.map(rg => `<button class="btn xs ${Number(s.ertrag) === rg.v ? '' : 'secondary'}" data-act="solar-region" data-pid="${p.id}" data-v="${rg.v}" type="button">${esc(rg.label)} ${rg.v}</button>`).join('');
  const sp = Number(s.speicher) || 0;
  const battKey = (SOLAR_BATTERIES.find(b => b.kwh === sp) || {}).key || (sp > 0 ? 'custom' : '0');
  const battBtns = SOLAR_BATTERIES.map(b => `<button class="btn xs ${b.key === battKey ? '' : 'secondary'}" data-act="solar-batt" data-pid="${p.id}" data-key="${b.key}" type="button">${esc(b.label)}</button>`).join('');
  const bsActive = label => (s.bauseite || []).some(b => (b.text || '').toLowerCase() === label.toLowerCase());
  const bauBtns = SOLAR_BAUSEITE.map(b => `<button class="btn xs ${bsActive(b.label) ? '' : 'secondary'}" data-act="solar-bauseite" data-pid="${p.id}" data-label="${esc(b.label)}" data-chf="${b.chf}" type="button">${bsActive(b.label) ? '✓ ' : '+ '}${esc(b.label)} ${b.chf.toLocaleString('de-CH')}</button>`).join('');
  const persBtns = SOLAR_PERSONS.map(np => `<button class="btn xs ${Number(s.verbrauch) === solarHaushalt(np) ? '' : 'secondary'}" data-act="solar-persons" data-pid="${p.id}" data-v="${solarHaushalt(np)}" type="button">${np}${np === 5 ? '+' : ''} Pers. ${solarHaushalt(np).toLocaleString('de-CH')}</button>`).join('');

  render(`
    <div class="breadcrumb"><a href="#/projekte">Projekte</a> › <a href="#/projekt/${p.id}">${esc(p.name)}</a> › Solar</div>
    <div class="detail-head">
      <div><h1 style="margin:0;font-size:23px">☀ Solarrechner</h1><div class="sub" style="margin-top:5px">Photovoltaik-Ertrag, Eigenverbrauch &amp; Wirtschaftlichkeit · ${esc(p.name)}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn secondary" data-act="solar-baukosten" data-pid="${p.id}" title="Investition als Gewerk in die Baukostenübersicht übernehmen">➕ in Baukosten</button>
        <button class="btn secondary" data-act="pdf-solar" data-pid="${p.id}">⬇ Solar-PDF</button>
      </div>
    </div>
    ${projektTabs(p, 'solar')}
    ${demoBanner('solar')}

    <div class="card card-pad" style="margin-bottom:16px;background:var(--brand-soft);border-color:transparent">
      <h2 style="margin-top:0;font-size:15px">So funktioniert's</h2>
      <ol style="margin:0;padding-left:18px;font-size:13px;line-height:1.8">
        <li><strong>Dachfläche</strong> (m²) und ungefähren Belegungs-Anteil eingeben.</li>
        <li><strong>Ausrichtung &amp; Neigung</strong> des Daches wählen.</li>
        <li><strong>Stromverbrauch</strong> erfassen – Wärmepumpe/E-Auto per Knopf dazu.</li>
      </ol>
      <p style="margin:10px 0 0;font-size:13px">→ <strong>Ertrag, Investition und Förderung rechnet der Rechner automatisch aus.</strong> Kosten-Felder leer lassen = geschätzt; eigene Zahlen (z.B. aus einer Offerte) überschreiben die Schätzung.</p>
    </div>

    <details style="margin-bottom:16px">
      <summary style="cursor:pointer;font-weight:600;font-size:13.5px;padding:6px 0">❓ Was bedeuten diese Begriffe? (kurz erklärt)</summary>
      <div class="card card-pad" style="font-size:13px;line-height:1.6;margin-top:8px">
        <p style="margin:0 0 9px"><strong>Belegbare Fläche (%):</strong> Nicht das ganze Dach wird mit Modulen voll – Kamine, Fenster, Ränder bleiben frei. Üblich werden <strong>70–85 %</strong> der Fläche belegt.</p>
        <p style="margin:0 0 9px"><strong>Modulleistung (Wp/m²):</strong> Wie viel Leistung ein Quadratmeter Modul liefert. Standardmodule ~<strong>200</strong>, moderne Premium-Module (z.B. AIKO) ~<strong>235</strong>. Mehr = effizienter = mehr Strom auf gleicher Fläche.</p>
        <p style="margin:0 0 9px"><strong>Spezifischer Ertrag (kWh/kWp):</strong> Wie viel Strom <strong>1 kWp Anlage pro Jahr</strong> liefert. „kWp" ist die Anlagengrösse, „kWh" der tatsächlich erzeugte Strom – der spez. Ertrag verbindet beides. Beispiel: 14 kWp × 1000 = <strong>14’000 kWh/Jahr</strong>. Der Wert hängt von der Lage ab: viel Sonne (Berge, Tessin) → höher (~1100), oft Nebel oder schattige/städtische Lage → tiefer (~850–900). Schweizer Mittelland ~<strong>1000</strong>. Tipp: einfach die passende <strong>Lage anklicken</strong>, dann stimmt der Wert.</p>
        <p style="margin:0 0 9px"><strong>Ausrichtung &amp; Neigung:</strong> Himmelsrichtung (Süd = am meisten Ertrag) und Dachneigung in Grad (~30° ideal, Flachdach ~5–10°). Der Rechner zieht den Ertrag automatisch an/ab.</p>
        <p style="margin:0 0 9px"><strong>Eigenverbrauchsanteil:</strong> Wie viel vom erzeugten Strom du <em>gleich selbst</em> brauchst (statt einzuspeisen). <strong>Der Rechner berechnet ihn automatisch</strong> aus Verbrauch, Produktion und Speicher. Wichtig: eine grosse Anlage auf einem kleinen Verbrauch hat einen <em>tiefen</em> Anteil (viel Überschuss geht ins Netz) – eine Wärmepumpe oder Batterie hebt ihn. Höher = wirtschaftlicher, weil selbst genutzter Strom mehr spart als die Einspeisung bringt.</p>
        <p style="margin:0"><strong>EIV / KLEIV (Förderung):</strong> Einmalvergütung des Bundes (Pronovo) – ein einmaliger Zuschuss, der die Investition senkt. Der Rechner schätzt sie automatisch nach den <strong>Leistungsstufen</strong> (kleinere Anlagen bekommen pro kWp mehr); exakt bei pronovo.ch prüfen.</p>
      </div>
    </details>

    <div class="two-col">
      <div class="card card-pad" id="solarInputs">
        <h2 style="margin:0 0 10px;font-size:15px">1 · Dach &amp; Anlage</h2>
        <div class="form-row">
          ${fld('s_flaeche', 'Dachfläche', s.flaeche, 'm²', 'Geeignete Dachfläche gesamt.')}
          ${fld('s_belegung', 'davon belegbar', s.belegung, '%', 'Wirklich mit Modulen belegt. Typ. 70–85 %.')}
        </div>
        <div class="form-row">
          <label class="field">Ausrichtung ${sel('s_orient', SOLAR_ORIENT, s.orient)}<span class="muted" style="font-size:11px;font-weight:400;display:block;margin-top:3px">Süd = bester Ertrag.</span></label>
          ${fld('s_neigung', 'Dachneigung', s.neigung, '°', '~30° ideal, Flachdach ~5–10°.')}
        </div>
        <div class="form-row">
          ${fld('s_wpm2', 'Modulleistung', s.wpm2, 'Wp/m²', 'Standard ~200, Premium ~235.')}
          ${fld('s_ertrag', 'Spez. Ertrag', s.ertrag, 'kWh/kWp', 'Sonnenertrag je nach Lage – unten Lage wählen.')}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:-2px 0 0">${regBtns}</div>
        <span class="muted" style="font-size:11px;display:block;margin-top:5px;line-height:1.4">Der <b>spezifische Ertrag</b> sagt, wie viele kWh Strom <b>1 kWp Anlage pro Jahr</b> liefert – abhängig von Sonne/Lage. Beispiel: 14 kWp × 1000 = 14’000 kWh/Jahr. Lage wählen oder Zahl eintragen.</span>

        <h2 style="margin:16px 0 10px;font-size:15px">2 · Verbrauch &amp; Tarife</h2>
        <div style="font-size:12.5px;margin:0 0 4px">Personen im Haushalt – schätzt den Grundverbrauch:</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${persBtns}</div>
        ${fld('s_verbrauch', 'Haushalt-Stromverbrauch', s.verbrauch, 'kWh/Jahr', '<b>Ohne</b> Wärmepumpe/E-Auto – die kommen per Knopf dazu:')}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 6px">${loadBtns}</div>
        <div class="muted" style="font-size:12.5px;margin:0 0 10px">Gesamtverbrauch: <b style="color:var(--text)">${gesamtVerbrauch.toLocaleString('de-CH')} kWh/Jahr</b></div>
        ${fld('s_eigen', 'Eigenverbrauchsanteil', s.eigenanteil, '%', 'Leer = <b>automatisch berechnet</b> (aus Verbrauch, Produktion &amp; Speicher). Nur ausfüllen, wenn du einen eigenen Wert kennst.')}
        <div class="form-row">
          ${fld('s_preis', 'Strompreis Bezug', s.strompreis, 'Rp/kWh', 'Was du heute pro kWh zahlst (~25–35).')}
          ${fld('s_einsp', 'Rückliefertarif', s.einspeise, 'Rp/kWh', 'Vergütung für eingespeisten Strom (~6–14).')}
        </div>

        <h2 style="margin:16px 0 10px;font-size:15px">3 · Investition &amp; Förderung <span class="muted" style="font-size:12px;font-weight:400">– leer = automatisch</span></h2>
        ${fld('s_anlage', 'PV-Anlagekosten', s.anlagekosten, 'CHF', 'Leer lassen = ~' + SOLAR_CHF_KWP + ' CHF/kWp geschätzt. Offertpreis hier überschreiben.')}
        <div style="margin-top:12px">
          <div style="font-size:13px;font-weight:600;margin-bottom:5px">Batteriespeicher – Grösse wählen</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${battBtns}</div>
          <span class="muted" style="font-size:11px;display:block;margin-top:5px;line-height:1.4">Grösserer Speicher = <b>mehr Eigenverbrauch</b> (Nutzen, spart mehr) bei <b>mehr Kosten</b> (~${SOLAR_CHF_KWH} CHF/kWh). Beides wird automatisch eingerechnet. Für exakte Werte (z.B. Offerte) unten anpassen:</span>
          <div class="form-row" style="margin-top:6px">
            ${fld('s_speicher', 'Speicher genau', s.speicher, 'kWh', 'aus Auswahl, überschreibbar')}
            ${fld('s_speicherk', 'Speicherkosten', s.speicherKosten, 'CHF', 'leer = automatisch')}
          </div>
        </div>
        <div class="muted" style="font-size:12px;margin:14px 0 4px"><strong>Bauseitige Zusatzkosten</strong> – was die Offerte <em>nicht</em> enthält. Anklicken = dazu/weg:</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">${bauBtns}</div>
        <div id="s_bauseite">${(s.bauseite || []).map(b => bsRow(p.id, b.text, b.betrag)).join('')}</div>
        <button class="btn sm secondary" data-act="solar-bs-add" data-pid="${p.id}" type="button">+ eigene Position</button>
        <div style="margin-top:14px">
          ${fld('s_eivm', 'Förderung EIV / KLEIV', s.eivManual, 'CHF', 'Leer = <b>automatisch</b> nach Pronovo-Leistungsstufen geschätzt. Eigenen Wert (z.B. aus Offerte) hier eintragen.')}
        </div>

        <div style="background:var(--brand-soft);border-radius:10px;padding:12px 14px;margin-top:16px">
          <div style="font-weight:700;font-size:13px;margin-bottom:6px">Investition &amp; Förderung – live</div>
          <div id="solarInvestBox">${solarInvestHtml(solarCalc(s))}</div>
        </div>
      </div>

      <div class="card card-pad">
        <h2 style="margin:0 0 12px;font-size:15px">Ergebnis</h2>
        <div id="solarOut">${solarOutHtml(solarCalc(s), s)}</div>
        <p class="muted" style="font-size:11.5px;margin:14px 0 0">Überschlagsrechnung ohne Degradation/Teuerung. Förder-/Tarifwerte sind Richtwerte. Für eine verbindliche Auslegung Fachplaner beiziehen.</p>
      </div>
    </div>
  `);
  const inp = $('#solarInputs');
  if (inp) { inp.addEventListener('input', () => solarUpdate(pid)); inp.addEventListener('change', () => solarUpdate(pid)); }
}

function pdfSolar(pid) {
  const p = findProjekt(pid); if (!p) return;
  const s = solarOf(p);
  const r = solarCalc(s);
  const kwh = x => Math.round(x).toLocaleString('de-CH') + ' kWh';
  const f1 = x => (Math.round(x * 10) / 10).toLocaleString('de-CH');
  const fr = x => 'CHF ' + Math.round(x).toLocaleString('de-CH');
  const oL = (SOLAR_ORIENT[s.orient] || SOLAR_ORIENT.sued);
  const tr = (l, v) => `<tr><td>${l}</td><td class="num">${v}</td></tr>`;

  const anlage = `<div class="gw">Anlage &amp; Dach</div><table class="t"><tbody>
    ${tr('Dachfläche', f1(r.flaeche) + ' m²')}
    ${tr('davon belegbar', Math.round(r.belegung) + ' %  =  ' + f1(r.modulflaeche) + ' m² Module')}
    ${tr('Modulleistung', Math.round(r.wpm2) + ' Wp/m²')}
    ${tr('<b>Anlagenleistung</b>', '<b>' + f1(r.kwp) + ' kWp</b>')}
    ${tr('Ausrichtung', oL[0])}
    ${tr('Dachneigung', f1(r.tilt) + '°')}
    ${tr('Spezifischer Ertrag', Math.round(Number(s.ertrag)) + ' kWh/kWp·a')}
  </tbody></table>`;

  const ertrag = `<div class="gw">Ertrag &amp; Eigenverbrauch</div><table class="t"><tbody>
    ${tr('<b>Stromproduktion</b>', '<b>' + kwh(r.produktion) + '</b> / Jahr')}
    ${tr('Stromverbrauch', kwh(r.verbrauch) + ' / Jahr')}
    ${tr('Eigenverbrauch', kwh(r.eigenverbrauch) + (r.autarkie != null ? '  ·  Autarkie ' + r.autarkie + ' %' : ''))}
    ${tr('Einspeisung ins Netz', kwh(r.einspeisung))}
    ${tr('CO₂ vermieden', Math.round(r.co2).toLocaleString('de-CH') + ' kg / Jahr')}
  </tbody></table>`;

  const wirt = `<div class="gw">Wirtschaftlichkeit</div><table class="t"><tbody>
    ${tr('Stromkosten heute (ohne PV)', fr(r.stromkostenJetzt) + ' / Jahr')}
    ${tr('Stromkosten mit PV', fr(r.stromkostenNeu) + ' / Jahr')}
    ${tr('<b>Ersparnis pro Jahr</b>', '<b>' + fr(r.ertragJahr) + '</b>')}
    ${tr('PV-Anlagekosten', fr(r.anlage))}
    ${r.speicherKosten ? tr('Batteriespeicher' + (r.speicher ? ' (' + f1(r.speicher) + ' kWh)' : ''), fr(r.speicherKosten)) : ''}
    ${r.bauseiteSum ? tr('Bauseitige Kosten', fr(r.bauseiteSum)) : ''}
    ${tr('<b>Investition total</b>', '<b>' + fr(r.invest) + '</b>')}
    ${tr('− Förderung (EIV)', '− ' + fr(r.eiv))}
    ${tr('<b>Netto-Investition</b>', '<b>' + fr(r.netto) + '</b>')}
    ${tr('Amortisation', r.amort != null ? f1(r.amort) + ' Jahre' : '–')}
    ${tr('Rendite', r.rendite != null ? f1(r.rendite) + ' % / Jahr' : '–')}
  </tbody></table>`;

  const bsRows = (s.bauseite || []).filter(b => b.text || b.betrag).map(b => tr(esc(b.text || 'Position'), fr(Number(b.betrag) || 0))).join('');
  const bsTable = bsRows ? `<div class="gw">Bauseitige Zusatzkosten</div><table class="t"><tbody>${bsRows}</tbody></table>` : '';

  const sub = `${esc(p.name)}${p.ort ? ' · ' + esc(p.ort) : ''} · Stand ${fmtDate(todayIso())}`;
  const note = `<p class="muted" style="margin-top:14px;font-size:10px">Überschlagsrechnung ohne Degradation/Teuerung. Förder- und Tarifwerte sind Richtwerte (Pronovo / lokales EW prüfen). Für eine verbindliche Auslegung Fachplaner beiziehen.</p>`;
  openPrintDoc('Solarrechner – Photovoltaik', sub, anlage + ertrag + wirt + bsTable + note);
}

// Solaranlage als Gewerk in die Baukosten übernehmen (erneut = aktualisieren)
function solarToBaukosten(pid) {
  const p = findProjekt(pid); if (!p) return;
  const r = solarCalc(solarOf(p));
  if (!r.kwp) { toast('Erst die Anlage erfassen (Dachfläche)', 'info'); return; }
  const f1 = x => (Math.round(x * 10) / 10).toLocaleString('de-CH');
  const beschrieb = `Photovoltaik-Anlage ${f1(r.kwp)} kWp · Produktion ~${Math.round(r.produktion).toLocaleString('de-CH')} kWh/Jahr\n`
    + `Investition ${chf(r.invest)} − Förderung ${chf(r.eiv)} = netto ${chf(r.netto)}`
    + (r.amort != null ? ` · Amortisation ${f1(r.amort)} Jahre` : '');
  p.vergaben = p.vergaben || [];
  let v = p.vergaben.find(x => x.solar);
  if (v) {
    v.gewerk = 'Photovoltaik-Anlage'; v.schaetzung = r.invest; v.beschrieb = beschrieb;
    save(); toast('Solar in Baukosten aktualisiert');
  } else {
    p.vergaben.push({
      id: uid('v'), bkp: '245', gewerk: 'Photovoltaik-Anlage', solar: true,
      schaetzung: r.invest, beschrieb, frist: '', status: 'ausschreibung', firma: '', betrag: 0,
      bauStart: '', bauEnde: '', grobVon: null, grobBis: null,
      eingeladene: [], nachtraege: [], rapporte: [], vorgaenge: [], rechnungen: [], budgetposten: [],
    });
    save(); toast('Solar als Gewerk in Baukosten übernommen');
  }
  go('#/projekt/' + pid + '/kosten');
}

/* ============================================================
   U-Wert-Rechner (Bauteil-Schichten → U-Wert + Querschnitt)
   ============================================================ */
const UWERT_MAT = [
  { n: 'Stahlbeton',          l: 2.3,   k: 'massiv' },
  { n: 'Backstein/Mauerwerk', l: 0.8,   k: 'massiv' },
  { n: 'Kalksandstein',       l: 1.0,   k: 'massiv' },
  { n: 'Porenbeton',          l: 0.13,  k: 'massiv' },
  { n: 'Zementestrich',       l: 1.4,   k: 'massiv' },
  { n: 'Holz (Fichte)',       l: 0.13,  k: 'holz' },
  { n: 'Brettschichtholz',    l: 0.13,  k: 'holz' },
  { n: 'Holzfaserdämmung',    l: 0.045, k: 'daemmung' },
  { n: 'Mineralwolle',        l: 0.035, k: 'daemmung' },
  { n: 'Steinwolle',          l: 0.037, k: 'daemmung' },
  { n: 'Glaswolle',           l: 0.035, k: 'daemmung' },
  { n: 'EPS (Styropor)',      l: 0.035, k: 'daemmung' },
  { n: 'XPS',                 l: 0.035, k: 'daemmung' },
  { n: 'PUR/PIR',             l: 0.024, k: 'daemmung' },
  { n: 'Zellulose',           l: 0.040, k: 'daemmung' },
  { n: 'Gipskarton',          l: 0.25,  k: 'platte' },
  { n: 'Zementputz',          l: 1.0,   k: 'putz' },
  { n: 'Kalk-/Gipsputz',      l: 0.70,  k: 'putz' },
];
const UWERT_TYP = {
  wand:  { label: 'Aussenwand',          rsi: 0.13, rse: 0.04, ref: 0.17 },
  dach:  { label: 'Dach / Decke oben',   rsi: 0.10, rse: 0.04, ref: 0.17 },
  boden: { label: 'Boden / Decke unten', rsi: 0.17, rse: 0.04, ref: 0.25 },
};
const UWERT_FARBE = { massiv: '#9aa3ad', holz: '#c89b6a', platte: '#d7dce2', putz: '#c2c8d0', daemmung: '#f2d058' };

function uwertOf(p) {
  if (!p.uwert || !Array.isArray(p.uwert.bauteile) || !p.uwert.bauteile.length) {
    const b = { id: uid('uw'), name: 'Aussenwand', typ: 'wand', schichten: [] };
    p.uwert = { bauteile: [b], aktiv: b.id };
  }
  if (!p.uwert.aktiv || !p.uwert.bauteile.find(b => b.id === p.uwert.aktiv)) p.uwert.aktiv = p.uwert.bauteile[0].id;
  return p.uwert;
}
function uwertActive(p) { const u = uwertOf(p); return u.bauteile.find(b => b.id === u.aktiv); }
function uwertCalc(bt) {
  const typ = UWERT_TYP[bt.typ] || UWERT_TYP.wand;
  const sch = (bt.schichten || []).map(s => { const l = Number(s.lambda) || 0, d = (Number(s.dicke) || 0) / 1000; return { ...s, R: l > 0 ? d / l : 0 }; });
  const sumR = sch.reduce((a, s) => a + s.R, 0);
  const Rtot = typ.rsi + sumR + typ.rse;
  const U = Rtot > 0 ? 1 / Rtot : 0;
  const dicke = sch.reduce((a, s) => a + (Number(s.dicke) || 0), 0);
  return { typ, sch, sumR, Rtot, U, dicke, ref: typ.ref, pass: U <= typ.ref + 1e-9 };
}
function uwertOutHtml(bt) {
  const r = uwertCalc(bt);
  const f2 = x => (Math.round(x * 100) / 100).toLocaleString('de-CH');
  const f3 = x => (Math.round(x * 1000) / 1000).toLocaleString('de-CH');
  const total = r.sch.reduce((a, s) => a + (Number(s.dicke) || 0), 0) || 1;
  const segs = r.sch.map(s => {
    const w = Math.max(5, (Number(s.dicke) || 0) / total * 100);
    return `<div class="uw-seg" style="flex:${w} 1 0;background:${UWERT_FARBE[s.k] || '#cbd5e1'}" title="${esc(s.name || '')} · ${Number(s.dicke) || 0} mm · λ ${s.lambda}"><span>${Number(s.dicke) || 0}</span></div>`;
  }).join('');
  return `
    <div class="uw-cut">
      <div class="uw-end">aussen</div>
      <div class="uw-bars">${segs || '<div class="muted" style="padding:14px;font-size:12px">Schichten links hinzufügen …</div>'}</div>
      <div class="uw-end">innen</div>
    </div>
    <div class="kpi-row" style="margin-top:14px">
      <div class="kpi"><div class="k-label">U-Wert</div><div class="k-value" style="color:var(--${r.pass ? 's-green' : 's-red'})">${f3(r.U)}</div><div class="muted" style="font-size:11px">W/(m²·K)</div></div>
      <div class="kpi"><div class="k-label">R total</div><div class="k-value" style="font-size:20px">${f2(r.Rtot)}</div><div class="muted" style="font-size:11px">m²·K/W</div></div>
      <div class="kpi"><div class="k-label">Bauteildicke</div><div class="k-value" style="font-size:20px">${r.dicke} mm</div></div>
      <div class="kpi"><div class="k-label">Richtwert (CH)</div><div class="k-value" style="font-size:20px">≤ ${f2(r.ref)}</div><div class="muted" style="font-size:11px;color:var(--${r.pass ? 's-green' : 's-red'})">${r.pass ? '✓ erfüllt' : '✗ überschritten'}</div></div>
    </div>
    <p class="muted" style="font-size:11.5px;margin:12px 0 0">R = Dicke ÷ λ je Schicht; + Rsi ${r.typ.rsi} (innen) + Rse ${r.typ.rse} (aussen). U = 1 ÷ R total. Richtwerte: Wand/Dach 0.17, Boden 0.25 W/(m²·K).</p>`;
}
function uwertRead(pid) {
  const p = findProjekt(pid); const bt = uwertActive(p); if (!bt) return;
  (bt.schichten || []).forEach((s, i) => { const l = $('#uw_lambda_' + i), d = $('#uw_dicke_' + i); if (l) s.lambda = Number(l.value) || 0; if (d) s.dicke = Number(d.value) || 0; });
}
function uwertUpdate(pid) {
  const p = findProjekt(pid); uwertRead(pid); save();
  const out = $('#uwertOut'); if (out) out.innerHTML = uwertOutHtml(uwertActive(p));
}
function uwertSetMat(pid, idx, name) {
  const p = findProjekt(pid); uwertRead(pid); const bt = uwertActive(p); const m = UWERT_MAT.find(x => x.n === name); const s = bt.schichten[idx];
  if (s && m) { s.name = m.n; s.lambda = m.l; s.k = m.k; }
  save(); viewUwert(pid);
}
function uwertAddSchicht(pid) {
  const p = findProjekt(pid); uwertRead(pid); const bt = uwertActive(p); const m = UWERT_MAT.find(x => x.k === 'daemmung');
  bt.schichten = bt.schichten || []; bt.schichten.push({ name: m.n, lambda: m.l, k: m.k, dicke: 100 });
  save(); viewUwert(pid);
}
function uwertRmSchicht(pid, idx) {
  const p = findProjekt(pid); uwertRead(pid); const bt = uwertActive(p); bt.schichten.splice(idx, 1); save(); viewUwert(pid);
}
function uwertAddBauteil(pid) {
  const p = findProjekt(pid); const u = uwertOf(p); const b = { id: uid('uw'), name: 'Bauteil ' + (u.bauteile.length + 1), typ: 'wand', schichten: [] };
  u.bauteile.push(b); u.aktiv = b.id; save(); viewUwert(pid);
}
function uwertDelBauteil(pid) {
  const p = findProjekt(pid); const u = uwertOf(p);
  if (u.bauteile.length <= 1) { toast('Mindestens ein Bauteil', 'info'); return; }
  if (!confirm('Bauteil löschen?')) return;
  u.bauteile = u.bauteile.filter(b => b.id !== u.aktiv); u.aktiv = u.bauteile[0].id; save(); viewUwert(pid);
}
function uwertPick(pid, id) { const p = findProjekt(pid); uwertRead(pid); uwertOf(p).aktiv = id; save(); viewUwert(pid); }
function viewUwert(pid) {
  const p = findProjekt(pid); if (!p) { render(emptyState('⚠', 'Projekt nicht gefunden.')); return; }
  const u = uwertOf(p); const bt = uwertActive(p);
  const matOpts = sel => UWERT_MAT.map(m => `<option value="${esc(m.n)}"${sel === m.n ? ' selected' : ''}>${esc(m.n)} (λ ${m.l})</option>`).join('');
  const chips = u.bauteile.map(b => `<button class="btn xs ${b.id === u.aktiv ? '' : 'secondary'}" data-act="uw-pick" data-pid="${p.id}" data-id="${b.id}" type="button">${esc(b.name || 'Bauteil')}</button>`).join('');
  const rows = (bt.schichten || []).map((s, i) => `<div class="form-row" style="gap:6px;align-items:center;margin-bottom:5px">
      <select class="select uw-mat" data-pid="${p.id}" data-idx="${i}" style="flex:2;min-width:0">${matOpts(s.name)}</select>
      <input class="input uw-in" id="uw_lambda_${i}" type="number" step="0.001" value="${s.lambda ?? ''}" title="λ in W/(m·K)" style="max-width:84px">
      <input class="input uw-in" id="uw_dicke_${i}" type="number" value="${s.dicke ?? ''}" placeholder="mm" title="Dicke in mm" style="max-width:84px">
      <button class="x-btn" data-act="uw-rm" data-pid="${p.id}" data-idx="${i}" type="button">×</button>
    </div>`).join('');
  render(`
    <div class="breadcrumb"><a href="#/projekte">Projekte</a> › <a href="#/projekt/${p.id}">${esc(p.name)}</a> › U-Wert</div>
    <div class="detail-head">
      <div><h1 style="margin:0;font-size:23px">U-Wert-Rechner</h1><div class="sub" style="margin-top:5px">Wärmedämmung von Bauteilen – Schichten, U-Wert &amp; Querschnitt</div></div>
    </div>
    ${projektTabs(p, 'uwert')}
    ${demoBanner('uwert')}
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${chips}<button class="btn xs secondary" data-act="uw-newbt" data-pid="${p.id}" type="button">+ Bauteil</button></div>
    <div class="two-col">
      <div class="card card-pad" id="uwertInputs">
        <div class="form-row">
          <label class="field">Bezeichnung <input class="input" id="uw_name" value="${esc(bt.name || '')}"></label>
          <label class="field">Bauteil-Typ <select class="select" id="uw_typ">${Object.entries(UWERT_TYP).map(([k, v]) => `<option value="${k}"${bt.typ === k ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
        </div>
        <div class="muted" style="font-size:12px;margin:10px 0 6px"><strong>Schichten</strong> – von <b>aussen</b> (oben) nach <b>innen</b> (unten): Material · λ · Dicke (mm)</div>
        ${rows || '<p class="muted" style="font-size:12.5px;padding:4px 0">Noch keine Schichten.</p>'}
        <button class="btn sm secondary" data-act="uw-add" data-pid="${p.id}" type="button" style="margin-top:4px">+ Schicht</button>
        <div style="margin-top:14px"><button class="btn ghost sm danger" data-act="uw-delbt" data-pid="${p.id}" type="button">Bauteil löschen</button></div>
      </div>
      <div class="card card-pad">
        <h2 style="margin:0 0 12px;font-size:15px">Querschnitt &amp; Ergebnis</h2>
        <div id="uwertOut">${uwertOutHtml(bt)}</div>
      </div>
    </div>
  `);
  $$('.uw-in').forEach(el => el.addEventListener('input', () => uwertUpdate(pid)));
  $$('.uw-mat').forEach(sel => sel.addEventListener('change', () => uwertSetMat(pid, Number(sel.dataset.idx), sel.value)));
  $('#uw_typ')?.addEventListener('change', e => { uwertRead(pid); uwertActive(p).typ = e.target.value; save(); const out = $('#uwertOut'); if (out) out.innerHTML = uwertOutHtml(uwertActive(p)); });
  $('#uw_name')?.addEventListener('change', e => { uwertActive(p).name = e.target.value.trim() || 'Bauteil'; save(); viewUwert(pid); });
}

/* ============================================================
   Zahlungsplan (Premium): Betrag × SIA-Leistungs-% je Phase,
   Fälligkeiten aus dem Terminprogramm-Zeitraum verteilt.
   ============================================================ */
// Sinnvoller Honorar-Richtwert: 1) früh abgegebenes Honorar (Schätzung/Finanzierung), 2) sonst SIA-Honorarberechnung
function honorarRichtwert(p) {
  const manuell = Math.round(Number(finanzData(p).honorare) || 0);
  if (manuell > 0) return manuell;
  if (p.honorar) { const H = computeHonorar(p.honorar).H; if (H > 0) return Math.round(H); }
  return 0;
}
// Projekt-/Ausführungszeitraum: Projektdaten, sonst aus den Gewerk-Terminen
function zahlungsplanZeitraum(p) {
  let von = p.start || p.baustart || '', bis = p.ende || p.bezug || '';
  const bs = (p.vergaben || []).filter(v => v.bauStart).map(v => v.bauStart);
  const be = (p.vergaben || []).filter(v => v.bauEnde).map(v => v.bauEnde);
  if (!von && bs.length) von = bs.reduce((a, b) => a < b ? a : b);
  if (!bis && be.length) bis = be.reduce((a, b) => a > b ? a : b);
  return { von, bis };
}
// Mehrere Versionen je Projekt (unterschriebener v1 sperrbar, v2 als Revision …)
function zahlungsplaeneOf(p) {
  if (!Array.isArray(p.zahlungsplaene)) {
    p.zahlungsplaene = [];
    if (p.zahlungsplan && typeof p.zahlungsplan === 'object' && Object.keys(p.zahlungsplan).length) {
      p.zahlungsplaene.push(Object.assign({ id: uid('zp'), name: 'Version 1', gesperrt: false }, p.zahlungsplan));
    }
    delete p.zahlungsplan;
  }
  if (!p.zahlungsplaene.length) p.zahlungsplaene.push({ id: uid('zp'), name: 'Version 1', gesperrt: false });
  if (!p.zpAktiv || !p.zahlungsplaene.find(z => z.id === p.zpAktiv)) p.zpAktiv = p.zahlungsplaene[0].id;
  return p.zahlungsplaene;
}
function zahlungsplanOf(p) {
  const list = zahlungsplaeneOf(p);
  const z = list.find(x => x.id === p.zpAktiv) || list[0];
  if (z.modus === undefined) z.modus = 'bauherr';   // 'bauherr' (Werkverträge) | 'honorar' (SIA)
  if (z.honMode === undefined) z.honMode = 'phasen';  // 'phasen' (SIA, Beginn/Ende je Phase) | 'flat' (gleichmässig über Laufzeit)
  if (!Array.isArray(z.phasen) || !z.phasen.length) z.phasen = HONORAR_PHASEN.map(ph => ({ key: ph.key, label: ph.label, pct: ph.pct, beginn: '', ende: '' }));
  z.phasen.forEach(ph => { if (ph.ende === undefined) ph.ende = ph.datum || ''; if (ph.beginn === undefined) ph.beginn = ''; });   // Migration alt: datum = Ende
  if (z.betrag === undefined || z.betrag === null) z.betrag = honorarRichtwert(p);   // Honorar, NICHT die vollen Baukosten
  const zr = zahlungsplanZeitraum(p);
  if (!z.von) z.von = zr.von;   // automatisch aus dem Ausführungs-/Projektzeitraum
  if (!z.bis) z.bis = zr.bis;
  if (!z.overrides) z.overrides = {};   // manuell angepasste Monatsbeträge {YYYY-MM: betrag}
  if (z.gesperrt === undefined) z.gesperrt = false;
  return z;
}
// Versions-/Sperr-/Override-Aktionen
function zpVersion(pid, vid) { const p = findProjekt(pid); p.zpAktiv = vid; save(); viewZahlungsplan(pid); }
function zpVersionNeu(pid) {
  const p = findProjekt(pid); const list = zahlungsplaeneOf(p); const cur = list.find(x => x.id === p.zpAktiv) || list[0];
  const klon = JSON.parse(JSON.stringify(cur)); klon.id = uid('zp'); klon.gesperrt = false; klon.name = 'Version ' + (list.length + 1);
  list.push(klon); p.zpAktiv = klon.id; save(); viewZahlungsplan(pid); toast('Neue Version als Kopie angelegt');
}
function zpLock(pid) { const p = findProjekt(pid); const z = zahlungsplanOf(p); z.gesperrt = !z.gesperrt; save(); viewZahlungsplan(pid); toast(z.gesperrt ? '🔒 Version gesperrt' : '🔓 entsperrt'); }
function zpRename(pid) { const p = findProjekt(pid); const z = zahlungsplanOf(p); const n = window.prompt('Name der Version:', z.name || 'Version'); if (n != null) { z.name = n.trim() || z.name; save(); viewZahlungsplan(pid); } }
function setMonatOverride(pid, key, val) {
  const p = findProjekt(pid); const z = zahlungsplanOf(p); if (z.gesperrt) return;
  z.overrides = z.overrides || {};
  if (val === '' || val == null) delete z.overrides[key]; else z.overrides[key] = Number(val) || 0;
  save(); viewZahlungsplan(pid);
}
function zpMonReset(pid) { const p = findProjekt(pid); const z = zahlungsplanOf(p); if (z.gesperrt) return; z.overrides = {}; save(); viewZahlungsplan(pid); toast('Monatsbeträge auf Auto zurückgesetzt'); }
// Bauherren-Zahlungsplan: jeder vergebene Werkvertrag über seine Bauzeit (Unternehmer-Termine) verteilt
function bauherrPlan(p) {
  const gw = gewerkeSorted(p).filter(isVergeben);
  const map = new Map(); const rows = [];
  gw.forEach(v => {
    const betrag = kostenZeile(v).prognose;
    const s = v.bauStart ? new Date(v.bauStart) : null, e = v.bauEnde ? new Date(v.bauEnde) : null;
    const months = [];
    if (s && e && !isNaN(+s) && !isNaN(+e) && +e >= +s) { let y = s.getFullYear(), m = s.getMonth(); const ey = e.getFullYear(), em = e.getMonth(); while (y < ey || (y === ey && m <= em)) { months.push(y + '-' + String(m + 1).padStart(2, '0')); m++; if (m > 11) { m = 0; y++; } } }
    const per = months.length ? betrag / months.length : 0;
    months.forEach(mk => map.set(mk, (map.get(mk) || 0) + per));
    rows.push({ v, betrag, von: v.bauStart, bis: v.bauEnde, ohneTermin: !months.length });
  });
  const sorted = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let cum = 0; const monate = sorted.map(([k, b]) => { const betrag = rp5(b); cum += betrag; return { key: k, betrag, cum }; });
  const total = rows.filter(r => !r.ohneTermin).reduce((a, r) => a + r.betrag, 0);
  return { rows, monate, total, fehlend: rows.filter(r => r.ohneTermin) };
}
function zpBauherrHtml(p) {
  const r = bauherrPlan(p); const z = zahlungsplanOf(p);
  if (!r.rows.length) return `<div class="card card-pad">${emptyState('🧾', 'Noch keine vergebenen Werkverträge. Sobald Gewerke vergeben + im Reiter „Termine" terminiert sind, erscheint hier der Bauherren-Zahlungsplan.')}</div>`;
  const wvRows = r.rows.map(x => `<tr>
      <td><span class="bkp-code">${esc(x.v.bkp || '')}</span> ${esc(x.v.gewerk)}<div class="muted" style="font-size:11px">${esc(x.v.firma || '—')}</div></td>
      <td class="num">${chf(x.betrag)}</td>
      <td>${x.ohneTermin ? '<span class="st amber">Termine fehlen</span>' : fmtDate(x.von) + ' – ' + fmtDate(x.bis)}</td>
    </tr>`).join('');
  return `
    <div class="card card-pad" style="max-width:840px">
      <h2 style="margin:0 0 8px;font-size:15px">Werkverträge (Grundlage)</h2>
      <div class="card" style="overflow-x:auto"><table class="grid"><thead><tr><th>Gewerk / Firma</th><th class="num">Summe (WV + gen. NT)</th><th>Bauzeitraum (Unternehmer)</th></tr></thead>
        <tbody>${wvRows}</tbody>
        <tfoot><tr style="border-top:2px solid var(--border)"><td><b>Total</b></td><td class="num"><b>${chf(r.total)}</b></td><td></td></tr></tfoot></table></div>
      ${r.fehlend.length ? `<p class="muted" style="font-size:11.5px;margin:8px 0 0">⚠ ${r.fehlend.length} Gewerk(e) ohne Bautermine – im Reiter „Termine" Start/Ende setzen, dann zählen sie mit.</p>` : ''}
    </div>
    <div class="card card-pad" style="max-width:840px;margin-top:16px">
      <h2 style="margin:0 0 10px;font-size:15px">Zahlungen Bauherr – pro Monat</h2>
      <div id="zpMonate">${zpMonateTabelleHtml(r.monate, z, p.id, 'Noch keine Bautermine gesetzt.')}</div>
    </div>`;
}
function zpHonorarHtml(p, z) {
  const c = zahlungsplanCalc(z);
  const flat = z.honMode === 'flat';
  const honT = p.honorar ? Math.round(computeHonorar(p.honorar).H) : 0;
  const offerte = Math.round(Number(finanzData(p).honorare) || 0);
  const lnk = (act, label) => `<button type="button" data-act="${act}" data-pid="${p.id}" style="background:none;border:none;color:var(--brand);cursor:pointer;padding:0;font-size:11px;text-decoration:underline">${label}</button>`;
  const quellen = [offerte ? lnk('zp-honofferte', `aus Schätzung/Offerte (${chf(offerte)})`) : '', honT ? lnk('zp-honorar', `aus Honorarrechner (${chf(honT)})`) : ''].filter(Boolean).join(' · ');
  const subToggle = `<div style="display:flex;gap:6px;margin-bottom:12px">
    <button class="btn xs ${flat ? 'secondary' : ''}" data-act="zp-honmode" data-pid="${p.id}" data-mode="phasen" type="button">nach SIA-Phasen</button>
    <button class="btn xs ${flat ? '' : 'secondary'}" data-act="zp-honmode" data-pid="${p.id}" data-mode="flat" type="button">gleichmässig über Laufzeit</button>
  </div>`;
  const kopf = `
      <div class="form-row">
        <label class="field">Honorar-Betrag (CHF)
          <input class="input zp-in" id="zp_betrag" type="number" value="${z.betrag}">
          <span class="muted" style="font-size:11px;font-weight:400;display:block;margin-top:3px">Unser Honorar${quellen ? ' · ' + quellen : ' · (bei der Schätzung abgeben oder im Honorarrechner berechnen)'}</span></label>
      </div>
      <div class="form-row" style="margin-top:6px">
        <label class="field">Zeitraum von <input class="input zp-in" id="zp_von" type="date" value="${esc(z.von || '')}"></label>
        <label class="field">bis <input class="input zp-in" id="zp_bis" type="date" value="${esc(z.bis || '')}"></label>
        <div style="display:flex;align-items:flex-end;gap:6px"><button class="btn secondary" data-act="zp-zeitraum" data-pid="${p.id}" type="button" title="von/bis aus dem Ausführungs-/Projektzeitraum übernehmen">↻ aus Ausführung</button>${flat ? '' : `<button class="btn secondary" data-act="zp-verteilen" data-pid="${p.id}" type="button">Phasen verteilen</button>`}</div>
      </div>`;
  let detail;
  if (flat) {
    const mo = zahlungsplanMonate(z);
    detail = `<div class="kpi-row" style="margin-top:14px">
        <div class="kpi"><div class="k-label">Honorar total</div><div class="k-value" style="font-size:20px">${chf(c.total)}</div></div>
        <div class="kpi"><div class="k-label">Laufzeit</div><div class="k-value" style="font-size:20px">${mo.ok ? mo.monate.length + ' Mt' : '–'}</div></div>
        <div class="kpi"><div class="k-label">pro Monat</div><div class="k-value" style="font-size:20px">${mo.ok ? chf(c.total / (mo.monate.length || 1)) : '–'}</div></div>
      </div>
      <p class="muted" style="font-size:11.5px;margin:12px 0 0">Das Honorar wird gleichmässig auf jeden Monat der Laufzeit (von–bis) verteilt – ohne Phasengewichtung.</p>`;
  } else {
    const rows = c.rows.map((r, i) => {
      const dauer = (r.beginn && r.ende) ? zpMonthsBetween(new Date(r.beginn), new Date(r.ende)).length : 0;
      return `<tr>
        <td>${esc(r.label)}</td>
        <td class="num"><input class="input zp-in" id="zp_pct_${i}" type="number" step="0.1" value="${r.pct}" style="width:64px;text-align:right;padding:4px 6px"></td>
        <td class="num" id="zp_b_${i}">${chf(r.betrag)}</td>
        <td><input class="input zp-in" id="zp_beg_${i}" type="date" value="${esc(r.beginn || '')}" style="width:140px;padding:4px 6px"></td>
        <td><input class="input zp-in" id="zp_end_${i}" type="date" value="${esc(r.ende || '')}" style="width:140px;padding:4px 6px"></td>
        <td class="num muted">${dauer ? dauer + ' Mt' : '–'}</td>
      </tr>`;
    }).join('');
    detail = `<table class="grid" style="margin-top:14px"><thead><tr><th>SIA-Phase</th><th class="num">Leistung %</th><th class="num">Betrag</th><th>Beginn</th><th>Ende (fällig)</th><th class="num">Dauer</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="border-top:2px solid var(--border)"><td><b>Total</b></td><td class="num"><b id="zp_pctsum" style="color:${Math.abs(c.pctSum - 100) < 0.05 ? 'var(--s-green)' : 'var(--s-red)'}">${Math.round(c.pctSum * 10) / 10}%</b></td><td class="num"><b id="zp_total">${chf(c.total)}</b></td><td colspan="3"></td></tr></tfoot>
      </table>
      <p class="muted" style="font-size:11.5px;margin:12px 0 0">Jede Phase hat <b>Beginn &amp; Ende</b> – sie dürfen sich <b>überschneiden</b> (z.B. Ausschreibung &amp; Ausführung parallel): einfach die Daten anpassen. „Phasen verteilen" legt sie sequenziell als Startpunkt; unten siehst du die Monatsrechnungen (Überschneidungen summieren sich).</p>`;
  }
  return `
    <div class="card card-pad" style="max-width:900px">
      ${subToggle}
      ${kopf}
      ${detail}
    </div>
    <div class="card card-pad" style="max-width:900px;margin-top:16px">
      <h2 style="margin:0 0 10px;font-size:15px">Monatsrechnungen</h2>
      <div id="zpMonate">${zahlungsplanMonateHtml(z, p.id)}</div>
    </div>`;
}
// Schweizer Rappenrundung: auf 0.05 runden (Beträge, die aus Verteilungen entstehen)
function rp5(x) { return Math.round((Number(x) || 0) * 20) / 20; }
function zahlungsplanCalc(z) {
  const betrag = Number(z.betrag) || 0;
  let cum = 0;
  const rows = z.phasen.map(ph => { const pct = Number(ph.pct) || 0; cum += pct; return { ...ph, pct, betrag: rp5(betrag * pct / 100), cum }; });
  const pctSum = rows.reduce((a, r) => a + r.pct, 0);
  return { rows, betrag, pctSum, total: rp5(betrag * pctSum / 100) };
}
function zahlungsplanRead(pid) {
  const p = findProjekt(pid); const z = zahlungsplanOf(p);
  const b = $('#zp_betrag'), v = $('#zp_von'), bis = $('#zp_bis');
  if (b) z.betrag = Number(b.value) || 0;
  if (v) z.von = v.value;
  if (bis) z.bis = bis.value;
  z.phasen.forEach((ph, i) => { const pe = $('#zp_pct_' + i), be = $('#zp_beg_' + i), ee = $('#zp_end_' + i); if (pe) ph.pct = Number(pe.value) || 0; if (be) ph.beginn = be.value; if (ee) ph.ende = ee.value; });
}
function zahlungsplanUpdate(pid) {
  const p = findProjekt(pid); zahlungsplanRead(pid); save();
  const z = zahlungsplanOf(p); const c = zahlungsplanCalc(z);
  c.rows.forEach((r, i) => { const el = $('#zp_b_' + i); if (el) el.textContent = chf(r.betrag); });
  const ts = $('#zp_total'); if (ts) ts.textContent = chf(c.total);
  const ps = $('#zp_pctsum'); if (ps) { ps.textContent = (Math.round(c.pctSum * 10) / 10) + '%'; ps.style.color = Math.abs(c.pctSum - 100) < 0.05 ? 'var(--s-green)' : 'var(--s-red)'; }
  const mc = $('#zpMonate'); if (mc) mc.innerHTML = zahlungsplanMonateHtml(z, pid);
}
// Jede SIA-Phase über ihre Monate verteilen (Phasenbeginn = Ende der Vorphase) → Monatsrechnungen aggregiert
const ZP_MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
function zpMonLabel(key) { const [y, m] = key.split('-'); return ZP_MONATE[Number(m) - 1] + ' ' + y; }
function zpMonthsBetween(s, e) {
  const months = []; let y = s.getFullYear(), m = s.getMonth(); const ey = e.getFullYear(), em = e.getMonth();
  while (y < ey || (y === ey && m <= em)) { months.push(y + '-' + String(m + 1).padStart(2, '0')); m++; if (m > 11) { m = 0; y++; } }
  return months;
}
function zahlungsplanMonate(z) {
  const c = zahlungsplanCalc(z);
  const map = new Map();
  let ok = false;
  if (z.honMode === 'flat') {
    const von = z.von ? new Date(z.von) : null, bis = z.bis ? new Date(z.bis) : null;
    if (von && bis && !isNaN(+von) && !isNaN(+bis) && +bis >= +von) {
      const months = zpMonthsBetween(von, bis); const per = c.total / (months.length || 1);
      months.forEach(mk => map.set(mk, (map.get(mk) || 0) + per)); ok = months.length > 0;
    }
  } else {
    // Je Phase über ihren EIGENEN Beginn..Ende verteilen – Überschneidungen summieren sich
    c.rows.forEach(r => {
      const s = r.beginn ? new Date(r.beginn) : null, e = r.ende ? new Date(r.ende) : null;
      if (!s || !e || isNaN(+s) || isNaN(+e) || +e < +s) return;
      const months = zpMonthsBetween(s, e); const per = r.betrag / (months.length || 1);
      months.forEach(mk => map.set(mk, (map.get(mk) || 0) + per)); ok = true;
    });
  }
  const sorted = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let cum = 0;
  return { ok, monate: sorted.map(([k, b]) => { const betrag = rp5(b); cum += betrag; return { key: k, betrag, cum }; }), total: cum };
}
// Manuelle Monats-Overrides auf eine Auto-Verteilung legen
function zpApplyOverrides(baseMonate, z) {
  const ov = z.overrides || {};
  let cum = 0;
  const monate = baseMonate.map(m => { const has = ov[m.key] !== undefined && ov[m.key] !== '' && ov[m.key] !== null; const betrag = has ? Number(ov[m.key]) : m.betrag; cum += betrag; return { key: m.key, betrag, auto: m.betrag, ueber: has, cum }; });
  return { monate, total: cum, hatOverrides: Object.keys(ov).length > 0 };
}
// Gemeinsame Monats-Tabelle (editierbar, ausser gesperrt) für Honorar- UND Bauherr-Modus
function zpMonateTabelleHtml(baseMonate, z, pid, hinweis) {
  if (!baseMonate || !baseMonate.length) return `<p class="muted" style="font-size:12.5px;margin:0">${hinweis || 'Noch keine Monatsrechnungen.'}</p>`;
  const r = zpApplyOverrides(baseMonate, z); const locked = z.gesperrt;
  const rows = r.monate.map(m => `<tr>
      <td>${zpMonLabel(m.key)}</td>
      <td class="num">${locked ? chf(m.betrag) : `<input class="input zp-mon" data-key="${m.key}" data-pid="${pid}" type="number" step="0.05" value="${m.betrag}" style="width:118px;text-align:right;padding:3px 6px${m.ueber ? ';border-color:var(--s-amber);font-weight:700' : ''}">`}</td>
      <td class="num muted">${chf(m.cum)}</td>
      <td>${m.ueber ? '<span class="st amber" style="font-size:9px;padding:1px 6px">manuell</span>' : ''}</td>
    </tr>`).join('');
  return `<table class="grid"><thead><tr><th>Monat</th><th class="num">Rechnung</th><th class="num">kumuliert</th><th></th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr style="border-top:2px solid var(--border)"><td><b>Total</b></td><td class="num"><b>${chf(r.total)}</b></td><td colspan="2"></td></tr></tfoot></table>
    <p class="muted" style="font-size:11.5px;margin:8px 0 0">${r.monate.length} Monatsrechnungen.${locked ? ' 🔒 gesperrt – zum Ändern entsperren.' : ' Beträge einzeln überschreibbar.'}${r.hatOverrides && !locked ? ` <button type="button" data-act="zp-mon-reset" data-pid="${pid}" style="background:none;border:none;color:var(--brand);cursor:pointer;text-decoration:underline;font-size:11px">↺ alle auf Auto</button>` : ''}</p>`;
}
function zahlungsplanMonateHtml(z, pid) {
  const base = zahlungsplanMonate(z);
  if (!base.ok || !base.monate.length) return `<p class="muted" style="font-size:12.5px;margin:0">${z.honMode === 'flat' ? 'Zeitraum (von/bis) setzen – dann wird das Honorar gleichmässig über die Laufzeit verteilt.' : 'Zuerst Zeitraum setzen und „Phasen verteilen" klicken (oder Beginn/Ende je Phase eintragen) – dann erscheinen hier die Monatsrechnungen.'}</p>`;
  return zpMonateTabelleHtml(base.monate, z, pid);
}
function zahlungsplanVerteilen(pid) {
  const p = findProjekt(pid); zahlungsplanRead(pid); const z = zahlungsplanOf(p);
  const von = z.von ? new Date(z.von) : null, bis = z.bis ? new Date(z.bis) : null;
  if (!von || !bis || isNaN(+von) || isNaN(+bis) || +bis <= +von) { toast('Bitte gültigen Zeitraum (von / bis) eingeben', 'info'); return; }
  const span = +bis - +von; const tot = z.phasen.reduce((a, ph) => a + (Number(ph.pct) || 0), 0) || 100;
  let cum = 0;
  z.phasen.forEach(ph => {
    const begFrac = cum / tot; cum += Number(ph.pct) || 0; const endFrac = cum / tot;
    ph.beginn = new Date(+von + span * begFrac).toISOString().slice(0, 10);
    ph.ende = new Date(+von + span * endFrac).toISOString().slice(0, 10);
  });
  save(); viewZahlungsplan(pid); toast('Phasen sequenziell verteilt – Beginn/Ende für Überschneidungen anpassbar');
}
function viewZahlungsplan(pid) {
  const p = findProjekt(pid); if (!p) { render(emptyState('⚠', 'Projekt nicht gefunden.')); return; }
  const z = zahlungsplanOf(p); const modus = z.modus || 'bauherr';
  const list = zahlungsplaeneOf(p);
  const sub = modus === 'bauherr' ? 'Bauherr – Fälligkeiten aus Werkverträgen + Unternehmer-Terminen' : 'Unser Honorar – SIA-Leistungsprozente, Betrag aus Honorarrechner/Baukosten';
  const versionsBar = `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
      ${list.map(v => `<button class="btn xs ${v.id === p.zpAktiv ? '' : 'secondary'}" data-act="zp-version" data-pid="${p.id}" data-vid="${v.id}" type="button">${esc(v.name || 'Version')}${v.gesperrt ? ' 🔒' : ''}</button>`).join('')}
      <button class="btn xs secondary" data-act="zp-version-neu" data-pid="${p.id}" type="button">+ Neue Version</button>
      <span style="flex:1"></span>
      <button class="btn xs secondary" data-act="zp-rename" data-pid="${p.id}" type="button" title="Version umbenennen">✎</button>
      <button class="btn xs ${z.gesperrt ? '' : 'secondary'}" data-act="zp-lock" data-pid="${p.id}" type="button">${z.gesperrt ? '🔒 gesperrt – entsperren' : '🔓 abschliessen / sperren'}</button>
    </div>`;
  const lockBanner = z.gesperrt ? `<div class="demo-bar" style="background:#eef4ff;border-color:#bcd2f5;color:#1d3a6b">🔒 <b>Abgeschlossen &amp; gesperrt</b> – diese Version ist fix (z.B. vom Bauherrn unterschrieben). Zum Ändern oben „entsperren" oder „+ Neue Version" als Revision anlegen.</div>` : '';
  const head = `
    <div class="breadcrumb"><a href="#/projekte">Projekte</a> › <a href="#/projekt/${p.id}">${esc(p.name)}</a> › Zahlungsplan</div>
    <div class="detail-head">
      <div><h1 style="margin:0;font-size:23px">Zahlungsplan</h1><div class="sub" style="margin-top:5px">${sub}</div></div>
      <div><button class="btn" data-act="pdf-zahlungsplan" data-pid="${p.id}">⬇ PDF</button></div>
    </div>
    ${projektTabs(p, 'zahlungsplan')}
    ${demoBanner('zahlungsplan')}
    ${versionsBar}
    ${lockBanner}
    <div style="display:flex;gap:6px;margin-bottom:14px">
      <button class="btn xs ${modus === 'bauherr' ? '' : 'secondary'}" data-act="zp-modus" data-pid="${p.id}" data-modus="bauherr" type="button">Bauherr (Werkverträge)</button>
      <button class="btn xs ${modus === 'honorar' ? '' : 'secondary'}" data-act="zp-modus" data-pid="${p.id}" data-modus="honorar" type="button">Unser Honorar (SIA)</button>
    </div>`;
  render(head + (modus === 'bauherr' ? zpBauherrHtml(p) : zpHonorarHtml(p, z)));
  if (modus === 'honorar' && !z.gesperrt) $$('.zp-in').forEach(el => el.addEventListener('input', () => zahlungsplanUpdate(pid)));
  if (z.gesperrt) {
    $$('.zp-in').forEach(el => el.disabled = true);
    $$('[data-act^="zp-"]').forEach(b => { if (!['zp-version', 'zp-version-neu', 'zp-lock', 'zp-rename'].includes(b.dataset.act)) b.disabled = true; });
  }
}
function pdfZahlungsplan(pid) {
  const p = findProjekt(pid); if (!p) return;
  const z = zahlungsplanOf(p); const modus = z.modus || 'bauherr';
  let inner, title;
  if (modus === 'bauherr') {
    title = 'Zahlungsplan Bauherr';
    const r = bauherrPlan(p);
    const wvRows = r.rows.map(x => `<tr><td>${esc(x.v.bkp || '')} ${esc(x.v.gewerk)}<br><span class="muted">${esc(x.v.firma || '')}</span></td><td class="num">${money(x.betrag)}</td><td>${x.ohneTermin ? 'Termine fehlen' : fmtDate(x.von) + ' – ' + fmtDate(x.bis)}</td></tr>`).join('');
    inner = `<div class="gw">Werkverträge (Grundlage)</div>
      <table class="t"><thead><tr><th>Gewerk / Firma</th><th class="num">Summe (WV + gen. NT)</th><th>Bauzeitraum</th></tr></thead>
        <tbody>${wvRows || '<tr><td colspan="3" class="muted">Keine vergebenen Werkverträge</td></tr>'}</tbody>
        <tfoot><tr><td><b>Total</b></td><td class="num"><b>${money(r.total)}</b></td><td></td></tr></tfoot></table>
      ${r.monate.length ? `<div class="gw">Zahlungen Bauherr – pro Monat</div>
      <table class="t"><thead><tr><th>Monat</th><th class="num">fällig</th><th class="num">kumuliert</th></tr></thead>
        <tbody>${r.monate.map(m => `<tr><td>${zpMonLabel(m.key)}</td><td class="num">${money(m.betrag)}</td><td class="num muted">${money(m.cum)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td><b>Total</b></td><td class="num"><b>${money(r.total)}</b></td><td></td></tr></tfoot></table>` : ''}`;
  } else {
    const flat = z.honMode === 'flat';
    title = 'Zahlungsplan Honorar';
    const c = zahlungsplanCalc(z); const mo = zahlungsplanMonate(z);
    const phaseRows = c.rows.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${r.pct}%</td><td class="num">${money(r.betrag)}</td><td>${r.beginn ? fmtDate(r.beginn) : '–'}</td><td>${r.ende ? fmtDate(r.ende) : '–'}</td></tr>`).join('');
    inner = `
      <table class="t" style="max-width:480px"><tbody>
        <tr><td>Honorar-Betrag</td><td class="num"><b>${money(z.betrag)}</b></td></tr>
        <tr><td>Zeitraum</td><td class="num">${z.von ? fmtDate(z.von) : '–'} – ${z.bis ? fmtDate(z.bis) : '–'}</td></tr>
        <tr><td>Modus</td><td class="num">${flat ? 'gleichmässig über Laufzeit' : 'nach SIA-Phasen'}</td></tr>
      </tbody></table>
      ${flat ? '' : `<div class="gw">Verteilung nach SIA-Leistungsprozenten</div>
      <table class="t"><thead><tr><th>SIA-Phase</th><th class="num">Leistung %</th><th class="num">Betrag</th><th>Beginn</th><th>Ende (fällig)</th></tr></thead>
        <tbody>${phaseRows}</tbody>
        <tfoot><tr><td><b>Total</b></td><td class="num"><b>${Math.round(c.pctSum * 10) / 10}%</b></td><td class="num"><b>${money(c.total)}</b></td><td colspan="2"></td></tr></tfoot></table>`}
      ${mo.ok ? `<div class="gw">Monatsrechnungen</div>
      <table class="t"><thead><tr><th>Monat</th><th class="num">Rechnung</th><th class="num">kumuliert</th></tr></thead>
        <tbody>${mo.monate.map(m => `<tr><td>${zpMonLabel(m.key)}</td><td class="num">${money(m.betrag)}</td><td class="num muted">${money(m.cum)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td><b>Total</b></td><td class="num"><b>${money(mo.total)}</b></td><td></td></tr></tfoot></table>` : ''}`;
  }
  openPrintDoc(title, `${esc(p.name)}${p.ort ? ' · ' + esc(p.ort) : ''}`, inner);
}
function pdfRechnungskontrolle(pid) {
  const p = findProjekt(pid); if (!p) return;
  const gw = gewerkeSorted(p).filter(v => isVergeben(v) || (v.rechnungen || []).length);
  let tSoll = 0, tFak = 0, tBez = 0, tPlatz = 0;
  const rows = gw.map(v => {
    const z = kostenZeile(v); const platz = z.prognose - z.fakturiert; const over = z.fakturiert > z.prognose + 0.5;
    tSoll += z.prognose; tFak += z.fakturiert; tBez += z.bezahlt; tPlatz += platz;
    return `<tr><td>${esc(v.bkp || '')}</td><td>${esc(v.gewerk)}<br><span class="muted">${esc(v.firma || '')}</span></td><td class="num">${money(z.prognose)}</td><td class="num">${money(z.fakturiert)}</td><td class="num">${money(z.bezahlt)}</td><td class="num"${over ? ' style="color:#a01b2b;font-weight:700"' : ''}>${money(platz)}</td></tr>`;
  }).join('');
  const inner = `<table class="t"><thead><tr><th>BKP</th><th>Gewerk / Firma</th><th class="num">Vergabe (Soll)</th><th class="num">Verrechnet</th><th class="num">Bezahlt</th><th class="num">Platz</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="muted">Keine Daten</td></tr>'}</tbody>
    <tfoot><tr><td colspan="2"><b>Total</b></td><td class="num"><b>${money(tSoll)}</b></td><td class="num"><b>${money(tFak)}</b></td><td class="num"><b>${money(tBez)}</b></td><td class="num"><b>${money(tPlatz)}</b></td></tr></tfoot></table>
    <p class="muted" style="font-size:10.5px;margin-top:8px">Platz = Vergabe-Soll (WV + genehmigte Nachträge) − bereits verrechnet. Rot = Überschreitung (keine Platz mehr).</p>`;
  openPrintDoc('Rechnungskontrolle', `${esc(p.name)} · Stand ${fmtDate(todayIso())}`, inner);
}

function pdfKostenschaetzung(pid) {
  const p = findProjekt(pid); if (!p) return;
  const gw = gewerkeSorted(p); let tot = 0;
  const rows = gw.length ? gw.map(v => {
    const kv = v.schaetzung || 0; tot += kv;
    const pos = v.ksPositionen || [];
    let r = `<tr><td>${esc(v.bkp || '')}</td><td><b>${esc(v.gewerk || '')}</b>${v.beschrieb ? '<br><span style="color:#555">' + esc(v.beschrieb) + '</span>' : ''}</td><td class="num">${pos.length ? '' : chf(kv)}</td></tr>`;
    pos.forEach(po => r += `<tr><td></td><td style="padding-left:20px;color:#333">${esc(po.text || 'Position')}</td><td class="num">${chf(po.betrag)}</td></tr>`);
    if (pos.length) r += `<tr><td></td><td style="text-align:right;color:#777;font-size:10.5px">Zwischensumme ${esc(v.gewerk || '')}</td><td class="num"><b>${chf(kv)}</b></td></tr>`;
    return r;
  }).join('') : '<tr><td colspan="3" class="muted">Keine Positionen erfasst.</td></tr>';
  const inner = `<table class="t"><thead><tr><th style="width:70px">BKP</th><th>Beschrieb / Arbeitsgattung</th><th class="num" style="width:150px">Kosten</th></tr></thead>
    <tbody>${rows}<tr><td></td><td><b>Gesamtkosten (Kostenschätzung)</b></td><td class="num"><b>${chf(tot)}</b></td></tr></tbody></table>
    <p class="muted" style="margin-top:12px;font-size:10.5px">Kostenschätzung – Genauigkeit gemäss Projektstand (Richtwert ± 15–25 %). Alle Beträge exkl. MwSt, sofern nicht anders vermerkt.</p>`;
  openPrintDoc('Kostenschätzung', `${esc(p.name)} · ${esc(p.ort)} · Bauherr: ${esc(p.bauherr)} · Stand ${fmtDate(todayIso())}`, inner);
}

function actPdfBaukosten(pid) {
  openModal('Baukostenübersicht drucken', `
    <p class="muted" style="font-size:13px;margin-top:0">Welche Variante?</p>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn secondary" data-act="pdf-baukosten-mode" data-pid="${pid}" data-mode="einfach" type="button" style="justify-content:flex-start;text-align:left;height:auto;padding:11px 13px;white-space:normal"><b>Einfach</b> – eine Zeile je Gewerk · Zwischentotale · Zusammenzug · Übertrag je Seite</button>
      <button class="btn secondary" data-act="pdf-baukosten-mode" data-pid="${pid}" data-mode="detail" type="button" style="justify-content:flex-start;text-align:left;height:auto;padding:11px 13px;white-space:normal"><b>Detailliert</b> – zusätzlich Nachträge, Rechnungen (mit Datum) und Teilprojekt je Gewerk · Zusammenzug</button>
    </div>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button>`);
}
function pdfBaukosten(pid, mode) {
  mode = mode || 'einfach';
  const p = findProjekt(pid); if (!p) return;
  const detail = mode === 'detail';
  const hatBt = (p.bauteile || []).length;
  const cols = ['kv', 'rev', 'wv', 'nt', 'prognose', 'bezahlt', 'offen'];
  const THEAD = `<tr><th>BKP</th><th>Arbeitsgattung</th><th class="num">KV</th><th class="num">KV rev.</th><th class="num">WV</th><th class="num">NT</th><th class="num">Prognose</th><th class="num">Bezahlt</th><th class="num">Offen</th></tr>`;
  const vs = gewerkeSorted(p);
  const groups = {}; vs.forEach(v => { const g = String(v.bkp || '0').trim()[0] || '0'; (groups[g] = groups[g] || []).push(v); });
  const keys = Object.keys(groups).sort();
  const tot = {}; cols.forEach(c => tot[c] = 0);
  const gtot = {};
  const lines = []; let detailBody = '';
  keys.forEach(g => {
    const sub = {}; cols.forEach(c => sub[c] = 0);
    const ghead = `<tr style="background:#f4f6f9"><td><b>${esc(g)}</b></td><td colspan="8"><b>${esc(BKP_GRUPPEN[g] || 'Übrige')}</b></td></tr>`;
    lines.push({ html: ghead }); if (detail) detailBody += ghead;
    groups[g].forEach(v => {
      const z = kostenZeile(v);
      const vals = { kv: z.kv, rev: z.rev || 0, wv: z.vergeben ? z.wv : 0, nt: z.nt, prognose: z.prognose, bezahlt: z.bezahlt, offen: z.offen };
      cols.forEach(c => { sub[c] += vals[c]; tot[c] += vals[c]; });
      const rowHtml = `<tr><td>${esc(v.bkp || '')}</td><td>${esc(v.gewerk || '')}${hatBt && v.bauteil ? ` <span style="color:#9aa4b1;font-size:9px">[${esc(bauteilName(p, v.bauteil))}]</span>` : ''}</td><td class="num">${chf(z.kv)}</td><td class="num">${z.rev != null ? chf(z.rev) : '–'}</td><td class="num">${z.vergeben ? chf(z.wv) : '–'}</td><td class="num">${chf(z.nt)}</td><td class="num">${chf(z.prognose)}</td><td class="num">${chf(z.bezahlt)}</td><td class="num">${chf(z.offen)}</td></tr>`;
      lines.push({ html: rowHtml, vals });
      if (detail) {
        detailBody += rowHtml;
        (v.nachtraege || []).forEach(n => { detailBody += `<tr><td></td><td colspan="5" style="color:#6b7480;font-size:10px">↳ Nachtrag${n.nr ? ' ' + esc(n.nr) : ''}: ${esc(n.titel || '')} (${esc(n.status || 'offen')})${hatBt && n.bauteil ? ' [' + esc(bauteilName(p, n.bauteil)) + ']' : ''}</td><td class="num" style="font-size:10px">${chf(n.betrag)}</td><td colspan="3"></td></tr>`; });
        (v.rechnungen || []).slice().sort((a, b) => (a.datum || '').localeCompare(b.datum || '')).forEach(r => { detailBody += `<tr><td></td><td colspan="6" style="color:#6b7480;font-size:10px">↳ ${r.datum ? fmtDate(r.datum) : '—'} · ${esc(r.text || 'Rechnung')}${r.nr ? ' ' + esc(r.nr) : ''}${hatBt ? ' [' + esc(bauteilName(p, r.bauteil !== undefined ? r.bauteil : v.bauteil)) + ']' : ''}${r.bezahlt ? ' · bezahlt' : ' · offen'} · ${chf(rgSigned(r))}</td><td class="num" style="font-size:10px">${r.bezahlt ? chf(rgAuszahlung(r)) : '–'}</td><td colspan="2"></td></tr>`; });
      }
    });
    gtot[g] = sub;
    const subHtml = `<tr style="background:#eef1f5"><td></td><td><b>Zwischentotal ${esc(BKP_GRUPPEN[g] || g)}</b></td>${cols.map(c => `<td class="num">${c === 'prognose' ? '<b>' + chf(sub[c]) + '</b>' : chf(sub[c])}</td>`).join('')}</tr>`;
    lines.push({ html: subHtml }); if (detail) detailBody += subHtml;
  });
  const totalRow = `<tr style="border-top:2px solid #7c1d2c"><td></td><td><b>Total Baukosten</b></td>${cols.map(c => `<td class="num"><b>${chf(tot[c])}</b></td>`).join('')}</tr>`;
  const zRows = keys.map(g => `<tr><td>BKP ${esc(g)} – ${esc(BKP_GRUPPEN[g] || 'Übrige')}</td><td class="num">${chf(gtot[g].kv)}</td><td class="num">${chf(gtot[g].prognose)}</td><td class="num">${chf(gtot[g].bezahlt)}</td></tr>`).join('');
  const zusammenzug = `<div class="gw" style="margin-top:18px">Zusammenzug nach Hauptgruppe (BKP)</div>
    <table class="t"><thead><tr><th>Hauptgruppe</th><th class="num">Kostenschätzung</th><th class="num">Prognose</th><th class="num">Bezahlt</th></tr></thead>
      <tbody>${zRows}<tr style="border-top:2px solid #7c1d2c"><td><b>Total</b></td><td class="num"><b>${chf(tot.kv)}</b></td><td class="num"><b>${chf(tot.prognose)}</b></td><td class="num"><b>${chf(tot.bezahlt)}</b></td></tr></tbody></table>`;
  const hinweis = `<p class="muted" style="margin-top:10px;font-size:9.5px">KV = Kostenschätzung · KV rev. = günstigste Offerte · WV = Werkvertrag · NT = Nachträge · Prognose = WV + NT + Rapporte.${detail ? ' ↳ = Nachträge &amp; Rechnungen (mit Datum) je Gewerk.' : ' „Übertrag" = laufende Summe je Seite.'}</p>`;
  let inner;
  if (detail) {
    inner = `<table class="t" style="font-size:11px"><thead>${THEAD}</thead><tbody>${detailBody}${totalRow}</tbody></table>${zusammenzug}${hinweis}`;
  } else {
    const perPage = 26; const carry = {}; cols.forEach(c => carry[c] = 0); let count = 0, page = 1;
    const ueRow = label => `<tr style="background:#f3eedd;color:#6b5a2a"><td></td><td><i>${label}</i></td>${cols.map(c => `<td class="num"><i>${chf(carry[c])}</i></td>`).join('')}</tr>`;
    let out = `<table class="t" style="font-size:11px"><thead>${THEAD}</thead><tbody>`;
    lines.forEach(ln => {
      if (count >= perPage) {
        out += ueRow('Übertrag') + `</tbody></table><div style="page-break-after:always"></div><table class="t" style="font-size:11px"><thead>${THEAD}</thead><tbody>`;
        page++; count = 0; out += ueRow('Übertrag von Seite ' + (page - 1));
      }
      out += ln.html; if (ln.vals) cols.forEach(c => carry[c] += ln.vals[c] || 0); count++;
    });
    out += totalRow + `</tbody></table>`;
    inner = out + zusammenzug + hinweis;
  }
  openPrintDoc('Baukostenübersicht' + (detail ? ' – detailliert' : ''), `${esc(p.name)} · ${esc(p.ort)} · Bauherr: ${esc(p.bauherr)} · Stand ${fmtDate(todayIso())}`, inner, { landscape: true });
}

// Bauprogramm / Gantt als saubere Monats-Tabelle (Querformat)
const MON_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
// Bestell-/Vorlaufliste: was muss wann bestellt werden (aus den Bestellfristen je Gewerk)
function bestellListeHtml(p) {
  const items = gewerkeSorted(p).filter(v => v.bauStart && Number(v.bestellfrist) > 0).map(v => {
    const d = dISO(v.bauStart); d.setDate(d.getDate() - Number(v.bestellfrist)); return { v, bis: isoOf(d) };
  }).sort((a, b) => a.bis.localeCompare(b.bis));
  if (!items.length) return '';
  const t0 = todayIso();
  const rows = items.map(({ v, bis }) => {
    const ueber = bis < t0;
    const tageBis = Math.round((dISO(bis) - today()) / 86400000);
    const stat = ueber ? '<span class="st amber">überfällig</span>' : (tageBis <= 21 ? `<span class="st blue">in ${tageBis} T</span>` : '<span class="st green">ok</span>');
    return `<tr><td><span class="bkp-code">${esc(v.bkp || '')}</span> ${esc(v.gewerk)}<div class="muted" style="font-size:11px">${esc(v.firma || '—')}</div></td>
      <td><strong>${fmtDate(bis)}</strong></td>
      <td class="muted">${v.bestellfrist} T vor Einbau</td>
      <td class="muted">${fmtDate(v.bauStart)}</td>
      <td>${stat}</td></tr>`;
  }).join('');
  return `<div class="section-head" style="margin-top:22px"><h2>🛒 Bestellfristen / Vorlauf</h2><span class="hint">Was muss wann bestellt werden, damit der Einbau pünktlich startet</span></div>
    <div class="card" style="overflow-x:auto"><table class="grid"><thead><tr><th>Gewerk / Firma</th><th>bestellen bis</th><th>Vorlauf</th><th>Einbau ab</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function pdfGantt(pid) {
  const p = findProjekt(pid); if (!p) return;
  const vs = gewerkeSorted(p).filter(v => v.bauStart && v.bauEnde);
  if (!vs.length) { toast('Keine terminierten Gewerke vorhanden', 'info'); return; }
  let min = null, max = null;
  vs.forEach(v => { if (!min || v.bauStart < min) min = v.bauStart; if (!max || v.bauEnde > max) max = v.bauEnde; if (Number(v.bestellfrist) > 0) { const d = dISO(v.bauStart); d.setDate(d.getDate() - Number(v.bestellfrist)); const b = isoOf(d); if (b < min) min = b; } });
  const ds = dISO(min), de = dISO(max);
  const rangeStart = new Date(ds.getFullYear(), ds.getMonth(), 1);
  const rangeEnd = new Date(de.getFullYear(), de.getMonth() + 1, 0);
  const totalDays = dayDiff(rangeStart, rangeEnd) + 1;
  const pct = iso => dayDiff(rangeStart, dISO(iso)) / totalDays * 100;
  const wpct = (s, e) => (dayDiff(dISO(s), dISO(e)) + 1) / totalDays * 100;
  const subOn = ganttZoom !== 'monat';
  const n = vs.length;
  // Geometrie in mm – passt immer auf EINE A4-Querseite (Breite = %, Höhe gerechnet)
  const SIDE_MM = 55, HEAD_MM = subOn ? 11 : 7;
  const rowH = Math.max(3, Math.min(6.6, (152 - HEAD_MM) / n));
  const barH = Math.max(2, rowH - 1.4);
  const fs = rowH < 4 ? 6 : rowH < 5.2 ? 7 : 8;

  // Monats-Band + Gridlines
  const months = []; let cur = new Date(rangeStart);
  while (cur <= rangeEnd) { const mEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0); const se = mEnd > rangeEnd ? rangeEnd : mEnd; const iso = isoOf(cur); months.push({ l: pct(iso), w: wpct(iso, isoOf(se)), label: MON_KURZ[cur.getMonth()] + ' ' + String(cur.getFullYear()).slice(2) }); cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); }
  let gridV = months.map(m => `<div class="pg-grid mo" style="left:${m.l}%"></div>`).join('');
  const moBand = months.map(m => `<div class="pg-mo" style="left:${m.l}%;width:${m.w}%">${m.label}</div>`).join('');

  // Sub-Band (KW oder Tag) + feinere Gridlines
  let subBand = '', weBands = '';
  if (ganttZoom === 'woche') {
    let d = new Date(rangeStart); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    while (d <= rangeEnd) {
      const iso = isoOf(d < rangeStart ? rangeStart : d); const l = Math.max(0, pct(isoOf(d)));
      const wEnd = new Date(d); wEnd.setDate(d.getDate() + 6); const se = wEnd > rangeEnd ? rangeEnd : wEnd;
      const r = Math.min(100, pct(isoOf(se)) + 100 / totalDays);
      gridV += `<div class="pg-grid wk" style="left:${l}%"></div>`;
      subBand += `<div class="pg-sub" style="left:${l}%;width:${Math.max(0, r - l)}%">${isoWeek(d)}</div>`;
      d.setDate(d.getDate() + 7);
    }
  } else if (ganttZoom === 'tag') {
    // Adaptiv: Tagsspalten-Breite (mm) bestimmt die Detailtiefe, damit nichts „verklebt"
    const dayMm = (281 - SIDE_MM) / totalDays;
    // Immer nur WOCHEN-Gitterlinien (Montag) – per-Tag-Linien wären bei langem Zeitraum eine graue Wand
    let wk = new Date(rangeStart); wk.setDate(wk.getDate() - ((wk.getDay() + 6) % 7));
    while (wk <= rangeEnd) { gridV += `<div class="pg-grid wk" style="left:${Math.max(0, pct(isoOf(wk)))}%"></div>`; wk.setDate(wk.getDate() + 7); }
    // Feine Tageslinien nur, wenn Spalten breit genug
    if (dayMm >= 4) { let d = new Date(rangeStart); while (d <= rangeEnd) { gridV += `<div class="pg-grid day" style="left:${pct(isoOf(d))}%"></div>`; d.setDate(d.getDate() + 1); } }
    // Wochenend-Bänder nur, wenn sie als Block sichtbar (sonst zu fein)
    if (dayMm >= 1.0) { let d = new Date(rangeStart); while (d <= rangeEnd) { if (d.getDay() === 0 || d.getDay() === 6) weBands += `<div class="pg-we" style="left:${pct(isoOf(d))}%;width:${100 / totalDays}%"></div>`; d.setDate(d.getDate() + 1); } }
    // Sub-Band: Tageszahlen nur bei genügend Breite, sonst KW
    if (dayMm >= 3) {
      let d = new Date(rangeStart);
      while (d <= rangeEnd) { const we = d.getDay() === 0 || d.getDay() === 6; subBand += `<div class="pg-sub${we ? ' we' : ''}" style="left:${pct(isoOf(d))}%;width:${100 / totalDays}%">${d.getDate()}</div>`; d.setDate(d.getDate() + 1); }
    } else {
      let w = new Date(rangeStart); w.setDate(w.getDate() - ((w.getDay() + 6) % 7));
      while (w <= rangeEnd) { const l = Math.max(0, pct(isoOf(w))); const we2 = new Date(w); we2.setDate(w.getDate() + 6); const se = we2 > rangeEnd ? rangeEnd : we2; const r = Math.min(100, pct(isoOf(se)) + 100 / totalDays); subBand += `<div class="pg-sub" style="left:${l}%;width:${Math.max(0, r - l)}%">${isoWeek(w)}</div>`; w.setDate(w.getDate() + 7); }
    }
  }

  const t = today();
  const todayLine = (t >= rangeStart && t <= rangeEnd) ? `<div class="pg-today" style="left:${pct(todayIso())}%"></div>` : '';
  // Feiertage: Bänder (hinter Balken) + Labels (über Balken)
  const hols = feiertageInRange(rangeStart, rangeEnd);
  const holBands = hols.map(f => `<div class="pg-hol" style="left:${pct(isoOf(f.d))}%;width:${Math.max(100 / totalDays, 0.1)}%"></div>`).join('');
  const holMinGap = 1.6 / (281 - SIDE_MM) * 100;   // ~Labelbreite in %, gegen Überlappung
  let lastHolX = -Infinity;
  const holLabels = hols.map(f => { const x = pct(isoOf(f.d)); if (x - lastHolX < holMinGap) return ''; lastHolX = x; return `<div class="pg-hol-lbl" style="left:${x}%"><span>${esc(f.n)}</span></div>`; }).join('');
  // Projekt-Meilensteine (Baustart / Bezug)
  const pMarks = [];
  if (p.baustart) pMarks.push({ iso: p.baustart, n: 'Baustart', c: '#16a34a' });
  if (p.bezug) pMarks.push({ iso: p.bezug, n: 'Bezug', c: '#1f6feb' });
  const markLines = pMarks.filter(m => { const d = dISO(m.iso); return d >= rangeStart && d <= rangeEnd; }).map(m =>
    `<div class="pg-mark" style="left:${pct(m.iso)}%;background:${m.c}"></div><div class="pg-mark-lbl" style="left:${pct(m.iso)}%"><span style="color:${m.c}">${esc(m.n)} ${fmtDate(m.iso)}</span></div>`).join('');
  const sideHtml = vs.map(v => `<div class="pg-srow" style="height:${rowH}mm"><b>${esc(v.bkp || '')}</b>&nbsp;${esc(v.gewerk || '')}</div>`).join('');
  const rowsHtml = vs.map(v => {
    let bestell = '';
    if (Number(v.bestellfrist) > 0) { const d = dISO(v.bauStart); d.setDate(d.getDate() - Number(v.bestellfrist)); const bs = isoOf(d); bestell = `<div class="pg-bestell" style="left:${Math.max(0, pct(bs))}%;width:${wpct(bs, v.bauStart)}%;height:${barH}mm"></div>`; }
    return `<div class="pg-row" style="height:${rowH}mm">${bestell}<div class="pg-bar" style="left:${pct(v.bauStart)}%;width:${wpct(v.bauStart, v.bauEnde)}%;height:${barH}mm;background:${ganttColHex(v)}"></div></div>`;
  }).join('');
  const legend = GANTT_LEGEND.map(([k, l]) => `<span style="display:inline-block;margin-right:10px"><span style="display:inline-block;width:11px;height:8px;border-radius:2px;background:${GANTT_COLS[k]};vertical-align:middle;margin-right:3px"></span>${l}</span>`).join('');

  const css = `@page{size:A4 landscape;margin:8mm;}
    .lh{padding-bottom:5px;} h1{font-size:14px;margin:5px 0 0;} h1::after{display:none;} .sub{margin:2px 0 6px;font-size:9.5px;} .ft{display:none;}
    .pg{display:flex;border:1px solid #c9d2de;width:100%;box-sizing:border-box;}
    .pg-side{flex:none;width:${SIDE_MM}mm;border-right:1px solid #c9d2de;box-sizing:border-box;}
    .pg-shead{height:${HEAD_MM}mm;display:flex;align-items:flex-end;padding:0 1.5mm 0.5mm;font-weight:700;font-size:8px;border-bottom:1px solid #c9d2de;box-sizing:border-box;}
    .pg-srow{display:flex;align-items:center;padding:0 1.5mm;font-size:${fs}px;border-bottom:1px solid #eef1f5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box;}
    .pg-main{flex:1;position:relative;min-width:0;}
    .pg-head{position:relative;height:${HEAD_MM}mm;border-bottom:1px solid #c9d2de;box-sizing:border-box;}
    .pg-mo{position:absolute;top:0;height:${subOn ? '50%' : '100%'};text-align:center;font-size:8px;font-weight:700;border-left:1px solid #d8dee8;color:#46505e;overflow:hidden;white-space:nowrap;}
    .pg-sub{position:absolute;bottom:0;height:50%;text-align:center;font-size:6.5px;color:#6b7480;border-left:1px solid #eef1f5;overflow:hidden;white-space:nowrap;line-height:1;padding-top:.4mm;box-sizing:border-box;}
    .pg-rows{position:relative;}
    .pg-row{position:relative;border-bottom:1px solid #f2f4f8;box-sizing:border-box;}
    .pg-grid{position:absolute;top:0;bottom:0;width:1px;background:#eef1f5;}
    .pg-grid.mo{background:#cfd7e3;} .pg-grid.wk{background:#e3e8ef;} .pg-grid.day{background:#f1f4f8;}
    .pg-we{position:absolute;top:0;bottom:0;background:#eaf0f7;}
    .pg-sub.we{background:#e7edf5;color:#9aa4b1;}
    .pg-today{position:absolute;top:0;bottom:0;width:1.2px;background:#dc2626;z-index:2;}
    .pg-hol{position:absolute;top:0;bottom:0;background:rgba(220,38,38,.08);border-left:.5px solid rgba(220,38,38,.5);}
    .pg-hol-lbl{position:absolute;top:0;bottom:0;z-index:3;}
    .pg-hol-lbl span{position:absolute;top:.3mm;left:.3px;font-size:5px;line-height:1;color:#b91c1c;font-weight:600;writing-mode:vertical-rl;text-orientation:mixed;white-space:nowrap;}
    .pg-mark{position:absolute;top:0;bottom:0;width:1.1px;z-index:2;}
    .pg-mark-lbl{position:absolute;top:0;bottom:0;z-index:4;}
    .pg-mark-lbl span{position:absolute;top:.3mm;left:.3px;font-size:5.5px;line-height:1;font-weight:700;writing-mode:vertical-rl;text-orientation:mixed;white-space:nowrap;}
    .pg-bar{position:absolute;top:50%;transform:translateY(-50%);border-radius:2px;box-shadow:0 0 0 .3px rgba(0,0,0,.06);}
    .pg-bestell{position:absolute;top:50%;transform:translateY(-50%);border-radius:2px;background:repeating-linear-gradient(45deg,rgba(120,140,170,.18),rgba(120,140,170,.18) 3px,rgba(120,140,170,.32) 3px,rgba(120,140,170,.32) 6px);border:.4px dashed rgba(110,130,160,.6);}`;
  const inner = `<div class="pg">
    <div class="pg-side"><div class="pg-shead">BKP / Gewerk</div>${sideHtml}</div>
    <div class="pg-main"><div class="pg-head">${moBand}${subBand}</div><div class="pg-rows">${weBands}${holBands}${gridV}${todayLine}${markLines}${rowsHtml}${holLabels}</div></div>
  </div>
  <div style="margin-top:3mm;font-size:8px;color:#6b7480">${legend}</div>`;
  const rasterTxt = ganttZoom === 'tag' ? 'Tage' : ganttZoom === 'woche' ? 'Wochen' : 'Monate';
  openPrintDoc('Bauprogramm / Terminprogramm', `${esc(p.name)} · ${esc(p.ort)} · ${fmtDate(min)} – ${fmtDate(max)} · Raster ${rasterTxt}`, inner, { landscape: true, extraCss: css });
}

function advanceVergabe(pid, vid) {
  const p = findProjekt(pid);
  const v = p && findVergabe(p, vid);
  if (!v) return;
  const i = statusIdx(v);
  if (i >= VERGABE_STATUS.length - 1) return;
  v.status = VERGABE_STATUS[i + 1].key;
  // Beim Zuschlag automatisch günstigste Offerte als Firma + Betrag übernehmen (Netto via eOff)
  if (v.status === 'vergeben' && !v.firma) {
    const offs = (v.eingeladene || []).filter(e => e.status !== 'abgesagt' && eOff(e) != null).sort((a, b) => eOff(a) - eOff(b));
    if (offs.length) { v.firma = offs[0].firma; v.betrag = eOff(offs[0]); }
  }
  save(); router();
  toast('Status → ' + STATUS_BY_KEY[v.status].label);
}
// Status direkt setzen (vor/zurück) – mit Auto-Firma beim Zuschlag wie advanceVergabe
function setVergabeStatus(pid, vid, status) {
  const p = findProjekt(pid); const v = p && findVergabe(p, vid);
  if (!v || !STATUS_BY_KEY[status]) return;
  v.status = status;
  if (status === 'vergeben' && !v.firma) {
    const offs = (v.eingeladene || []).filter(e => e.status !== 'abgesagt' && eOff(e) != null).sort((a, b) => eOff(a) - eOff(b));
    if (offs.length) { v.firma = offs[0].firma; v.betrag = eOff(offs[0]); }
  }
  save(); router(); toast('Status → ' + STATUS_BY_KEY[status].label);
}
// Stammdaten bearbeiten / löschen
function actEditVergabe(pid, vid) {
  const p = findProjekt(pid); const v = p && findVergabe(p, vid); if (!v) return;
  openModal('Arbeitsbeschrieb bearbeiten', `
    <div class="form-row">
      <label class="field">BKP-Nr. <input class="input" id="fe_bkp" list="dl_febkp" value="${esc(v.bkp || '')}">${bkpDatalist('dl_febkp')}</label>
      <label class="field">Gewerk / Arbeitsbeschrieb <input class="input" id="fe_gewerk" value="${esc(v.gewerk || '')}"></label>
    </div>
    <div class="form-row">
      <label class="field">Kostenschätzung (CHF) <input class="input" type="number" id="fe_schaetzung" value="${v.schaetzung || ''}"></label>
      <label class="field">Eingabefrist <input class="input" type="date" id="fe_frist" value="${esc(v.frist || '')}"></label>
    </div>
    <label class="field">Status <select class="select" id="fe_status">${VERGABE_STATUS.map(s => `<option value="${s.key}"${v.status === s.key ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
    ${((p.bauteile || []).length || (p.optionen || []).length) ? `
    <div class="form-row">
      <label class="field">Bauteil / Teilprojekt <select class="select" id="fe_bauteil">${bauteilOptionsHtml(p, v.bauteil)}</select></label>
      <label class="field">Option <select class="select" id="fe_option"><option value="">–</option>${(p.optionen || []).map(o => `<option value="${o.id}"${v.option === o.id ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
    </div>
    <p class="muted" style="font-size:11.5px;margin:2px 0 0">Gilt für das ganze Gewerk (v.a. Pauschal-Gewerke ohne Einzelpositionen). Positionen mit eigenem Etikett haben Vorrang.</p>` : ''}
    ${bkpKatalogPanel()}
    ${(v.ksPositionen && v.ksPositionen.length) ? '<p class="muted" style="font-size:11.5px;margin:8px 0 0">Hinweis: Die Kostenschätzung wird durch die Positionen im „✎ Kostenschätzung"-Editor überschrieben.</p>' : ''}
  `, `<button class="btn danger" data-act="rm-vergabe" data-pid="${pid}" data-vid="${vid}">Löschen</button><div class="spacer"></div><button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-vergabe-edit" data-pid="${pid}" data-vid="${vid}">Speichern</button>`);
  const bkpEl = $('#fe_bkp');
  if (bkpEl) bkpEl.addEventListener('change', () => { const { label } = parseBkp(bkpEl.value); const g = $('#fe_gewerk'); if (g && !g.value.trim() && label) g.value = label; });
  wireBkpKatalog('fe_bkp', 'fe_gewerk');
}
function saveVergabeEdit(pid, vid) {
  const p = findProjekt(pid); const v = p && findVergabe(p, vid); if (!v) return;
  const bkpParsed = parseBkp($('#fe_bkp').value);
  const gewerk = $('#fe_gewerk').value.trim() || bkpParsed.label;
  if (!gewerk) { toast('Bitte ein Gewerk / einen Arbeitsbeschrieb eingeben', 'info'); return; }
  v.bkp = bkpParsed.code || v.bkp || '000';
  v.gewerk = gewerk;
  v.schaetzung = Number($('#fe_schaetzung').value) || 0;
  v.frist = $('#fe_frist').value || '';
  v.status = $('#fe_status').value || v.status;
  const bte = $('#fe_bauteil'); if (bte) v.bauteil = bte.value;
  const ope = $('#fe_option'); if (ope) v.option = ope.value;
  save(); closeModal(); router(); toast('Arbeitsbeschrieb gespeichert');
}
/* --- Vergabe-Art: Einzelvergabe / ARGE / Teilvergabe --- */
function actVergabeArt(pid, vid) {
  const p = findProjekt(pid); const v = p && findVergabe(p, vid); if (!v) return;
  const mode = (v.teilvergaben && v.teilvergaben.length) ? 'teil' : ((v.argePartner && v.argePartner.length) ? 'arge' : 'einzel');
  const tvRows = (v.teilvergaben && v.teilvergaben.length ? v.teilvergaben : [{ firma: '', betrag: '' }]);
  openModal('Vergabe-Art', `
    <label class="field">Art der Vergabe
      <select class="select" id="va_mode">
        <option value="einzel"${mode === 'einzel' ? ' selected' : ''}>Einzelvergabe (eine Firma)</option>
        <option value="arge"${mode === 'arge' ? ' selected' : ''}>ARGE / Bietergemeinschaft (ein Vertrag, mehrere Partner)</option>
        <option value="teil"${mode === 'teil' ? ' selected' : ''}>Teilvergabe (Gewerk auf mehrere Firmen aufgeteilt)</option>
      </select>
    </label>
    <div id="va_einzel" class="va-sec">
      <div class="form-row">
        <label class="field">Unternehmer <input class="input" id="va_firma" value="${esc(v.firma || '')}"></label>
        <label class="field">Vergabesumme (CHF) <input class="input" type="number" id="va_betrag" value="${v.betrag || ''}"></label>
      </div>
    </div>
    <div id="va_arge" class="va-sec">
      <label class="field">Federführende Firma (Konsortialführer) <input class="input" id="va_argename" value="${esc((v.argePartner && v.argePartner.length) ? (v.firma || '') : '')}" placeholder="z.B. Hugentobler Bau AG"></label>
      <label class="field" style="margin-top:8px">Partnerfirmen <span class="muted" style="font-weight:400;font-size:11px">(eine pro Zeile, inkl. Federführer)</span>
        <textarea class="input" id="va_partner" rows="4" placeholder="Hugentobler Bau AG&#10;Steiner & Co.">${esc((v.argePartner || []).join('\n'))}</textarea>
      </label>
      <label class="field" style="margin-top:8px">Vergabesumme gesamt (CHF) <input class="input" type="number" id="va_argebetrag" value="${v.betrag || ''}"></label>
    </div>
    <div id="va_teil" class="va-sec">
      <p class="muted" style="font-size:12px;margin:0 0 8px">Je Firma einen Teilbetrag. Die Summe wird zur Vergabesumme des Gewerks.</p>
      <div id="va_teil_rows">
        ${tvRows.map(t => tvRowHtml(t.firma, t.betrag)).join('')}
      </div>
      <button class="btn sm secondary" data-act="tv-add" type="button">+ Firma</button>
    </div>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-vergabe-art" data-pid="${pid}" data-vid="${vid}">Speichern</button>`);
  const sel = $('#va_mode');
  const apply = () => { ['einzel', 'arge', 'teil'].forEach(m => { const el = $('#va_' + m); if (el) el.style.display = sel.value === m ? '' : 'none'; }); };
  if (sel) { sel.addEventListener('change', apply); apply(); }
}

function tvRowHtml(firma = '', betrag = '') {
  return `<div class="tv-row form-row" style="margin-bottom:8px">
    <input class="input tv-firma" placeholder="Firma" value="${esc(firma)}">
    <input class="input tv-betrag" type="number" placeholder="Betrag CHF" value="${betrag !== '' && betrag != null ? betrag : ''}" style="max-width:150px">
    <button class="x-btn" data-act="tv-del" type="button" title="Zeile entfernen">×</button>
  </div>`;
}

function tvAddRow() {
  const wrap = $('#va_teil_rows'); if (!wrap) return;
  wrap.insertAdjacentHTML('beforeend', tvRowHtml());
}

function saveVergabeArt(pid, vid) {
  const p = findProjekt(pid); const v = p && findVergabe(p, vid); if (!v) return;
  const mode = $('#va_mode').value;
  if (mode === 'einzel') {
    delete v.argePartner; delete v.teilvergaben;
    const f = $('#va_firma').value.trim(); v.firma = f;
    v.betrag = Number($('#va_betrag').value) || 0;
  } else if (mode === 'arge') {
    delete v.teilvergaben;
    const partner = $('#va_partner').value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!partner.length) { toast('Bitte mindestens eine Partnerfirma angeben', 'info'); return; }
    v.argePartner = partner;
    v.firma = $('#va_argename').value.trim() || partner[0];
    v.betrag = Number($('#va_argebetrag').value) || v.betrag || 0;
    if (statusIdx(v) < STATUS_BY_KEY['vergeben'].index) v.status = 'vergeben';
  } else {
    delete v.argePartner;
    const rows = $$('#va_teil_rows .tv-row').map(row => ({
      id: uid('tv'),
      firma: row.querySelector('.tv-firma').value.trim(),
      betrag: Number(row.querySelector('.tv-betrag').value) || 0,
    })).filter(t => t.firma || t.betrag);
    if (!rows.length) { toast('Bitte mindestens eine Firma mit Betrag angeben', 'info'); return; }
    v.teilvergaben = rows;
    v.betrag = rows.reduce((a, t) => a + t.betrag, 0);
    v.firma = rows.map(t => t.firma).filter(Boolean).join(', ');
    if (statusIdx(v) < STATUS_BY_KEY['vergeben'].index) v.status = 'vergeben';
  }
  save(); closeModal(); router(); toast('Vergabe-Art gespeichert');
}

function rmVergabe(pid, vid) {
  const p = findProjekt(pid); const v = p && findVergabe(p, vid); if (!v) return;
  if (!confirm(`Gewerk „${v.gewerk}" wirklich löschen? Offerten, Nachträge und Rechnungen dazu gehen verloren.`)) return;
  p.vergaben = (p.vergaben || []).filter(x => x.id !== vid);
  save(); closeModal(); go('#/projekt/' + pid); toast('Arbeitsbeschrieb gelöscht');
}

/* --- Unternehmer einladen --- */

function matchCat(k, gewerk) {
  return gewerk.includes((k.kategorie || '').toLowerCase()) ? 1 : 0;
}

function actInvite(pid, vid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  const invited = new Set((v.eingeladene || []).map(e => e.firma));
  const g = v.gewerk.toLowerCase();
  const available = state.kontakte.filter(k => !invited.has(k.firma))
    .sort((a, b) => (matchCat(b, g) - matchCat(a, g)) || a.firma.localeCompare(b.firma));

  openModal('Unternehmer einladen – ' + v.gewerk, `
    <input class="input" id="invSearch" placeholder="Kontakte filtern…">
    <div id="invList" style="max-height:260px;overflow:auto;display:flex;flex-direction:column;gap:2px;margin:-2px 0">
      ${available.length ? available.map(k => `
        <label class="inv-pick" data-search="${esc((k.firma + ' ' + k.kategorie + ' ' + k.ort).toLowerCase())}">
          <input type="checkbox" data-firma="${esc(k.firma)}" data-email="${esc(k.email)}">
          <div><div style="font-weight:600">${esc(k.firma)}</div><div class="muted" style="font-size:12px">${esc(k.kategorie)} · ${esc(k.ort)}</div></div>
        </label>`).join('') : '<p class="muted" style="padding:8px">Alle Kontakte bereits eingeladen.</p>'}
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:6px 0">
    <strong style="font-size:13px">Weitere Firma (nicht in Kontakten)</strong>
    <span class="muted" style="font-size:11.5px"> – im Handelsregister suchen</span>
    <label class="field" style="margin-top:6px">Firma
      <div style="display:flex;gap:6px"><input class="input" id="cust_firma" style="flex:1" placeholder="Firmenname, Ort oder Branche…" autocomplete="off"><button class="btn secondary sm" type="button" id="cust_firma_btn">🔎 Suchen</button></div>
    </label>
    <div id="custFirmaResults" class="ac-list" style="display:none"></div>
    <label class="field">E-Mail <input class="input" id="cust_email" placeholder="optional"></label>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-invite" data-pid="${pid}" data-vid="${vid}">Einladen</button>`);

  $('#invSearch')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    $$('#invList .inv-pick').forEach(row => { row.style.display = row.dataset.search.includes(q) ? '' : 'none'; });
  });
  attachFirmaRegisterSuche('cust_firma', 'custFirmaResults', f => {
    $('#cust_firma').value = f.name;
    $('#cust_email')?.focus();
    toast('Firma aus Register übernommen – E-Mail noch ergänzen', 'info');
  }, 'cust_firma_btn');
}

function saveInvite(pid, vid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  const picks = [];
  $$('#invList input[type=checkbox]:checked').forEach(cb => picks.push({ firma: cb.dataset.firma, email: cb.dataset.email }));
  const cf = $('#cust_firma').value.trim(), ce = $('#cust_email').value.trim();
  if (cf) picks.push({ firma: cf, email: ce });
  if (!picks.length) { toast('Bitte mindestens einen Unternehmer wählen', 'info'); return; }
  const existing = new Set((v.eingeladene || []).map(e => e.firma));
  let n = 0;
  picks.forEach(pk => {
    if (!existing.has(pk.firma)) {
      v.eingeladene.push({ id: uid('e'), firma: pk.firma, email: pk.email || '', betrag: null, status: 'eingeladen', datumMail: '' });
      existing.add(pk.firma); n++;
    }
  });
  save(); closeModal(); router();
  toast(n + ' Unternehmer eingeladen');
}


function removeInvite(pid, vid, eid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  v.eingeladene = (v.eingeladene || []).filter(x => x.id !== eid);
  save(); router();
}

/* --- Rücklese-Flow: Offertbeträge je Unternehmer erfassen / scannen / bestätigen --- */

let rlCtx = null;   // { pid, vid, ids:[eid…], idx }

const RL_STATUS = ['angefragt', 'offeriert', 'abgesagt'];

function actRuecklese(pid, vid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  const ids = (v.eingeladene || []).map(e => e.id);
  if (!ids.length) { toast('Keine Unternehmer eingeladen', 'info'); return; }
  rlCtx = { pid, vid, ids, idx: 0 };
  rueckleseRender();
}

function rueckleseRender() {
  const c = rlCtx; if (!c) return;
  const p = findProjekt(c.pid); const v = findVergabe(p, c.vid);
  const e = (v.eingeladene || []).find(x => x.id === c.ids[c.idx]);
  if (!e) { rlCtx = null; closeModal(); return; }
  const last = c.idx === c.ids.length - 1;
  const statusSel = RL_STATUS.map(s => `<option value="${s}" ${e.status === s ? 'selected' : ''}>${INV_STATUS[s].label}</option>`).join('');

  openModal(`Rücklese – ${c.idx + 1} / ${c.ids.length}`, `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <strong style="font-size:15px">${esc(e.firma)}</strong>
      <span class="st ${INV_STATUS[e.status]?.color || 'grey'}" style="padding:2px 8px;font-size:10.5px">${INV_STATUS[e.status]?.label || e.status}</span>
    </div>
    <div class="form-row">
      <label class="field">Offertbetrag (CHF) <input class="input" type="number" id="rl_betrag" value="${e.betrag ?? ''}" placeholder="z.B. 198000"></label>
      <label class="field">Status <select class="select" id="rl_status">${statusSel}</select></label>
    </div>
    <div style="margin:6px 0 2px">
      <input type="file" id="rl_file" accept="image/*,application/pdf" style="display:none">
      <button class="btn sm secondary" type="button" id="rl_scanbtn">📷 Betrag aus Offerte scannen</button>
    </div>
    <div id="rl_scanbox" class="muted" style="font-size:12.5px;min-height:18px;margin-top:6px"></div>
  `, `
    <button class="btn ghost" type="button" id="rl_prev" ${c.idx === 0 ? 'disabled' : ''}>‹ Zurück</button>
    <button class="btn ghost" type="button" id="rl_skip">Überspringen</button>
    <button class="btn" type="button" id="rl_next">${last ? '✓ Abschliessen' : 'Bestätigen & Weiter ›'}</button>
  `);

  $('#rl_scanbtn')?.addEventListener('click', () => $('#rl_file').click());
  $('#rl_file')?.addEventListener('change', ev => rueckleseScan(ev.target.files && ev.target.files[0]));
  $('#rl_prev')?.addEventListener('click', () => rueckleseNav(-1));
  $('#rl_skip')?.addEventListener('click', () => rueckleseNav(1, true));
  $('#rl_next')?.addEventListener('click', () => rueckleseNav(1));
}

// betrag/status des aktuellen Unternehmers speichern (ohne Re-Render)
function rueckleseCommit() {
  const c = rlCtx; if (!c) return;
  const p = findProjekt(c.pid); const v = findVergabe(p, c.vid);
  const e = (v.eingeladene || []).find(x => x.id === c.ids[c.idx]);
  if (!e) return;
  const raw = $('#rl_betrag') ? $('#rl_betrag').value : '';
  const num = (raw === '' || raw == null) ? null : Number(raw);
  e.betrag = num;
  let st = $('#rl_status') ? $('#rl_status').value : e.status;
  if (num != null && st === 'angefragt') st = 'offeriert';
  e.status = st;
  if (num != null && statusIdx(v) < STATUS_BY_KEY['offerten'].index) v.status = 'offerten';
  save();
}

function rueckleseNav(dir, skip) {
  const c = rlCtx; if (!c) return;
  if (!skip) rueckleseCommit();
  const next = c.idx + dir;
  if (next < 0) return;
  if (next >= c.ids.length) {
    rlCtx = null; closeModal(); router();
    toast('Rücklese abgeschlossen');
    return;
  }
  c.idx = next;
  rueckleseRender();
}

async function rueckleseScan(file) {
  if (!file) return;
  const box = $('#rl_scanbox');
  const set = m => { if (box) box.innerHTML = m; };
  set('⏳ Lade Texterkennung … (erster Scan kann etwas dauern)');
  try {
    const amounts = await ocrAmounts(file, pct => set(`⏳ Erkenne Text … ${Math.round(pct * 100)}%`));
    if (!amounts.length) { set('⚠ Kein Betrag erkannt. Bitte manuell eingeben oder schärferes Bild.'); return; }
    const fld = $('#rl_betrag');
    if (fld && !fld.value) fld.value = amounts[0];   // grösster Betrag = wahrscheinlich Total
    const chips = amounts.slice(0, 6).map(a =>
      `<button class="chip" type="button" data-amount="${a}" style="margin:3px 4px 0 0">${chf(a)}</button>`).join('');
    set(`Erkannte Beträge (anklicken zum Übernehmen):<div style="margin-top:4px">${chips}</div>`);
    box.querySelectorAll('button[data-amount]').forEach(b =>
      b.addEventListener('click', () => { if ($('#rl_betrag')) $('#rl_betrag').value = b.dataset.amount; }));
  } catch (err) {
    set('⚠ Fehler bei der Texterkennung: ' + ((err && err.message) || err));
  }
}

let ocrLibP = null;
function loadOcrLib() {
  if (ocrLibP) return ocrLibP;
  ocrLibP = (async () => {
    if (typeof Tesseract === 'undefined') {
      await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    }
    if (typeof pdfjsLib === 'undefined') {
      await loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js');
      if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js';
    }
  })().catch(err => { ocrLibP = null; throw err; });
  return ocrLibP;
}

// OCR-Quellen: Bild direkt an Tesseract; PDF → erste 2 Seiten als Canvas
async function fileToOcrSources(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if (!isPdf) return [file];
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const out = [];
  const n = Math.min(pdf.numPages, 2);
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 2 });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    out.push(c);
  }
  return out;
}

async function ocrAmounts(file, onProgress) {
  await loadOcrLib();
  const sources = await fileToOcrSources(file);
  let text = '';
  for (const s of sources) {
    const { data } = await Tesseract.recognize(s, 'deu+eng', {
      logger: m => { if (m.status === 'recognizing text' && onProgress) onProgress(m.progress); },
    });
    text += '\n' + (data.text || '');
  }
  return extractAmounts(text);
}

// Beträge aus Text: Schweizer Format (1'234.55 / 1 234.55) + einfache Dezimalzahlen
function extractAmounts(text) {
  const re = /\d{1,3}(?:['’ ]\d{3})+(?:[.,]\d{2})?|\d+[.,]\d{2}/g;
  const found = new Set();
  let m;
  while ((m = re.exec(text))) {
    const num = Number(m[0].replace(/['’ ]/g, '').replace(',', '.'));
    if (isFinite(num) && num >= 1) found.add(num);
  }
  return [...found].sort((a, b) => b - a);
}

/* --- Budgetpositionen --- */

function actNewBudget(pid, vid, bid, prefillText) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  const b = bid ? (v.budgetposten || []).find(x => x.id === bid) : null;
  openModal(b ? 'Budgetposition bearbeiten' : 'Budgetposition', `
    <label class="field">Bezeichnung <input class="input" id="bp_text" value="${b ? esc(b.text || '') : esc(prefillText || '')}" placeholder="z.B. Küche (Budget im WV)"></label>
    <div class="form-row">
      <label class="field">Budget im WV (CHF) <input class="input" type="number" id="bp_betrag" value="${b ? (b.betrag ?? '') : ''}" placeholder="z.B. 25000"></label>
      <label class="field">Tatsächlich gewählt (CHF) <input class="input" type="number" id="bp_ist" value="${b && b.ist != null ? b.ist : ''}" placeholder="leer = noch offen"></label>
    </div>
    <p class="muted" style="font-size:11.5px;margin:2px 0 0">Das Budget steckt im Werkvertrag (wird nicht zusätzlich aufgerechnet). Sobald „tatsächlich gewählt" gesetzt ist, fliesst die <strong>Differenz</strong> in die Baukosten.</p>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-budget" data-pid="${pid}" data-vid="${vid}"${b ? ` data-bid="${bid}"` : ''}>${b ? 'Speichern' : 'Hinzufügen'}</button>`);
}
function saveBudget(pid, vid, bid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  const betrag = Number($('#bp_betrag').value) || 0;
  const istRaw = $('#bp_ist').value;
  const ist = (istRaw === '' || istRaw == null) ? null : (Number(istRaw) || 0);
  const text = $('#bp_text').value.trim() || 'Budgetposition';
  if (!betrag && ist == null) { toast('Bitte einen Budgetbetrag eingeben', 'info'); return; }
  v.budgetposten = v.budgetposten || [];
  const b = bid ? v.budgetposten.find(x => x.id === bid) : null;
  if (b) { b.text = text; b.betrag = betrag; b.ist = ist; }
  else v.budgetposten.push({ id: uid('bp'), text, betrag, ist });
  save(); closeModal(); router(); toast('Budgetposition gespeichert');
}
function removeBudget(pid, vid, bid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  v.budgetposten = (v.budgetposten || []).filter(x => x.id !== bid);
  save(); router();
}

// Budget zu einem Bauherren-Auswahlpunkt erfassen/bearbeiten (auf der verknüpften Vergabe)
function actBudgetForAuswahl(pid, eid) {
  const p = findProjekt(pid); const e = (p.entscheidungen || []).find(x => x.id === eid); if (!e) return;
  const v = e.vid ? findVergabe(p, e.vid) : matchVergabe(p, e.thema);
  if (!v) { toast('Zuerst Unternehmer/Werkvertrag verknüpfen (✏)', 'info'); return; }
  if (!e.vid) { e.vid = v.id; save(); }   // automatische Zuordnung übernehmen
  const b = (v.budgetposten || []).find(x => (x.text || '').toLowerCase() === (e.thema || '').toLowerCase());
  actNewBudget(pid, v.id, b ? b.id : null, e.thema);
}

/* --- Nachträge / Bestellungsänderungen --- */

function actNewNachtrag(pid, vid) {
  openModal('Neuer Nachtrag', `
    <label class="field">Bezeichnung <input class="input" id="n_titel" placeholder="z.B. Mehraushub Fels"></label>
    <div class="form-row">
      <label class="field">Nachtrag-Nr. <input class="input" id="n_nr" placeholder="NT-01"></label>
      <label class="field">Betrag (CHF) <input class="input" type="number" id="n_betrag"></label>
    </div>
    <div class="form-row">
      <label class="field">Datum <input class="input" type="date" id="n_datum" value="${todayIso()}"></label>
      <label class="field">Status
        <select class="select" id="n_status"><option value="offen">Offen</option><option value="genehmigt">Genehmigt</option><option value="abgelehnt">Abgelehnt</option></select>
      </label>
    </div>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-nachtrag" data-pid="${pid}" data-vid="${vid}">Speichern</button>`);
}

function saveNachtrag(pid, vid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  const titel = $('#n_titel').value.trim();
  if (!titel) { toast('Bitte eine Bezeichnung eingeben', 'info'); return; }
  v.nachtraege.push({
    id: uid('n'), titel, nr: $('#n_nr').value.trim(),
    betrag: Number($('#n_betrag').value) || 0,
    datum: $('#n_datum').value || todayIso(),
    status: $('#n_status').value,
  });
  save(); closeModal(); router();
  toast('Nachtrag erfasst');
}

function setNachtragStatus(pid, vid, nid, val) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  const n = (v.nachtraege || []).find(x => x.id === nid); if (!n) return;
  n.status = val; save(); router();
}

function removeNachtrag(pid, vid, nid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  v.nachtraege = (v.nachtraege || []).filter(x => x.id !== nid);
  save(); router();
}

/* --- Rapporte / Regiearbeiten --- */

function actNewRapport(pid, vid) {
  openModal('Neuer Rapport', `
    <label class="field">Bezeichnung <input class="input" id="r_titel" placeholder="z.B. Regiearbeiten Woche 23"></label>
    <div class="form-row">
      <label class="field">Stunden <input class="input" type="number" id="r_std" placeholder="0"></label>
      <label class="field">Betrag (CHF) <input class="input" type="number" id="r_betrag"></label>
    </div>
    <label class="field">Datum <input class="input" type="date" id="r_datum" value="${todayIso()}"></label>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-rapport" data-pid="${pid}" data-vid="${vid}">Speichern</button>`);
}

function saveRapport(pid, vid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  const titel = $('#r_titel').value.trim();
  if (!titel) { toast('Bitte eine Bezeichnung eingeben', 'info'); return; }
  v.rapporte.push({
    id: uid('r'), titel,
    stunden: Number($('#r_std').value) || 0,
    betrag: Number($('#r_betrag').value) || 0,
    datum: $('#r_datum').value || todayIso(),
  });
  save(); closeModal(); router();
  toast('Rapport erfasst');
}

function removeRapport(pid, vid, rid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  v.rapporte = (v.rapporte || []).filter(x => x.id !== rid);
  save(); router();
}

/* --- Rechnungen / Zahlungen --- */

function actNewRechnung(pid, vid) {
  pendingQr = null;
  openModal('Neue Rechnung', `
    <label class="field">Bezeichnung <input class="input" id="rg_text" placeholder="z.B. Akontorechnung 1 / Schlussrechnung"></label>
    <div class="form-row">
      <label class="field">Art
        <select class="select" id="rg_art"><option value="akonto">Akonto-/Teilrechnung</option><option value="schluss">Schlussrechnung</option><option value="gutschrift">Gutschrift</option></select>
      </label>
      <label class="field">Rechnungs-Nr. <input class="input" id="rg_nr" placeholder="optional"></label>
    </div>
    <div class="form-row">
      <label class="field">Betrag (CHF) <input class="input" type="number" id="rg_betrag"></label>
      <label class="field">Datum <input class="input" type="date" id="rg_datum" value="${todayIso()}"></label>
    </div>
    <div class="form-row">
      <label class="field">Garantierückbehalt % <input class="input" type="number" id="rg_rueck" placeholder="z.B. 10" min="0" max="100"></label>
      <label class="field">Skonto bei Zahlung % <input class="input" type="number" id="rg_skonto" placeholder="z.B. 2" min="0" max="100"></label>
    </div>
    <label class="field">Status
      <select class="select" id="rg_bezahlt"><option value="0">offen</option><option value="1">bezahlt</option></select>
    </label>
    <p class="muted" style="font-size:11.5px;margin:6px 0 0">Rückbehalt = einbehaltene Garantiesumme (wird erst nach der Garantiefrist ausbezahlt). Skonto mindert die Auszahlung.</p>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-rechnung" data-pid="${pid}" data-vid="${vid}">Speichern</button>`);
}

function saveRechnung(pid, vid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  const betrag = Number($('#rg_betrag').value) || 0;
  if (!betrag) { toast('Bitte einen Betrag eingeben', 'info'); return; }
  const numv = id => { const el = $('#' + id); return el ? (Number(el.value) || 0) : 0; };
  const artEl = $('#rg_art');
  const rg = {
    id: uid('rg'), text: $('#rg_text').value.trim() || 'Rechnung', nr: $('#rg_nr').value.trim(),
    art: artEl ? artEl.value : 'akonto',
    rueckbehaltP: numv('rg_rueck'), skontoP: numv('rg_skonto'), rbFrei: false,
    betrag, datum: $('#rg_datum').value || todayIso(), bezahlt: $('#rg_bezahlt').value === '1',
  };
  if (pendingQr) { rg.qr = pendingQr; pendingQr = null; }
  (v.rechnungen = v.rechnungen || []).push(rg);
  save(); closeModal(); router(); toast('Rechnung erfasst');
}

function toggleRechnung(pid, vid, rgid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  const r = (v.rechnungen || []).find(x => x.id === rgid); if (!r) return;
  r.bezahlt = !r.bezahlt; save(); router();
}

// Garantierückbehalt freigeben (nach Garantiefrist ausbezahlt)
function toggleRbFrei(pid, vid, rgid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  const r = (v.rechnungen || []).find(x => x.id === rgid); if (!r) return;
  r.rbFrei = !r.rbFrei; save(); router();
  toast(r.rbFrei ? 'Rückbehalt freigegeben' : 'Rückbehalt wieder einbehalten');
}

function removeRechnung(pid, vid, rgid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  v.rechnungen = (v.rechnungen || []).filter(x => x.id !== rgid);
  save(); router();
}

/* --- QR-Rechnung einlesen (Swiss QR-Code aus Bild/PDF) --- */

// Beim Speichern einer QR-Rechnung mitgegebene Metadaten (IBAN/Referenz) – sonst null
let pendingQr = null;

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Konnte nicht laden: ' + src));
    document.head.appendChild(s);
  });
}

let qrLibsP = null;
function loadQrLibs() {
  if (qrLibsP) return qrLibsP;
  qrLibsP = (async () => {
    if (typeof jsQR === 'undefined') {
      await loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');
    }
    if (typeof pdfjsLib === 'undefined') {
      await loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js');
      if (window.pdfjsLib) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js';
      }
    }
  })().catch(err => { qrLibsP = null; throw err; });
  return qrLibsP;
}

// Datei (Bild oder PDF) → Liste von ImageData (eine pro Seite, max. 3 Seiten bei PDF)
function fileToImageDatas(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  return isPdf ? pdfToImageDatas(file) : imageFileToImageData(file).then(d => [d]);
}

function imageFileToImageData(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxDim = 2200;
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht geladen werden')); };
    img.src = url;
  });
}

async function pdfToImageDatas(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const out = [];
  const n = Math.min(pdf.numPages, 3);   // QR sitzt auf dem Zahlteil, i.d.R. erste/letzte Seite
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const c = document.createElement('canvas'); c.width = viewport.width; c.height = viewport.height;
    const ctx = c.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    out.push(ctx.getImageData(0, 0, c.width, c.height));
  }
  return out;
}

function scanQr(imageDatas) {
  for (const d of imageDatas) {
    const r = jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' });
    if (r && r.data) return r.data;
  }
  return null;
}

// Swiss QR Code (SPC, Version 02xx) – feste Zeilenpositionen gem. Implementation Guidelines
function parseSwissQr(text) {
  const lines = text.split(/\r\n|\n|\r/);
  if ((lines[0] || '').trim().toUpperCase() !== 'SPC') return null;
  const g = i => (lines[i] || '').trim();
  return {
    iban:        g(3),
    kreditor:    g(5),
    betrag:      g(18) ? Number(g(18).replace(/'/g, '')) : null,
    waehrung:    g(19) || 'CHF',
    referenzTyp: g(27),
    referenz:    g(28),
    message:     g(29),
  };
}

// QRR-Referenz (27 Stellen) in 5er-Blöcken von rechts darstellen
function fmtQrRef(ref, typ) {
  if (!ref) return '';
  if (typ !== 'QRR') return ref;
  let r = ref.replace(/\s/g, ''), out = '';
  while (r.length > 5) { out = ' ' + r.slice(-5) + out; r = r.slice(0, -5); }
  return (r + out).trim();
}

function actScanQrRechnung(pid, vid) {
  pendingQr = null;
  openModal('QR-Rechnung scannen', `
    <p class="muted" style="font-size:13px;margin-top:0">Foto oder PDF der Rechnung mit Swiss-QR-Code wählen. Betrag, Kreditor und Referenz werden automatisch ausgelesen – du kannst sie danach prüfen.</p>
    <label class="field">Bild oder PDF
      <input class="input" type="file" id="qr_file" accept="image/*,application/pdf">
    </label>
    <div id="qr_status" class="muted" style="font-size:13px;min-height:20px"></div>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button>`);
  $('#qr_file')?.addEventListener('change', e => handleQrFile(e.target.files && e.target.files[0], pid, vid));
}

async function handleQrFile(file, pid, vid) {
  if (!file) return;
  const st = $('#qr_status');
  const set = m => { if (st) st.innerHTML = m; };
  set('⏳ Lese QR-Code …');
  try {
    await loadQrLibs();
    const datas = await fileToImageDatas(file);
    const raw = scanQr(datas);
    if (!raw) { set('⚠ Kein QR-Code gefunden. Schärferes Foto oder die ganze Zahlteil-Seite verwenden.'); return; }
    const qr = parseSwissQr(raw);
    if (!qr) { set('⚠ QR-Code gefunden, aber es ist kein Swiss-QR-Rechnungscode.'); return; }
    openQrRechnungForm(pid, vid, qr);
  } catch (err) {
    set('⚠ Fehler beim Lesen: ' + ((err && err.message) || err));
  }
}

function openQrRechnungForm(pid, vid, qr) {
  pendingQr = { iban: qr.iban, kreditor: qr.kreditor, referenz: qr.referenz, referenzTyp: qr.referenzTyp };
  const refDisp = fmtQrRef(qr.referenz, qr.referenzTyp);
  const fremdWaehrung = qr.waehrung && qr.waehrung !== 'CHF';
  openModal('Rechnung aus QR übernehmen', `
    <div style="background:var(--brand-soft);border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:12.5px;line-height:1.6">
      <strong>✓ Aus QR-Code gelesen</strong><br>
      Kreditor: <strong>${esc(qr.kreditor || '–')}</strong><br>
      IBAN: ${esc(qr.iban || '–')}<br>
      ${refDisp ? 'Referenz: ' + esc(refDisp) + '<br>' : ''}
      ${qr.message ? 'Mitteilung: ' + esc(qr.message) + '<br>' : ''}
      ${fremdWaehrung ? '<span style="color:var(--s-red)">⚠ Währung ' + esc(qr.waehrung) + ' – Betrag prüfen (System rechnet in CHF).</span>' : ''}
    </div>
    <label class="field">Bezeichnung <input class="input" id="rg_text" value="${esc(qr.kreditor || 'Rechnung')}"></label>
    <div class="form-row">
      <label class="field">Rechnungs-Nr. / Referenz <input class="input" id="rg_nr" value="${esc(refDisp)}"></label>
      <label class="field">Betrag (CHF) <input class="input" type="number" id="rg_betrag" value="${qr.betrag != null ? qr.betrag : ''}"></label>
    </div>
    <div class="form-row">
      <label class="field">Art
        <select class="select" id="rg_art"><option value="akonto">Akonto-/Teilrechnung</option><option value="schluss">Schlussrechnung</option><option value="gutschrift">Gutschrift</option></select>
      </label>
      <label class="field">Datum <input class="input" type="date" id="rg_datum" value="${todayIso()}"></label>
    </div>
    <div class="form-row">
      <label class="field">Garantierückbehalt % <input class="input" type="number" id="rg_rueck" placeholder="z.B. 10" min="0" max="100"></label>
      <label class="field">Skonto bei Zahlung % <input class="input" type="number" id="rg_skonto" placeholder="z.B. 2" min="0" max="100"></label>
    </div>
    <label class="field">Status
      <select class="select" id="rg_bezahlt"><option value="0">offen</option><option value="1">bezahlt</option></select>
    </label>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-rechnung" data-pid="${pid}" data-vid="${vid}">Speichern</button>`);
}

/* --- Deckblatt für Ausschreibung / Offerte (PDF) --- */

// Absender/Büro (Eingabeadresse) – Default/Fallback; editierbar via Einstellungen → state.buero
const BUERO = {
  firma: 'P. Hefti Bauberatung GmbH',
  strasse: 'Bernstrasse 40',
  plzort: '3076 Worb',
  tel: '031 839 00 77',
  email: 'info@heftibb.ch',
};

function pdfDeckblatt(pid, vid, eid, typ) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  const e = eid ? (v.eingeladene || []).find(x => x.id === eid) : null;
  const istOfferte = typ === 'offerte';
  const b = state.buero || BUERO;
  const titel = istOfferte ? 'Offerte – äusserste Konditionen' : 'Submissionseinladung';
  const fristJahr = (dISO(v.frist) || new Date()).getFullYear();
  const termin = (v.bauStart && v.bauEnde) ? `${fmtDate(v.bauStart)} – ${fmtDate(v.bauEnde)}` : 'gem. Terminprogramm';
  const line = '...........................................';

  // Firma-Block: bei Offerte/known firma vorausgefüllt, sonst leer zum Ausfüllen
  const firmaBlock = e
    ? `<strong>${esc(e.firma)}</strong>${e.email ? '<br>' + esc(e.email) : ''}`
    : `Unternehmer, Firma<br>Strasse<br>PLZ/Ort<br>Tel./E-Mail<br>Sachbearbeiter/in`;

  const preisZeile = (label, fr) => `<tr><td>${label}</td><td class="pr">Fr.&nbsp; ${fr || line}</td></tr>`;
  const vorOff = istOfferte && e && e.betrag != null;   // bei Offerte ggf. Betrag vorausfüllen

  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>${esc(titel)} – ${esc(v.gewerk)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1b2533; margin: 26mm 22mm; font-size: 12.5px; line-height: 1.5; }
    .lh { color: #444; font-size: 11px; margin-bottom: 26px; }
    .lh .f { font-weight: 700; color: #1b2533; font-size: 14px; margin-bottom: 3px; }
    table.kv { width: 100%; border-collapse: collapse; }
    table.kv td { vertical-align: top; padding: 5px 0; }
    table.kv td.l { width: 38%; }
    .box { border: 1px solid #1b2533; padding: 7px 10px; margin: 2px 0; min-height: 22px; }
    .box.firma { min-height: 90px; }
    h1 { font-size: 16px; margin: 0 0 18px; }
    table.preis { width: 100%; border-collapse: collapse; margin-top: 4px; }
    table.preis td { padding: 6px 0; }
    table.preis td.pr { text-align: left; font-variant-numeric: tabular-nums; }
    .tot td { border-top: 2px solid #1b2533; font-weight: 700; }
    .fest { font-weight: 700; text-decoration: underline; margin-top: 22px; }
    .sig { display: flex; justify-content: space-between; margin-top: 40px; }
    .sig div { border-top: 1px solid #1b2533; width: 44%; padding-top: 4px; font-size: 11px; }
  </style></head><body>
    <div class="lh">
      ${b.logo ? `<img src="${b.logo}" alt="" style="max-height:64px;max-width:220px;display:block;margin-bottom:10px">` : ''}
      <div class="f">${esc(b.firma)}</div>
      ${esc(b.strasse)}${b.strasse ? '<br>' : ''}${esc(b.plzort)}${b.plzort ? '<br>' : ''}
      ${b.tel ? 'Tel. ' + esc(b.tel) + '<br>' : ''}${esc(b.email)}
    </div>

    <h1>${esc(titel)}</h1>

    <table class="kv">
      <tr><td class="l"><strong>Objekt:</strong></td><td><strong>${esc(p.name)}</strong><br>${esc(p.ort)}</td></tr>
      <tr><td class="l">Bauherr:</td><td>${esc(p.bauherr)}</td></tr>
      <tr><td class="l">Eingabeadresse:</td><td>${esc(b.firma)}${b.plzort ? '<br>' + esc(b.plzort) : ''}</td></tr>
      <tr><td class="l">Angebot für:</td><td><div class="box"><strong>BKP ${esc(v.bkp)} – ${esc(v.gewerk)}</strong></div></td></tr>
      <tr><td class="l">${istOfferte ? 'Unternehmer:' : 'Unternehmer, Firma:'}</td><td><div class="box firma">${firmaBlock}</div></td></tr>
      <tr><td class="l">Eingabefrist:</td><td><div class="box"><strong>${v.frist ? fmtDate(v.frist) : '—'}</strong></div></td></tr>
      <tr><td class="l">Voraussichtlicher Ausführungstermin:</td><td>${esc(termin)}</td></tr>
    </table>

    <table class="preis">
      ${preisZeile('Betrag ohne MwSt:', vorOff ? money(e.betrag) : '')}
      ${preisZeile('Rabatt&nbsp;&nbsp;.......... %', '')}
      ${preisZeile('Skonto&nbsp;&nbsp;.......... %', '')}
      ${preisZeile('Allg. Abzüge&nbsp;&nbsp;1 %', '')}
      <tr><td>Netto</td><td class="pr">Fr.&nbsp; ${line}</td></tr>
      ${preisZeile('MwSt&nbsp;&nbsp;8.1 %', '')}
      <tr class="tot"><td>Nettobetrag inkl. MwSt</td><td class="pr">Fr.&nbsp; ${line}</td></tr>
    </table>

    <div class="fest">Preise fest bis 31.12.${fristJahr}</div>

    <div class="sig"><div>Ort, Datum</div><div>Unterschrift</div></div>
    <script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { toast('Bitte Popups für PDF erlauben', 'info'); return; }
  w.document.write(html); w.document.close();
}

/* --- Termine / Gantt --- */

function actEditTermin(pid, vid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  openModal('Grobtermine – ' + v.gewerk, `
    <div class="form-row">
      <label class="field">Ausführung von <input class="input" type="date" id="t_start" value="${esc(v.bauStart || '')}"></label>
      <label class="field">Ausführung bis <input class="input" type="date" id="t_ende" value="${esc(v.bauEnde || '')}"></label>
    </div>
    <label class="field" style="margin-top:8px">Bestellfrist / Vorlauf <input class="input" type="number" id="t_bestell" value="${v.bestellfrist ?? ''}" placeholder="z.B. 30" min="0">
      <span class="muted" style="font-size:11px;font-weight:400;display:block;margin-top:3px">Tage <b>vor</b> Ausführungsbeginn (Material bestellen, Vorlaufzeit). Erscheint im Gantt als heller Balken vor dem Hauptbalken.</span></label>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-termin" data-pid="${pid}" data-vid="${vid}">Speichern</button>`);
}

function saveTermin(pid, vid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  const s = $('#t_start').value, e = $('#t_ende').value;
  if (s && e && e < s) { toast('Ende liegt vor dem Start', 'info'); return; }
  v.bauStart = s; v.bauEnde = e;
  const bf = $('#t_bestell'); if (bf) v.bestellfrist = Number(bf.value) || 0;
  save(); closeModal(); router();
  toast('Termine aktualisiert');
}

function actNewVorgang(pid, vid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  openModal('Vorgang hinzufügen – ' + v.gewerk, `
    <label class="field">Bezeichnung <input class="input" id="o_titel" placeholder="z.B. Rohbau EG"></label>
    <div class="form-row">
      <label class="field">Von <input class="input" type="date" id="o_start" value="${esc(v.bauStart || '')}"></label>
      <label class="field">Bis <input class="input" type="date" id="o_ende" value="${esc(v.bauEnde || '')}"></label>
    </div>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-vorgang" data-pid="${pid}" data-vid="${vid}">Hinzufügen</button>`);
}

function saveVorgang(pid, vid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  const titel = $('#o_titel').value.trim();
  const s = $('#o_start').value, e = $('#o_ende').value;
  if (!titel) { toast('Bitte eine Bezeichnung eingeben', 'info'); return; }
  if (!s || !e) { toast('Bitte Start und Ende setzen', 'info'); return; }
  if (e < s) { toast('Ende liegt vor dem Start', 'info'); return; }
  (v.vorgaenge = v.vorgaenge || []).push({ id: uid('o'), titel, start: s, ende: e });
  save(); closeModal(); router();
  toast('Vorgang hinzugefügt');
}

function removeVorgang(pid, vid, oid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  v.vorgaenge = (v.vorgaenge || []).filter(x => x.id !== oid);
  save(); router();
}

/* --- Firmen-Register-Suche (Demo) ---
   PROTOTYP: lokale Demo-Datenbank. Später ersetzbar durch eine echte Quelle:
     • Zefix REST (Handelsregister): https://www.zefix.admin.ch/ZefixPublicREST/
       POST /api/v1/company/search  { "name": "..." }  -> Name, UID, Sitz, Rechtsform
     • UID-Register des Bundes:      https://www.uid.admin.ch  (UID-/Firmensuche)
   Nur firmenSuche() müsste man dann auf einen fetch() umstellen (async). */

const FIRMEN_DB = [
  { name: 'Hugentobler Bau AG',     uid: 'CHE-101.234.567', rechtsform: 'AG',       plz: '6003', ort: 'Luzern',    kanton: 'LU', branche: 'Baumeister' },
  { name: 'Steiner & Co.',          uid: 'CHE-102.345.678', rechtsform: 'KlG',      plz: '6300', ort: 'Zug',       kanton: 'ZG', branche: 'Baumeister' },
  { name: 'BauKern AG',             uid: 'CHE-103.456.789', rechtsform: 'AG',       plz: '5000', ort: 'Aarau',     kanton: 'AG', branche: 'Baumeister' },
  { name: 'Implenia Schweiz AG',    uid: 'CHE-105.957.461', rechtsform: 'AG',       plz: '8305', ort: 'Dietlikon', kanton: 'ZH', branche: 'Baumeister' },
  { name: 'Marti AG Bauunternehmung', uid: 'CHE-107.811.234', rechtsform: 'AG',     plz: '3302', ort: 'Moosseedorf', kanton: 'BE', branche: 'Baumeister' },
  { name: 'Tiefbau Zentral AG',     uid: 'CHE-110.222.333', rechtsform: 'AG',       plz: '6020', ort: 'Emmenbrücke', kanton: 'LU', branche: 'Tiefbau' },
  { name: 'ErdWerk GmbH',           uid: 'CHE-111.333.444', rechtsform: 'GmbH',     plz: '6010', ort: 'Kriens',    kanton: 'LU', branche: 'Tiefbau' },
  { name: 'Elektro Meyer AG',       uid: 'CHE-112.444.555', rechtsform: 'AG',       plz: '6004', ort: 'Luzern',    kanton: 'LU', branche: 'Elektro' },
  { name: 'Volt & Co.',             uid: 'CHE-113.555.666', rechtsform: 'GmbH',     plz: '6300', ort: 'Zug',       kanton: 'ZG', branche: 'Elektro' },
  { name: 'EKZ Elektrizitätswerke', uid: 'CHE-114.666.777', rechtsform: 'öR',       plz: '8050', ort: 'Zürich',    kanton: 'ZH', branche: 'Elektro' },
  { name: 'Fensterwerk AG',         uid: 'CHE-115.777.888', rechtsform: 'AG',       plz: '6210', ort: 'Sursee',    kanton: 'LU', branche: 'Fenster' },
  { name: 'Fassaden Profi AG',      uid: 'CHE-116.888.999', rechtsform: 'AG',       plz: '8004', ort: 'Zürich',    kanton: 'ZH', branche: 'Fassade' },
  { name: 'Farbwerk Maler AG',      uid: 'CHE-117.999.000', rechtsform: 'AG',       plz: '6005', ort: 'Luzern',    kanton: 'LU', branche: 'Maler' },
  { name: 'Bodenhaus AG',           uid: 'CHE-118.111.222', rechtsform: 'AG',       plz: '6330', ort: 'Cham',      kanton: 'ZG', branche: 'Bodenbeläge' },
  { name: 'Sanitär Wyss AG',        uid: 'CHE-119.222.333', rechtsform: 'AG',       plz: '6002', ort: 'Luzern',    kanton: 'LU', branche: 'Sanitär' },
  { name: 'WärmeTech GmbH',         uid: 'CHE-120.333.444', rechtsform: 'GmbH',     plz: '6300', ort: 'Zug',       kanton: 'ZG', branche: 'Heizung' },
  { name: 'Klima Nord AG',          uid: 'CHE-121.444.555', rechtsform: 'AG',       plz: '6020', ort: 'Emmenbrücke', kanton: 'LU', branche: 'Lüftung' },
  { name: 'Holzwerk Seebli AG',     uid: 'CHE-122.555.666', rechtsform: 'AG',       plz: '8700', ort: 'Küsnacht',  kanton: 'ZH', branche: 'Schreiner' },
  { name: 'Gipser Gloor GmbH',      uid: 'CHE-123.666.777', rechtsform: 'GmbH',     plz: '6010', ort: 'Kriens',    kanton: 'LU', branche: 'Gipser' },
  { name: 'Gartenbau Grün AG',      uid: 'CHE-124.777.888', rechtsform: 'AG',       plz: '6280', ort: 'Hochdorf',  kanton: 'LU', branche: 'Gartenbau' },
];

// UID formatieren: CHE107930188 -> CHE-107.930.188
function fmtUid(u) {
  const m = (u || '').match(/CHE(\d{9})/);
  return m ? `CHE-${m[1].slice(0, 3)}.${m[1].slice(3, 6)}.${m[1].slice(6, 9)}` : (u || '');
}

// Firmensuche live aus dem Schweizer Handelsregister (LINDAS/Zefix des Bundes, ohne Login)
let firmenSucheCtrl = null;
async function firmenSuche(q) {
  const s = (q || '').trim();
  if (s.length < 3) return [];
  if (firmenSucheCtrl) firmenSucheCtrl.abort();      // vorherige (langsame) Anfrage abbrechen
  firmenSucheCtrl = new AbortController();
  try {
    const term = s.toLowerCase().replace(/[\\"]/g, ' ');   // für SPARQL-String entschärfen
    const query =
`PREFIX admin: <https://schema.ld.admin.ch/>
PREFIX schema: <http://schema.org/>
SELECT ?name ?type ?ort ?plz ?str ?uid WHERE {
  { SELECT ?uri ?name WHERE {
      ?uri a admin:ZefixOrganisation ; schema:name ?name .
      FILTER(CONTAINS(LCASE(STR(?name)), "${term}"))
  } LIMIT 8 }
  OPTIONAL { ?uri schema:additionalType ?t . ?t schema:name ?type . FILTER(langMatches(lang(?type),"de")) }
  OPTIONAL { ?uri schema:address ?a .
    OPTIONAL { ?a schema:addressLocality ?ort }
    OPTIONAL { ?a schema:postalCode ?plz }
    OPTIONAL { ?a schema:streetAddress ?str } }
  OPTIONAL { ?uri schema:identifier ?id . FILTER(CONTAINS(STR(?id),"/UID/")) BIND(REPLACE(STR(?id),"^.*/UID/","") AS ?uid) }
}`;
    const r = await fetch('https://lindas.admin.ch/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/sparql-results+json' },
      body: 'query=' + encodeURIComponent(query),
      signal: firmenSucheCtrl.signal,
    });
    if (r.ok) {
      const j = await r.json();
      const seen = new Set(), out = [];
      for (const b of (j.results?.bindings || [])) {
        const row = {
          name: b.name?.value || '',
          uid: fmtUid(b.uid?.value || ''),
          rechtsform: b.type?.value || '',
          plz: b.plz?.value || '',
          ort: b.ort?.value || '',
          strasse: b.str?.value || '',
          kanton: '', branche: '',
        };
        const key = row.name + row.uid;
        if (row.name && !seen.has(key)) { seen.add(key); out.push(row); }
      }
      if (out.length) return out;
    }
  } catch (e) { if (e.name === 'AbortError') return []; /* sonst Fallback unten */ }
  // Fallback (offline / Dienst nicht erreichbar): lokale Demo-Liste
  const ls = s.toLowerCase();
  return FIRMEN_DB
    .filter(f => f.name.toLowerCase().includes(ls) || f.ort.toLowerCase().includes(ls) || f.branche.toLowerCase().includes(ls))
    .slice(0, 8);
}

function actKontakt(kid) {
  const k = kid ? (state.kontakte || []).find(x => x.id === kid) : null;
  const val = f => k && k[f] != null ? esc(k[f]) : '';
  openModal(k ? 'Kontakt bearbeiten' : 'Neuer Kontakt', `
    <label class="field">Firma ${k ? '' : '<span class="muted" style="font-weight:400;font-size:11.5px">– im Handelsregister suchen</span>'}
      <div style="display:flex;gap:6px"><input class="input" id="f_firma" style="flex:1" value="${val('firma')}" placeholder="Firmenname, Ort oder Branche…" autocomplete="off"><button class="btn secondary sm" type="button" id="f_firma_btn">🔎 Suchen</button></div>
    </label>
    <div id="firmaResults" class="ac-list" style="display:none"></div>
    <div class="form-row">
      <label class="field">UID <input class="input" id="f_uid" value="${val('uid_nr')}" placeholder="CHE-…"></label>
      <label class="field">Rechtsform <input class="input" id="f_rf" value="${val('rechtsform')}"></label>
    </div>
    <label class="field">Kategorie / Gewerk <input class="input" id="f_kat" list="dl_kkat" value="${k && k.kategorie !== '–' ? val('kategorie') : ''}" placeholder="z.B. Baumeister">${kategorieDatalist('dl_kkat')}</label>
    <label class="field">Strasse <input class="input" id="f_str" value="${val('strasse')}"></label>
    <div class="form-row">
      <label class="field">PLZ <input class="input" id="f_plz" value="${val('plz')}"></label>
      <label class="field">Ort <input class="input" id="f_kort" value="${val('ort')}"></label>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:4px 0">
    <div class="form-row">
      <label class="field">Ansprechperson <input class="input" id="f_person" value="${val('person')}" placeholder="Vor- und Nachname"></label>
      <label class="field">Funktion <input class="input" id="f_funktion" value="${val('funktion')}" placeholder="z.B. Geschäftsführer"></label>
    </div>
    <div class="form-row">
      <label class="field">E-Mail <input class="input" id="f_email" value="${val('email')}" placeholder="name@firma.ch"></label>
      <label class="field">Telefon <input class="input" id="f_tel" value="${val('telefon')}"></label>
    </div>
    <label class="field">Website
      <div style="display:flex;gap:6px"><input class="input" id="f_web" style="flex:1" value="${val('website')}" placeholder="https://…"><button class="btn secondary sm" type="button" id="f_web_search" title="Website im Web suchen">🔎 suchen</button></div>
    </label>
    <label class="field">Notiz <textarea class="input" id="f_notiz" rows="2">${k ? esc(k.notiz || '') : ''}</textarea></label>
  `, `${k ? `<button class="btn danger" data-act="rm-kontakt" data-kid="${kid}">Löschen</button><div class="spacer"></div>` : ''}<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-kontakt"${k ? ` data-kid="${kid}"` : ''}>${k ? 'Speichern' : 'Hinzufügen'}</button>`);
  attachFirmaSuche();
  const wb = $('#f_web_search');
  if (wb) wb.addEventListener('click', () => {
    const fn = ($('#f_firma').value || '').trim(); if (!fn) { toast('Zuerst Firma eingeben', 'info'); return; }
    const ort = ($('#f_kort').value || '').trim();
    window.open('https://www.google.com/search?q=' + encodeURIComponent(fn + ' ' + ort + ' offizielle Website'), '_blank');
  });
}
// Generische Handelsregister-Suche (LINDAS): Eingabe + „Suchen"-Knopf → Loader → Ergebnisse; onPick(f) bei Auswahl
function attachFirmaRegisterSuche(inputId, boxId, onPick, btnId) {
  const inp = $('#' + inputId), box = $('#' + boxId), btn = btnId ? $('#' + btnId) : null;
  if (!inp || !box) return;
  let matches = [];
  const renderResults = () => {
    box.style.display = 'block';
    if (!matches.length) { box.innerHTML = '<div class="ac-item muted">Keine Treffer im Handelsregister.</div>'; return; }
    box.innerHTML = matches.map((f, i) => `
      <div class="ac-item" data-i="${i}">
        <div><strong>${esc(f.name)}</strong>${f.rechtsform ? ` <span class="tag">${esc(f.rechtsform)}</span>` : ''}</div>
        <div class="muted" style="font-size:12px">${esc(f.uid)}${f.ort ? ' · ' + (f.plz ? esc(f.plz) + ' ' : '') + esc(f.ort) : ''}${f.branche ? ' · ' + esc(f.branche) : ''}</div>
      </div>`).join('');
  };
  const runSearch = async () => {
    const v = inp.value.trim();
    box.style.display = 'block';
    if (v.length < 3) { box.innerHTML = '<div class="ac-item muted">Bitte mindestens 3 Zeichen eingeben.</div>'; return; }
    box.innerHTML = `<div class="hr-loader"><span class="hr-spin"></span><span>Durchsuche das Handelsregister<span class="hr-dots"><i>.</i><i>.</i><i>.</i></span></span></div>`;
    const res = await firmenSuche(v);
    if (inp.value.trim() !== v) return;   // Eingabe hat sich geändert → Ergebnis verwerfen
    matches = res; renderResults();
  };
  if (btn) btn.addEventListener('click', runSearch);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });
  box.addEventListener('click', e => {
    const it = e.target.closest('.ac-item'); if (!it || it.dataset.i == null) return;
    box.style.display = 'none'; box.innerHTML = '';
    onPick(matches[+it.dataset.i]);
  });
}
function attachFirmaSuche() {
  attachFirmaRegisterSuche('f_firma', 'firmaResults', f => {
    $('#f_firma').value = f.name; $('#f_uid').value = f.uid || ''; $('#f_rf').value = f.rechtsform || '';
    if (f.strasse && $('#f_str')) $('#f_str').value = f.strasse;
    $('#f_plz').value = f.plz || ''; $('#f_kort').value = f.ort || '';
    if (!$('#f_kat').value.trim()) $('#f_kat').value = f.branche || '';
    $('#f_person')?.focus(); toast('Firmendaten aus Register übernommen', 'info');
  }, 'f_firma_btn');
}
function saveKontakt(kid) {
  const firma = $('#f_firma').value.trim();
  if (!firma) { toast('Bitte eine Firma eingeben', 'info'); return; }
  const data = {
    firma, uid_nr: $('#f_uid').value.trim(), rechtsform: $('#f_rf').value.trim(),
    kategorie: $('#f_kat').value.trim() || '–', strasse: $('#f_str').value.trim(),
    plz: $('#f_plz').value.trim(), ort: $('#f_kort').value.trim(),
    person: $('#f_person').value.trim(), funktion: $('#f_funktion').value.trim(),
    email: $('#f_email').value.trim(), telefon: $('#f_tel').value.trim(),
    website: $('#f_web').value.trim(), notiz: $('#f_notiz').value.trim(),
  };
  const k = kid ? (state.kontakte || []).find(x => x.id === kid) : null;
  if (k) Object.assign(k, data); else state.kontakte.unshift({ id: uid('k'), ...data });
  save(); closeModal();
  if (kid) viewKontaktDetail(kid); else viewKontakte();
  toast('Kontakt gespeichert');
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'submitone-export.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Export erstellt');
}

function resetDemo() {
  const warn = cloudEnabled
    ? `<div style="background:#fdecec;border:1px solid var(--s-red);border-radius:8px;padding:10px 12px;font-size:13px;color:#7a1d1d">
         <strong>⚠ Cloud-Modus:</strong> Dies überschreibt den <strong>gemeinsamen Arbeitsbereich für alle</strong> mit den Demo-Daten. Alle bestehenden Projekte, Vergaben, Protokolle usw. gehen verloren und werden auf allen Geräten synchronisiert.
       </div>`
    : `<p class="muted" style="font-size:13px;margin-top:0">Dies ersetzt alle aktuellen Daten in diesem Browser durch die Demo-Daten.</p>`;
  openModal('Demo-Daten neu laden?', `
    ${warn}
    <p style="font-size:13px;margin-bottom:0">Tipp: vorher <button class="btn sm secondary" type="button" id="reset_export">⬇ Daten exportieren</button> zur Sicherung.</p>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button>
      <button class="btn danger" data-act="confirm-reset">Ja, Demo-Daten laden</button>`);
  $('#reset_export')?.addEventListener('click', exportData);
}

function doResetDemo() {
  state = demoData(); migrate(); save(); closeModal(); router();
  toast('Demo-Daten geladen', 'info');
}

/* ---------------------------------------------------------------
   16) Globale Event-Delegation
   --------------------------------------------------------------- */

document.addEventListener('click', e => {
  // Aktionen haben Vorrang vor Navigation (Buttons können in klickbaren Zeilen liegen)
  const act = e.target.closest('[data-act]');
  if (!act) {
    const goto = e.target.closest('[data-goto]');
    if (goto) go(goto.dataset.goto);
    return;
  }
  const { act: a, pid, vid, eid, nid, rid, oid, prid, tid, itemid, kind, idx, rgid, fid, bid, gid } = act.dataset;
  switch (a) {
    case 'conflict-keep': resolveConflictKeep(pid); break;
    case 'conflict-take': resolveConflictTake(pid); break;
    case 'abo':          actAbo(); break;
    case 'upgrade':      openCheckout(act.dataset.plan); break;
    case 'team':         actTeam(pid); break;
    case 'team-add':     teamAdd(pid); break;
    case 'team-rm':      teamRemove(pid, act.dataset.key); break;
    case 'new-projekt':  actNewProjekt(); break;
    case 'save-projekt': saveProjekt(); break;
    case 'edit-projekt': actEditProjekt(pid); break;
    case 'save-projekt-edit': saveProjektEdit(pid); break;
    case 'dossier-edit':   actDossier(pid, act.dataset.did); break;
    case 'dossier-save':   saveDossier(pid, act.dataset.did); break;
    case 'dossier-create': dossierCreate(pid, kind); break;
    case 'dossier-add':      actDossierAdd(pid, kind); break;
    case 'dossier-add-save': saveDossierAdd(pid, kind); break;
    case 'dossier-del':      rmDossierCustom(pid, act.dataset.did); break;
    case 'erfassen':       erfassen(kind); break;
    case 'erfassen-go':    erfassenGo(kind); break;
    case 'pend-proj-toggle': pendProjToggle(pid); break;
    case 'pend-add':       actPendenz(pid); break;
    case 'pend-mail':      actPendenzMail(pid, itemid); break;
    case 'pend-mail-open': pendMailOpen(); break;
    case 'pend-mail-copy': pendMailCopy(); break;
    case 'pend-edit':      actPendenz(pid, itemid); break;
    case 'pend-save':      savePendenz(pid, itemid); break;
    case 'pend-del':       rmPendenz(pid, itemid); break;
    case 'proj-farbe':     openFarbePopover(pid, act); break;
    case 'proj-farbe-set': setProjFarbe(pid, act.dataset.k); break;
    case 'farbe-pick':     { const row = act.closest('.farbe-row'); if (row) row.querySelectorAll('.farbe-sw').forEach(s => s.classList.toggle('sel', s === act)); const hid = $('#f_farbe'); if (hid) hid.value = act.dataset.k; break; }
    case 'kal-add':      actKalTermin(pid, null, kind); break;
    case 'kal-edit':     actKalTermin(pid, tid); break;
    case 'kal-save':     saveKalTermin(pid, tid); break;
    case 'kal-del':      removeKalTermin(pid, tid); break;
    case 'kal-prev':     kalNav(pid, -1); break;
    case 'kal-next':     kalNav(pid, 1); break;
    case 'kal-today':    kalNav(pid, 0); break;
    case 'kal-view':     kalSetView(pid, kind); break;
    case 'kal-day':      kalDay(pid, kind); break;
    case 'gcal-add':     actGlobalTermin(kind); break;
    case 'gkal-save':    saveGlobalTermin(); break;
    case 'gcal-prev':    gcalNav(-1); break;
    case 'gcal-next':    gcalNav(1); break;
    case 'gcal-today':   gcalNav(0); break;
    case 'gcal-toggle':  gcalToggle(pid); break;
    case 'gcal-view':    gcalSetView(kind); break;
    case 'gcal-day':     gcalDay(kind); break;
    case 'plan-view':    planSetView(kind); break;
    case 'plan-prev':    planNav(-1); break;
    case 'plan-next':    planNav(1); break;
    case 'plan-today':   planNav(0); break;
    case 'plan-day':     planView = 'tag'; planRefIso = kind; viewPlanung(); break;
    case 'plan-toggle':  planToggle(pid); break;
    case 'plan-arm':     planArm(Number(idx)); break;
    case 'plan-dur':     planDurStep(Number(idx), Number(act.dataset.d)); break;
    case 'plan-add':     actPlanBlock(null, kind, ''); break;
    case 'plan-edit':    actPlanBlock(bid); break;
    case 'plan-save':    savePlanBlock(bid); break;
    case 'plan-del':     removePlanBlock(bid); break;
    case 'new-geschoss':  actNewGeschoss(pid); break;
    case 'edit-geschoss': actNewGeschoss(pid, gid); break;
    case 'save-geschoss': saveGeschoss(pid, gid); break;
    case 'rm-geschoss':   removeGeschoss(pid, gid); break;
    case 'new-einheit':   actNewEinheit(pid, gid); break;
    case 'edit-einheit':  actNewEinheit(pid, gid, eid); break;
    case 'save-einheit':  saveEinheit(pid, gid, eid); break;
    case 'rm-einheit':    removeEinheit(pid, gid, eid); break;
    case 'new-vergabe':  actNewVergabe(pid); break;
    case 'kat-toggle':   katOpen = !katOpen; router(); break;
    case 'quickadd-bkp': quickAddVergabe(pid, act.dataset.code, act.dataset.label); break;
    case 'gw-toggle':    { const y = window.scrollY; gwOpen.has(vid) ? gwOpen.delete(vid) : gwOpen.add(vid); router(); window.scrollTo(0, y); } break;
    case 'gw-action':    gewerkAction(pid, vid, act.dataset.action); break;
    case 'ptabs-more':   ptabsMoreToggle(); break;
    case 'save-vergabe': saveVergabe(pid); break;
    case 'ks-edit':      actKostenschaetzung(pid, vid); break;
    case 'ks-pos-add':   ksPosAdd(); break;
    case 'ks-pos-del':   ksPosDel(Number(idx)); break;
    case 'ks-calc-add':  ksCalcAdd(); break;
    case 'save-ks':      saveKostenschaetzung(pid, vid); break;
    case 'pdf-dossier':          pdfDossier(pid); break;
    case 'pdf-vergabeantrag-alle': pdfVergabeantragAlle(pid); break;
    case 'pdf-kostenschaetzung': pdfKostenschaetzung(pid); break;
    case 'pdf-solar':            pdfSolar(pid); break;
    case 'solar-baukosten':      solarToBaukosten(pid); break;
    case 'pdf-baukosten':        actPdfBaukosten(pid); break;
    case 'pdf-baukosten-mode':   closeModal(); pdfBaukosten(pid, act.dataset.mode); break;
    case 'pdf-gantt':            pdfGantt(pid); break;
    case 'pdf-zahlungsplan':     pdfZahlungsplan(pid); break;
    case 'pdf-rechnungen':       pdfRechnungskontrolle(pid); break;
    case 'advance':      advanceVergabe(pid, vid); break;
    case 'edit-vergabe':      actEditVergabe(pid, vid); break;
    case 'save-vergabe-edit': saveVergabeEdit(pid, vid); break;
    case 'rm-vergabe':        rmVergabe(pid, vid); break;
    case 'vergabe-art':       actVergabeArt(pid, vid); break;
    case 'save-vergabe-art':  saveVergabeArt(pid, vid); break;
    case 'opt-toggle':   { optEnsure(findProjekt(pid)); const o = act.dataset.optid; if (optSel.aus.has(o)) optSel.aus.delete(o); else optSel.aus.add(o); router(); } break;
    case 'opt-variante': { optEnsure(findProjekt(pid)); optSel.grp[act.dataset.grp] = act.dataset.optid; router(); } break;
    case 'opt-manage':   actBauteileOptionen(pid); break;
    case 'solar-bs-add': { const w = $('#s_bauseite'); if (w) { w.insertAdjacentHTML('beforeend', bsRow(pid)); solarUpdate(pid); } } break;
    case 'solar-bs-del': { const r = act.closest('.bsr'); if (r) { r.remove(); solarUpdate(pid); } } break;
    case 'solar-load':     solarToggle(pid, act.dataset.load); break;
    case 'solar-batt':     solarBattery(pid, act.dataset.key); break;
    case 'solar-region':   solarRegion(pid, Number(act.dataset.v)); break;
    case 'solar-persons':  { const pp = findProjekt(pid); if (pp) { const ss = solarPreserve(pp); ss.verbrauch = Number(act.dataset.v); pp.solar = ss; save(); viewSolar(pid); } } break;
    case 'solar-bauseite': solarBauseite(pid, act.dataset.label, Number(act.dataset.chf)); break;
    case 'bt-add':       { const w = $('#bt_rows'); if (w) w.insertAdjacentHTML('beforeend', obtRow(null)); } break;
    case 'op-add':       { const w = $('#op_rows'); if (w) w.insertAdjacentHTML('beforeend', oopRow(findProjekt(pid), null)); } break;
    case 'row-del':      { const r = act.closest('.bt-row, .op-row'); if (r) r.remove(); } break;
    case 'save-bt-opt':  saveBtOpt(pid); break;
    case 'tv-add':            tvAddRow(); break;
    case 'tv-del':            { const row = act.closest('.tv-row'); if (row) row.remove(); } break;
    case 'konditionen':      actKonditionen(pid, vid, eid); break;
    case 'konditionen-save': saveKonditionen(pid, vid, eid); break;
    case 'pdf-vergabeantrag': pdfVergabeantrag(pid, vid); break;
    case 'invite':       actInvite(pid, vid); break;
    case 'save-invite':  saveInvite(pid, vid); break;
    case 'sendmail':     mailEinladung(pid, vid); break;
    case 'mail-zuschlag': mailZuschlag(pid, vid); break;
    case 'mail-absage':   mailAbsage(pid, vid); break;
    case 'rm-inv':       removeInvite(pid, vid, eid); break;
    case 'ruecklese':    actRuecklese(pid, vid); break;
    case 'pdf-submittenten': pdfSubmittenten(pid); break;
    case 'pdf-unternehmer':  pdfUnternehmer(pid); break;
    case 'pdf-honorar':      if (pid) honorarPid = pid; pdfHonorar(); break;
    case 'honorar-detail':   honorarDetail = !honorarDetail; viewHonorar(); break;
    case 'new-entscheidung':    actNewEntscheidung(pid); break;
    case 'edit-entscheidung':   actNewEntscheidung(pid, eid); break;
    case 'save-entscheidung':   saveEntscheidung(pid); break;
    case 'update-entscheidung': updateEntscheidung(pid, eid); break;
    case 'rm-entscheidung':     removeEntscheidung(pid, eid); break;
    case 'standard-bemusterung':addStandardBemusterung(pid); break;
    case 'bauherr-wohnung':  bauherrWohnung = kind; viewBauherr(pid); break;
    case 'pdf-entscheidungen':  pdfEntscheidungen(pid); break;
    case 'pdf-melden':          pdfMelden(pid); break;
    case 'new-bezugsfirma':     actNewBezugsfirma(pid); break;
    case 'save-bezugsfirma':    saveBezugsfirma(pid); break;
    case 'rm-bezugsfirma':      removeBezugsfirma(pid, fid); break;
    case 'pdf-bezugsfirmen':    pdfBezugsfirmen(pid); break;
    case 'new-budget':   actNewBudget(pid, vid); break;
    case 'save-budget':  saveBudget(pid, vid); break;
    case 'rm-budget':    removeBudget(pid, vid, bid); break;
    case 'budget-auswahl': actBudgetForAuswahl(pid, eid); break;
    case 'abo-open':     actAbo(); break;
    case 'new-auflage':      actNewAuflage(pid); break;
    case 'edit-auflage':     actNewAuflage(pid, act.dataset.aid); break;
    case 'save-auflage':     saveAuflage(pid, act.dataset.aid); break;
    case 'rm-auflage':       removeAuflage(pid, act.dataset.aid); break;
    case 'auflage-standard': addStandardAuflagen(pid); break;
    case 'sammelrg':     actSammelrechnung(pid); break;
    case 'save-sammelrg': saveSammelrechnung(pid); break;
    case 'zp-verteilen': zahlungsplanVerteilen(pid); break;
    case 'zp-zeitraum':  { const p2 = findProjekt(pid); zahlungsplanRead(pid); const zr = zahlungsplanZeitraum(p2); const z2 = zahlungsplanOf(p2); z2.von = zr.von; z2.bis = zr.bis; save(); viewZahlungsplan(pid); toast('Zeitraum übernommen'); break; }
    case 'zp-honmode':   { const p2 = findProjekt(pid); zahlungsplanRead(pid); zahlungsplanOf(p2).honMode = act.dataset.mode; save(); viewZahlungsplan(pid); break; }
    case 'zp-version':     zpVersion(pid, act.dataset.vid); break;
    case 'zp-version-neu': zpVersionNeu(pid); break;
    case 'zp-lock':        zpLock(pid); break;
    case 'zp-rename':      zpRename(pid); break;
    case 'zp-mon-reset':   zpMonReset(pid); break;
    case 'zp-modus':     { const p2 = findProjekt(pid); zahlungsplanOf(p2).modus = act.dataset.modus; save(); viewZahlungsplan(pid); break; }
    case 'zp-baukosten': { const p2 = findProjekt(pid); zahlungsplanRead(pid); zahlungsplanOf(p2).betrag = Math.round(baukostenTotal(p2)); save(); viewZahlungsplan(pid); break; }
    case 'zp-honorar':   { const p2 = findProjekt(pid); zahlungsplanRead(pid); zahlungsplanOf(p2).betrag = p2.honorar ? Math.round(computeHonorar(p2.honorar).H) : 0; save(); viewZahlungsplan(pid); break; }
    case 'zp-honofferte': { const p2 = findProjekt(pid); zahlungsplanRead(pid); zahlungsplanOf(p2).betrag = Math.round(Number(finanzData(p2).honorare) || 0); save(); viewZahlungsplan(pid); break; }
    case 'uw-pick':      uwertPick(pid, act.dataset.id); break;
    case 'uw-add':       uwertAddSchicht(pid); break;
    case 'uw-rm':        uwertRmSchicht(pid, Number(act.dataset.idx)); break;
    case 'uw-newbt':     uwertAddBauteil(pid); break;
    case 'uw-delbt':     uwertDelBauteil(pid); break;
    case 'nt-pick':      actNachtragPick(pid, act.dataset.kind); break;
    case 'np-nachtrag':  actNewNachtrag(pid, vid); break;
    case 'np-rapport':   actNewRapport(pid, vid); break;
    case 'new-nachtrag': actNewNachtrag(pid, vid); break;
    case 'save-nachtrag':saveNachtrag(pid, vid); break;
    case 'rm-nachtrag':  removeNachtrag(pid, vid, nid); break;
    case 'new-rapport':  actNewRapport(pid, vid); break;
    case 'save-rapport': saveRapport(pid, vid); break;
    case 'rm-rapport':   removeRapport(pid, vid, rid); break;
    case 'new-rechnung': actNewRechnung(pid, vid); break;
    case 'save-rechnung':saveRechnung(pid, vid); break;
    case 'rm-rechnung':  removeRechnung(pid, vid, rgid); break;
    case 'rb-frei':      toggleRbFrei(pid, vid, rgid); break;
    case 'scan-qr':      actScanQrRechnung(pid, vid); break;
    case 'deckblatt':              pdfDeckblatt(pid, vid, eid, 'einladung'); break;
    case 'deckblatt-leer':         pdfDeckblatt(pid, vid, null, 'einladung'); break;
    case 'deckblatt-offerte':      pdfDeckblatt(pid, vid, eid, 'offerte'); break;
    case 'deckblatt-offerte-leer': pdfDeckblatt(pid, vid, null, 'offerte'); break;
    case 'edit-termin':  actEditTermin(pid, vid); break;
    case 'save-termin':  saveTermin(pid, vid); break;
    case 'gantt-zoom':   ganttZoom = kind; ganttScale = 1; viewTermine(pid); break;
    case 'gantt-chain':  ganttChain = !ganttChain; toast('Verkettung ' + (ganttChain ? 'an' : 'aus'), 'info'); rerenderGantt(pid); break;
    case 'gantt-workdays': ganttWorkdays = !ganttWorkdays; toast('Arbeitstage ' + (ganttWorkdays ? 'an' : 'aus'), 'info'); rerenderGantt(pid); break;
    case 'bauablauf':    actBauablauf(pid); break;
    case 'bauablauf-go': applyBauablauf(pid); break;
    case 'link-succ-pick': linkSuccessorPick(pid, act.dataset.vid, act.dataset.tvid); break;
    case 'gantt-scale':
      if (kind === 'out') ganttScale = Math.max(0.12, +(ganttScale * 0.8).toFixed(3));
      else if (kind === 'in') ganttScale = Math.min(4, +(ganttScale * 1.25).toFixed(3));
      else ganttScale = 1;
      rerenderGantt(pid); break;
    case 'gantt-sort':   ganttSort = kind; rerenderGantt(pid); break;
    case 'gantt-side':   ganttSide[kind] = !ganttSide[kind]; rerenderGantt(pid); break;
    case 'new-vorgang':  actNewVorgang(pid, vid); break;
    case 'save-vorgang': saveVorgang(pid, vid); break;
    case 'rm-vorgang':   removeVorgang(pid, vid, oid); break;
    case 'new-protokoll':   actNewProtokoll(pid, kind); break;
    case 'save-protokoll':  saveProtokoll(pid); break;
    case 'filter-prot':     protokollFilter = kind; viewProtokolle(pid); break;
    case 'edit-protokoll':  actEditProtokoll(pid, prid); break;
    case 'update-protokoll':updateProtokoll(pid, prid); break;
    case 'del-protokoll':   delProtokoll(pid, prid); break;
    case 'copy-protokoll':  actCopyProtokoll(pid, prid); break;
    case 'save-copy':       doCopyProtokoll(pid, prid); break;
    case 'add-person':      addPerson(pid, prid, kind); break;
    case 'rm-person':       rmPerson(pid, prid, kind, idx); break;
    case 'pick-personen':   actPickPersonen(pid, prid, kind); break;
    case 'save-personen':   savePersonen(pid, prid, kind); break;
    case 'new-traktandum':  actNewTraktandum(pid, prid); break;
    case 'save-traktandum': saveTraktandum(pid, prid); break;
    case 'rm-traktandum':   rmTraktandum(pid, prid, tid); break;
    case 'new-eintrag':     actNewEintrag(pid, prid, tid); break;
    case 'save-eintrag':    saveEintrag(pid, prid, tid); break;
    case 'rm-eintrag':      rmEintrag(pid, prid, tid, itemid); break;
    case 'pdf-protokoll':   pdfProtokoll(pid, prid); break;
    case 'mail-protokoll':  mailProtokoll(pid, prid); break;
    case 'new-kontakt':  actKontakt(); break;
    case 'edit-kontakt': actKontakt(act.dataset.kid); break;
    case 'save-kontakt': saveKontakt(act.dataset.kid); break;
    case 'rm-kontakt':   rmKontakt(act.dataset.kid); break;
    case 'kontakt-kat':  kontaktKat = kind; viewKontakte(); break;
    case 'sig-from-buero': { const f = $('#b_firma').value.trim(), s = $('#b_strasse').value.trim(), pz = $('#b_plzort').value.trim(), t = $('#b_tel').value.trim(); const sig = 'Freundliche Grüsse\n' + [f, [s, pz].filter(Boolean).join(', '), t ? 'Tel. ' + t : ''].filter(Boolean).join('\n'); const el = $('#b_signatur'); if (el) el.value = sig; toast('Signatur erzeugt – „Büro speichern" nicht vergessen'); break; }
    case 'save-buero':   saveBuero(); break;
    case 'rm-logo':      state.buero = { ...(state.buero || {}), logo: '' }; save(); viewEinstellungen(); break;
    case 'export':       exportData(); break;
    case 'reset':        resetDemo(); break;
    case 'confirm-reset':doResetDemo(); break;
    case 'logout':       logout(); break;
  }
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
document.addEventListener('mousemove', onGanttMove);
document.addEventListener('mouseup', onGanttUp);
document.addEventListener('contextmenu', onGlobalContext);
// Delegierte change-Handler: Monatsbeträge + Teilprojekt-Zuordnung in der Baukostenübersicht
document.addEventListener('change', e => {
  const t = e.target; if (!t.closest) return;
  const mon = t.closest('.zp-mon'); if (mon) { setMonatOverride(mon.dataset.pid, mon.dataset.key, mon.value); return; }
  const gw = t.closest('.bt-gw'); if (gw) { setGewerkBauteil(gw.dataset.pid, gw.dataset.vid, gw.value); return; }
  const nt = t.closest('.bt-nt'); if (nt) { setNachtragBauteil(nt.dataset.pid, nt.dataset.vid, nt.dataset.nid, nt.value); return; }
  const rg = t.closest('.bt-rg'); if (rg) { setRechnungBauteil(rg.dataset.pid, rg.dataset.vid, rg.dataset.rgid, rg.value); return; }
});

// Sidebar-Footer-Buttons
window.addEventListener('DOMContentLoaded', boot);

/* ---------------------------------------------------------------
   17) Demo-Daten
   --------------------------------------------------------------- */

function demoData() {
  const kontakte = [
    { id: 'k1', firma: 'Hugentobler Bau AG', kategorie: 'Baumeister', ort: 'Luzern', person: 'P. Hugentobler', email: 'info@hugentobler-bau.ch', telefon: '041 000 00 00' },
    { id: 'k2', firma: 'Steiner & Co.', kategorie: 'Baumeister', ort: 'Zug', person: 'R. Steiner', email: 'kontakt@steiner-co.ch', telefon: '041 111 11 11' },
    { id: 'k3', firma: 'BauKern AG', kategorie: 'Baumeister', ort: 'Aarau', person: 'T. Kern', email: 'offerte@baukern.ch', telefon: '062 222 22 22' },
    { id: 'k4', firma: 'Tiefbau Zentral AG', kategorie: 'Tiefbau', ort: 'Emmen', person: 'A. Lustenberger', email: 'info@tiefbau-zentral.ch', telefon: '041 333 33 33' },
    { id: 'k5', firma: 'Elektro Meyer AG', kategorie: 'Elektro', ort: 'Luzern', person: 'D. Meyer', email: 'info@elektro-meyer.ch', telefon: '041 444 44 44' },
    { id: 'k6', firma: 'Volt & Co.', kategorie: 'Elektro', ort: 'Zug', person: 'J. Voltz', email: 'mail@voltco.ch', telefon: '041 555 55 55' },
    { id: 'k7', firma: 'Fensterwerk AG', kategorie: 'Fenster', ort: 'Sursee', person: 'B. Glaser', email: 'info@fensterwerk.ch', telefon: '041 666 66 66' },
    { id: 'k8', firma: 'Fassaden Profi AG', kategorie: 'Fassade', ort: 'Zürich', person: 'M. Profi', email: 'kontakt@fassaden-profi.ch', telefon: '044 777 77 77' },
    { id: 'k9', firma: 'Farbwerk Maler AG', kategorie: 'Maler', ort: 'Luzern', person: 'C. Farb', email: 'info@farbwerk.ch', telefon: '041 888 88 88' },
    { id: 'k10', firma: 'Bodenhaus AG', kategorie: 'Bodenbeläge', ort: 'Cham', person: 'S. Boden', email: 'info@bodenhaus.ch', telefon: '041 999 99 99' },
    { id: 'k11', firma: 'Sanitär Wyss AG', kategorie: 'Sanitär', ort: 'Luzern', person: 'H. Wyss', email: 'info@sanitaer-wyss.ch', telefon: '041 121 21 21' },
    { id: 'k12', firma: 'WärmeTech GmbH', kategorie: 'Heizung', ort: 'Zug', person: 'L. Thermo', email: 'info@waermetech.ch', telefon: '041 131 31 31' },
    { id: 'k13', firma: 'Klima Nord AG', kategorie: 'Lüftung', ort: 'Emmen', person: 'F. Luft', email: 'info@klima-nord.ch', telefon: '041 141 41 41' },
    { id: 'k14', firma: 'Holzwerk Seebli AG', kategorie: 'Schreiner', ort: 'Küsnacht', person: 'U. Holz', email: 'info@holzwerk-seebli.ch', telefon: '044 151 51 51' },
  ];
  const mailOf = f => (kontakte.find(k => k.firma === f) || {}).email || '';

  // Eingeladene Unternehmer: [firma, betrag|null, statusOverride?]
  // betrag != null -> 'offeriert', sonst 'angefragt'; 'eingeladen' = Mail noch nicht versendet
  const einl = (...rows) => rows.map(([firma, betrag, st]) => ({
    id: uid('e'), firma, email: mailOf(firma),
    betrag: betrag ?? null,
    status: st || (betrag != null ? 'offeriert' : 'angefragt'),
    datumMail: st === 'eingeladen' ? '' : '2026-04-20',
  }));

  const projekte = [
    {
      id: 'p_sonnen', name: 'Neubau MFH Sonnenhof', ort: 'Luzern', bauherr: 'Sonnenhof Immobilien AG',
      projektleiter: 'M. Bühler', phase: 'vergabe', start: '2026-02-01', ende: '2027-08-30',
      baustart: '2026-03-01', bezug: '2027-07-15',
      finanz: { land: 1350000, honorare: 380000, finanzierung: 120000 },
      wohnungen: 6,
      bauteile: [{ id: 'bt_carport', name: 'Unterstand / Carport (Nebenprojekt)' }],
      optionen: [
        { id: 'op_lift', name: 'Personenlift (optional)', bauteilId: '', gruppe: '', vertragsAbzug: null },
        { id: 'op_pv', name: 'PV-Anlage auf Carport (optional)', bauteilId: 'bt_carport', gruppe: '', vertragsAbzug: null },
      ],
      auflagen: [
        { id: uid('au'), titel: 'Baubeginn melden (Baustartanzeige an Gemeinde)', kat: 'Meldung', phase: 'vor Baubeginn', termin: '2026-02-20', zustaendig: 'Bauleitung', status: 'erledigt', bemerkung: 'Ziffer 1 der Bewilligung' },
        { id: uid('au'), titel: 'Schnurgerüst / Gebäudeprofil abstecken (Geometer)', kat: 'Abnahme', phase: 'vor Baubeginn', termin: '2026-02-25', zustaendig: 'Geometer Müller', status: 'erledigt', bemerkung: '' },
        { id: uid('au'), titel: 'Energie-/Wärmedämmnachweis einreichen', kat: 'Nachweis', phase: 'vor Baubeginn', termin: '2026-02-28', zustaendig: 'Bauphysik', status: 'eingereicht', bemerkung: 'GEAK + Wärmedämmnachweis' },
        { id: uid('au'), titel: 'Asbest-/Schadstoffabklärung Bestand', kat: 'Schadstoffe', phase: 'vor Baubeginn', termin: '', zustaendig: 'Schadstoff-Gutachter', status: 'offen', bemerkung: 'Auflage Ziffer 7 – vor Rückbau' },
        { id: uid('au'), titel: 'Brandschutzabnahme (Feuerpolizei)', kat: 'Abnahme', phase: 'vor Bezug', termin: '2027-06-30', zustaendig: 'Feuerpolizei', status: 'offen', bemerkung: '' },
        { id: uid('au'), titel: 'Schlussabnahme / Bezugsbewilligung', kat: 'Abnahme', phase: 'vor Bezug', termin: '2027-07-10', zustaendig: 'Gemeinde Bauamt', status: 'offen', bemerkung: '' },
      ],
      geschosseListe: [
        { id: 'g_eg', name: 'Erdgeschoss', typ: 'Wohnen', einheiten: [
          { id: 'u_egl', name: 'EG links', zimmer: 3.5, m2: 70, miete: 1950, verkauf: 720000 },
          { id: 'u_egr', name: 'EG rechts', zimmer: 4.5, m2: 80, miete: 2250, verkauf: 850000 },
        ] },
        { id: 'g_og1', name: '1. Obergeschoss', typ: 'Wohnen', einheiten: [
          { id: 'u_1ogl', name: '1.OG links', zimmer: 3.5, m2: 72, miete: 2050, verkauf: 760000 },
          { id: 'u_1ogr', name: '1.OG rechts', zimmer: 4.5, m2: 82, miete: 2350, verkauf: 880000 },
        ] },
        { id: 'g_og2', name: '2. OG / Attika', typ: 'Wohnen', einheiten: [
          { id: 'u_2ogl', name: '2.OG links', zimmer: 3.5, m2: 74, miete: 2150, verkauf: 790000 },
          { id: 'u_att', name: 'Attika', zimmer: 5.5, m2: 130, miete: 3600, verkauf: 1450000 },
        ] },
      ],
      entscheidungen: [
        { id: uid('en'), datum: '2026-05-10', bereich: 'Bemusterung', thema: 'Plättli Bad', bkp: '282', entscheid: 'Feinsteinzeug 60×60 anthrazit', status: 'offen', vid: '', ausstellung: { firma: 'Plättli-Welt', ort: 'Luzern', telefon: '041 200 00 00' }, wohnung: 'u_att' },
        { id: uid('en'), datum: '', bereich: 'Bemusterung', thema: 'Küche', bkp: '258', entscheid: '', status: 'offen', vid: '', ausstellung: null, wohnung: 'u_egr' },
        { id: uid('en'), datum: '', bereich: 'Bemusterung', thema: 'Parkett', bkp: '281', entscheid: '', status: 'offen', vid: '', ausstellung: null, wohnung: 'u_1ogr' },
        { id: uid('en'), datum: '', bereich: 'Allgemein', thema: 'Briefkastenanlage', bkp: '', entscheid: '', status: 'offen', vid: '', ausstellung: null, wohnung: '' },
      ],
      vergaben: [
        { id: 'v1', bkp: '112', gewerk: 'Abbrucharbeiten', status: 'abgeschlossen', firma: 'Demowald Rückbau GmbH', betrag: 84000, schaetzung: 90000, frist: '2026-03-15',
          bauStart: '2026-03-01', bauEnde: '2026-03-25',
          eingeladene: einl(['Demowald Rückbau GmbH', 84000], ['Frei Abbruch AG', 91500]), nachtraege: [], rapporte: [], vorgaenge: [],
          rechnungen: [{ id: uid('rg'), text: 'Schlussrechnung', nr: 'RG-2026-009', art: 'schluss', betrag: 90000, datum: '2026-04-02', bezahlt: true }] },
        { id: 'v2', bkp: '201', gewerk: 'Baugrubenaushub', status: 'ausfuehrung', firma: 'Tiefbau Zentral AG', betrag: 198000, schaetzung: 210000, frist: '2026-05-20',
          bauStart: '2026-04-15', bauEnde: '2026-06-20',
          eingeladene: einl(['Tiefbau Zentral AG', 198000], ['ErdWerk GmbH', 205000], ['Aushub Plus AG', 221000]),
          nachtraege: [{ id: uid('n'), titel: 'Mehraushub Fels', nr: 'NT-01', betrag: 24000, datum: '2026-05-10', status: 'genehmigt' }],
          rapporte: [{ id: uid('r'), titel: 'Regie Hangsicherung KW 19', stunden: 36, betrag: 5400, datum: '2026-05-08' }], vorgaenge: [],
          rechnungen: [
            { id: uid('rg'), text: 'Akontorechnung 1', nr: 'RG-2026-014', betrag: 120000, datum: '2026-05-15', bezahlt: true },
            { id: uid('rg'), text: 'Akontorechnung 2', nr: 'RG-2026-031', betrag: 80000, datum: '2026-06-01', bezahlt: false },
          ] },
        { id: 'v3', bkp: '211', gewerk: 'Baumeisterarbeiten', status: 'werkvertrag', firma: 'Hugentobler Bau AG', betrag: 1450000, schaetzung: 1500000, frist: '2026-06-10',
          bauStart: '2026-06-22', bauEnde: '2026-12-20',
          eingeladene: einl(['Hugentobler Bau AG', 1450000], ['Steiner & Co.', 1495000], ['BauKern AG', 1560000]),
          nachtraege: [{ id: uid('n'), titel: 'Zusätzliche Bodenplatte Velokeller', nr: 'NT-01', betrag: 38000, datum: '2026-06-01', status: 'offen' }],
          rapporte: [],
          rechnungen: [
            { id: uid('rg'), text: 'Akontorechnung 1', nr: 'RG-2026-040', betrag: 600000, datum: '2026-08-10', bezahlt: true },
            { id: uid('rg'), text: 'Akontorechnung 2', nr: 'RG-2026-061', betrag: 400000, datum: '2026-10-05', bezahlt: false },
          ],
          vorgaenge: [
            { id: uid('o'), titel: 'Fundament & Bodenplatte', start: '2026-06-22', ende: '2026-07-31' },
            { id: uid('o'), titel: 'Rohbau EG–2.OG', start: '2026-08-03', ende: '2026-10-30' },
            { id: uid('o'), titel: 'Rohbau Attika & Dach', start: '2026-11-02', ende: '2026-12-20' },
          ] },
        { id: 'v4', bkp: '221', gewerk: 'Fenster & Aussentüren', status: 'bewertung', firma: '', betrag: 0, schaetzung: 320000, frist: '2026-06-08',
          bauStart: '2026-10-01', bauEnde: '2026-11-30', bestellfrist: 70,
          eingeladene: [
            { id: uid('e'), firma: 'Fensterwerk AG', email: mailOf('Fensterwerk AG'), status: 'offeriert', betrag: null,
              offerte: { brutto: 312000, rabatt: 3, skonto: 2, weitereAbz: 1 }, abgebot: { brutto: 305000, rabatt: 5, skonto: 2, weitereAbz: 1 } },
            { id: uid('e'), firma: 'Glas+Rahmen GmbH', email: '', status: 'offeriert', betrag: null,
              offerte: { brutto: 320000, rabatt: 2, skonto: 2, weitereAbz: 1 }, abgebot: { brutto: 314000, rabatt: 4, skonto: 2, weitereAbz: 1 } },
            { id: uid('e'), firma: 'Holz-Metall Fenster AG', email: '', status: 'offeriert', betrag: null,
              offerte: { brutto: 308000, rabatt: 1, skonto: 2, weitereAbz: 1 } },
          ], nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'v5', bkp: '230', gewerk: 'Elektroanlagen', status: 'offerten', firma: '', betrag: 0, schaetzung: 280000, frist: '2026-06-22',
          bauStart: '2026-09-01', bauEnde: '2027-02-28',
          eingeladene: einl(['Elektro Meyer AG', 271000], ['Volt & Co.', 289000], ['Stromwerk AG', null]), nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'v6', bkp: '250', gewerk: 'Sanitäranlagen', status: 'ausschreibung', firma: '', betrag: 0, schaetzung: 240000, frist: '2026-07-01',
          bauStart: '2026-11-01', bauEnde: '2027-03-31',
          eingeladene: einl(['Sanitär Wyss AG', null, 'eingeladen'], ['Aqua Plus GmbH', null, 'eingeladen'], ['Rohr & Co.', null, 'eingeladen']), nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'v7', bkp: '252', gewerk: 'Heizungsanlagen', status: 'ausschreibung', firma: '', betrag: 0, schaetzung: 195000, frist: '2026-07-05',
          bauStart: '2026-11-01', bauEnde: '2027-02-28',
          eingeladene: einl(['WärmeTech GmbH', null], ['Heiztech AG', null]), nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'v8', bkp: '224', gewerk: 'Spenglerarbeiten / Bedachung', status: 'vergeben', firma: 'Dach & Blech AG', betrag: 165000, schaetzung: 175000, frist: '2026-07-15',
          bauStart: '2026-12-01', bauEnde: '2027-02-15', bestellfrist: 25,
          eingeladene: einl(['Dach & Blech AG', 165000], ['Spengler Meier GmbH', 172000]), nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'v9', bkp: '271', gewerk: 'Gipser- / Verputzarbeiten', status: 'vergeben', firma: 'Gipsotech AG', betrag: 142000, schaetzung: 150000, frist: '2026-07-20',
          bauStart: '2027-01-05', bauEnde: '2027-04-30',
          eingeladene: einl(['Gipsotech AG', 142000], ['Verputz Profi GmbH', 149000]),
          nachtraege: [{ id: uid('n'), titel: 'Zusätzliche Glättung Treppenhaus', nr: 'NT-01', betrag: 6500, datum: '2027-02-10', status: 'genehmigt' }], rapporte: [], vorgaenge: [],
          rechnungen: [{ id: uid('rg'), text: 'Akontorechnung 1', nr: 'RG-2027-004', betrag: 70000, datum: '2027-02-20', bezahlt: true }] },
        { id: 'v15', bkp: '285', gewerk: 'Malerarbeiten', status: 'vergeben', firma: 'Farbwerk Maler AG', betrag: 98000, schaetzung: 105000, frist: '2026-07-22',
          bauStart: '2027-03-01', bauEnde: '2027-05-31',
          eingeladene: einl(['Farbwerk Maler AG', 98000], ['Pinsel & Co.', 104000]), nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'v16', bkp: '281', gewerk: 'Bodenbeläge (Parkett)', status: 'bewertung', firma: '', betrag: 0, schaetzung: 168000, frist: '2026-07-25',
          bauStart: '2027-03-15', bauEnde: '2027-05-31',
          eingeladene: einl(['Bodenhaus AG', 162000], ['Parkett Plus GmbH', 171000]), nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'v17', bkp: '273', gewerk: 'Schreinerarbeiten / Küchen', status: 'offerten', firma: '', betrag: 0, schaetzung: 240000, frist: '2026-07-30',
          bauStart: '2027-02-01', bauEnde: '2027-05-15',
          eingeladene: einl(['Holzwerk Seebli AG', 232000], ['Küchen & Co.', null]), nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'v18', bkp: '244', gewerk: 'Lüftungsanlagen', status: 'ausschreibung', firma: '', betrag: 0, schaetzung: 185000, frist: '2026-08-05',
          bauStart: '2026-12-01', bauEnde: '2027-04-30',
          eingeladene: einl(['Klima Nord AG', null, 'eingeladen']), nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'v19', bkp: '258', gewerk: 'Küchengeräte / Apparate', status: 'ausschreibung', firma: '', betrag: 0, schaetzung: 90000, frist: '2026-08-10',
          bauStart: '2027-04-01', bauEnde: '2027-05-31',
          eingeladene: einl(['Elektro Meyer AG', null, 'eingeladen']), nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'vc1', bkp: '211', gewerk: 'Unterstand / Carport – Baumeister', status: 'ausschreibung', firma: '', betrag: 0, schaetzung: 78000, frist: '2026-08-15',
          bauStart: '2027-04-01', bauEnde: '2027-05-31', bauteil: 'bt_carport',
          eingeladene: einl(['Hugentobler Bau AG', null, 'eingeladen'], ['Steiner & Co.', null, 'eingeladen']), nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'vc2', bkp: '230', gewerk: 'PV-Anlage Carport', status: 'ausschreibung', firma: '', betrag: 0, schaetzung: 18000, frist: '2026-08-20',
          bauStart: '2027-05-01', bauEnde: '2027-05-31', bauteil: 'bt_carport', option: 'op_pv',
          eingeladene: einl(['Elektro Meyer AG', null, 'eingeladen']), nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'vc3', bkp: '261', gewerk: 'Personenlift (Option)', status: 'ausschreibung', firma: '', betrag: 0, schaetzung: 62000, frist: '2026-08-25',
          bauStart: '2027-01-15', bauEnde: '2027-03-31', option: 'op_lift',
          eingeladene: einl(['Lift & Co. AG', null, 'eingeladen']), nachtraege: [], rapporte: [], vorgaenge: [] },
      ],
      ganttLinks: [
        { id: uid('gl'), from: 'v1', to: 'v2', dx: null },
        { id: uid('gl'), from: 'v2', to: 'v3', dx: null },
        { id: uid('gl'), from: 'v3', to: 'v4', dx: -28 },
      ],
      pendenzen: [
        { id: uid('pd'), art: 'pendenz', text: 'Werkpläne Bodenplatte zur Freigabe einreichen', verantwortlich: 'Bauleitung', termin: '2026-06-18', erledigt: false, uebertragen: false, erfasst: '2026-06-01', firmen: ['Hugentobler Bau AG'] },
        { id: uid('pd'), art: 'pendenz', text: 'Nachtrag Mehraushub Fels abrechnen', verantwortlich: 'Tiefbau Zentral AG', termin: '2026-06-25', erledigt: false, uebertragen: false, erfasst: '2026-06-05', firmen: ['Tiefbau Zentral AG'] },
        { id: uid('pd'), art: 'pendenz', text: 'Bemusterung Fenster mit Bauherrschaft', verantwortlich: 'M. Bühler', termin: '2026-06-30', erledigt: false, uebertragen: false, erfasst: '2026-06-08', firmen: [] },
      ],
      dossier: {
        projektbeschrieb: { status: 'vorhanden', verweis: 'Projektbeschrieb_Sonnenhof.pdf', datum: '2026-02-05', notiz: '' },
        baubewilligung: { status: 'vorhanden', verweis: 'Baubewilligung_2026-014.pdf', datum: '2026-03-20', notiz: '' },
        grundbuch: { status: 'inArbeit', verweis: '', datum: '', notiz: 'beim Notariat angefordert' },
        statik: { status: 'vorhanden', verweis: 'https://example.ch/statik-sonnenhof', datum: '2026-04-10', notiz: '' },
        finanzierung: { status: 'abgegeben', verweis: 'Finanzierungsnachweis_Bank.pdf', datum: '2026-02-20', notiz: '' },
      },
    },
    {
      id: 'p_schule', name: 'Sanierung Schulhaus Birch', ort: 'Zug', bauherr: 'Stadt Zug, Hochbauamt',
      projektleiter: 'S. Frei', phase: 'ausfuehrung', start: '2025-09-01', ende: '2026-12-15',
      vergaben: [
        { id: 'v10', bkp: '211', gewerk: 'Baumeisterarbeiten', status: 'abgeschlossen', firma: 'Steiner & Co.', betrag: 620000, schaetzung: 640000, frist: '2025-10-01',
          bauStart: '2025-10-15', bauEnde: '2026-02-28',
          eingeladene: einl(['Steiner & Co.', 620000], ['Hugentobler Bau AG', 651000]),
          nachtraege: [{ id: uid('n'), titel: 'Asbestsanierung Sockel', nr: 'NT-01', betrag: 42000, datum: '2025-11-20', status: 'genehmigt' }],
          rapporte: [{ id: uid('r'), titel: 'Regie Winterschutz', stunden: 24, betrag: 3600, datum: '2026-01-15' }], vorgaenge: [] },
        { id: 'v11', bkp: '226', gewerk: 'Fassade & Aussenwärmedämmung', status: 'ausfuehrung', firma: 'Fassaden Profi AG', betrag: 410000, schaetzung: 400000, frist: '2026-06-30',
          bauStart: '2026-03-15', bauEnde: '2026-08-31',
          eingeladene: einl(['Fassaden Profi AG', 410000], ['IsolierBau GmbH', 428000]),
          nachtraege: [{ id: uid('n'), titel: 'Ersatz morsche Holzfenster-Stürze', nr: 'NT-01', betrag: 18500, datum: '2026-05-22', status: 'offen' }],
          rapporte: [{ id: uid('r'), titel: 'Regie Gerüst-Umbau', stunden: 18, betrag: 2700, datum: '2026-05-18' }], vorgaenge: [] },
        { id: 'v12', bkp: '230', gewerk: 'Elektroanlagen', status: 'unterzeichnet', firma: 'Volt & Co.', betrag: 188000, schaetzung: 200000, frist: '2026-06-12',
          bauStart: '2026-06-01', bauEnde: '2026-10-31',
          eingeladene: einl(['Volt & Co.', 188000], ['Elektro Meyer AG', 199000]), nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'v13', bkp: '285', gewerk: 'Malerarbeiten', status: 'vergeben', firma: 'Farbwerk Maler AG', betrag: 96000, schaetzung: 100000, frist: '2026-06-18',
          bauStart: '2026-09-01', bauEnde: '2026-11-30',
          eingeladene: einl(['Farbwerk Maler AG', 96000], ['Pinsel & Co.', 103000]), nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'v14', bkp: '281', gewerk: 'Bodenbeläge', status: 'bewertung', firma: '', betrag: 0, schaetzung: 130000, frist: '2026-06-06',
          bauStart: '2026-09-15', bauEnde: '2026-11-15',
          eingeladene: einl(['Bodenhaus AG', 121000], ['Parkett Plus GmbH', 134000]), nachtraege: [], rapporte: [], vorgaenge: [] },
      ],
      protokolle: [
        { id: 'pr1', typ: 'sitzung', nr: 4, titel: '', datum: '2026-05-26', zeit: '09:00–10:30', ort: 'Baubüro Schulhaus Birch', leitung: 'S. Frei',
          teilnehmer: ['S. Frei (Bauleitung)', 'R. Steiner (Baumeister)', 'M. Profi (Fassade)', 'Bauherr-Vertretung'],
          abwesende: ['D. Meyer (Elektro, entschuldigt)'], verteiler: ['alle Anwesenden', 'Architekt', 'Bauherrschaft'],
          naechste: '2026-06-02',
          traktanden: [
            { id: 't1', nr: 1, titel: 'Pendenzen letzte Sitzung', eintraege: [
              { id: 'it1', art: 'pendenz', erledigt: true, text: 'Asbestsanierung Sockel abgeschlossen und freigegeben.', verantwortlich: 'R. Steiner', termin: '2026-05-20' },
            ] },
            { id: 't2', nr: 2, titel: 'Stand Fassade', eintraege: [
              { id: 'it2', art: 'info', erledigt: false, text: 'Gerüst steht, Wärmedämmung EG–2.OG montiert. Termin im Soll.', verantwortlich: '', termin: '' },
              { id: 'it3', art: 'pendenz', erledigt: false, text: 'Nachtrag morsche Fenster-Stürze geprüft – Freigabe Bauherr einholen.', verantwortlich: 'S. Frei', termin: '2026-06-02' },
            ] },
            { id: 't3', nr: 3, titel: 'Termine / nächste Schritte', eintraege: [
              { id: 'it4', art: 'pendenz', erledigt: false, text: 'Verputzarbeiten starten KW 24 – Materialbestellung auslösen.', verantwortlich: 'M. Profi', termin: '2026-06-08' },
            ] },
          ] },
        { id: 'pr2', typ: 'aktennotiz', nr: 1, titel: 'Absprache Farbkonzept Fassade', datum: '2026-05-29', zeit: '', ort: 'Telefon', leitung: 'S. Frei',
          teilnehmer: ['S. Frei', 'M. Profi'], abwesende: [], verteiler: ['Architekt'], naechste: '',
          traktanden: [
            { id: 't4', nr: 1, titel: 'Farbton', eintraege: [
              { id: 'it5', art: 'pendenz', erledigt: true, text: 'Farbton NCS S 2005-Y20R bemustert und freigegeben.', verantwortlich: 'M. Profi', termin: '2026-06-05' },
              { id: 'it6', art: 'pendenz', erledigt: false, text: 'Musterfläche 1 m² an Fassade Nord erstellen zur Bauherr-Freigabe.', verantwortlich: 'M. Profi', termin: '2026-06-10' },
            ] },
          ] },
      ],
    },
    {
      id: 'p_gewerbe', name: 'Gewerbehaus Industrie Nord', ort: 'Emmen', bauherr: 'NordInvest AG',
      projektleiter: 'M. Bühler', phase: 'ausschreibung', start: '2026-04-01', ende: '2027-11-30',
      vergaben: [
        { id: 'v20', bkp: '201', gewerk: 'Baugrube & Spezialtiefbau', status: 'vergeben', firma: 'Tiefbau Zentral AG', betrag: 540000, schaetzung: 560000, frist: '2026-06-15',
          bauStart: '2026-06-15', bauEnde: '2026-09-30',
          eingeladene: einl(['Tiefbau Zentral AG', 540000], ['ErdWerk GmbH', 558000], ['Aushub Plus AG', 572000]), nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'v21', bkp: '211', gewerk: 'Baumeisterarbeiten', status: 'offerten', firma: '', betrag: 0, schaetzung: 2200000, frist: '2026-06-28',
          bauStart: '2026-09-01', bauEnde: '2027-06-30',
          eingeladene: einl(['Hugentobler Bau AG', 2150000], ['BauKern AG', 2240000], ['Steiner & Co.', null]), nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'v22', bkp: '244', gewerk: 'Lüftungsanlagen', status: 'ausschreibung', firma: '', betrag: 0, schaetzung: 380000, frist: '2026-07-10',
          bauStart: '2027-01-01', bauEnde: '2027-06-30',
          eingeladene: einl(['Klima Nord AG', null]), nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'v23', bkp: '230', gewerk: 'Elektroanlagen', status: 'ausschreibung', firma: '', betrag: 0, schaetzung: 450000, frist: '2026-07-12',
          bauStart: '2027-02-01', bauEnde: '2027-08-31',
          eingeladene: einl(['Elektro Meyer AG', null, 'eingeladen'], ['Volt & Co.', null, 'eingeladen']), nachtraege: [], rapporte: [], vorgaenge: [] },
      ],
    },
    {
      id: 'p_villa', name: 'Umbau Villa Seeblick', ort: 'Küsnacht', bauherr: 'Privat (Fam. R.)',
      projektleiter: 'S. Frei', phase: 'planung', start: '2026-07-01', ende: '2027-04-30',
      vergaben: [
        { id: 'v30', bkp: '113', gewerk: 'Rückbau Innenausbau', status: 'ausschreibung', firma: '', betrag: 0, schaetzung: 70000, frist: '2026-07-20',
          bauStart: '2026-08-01', bauEnde: '2026-08-31',
          eingeladene: einl(['Demowald Rückbau GmbH', null, 'eingeladen']), nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'v31', bkp: '273', gewerk: 'Schreinerarbeiten', status: 'ausschreibung', firma: '', betrag: 0, schaetzung: 180000, frist: '2026-08-01',
          bauStart: '2026-11-01', bauEnde: '2027-02-28',
          eingeladene: einl(['Holzwerk Seebli AG', null, 'eingeladen']), nachtraege: [], rapporte: [], vorgaenge: [] },
      ],
    },
    {
      id: 'p_park', name: 'Parkhaus Bahnhof West', ort: 'Olten', bauherr: 'SBB Immobilien',
      projektleiter: 'M. Bühler', phase: 'abschluss', start: '2024-05-01', ende: '2026-04-30',
      vergaben: [
        { id: 'v40', bkp: '211', gewerk: 'Baumeisterarbeiten', status: 'abgeschlossen', firma: 'BauKern AG', betrag: 3100000, schaetzung: 3200000, frist: '2024-07-01',
          bauStart: '2024-07-15', bauEnde: '2025-06-30',
          eingeladene: einl(['BauKern AG', 3100000], ['Hugentobler Bau AG', 3250000]),
          nachtraege: [{ id: uid('n'), titel: 'Verstärkung Decke UG2', nr: 'NT-01', betrag: 145000, datum: '2024-12-10', status: 'genehmigt' }],
          rapporte: [{ id: uid('r'), titel: 'Regie Wassereinbruch', stunden: 120, betrag: 18000, datum: '2025-02-20' }], vorgaenge: [],
          rechnungen: [
            { id: uid('rg'), text: 'Schlussrechnung Baumeister', nr: 'RG-3201', betrag: 3263000, datum: '2025-07-15', bezahlt: true },
          ] },
        { id: 'v41', bkp: '230', gewerk: 'Elektroanlagen', status: 'abgeschlossen', firma: 'Elektro Meyer AG', betrag: 420000, schaetzung: 430000, frist: '2025-02-01',
          bauStart: '2025-02-15', bauEnde: '2025-08-31',
          eingeladene: einl(['Elektro Meyer AG', 420000]), nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'v42', bkp: '285', gewerk: 'Markierungen & Malerei', status: 'abgeschlossen', firma: 'Farbwerk Maler AG', betrag: 88000, schaetzung: 90000, frist: '2025-11-01',
          bauStart: '2025-09-01', bauEnde: '2025-12-31',
          eingeladene: einl(['Farbwerk Maler AG', 88000]), nachtraege: [], rapporte: [], vorgaenge: [] },
      ],
    },
  ];

  const dokumente = [
    { id: 'd1', name: 'Werkvertrag Baumeister – Sonnenhof', typ: 'Werkvertrag', projektId: 'p_sonnen', datum: '2026-05-28' },
    { id: 'd2', name: 'Offertvergleich Fenster – Sonnenhof', typ: 'Vergleich', projektId: 'p_sonnen', datum: '2026-05-30' },
    { id: 'd3', name: 'Zuschlagsschreiben Elektro – Schulhaus Birch', typ: 'Zuschlag', projektId: 'p_schule', datum: '2026-05-15' },
    { id: 'd4', name: 'Ausschreibung Lüftung – Industrie Nord', typ: 'Ausschreibung', projektId: 'p_gewerbe', datum: '2026-05-20' },
    { id: 'd5', name: 'Vorlage Werkvertrag (SIA 118)', typ: 'Vorlage', projektId: null, datum: '2026-01-10' },
  ];

  const buero = {
    firma: 'P. Hefti Bauberatung GmbH', strasse: 'Bernstrasse 40', plzort: '3076 Worb',
    tel: '031 839 00 77', email: 'info@heftibb.ch', logo: '',
    signatur: 'Freundliche Grüsse\nP. Hefti Bauberatung GmbH\nBernstrasse 40, 3076 Worb\nTel. 031 839 00 77', signaturAuto: true,
  };
  return { projekte, kontakte, dokumente, buero };
}
