/* ============================================================
   SubmitOne – Submissionsverwaltung · Prototyp
   Vanilla JS · Hash-Router · localStorage
   ============================================================ */

'use strict';

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
  { key: 'ausschreibung', label: 'Ausschreibung',         kurz: 'Ausschreibung', color: 'blue'   },
  { key: 'offerten',      label: 'Offerten eingegangen',  kurz: 'Offerten',      color: 'blue'   },
  { key: 'bewertung',     label: 'In Bewertung',          kurz: 'Bewertung',     color: 'amber'  },
  { key: 'vergeben',      label: 'Zuschlag erteilt',      kurz: 'Vergeben',      color: 'purple' },
  { key: 'werkvertrag',   label: 'Werkvertrag erstellt',  kurz: 'Werkvertrag',   color: 'purple' },
  { key: 'unterzeichnet', label: 'Vertrag unterzeichnet', kurz: 'Unterzeichnet', color: 'teal'   },
  { key: 'ausfuehrung',   label: 'In Ausführung',         kurz: 'Ausführung',    color: 'teal'   },
  { key: 'abgeschlossen', label: 'Abgeschlossen',         kurz: 'Abgeschlossen', color: 'green'  },
];

const STATUS_BY_KEY = Object.fromEntries(VERGABE_STATUS.map((s, i) => [s.key, { ...s, index: i }]));
const PHASE_INDEX   = Object.fromEntries(PHASEN.map((p, i) => [p.key, i]));

/* ---------------------------------------------------------------
   2) State + Persistenz
   --------------------------------------------------------------- */

let state = { projekte: [], kontakte: [], dokumente: [] };

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
function save() { db.commit(); }

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
    for (const p of s.projekte) { seen.add(p.id); if (changed(p.id, p)) ups.push({ id: p.id, typ: 'projekt', data: p, updated_by: CLIENT_ID }); }
    if (changed('kontakte', s.kontakte)) ups.push({ id: 'kontakte', typ: 'kontakte', data: s.kontakte, updated_by: CLIENT_ID });
    if (changed('dokumente', s.dokumente)) ups.push({ id: 'dokumente', typ: 'dokumente', data: s.dokumente, updated_by: CLIENT_ID });
    const del = [];
    for (const id of this._snap.keys()) { if (id !== 'kontakte' && id !== 'dokumente' && !seen.has(id)) del.push(id); }
    try {
      if (ups.length) { const { error } = await supa.from('entities').upsert(ups); if (error) throw error; }
      for (const id of del) { await supa.from('entities').delete().eq('id', id); this._snap.delete(id); }
    } catch (e) { console.warn('Cloud-Speichern fehlgeschlagen:', e); toast('Speichern fehlgeschlagen – offline?', 'info'); }
  },
};

function subscribeCloud() {
  supa.channel('entities-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entities' }, payload => {
      const ev = payload.eventType;
      if (ev === 'DELETE') {
        const id = payload.old.id;
        state.projekte = state.projekte.filter(p => p.id !== id);
        CloudAdapter._snap.delete(id);
        router();
        return;
      }
      const row = payload.new;
      if (!row) return;
      CloudAdapter._snap.set(row.id, JSON.stringify(row.data));
      if (row.updated_by === CLIENT_ID) return;   // eigener Schreibvorgang → kein Re-Render
      if (row.typ === 'projekt') {
        const i = state.projekte.findIndex(p => p.id === row.id);
        if (i >= 0) state.projekte[i] = row.data; else state.projekte.push(row.data);
      } else if (row.typ === 'kontakte') state.kontakte = row.data || [];
      else if (row.typ === 'dokumente') state.dokumente = row.data || [];
      migrate();
      router();
    })
    .subscribe();
}

/* ---- Login-Maske (nur Cloud-Modus) ---- */

// Vor-/Nachname → stabile interne Zugangsdaten (Supabase Auth arbeitet mit E-Mail+Passwort)
function nameCreds(vor, nach) {
  const slug = (vor + '.' + nach).trim().toLowerCase().replace(/[^a-z0-9.]+/g, '');
  return { slug, email: slug + '@submitone.local', password: 'so_' + slug + '_pw' };
}

function renderLogin(msg) {
  if ($('#loginOverlay')) $('#loginOverlay').remove();
  document.body.insertAdjacentHTML('beforeend', `
    <div id="loginOverlay" class="login-overlay">
      <div class="login-card">
        <div class="brand-logo" style="margin:0 auto 14px;width:46px;height:46px">S1</div>
        <h2 style="margin:0 0 4px">SubmitOne</h2>
        <p class="muted" style="margin:0 0 18px;font-size:13px">Mit Vor- und Nachname anmelden</p>
        <label class="field">Vorname <input class="input" id="lg_vor" type="text" autocapitalize="words" spellcheck="false"></label>
        <label class="field" style="margin-top:10px">Nachname <input class="input" id="lg_nach" type="text" autocapitalize="words" spellcheck="false"></label>
        <div id="lg_msg" style="min-height:18px;font-size:12.5px;color:var(--s-red);margin:8px 0">${msg ? esc(msg) : ''}</div>
        <button class="btn" id="lg_in" style="width:100%">Anmelden</button>
        <div class="muted" style="font-size:12px;margin:14px 0 6px">Noch kein Konto?</div>
        <button class="btn secondary" id="lg_up" style="width:100%">Neues Konto erstellen</button>
      </div>
    </div>`);
  const vor = () => $('#lg_vor').value.trim();
  const nach = () => $('#lg_nach').value.trim();
  const setMsg = (m, ok) => { const el = $('#lg_msg'); el.textContent = m; el.style.color = ok ? 'var(--s-green)' : 'var(--s-red)'; };
  const ok = () => { if (!vor() || !nach()) { setMsg('Bitte Vor- und Nachname eingeben'); return false; } return true; };

  // Anmelden: NUR einloggen, niemals ein Konto anlegen
  $('#lg_in').onclick = async () => {
    if (!ok()) return;
    const { email, password } = nameCreds(vor(), nach());
    setMsg('Anmelden…', true);
    const { error } = await supa.auth.signInWithPassword({ email, password });
    if (error) { setMsg('Kein Konto mit diesem Namen gefunden. Tippfehler? Sonst unten „Neues Konto erstellen".'); return; }
    $('#loginOverlay').remove(); startApp();
  };

  // Konto nur auf ausdrücklichen Klick anlegen
  $('#lg_up').onclick = async () => {
    if (!ok()) return;
    const { email, password } = nameCreds(vor(), nach());
    setMsg('Konto wird erstellt…', true);
    const r = await supa.auth.signUp({ email, password, options: { data: { vorname: vor(), nachname: nach() } } });
    if (r.error) {
      setMsg(/registered|exist/i.test(r.error.message) ? 'Konto existiert bereits – bitte oben „Anmelden".' : r.error.message);
      return;
    }
    if (r.data.session) { $('#loginOverlay').remove(); startApp(); }
    else setMsg('In Supabase „Confirm email" ausschalten, dann „Anmelden".');
  };

  $('#lg_nach').addEventListener('keydown', e => { if (e.key === 'Enter') $('#lg_in').click(); });
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
    const { data } = await supa.auth.getSession();
    if (!data.session) { renderLogin(); return; }
  }
  await startApp();
}

async function startApp() {
  await db.init();
  $('#btnExport')?.addEventListener('click', exportData);
  $('#btnReset')?.addEventListener('click', resetDemo);
  window.addEventListener('hashchange', router);
  router();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (cloudEnabled) subscribeCloud();
}

// Migriert ältere Datenstände auf das aktuelle Modell (offerten[] -> eingeladene[])
function migrate() {
  let changed = false;
  for (const p of state.projekte) {
    if (!p.protokolle) { p.protokolle = []; changed = true; }
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
      if (v.bauStart === undefined) { v.bauStart = ''; changed = true; }
      if (v.bauEnde  === undefined) { v.bauEnde  = ''; changed = true; }
    }
  }
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
function offertenOf(v)  { return (v.eingeladene || []).filter(e => e.status === 'offeriert' && e.betrag != null); }
function bestBetrag(v)  { const o = offertenOf(v); return o.length ? Math.min(...o.map(x => x.betrag)) : null; }
function nachtragSumme(v){ return (v.nachtraege || []).filter(n => n.status === 'genehmigt').reduce((a, n) => a + (n.betrag || 0), 0); }
function nachtragOffen(v){ return (v.nachtraege || []).filter(n => n.status === 'offen').reduce((a, n) => a + (n.betrag || 0), 0); }
function rapportSumme(v) { return (v.rapporte || []).reduce((a, r) => a + (r.betrag || 0), 0); }
function schlussSumme(v) { return (v.betrag || 0) + nachtragSumme(v) + rapportSumme(v); }

/* --- Rechnungen / Kostenkontrolle --- */
function rechnungBezahlt(v) { return (v.rechnungen || []).filter(r => r.bezahlt).reduce((a, r) => a + (r.betrag || 0), 0); }
function rechnungTotal(v)   { return (v.rechnungen || []).reduce((a, r) => a + (r.betrag || 0), 0); }
function kvRev(v)           { return bestBetrag(v); }                 // günstigste Offerte (revidierter KV)

// Eine Kostenzeile einer Vergabe (analog Baukostenübersicht)
function kostenZeile(v) {
  const kv = v.schaetzung || 0;
  const rev = kvRev(v);                                              // kann null sein
  const wv = isVergeben(v) ? (v.betrag || 0) : 0;
  const nt = nachtragSumme(v);
  const rap = rapportSumme(v);
  // Abrechnungsprognose: vergeben → WV + Nachträge + Rapporte; sonst beste bekannte Schätzung
  const prognose = isVergeben(v) ? (wv + nt + rap) : (rev != null ? rev : kv);
  const bezahlt = rechnungBezahlt(v);
  const fakturiert = rechnungTotal(v);
  const offen = prognose - bezahlt;
  return { kv, rev, wv, nt, rap, prognose, bezahlt, fakturiert, offen, vergeben: isVergeben(v) };
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

/* --- Phasen aus Vergaben-Status ableiten --- */
const PHASE_COLOR = { planung: 'var(--s-grey)', ausschreibung: 'var(--brand)', vergabe: 'var(--s-purple)', ausfuehrung: 'var(--s-teal)', abschluss: 'var(--s-green)' };

function statusToPhase(status) {
  if (status === 'abgeschlossen') return 'abschluss';
  if (status === 'ausfuehrung') return 'ausfuehrung';
  if (STATUS_BY_KEY[status].index >= STATUS_BY_KEY['vergeben'].index) return 'vergabe';
  return 'ausschreibung';
}

function phasenVerteilung(p) {
  const counts = { planung: 0, ausschreibung: 0, vergabe: 0, ausfuehrung: 0, abschluss: 0 };
  const vs = p.vergaben || [];
  if (!vs.length) { counts.planung = 1; return { counts, total: 1, empty: true }; }
  vs.forEach(v => counts[statusToPhase(v.status)]++);
  return { counts, total: vs.length, empty: false };
}

function dominantPhase(p) {
  const { counts, empty } = phasenVerteilung(p);
  if (empty) return 'planung';
  let best = 'ausschreibung', bestC = -1;
  PHASEN.forEach(ph => { if (counts[ph.key] > bestC) { bestC = counts[ph.key]; best = ph.key; } });
  return best;
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
  const tab = (key, href, label) => `<a class="ptab ${active === key ? 'active' : ''}" href="${href}">${label}</a>`;
  return `<div class="ptabs">
    ${tab('overview', `#/projekt/${p.id}`, 'Übersicht')}
    ${tab('kosten', `#/projekt/${p.id}/kosten`, 'Kosten')}
    ${tab('termine', `#/projekt/${p.id}/termine`, 'Termine / Gantt')}
    ${tab('protokolle', `#/projekt/${p.id}/protokolle`, 'Protokolle')}
  </div>`;
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
}

function render(html) { $('#view').innerHTML = html; window.scrollTo(0, 0); }

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
      if (sub === 'kosten') return viewKosten(a);
      if (sub === 'protokolle') return viewProtokolle(a);
      if (sub === 'protokoll' && b) return viewProtokollDetail(a, b);
      return viewProjektDetail(a);
    case 'kontakte':      setActiveNav('kontakte');      return viewKontakte();
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
  const projekte = state.projekte;
  const aktive = projekte.filter(p => p.phase !== 'abschluss');
  const alleVergaben = projekte.flatMap(p => (p.vergaben || []).map(v => ({ v, p })));
  const offeneVergaben = alleVergaben.filter(x => !isDone(x.v));
  const fristig = offeneVergaben.filter(x => { const d = daysUntil(x.v.frist); return d != null && d >= 0 && d <= 7; });
  const volumen = projekte.reduce((a, p) => a + projektVolumen(p), 0);

  const kpis = [
    { ico: '▤', cls: 'blue',   label: 'Aktive Projekte',   value: aktive.length, foot: projekte.length + ' total' },
    { ico: '◷', cls: 'amber',  label: 'Offene Vergaben',   value: offeneVergaben.length, foot: alleVergaben.length + ' Vergaben gesamt' },
    { ico: '⚑', cls: 'purple', label: 'Frist ≤ 7 Tage',    value: fristig.length, foot: 'erfordern Aufmerksamkeit' },
    { ico: '◫', cls: 'green',  label: 'Volumen',           value: chfShort(volumen), foot: 'Vergaben + Schätzung' },
  ];

  // Aufgaben/Fristen-Liste (nächste fällige, nicht abgeschlossene)
  const tasks = offeneVergaben
    .filter(x => x.v.frist)
    .sort((x, y) => x.v.frist.localeCompare(y.v.frist))
    .slice(0, 6);

  const html = `
    <div class="page-head">
      <div>
        <h1>Dashboard</h1>
        <div class="sub">Überblick über alle laufenden Submissionen</div>
      </div>
      <button class="btn" data-act="new-projekt">+ Neues Projekt</button>
    </div>

    <div class="kpi-row">
      ${kpis.map(k => `
        <div class="kpi">
          <div class="k-label"><span class="k-ico ${k.cls}">${k.ico}</span>${k.label}</div>
          <div class="k-value">${k.value}</div>
          <div class="k-foot">${k.foot}</div>
        </div>`).join('')}
    </div>

    <div class="section-head">
      <h2>Laufende Projekte</h2>
      <a class="hint" href="#/projekte">Alle anzeigen →</a>
    </div>
    <div class="proj-grid">
      ${aktive.length ? aktive.map(projektCard).join('') : emptyState('▤', 'Keine aktiven Projekte.')}
    </div>

    <div class="section-head" style="margin-top:28px">
      <h2>Nächste Fristen</h2>
      <span class="hint">Vergaben mit anstehendem Termin</span>
    </div>
    <div class="card">
      ${tasks.length ? `
      <table class="grid">
        <thead><tr><th>Projekt</th><th>Gewerk</th><th>Status</th><th>Frist</th><th></th></tr></thead>
        <tbody>
          ${tasks.map(({ v, p }) => `
            <tr class="clickable" data-goto="#/projekt/${p.id}/vergabe/${v.id}">
              <td>${esc(p.name)}</td>
              <td><span class="bkp-code">${esc(v.bkp)}</span> ${esc(v.gewerk)}</td>
              <td>${statusPill(v)}</td>
              <td class="frist ${fristClass(v.frist, isDone(v))}">${fristText(v.frist, isDone(v))}</td>
              <td class="muted">›</td>
            </tr>`).join('')}
        </tbody>
      </table>` : emptyState('✓', 'Keine offenen Fristen.')}
    </div>
  `;
  render(html);
}

function projektCard(p) {
  const pct = projektFortschritt(p);
  const total = (p.vergaben || []).length;
  const vergeben = projektVergebenAnzahl(p);
  const frist = naechsteFrist(p);
  return `
    <div class="proj-card" data-goto="#/projekt/${p.id}">
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
        <div class="pc-stat"><span class="v">${vergeben}/${total}</span><span class="l">vergeben</span></div>
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
  let list = state.projekte;
  if (projektFilter.phase) list = list.filter(p => dominantPhase(p) === projektFilter.phase);
  if (projektFilter.q) {
    const q = projektFilter.q.toLowerCase();
    list = list.filter(p => (p.name + p.ort + p.bauherr).toLowerCase().includes(q));
  }

  const html = `
    <div class="page-head">
      <div><h1>Projekte</h1><div class="sub">${state.projekte.length} Projekte insgesamt</div></div>
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
  const vergaben = (p.vergaben || []).slice().sort((a, b) => a.bkp.localeCompare(b.bkp));

  const html = `
    <div class="breadcrumb"><a href="#/projekte">Projekte</a> › ${esc(p.name)}</div>
    <div class="detail-head">
      <div>
        <h1 style="margin:0;font-size:23px">${esc(p.name)}</h1>
        <div class="sub" style="margin-top:5px">📍 ${esc(p.ort)} · Bauherr: ${esc(p.bauherr)} · Projektleitung: ${esc(p.projektleiter)}</div>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        ${phaseBadge(dominantPhase(p))}
        <button class="btn" data-act="new-vergabe" data-pid="${p.id}">+ Vergabe</button>
      </div>
    </div>

    ${projektTabs(p, 'overview')}

    ${phasenBar(p)}

    <!-- Kennzahlen -->
    <div class="detail-stats">
      <div class="dstat"><div class="l">Fortschritt</div><div class="v">${pct}%</div>${progressBar(pct)}</div>
      <div class="dstat"><div class="l">Vergaben vergeben</div><div class="v">${projektVergebenAnzahl(p)} / ${vergaben.length}</div></div>
      <div class="dstat"><div class="l">Volumen</div><div class="v">${chf(projektVolumen(p))}</div></div>
      <div class="dstat"><div class="l">Termin</div><div class="v" style="font-size:15px">${fmtDate(p.start)} – ${fmtDate(p.ende)}</div></div>
    </div>

    <!-- Vergaben-Tabelle -->
    <div class="section-head"><h2>Vergaben &amp; Gewerke</h2><span class="hint">Klick auf eine Zeile für Details</span></div>
    <div class="card">
      ${vergaben.length ? `
      <table class="grid">
        <thead>
          <tr><th>BKP</th><th>Gewerk</th><th>Unternehmer</th><th>Status</th><th>Fortschritt</th><th class="num">Betrag</th><th>Frist</th></tr>
        </thead>
        <tbody>
          ${vergaben.map(v => `
            <tr class="clickable" data-goto="#/projekt/${p.id}/vergabe/${v.id}">
              <td><span class="bkp-code">${esc(v.bkp)}</span></td>
              <td><strong>${esc(v.gewerk)}</strong></td>
              <td>${v.firma ? `<div class="row-firma">${esc(v.firma)}</div>` : '<span class="muted">noch offen</span>'}</td>
              <td>${statusPill(v)}</td>
              <td>${miniPipe(v)}</td>
              <td class="num">${isVergeben(v) ? chf(v.betrag) : `<span class="muted">~${chfShort(v.schaetzung)}</span>`}</td>
              <td class="frist ${fristClass(v.frist, isDone(v))}">${fristText(v.frist, isDone(v))}</td>
            </tr>`).join('')}
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
    </div>
    ${projektTabs(p, 'kosten')}
  `;
  if (!vs.length) { render(head + emptyState('◫', 'Noch keine Vergaben/Gewerke. Lege im Tab „Übersicht" Gewerke mit Kostenschätzung an.')); return; }

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
      rows += `<tr class="clickable" data-goto="#/projekt/${p.id}/vergabe/${v.id}">
        <td class="bkp-code">${esc(v.bkp)}</td>
        <td><strong>${esc(v.gewerk)}</strong></td>
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
    });
    const dSub = sub.prognose - sub.kv;
    body += `<tr class="kgroup"><td>${esc(g)}</td><td colspan="10">${esc(BKP_GRUPPEN[g] || 'Übrige')}</td></tr>
      ${rows}
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
    </div>
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
    <p class="muted" style="font-size:12.5px;margin-top:10px">KV = Grobkostenschätzung · KV rev. = günstigste Offerte · WV = Werkvertrag/Vergabesumme · Prognose = WV + Nachträge + Rapporte · Δ KV = Prognose gegen Schätzung (rot = Überschreitung). Zeile anklicken → Gewerk-Detail mit Rechnungserfassung.</p>
  `);
}

/* ---------------------------------------------------------------
   10b) View: Termine / Gantt
   --------------------------------------------------------------- */

let ganttZoom = 'monat';   // 'monat' | 'woche' | 'tag'
const ZOOM = { monat: { px: 2.4, label: 'Monate' }, woche: { px: 9, label: 'Wochen' }, tag: { px: 26, label: 'Tage' } };
let ganttCtx = null;       // { rangeStartISO, pxPerDay } – für Drag

function viewTermine(id) {
  const p = findProjekt(id);
  if (!p) { render(emptyState('⚠', 'Projekt nicht gefunden.')); return; }

  // ALLE Vergaben (auch ohne Termin), sortiert nach BKP / Gewerk
  const vs = (p.vergaben || []).slice().sort((a, b) => (a.bkp || '').localeCompare(b.bkp || '') || a.gewerk.localeCompare(b.gewerk));
  const offene = vs.filter(v => !(v.bauStart && v.bauEnde));

  const zoomCtrl = `<div class="g-zoom">
    ${Object.keys(ZOOM).map(z => `<button class="${ganttZoom === z ? 'active' : ''}" data-act="gantt-zoom" data-pid="${p.id}" data-kind="${z}">${ZOOM[z].label}</button>`).join('')}
  </div>`;

  const head = `
    <div class="breadcrumb"><a href="#/projekte">Projekte</a> › ${esc(p.name)}</div>
    <div class="detail-head">
      <div><h1 style="margin:0;font-size:23px">${esc(p.name)}</h1><div class="sub" style="margin-top:5px">Terminprogramm · grob (Monat) bis fein (Tag); Balken ziehen zum Verschieben, Ränder ziehen für Dauer</div></div>
      <div style="display:flex;gap:10px;align-items:center">${offene.length ? `<span class="tag">${offene.length} ohne Termin</span>` : ''}${zoomCtrl}</div>
    </div>
    ${projektTabs(p, 'termine')}
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
    (v.vorgaenge || []).forEach(o => { if (o.start) allDates.push(o.start); if (o.ende) allDates.push(o.ende); });
  });
  if (p.start) allDates.push(p.start);
  if (p.ende) allDates.push(p.ende);

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

  const pxPerDay = ZOOM[ganttZoom].px;
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

  let subCells = '';
  if (ganttZoom === 'woche') {
    let d = new Date(rangeStart);
    while (d <= rangeEnd) {
      const wEnd = new Date(d); wEnd.setDate(d.getDate() + (7 - ((d.getDay() + 6) % 7)) - 1);
      const segEnd = wEnd > rangeEnd ? rangeEnd : wEnd;
      const days = dayDiff(d, segEnd) + 1;
      subCells += `<div class="g-cell" style="width:${days * pxPerDay}px">KW${isoWeek(d)}</div>`;
      d = new Date(segEnd); d.setDate(d.getDate() + 1);
    }
  } else if (ganttZoom === 'tag') {
    let d = new Date(rangeStart);
    while (d <= rangeEnd) {
      const we = (d.getDay() === 0 || d.getDay() === 6);
      subCells += `<div class="g-cell day${we ? ' we' : ''}" style="width:${pxPerDay}px">${d.getDate()}</div>`;
      d.setDate(d.getDate() + 1);
    }
  }
  const headH = subCells ? 56 : 38;

  // Hintergrund-Gitter = Monatsspalten
  const monthBg = months.map(m => `<div class="g-cell" style="width:${m.w}px"></div>`).join('');

  const t = today();
  const todayLeft = (t >= rangeStart && t <= rangeEnd) ? dayDiff(rangeStart, t) * pxPerDay : null;

  let sideRows = '', barRows = '';
  vs.forEach(v => {
    const col = STATUS_BY_KEY[v.status]?.color || 'blue';
    const hatTermin = v.bauStart && v.bauEnde;
    sideRows += `<div class="g-side-row${hatTermin ? '' : ' offen'}">
      <span class="g-edit" data-act="edit-termin" data-pid="${p.id}" data-vid="${v.id}" title="Termine bearbeiten">
        <span class="bkp-code">${esc(v.bkp)}</span> <span class="gewerk">${esc(v.gewerk)}</span>
      </span>
      ${hatTermin ? `<button class="btn sm ghost add-vg" title="Vorgang hinzufügen" data-act="new-vorgang" data-pid="${p.id}" data-vid="${v.id}">＋</button>` : ''}
    </div>`;
    if (hatTermin) {
      barRows += `<div class="g-row"><div class="g-bar ${col}" style="left:${leftPx(v.bauStart)}px;width:${widthPx(v.bauStart, v.bauEnde)}px"
        title="${esc(v.gewerk)}: ${fmtDate(v.bauStart)} – ${fmtDate(v.bauEnde)}"
        data-pid="${p.id}" data-vid="${v.id}" data-start="${v.bauStart}" data-ende="${v.bauEnde}">
        <span class="g-h l"></span><span class="g-lbl">${esc(v.gewerk)}</span><span class="g-h r"></span></div></div>`;
    } else {
      barRows += `<div class="g-row"><button class="g-set" data-act="edit-termin" data-pid="${p.id}" data-vid="${v.id}">＋ Termin setzen</button></div>`;
    }
    (v.vorgaenge || []).filter(o => o.start && o.ende).forEach(o => {
      sideRows += `<div class="g-side-row sub"><span class="gewerk" style="font-weight:500">${esc(o.titel)}</span>
        <button class="x-btn" title="Vorgang löschen" data-act="rm-vorgang" data-pid="${p.id}" data-vid="${v.id}" data-oid="${o.id}">×</button></div>`;
      barRows += `<div class="g-row"><div class="g-bar sub ${col}" style="left:${leftPx(o.start)}px;width:${widthPx(o.start, o.ende)}px"
        title="${esc(o.titel)}: ${fmtDate(o.start)} – ${fmtDate(o.ende)}"
        data-pid="${p.id}" data-vid="${v.id}" data-oid="${o.id}" data-start="${o.start}" data-ende="${o.ende}">
        <span class="g-h l"></span><span class="g-lbl">${esc(o.titel)}</span><span class="g-h r"></span></div></div>`;
    });
  });

  render(head + `
    <div class="gantt">
      <div class="g-side"><div class="g-corner" style="height:${headH}px"></div>${sideRows}</div>
      <div class="g-main"><div class="g-inner" style="width:${innerW}px">
        <div class="g-head" style="height:${headH}px">
          <div class="g-headrow">${monthCells}</div>
          ${subCells ? `<div class="g-headrow sub">${subCells}</div>` : ''}
        </div>
        <div class="g-rows">
          <div class="g-bg">${monthBg}</div>
          ${todayLeft != null ? `<div class="g-today" style="left:${todayLeft}px"></div>` : ''}
          ${barRows}
        </div>
      </div></div>
    </div>
    <div class="g-legend">
      ${VERGABE_STATUS.map(s => `<span><i style="background:var(--s-${s.color})"></i>${s.kurz}</span>`).join('')}
    </div>
    <p class="muted" style="font-size:12.5px;margin-top:10px">Balken <b>ziehen</b> = verschieben · an den <b>Rändern ziehen</b> = Dauer ändern · Klick öffnet den Dialog · Zoom oben rechts (Monat → Tag).</p>
  `);

  $$('.g-bar').forEach(b => b.addEventListener('mousedown', onBarMouseDown));
}

/* --- Gantt Drag & Drop --- */

let ganttDrag = null;

function onBarMouseDown(e) {
  if (!ganttCtx) return;
  const bar = e.currentTarget;
  const isHandle = e.target.classList.contains('g-h');
  const mode = isHandle ? (e.target.classList.contains('l') ? 'resize-l' : 'resize-r') : 'move';
  ganttDrag = {
    bar, mode, moved: false, startX: e.clientX,
    pid: bar.dataset.pid, vid: bar.dataset.vid, oid: bar.dataset.oid || null,
    origStart: bar.dataset.start, origEnde: bar.dataset.ende,
    newStart: bar.dataset.start, newEnde: bar.dataset.ende,
  };
  bar.classList.add('dragging');
  document.body.style.userSelect = 'none';
  e.preventDefault();
}

function onGanttMove(e) {
  const d = ganttDrag; if (!d) return;
  const dDays = Math.round((e.clientX - d.startX) / ganttCtx.pxPerDay);
  if (dDays !== 0) d.moved = true;
  let s = d.origStart, en = d.origEnde;
  if (d.mode === 'move') { s = addDays(d.origStart, dDays); en = addDays(d.origEnde, dDays); }
  else if (d.mode === 'resize-l') { s = addDays(d.origStart, dDays); if (s > en) s = en; }
  else { en = addDays(d.origEnde, dDays); if (en < s) en = s; }
  d.newStart = s; d.newEnde = en;
  d.bar.style.left = Math.round(dayDiffISO(ganttCtx.rangeStartISO, s) * ganttCtx.pxPerDay) + 'px';
  d.bar.style.width = Math.max(Math.round((dayDiffISO(s, en) + 1) * ganttCtx.pxPerDay), 3) + 'px';
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
  save(); router(); toast('Termin: ' + fmtDate(s) + ' – ' + fmtDate(en), 'info');
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

// Alle offenen Pendenzen eines Projekts (über alle Protokolle), nach Termin sortiert
function offenePendenzen(p) {
  const out = [];
  (p.protokolle || []).forEach(pr => (pr.traktanden || []).forEach(tr => (tr.eintraege || []).forEach(it => {
    if (it.art === 'pendenz' && !it.erledigt && !it.uebertragen) out.push({ it, pr, tr });
  })));
  out.sort((a, b) => (a.it.termin || '9999-99-99').localeCompare(b.it.termin || '9999-99-99'));
  return out;
}

function eintragBadge(it) {
  return it.art === 'pendenz'
    ? `<span class="st amber" style="padding:2px 8px;font-size:10.5px">Pendenz</span>`
    : `<span class="tag">Info</span>`;
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
            <tr class="clickable" data-goto="#/projekt/${p.id}/protokoll/${pr.id}">
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
        <button class="btn secondary" data-act="pdf-protokoll" data-pid="${p.id}" data-prid="${pr.id}">⬇ PDF</button>
        <button class="btn" data-act="new-traktandum" data-pid="${p.id}" data-prid="${pr.id}">+ Traktandum</button>
      </div>
    </div>

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
              <td><input type="checkbox" class="pend-check" data-pid="${p.id}" data-prid="${x.pr.id}" data-tid="${x.tr.id}" data-itemid="${x.it.id}" title="erledigt"></td>
              <td>${esc(x.it.text)}</td>
              <td>${esc(x.it.verantwortlich || '–')}</td>
              <td class="muted frist ${fristClass(x.it.termin, false)}">${x.it.termin ? fristText(x.it.termin, false) : '–'}</td>
              <td class="muted">${esc(protokollTitel(x.pr))} · ${fmtDate(x.pr.datum)}</td>
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
  const p = findProjekt(pid); const pr = findProtokoll(p, prid);
  const tr = (pr.traktanden || []).find(x => x.id === tid);
  const it = tr && (tr.eintraege || []).find(x => x.id === itemid);
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
    <tbody>${pend.map(x => `<tr><td>${esc(x.it.text)}</td><td>${esc(x.it.verantwortlich || '')}</td><td>${x.it.termin ? fmtDate(x.it.termin) : ''}</td><td>${esc(protokollTitel(x.pr))} · ${fmtDate(x.pr.datum)}</td></tr>`).join('')}</tbody></table>` : '';

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

  const html = `
    <div class="breadcrumb">
      <a href="#/projekte">Projekte</a> › <a href="#/projekt/${p.id}">${esc(p.name)}</a> › ${esc(v.gewerk)}
    </div>
    <div class="detail-head">
      <div>
        <h1 style="margin:0;font-size:22px"><span class="bkp-code" style="font-size:16px">${esc(v.bkp)}</span> ${esc(v.gewerk)}</h1>
        <div class="sub" style="margin-top:5px">${v.firma ? 'Unternehmer: <strong>' + esc(v.firma) + '</strong>' : 'Noch kein Unternehmer'}</div>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        ${statusPill(v)}
        ${last ? '' : `<button class="btn" data-act="advance" data-pid="${p.id}" data-vid="${v.id}">Nächster Schritt →</button>`}
      </div>
    </div>

    <div class="detail-stats">
      <div class="dstat"><div class="l">Kostenschätzung (KV)</div><div class="v">${chf(v.schaetzung)}</div></div>
      <div class="dstat"><div class="l">günstigste Offerte (KV rev.)</div><div class="v">${kvRev(v) != null ? chf(kvRev(v)) : '<span class="muted" style="font-size:14px">–</span>'}</div></div>
      <div class="dstat"><div class="l">Vergabesumme (WV)</div><div class="v">${isVergeben(v) ? chf(v.betrag) : '<span class="muted" style="font-size:14px">offen</span>'}</div></div>
      <div class="dstat" style="border-color:var(--brand)"><div class="l">Auftragssumme inkl. NT/Regie</div><div class="v" style="color:var(--brand)">${isVergeben(v) ? chf(schlussSumme(v)) : '~' + chf(kvRev(v) != null ? kvRev(v) : v.schaetzung)}</div></div>
      <div class="dstat"><div class="l">Bezahlt</div><div class="v">${chf(rechnungBezahlt(v))}</div></div>
      <div class="dstat"><div class="l">Offen</div><div class="v">${chf((isVergeben(v) ? schlussSumme(v) : 0) - rechnungBezahlt(v))}</div></div>
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
            <button class="btn sm secondary" data-act="deckblatt-leer" data-pid="${p.id}" data-vid="${v.id}" title="Leeres Einladungs-Deckblatt (PDF)">📄 Vorlage</button>
            <button class="btn sm" data-act="invite" data-pid="${p.id}" data-vid="${v.id}">+ Einladen</button>
          </div>
        </div>
        <div class="muted" style="font-size:12.5px;margin-bottom:12px">
          ${eingeladene.length} eingeladen · ${offs.length} Offerte${offs.length === 1 ? '' : 'n'} erhalten
        </div>
        ${ungesendet.length ? `<button class="btn secondary sm" style="width:100%;margin-bottom:14px" data-act="sendmail" data-pid="${p.id}" data-vid="${v.id}">✉ Einladung an ${ungesendet.length} Unternehmer versenden</button>` : ''}
        ${eingeladene.length ? eingeladene.map(e => `
          <div class="inv-item">
            <div class="inv-info">
              <div class="inv-firma">
                ${esc(e.firma)}
                <span class="st ${INV_STATUS[e.status]?.color || 'grey'}" style="padding:2px 8px;font-size:10.5px">${INV_STATUS[e.status]?.label || e.status}</span>
                ${e.betrag != null && e.betrag === best && offs.length > 1 ? '<span class="off-best">★ günstigste</span>' : ''}
              </div>
              ${e.email ? `<div class="inv-mail muted">${esc(e.email)}</div>` : ''}
            </div>
            <div class="inv-action">
              ${e.status === 'abgesagt'
                ? `<span class="muted" style="font-size:12.5px">abgesagt</span>`
                : `<input class="input betrag-input" type="number" placeholder="Betrag" value="${e.betrag ?? ''}" data-pid="${p.id}" data-vid="${v.id}" data-eid="${e.id}">`}
              <button class="x-btn" title="Deckblatt (Einladung)" data-act="deckblatt" data-pid="${p.id}" data-vid="${v.id}" data-eid="${e.id}">📄</button>
              <button class="x-btn" title="Entfernen" data-act="rm-inv" data-pid="${p.id}" data-vid="${v.id}" data-eid="${e.id}">×</button>
            </div>
          </div>`).join('') : emptyState('☎', 'Noch keine Unternehmer eingeladen.')}
      </div>
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
        <button class="btn sm secondary" data-act="new-rechnung" data-pid="${p.id}" data-vid="${v.id}">+ Rechnung</button>
      </div>
      ${(v.rechnungen || []).length ? `
      <table class="grid" style="margin-top:12px">
        <thead><tr><th style="width:36px"></th><th>Bezeichnung</th><th>Datum</th><th class="num">Betrag</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${(v.rechnungen || []).slice().sort((a, b) => (a.datum || '').localeCompare(b.datum || '')).map(r => `
            <tr class="${r.bezahlt ? 'done-row' : ''}">
              <td><input type="checkbox" class="rg-check" ${r.bezahlt ? 'checked' : ''} data-pid="${p.id}" data-vid="${v.id}" data-rgid="${r.id}" title="bezahlt"></td>
              <td><span class="etext">${esc(r.text || 'Rechnung')}</span>${r.nr ? ` <span class="muted">${esc(r.nr)}</span>` : ''}</td>
              <td class="muted">${fmtDate(r.datum)}</td>
              <td class="num">${chf(r.betrag)}</td>
              <td>${r.bezahlt ? '<span class="st green">bezahlt</span>' : '<span class="st amber">offen</span>'}</td>
              <td><button class="x-btn" data-act="rm-rechnung" data-pid="${p.id}" data-vid="${v.id}" data-rgid="${r.id}">×</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="card-pad" style="display:flex;justify-content:space-between;border-top:1px solid var(--border)">
        <span class="muted">Fakturiert ${chf(rechnungTotal(v))} · davon bezahlt</span>
        <strong>${chf(rechnungBezahlt(v))}</strong>
      </div>` : `<div style="padding:0 0 8px">${emptyState('🧾', 'Noch keine Rechnungen erfasst.')}</div>`}
    </div>
  `;
  render(html);

  // Rechnungs-Häkchen verdrahten
  $$('.rg-check').forEach(cb => cb.addEventListener('change', () => toggleRechnung(cb.dataset.pid, cb.dataset.vid, cb.dataset.rgid)));
  // Betrag-Eingaben verdrahten
  $$('.betrag-input').forEach(inp => inp.addEventListener('change', () => {
    setBetrag(inp.dataset.pid, inp.dataset.vid, inp.dataset.eid, inp.value);
  }));
  // Nachtrag-Status-Dropdowns
  $$('.sm-select[data-act="nachtrag-status"]').forEach(sel => sel.addEventListener('change', () => {
    setNachtragStatus(sel.dataset.pid, sel.dataset.vid, sel.dataset.nid, sel.value);
  }));
}

/* ---------------------------------------------------------------
   12) View: Kontakte
   --------------------------------------------------------------- */

let kontaktFilter = '';

function viewKontakte() {
  let list = state.kontakte;
  if (kontaktFilter) {
    const q = kontaktFilter.toLowerCase();
    list = list.filter(k => (k.firma + k.kategorie + k.ort + (k.person || '') + (k.uid_nr || '')).toLowerCase().includes(q));
  }

  const html = `
    <div class="page-head">
      <div><h1>Kontakte</h1><div class="sub">${state.kontakte.length} Unternehmer &amp; Partner</div></div>
      <button class="btn" data-act="new-kontakt">+ Neuer Kontakt</button>
    </div>
    <div class="toolbar">
      <input class="input search" id="kSearch" placeholder="Firma, Gewerk oder Ort suchen…" value="${esc(kontaktFilter)}">
    </div>
    <div class="card">
      ${list.length ? `
      <table class="grid">
        <thead><tr><th>Firma</th><th>Kategorie</th><th>Ansprechperson</th><th>Ort</th><th>Kontakt</th></tr></thead>
        <tbody>
          ${list.map(k => `
            <tr>
              <td><div class="row-firma"><strong>${esc(k.firma)}</strong>${k.uid_nr ? `<span class="sub">${esc(k.uid_nr)}${k.rechtsform ? ' · ' + esc(k.rechtsform) : ''}</span>` : ''}</div></td>
              <td><span class="tag">${esc(k.kategorie)}</span></td>
              <td>${esc(k.person || '–')}</td>
              <td>${k.plz ? esc(k.plz) + ' ' : ''}${esc(k.ort || '–')}</td>
              <td class="muted">${esc(k.email || k.telefon || '–')}</td>
            </tr>`).join('')}
        </tbody>
      </table>` : emptyState('☎', 'Keine Kontakte gefunden.')}
    </div>
  `;
  render(html);
  const s = $('#kSearch');
  s.addEventListener('input', e => { kontaktFilter = e.target.value; viewKontakte(); });
  s.focus(); s.setSelectionRange(s.value.length, s.value.length);
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
   14) View: Einstellungen
   --------------------------------------------------------------- */

function viewEinstellungen() {
  const html = `
    <div class="page-head"><div><h1>Einstellungen</h1><div class="sub">Prototyp-Konfiguration</div></div></div>
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
}

/* ---------------------------------------------------------------
   15) Aktionen (Modals / Mutationen)
   --------------------------------------------------------------- */

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
    vergaben: [],
    protokolle: [],
  };
  state.projekte.unshift(p);
  save(); closeModal(); go('#/projekt/' + p.id);
  toast('Projekt angelegt');
}

function actNewVergabe(pid) {
  openModal('Neue Vergabe', `
    <div class="form-row">
      <label class="field">BKP-Nr. <input class="input" id="f_bkp" placeholder="211"></label>
      <label class="field">Gewerk <input class="input" id="f_gewerk" placeholder="Baumeisterarbeiten"></label>
    </div>
    <div class="form-row">
      <label class="field">Kostenschätzung (CHF) <input class="input" type="number" id="f_schaetzung" placeholder="250000"></label>
      <label class="field">Eingabefrist <input class="input" type="date" id="f_frist"></label>
    </div>
    <label class="field">Status
      <select class="select" id="f_status">${VERGABE_STATUS.map(s => `<option value="${s.key}">${esc(s.label)}</option>`).join('')}</select>
    </label>
    <div class="form-row">
      <label class="field">Ausführung von (grob) <input class="input" type="date" id="f_baustart"></label>
      <label class="field">Ausführung bis (grob) <input class="input" type="date" id="f_bauende"></label>
    </div>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-vergabe" data-pid="${pid}">Vergabe anlegen</button>`);
}

function saveVergabe(pid) {
  const p = findProjekt(pid);
  if (!p) return;
  const gewerk = $('#f_gewerk').value.trim();
  if (!gewerk) { toast('Bitte ein Gewerk eingeben', 'info'); return; }
  const v = {
    id: uid('v'),
    bkp: $('#f_bkp').value.trim() || '000',
    gewerk,
    schaetzung: Number($('#f_schaetzung').value) || 0,
    frist: $('#f_frist').value || '',
    status: $('#f_status').value,
    firma: '',
    betrag: 0,
    bauStart: $('#f_baustart').value || '',
    bauEnde: $('#f_bauende').value || '',
    eingeladene: [], nachtraege: [], rapporte: [], vorgaenge: [], rechnungen: [],
  };
  p.vergaben.push(v);
  save(); closeModal(); router();
  toast('Vergabe angelegt');
}

function advanceVergabe(pid, vid) {
  const p = findProjekt(pid);
  const v = p && findVergabe(p, vid);
  if (!v) return;
  const i = statusIdx(v);
  if (i >= VERGABE_STATUS.length - 1) return;
  v.status = VERGABE_STATUS[i + 1].key;
  // Beim Zuschlag automatisch günstigste Offerte als Firma + Betrag übernehmen
  if (v.status === 'vergeben' && !v.firma) {
    const offs = offertenOf(v).slice().sort((a, b) => a.betrag - b.betrag);
    if (offs.length) { v.firma = offs[0].firma; v.betrag = offs[0].betrag; }
  }
  save(); router();
  toast('Status → ' + STATUS_BY_KEY[v.status].label);
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
    <div class="form-row">
      <label class="field">Firma <input class="input" id="cust_firma" placeholder="Firmenname"></label>
      <label class="field">E-Mail <input class="input" id="cust_email" placeholder="optional"></label>
    </div>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-invite" data-pid="${pid}" data-vid="${vid}">Einladen</button>`);

  $('#invSearch')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    $$('#invList .inv-pick').forEach(row => { row.style.display = row.dataset.search.includes(q) ? '' : 'none'; });
  });
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

function sendMail(pid, vid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  const empf = (v.eingeladene || []).filter(e => e.status === 'eingeladen');
  if (!empf.length) { toast('Keine offenen Einladungen', 'info'); return; }
  const to = empf.map(e => e.email || e.firma).join(', ');
  const betreff = `Submissionseinladung – BKP ${v.bkp} ${v.gewerk} / ${p.name}`;
  const body =
`Sehr geehrte Damen und Herren

Für das Bauvorhaben "${p.name}" in ${p.ort} laden wir Sie ein, eine Offerte für folgendes Gewerk einzureichen:

  Gewerk:        ${v.bkp} ${v.gewerk}
  Eingabefrist:  ${fmtDate(v.frist)}

Die Ausschreibungsunterlagen finden Sie im Anhang.

Freundliche Grüsse
${p.projektleiter}`;
  openModal('Einladung versenden', `
    <label class="field">An (${empf.length} Empfänger)<input class="input" value="${esc(to)}" readonly></label>
    <label class="field">Betreff<input class="input" value="${esc(betreff)}" readonly></label>
    <label class="field">Nachricht<textarea class="input" rows="9" readonly style="resize:vertical;font-family:inherit;line-height:1.5">${esc(body)}</textarea></label>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="confirm-mail" data-pid="${pid}" data-vid="${vid}">✉ Jetzt versenden</button>`);
}

function confirmMail(pid, vid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  let n = 0;
  (v.eingeladene || []).forEach(e => { if (e.status === 'eingeladen') { e.status = 'angefragt'; e.datumMail = todayIso(); n++; } });
  save(); closeModal(); router();
  toast('Einladung an ' + n + ' Unternehmer versendet');
}

function setBetrag(pid, vid, eid, val) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  const e = (v.eingeladene || []).find(x => x.id === eid); if (!e) return;
  const num = (val === '' || val == null) ? null : Number(val);
  e.betrag = num;
  if (num != null) {
    e.status = 'offeriert';
    if (statusIdx(v) < STATUS_BY_KEY['offerten'].index) v.status = 'offerten';
  }
  save(); router();
}

function removeInvite(pid, vid, eid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  v.eingeladene = (v.eingeladene || []).filter(x => x.id !== eid);
  save(); router();
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
  openModal('Neue Rechnung', `
    <label class="field">Bezeichnung <input class="input" id="rg_text" placeholder="z.B. Akontorechnung 1 / Schlussrechnung"></label>
    <div class="form-row">
      <label class="field">Rechnungs-Nr. <input class="input" id="rg_nr" placeholder="optional"></label>
      <label class="field">Betrag (CHF) <input class="input" type="number" id="rg_betrag"></label>
    </div>
    <div class="form-row">
      <label class="field">Datum <input class="input" type="date" id="rg_datum" value="${todayIso()}"></label>
      <label class="field">Status
        <select class="select" id="rg_bezahlt"><option value="0">offen</option><option value="1">bezahlt</option></select>
      </label>
    </div>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-rechnung" data-pid="${pid}" data-vid="${vid}">Speichern</button>`);
}

function saveRechnung(pid, vid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  const betrag = Number($('#rg_betrag').value) || 0;
  if (!betrag) { toast('Bitte einen Betrag eingeben', 'info'); return; }
  (v.rechnungen = v.rechnungen || []).push({
    id: uid('rg'), text: $('#rg_text').value.trim() || 'Rechnung', nr: $('#rg_nr').value.trim(),
    betrag, datum: $('#rg_datum').value || todayIso(), bezahlt: $('#rg_bezahlt').value === '1',
  });
  save(); closeModal(); router(); toast('Rechnung erfasst');
}

function toggleRechnung(pid, vid, rgid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  const r = (v.rechnungen || []).find(x => x.id === rgid); if (!r) return;
  r.bezahlt = !r.bezahlt; save(); router();
}

function removeRechnung(pid, vid, rgid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  v.rechnungen = (v.rechnungen || []).filter(x => x.id !== rgid);
  save(); router();
}

/* --- Deckblatt für Ausschreibung / Offerte (PDF) --- */

// Absender/Büro (Eingabeadresse) – später in Einstellungen konfigurierbar
const BUERO = {
  firma: 'Gerber-Software – Bauadministration',
  strasse: '',
  plzort: '',
  tel: '',
  email: 'gerber.yanick1@gmail.com',
};

function pdfDeckblatt(pid, vid, eid, typ) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  const e = eid ? (v.eingeladene || []).find(x => x.id === eid) : null;
  const istOfferte = typ === 'offerte';
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
      <div class="f">${esc(BUERO.firma)}</div>
      ${esc(BUERO.strasse)}${BUERO.strasse ? '<br>' : ''}${esc(BUERO.plzort)}${BUERO.plzort ? '<br>' : ''}
      ${BUERO.tel ? 'Tel. ' + esc(BUERO.tel) + '<br>' : ''}${esc(BUERO.email)}
    </div>

    <h1>${esc(titel)}</h1>

    <table class="kv">
      <tr><td class="l"><strong>Objekt:</strong></td><td><strong>${esc(p.name)}</strong><br>${esc(p.ort)}</td></tr>
      <tr><td class="l">Bauherr:</td><td>${esc(p.bauherr)}</td></tr>
      <tr><td class="l">Eingabeadresse:</td><td>${esc(BUERO.firma)}${BUERO.plzort ? '<br>' + esc(BUERO.plzort) : ''}</td></tr>
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
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-termin" data-pid="${pid}" data-vid="${vid}">Speichern</button>`);
}

function saveTermin(pid, vid) {
  const p = findProjekt(pid); const v = findVergabe(p, vid);
  const s = $('#t_start').value, e = $('#t_ende').value;
  if (s && e && e < s) { toast('Ende liegt vor dem Start', 'info'); return; }
  v.bauStart = s; v.bauEnde = e;
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
async function firmenSuche(q) {
  const s = (q || '').trim();
  if (s.length < 2) return [];
  try {
    const term = s.toLowerCase().replace(/[\\"]/g, ' ');   // für SPARQL-String entschärfen
    const query =
`PREFIX admin: <https://schema.ld.admin.ch/>
PREFIX schema: <http://schema.org/>
SELECT ?name ?type ?ort ?plz ?uid WHERE {
  { SELECT ?uri ?name WHERE {
      ?uri a admin:ZefixOrganisation ; schema:name ?name .
      FILTER(CONTAINS(LCASE(STR(?name)), "${term}"))
  } LIMIT 8 }
  OPTIONAL { ?uri schema:additionalType ?t . ?t schema:name ?type . FILTER(langMatches(lang(?type),"de")) }
  OPTIONAL { ?uri schema:address ?a . OPTIONAL { ?a schema:addressLocality ?ort } OPTIONAL { ?a schema:postalCode ?plz } }
  OPTIONAL { ?uri schema:identifier ?id . FILTER(CONTAINS(STR(?id),"/UID/")) BIND(REPLACE(STR(?id),"^.*/UID/","") AS ?uid) }
}`;
    const r = await fetch('https://lindas.admin.ch/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/sparql-results+json' },
      body: 'query=' + encodeURIComponent(query),
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
          kanton: '', branche: '',
        };
        const key = row.name + row.uid;
        if (row.name && !seen.has(key)) { seen.add(key); out.push(row); }
      }
      if (out.length) return out;
    }
  } catch (e) { /* Fallback unten */ }
  // Fallback (offline / Dienst nicht erreichbar): lokale Demo-Liste
  const ls = s.toLowerCase();
  return FIRMEN_DB
    .filter(f => f.name.toLowerCase().includes(ls) || f.ort.toLowerCase().includes(ls) || f.branche.toLowerCase().includes(ls))
    .slice(0, 8);
}

function actNewKontakt() {
  openModal('Neuer Kontakt', `
    <label class="field">Firma im Handelsregister suchen
      <input class="input" id="f_firma" placeholder="Firmenname, Ort oder Branche eingeben…" autocomplete="off">
    </label>
    <div id="firmaResults" class="ac-list" style="display:none"></div>
    <div class="form-row">
      <label class="field">UID <input class="input" id="f_uid" placeholder="CHE-…"></label>
      <label class="field">Rechtsform <input class="input" id="f_rf"></label>
    </div>
    <div class="form-row">
      <label class="field">PLZ <input class="input" id="f_plz"></label>
      <label class="field">Ort <input class="input" id="f_kort"></label>
    </div>
    <label class="field">Kategorie / Gewerk <input class="input" id="f_kat" placeholder="z.B. Baumeister"></label>
    <hr style="border:none;border-top:1px solid var(--border);margin:4px 0">
    <strong style="font-size:13px">Manuell ergänzen</strong>
    <label class="field">Ansprechperson <input class="input" id="f_person" placeholder="Vor- und Nachname"></label>
    <div class="form-row">
      <label class="field">E-Mail <input class="input" id="f_email" placeholder="name@firma.ch"></label>
      <label class="field">Telefon <input class="input" id="f_tel"></label>
    </div>
  `, `<button class="btn ghost" data-close="1">Abbrechen</button><button class="btn" data-act="save-kontakt">Speichern</button>`);

  const inp = $('#f_firma'), box = $('#firmaResults');
  let matches = [];
  let tmr = null;
  const renderMatches = () => {
    if (!matches.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = 'block';
    box.innerHTML = matches.map((f, i) => `
      <div class="ac-item" data-i="${i}">
        <div><strong>${esc(f.name)}</strong>${f.rechtsform ? ` <span class="tag">${esc(f.rechtsform)}</span>` : ''}</div>
        <div class="muted" style="font-size:12px">${esc(f.uid)}${f.ort ? ' · ' + (f.plz ? esc(f.plz) + ' ' : '') + esc(f.ort) : ''}${f.branche ? ' · ' + esc(f.branche) : ''}</div>
      </div>`).join('');
  };
  inp.addEventListener('input', () => {
    const val = inp.value;
    clearTimeout(tmr);
    if (val.trim().length < 2) { matches = []; renderMatches(); return; }
    box.style.display = 'block';
    box.innerHTML = '<div class="ac-item muted">Suche im Handelsregister…</div>';
    tmr = setTimeout(async () => { matches = await firmenSuche(val); renderMatches(); }, 300);
  });
  box.addEventListener('click', e => {
    const it = e.target.closest('.ac-item'); if (!it) return;
    const f = matches[+it.dataset.i];
    inp.value = f.name;
    $('#f_uid').value = f.uid; $('#f_rf').value = f.rechtsform;
    $('#f_plz').value = f.plz; $('#f_kort').value = f.ort;
    if (!$('#f_kat').value.trim()) $('#f_kat').value = f.branche;
    box.style.display = 'none'; box.innerHTML = '';
    $('#f_person').focus();
    toast('Firmendaten aus Register übernommen', 'info');
  });
}

function saveKontakt() {
  const firma = $('#f_firma').value.trim();
  if (!firma) { toast('Bitte eine Firma eingeben', 'info'); return; }
  state.kontakte.unshift({
    id: uid('k'), firma,
    uid_nr: $('#f_uid').value.trim() || '',
    rechtsform: $('#f_rf').value.trim() || '',
    plz: $('#f_plz').value.trim() || '',
    kategorie: $('#f_kat').value.trim() || '–',
    ort: $('#f_kort').value.trim() || '',
    person: $('#f_person').value.trim() || '',
    email: $('#f_email').value.trim() || '',
    telefon: $('#f_tel').value.trim() || '',
  });
  save(); closeModal(); viewKontakte();
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
  state = demoData(); migrate(); save(); router();
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
  const { act: a, pid, vid, eid, nid, rid, oid, prid, tid, itemid, kind, idx, rgid } = act.dataset;
  switch (a) {
    case 'new-projekt':  actNewProjekt(); break;
    case 'save-projekt': saveProjekt(); break;
    case 'new-vergabe':  actNewVergabe(pid); break;
    case 'save-vergabe': saveVergabe(pid); break;
    case 'advance':      advanceVergabe(pid, vid); break;
    case 'invite':       actInvite(pid, vid); break;
    case 'save-invite':  saveInvite(pid, vid); break;
    case 'sendmail':     sendMail(pid, vid); break;
    case 'confirm-mail': confirmMail(pid, vid); break;
    case 'rm-inv':       removeInvite(pid, vid, eid); break;
    case 'new-nachtrag': actNewNachtrag(pid, vid); break;
    case 'save-nachtrag':saveNachtrag(pid, vid); break;
    case 'rm-nachtrag':  removeNachtrag(pid, vid, nid); break;
    case 'new-rapport':  actNewRapport(pid, vid); break;
    case 'save-rapport': saveRapport(pid, vid); break;
    case 'rm-rapport':   removeRapport(pid, vid, rid); break;
    case 'new-rechnung': actNewRechnung(pid, vid); break;
    case 'save-rechnung':saveRechnung(pid, vid); break;
    case 'rm-rechnung':  removeRechnung(pid, vid, rgid); break;
    case 'deckblatt':      pdfDeckblatt(pid, vid, eid, 'einladung'); break;
    case 'deckblatt-leer': pdfDeckblatt(pid, vid, null, 'einladung'); break;
    case 'edit-termin':  actEditTermin(pid, vid); break;
    case 'save-termin':  saveTermin(pid, vid); break;
    case 'gantt-zoom':   ganttZoom = kind; viewTermine(pid); break;
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
    case 'new-kontakt':  actNewKontakt(); break;
    case 'save-kontakt': saveKontakt(); break;
    case 'export':       exportData(); break;
    case 'reset':        resetDemo(); break;
    case 'logout':       logout(); break;
  }
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
document.addEventListener('mousemove', onGanttMove);
document.addEventListener('mouseup', onGanttUp);

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
      vergaben: [
        { id: 'v1', bkp: '112', gewerk: 'Abbrucharbeiten', status: 'abgeschlossen', firma: 'Demowald Rückbau GmbH', betrag: 84000, schaetzung: 90000, frist: '2026-03-15',
          bauStart: '2026-03-01', bauEnde: '2026-03-25',
          eingeladene: einl(['Demowald Rückbau GmbH', 84000], ['Frei Abbruch AG', 91500]), nachtraege: [], rapporte: [], vorgaenge: [] },
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
          rapporte: [], vorgaenge: [
            { id: uid('o'), titel: 'Fundament & Bodenplatte', start: '2026-06-22', ende: '2026-07-31' },
            { id: uid('o'), titel: 'Rohbau EG–2.OG', start: '2026-08-03', ende: '2026-10-30' },
            { id: uid('o'), titel: 'Rohbau Attika & Dach', start: '2026-11-02', ende: '2026-12-20' },
          ] },
        { id: 'v4', bkp: '221', gewerk: 'Fenster & Aussentüren', status: 'bewertung', firma: '', betrag: 0, schaetzung: 320000, frist: '2026-06-08',
          bauStart: '2026-10-01', bauEnde: '2026-11-30',
          eingeladene: einl(['Fensterwerk AG', 298000], ['Glas+Rahmen GmbH', 312000], ['Holz-Metall Fenster AG', 305000]), nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'v5', bkp: '230', gewerk: 'Elektroanlagen', status: 'offerten', firma: '', betrag: 0, schaetzung: 280000, frist: '2026-06-22',
          bauStart: '2026-09-01', bauEnde: '2027-02-28',
          eingeladene: einl(['Elektro Meyer AG', 271000], ['Volt & Co.', 289000], ['Stromwerk AG', null]), nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'v6', bkp: '250', gewerk: 'Sanitäranlagen', status: 'ausschreibung', firma: '', betrag: 0, schaetzung: 240000, frist: '2026-07-01',
          bauStart: '2026-11-01', bauEnde: '2027-03-31',
          eingeladene: einl(['Sanitär Wyss AG', null, 'eingeladen'], ['Aqua Plus GmbH', null, 'eingeladen'], ['Rohr & Co.', null, 'eingeladen']), nachtraege: [], rapporte: [], vorgaenge: [] },
        { id: 'v7', bkp: '252', gewerk: 'Heizungsanlagen', status: 'ausschreibung', firma: '', betrag: 0, schaetzung: 195000, frist: '2026-07-05',
          bauStart: '2026-11-01', bauEnde: '2027-02-28',
          eingeladene: einl(['WärmeTech GmbH', null], ['Heiztech AG', null]), nachtraege: [], rapporte: [], vorgaenge: [] },
      ],
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

  return { projekte, kontakte, dokumente };
}
